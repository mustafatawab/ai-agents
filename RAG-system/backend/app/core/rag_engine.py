"""Secure RAG engine.

Pipeline: filesystem corpus + ACL manifest -> LangChain chunking ->
metadata-tagged upsert into a local (persistent) Chroma collection ->
clearance-filtered retrieval enforced at the *database* layer.

Every chunk carries the ACL of the file it came from, and `secure_retrieve`
never sees a chunk it is not entitled to — the predicate is part of the
vector query itself, not a post-filter.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import chromadb
from langchain_text_splitters import RecursiveCharacterTextSplitter

# project root = RAG-system/  (this file: backend/app/core/rag_engine.py)
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DOCUMENTS_DIR = PROJECT_ROOT / "documents"
MANIFEST_PATH = DOCUMENTS_DIR / "acl_manifest.json"
CHROMA_DIR = PROJECT_ROOT / "backend" / ".chroma"

COLLECTION = "corporate_docs"
EMBED_MODEL = "default"  # chroma's bundled all-MiniLM-L6-v2, no external calls


# --------------------------------------------------------------------------
# ACL manifest
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class AclEntry:
    filename: str
    min_clearance: int
    allowed_roles: tuple[str, ...]


def load_manifest(path: Path = MANIFEST_PATH) -> tuple[dict[str, int], list[AclEntry]]:
    """Return (role -> clearance tier, per-document ACL entries)."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    tiers = raw["clearance_tiers"]
    entries = [
        AclEntry(
            filename=d["filename"],
            min_clearance=int(d["min_clearance"]),
            allowed_roles=tuple(d["allowed_roles"]),
        )
        for d in raw["documents"]
    ]
    _validate_manifest(tiers, entries)
    return tiers, entries


def _validate_manifest(tiers: dict[str, int], entries: list[AclEntry]) -> None:
    if not all(isinstance(v, int) and v >= 1 for v in tiers.values()):
        raise ValueError("clearance tiers must be positive integers")
    for e in entries:
        if e.min_clearance not in tiers.values():
            raise ValueError(f"{e.filename}: min_clearance {e.min_clearance} is not a known tier")
        derived = {role for role, lvl in tiers.items() if lvl >= e.min_clearance}
        if set(e.allowed_roles) != derived:
            raise ValueError(f"{e.filename}: allowed_roles disagrees with clearance tiers")


# --------------------------------------------------------------------------
# Step 2 — chunk, tag, upsert
# --------------------------------------------------------------------------

def _load_documents() -> list[tuple[str, str, AclEntry]]:
    """Return (text, section_title, acl) for every ingested file."""
    _, entries = load_manifest()
    docs = []
    for entry in entries:
        path = DOCUMENTS_DIR / entry.filename
        if not path.is_file():
            raise FileNotFoundError(f"manifest references missing file: {entry.filename}")
        docs.append((path.read_text(encoding="utf-8"), entry.filename, entry))
    return docs


def ingest(reset: bool = True) -> int:
    """Chunk every document, stamp ACL metadata, and upsert into Chroma.

    Returns the number of chunks written. Safe to re-run: the collection is
    rebuilt from source so stale chunks can't linger after manifest changes.
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=80,
        separators=["\n\n", "\n", ". ", " ", ""],
    )

    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    if reset:
        try:
            client.delete_collection(COLLECTION)
        except Exception:
            pass  # first run: nothing to reset

    collection = client.get_or_create_collection(
        name=COLLECTION,
        metadata={"hnsw:space": "cosine"},
    )

    ids: list[str] = []
    texts: list[str] = []
    metadatas: list[dict[str, Any]] = []

    for text, filename, acl in _load_documents():
        for i, chunk in enumerate(splitter.split_text(text)):
            ids.append(f"{filename}::{i}")
            texts.append(chunk)
            metadatas.append(
                {
                    # --- security payload -------------------------------
                    "min_clearance": acl.min_clearance,
                    "allowed_roles": ", ".join(acl.allowed_roles),
                    # --- provenance -------------------------------------
                    "source_filename": filename,
                    "chunk_index": i,
                    "section": _extract_section(chunk),
                }
            )

    if ids:
        collection.upsert(ids=ids, documents=texts, metadatas=metadatas)
    return len(ids)


def _extract_section(chunk: str) -> str:
    """Best-effort section title: the nearest '##' heading above the chunk."""
    headings = [ln for ln in chunk.splitlines() if ln.startswith("## ")]
    return headings[0][3:].strip() if headings else ""


# --------------------------------------------------------------------------
# Step 3 — database-level secure retrieval
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class RetrievedChunk:
    text: str
    source_filename: str
    section: str
    score: float  # cosine distance (lower is closer)
    min_clearance: int
    allowed_roles: tuple[str, ...]


def secure_retrieve(
    query: str,
    user_clearance: int,
    k: int = 5,
) -> list[RetrievedChunk]:
    """Semantic search that cannot return chunks above the caller's tier.

    The `where` predicate is evaluated by the vector database *during* the
    search — it is not a post-filter — so a chunk the caller isn't entitled
    to is never fetched, scored, or materialized in memory.
    """
    tiers, _ = load_manifest()
    if user_clearance not in tiers.values():
        raise ValueError(
            f"unknown clearance tier {user_clearance}; valid: {sorted(tiers.values())}"
        )

    if user_clearance < 1:
        return []

    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    collection = client.get_or_create_collection(name=COLLECTION)

    result = collection.query(
        query_texts=[query],
        n_results=k,
        where={"min_clearance": {"$lte": user_clearance}},  # ← the whole point
        include=["documents", "metadatas", "distances"],
    )

    chunks: list[RetrievedChunk] = []
    for text, meta, dist in zip(
        result["documents"][0],
        result["metadatas"][0],
        result["distances"][0],
    ):
        chunks.append(
            RetrievedChunk(
                text=text,
                source_filename=meta["source_filename"],
                section=meta.get("section", ""),
                score=float(dist),
                min_clearance=int(meta["min_clearance"]),
                allowed_roles=tuple(meta["allowed_roles"].split(", ")),
            )
        )
    return chunks
