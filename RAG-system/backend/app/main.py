"""FastAPI application for the SecureRAG gateway."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.v1.query import router as query_router

app = FastAPI(
    title="SecureRAG Gateway",
    description="Authorization-aware retrieval — clearance filters enforced at the vector database layer.",
    version="0.1.0",
)

# The Next.js route-handler proxy runs server-side, so CORS is only needed for
# direct browser calls (dev tools, curl pages).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["X-User-Role", "X-User-Id", "Content-Type"],
)

app.include_router(query_router)
