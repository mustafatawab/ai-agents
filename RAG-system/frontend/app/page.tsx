"use client";

import Header from "./components/Header";
import SessionCard from "./components/SessionCard";
import Chat, { type ChatMessage } from "./components/Chat";
import Inspector from "./components/Inspector";
import {
  roleOf,
  runQuery,
  streamAnswer,
  type PipelineTrace,
  type Role,
  type Source,
} from "./lib/mock-engine";
import { useCallback, useRef, useState } from "react";

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
    const def = roleOf(next);
    setRole(next);
    setMessages((m) => [
      ...m,
      {
        kind: "note",
        text: `identity switched · ${def.label} · clearance L${def.clearance}`,
      },
    ]);
  };

  const send = useCallback(
    async (question: string) => {
      if (busy) return;
      setBusy(true);
      const ac = new AbortController();
      streamRef.current = ac;

      setMessages((m) => [...m, { kind: "user", text: question }]);

      const result = runQuery(question, role);
      // The payload is exposed to the inspector the moment it "hits" the index
      setTrace(result.trace);
      setBlocked(result.blockedSources);

      setMessages((m) => [
        ...m,
        {
          kind: "ai",
          text: "",
          streaming: true,
          denied: !result.allowed,
          blockedCount: result.blockedSources.length,
        },
      ]);

      let acc = "";
      for await (const token of streamAnswer(result.answer, ac.signal)) {
        acc += token;
        setReceived(result.receivedSources); // chunks "arrive" while answering
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.kind === "ai") copy[copy.length - 1] = { ...last, text: acc };
          return copy;
        });
        if (ac.signal.aborted) break;
      }
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.kind === "ai")
          copy[copy.length - 1] = { ...last, text: result.answer, streaming: false };
        return copy;
      });
      setBusy(false);
      streamRef.current = null;
    },
    [busy, role],
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
