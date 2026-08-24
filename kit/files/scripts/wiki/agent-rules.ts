import type { Finding } from "./model";

/** Version of the machine-readable managed AGENTS contract. */
export const AGENT_RULES_VERSION = 2 as const;
export const AGENT_MANAGED_START = "<!-- wiki-ssot:managed:start -->";
export const AGENT_MANAGED_END = "<!-- wiki-ssot:managed:end -->";
export const AGENT_VERSION_MARKER = "<!-- wiki-ssot:managed:version=2 -->";

export type AgentRuleId =
  | "authority-current-pages"
  | "work-discovery"
  | "context-first"
  | "source-read-order"
  | "change-and-generated-checks"
  | "review-exact-head"
  | "conflict-resolution"
  | "human-work-guardrail"
  | "git-safety";

/**
 * The managed block is rendered from typed rule records.  Statements are
 * intentionally structured as a list so a host's surrounding prose is never
 * interpreted as policy by a regular-expression sentence parser.
 */
export type ManagedAgentRule = {
  id: AgentRuleId;
  heading: string;
  statements: readonly string[];
};

export const MANAGED_AGENT_RULES: readonly ManagedAgentRule[] = [
  {
    id: "authority-current-pages",
    heading: "Wiki SSOT authority",
    statements: [
      "Start at wiki/index.md, then read wiki/current-status.md and every current kind: invariant page before editing.",
      "Current pages linked from wiki/index.md define current product intent, architecture, contracts, invariants, and operations.",
      "Code, tests, schemas, and migrations are implementation evidence; record a conflict when evidence and current wiki disagree.",
      "Proposed, conflicted, deprecated, and archived pages are not current behavior.",
    ],
  },
  {
    id: "work-discovery",
    heading: "Work discovery",
    statements: [
      "For an unspecified remaining-work request, run bun run wiki:work before selecting a work item.",
      "After selecting an item, run its printed bun run wiki:context -- --work <ID> command.",
      "Dependency derivation happens before executor filtering, and human-only work is never auto-selected.",
    ],
  },
  {
    id: "context-first",
    heading: "Topic context",
    statements: [
      "Start a named topic with bun run wiki:context -- \"<task terms>\".",
      "bun run wiki:search remains available for optional manual exploration and is not a required prerequisite.",
    ],
  },
  {
    id: "source-read-order",
    heading: "Source evidence",
    statements: [
      "Read affected current pages and their context: always sources directly; expand context: catalog sources when the task or evidence requires them.",
      "Do not rely on a compact wiki summary as a substitute for the listed implementation evidence.",
      "For a broad repository-wide Wiki/code synchronization request, run bun run wiki:reconcile and complete every returned current page.",
      "Never mass-verify before semantic reconciliation; update clear code-observed contracts and open conflicts for ambiguity instead of inventing a decision.",
    ],
  },
  {
    id: "change-and-generated-checks",
    heading: "Change and generated checks",
    statements: [
      "Change wiki, implementation, and tests together when behavior or intent changes.",
      "Regenerate deterministic artifacts, then run the canonical lint, impact, typecheck, and relevant tests.",
    ],
  },
  {
    id: "review-exact-head",
    heading: "Exact revision review",
    statements: [
      "Commit the candidate before review so metadata, sources, report, and bundle bind one exact HEAD.",
      "Run bun run wiki:review-preflight before the canonical local check and independent review.",
      "A required review is independent SSOT reconciliation; the authoring session never marks its own work PASS.",
      "Run wiki:check and publish its exact result through the wiki-ssot/local status boundary.",
      "Detailed workflow and migration steps live in wiki/WORKFLOW.md.",
    ],
  },
  {
    id: "conflict-resolution",
    heading: "Conflict and schema safety",
    statements: [
      "Follow wiki/SCHEMA.md and keep stable IDs path-independent.",
      "A missing or ambiguous product decision is an open conflict, not permission to invent behavior.",
      "Never resolve an open decision conflict without an explicit owner decision.",
    ],
  },
  {
    id: "human-work-guardrail",
    heading: "Human work guardrail",
    statements: [
      "Do not automatically select executor: human work.",
      "Report the required procedure and hand it off to a human without assuming credentials, authority, or permissions.",
    ],
  },
  {
    id: "git-safety",
    heading: "Git and safety",
    statements: [
      "Work on a feature branch and preserve unrelated changes.",
      "Do not bypass checks or use destructive Git operations to make a change appear valid.",
    ],
  },
] as const;

export const REQUIRED_AGENT_RULE_IDS: readonly AgentRuleId[] = MANAGED_AGENT_RULES.map((rule) => rule.id);

function ruleMarker(id: string): string {
  return `<!-- wiki-ssot:rule id=${id} -->`;
}

/** Render the canonical managed AGENTS payload from typed rules. */
export function renderManagedAgentBlock(rules: readonly ManagedAgentRule[] = MANAGED_AGENT_RULES): string {
  const lines = [AGENT_MANAGED_START, AGENT_VERSION_MARKER];
  for (const rule of rules) {
    lines.push(ruleMarker(rule.id), `## ${rule.heading}`, "", ...rule.statements.map((statement) => `- ${statement}`), "");
  }
  lines.push(AGENT_MANAGED_END);
  return `${lines.join("\n").trimEnd()}\n`;
}

function finding(code: string, message: string, severity: Finding["severity"] = "error"): Finding {
  return { code, message, path: "AGENTS.md", severity };
}

function managedRegion(raw: string): { block?: string; findings: Finding[] } {
  const starts = raw.split(AGENT_MANAGED_START).length - 1;
  const ends = raw.split(AGENT_MANAGED_END).length - 1;
  const start = raw.indexOf(AGENT_MANAGED_START);
  const end = raw.indexOf(AGENT_MANAGED_END, start + AGENT_MANAGED_START.length);
  if (starts !== 1 || ends !== 1 || start < 0 || end < start) {
    return { findings: [finding("agent-managed-structure", "AGENTS.md must contain exactly one ordered managed start/end marker")] };
  }
  return { block: raw.slice(start, end + AGENT_MANAGED_END.length), findings: [] };
}

/** Validate only the typed managed block; host prose outside it is ignored. */
export function validateManagedAgentRules(raw: string, rules: readonly ManagedAgentRule[] = MANAGED_AGENT_RULES): Finding[] {
  const region = managedRegion(raw);
  if (!region.block) return region.findings;
  const block = region.block;
  const findings: Finding[] = [];
  const versionMarkers = block.split(AGENT_VERSION_MARKER).length - 1;
  if (versionMarkers !== 1) findings.push(finding("agent-managed-version", `AGENTS.md must contain exactly one managed rules version marker (${AGENT_RULES_VERSION})`));
  const markerPattern = /^<!-- wiki-ssot:rule id=([a-z0-9-]+) -->$/gm;
  const ids = [...block.matchAll(markerPattern)].map((match) => match[1]);
  const expected = new Set(rules.map((rule) => rule.id));
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) findings.push(finding("agent-managed-rule-duplicate", `managed AGENTS rule ID is duplicated: ${id}`));
    seen.add(id);
    if (!expected.has(id as AgentRuleId)) findings.push(finding("agent-managed-rule-unknown", `managed AGENTS rule ID is unknown: ${id}`));
  }
  for (const rule of rules) if (!seen.has(rule.id)) findings.push(finding("agent-managed-rule-missing", `managed AGENTS rule ID is missing: ${rule.id}`));
  const expectedOrder = rules.map((rule) => rule.id);
  if (ids.length === expectedOrder.length && ids.some((id, index) => id !== expectedOrder[index])) {
    findings.push(finding("agent-managed-rule-order", "managed AGENTS rule IDs must follow the canonical typed rule order"));
  }
  return findings;
}

export function hasTypedManagedAgentRules(raw: string): boolean {
  return raw.includes(AGENT_VERSION_MARKER);
}

export { ruleMarker as agentRuleMarker };
