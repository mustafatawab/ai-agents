/**
 * Mock RAG engine for demo mode.
 * Simulates a FastAPI + Qdrant pipeline: authorization-aware retrieval,
 * metadata filtering, citations, and streamed answers.
 * When the real backend lands, point the page at it and keep these types.
 */

export type Role = "Intern" | "Regular_Employee" | "HR_Manager";

export interface RoleDefinition {
  id: Role;
  label: string;
  clearance: number;
  userId: string;
  scopes: string[];
}

export const ROLES: RoleDefinition[] = [
  {
    id: "Intern",
    label: "Intern",
    clearance: 1,
    userId: "usr_8841",
    scopes: ["docs:read:public"],
  },
  {
    id: "Regular_Employee",
    label: "Regular Employee",
    clearance: 2,
    userId:
      "usr_7103",
    scopes: ["docs:read:public", "docs:read:internal"],
  },
  {
    id: "HR_Manager",
    label: "HR Manager",
    clearance: 3,
    userId: "usr_9921",
    scopes: ["docs:read:public", "docs:read:internal", "docs:read:restricted"],
  },
];

export function roleOf(role: Role): RoleDefinition {
  return ROLES.find((r) => r.id === role) ?? ROLES[0];
}

export interface Source {
  doc: string;
  section: string;
  score: number;
  snippet: string;
  minClearance: number;
}

export interface PipelineTrace {
  query: string;
  clearance: number;
  collection: string;
  filterPayload: string;
  latency: { embed: number; search: number; rank: number };
  returnedCount: number;
  rejectedCount: number;
}

export interface QueryResult {
  allowed: boolean;
  receivedSources: Source[];
  blockedSources: Source[];
  trace: PipelineTrace;
  answer: string;
}

interface CorpusEntry {
  doc: string;
  section: string;
  minClearance: number;
  keywords: string[];
  snippet: string;
}

const CORPUS: CorpusEntry[] = [
  {
    doc: "employee_handbook_2026.pdf",
    section: "§3 Onboarding & Equipment",
    minClearance: 1,
    keywords: ["handbook", "onboard", "equipment", "laptop", "slack", "vpn"],
    snippet:
      "Every new joinee receives a standard-issue laptop within the first 3 business days. Access to the #general and #company-announcements Slack channels is provisioned automatically.",
  },
  {
    doc: "employee_handbook_2026.pdf",
    section: "§6 Vacation",
    minClearance: 1,
    keywords: ["vacation", "leave", "holiday", "pto", "time off"],
    snippet:
      "Full-time employees accrue 24 days of paid vacation per calendar year. Unused days may be carried over up to a maximum of 8 days into the following year.",
  },
  {
    doc: "all_hands_minutes_q1.pdf",
    section: "Minutes — Financial Review",
    minClearance: 2,
    keywords: ["revenue", "quarterly", "financial", "arr", "earnings", "growth"],
    snippet:
      "Q1 revenue closed at $84.2M, up 11% quarter-over-quarter. The board flagged enterprise renewals in EMEA as the primary driver and raised the full-year ARR target to $390M.",
  },
  {
    doc: "all_hands_minutes_q1.pdf",
    section: "Minutes — Product Roadmap",
    minClearance: 2,
    keywords: ["roadmap", "product", "gamma", "launch", "feature"],
    snippet:
      "Project Gamma enters private beta in May with 40 design partners. GA is targeted for September, contingent on the SOC 2 Type II audit passing without major findings.",
  },
  {
    doc: "compensation_structure_2026.pdf",
    section: "§1 Executive Compensation Matrix",
    minClearance: 3,
    keywords: ["bonus", "compensation", "salary", "ceo", "executive", "targets"],
    snippet:
      "The CEO's target bonus is set at 150% of base salary, payable against three gates: (1) ARR ≥ $390M at 60% weight, (2) NPS ≥ 45 at 20%, (3) zero P0 security incidents at 20%.",
  },
  {
    doc: "compensation_structure_2026.pdf",
    section: "§2 Salary Bands",
    minClearance: 3,
    keywords: ["band", "salary", "payroll", "equity", "compensation", "comp"],
    snippet:
      "Band L5 spans $145k–$182k base with 0.05%–0.12% equity refresh. Bands above L6 are reviewed individually by the compensation committee each January and are not published.",
  },
  {
    doc: "security_incident_2025.pdf",
    section: "INC-0142 Post-Mortem",
    minClearance: 3,
    keywords: ["breach", "incident", "security", "audit", "vulnerability"],
    snippet:
      "INC-0142 involved a misconfigured S3 bucket exposing 3,112 internal support transcripts for 41 hours. Root cause: a manual IAM change bypassed peer review. Affected customers were notified within the 72-hour window.",
  },
];

const DENIED_WORDS = /\b(secret|classified|confidential|restricted|top secret)\b/i;

/** Fake but plausible embedding prefix for the trace panel. */
function fakeVector(query: string): string {
  let seed = 0;
  for (const c of query) seed = (seed * 31 + c.charCodeAt(0)) % 9973;
  const floats: string[] = [];
  for (let i = 0; i < 6; i++) {
    floats.push(((seed >> i) * 0.01321 % 1).toFixed(4));
  }
  return `[${floats.join(", ")}, …]`;
}

function buildFilterPayload(query: string, clearance: number): string {
  return [
    `qdrant.search(`,
    `    collection     = "corporate_docs",`,
    `    query_vector   = ${fakeVector(query)},`,
    `    limit          = 5,`,
    `    query_filter   = models.Filter(`,
    `        must = [`,
    `            models.FieldCondition(`,
    `                key   = "metadata.min_clearance",`,
    `                range = models.Range(lte=${clearance}),   # ${roleLabelFor(clearance)} clearance`,
    `            ),`,
    `        ],`,
    `        must_not = [`,
    `            models.FieldCondition(`,
    `                key   = "metadata.status",`,
    `                match = models.MatchAny(any=["REDACTED", "LEGAL_HOLD"]),`,
    `            ),`,
    `        ],`,
    `    ),`,
    `)`,
  ].join("\n");
}

function roleLabelFor(clearance: number): string {
  if (clearance >= 3) return "HR_Manager";
  if (clearance === 2) return "Regular_Employee";
  return "Intern";
}

function score(entry: CorpusEntry): number {
  let seed = entry.doc.length + entry.section.length;
  for (const c of entry.section) seed = (seed * 17 + c.charCodeAt(0)) % 101;
  return 0.72 + (seed / 100 % 0.26);
}

function citations(sources: Source[], base: string): string {
  return base.replace(/\[\[(\d+)\]\]/g, (_, i) => `[${Number(i) + 1}]`) + (sources.length ? "\n\nCited: " + sources.map((s, i) => `[${i + 1}] ${s.doc}`).join("  ·  ") : "");
}

/** Simulate one full RAG turn. */
export function runQuery(question: string, role: Role): QueryResult {
  const def = roleOf(role);
  const q = question.toLowerCase();
  const matched = CORPUS.filter((e) => e.keywords.some((k) => q.includes(k)));

  // Fallback: only matches the objective itself, likely low relevance public doc
  if (matched.length === 0) {
    if (DENIED_WORDS.test(q) || q.includes("ceo") || q.includes("breach")) {
      // Their intent targets restricted material but never matched returned docs
      const restricted = CORPUS.filter((e) => e.minClearance > def.clearance);
      const blocked: Source[] = restricted.slice(0, 2).map((e) => ({
        doc: e.doc,
        section: e.section,
        score: score(e),
        snippet: "",
        minClearance: e.minClearance,
      }));
      return {
        allowed: false,
        receivedSources: [],
        blockedSources: blocked,
        trace: {
          query: question,
          clearance: def.clearance,
          collection: "corporate_docs",
          filterPayload: buildFilterPayload(question, def.clearance),
          latency: { embed: 62, search: 18, rank: 7 },
          returnedCount: 0,
          rejectedCount: blocked.length,
        },
        answer:
          "I can’t let that through. The documents you’re reaching for carry a minimum clearance above your role’s level, so they were withheld **at the database layer** — nothing left the index. Your filter rejected them before the LLM ever saw a single token.\n\nTry rephrasing, or switch to a higher-clearance identity in the session panel to see these unlock.",
      };
    }
    return {
      allowed: false,
      receivedSources: [],
      blockedSources: [],
      trace: {
        query: question,
        clearance: def.clearance,
        collection: "corporate_docs",
        filterPayload: buildFilterPayload(question, def.clearance),
        latency: { embed: 58, search: 14, rank: 5 },
        returnedCount: 0,
        rejectedCount: 0,
      },
      answer:
        "Nothing in the vector store matched that. Try asking about — vacation policy, salary bands, the CEO bonus, the Q1 all-hands, Project Gamma, or INC-0142 (the 2025 security incident).",
    };
  }

  const authorized = matched.filter((e) => e.minClearance <= def.clearance);
  const rejected = matched.filter((e) => e.minClearance > def.clearance);

  if (authorized.length === 0) {
    const blocked: Source[] = rejected.map((e) => ({
      doc: e.doc,
      section: e.section,
      score: score(e),
      snippet: "",
      minClearance: e.minClearance,
    }));
    return {
      allowed: false,
      receivedSources: [],
      blockedSources: blocked,
      trace: {
        query: question,
        clearance: def.clearance,
        collection: "corporate_docs",
        filterPayload: buildFilterPayload(question, def.clearance),
        latency: { embed: 61, search: 20, rank: 6 },
        returnedCount: 0,
        rejectedCount: blocked.length,
      },
      answer:
        "I can’t let that through. The matching chunks sit behind a clearance you don’t carry, so they were withheld **at the database layer** — nothing left the index. Your filter rejected them before the LLM ever saw a single token.\n\nSwitch your identity to HR_Manager in the session panel and this question goes straight through.",
    };
  }

  // Deny mixed content if some of the source chunks can't be served
  const allowed = authorized.slice(0, 3);
  const sources: Source[] = allowed.map((e) => ({
    doc: e.doc,
    section: e.section,
    score: score(e),
    snippet: e.snippet,
    minClearance: e.minClearance,
  }));

  // Compose an answer from the top chunk(s)
  const primary = allowed[0];
  const secondary = allowed[1];
  let base: string;
  if (secondary) {
    base = `Here’s what the archive returned: ${primary.snippet} [[1]] The same file also notes — “${secondary.snippet}” [[2]] Retrieved under a min_clearance ≤ ${def.clearance} filter, so every one of these chunks your ${def.label} identity is entitled to read.`;
  } else {
    base = `Here’s what the archive returned: ${primary.snippet} [[1]] Retrieved under a min_clearance ≤ ${def.clearance} filter, so this chunk your ${def.label} identity is entitled to read.`;
  }

  return {
    allowed: true,
    receivedSources: sources,
    blockedSources: rejected.length
      ? rejected.map((e) => ({
          doc: e.doc,
          section: e.section,
          score: score(e),
          snippet: "",
          minClearance: e.minClearance,
        }))
      : [],
    trace: {
      query: question,
      clearance: def.clearance,
      collection: "corporate_docs",
      filterPayload: buildFilterPayload(question, def.clearance),
      latency: { embed: 59, search: 16, rank: 6 },
      returnedCount: sources.length,
      rejectedCount: rejected.length,
    },
    answer: citations(sources, base),
  };
}

/** Stream an answer word by word, like an LLM would. */
export async function* streamAnswer(
  text: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const tokens = text.split(/(\s+)/);
  for (const token of tokens) {
    if (signal?.aborted) return;
    await new Promise((r) => setTimeout(r, 14 + Math.random() * 26));
    yield token;
  }
}
