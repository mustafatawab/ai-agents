"""Safe prompt construction.

Assembles the LLM prompt payload from chunks that have already passed the
database-level clearance filter. Nothing in this module re-checks
authorization — it relies on the invariant that a chunk reaching this code
is entitled to the caller.
"""

from __future__ import annotations

from typing import Any

from ...core.rag_engine import RetrievedChunk


def _context_text(chunks: list[RetrievedChunk]) -> str:
    return "\n\n".join(
        f"[{i + 1}] ({c.source_filename} · {c.section or 'untitled section'})\n{c.text}"
        for i, c in enumerate(chunks)
    )


def build_prompt_payload(
    query: str,
    role: str,
    chunks: list[RetrievedChunk],
) -> dict[str, Any]:
    """Build the chat messages handed to the LLM, plus an extractive answer.

    The returned `messages` is the exact payload /chat/completions would
    receive — useful for the inspector panel in the frontend.
    """
    system = (
        "You are the SecureRAG enterprise archive assistant. Answer strictly "
        "from the numbered context excerpts. Cite sources as [n]. If the "
        "context does not contain the answer, say so plainly. The context has "
        f"already been filtered for the caller's role ({role}); do not speculate "
        "about material beyond it."
    )

    if not chunks:
        return {
            "answer": (
                "Nothing in the vector store matched that under your clearance. "
                "Try a broader phrasing, or a topic your role can read."
            ),
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": query},
            ],
            "context_used": 0,
        }

    messages = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": f"Context:\n\n{_context_text(chunks)}\n\nQuestion: {query}",
        },
    ]

    # Extractive answer — stand-in for the LLM call; cites with [n]
    answer_parts = []
    for i, c in enumerate(chunks[:3]):
        snippet = " ".join(c.text.strip().split())
        if len(snippet) > 480:  # keep the extractive window generous; truncation drops facts
            snippet = snippet[:477].rsplit(" ", 1)[0] + "…"
        answer_parts.append(f"{snippet} [{i + 1}]")
    answer = (
        "Here’s what the archive returned — all excerpts were already filtered "
        "to your clearance tier:\n\n" + "\n\n".join(answer_parts)
    )

    return {"answer": answer, "messages": messages, "context_used": len(chunks)}
