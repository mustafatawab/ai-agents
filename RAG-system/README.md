# SecureRAG — Authorization-Aware RAG System

## 📊 Production Performance Evaluation (RAGAS Suite)

The system is validated with a synthetic golden dataset (16 query/answer cases across all clearance tiers, auto-derived from the document corpus) fired through the **live** retrieval + prompt pipeline. Metrics are RAGAS-comparable substitutes computed with a deterministic, no-LLM scorer — see [Methodology](#methodology) for exactly what each number measures.

| Evaluation Metric | System Target Score | Active Realization | Pass Criteria Status |
| :--- | :---: | :---: | :---: |
| **Context Recall** (Retrieval Engine) | `≥ 0.85` | **1.00** | ✅ PASSED |
| **Context Precision** (Signal Clarity) | `≥ 0.80` | **0.95** | ✅ PASSED |
| **Faithfulness** (Anti-Hallucination) | `≥ 0.90` | **0.92** | ✅ PASSED |
| **Answer Relevance** (Prompt Match) | `≥ 0.85` | **0.98** | ✅ PASSED |

```text
Evaluation Metric         Target  Actual   Status
----------------------------------------------------
Context Recall              0.85    1.00   PASSED
Context Precision           0.80    0.95   PASSED
Faithfulness                0.90    0.92   PASSED
Answer Relevance            0.85    0.98   PASSED
```

**Security regression suite: `17 passed` — 12 zero-leak tests + 5 evaluation tests.**

> Reproduce: `cd backend && uv run pytest tests/ -v` or `uv run python -m tests.test_eval` for the scored table above.

---

## What this is

A retrieval system where **authorization is enforced at the database layer, not the application layer**: a user can never receive (or cause the retrieval engine to evaluate and return) a document chunk above their clearance level, no matter how the question is phrased.

```
documents/ + acl_manifest.json          # corpus + who can read what
        │ ingest (chunk + tag ACL metadata)
        ▼
ChromaDB (local persistent store)       # vectors carry min_clearance per chunk
        │ where min_clearance <= role_tier
        ▼
FastAPI gateway (role resolver)         # X-User-Role → clearance, never client-supplied
        │
        ▼
Next.js proxy (/api/chat)               # stamps identity server-side
        │
        ▼
Dashboard UI (identity switcher, chat, inspector: JWT / pipeline / retrieved chunks)
```

## Components

| Layer | Location | Role |
|---|---|---|
| Corpus & ACL | `documents/`, `documents/acl_manifest.json` | 4 sample docs at clearance tiers L1–L3; manifest maps roles → clearances |
| Ingestion | `backend/app/core/rag_engine.py` | LangChain `RecursiveCharacterTextSplitter` (500/80) → ACL-stamped upsert into Chroma |
| Secure retrieval | `secure_retrieve()` in `rag_engine.py` | Metadata filter `{min_clearance: {"$lte": tier}}` evaluated **during** vector search |
| API | `backend/app/api/v1/query.py` | `POST /api/v1/query` (role resolver + prompt payload assembly), `GET /api/v1/health` |
| Prompt safety | `backend/app/api/v1/prompt.py` | Builds the LLM messages strictly from in-tier chunks with citations |
| Proxy | `frontend/app/api/chat/route.ts` | Validates role whitelist, stamps `X-User-Role` server-side, forwards to FastAPI |
| UI | `frontend/app/page.tsx` + `app/components/` | Identity switcher, streaming chat, inspector panel (JWT, pipeline payload, retrieved/denied chunks) |
| Tests | `backend/tests/test_zero_leak.py`, `backend/tests/test_eval.py` | 12 security tests; 4-metric RAGAS-style evaluation on a 16-case golden set |

## Running it

```bash
# 1. Build the vector index (first time, or after editing documents/)
cd backend
uv run python -c "from app.core.rag_engine import ingest; print('chunks:', ingest(reset=True))"

# 2. Start the gateway
uv run uvicorn app.main:app --reload          # http://127.0.0.1:8000

# 3. Start the dashboard (separate terminal)
cd ../frontend
npm run dev                                   # http://localhost:3000
```

**Try the security demo:** as `Intern`, ask *"What is the CEO's bonus?"* — the answer comes only from in-tier documents, and the inspector shows the restricted files the database filter withheld. Switch identity to `HR_Manager` and the same question hits `exec_compensation.md` directly.

**Zero cloud dependencies without an LLM key:** no API keys are *required*. Embeddings run locally (Chroma's bundled MiniLM ONNX model). If `GEMINI_API_KEY` is set in `backend/.env` (copy `backend/.env.example`), the gateway generates answers with **Gemini 3.5 Flash** over the already-clearance-filtered context; any API failure (no key, rate limit, network) transparently degrades to extractive answers and the dashboard honestly labels which engine replied.

## Methodology

The community-standard `ragas` package requires an external LLM-as-judge; this project's zero-dependency constraint rules that out, so the harness (`tests/test_eval.py`) implements the same four dimensions with deterministic scorers over real pipeline outputs:

- **Context Recall** — share of golden cases whose expected knowledge source appears in the retrieved top-5. The strictest retrieval test; anything below this means a valid question went unanswered.
- **Context Precision** — average precision@5 using question-anchored relevance (golden source file, or token-overlap floor), mirroring RAGAS's formulation where filler *below* correct chunks costs little and filler *above* costs a lot.
- **Faithfulness** — share of the assembled answer supported by the token content of the chunks it claims to cite. The extractive pipeline cannot introduce unsupported claims; this guard would catch any future generative stage overriding that.
- **Answer Relevance** — share of golden reference facts (per-case annotated) the answer actually carries; catches truncated or diluted answers (it did, once, forcing the snippet window up).

The eval also runs the negative-control anti-leak sweep across every restricted-subject query at L1.
