import { conflictSummary, openConflicts } from "./discovery";
import type { ConflictSummary } from "./discovery";
import {
  evaluateFreshContextRequirement,
  impactReport,
  type ImpactReport,
  type PrMetadata,
} from "./impact";
import { buildReviewManifest, type ReviewManifest } from "./review-bundle";
import { readConfig, type FreshContextMode, type FreshContextPolicy } from "./verification";
import type { ConflictType, Finding, WikiPage } from "./model";
import type { RepoView } from "./repository-view";
import { jsonStable } from "./serialization";
import { parse as parseYaml } from "yaml";

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}
export type FreshContextVerdict = "PENDING" | "PASS" | "NEEDS_RECONCILE";

/**
 * A version 2 finding states what the reviewer found, which authority controls
 * it, and what the candidate already does about it. The disposition is a
 * reviewer observation of the reviewed tree, never an author claim: every
 * disposition that points somewhere must name the conflict or follow-up it
 * points at, so a finding cannot be retired by gesture.
 */
export type FreshContextClassification =
  | "candidate_regression"
  | "declared_contract_violation"
  | "preexisting_implementation_mismatch"
  | "decision_ambiguity"
  | "documentation_disagreement"
  | "unrelated_defect"
  | "suggestion";
export type FreshContextDisposition =
  | "unresolved"
  | "fixed"
  | "conflict_introduced"
  | "existing_conflict_linked"
  | "followup_created"
  | "recorded"
  | "dismissed_with_reason";
export type FreshContextAuthorityKind = "normative" | "observed" | "derived" | "test" | "metadata";
export type FreshContextFinding = {
  id: string;
  classification: FreshContextClassification;
  disposition: FreshContextDisposition;
  scope_refs: string[];
  discrepancy: string;
  authority: { kind: FreshContextAuthorityKind; ref: string };
  acceptance_criteria: string[];
  evidence: string[];
  conflict_id?: string;
  followup_ref?: string;
  dismissal_reason?: string;
};

type FreshContextReportBase = {
  verdict: FreshContextVerdict;
  reviewed_head_sha: string;
  merge_base_sha: string;
  bundle_digest: string;
  reviewer: string;
  evidence: string[];
  summary?: string;
};
export type FreshContextReportV1 = FreshContextReportBase & { version: 1; findings?: string[] };
export type FreshContextReportV2 = FreshContextReportBase & { version: 2; findings?: FreshContextFinding[] };
export type FreshContextReport = FreshContextReportV1 | FreshContextReportV2;
export type FreshContextCheckResult = {
  ok: boolean;
  mode: FreshContextMode;
  report?: FreshContextReport;
  findings: Finding[];
};
export type ReviewCheckResult = FreshContextCheckResult & {
  manifest: ReviewManifest;
  impact: ImpactReport;
  required: boolean;
  requirementReasons: string[];
};

function normalizedActor(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

const FRESH_CONTEXT_CLASSIFICATIONS = new Set<string>([
  "candidate_regression",
  "declared_contract_violation",
  "preexisting_implementation_mismatch",
  "decision_ambiguity",
  "documentation_disagreement",
  "unrelated_defect",
  "suggestion",
]);
const FRESH_CONTEXT_DISPOSITIONS = new Set<string>([
  "unresolved",
  "fixed",
  "conflict_introduced",
  "existing_conflict_linked",
  "followup_created",
  "recorded",
  "dismissed_with_reason",
]);
const FRESH_CONTEXT_AUTHORITY_KINDS = new Set<string>(["normative", "observed", "derived", "test", "metadata"]);
const FRESH_CONTEXT_SCOPE_KINDS = ["page", "source", "invariant", "conflict", "test", "metadata"] as const;
const FRESH_CONTEXT_DISPOSITION_FIELD: Partial<Record<FreshContextDisposition, "conflict_id" | "followup_ref" | "dismissal_reason">> = {
  conflict_introduced: "conflict_id",
  existing_conflict_linked: "conflict_id",
  followup_created: "followup_ref",
  dismissed_with_reason: "dismissal_reason",
};

/**
 * Which dispositions retire which classification. This encodes the workflow
 * rule rather than inventing one: fix what this candidate broke or what the PR
 * itself declares; track a pre-existing mismatch, an undecided product
 * decision, or a documentation disagreement in an open conflict; record a named
 * follow-up for a defect outside this change's semantic scope.
 *
 * `unresolved` and `fixed` are legal everywhere — the first is the state a
 * finding starts in, and fixing something is never the wrong answer. What the
 * table actually withholds is the deferral: a break this candidate caused
 * cannot be pushed into a conflict, a follow-up, or a dismissal, so the only
 * way past it is to fix it. `recorded` retires nothing, so it stays limited to
 * a `suggestion`, which asserts no contract to begin with.
 */
const FRESH_CONTEXT_CLASSIFICATION_DISPOSITIONS: Record<FreshContextClassification, Set<FreshContextDisposition>> = {
  candidate_regression: new Set(["unresolved", "fixed"]),
  declared_contract_violation: new Set(["unresolved", "fixed"]),
  preexisting_implementation_mismatch: new Set([
    "unresolved",
    "fixed",
    "conflict_introduced",
    "existing_conflict_linked",
    "followup_created",
    "dismissed_with_reason",
  ]),
  decision_ambiguity: new Set(["unresolved", "fixed", "conflict_introduced", "existing_conflict_linked"]),
  documentation_disagreement: new Set([
    "unresolved",
    "fixed",
    "conflict_introduced",
    "existing_conflict_linked",
    "followup_created",
    "dismissed_with_reason",
  ]),
  unrelated_defect: new Set(["unresolved", "fixed", "existing_conflict_linked", "followup_created", "dismissed_with_reason"]),
  suggestion: new Set(["unresolved", "fixed", "followup_created", "recorded", "dismissed_with_reason"]),
};

/** The conflict type a classification must be tracked under when it points at one. */
const FRESH_CONTEXT_CLASSIFICATION_CONFLICT_TYPE: Partial<Record<FreshContextClassification, ConflictType>> = {
  preexisting_implementation_mismatch: "implementation",
  decision_ambiguity: "decision",
  documentation_disagreement: "documentation",
};

/**
 * Classifications that assert the problem predates the candidate. The author
 * writes a conflict's `origin`; the reviewer independently writes
 * `classification`. They are the same judgement made by different parties, so a
 * finding that says "this was already broken" may only point at a conflict that
 * says the same thing.
 *
 * `decision_ambiguity` is deliberately absent. It reports that intent is
 * undecided, not that something is broken, and a change can legitimately raise
 * a new question about its own behaviour — a conflict honestly recording
 * `origin: introduced_by_change`. Requiring `baseline` there would leave that
 * conflict as the only allowed disposition while making it illegal, and
 * inventing the decision to close it is forbidden outright.
 */
const FRESH_CONTEXT_PREEXISTING_CLASSIFICATIONS = new Set<FreshContextClassification>([
  "preexisting_implementation_mismatch",
  "documentation_disagreement",
  "unrelated_defect",
]);

function nonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

/**
 * Shape validation for version 2 findings. It proves a finding is actionable —
 * bound to the reviewed change, attributed to a controlling authority, closable
 * against stated criteria, and honest about where an undone finding is tracked.
 *
 * It also adjudicates the disposition. The classification-to-disposition table
 * always applies, because it needs nothing beyond the finding itself. Resolving
 * a conflict pointer does need a repository view, so that half runs only when
 * `conflicts` is supplied. `reviewCheck` always supplies the open conflicts at
 * HEAD, so an empty array correctly means every conflict pointer is dangling.
 */
export function validateFreshContextFindings(
  raw: unknown,
  severity: Finding["severity"],
  conflicts?: ConflictSummary[],
): Finding[] {
  const byConflictId = conflicts == null ? undefined : new Map(conflicts.map((item) => [item.id, item]));
  const findings: Finding[] = [];
  const push = (code: string, message: string) => findings.push({ code, message, severity });
  if (raw == null) return findings;
  if (!Array.isArray(raw)) {
    push("fresh-context-finding-malformed", "version 2 findings must be an array of structured findings");
    return findings;
  }
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const label = `finding ${index + 1}`;
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
      push("fresh-context-finding-malformed", `${label} must be a mapping`);
      return;
    }
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (id.length === 0) push("fresh-context-finding-malformed", `${label} requires a non-empty id`);
    else if (seen.has(id)) push("fresh-context-finding-malformed", `duplicate finding id: ${id}`);
    else seen.add(id);
    const name = id.length > 0 ? id : label;

    const classification = typeof item.classification === "string" ? item.classification : undefined;
    if (classification == null || !FRESH_CONTEXT_CLASSIFICATIONS.has(classification)) push("fresh-context-finding-malformed", `${name} requires a known classification`);
    if (typeof item.discrepancy !== "string" || item.discrepancy.trim().length === 0) push("fresh-context-finding-malformed", `${name} requires a non-empty discrepancy`);
    if (!nonEmptyStrings(item.evidence)) push("fresh-context-finding-malformed", `${name} requires non-empty evidence entries`);

    if (!nonEmptyStrings(item.scope_refs)) {
      push("fresh-context-finding-scope-missing", `${name} requires at least one scope_refs entry binding it to the reviewed change`);
    } else {
      for (const ref of item.scope_refs) {
        const kind = ref.slice(0, ref.indexOf(":"));
        if (!FRESH_CONTEXT_SCOPE_KINDS.includes(kind as (typeof FRESH_CONTEXT_SCOPE_KINDS)[number]) || ref.slice(kind.length + 1).trim().length === 0) {
          push("fresh-context-finding-scope-missing", `${name} scope ref must be <${FRESH_CONTEXT_SCOPE_KINDS.join("|")}>:<ref>, received ${ref}`);
        }
      }
    }

    const authority = item.authority as Record<string, unknown> | undefined;
    const authorityValid = authority != null && typeof authority === "object" && !Array.isArray(authority)
      && typeof authority.kind === "string" && FRESH_CONTEXT_AUTHORITY_KINDS.has(authority.kind)
      && typeof authority.ref === "string" && authority.ref.trim().length > 0;
    if (!authorityValid) push("fresh-context-finding-authority-missing", `${name} requires authority.kind and a non-empty authority.ref naming the controlling source`);

    if (classification !== "suggestion" && !nonEmptyStrings(item.acceptance_criteria)) {
      push("fresh-context-finding-acceptance-missing", `${name} requires objective acceptance_criteria; only a suggestion may omit them`);
    }

    const rawDisposition = typeof item.disposition === "string" ? item.disposition : undefined;
    if (rawDisposition == null || !FRESH_CONTEXT_DISPOSITIONS.has(rawDisposition)) {
      push("fresh-context-finding-malformed", `${name} requires a known disposition`);
      return;
    }
    const disposition = rawDisposition as FreshContextDisposition;

    // Only adjudicable once the classification itself parsed; an unknown
    // classification already reported its own finding above.
    if (classification != null && FRESH_CONTEXT_CLASSIFICATIONS.has(classification)) {
      const allowed = FRESH_CONTEXT_CLASSIFICATION_DISPOSITIONS[classification as FreshContextClassification];
      if (!allowed.has(disposition)) {
        push(
          "fresh-context-disposition-not-allowed",
          `${name} classification ${classification} cannot be retired by ${disposition}; allowed: ${[...allowed].sort((a, b) => a.localeCompare(b)).join(", ")}`,
        );
      }
    }

    const required = FRESH_CONTEXT_DISPOSITION_FIELD[disposition];
    if (required == null) return;
    const value = item[required];
    if (typeof value !== "string" || value.trim().length === 0) {
      push("fresh-context-disposition-incomplete", `${name} disposition ${disposition} requires ${required}`);
      return;
    }
    if (required === "dismissal_reason" && value.trim().length < 20) {
      push("fresh-context-disposition-incomplete", `${name} dismissal_reason requires at least 20 characters`);
      return;
    }
    if (required !== "conflict_id" || byConflictId == null) return;

    // A disposition that points at a conflict is only worth anything if the
    // conflict is real, open, and says what the finding says.
    const conflict = byConflictId.get(value.trim());
    if (conflict == null) {
      push("fresh-context-conflict-unknown", `${name} disposition ${disposition} names ${value.trim()}, which is not an open conflict at the reviewed HEAD`);
      return;
    }
    if (classification == null || !FRESH_CONTEXT_CLASSIFICATIONS.has(classification)) return;
    const typed = classification as FreshContextClassification;

    const expectedType = FRESH_CONTEXT_CLASSIFICATION_CONFLICT_TYPE[typed];
    if (expectedType != null && conflict.type !== expectedType) {
      push("fresh-context-conflict-mismatch", `${name} classification ${typed} requires a ${expectedType} conflict, but ${conflict.id} is ${conflict.type}`);
    }
    if (FRESH_CONTEXT_PREEXISTING_CLASSIFICATIONS.has(typed) && conflict.origin !== "baseline") {
      push(
        "fresh-context-conflict-mismatch",
        `${name} classification ${typed} states the problem predates this candidate, but ${conflict.id} declares origin ${conflict.origin}`,
      );
    }

    // Every conflict declares at least one affected current page, so a finding
    // that claims to be tracked by one has to name a page as well. Without this
    // a `source:`-only scope could be retired by any open conflict of the
    // implied type, about any subject.
    const scopedPages = nonEmptyStrings(item.scope_refs)
      ? item.scope_refs.filter((ref) => ref.startsWith("page:")).map((ref) => ref.slice("page:".length).trim()).filter((ref) => ref.length > 0)
      : [];
    if (scopedPages.length === 0) {
      push("fresh-context-conflict-mismatch", `${name} names ${conflict.id} but declares no page: scope ref to share with it`);
    } else if (!scopedPages.some((id) => conflict.affectedPages.includes(id))) {
      push(
        "fresh-context-conflict-mismatch",
        `${name} scopes pages ${scopedPages.join(", ")} but ${conflict.id} declares affected pages ${conflict.affectedPages.join(", ")}`,
      );
    }
  });
  return findings;
}

export function validateFreshContextAttestation(input: {
  policy: FreshContextPolicy;
  manifest: ReviewManifest;
  report?: unknown;
  reviewerActor?: string;
  prAuthor?: string;
  conflicts?: ConflictSummary[];
}): FreshContextCheckResult {
  const severity: Finding["severity"] = input.policy.mode === "required" ? "error" : "warning";
  const finding = (code: string, message: string): Finding => ({ code, message, severity });
  if (input.report == null) {
    const findings = [finding("fresh-context-missing", "no fresh-context report was supplied")];
    return { ok: input.policy.mode === "advisory", mode: input.policy.mode, findings };
  }
  if (typeof input.report !== "object" || Array.isArray(input.report)) {
    const findings = [finding("fresh-context-malformed", "fresh-context report must be a mapping")];
    return { ok: input.policy.mode === "advisory", mode: input.policy.mode, findings };
  }
  const raw = input.report as Record<string, unknown>;
  const verdicts = new Set(["PENDING", "PASS", "NEEDS_RECONCILE"]);
  const sha40 = /^[0-9a-f]{40}$/;
  const sha256 = /^[0-9a-f]{64}$/;
  const hasSummary = typeof raw.summary === "string" && raw.summary.trim().length > 0;
  const version = raw.version === 1 || raw.version === 2 ? raw.version : undefined;
  const hasFindings = version === 2
    ? Array.isArray(raw.findings) && raw.findings.length > 0
    : stringArray(raw.findings) && raw.findings.length > 0;
  const structurallyValid = version != null
    && typeof raw.verdict === "string" && verdicts.has(raw.verdict)
    && typeof raw.reviewed_head_sha === "string" && sha40.test(raw.reviewed_head_sha)
    && typeof raw.merge_base_sha === "string" && sha40.test(raw.merge_base_sha)
    && typeof raw.bundle_digest === "string" && sha256.test(raw.bundle_digest)
    && typeof raw.reviewer === "string" && raw.reviewer.trim().length > 0
    && Array.isArray(raw.evidence) && raw.evidence.every((item) => typeof item === "string")
    && (hasSummary || hasFindings);
  if (!structurallyValid) {
    const findings = [finding("fresh-context-malformed", "report requires version 1 or 2, a known verdict, exact SHA/digest fields, reviewer, evidence[], and summary or findings")];
    return { ok: input.policy.mode === "advisory", mode: input.policy.mode, findings };
  }
  const report = raw as FreshContextReport;
  const findings: Finding[] = [];
  if (report.version === 2) {
    findings.push(...validateFreshContextFindings(report.findings, severity, input.conflicts));
    // A PASS states that nothing is left dangling. A finding the reviewer left
    // `unresolved` is by definition dangling, so the two cannot coexist.
    if (report.verdict === "PASS") {
      const entries = Array.isArray(report.findings) ? report.findings : [];
      const unresolved = entries.filter((item) => item?.disposition === "unresolved").map((item) => item.id);
      if (unresolved.length > 0) findings.push(finding("fresh-context-finding-unresolved", `PASS cannot carry an unresolved finding: ${unresolved.join(", ")}`));
    }
  }
  if (report.verdict !== input.policy.requiredVerdict) findings.push(finding("fresh-context-not-pass", `required verdict is ${input.policy.requiredVerdict}, received ${report.verdict}`));
  if (input.policy.evidenceRequired && (report.evidence.length === 0 || report.evidence.some((item) => item.trim().length === 0))) findings.push(finding("fresh-context-evidence-missing", "PASS requires at least one non-empty evidence entry"));
  if (report.reviewed_head_sha !== input.manifest.head_sha) findings.push(finding("fresh-context-head-stale", `reviewed HEAD ${report.reviewed_head_sha} does not match current HEAD ${input.manifest.head_sha}`));
  if (report.merge_base_sha !== input.manifest.merge_base_sha) findings.push(finding("fresh-context-base-stale", `reviewed merge-base ${report.merge_base_sha} does not match current merge-base ${input.manifest.merge_base_sha}`));
  if (report.bundle_digest !== input.manifest.bundle_digest) findings.push(finding("fresh-context-bundle-stale", `reviewed bundle ${report.bundle_digest} does not match current bundle ${input.manifest.bundle_digest}`));

  const reviewer = normalizedActor(input.reviewerActor ?? report.reviewer);
  const declaredReviewer = normalizedActor(report.reviewer);
  const allowed = input.policy.trust.allowedReviewers.map(normalizedActor);
  const trustFailures: string[] = [];
  if (input.policy.trust.requireAuthenticatedActor && !input.reviewerActor?.trim()) trustFailures.push("authenticated reviewer actor is required");
  if (input.reviewerActor && reviewer !== declaredReviewer) trustFailures.push("report reviewer does not match the authenticated attestation actor");
  if (!allowed.includes("*") && !allowed.includes(reviewer)) trustFailures.push(`reviewer ${reviewer} is not in allowedReviewers`);
  if (input.policy.trust.requireDifferentActor) {
    if (!input.prAuthor?.trim()) trustFailures.push("PR author identity is required by the trust policy");
    else if (reviewer === normalizedActor(input.prAuthor)) trustFailures.push("reviewer must differ from the PR author");
  }
  if (trustFailures.length > 0) findings.push(finding("fresh-context-reviewer-untrusted", trustFailures.join("; ")));
  return {
    ok: input.policy.mode === "advisory" || !findings.some((item) => item.severity === "error"),
    mode: input.policy.mode,
    report,
    findings,
  };
}

export function parseFreshContextReport(raw: string): { report?: unknown; findings: Finding[] } {
  try {
    const report = parseYaml(raw) as unknown;
    return { report, findings: [] };
  } catch (error) {
    return {
      findings: [{
        code: "fresh-context-malformed",
        message: error instanceof Error ? error.message : String(error),
        severity: "error",
      }],
    };
  }
}

export function reviewCheck(view: RepoView, pages: WikiPage[], options: {
  base?: string;
  metadata?: PrMetadata;
  report?: unknown;
  reviewerActor?: string;
  prAuthor?: string;
  policy?: FreshContextPolicy;
}): ReviewCheckResult {
  const impact = impactReport(view, pages, { base: options.base, metadata: options.metadata });
  const manifest = buildReviewManifest(view, pages, impact, options.metadata);
  const policy = options.policy ?? readConfig(view).freshContext;
  if (!policy) {
    return {
      ok: false,
      mode: "required",
      manifest,
      impact,
      required: true,
      requirementReasons: ["Fresh-context policy is missing or invalid"],
      findings: [{
        code: "fresh-context-config-missing",
        message: "an explicit valid freshContext policy is required; missing configuration does not fall back to advisory",
        path: ".wiki/config.json",
        severity: "error",
      }],
    };
  }
  const requirement = evaluateFreshContextRequirement(policy, manifest, impact);
  if (!requirement.applies) {
    return {
      ok: true,
      mode: policy.mode,
      manifest,
      impact,
      required: false,
      requirementReasons: [],
      findings: [],
    };
  }
  // Conflict pointers are resolved against the open conflicts at the reviewed
  // HEAD, so a finding cannot be retired by naming a conflict that never
  // existed or one already resolved. Whether the candidate opened the conflict
  // or inherited it is the author-side `touched_conflicts` guard's job, so
  // `conflict_introduced` and `existing_conflict_linked` resolve identically
  // here.
  const checked = validateFreshContextAttestation({
    policy,
    manifest,
    report: options.report,
    reviewerActor: options.reviewerActor,
    prAuthor: options.prAuthor,
    conflicts: openConflicts(pages)
      .filter((page) => page.data.conflict_id != null && page.data.conflict_type != null && page.data.severity != null
        && page.data.origin != null && page.data.opened_at != null && page.data.resolution != null)
      .map(conflictSummary),
  });
  const severity: Finding["severity"] = policy.mode === "required" ? "error" : "warning";
  const mirror = options.metadata?.fresh_context;
  if (mirror && checked.report) {
    if (mirror.verdict !== checked.report.verdict) checked.findings.push({ code: "fresh-context-not-pass", message: `PR metadata fresh_context verdict ${mirror.verdict} does not mirror attested verdict ${checked.report.verdict}`, severity });
    if (mirror.reviewed_head_sha !== checked.report.reviewed_head_sha) checked.findings.push({ code: "fresh-context-head-stale", message: "PR metadata fresh_context reviewed_head_sha does not mirror the attested HEAD", severity });
    if (mirror.bundle_digest !== checked.report.bundle_digest) checked.findings.push({ code: "fresh-context-bundle-stale", message: "PR metadata fresh_context bundle_digest does not mirror the attested bundle", severity });
    if (normalizedActor(mirror.reviewer) !== normalizedActor(checked.report.reviewer)) checked.findings.push({ code: "fresh-context-reviewer-untrusted", message: "PR metadata fresh_context reviewer does not mirror the authenticated attestation reviewer", severity });
    if (jsonStable(mirror.evidence) !== jsonStable(checked.report.evidence)) checked.findings.push({ code: "fresh-context-evidence-missing", message: "PR metadata fresh_context evidence does not mirror the attested evidence", severity });
  }
  checked.ok = policy.mode === "advisory" || !checked.findings.some((item) => item.severity === "error");
  return {
    ...checked,
    manifest,
    impact,
    required: policy.mode === "required",
    requirementReasons: requirement.reasons,
  };
}
