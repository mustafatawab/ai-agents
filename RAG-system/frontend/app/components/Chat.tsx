"use client";

import { useEffect, useRef } from "react";

export interface ChatMessage {
  kind: "user" | "ai" | "note";
  text: string;
  streaming?: boolean;
  denied?: boolean;
  blockedCount?: number;
}

/** Renders **bold** and keeps everything else verbatim. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default function Chat({
  messages,
  onSend,
  busy,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  busy: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-porcelain">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
        {messages.length === 0 && (
          <div className="mx-auto max-w-md pt-14 text-center">
            <p className="text-lg font-medium leading-relaxed tracking-tight text-ink">
              Ask the archive anything it holds
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-2">
              Vacation policy, the Q1 all-hands, Project Gamma, salary bands —
              what your identity isn’t cleared to read, the database itself
              refuses before the model ever sees a token.
            </p>
          </div>
        )}

        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          {messages.map((m, i) => (
            <Message key={i} m={m} />
          ))}
          <div ref={endRef} />
        </div>
      </div>

      <form
        className="shrink-0 bg-porcelain px-4 pb-5 pt-2 md:px-8"
        onSubmit={(e) => {
          e.preventDefault();
          const input = (e.currentTarget.elements.namedItem("q") as HTMLInputElement);
          if (input.value.trim()) {
            onSend(input.value.trim());
            input.value = "";
          }
        }}
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl bg-surface p-1.5 lift-md ring-1 ring-steel focus-within:ring-2 focus-within:ring-ocean/50">
          <input
            name="q"
            autoComplete="off"
            disabled={busy}
            placeholder={busy ? "Retrieving from index…" : "Query the archive…"}
            className="h-9 w-full rounded-xl bg-transparent px-3.5 text-sm text-ink placeholder:text-ink-3 focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy}
            aria-label="Send query"
            className="flex h-9 w-11 shrink-0 items-center justify-center rounded-xl bg-ocean text-white text-sm transition-colors hover:bg-ocean-deep focus-visible:outline-2 focus-visible:outline-ocean disabled:opacity-40 disabled:hover:bg-ocean"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M3.2 2.1a.7.7 0 0 1 1.05-.61l9.4 5.2a.7.7 0 0 1 0 1.22l-9.4 5.2a.7.7 0 0 1-1.05-.61V2.1Z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}

function Message({ m }: { m: ChatMessage }) {
  if (m.kind === "user") {
    return (
      <div className="flex justify-end">
        <p className="rise max-w-[85%] rounded-2xl rounded-br-md bg-ocean px-4 py-3 text-sm leading-relaxed text-white lift-sm">
          {m.text}
        </p>
      </div>
    );
  }

  if (m.kind === "note") {
    return (
      <p className="text-center font-mono text-[11px] text-ink-3">
        {m.text}
      </p>
    );
  }

  if (m.denied) {
    return (
      <div className="deny-anim max-w-[92%] self-start rounded-2xl rounded-bl-md deny-shell p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="deny-chip rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-tight">
            Access denied
          </span>
          <span className="font-mono text-[11px] text-ink-3">
            {m.blockedCount ?? 0} chunk{(m.blockedCount ?? 0) === 1 ? "" : "s"} withheld at the index
          </span>
        </div>
        <p
          className={`text-sm leading-relaxed text-ink ${
            m.streaming ? "caret" : ""
          }`}
        >
          <RichText text={m.text} />
        </p>
      </div>
    );
  }

  return (
    <div
      className={`rise max-w-[92%] self-start rounded-2xl rounded-bl-md bg-surface px-5 py-4 text-sm leading-relaxed text-ink lift-sm ${
        m.streaming ? "caret" : ""
      }`}
    >
      <RichText text={m.text} />
    </div>
  );
}
