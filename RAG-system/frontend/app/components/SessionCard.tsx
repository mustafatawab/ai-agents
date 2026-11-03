"use client";

import { ROLES, type Role, type RoleDefinition } from "../lib/mock-engine";

interface Props {
  role: Role;
  onChange: (role: Role) => void;
}

export default function SessionCard({ role, onChange }: Props) {
  const def = ROLES.find((r) => r.id === role) ?? ROLES[0];

  return (
    <section className="border-b border-steel bg-surface px-4 py-5 lift-sm md:px-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold tracking-tight text-ink">
          Active identity
        </h2>
        <span className="font-mono text-[11px] text-ink-3">
          User {def.userId}
        </span>
      </div>

      <div
        className="grid grid-cols-3 gap-1 rounded-xl bg-porcelain p-1"
        role="group"
        aria-label="Switch identity"
      >
        {ROLES.map((r) => (
          <RoleSegment
            key={r.id}
            def={r}
            active={r.id === role}
            onClick={() => onChange(r.id)}
          />
        ))}
      </div>

      <dl className="mt-3.5 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px]">
        <div className="flex gap-2.5">
          <dt className="text-ink-3">user_id</dt>
          <dd className="text-ink">{def.userId}</dd>
        </div>
        <div className="flex gap-2.5">
          <dt className="text-ink-3">clearance</dt>
          <dd className="text-ocean">L{def.clearance}</dd>
        </div>
        <div className="flex gap-2.5">
          <dt className="text-ink-3">scopes</dt>
          <dd className="text-ink-2">{def.scopes.join("  ")}</dd>
        </div>
      </dl>
    </section>
  );
}

function RoleSegment({
  def,
  active,
  onClick,
}: {
  def: RoleDefinition;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-3 py-2 text-left transition-all duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean ${
        active
          ? "bg-surface text-ink lift-sm"
          : "text-ink-2 hover:text-ink"
      }`}
    >
      <span
        className={`block text-[13px] font-medium tracking-tight ${
          active ? "text-ink" : "text-ink-2"
        }`}
      >
        {def.label}
      </span>
      <span
        className={`mt-0.5 block text-[11px] font-medium ${
          active ? "text-ocean" : "text-ink-3"
        }`}
      >
        L{def.clearance}
      </span>
    </button>
  );
}
