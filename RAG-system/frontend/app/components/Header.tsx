"use client";

import { useEffect, useState } from "react";

/** Header status probes the real gateway health through the Next proxy. */
export default function Header() {
  const [status, setStatus] = useState<{
    up: boolean;
    latency: number | null;
    indexed: number | null;
    model: string | null;
  }>({ up: false, latency: null, indexed: null, model: null });

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) {
          setStatus({
            up: data.status === "ok",
            latency: data.latency,
            indexed: data.indexed_chunks,
            model: data.llm_model ?? null,
          });
        }
      } catch {
        if (!cancelled) setStatus((s) => ({ ...s, up: false }));
      }
    };
    ping();
    const id = setInterval(ping, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-steel bg-surface px-4 md:px-6">
      <div className="flex items-center gap-2.5">
        <span
          className={`inline-block size-2 rounded-full ${
            status.up ? "bg-live" : "bg-deny"
          }`}
          style={
            status.up
              ? { boxShadow: "0 0 0 0 rgba(22,163,74,.55)", animation: "pulse-dot 2.4s ease-out infinite" }
              : undefined
          }
        />
        <span className="text-[15px] font-semibold tracking-tight text-ink">
          SecureRAG
        </span>
        <span className="hidden rounded-full bg-porcelain px-2 py-0.5 text-[11px] font-medium text-ink-2 sm:inline">
          Document Gateway
        </span>
      </div>
      <div className="flex items-center gap-3.5 font-mono text-[11px] text-ink-3">
        <span className="hidden items-center gap-1.5 rounded-full bg-porcelain px-2.5 py-1 md:flex">
          {status.up ? (
            <>
              <span className="text-live">●</span>
              <span className="text-ink">{status.model ?? "extractive fallback"}</span>
            </>
          ) : (
            <span className="text-deny">gateway offline — start backend</span>
          )}
        </span>
        <span className="rounded-full bg-porcelain px-2.5 py-1">
          gateway{" "}
          <span className="text-ink">
            {status.latency === null ? "—" : `${status.latency}ms`}
          </span>
        </span>
      </div>
    </header>
  );
}
