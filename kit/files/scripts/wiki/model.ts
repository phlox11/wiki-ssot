/**
 * Shared, provider-neutral Wiki domain models.
 *
 * This module deliberately contains only data contracts. Foundation and
 * feature modules import these types through this layer, keeping the
 * compatibility facade one-way.
 */

export type WikiStatus = "current" | "proposed" | "deprecated" | "conflicted" | "archived";
export type WikiAuthority = "normative" | "observed" | "derived";
export type WikiSource = { path: string; symbols?: string[] } | { glob: string };
export type ConflictType = "decision" | "implementation" | "documentation";
export type ConflictSeverity = "high" | "medium" | "low";
export type ConflictOrigin = "baseline" | "introduced_by_change";
export type ConflictResolutionState = "open" | "decision_pending" | "implementing" | "verified";
export type ConflictResolution = {
  state: ConflictResolutionState;
  decision?: string | null;
  acceptance: string[];
  evidence?: string[];
};
export type WorkState = "not-started" | "active" | "blocked" | "done" | "deferred";
export type WorkPriority = "critical" | "high" | "normal" | "low";
export type WorkExecutor = "agent" | "human" | "either";
export type WorkItem = {
  id: string;
  title: string;
  state: WorkState;
  priority: WorkPriority;
  /** Optional in proposal frontmatter; queue projections always normalize it. */
  executor?: WorkExecutor;
  depends_on: string[];
  context_pages: string[];
  acceptance: string[];
  evidence: string[];
  blocker?: string;
  deferred_reason?: string;
};

export type WikiFrontmatter = {
  id: string;
  summary: string;
  kind: string;
  status: WikiStatus;
  authority: WikiAuthority;
  owners: string[];
  sources: WikiSource[];
  affects?: string[];
  related?: string[];
  tags?: string[];
  conflict_id?: string;
  conflict_type?: ConflictType;
  severity?: ConflictSeverity;
  origin?: ConflictOrigin;
  opened_at?: string;
  affected_pages?: string[];
  affected_invariants?: string[];
  resolution?: ConflictResolution;
  work_items?: WorkItem[];
};

export type WikiPage = {
  path: string;
  body: string;
  raw: string;
  data: WikiFrontmatter;
};

export type Finding = {
  code: string;
  message: string;
  path?: string;
  severity: "error" | "warning";
};

export function isConflictGuardFinding(finding: Finding): boolean {
  return finding.severity === "error" && (finding.code.startsWith("conflict-") || finding.code.startsWith("metadata-"));
}
