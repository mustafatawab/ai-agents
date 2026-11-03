"use client";

import Header from "./components/Header";
import SessionCard from "./components/SessionCard";
import Chat, { type ChatMessage } from "./components/Chat";
import Inspector from "./components/Inspector";
import type { PipelineTrace, Role, Source } from "./lib/mock-engine";
import { useCallback, useRef, useState } from "react";

/** Types of the payload produced by backend/app/api/v1/query.py (via the proxy). */
interface GatewaySource {
  rank: number;
  filename: string;
  section: string;
  score: number;
  min_clearance: number;
  snippet: string;
}

interface GatewayResponse {
  query: string;
  role: string;
  clearance: number;
  allowed: boolean;
  answer: string;
  sources: GatewaySource[];
  withheld: { filename: string; min_clearance: number }[];
  pipeline: {
    collection: string;
    filter: Record<string, unknown>;
    returned: number;
    withheld_files: number;
    indexed_chunks: number;
    latency_ms: { retrieval: number; generation: number | null };
  };
  generation: {
    engine: string;
    model: string | null;
    latency_ms: number | null;
    note: string | null;
  };
  prompt_payload: { messages: unknown[]; context_used: number };
}

interface ErrorResponse {
  error: string;
  message: string;
}

function renderPayload(resp: GatewayResponse): string {
  return [
    `gateway.secure_retrieve(`,
    `    collection     = "${resp.pipeline.collection}",`,
    `    query          = ${JSON.stringify(resp.query.length > 60 ? resp.query.slice(0, 57) + "..." : resp.query)},`,
    `    where          = ${JSON.stringify(resp.pipeline.filter)},`,
    `    resolved_from  = X-User-Role: ${resp.role} → clearance ${resp.clearance}`,
    `)`,
    `# returned=${resp.pipeline.returned}  withheld_files=${resp.pipeline.withheld_files}  indexed=${resp.pipeline.indexed_chunks}`,
    `# retrieval=${resp.pipeline.latency_ms.retrieval}ms  answered_by=${resp.generation.model ?? "extractive"}  generation=${resp.generation.latency_ms ?? "-"}ms`,
  ].join("\n");
}

export default function Home() {
  const [role, setRole] = useState<Role>("Regular_Employee");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [trace, setTrace] = useState<PipelineTrace | null>(null);
  const [received, setReceived] = useState<Source[]>([]);
  const [blocked, setBlocked] = useState<Source[]>([]);
  const [busy, setBusy] = useState(false);
  const streamRef = useRef<AbortController | null>(null);

  const switchRole = (next: Role) => {
    if (next === role) return;
    setRole(next);
    setMessages((m) => [
      ...m,
      { kind: "note", text: `identity switched · ${next} (new queries route as ${next})` },
    ]);
  };

  /** Streams an already-complete answer so the client feels like an LLM. */
  const streamClientSide = async (
    full: string,
    msgIndex: number,
    signal: AbortSignal,
  ) => {
    const tokens = full.split(/(\s+)/);
    let acc = "";
    for (const token of tokens) {
      if (signal.aborted) return;
      acc += token;
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 18));
      setMessages((m) => {
        const copy = [...m];
        const msg = copy[msgIndex];
        if (msg?.kind === "ai") copy[msgIndex] = { ...msg, text: acc };
        return copy;
      });
    }
  };

  const send = useCallback(
    async (question: string) => {
      if (busy) return;
      setBusy(true);
      const ac = new AbortController();
      streamRef.current = ac;

      setMessages((m) => [...m, { kind: "user", text: question }]);

      const aiIndex = messages.length + 1; // index of the assistant msg we append next
      setMessages((m) => [
        ...m,
        { kind: "ai", text: "", streaming: true, denied: false },
      ]);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: question, role }),
          signal: ac.signal,
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as ErrorResponse | null;
          throw new Error(err?.message ?? `Gateway error (${res.status})`);
        }

        const data = (await res.json()) as GatewayResponse;

        // Inspector sees the payload the moment it "hits" the database
        setTrace({
          query: data.query,
          clearance: data.clearance,
          collection: data.pipeline.collection,
          filterPayload: renderPayload(data),
          latency: {
            embed: 0,
            search: data.pipeline.latency_ms.retrieval,
            rank: 0,
          },
          returnedCount: data.pipeline.returned,
          rejectedCount: data.pipeline.withheld_files,
        });
        const mappedReceived: Source[] = data.sources.map((s) => ({
          doc: s.filename,
          section: s.section || "untitled section",
          score: s.score,
          snippet: s.snippet,
          minClearance: s.min_clearance,
        }));
        const mappedBlocked: Source[] = data.withheld.map((w) => ({
          doc: w.filename,
          section: "chunks withheld — text never left the index",
          score: 0,
          snippet: "",
          minClearance: w.min_clearance,
        }));
        setReceived(mappedReceived);
        setBlocked(mappedBlocked);

        setMessages((m) => {
          const copy = [...m];
          const msg = copy[aiIndex];
          if (msg?.kind === "ai")
            copy[aiIndex] = { ...msg, denied: !data.allowed, blockedCount: mappedBlocked.length };
          return copy;
        });

        await streamClientSide(data.answer, aiIndex, ac.signal);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setMessages((m) => {
          const copy = [...m];
          if (copy[copy.length - 1]?.kind === "ai") copy.pop();
          return [
            ...copy,
            {
              kind: "ai",
              streaming: false,
              text:
                `The gateway rejected that turn. **${(e as Error).message}**\n\n` +
                "Check that the FastAPI backend is running — `uv run uvicorn app.main:app --reload` — and that the index was built once with the ingestion script.",
            },
          ];
        });
      } finally {
        setBusy(false);
        streamRef.current = null;
      }
    },
    [busy, role, messages.length],
  );

  return (
    <div className="flex h-dvh flex-col">
      <Header />
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col border-r border-steel bg-porcelain lg:w-[58%] lg:flex-none">
          <SessionCard role={role} onChange={switchRole} />
          <Chat messages={messages} onSend={send} busy={busy} />
        </div>
        <Inspector role={role} trace={trace} received={received} blocked={blocked} />
      </main>
    </div>
  );
}
