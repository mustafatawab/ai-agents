import { NextResponse } from "next/server";

import { API_URL } from "../../lib/backend";

/** GET /api/health — gateway ping for the header status widget. */
export async function GET() {
  const t0 = performance.now();
  try {
    const res = await fetch(`${API_URL}/api/v1/health`, { cache: "no-store" });
    const latency = Math.max(1, Math.round(performance.now() - t0));
    if (!res.ok) {
      return NextResponse.json({
        status: "degraded",
        latency,
        indexed_chunks: null,
      });
    }
    return NextResponse.json({ status: "ok", latency, ...(await res.json()) });
  } catch {
    return NextResponse.json({
      status: "unreachable",
      latency: Math.round(performance.now() - t0),
      indexed_chunks: null,
    });
  }
}
