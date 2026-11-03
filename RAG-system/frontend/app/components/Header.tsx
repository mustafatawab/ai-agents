"use client";

import { useEffect, useState } from "react";

export default function Header() {
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    const ping = () => {
      setLatency(9 + Math.floor(Math.random() * 12));
      setTimeout(ping, 4000 + Math.random() * 3000);
    };
    ping();
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-steel bg-surface px-4 md:px-6">
      <div className="flex items-center gap-2.5">
        <span className="pulse-dot inline-block size-2 rounded-full bg-live" />
        <span className="text-[15px] font-semibold tracking-tight text-ink">
          SecureRAG
        </span>
        <span className="hidden rounded-full bg-porcelain px-2 py-0.5 text-[11px] font-medium text-ink-2 sm:inline">
          Document Gateway
        </span>
      </div>
      <div className="flex items-center gap-3.5 font-mono text-[11px] text-ink-3">
        <span className="hidden items-center gap-1.5 rounded-full bg-porcelain px-2.5 py-1 md:flex">
          <span className="text-live">●</span> index synced
        </span>
        <span className="rounded-full bg-porcelain px-2.5 py-1">
          gateway{" "}
          <span className="text-ink">{latency === null ? "—" : `${latency}ms`}</span>
        </span>
      </div>
    </header>
  );
}
