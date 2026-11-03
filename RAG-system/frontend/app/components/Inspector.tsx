"use client";

import { useEffect, useState } from "react";
import {
  ROLES,
  type Role,
  type PipelineTrace,
  type Source,
} from "../lib/mock-engine";

type Tab = "jwt" | "pipeline" | "context";

const TABS: { id: Tab; label: string }[] = [
  { id: "jwt", label: "Security token" },
  { id: "pipeline", label: "Query pipeline" },
  { id: "context", label: "Retrieved context" },
];

export default function Inspector({
  role,
  trace,
  received,
  blocked,
}: {
  role: Role;
  trace: PipelineTrace | null;
  received: Source[];
  blocked: Source[];
}) {
  const [tab, setTab] = useState<Tab>("jwt");
  const def = ROLES.find((r) => r.id === role) ?? ROLES[0];

  return (
    <aside className="flex min-h-0 flex-1 flex-col bg-vault vault-grid">
      <nav className="flex shrink-0 border-b border-vault-edge bg-vault" role="tablist">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`relative flex-1 px-2 py-3 text-[12px] font-medium tracking-tight transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5ac8d5] ${
              tab === t.id
                ? "text-[#eaf4f7]"
                : "text-vault-mist hover:text-[#c5d5de]"
            }`}
          >
            {t.label}
            {tab === t.id && (
              <span className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-[#5ac8d5]" />
            )}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">{tab === "jwt" && <JwtTab def={def} />}{tab === "pipeline" && <PipelineTab trace={trace} />}{tab === "context" && <ContextTab received={received} blocked={blocked} />}</div>
    </aside>
  );
}

function PanelTitle({ children }: { children: string }) {
  return (
    <h3 className="mb-3.5 font-mono text-[11px] font-medium text-vault-mist">
      {children}
    </h3>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-vault-edge bg-black/40 p-4 font-mono text-[12px] leading-relaxed shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      {highlight(children)}
    </pre>
  );
}

/** Light syntax tinting for the payload blocks. */
function highlight(code: string) {
  const keyRe = /("[^"]*"|\b[a-zA-Z_][\w]*(?=\s*=)|\bmodels\.\w+|\b\d+(\.\d+)?\b)/g;
  return code.split("\n").map((line, i) => (
    <div key={i} className="flex">
      <span className="w-6 shrink-0 select-none pr-3 text-right text-vault-edge">
        {i + 1}
      </span>
      <span className="whitespace-pre text-[#9db4c2]">
        {line.split(/(#.*$)/g).map((seg, j) =>
          seg.startsWith("#") ? (
            <span key={j} className="italic text-vault-mist/70">
              {seg}
            </span>
          ) : (
            <span key={j}>
              {seg.split(keyRe).map((tk, k) => {
                if (/^"/.test(tk) || /^[0-9.]+$/.test(tk))
                  return (
                    <span key={k} className="text-[#e2b356]">
                      {tk}
                    </span>
                  );
                if (tk?.startsWith("models.") || tk === "qdrant.search")
                  return (
                    <span key={k} className="text-[#5ac8d5]">
                      {tk}
                    </span>
                  );
                if (/^(lte|range|match|must|must_not|key)$/.test(tk))
                  return (
                    <span key={k} className="text-[#8fc7f0]">
                      {tk}
                    </span>
                  );
                return <span key={k}>{tk}</span>;
              })}
            </span>
          ),
        )}
      </span>
    </div>
  ));
}

function JwtTab({
  def,
}: {
  def: { clearance: number; scopes: string[]; label: string; userId: string; id: Role };
}) {
  const [iat, setIat] = useState<number | null>(null);
  useEffect(() => {
    if (iat === null) setIat(Math.floor(Date.now() / 1000));
  }, [iat]);

  const payload = {
    sub: def.userId,
    role: def.id,
    clearance_level: def.clearance,
    scopes: def.scopes,
    iss: "secureraggateway",
    iat,
  };
  const json = JSON.stringify(payload, null, 2);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <PanelTitle>Signed claims</PanelTitle>
        <span className="rounded-full border border-[#2a5c3f] bg-[#12331f]/60 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-[#5bd98a]">
          Verified
        </span>
      </div>
      <CodeBlock>{json}</CodeBlock>
      <p className="mt-4 text-xs leading-relaxed text-vault-mist">
        Switch identity on the left and this token is re-issued. Every
        downstream check in the gateway reads only{" "}
        <span className="font-mono text-[#e2b356]">clearance_level</span> — the
        role string is advisory, the number is the authority.
      </p>
    </div>
  );
}

function PipelineTab({ trace }: { trace: PipelineTrace | null }) {
  if (!trace) {
    return (
      <div className="rounded-xl border border-dashed border-vault-edge px-6 py-12 text-center">
        <p className="text-sm leading-relaxed text-vault-mist">
          This pane stays empty until your first query. Then it renders the
          literal payload the gateway sends to the vector store.
        </p>
      </div>
    );
  }
  return (
    <div>
      <PanelTitle>Payload — FastAPI to Qdrant</PanelTitle>
      <CodeBlock>{trace.filterPayload}</CodeBlock>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2.5 font-mono text-[11px]">
        {[
          ["query", `"${trace.query.length > 30 ? trace.query.slice(0, 30) + "…" : trace.query}"`],
          ["collection", trace.collection],
          ["embed", `${trace.latency.embed}ms`],
          ["vector search", `${trace.latency.search}ms`],
          ["rerank", `${trace.latency.rank}ms`],
          ["chunks returned", String(trace.returnedCount)],
          ["chunks rejected", String(trace.rejectedCount)],
          ["gated at", "the database layer"],
        ].map(([k, v], i) => (
          <div
            key={i}
            className="flex items-baseline justify-between gap-2 border-b border-vault-edge/70 pb-2"
          >
            <dt className="text-vault-mist">{k}</dt>
            <dd className="truncate text-right text-[#d5e2ea]">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ContextTab({
  received,
  blocked,
}: {
  received: Source[];
  blocked: Source[];
}) {
  const [open, setOpen] = useState<number | null>(0);

  if (received.length === 0 && blocked.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-vault-edge px-6 py-12 text-center">
        <p className="text-sm leading-relaxed text-vault-mist">
          No chunks in flight yet. Ask the archive on the left, and every piece
          of text handed to the model appears here first.
        </p>
      </div>
    );
  }

  if (received.length === 0 && blocked.length > 0) {
    return (
      <div>
        <div className="mb-5 flex items-center justify-between">
          <PanelTitle>Chunks withheld</PanelTitle>
          <span className="rounded-full bg-deny px-2.5 py-1 text-[11px] font-semibold tracking-tight text-white">
            Access denied
          </span>
        </div>
        <div className="flex flex-col gap-2.5">
          {blocked.map((s, i) => (
            <div
              key={i}
              className="deny-anim rounded-xl border border-deny/40 bg-deny/10 p-4"
            >
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="text-[#e6d6d3]">{s.doc}</span>
                <span className="text-deny">L{s.minClearance} required</span>
              </div>
              <div className="mt-3 space-y-2">
                <div className="h-2.5 rounded bg-black/50" />
                <div className="h-2.5 w-[82%] rounded bg-black/50" />
                <div className="h-2.5 w-[64%] rounded bg-black/50" />
              </div>
              <p className="mt-3 font-mono text-[10px] text-vault-mist">
                exists in index, filtered out before context assembly
              </p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-xs leading-relaxed text-vault-mist">
          The anatomy of the leak-proofing: these chunks were matched by
          meaning, then discarded by the clearance predicate — the model was
          never handed them, so it cannot speak them.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <PanelTitle>Chunks in context window</PanelTitle>
        <span className="font-mono text-[11px] text-vault-mist">
          {received.length} of {received.length + blocked.length}
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        {received.map((s, i) => {
          const isOpen = open === i;
          return (
            <div
              key={i}
              className={`overflow-hidden rounded-xl border transition-colors ${
                isOpen
                  ? "border-[#33484f] bg-vault-panel"
                  : "border-vault-edge bg-vault-panel/60 hover:border-[#2c3e46]"
              }`}
            >
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5ac8d5]"
              >
                <span className="font-mono text-[10px] text-vault-mist">
                  [{i + 1}]
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-[#d5e2ea]">
                    {s.doc}
                  </p>
                  <p className="truncate font-mono text-[10px] text-vault-mist">
                    {s.section}
                  </p>
                </div>
                <span className="rounded-full bg-[#15333a] px-2 py-0.5 font-mono text-[11px] text-[#5ac8d5]">
                  {s.score.toFixed(2)}
                </span>
                <span
                  aria-hidden="true"
                  className={`text-vault-mist transition-transform ${isOpen ? "rotate-90" : ""}`}
                >
                  ›
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-vault-edge px-4 py-3.5">
                  <p className="rounded-lg bg-black/40 p-3.5 text-[13px] leading-relaxed text-[#c3d3dd]">
                    “{s.snippet}”
                  </p>
                  <p className="mt-2.5 font-mono text-[10px] text-vault-mist">
                    min_clearance={s.minClearance} • passed predicate • handed to model context
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {blocked.length > 0 && (
        <p className="mt-4 font-mono text-[11px] text-deny">
          + {blocked.length} additional match{blocked.length === 1 ? "" : "es"} rejected by the clearance filter
        </p>
      )}
    </div>
  );
}
