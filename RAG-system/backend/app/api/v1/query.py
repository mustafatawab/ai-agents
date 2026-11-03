"""POST /api/v1/query — the authorization membrane.

Flow:
  Next.js proxy  --{query, role}-->  this endpoint
  1. Extract simulated identity headers (X-User-Role, X-User-Id).
  2. Role resolver: map role -> clearance tier straight from acl_manifest.json
     (the header carries a role STRING only; clearance is never client-supplied).
  3. secure_retrieve(): database-level clearance filter.
  4. Build the prompt payload from in-tier chunks only, plus a withheld-chunks
     audit list (filenames + tiers only — no text) for the inspector's
     "access denied" view.
"""

from __future__ import annotations

import time
from typing import Any

import chromadb
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ...core.rag_engine import (
    COLLECTION,
    CHROMA_DIR,
    RetrievedChunk,
    ingest,
    load_manifest,
    secure_retrieve,
)
from .prompt import build_prompt_payload
from .llm import generate_answer, llm_configured

router = APIRouter(prefix="/api/v1", tags=["query"])


class QueryRequest(BaseModel):
    query: str = Field(min_length=2, max_length=1000)


class SourceOut(BaseModel):
    rank: int
    filename: str
    section: str
    score: float
    min_clearance: int
    snippet: str


class WithheldOut(BaseModel):
    """Filename + tier only. Deliberately never carries chunk text."""

    filename: str
    min_clearance: int


class QueryResponse(BaseModel):
    query: str
    role: str
    clearance: int
    allowed: bool
    answer: str
    sources: list[SourceOut]
    withheld: list[WithheldOut]
    pipeline: dict[str, Any]
    generation: dict[str, Any]
    prompt_payload: dict[str, Any]


_role_cache: dict[str, int] | None = None


def _resolve_role(role: str) -> int:
    """Map a role string to its clearance tier using the manifest as truth."""
    global _role_cache
    if _role_cache is None:
        tiers, _ = load_manifest()
        _role_cache = tiers
    if role not in _role_cache:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "unknown_role",
                "message": f"Role {role!r} is not in the ACL manifest.",
                "valid_roles": sorted(_role_cache),
            },
        )
    return _role_cache[role]


def _index_size() -> int:
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    try:
        client.get_collection  # noqa: B018 — attribute existence probe
        col = client.get_collection(COLLECTION)
        return col.count()
    except Exception:
        return 0


def _ensure_index() -> None:
    """First-boot safety: ingest if the local index is empty."""
    if _index_size() == 0:
        ingest(reset=True)


def _withheld_audit(chunks: list[RetrievedChunk], clearance: int) -> list[WithheldOut]:
    """Re-query the index *without* the clearance predicate to learn what was
    excluded — filenames/tiers only, never text. This powers the frontend's
    'access denied' inspector view honestly: it shows what the filter caught,
    and nothing else."""
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    col = client.get_or_create_collection(name=COLLECTION)
    result = col.query(
        query_texts=[chunks[0].text if chunks else ""],
        n_results=20,
        include=["metadatas"],
    )
    seen: set[str] = set()
    withheld: list[WithheldOut] = []
    for meta in result["metadatas"][0]:
        if int(meta["min_clearance"]) > clearance:
            fn = meta["source_filename"]
            if fn not in seen:
                seen.add(fn)
                withheld.append(
                    WithheldOut(filename=fn, min_clearance=int(meta["min_clearance"]))
                )
    return withheld


@router.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "indexed_chunks": _index_size(),
        "llm_configured": llm_configured(),
        "llm_model": "gemini-3.5-flash" if llm_configured() else None,
    }


@router.post("/query", response_model=QueryResponse)
def run_query(
    body: QueryRequest,
    x_user_role: str = Header(alias="X-User-Role"),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> QueryResponse:
    _ensure_index()

    clearance = _resolve_role(x_user_role)
    t0 = time.perf_counter()
    chunks = secure_retrieve(body.query, user_clearance=clearance)
    search_ms = round((time.perf_counter() - t0) * 1000)

    payload = build_prompt_payload(body.query, x_user_role, chunks)
    withheld = _withheld_audit(chunks, clearance)

    # Generative stage: Gemini over the (already clearance-filtered) context,
    # or extractive fallback on any failure. Never raises.
    messages = payload["messages"]
    gen = generate_answer(
        body.query,
        system_content=messages[0]["content"],
        user_content=messages[-1]["content"],
    )
    if gen.get("answer") is None:
        gen["answer"] = payload["answer"]  # extractive stand-in

    sources = [
        SourceOut(
            rank=i + 1,
            filename=c.source_filename,
            section=c.section,
            # chroma cosine distance -> similarity for display
            score=round(max(0.0, 1.0 - c.score), 2),
            min_clearance=c.min_clearance,
            snippet=c.text.strip(),
        )
        for i, c in enumerate(chunks)
    ]

    return QueryResponse(
        query=body.query,
        role=x_user_role,
        clearance=clearance,
        allowed=bool(sources),
        answer=gen["answer"],
        sources=sources,
        withheld=withheld,
        pipeline={
            "collection": COLLECTION,
            "filter": {"min_clearance": {"$lte": clearance}},
            "resolved_from": {"X-User-Role": x_user_role, "X-User-Id": x_user_id},
            "returned": len(sources),
            "withheld_files": len(withheld),
            "indexed_chunks": _index_size(),
            "latency_ms": {"retrieval": search_ms, "generation": gen.get("latency_ms")},
        },
        generation={
            "engine": gen["engine"],
            "model": gen.get("model"),
            "latency_ms": gen.get("latency_ms"),
            "note": gen.get("note"),
        },
        prompt_payload={
            "messages": payload["messages"],
            "context_used": payload["context_used"],
        },
    )
