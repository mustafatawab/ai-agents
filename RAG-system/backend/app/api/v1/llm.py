"""Generation stage — Gemini free-tier (model: gemini-3.8-flash).

Contract with the rest of the gateway:
  * The caller passes the prompt payload built by build_prompt_payload(),
    whose context is ALREADY clearance-filtered. This module adds no new
    material to the context — it only asks the model to reason over it.
  * Every failure mode (no key, network down, rate limit, empty response)
    degrades to the extractive answer instead of failing the request.

Key setup: create backend/.env with a single line
  GEMINI_API_KEY=your_key_here
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# backend/app/api/v1/llm.py -> backend -> backend/.env
load_dotenv(Path(__file__).resolve().parents[3] / ".env")

GEMINI_MODEL = "gemini-3.8-flash"


def llm_configured() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


def generate_answer(
    query: str,
    system_content: str,
    user_content: str,
) -> dict[str, Any]:
    """Return {"answer", "engine", "model", "latency_ms", "note"?}.

    Never raises: on any problem it returns the extractive fallback and
    includes a `note` explaining why — so the UI stays honest about
    which engine produced the text.
    """
    if not llm_configured():
        return {
            "answer": None,  # caller falls back to its extractive answer
            "engine": "extractive_fallback",
            "model": None,
            "latency_ms": None,
            "note": "GEMINI_API_KEY not set — answering extractively from retrieved chunks.",
        }

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        t0 = time.perf_counter()
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=user_content,
            config=types.GenerateContentConfig(
                system_instruction=system_content,
                temperature=0.2,
                max_output_tokens=700,
            ),
        )
        latency_ms = round((time.perf_counter() - t0) * 1000)

        text = (response.text or "").strip()
        if not text:
            return {
                "answer": None,
                "engine": "extractive_fallback",
                "model": GEMINI_MODEL,
                "latency_ms": latency_ms,
                "note": "Model returned an empty response (often rate limiting) — fell back to extractive.",
            }
        return {
            "answer": text,
            "engine": "gemini",
            "model": GEMINI_MODEL,
            "latency_ms": latency_ms,
        }

    except Exception as exc:  # noqa: BLE001 — must never propagate to the HTTP layer
        return {
            "answer": None,
            "engine": "extractive_fallback",
            "model": GEMINI_MODEL,
            "latency_ms": None,
            "note": f"Generation failed ({type(exc).__name__}: {exc}) — fell back to extractive.",
        }
