import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/chat — server-side proxy to the FastAPI gateway.
 *
 * The chat panel sends { query, role }. This handler is the ONLY place the
 * simulated identity becomes a header — the browser never talks to FastAPI
 * directly, so it cannot inject arbitrary identity headers or clearances.
 * FastAPI's role resolver maps X-User-Role -> clearance from acl_manifest.
 */

const ROLES = ["Intern", "Regular_Employee", "HR_Manager"] as const;
type Role = (typeof ROLES)[number];

import { API_URL } from "../../lib/backend";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "Body must be JSON." },
      { status: 400 },
    );
  }

  const { query, role, userId } = (body ?? {}) as {
    query?: string;
    role?: string;
    userId?: string;
  };

  if (!query || typeof query !== "string" || query.trim().length < 2) {
    return NextResponse.json(
      { error: "bad_request", message: "`query` must be at least 2 characters." },
      { status: 400 },
    );
  }
  if (!role || !ROLES.includes(role as Role)) {
    return NextResponse.json(
      {
        error: "bad_request",
        message: `Role must be one of: ${ROLES.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/api/v1/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The secure identity headers — stamped here, server-side only.
        "X-User-Role": role,
        ...(userId ? { "X-User-Id": userId } : {}),
      },
      body: JSON.stringify({ query: query.trim() }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      {
        error: "backend_unreachable",
        message: `FastAPI gateway is not reachable at ${API_URL}. Start it with: uv run uvicorn app.main:app --reload`,
      },
      { status: 502 },
    );
  }

  const data = (await upstream.json()) as Record<string, unknown>;

  if (!upstream.ok) {
    return NextResponse.json(
      { error: data?.error ?? "upstream_error", message: data?.detail ?? "Gateway rejected the query.", upstream: data },
      { status: upstream.status },
    );
  }

  return NextResponse.json(data, { status: 200 });
}
