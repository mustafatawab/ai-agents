"""Zero-leak test suite.

Proves multi-tenant safety **at the vector database layer**:
an identity must not be able to extract — or even cause the index to return —
any chunk above its clearance tier, no matter how the query is phrased.

Run with:  uv run pytest tests/ -v   (from backend/)
"""

from __future__ import annotations

import pytest

from app.core.rag_engine import (
    COLLECTION,
    CHROMA_DIR,
    ingest,
    load_manifest,
    secure_retrieve,
)

# ---- fixture: one shared, freshly ingested index for the whole test run ----


@pytest.fixture(scope="session", autouse=True)
def indexed_corpus():
    """Build the vector store once; every test hits the same instance."""
    n = ingest(reset=True)
    assert n > 0, "ingestion produced no chunks — cannot verify security"
    return n


@pytest.fixture()
def tiers():
    manifest_tiers, _ = load_manifest()
    return manifest_tiers


def _all_chunks(query: str, clearance: int, k: int = 50) -> list:
    """Fetch a large top-k so a leak would have every opportunity to surface."""
    return secure_retrieve(query, user_clearance=clearance, k=k)


# ---- the headline guarantee ------------------------------------------------


def test_intern_asking_about_ceo_bonus_leaks_zero_chunks():
    """The L1 identity must receive ZERO chunks from the L3 compensation file.

    An in-tier (public charter) chunk matching the query's embedding is
    legitimate — a *leak* is any chunk whose min_clearance exceeds the tier.
    """
    for query in (
        "What is the CEO's bonus?",
        "CEO bonus structure",
        "executive target bonus gates",
        "salary bands L5 L6",
        "how much does the CEO make",
        "executive compensation matrix",
        "merit budget severance",
    ):
        chunks = _all_chunks(query, clearance=1)
        leaked = [c for c in chunks if c.min_clearance > 1]
        assert leaked == [], (
            f"LEAK: clearance-1 identity received {len(leaked)} above-tier chunks "
            f"for {query!r}: {[c.source_filename for c in leaked]} — expected exactly 0"
        )


def test_intern_asking_about_incident_report_leaks_zero_chunks():
    """The confidential post-mortem (L3) must not surface for the L1 identity."""
    for query in (
        "INC-0142 security breach details",
        "what caused the S3 bucket exposure",
        "security incident customer impact",
        "root cause of the misconfigured storage",
    ):
        chunks = _all_chunks(query, clearance=1)
        assert all(c.min_clearance <= 1 for c in chunks), (
            f"LEAK on query {query!r}: above-tier chunks returned"
        )
        assert all(
            c.source_filename != "incident_report_inc0142.md" for c in chunks
        )


# ---- diesel-through attempts: adjacent topics must not smuggle L3 content ---


def test_intern_asked_about_salaries_leaks_nothing_from_exec_file():
    """Even salary-adjacent queries must surface zero L3 source files."""
    chunks = _all_chunks("how are salaries reviewed and who approves raises", 1)
    assert all(c.source_filename != "exec_compensation.md" for c in chunks)
    assert all(c.min_clearance >= 1 for c in chunks)  # sanity on metadata shape


# ---- positive controls (security that blocks everything is no security) -----


def test_intern_can_read_public_charter():
    chunks = _all_chunks("vacation policy", 1)
    assert chunks, "L1 identity must be able to read L1 documents"
    assert all(c.min_clearance == 1 for c in chunks)


def test_regular_employee_reads_internal_but_not_exec():
    chunks = _all_chunks("meal reimbursement limit travel", 2)
    assert chunks, "L2 identity must be able to read L2 documents"
    assert all(c.min_clearance <= 2 for c in chunks), "L2 must never get L3 chunks"
    assert any(c.min_clearance == 2 for c in chunks), "L2 must reach the handbook"


def test_hr_manager_reads_everything():
    chunks = _all_chunks("CEO target bonus three gates", 3)
    assert chunks, "L3 identity must be able to read restricted documents"
    assert any(c.source_filename == "exec_compensation.md" for c in chunks), (
        "L3 identity must reach the executive compensation file"
    )


# ---- invariants holding across every tier ---------------------------------


def test_every_tier_never_receives_chunks_above_its_level(tiers):
    for clearance in tiers.values():
        for query in ("compensation", "bonus", "incident", "salary", "policy"):
            for c in _all_chunks(query, clearance):
                assert c.min_clearance <= clearance, f"LEAK at tier L{clearance} on {query!r}"


def test_monotonicity(tiers):
    """Higher clearance is a superset: k_max(L) >= k_max(L')  for L > L'."""
    ks = {
        clearance: len(_all_chunks("employee policy and compensation", clearance))
        for clearance in set(tiers.values())
    }
    assert ks[3] >= ks[2] >= ks[1]


def test_result_never_exceeds_k():
    assert len(_all_chunks("policy", 3, k=3)) <= 3


def test_rejects_unknown_clearance_tier():
    with pytest.raises(ValueError):
        secure_retrieve("bonus", user_clearance=99)


# ---- collection freshness --------------------------------------------------


def test_corpus_matches_manifest():
    _, entries = load_manifest()
    filenames = {e.filename for e in entries}
    client_meta = secure_retrieve("mission charter", 3, k=50)
    assert {c.source_filename for c in client_meta} <= filenames
    # every restricted file actually got ingested (not silently skipped)
    restricteds = [e for e in entries if e.min_clearance == 3]
    assert restricteds, "manifest should restrict at least one file"


def test_no_duplicate_chunk_ids_in_collection():
    import chromadb

    col = chromadb.PersistentClient(path=str(CHROMA_DIR)).get_collection(COLLECTION)
    got = col.get(include=["metadatas"])
    assert len(got["ids"]) == len(set(got["ids"]))
