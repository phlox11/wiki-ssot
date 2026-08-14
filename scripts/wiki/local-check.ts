import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  allLintFindings,
  KIT_ENTRIES,
  kitPath,
  impactReport,
  readConfig,
  resolveDiffBase,
  reviewCheck,
  validatePrMetadata,
  validateState,
  type ImpactReport,
  type ReviewCheckResult,
} from "./core";
import { affectedInvariantIdsForReview, canonicalPrMetadata, type PrMetadata } from "./impact";
import { parseFreshContextReport } from "./review-attestation";
import type { Finding, WikiPage } from "./model";
import { git, type RepoView } from "./repository-view";
import { hashContent, jsonStable } from "./serialization";
import { UsageError } from "./verification";

/** The on-disk contract written by the canonical local Wiki gate. */
export const LOCAL_CHECK_RESULT_VERSION = 1 as const;

export type LocalCheckStatus = "pass" | "failure";
export type LocalReviewStatus = "not-required" | "review-required" | "pass" | "invalid-report" | "needs-reconcile";

export type LocalCheckSummary = {
  ok: boolean;
  findings: Finding[];
};

export type LocalImpactSummary = {
  base: string;
  merge_base: string;
  changed_files: string[];
  affected_pages: string[];
  affected_invariants: string[];
  affected_conflicts: string[];
  removed_current_pages: string[];
  stale_pages: string[];
  high_risk_stale_pages: string[];
  advisory_stale_pages: string[];
  unmapped_high_risk: string[];
  findings: Finding[];
};

export type LocalReviewSummary = {
  ok: boolean;
  required: boolean;
  status: LocalReviewStatus;
  mode: "advisory" | "required";
  requirement_reasons: string[];
  findings: Finding[];
  affected_invariants: string[];
  affected_conflicts: string[];
  bundle_digest?: string;
  reviewed_head_sha?: string;
  reviewer?: string;
};

export type LocalArgvResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type LocalArgvRunner = (argv: string[], cwd: string) => LocalArgvResult;

export type LocalToolingCommand = {
  id: string;
  argv: string[];
  exit_code: number;
  ok: boolean;
};

export type LocalToolingSummary = {
  selected: boolean;
  changed_files: string[];
  commands: LocalToolingCommand[];
  findings: Finding[];
  ok: boolean;
};

export type LocalCheckResult = {
  version: typeof LOCAL_CHECK_RESULT_VERSION;
  status: LocalCheckStatus;
  ok: boolean;
  head_sha: string;
  base_ref: string;
  base_sha: string;
  merge_base_sha: string;
  metadata_digest: string;
  checks: {
    structural: LocalCheckSummary;
    state: LocalCheckSummary;
    impact: LocalImpactSummary;
    review: LocalReviewSummary;
    tooling: LocalToolingSummary;
  };
  findings: Finding[];
  warnings: Finding[];
  result_digest: string;
};

export type LocalCheckOptions = {
  root: string;
  view: RepoView;
  pages: WikiPage[];
  base?: string;
  metadataRaw?: string;
  reportRaw?: string;
  dirtyPaths?: string[];
  inventoryFindings?: Finding[];
  /** Direct callers keep this false to avoid recursively running the suite. */
  runToolingChecks?: boolean;
  argvRunner?: LocalArgvRunner;
  /** Optional authenticated Fresh-context identities for the canonical CLI gate. */
  reviewerActor?: string;
  prAuthor?: string;
};

function finding(code: string, message: string, severity: Finding["severity"], path?: string): Finding {
  return { code, message, severity, ...(path ? { path } : {}) };
}

function okFindings(items: Finding[]): boolean {
  return !items.some((item) => item.severity === "error");
}

/**
 * The digest serializes repository-relative finding paths as semantic
 * evidence. Only input/output artifact paths and timestamps are excluded from
 * the result contract, so moving an error to another source cannot be hidden
 * by reusing the same code/message.
 */
function digestFinding(item: Finding): { code: string; message: string; severity: Finding["severity"]; path?: string } {
  return { code: item.code, message: item.message, severity: item.severity, ...(item.path ? { path: item.path } : {}) };
}

function digestFindings(items: Finding[]): ReturnType<typeof digestFinding>[] {
  return [...items]
    .map(digestFinding)
    .sort((a, b) => a.code.localeCompare(b.code)
      || a.severity.localeCompare(b.severity)
      || a.message.localeCompare(b.message)
      || (a.path ?? "").localeCompare(b.path ?? ""));
}

function digestImpact(report: LocalImpactSummary): unknown {
  return {
    base: report.base,
    merge_base: report.merge_base,
    changed_files: [...report.changed_files].sort((a, b) => a.localeCompare(b)),
    affected_pages: [...report.affected_pages].sort((a, b) => a.localeCompare(b)),
    affected_invariants: [...report.affected_invariants].sort((a, b) => a.localeCompare(b)),
    affected_conflicts: [...report.affected_conflicts].sort((a, b) => a.localeCompare(b)),
    removed_current_pages: [...report.removed_current_pages].sort((a, b) => a.localeCompare(b)),
    stale_pages: [...report.stale_pages].sort((a, b) => a.localeCompare(b)),
    high_risk_stale_pages: [...report.high_risk_stale_pages].sort((a, b) => a.localeCompare(b)),
    advisory_stale_pages: [...report.advisory_stale_pages].sort((a, b) => a.localeCompare(b)),
    unmapped_high_risk: [...report.unmapped_high_risk].sort((a, b) => a.localeCompare(b)),
    findings: digestFindings(report.findings),
  };
}

function digestReview(review: LocalReviewSummary): unknown {
  return {
    ok: review.ok,
    required: review.required,
    status: review.status,
    mode: review.mode,
    requirement_reasons: [...review.requirement_reasons].sort((a, b) => a.localeCompare(b)),
    findings: digestFindings(review.findings),
    affected_invariants: [...review.affected_invariants].sort((a, b) => a.localeCompare(b)),
    affected_conflicts: [...review.affected_conflicts].sort((a, b) => a.localeCompare(b)),
    ...(review.bundle_digest ? { bundle_digest: review.bundle_digest } : {}),
    ...(review.reviewed_head_sha ? { reviewed_head_sha: review.reviewed_head_sha } : {}),
    ...(review.reviewer ? { reviewer: review.reviewer } : {}),
  };
}

function digestTooling(tooling: LocalToolingSummary): unknown {
  return {
    selected: tooling.selected,
    changed_files: [...tooling.changed_files].sort((a, b) => a.localeCompare(b)),
    commands: [...tooling.commands]
      .map((command) => ({
        id: command.id,
        argv: [...command.argv],
        exit_code: command.exit_code,
        ok: command.ok,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    findings: digestFindings(tooling.findings),
    ok: tooling.ok,
  };
}

/** Return the exact canonical object that is hashed into result_digest. */
export function localCheckDigestInput(result: Omit<LocalCheckResult, "result_digest">): unknown {
  return {
    version: result.version,
    status: result.status,
    ok: result.ok,
    head_sha: result.head_sha,
    base_ref: result.base_ref,
    base_sha: result.base_sha,
    merge_base_sha: result.merge_base_sha,
    metadata_digest: result.metadata_digest,
    checks: {
      structural: {
        ok: result.checks.structural.ok,
        findings: digestFindings(result.checks.structural.findings),
      },
      state: {
        ok: result.checks.state.ok,
        findings: digestFindings(result.checks.state.findings),
      },
      impact: digestImpact(result.checks.impact),
      review: digestReview(result.checks.review),
      tooling: digestTooling(result.checks.tooling),
    },
    findings: digestFindings(result.findings),
    warnings: digestFindings(result.warnings),
  };
}

export function localCheckDigest(result: Omit<LocalCheckResult, "result_digest">): string {
  return hashContent(jsonStable(localCheckDigestInput(result)));
}

function resultShapeFindings(value: unknown): Finding[] {
  const findings: Finding[] = [];
  const push = (code: string, message: string) => findings.push({ code, message, severity: "error" });
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    push("local-result-malformed", "local check result must be a JSON object");
    return findings;
  }
  const result = value as Partial<LocalCheckResult>;
  if (result.version !== LOCAL_CHECK_RESULT_VERSION) push("local-result-version", "local check result version must be 1");
  if (result.status !== "pass" && result.status !== "failure") push("local-result-status", "local check result status must be pass or failure");
  if (typeof result.ok !== "boolean") push("local-result-ok", "local check result ok must be boolean");
  for (const field of ["head_sha", "base_sha", "merge_base_sha"] as const) {
    if (typeof result[field] !== "string" || !/^[0-9a-f]{40}$/.test(result[field])) push("local-result-sha", `${field} must be a 40-character lowercase commit SHA`);
  }
  if (typeof result.base_ref !== "string" || result.base_ref.trim().length === 0) push("local-result-base", "base_ref must be a non-empty string");
  if (typeof result.metadata_digest !== "string" || !/^[0-9a-f]{64}$/.test(result.metadata_digest)) push("local-result-metadata-digest", "metadata_digest must be a SHA-256 digest");
  if (typeof result.result_digest !== "string" || !/^[0-9a-f]{64}$/.test(result.result_digest)) push("local-result-digest", "result_digest must be a SHA-256 digest");
  const findingArray = (candidate: unknown, label: string): void => {
    if (!Array.isArray(candidate)) {
      push("local-result-findings", `${label} must be an array`);
      return;
    }
    candidate.forEach((item, index) => {
      if (item == null || typeof item !== "object" || Array.isArray(item)) {
        push("local-result-finding-malformed", `${label}[${index}] must be a finding mapping`);
        return;
      }
      const findingValue = item as Record<string, unknown>;
      const pathValid = findingValue.path == null
        || (typeof findingValue.path === "string" && findingValue.path.length > 0 && !findingValue.path.startsWith("/") && !findingValue.path.split("/").includes(".."));
      if (typeof findingValue.code !== "string" || findingValue.code.trim().length === 0
        || typeof findingValue.message !== "string" || (findingValue.severity !== "error" && findingValue.severity !== "warning")
        || !pathValid) {
        push("local-result-finding-malformed", `${label}[${index}] has an invalid code/message/severity/path`);
      }
    });
  };
  const summary = (candidate: unknown, label: string): void => {
    if (candidate == null || typeof candidate !== "object" || Array.isArray(candidate)) {
      push("local-result-checks", `${label} must be a mapping`);
      return;
    }
    const item = candidate as Record<string, unknown>;
    if (typeof item.ok !== "boolean") push("local-result-checks", `${label}.ok must be boolean`);
    findingArray(item.findings, `${label}.findings`);
  };
  const checks = result.checks;
  if (checks == null || typeof checks !== "object" || Array.isArray(checks)) push("local-result-checks", "checks must be a mapping");
  else {
    const checkValue = checks as Record<string, unknown>;
    summary(checkValue.structural, "checks.structural");
    summary(checkValue.state, "checks.state");
    if (checkValue.impact == null || typeof checkValue.impact !== "object" || Array.isArray(checkValue.impact)) push("local-result-checks", "checks.impact must be a mapping");
    else {
      const impact = checkValue.impact as Record<string, unknown>;
      for (const field of ["base", "merge_base"] as const) if (typeof impact[field] !== "string" || impact[field].trim().length === 0) push("local-result-checks", `checks.impact.${field} must be a non-empty string`);
      for (const field of ["changed_files", "affected_pages", "affected_invariants", "affected_conflicts", "removed_current_pages", "stale_pages", "high_risk_stale_pages", "advisory_stale_pages", "unmapped_high_risk"] as const) {
        if (!Array.isArray(impact[field]) || !(impact[field] as unknown[]).every((item) => typeof item === "string")) push("local-result-checks", `checks.impact.${field} must be a string array`);
      }
      findingArray(impact.findings, "checks.impact.findings");
    }
    if (checkValue.review == null || typeof checkValue.review !== "object" || Array.isArray(checkValue.review)) push("local-result-checks", "checks.review must be a mapping");
    else {
      const review = checkValue.review as Record<string, unknown>;
      if (typeof review.ok !== "boolean" || typeof review.required !== "boolean") push("local-result-checks", "checks.review ok/required must be boolean");
      if (!["not-required", "review-required", "pass", "invalid-report", "needs-reconcile"].includes(String(review.status))) push("local-result-checks", "checks.review.status is invalid");
      if (review.mode !== "advisory" && review.mode !== "required") push("local-result-checks", "checks.review.mode is invalid");
      if (review.bundle_digest != null && (typeof review.bundle_digest !== "string" || !/^[0-9a-f]{64}$/.test(review.bundle_digest))) push("local-result-checks", "checks.review.bundle_digest must be a SHA-256 digest when present");
      if (review.reviewed_head_sha != null && (typeof review.reviewed_head_sha !== "string" || !/^[0-9a-f]{40}$/.test(review.reviewed_head_sha))) push("local-result-checks", "checks.review.reviewed_head_sha must be a commit SHA when present");
      if (review.reviewer != null && (typeof review.reviewer !== "string" || review.reviewer.trim().length === 0)) push("local-result-checks", "checks.review.reviewer must be a non-empty string when present");
      for (const field of ["requirement_reasons", "affected_invariants", "affected_conflicts"] as const) if (!Array.isArray(review[field]) || !(review[field] as unknown[]).every((item) => typeof item === "string")) push("local-result-checks", `checks.review.${field} must be a string array`);
      findingArray(review.findings, "checks.review.findings");
    }
    if (checkValue.tooling == null || typeof checkValue.tooling !== "object" || Array.isArray(checkValue.tooling)) push("local-result-checks", "checks.tooling must be a mapping");
    else {
      const tooling = checkValue.tooling as Record<string, unknown>;
      if (typeof tooling.selected !== "boolean" || typeof tooling.ok !== "boolean") push("local-result-checks", "checks.tooling selected/ok must be boolean");
      if (!Array.isArray(tooling.changed_files) || !(tooling.changed_files as unknown[]).every((item) => typeof item === "string")) push("local-result-checks", "checks.tooling.changed_files must be a string array");
      findingArray(tooling.findings, "checks.tooling.findings");
      if (!Array.isArray(tooling.commands)) push("local-result-checks", "checks.tooling.commands must be an array");
      else tooling.commands.forEach((candidate, index) => {
        if (candidate == null || typeof candidate !== "object" || Array.isArray(candidate)) {
          push("local-result-tooling-command-malformed", `checks.tooling.commands[${index}] must be a mapping`);
          return;
        }
        const command = candidate as Record<string, unknown>;
        if (typeof command.id !== "string" || command.id.trim().length === 0
          || !Array.isArray(command.argv) || !(command.argv as unknown[]).every((item) => typeof item === "string")
          || typeof command.exit_code !== "number" || !Number.isInteger(command.exit_code)
          || typeof command.ok !== "boolean") {
          push("local-result-tooling-command-malformed", `checks.tooling.commands[${index}] has an invalid argv/outcome binding`);
        }
      });
    }
  }
  findingArray(result.findings, "findings");
  findingArray(result.warnings, "warnings");
  if (result.status === "pass" && result.ok !== true) push("local-result-status-mismatch", "pass status requires ok: true");
  if (result.status === "failure" && result.ok !== false) push("local-result-status-mismatch", "failure status requires ok: false");
  return findings;
}

/** Validate shape and the deterministic digest before a result is trusted. */
export function validateLocalCheckResult(value: unknown): Finding[] {
  const findings = resultShapeFindings(value);
  if (findings.length > 0 || value == null || typeof value !== "object" || Array.isArray(value)) return findings;
  const result = value as LocalCheckResult;
  const { result_digest: _ignored, ...core } = result;
  if (localCheckDigest(core) !== result.result_digest) findings.push({ code: "local-result-digest-invalid", message: "local check result digest does not match its content", severity: "error" });
  return findings;
}

export function parseLocalCheckResult(raw: string): LocalCheckResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new UsageError(`local check result is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const findings = validateLocalCheckResult(value);
  if (findings.length > 0) throw new UsageError(findings.map((item) => item.message).join("; "));
  return value as LocalCheckResult;
}

function gitShaSafe(root: string, revision: string): string {
  return git(root, ["rev-parse", "--verify", `${revision}^{commit}`], true).trim();
}

function dirtyPaths(root: string): string[] {
  const changed = Bun.spawnSync(["git", "diff", "--name-only", "-z", "HEAD"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const untracked = Bun.spawnSync(["git", "ls-files", "--others", "--exclude-standard", "-z"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (changed.exitCode !== 0 || untracked.exitCode !== 0) throw new UsageError("unable to inspect candidate worktree status");
  return [...new Set([
    ...changed.stdout.toString().split("\0").filter(Boolean),
    ...untracked.stdout.toString().split("\0").filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b));
}

export function defaultLocalArgvRunner(argv: string[], cwd: string): LocalArgvResult {
  try {
    const child = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" });
    const stdout = child.stdout.toString();
    const stderr = child.stderr.toString();
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    return { exitCode: child.exitCode, stdout, stderr };
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

function installedToolkitPaths(view: RepoView): { paths: Set<string>; findings: Finding[] } {
  const config = readConfig(view);
  if (config.publishesKit) {
    const paths = new Set<string>();
    for (const entry of KIT_ENTRIES) {
      paths.add(entry.target);
      paths.add(kitPath(entry));
    }
    return { paths, findings: [] };
  }
  if (!view.exists(".wiki/kit-manifest.json")) return { paths: new Set(), findings: [] };
  try {
    const raw = JSON.parse(view.read(".wiki/kit-manifest.json")) as Record<string, unknown>;
    const paths = new Set<string>([".wiki/kit-manifest.json"]);
    for (const section of ["files", "managed"] as const) {
      const entries = raw[section];
      if (entries != null && typeof entries === "object" && !Array.isArray(entries)) {
        for (const path of Object.keys(entries as Record<string, unknown>)) paths.add(path);
      }
    }
    return { paths, findings: [] };
  } catch (error) {
    return {
      paths: new Set([".wiki/kit-manifest.json"]),
      findings: [finding("toolkit-manifest-invalid", error instanceof Error ? error.message : String(error), "error", ".wiki/kit-manifest.json")],
    };
  }
}

function toolingCommand(
  id: string,
  argv: string[],
  root: string,
  runner: LocalArgvRunner,
): { command: LocalToolingCommand; finding?: Finding } {
  let result: LocalArgvResult;
  try {
    result = runner(argv, root);
  } catch (error) {
    result = { exitCode: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
  const ok = result.exitCode === 0;
  return {
    command: {
      id,
      argv: [...argv],
      exit_code: result.exitCode,
      ok,
    },
    ...(ok ? {} : { finding: finding("tooling-check-failed", `${id} exited with status ${result.exitCode}`, "error") }),
  };
}

function runToolingChecks(
  view: RepoView,
  root: string,
  changedFiles: string[],
  enabled: boolean,
  runner: LocalArgvRunner,
): LocalToolingSummary {
  const ownership = installedToolkitPaths(view);
  const changedToolkitFiles = changedFiles.filter((path) => ownership.paths.has(path)).sort((a, b) => a.localeCompare(b));
  const publisher = readConfig(view).publishesKit;
  const config = readConfig(view);
  const shouldRunTooling = changedToolkitFiles.length > 0;
  const commandSpecs: { id: string; argv: string[] }[] = [];
  if (enabled && shouldRunTooling) {
    commandSpecs.push(
      { id: "tooling-typecheck", argv: ["bun", "run", "wiki:tooling:typecheck"] },
      { id: "tooling-test", argv: ["bun", "run", "wiki:tooling:test"] },
    );
  }
  if (enabled && publisher) {
    commandSpecs.push(
      { id: "kit-freshness", argv: ["bun", "run", "wiki:kit", "--", "--check"] },
      { id: "kit-growth", argv: ["bun", "run", "wiki:tooling:guard"] },
    );
  }
  if (enabled && config.version === 2) {
    // These are intentionally the exact argv arrays declared by the project;
    // no shell parsing or inferred test graph is introduced at this boundary.
    for (const check of config.localChecks) commandSpecs.push({ id: check.id, argv: [...check.argv] });
  }
  const findings = [...ownership.findings];
  const uniqueSpecs: { id: string; argv: string[] }[] = [];
  const seenIds = new Map<string, string>();
  for (const spec of commandSpecs) {
    const argvKey = jsonStable(spec.argv);
    const previousArgvKey = seenIds.get(spec.id);
    if (previousArgvKey != null) {
      if (previousArgvKey !== argvKey) {
        findings.push(finding(
          "local-check-id-conflict",
          `local check id ${spec.id} is declared with different argv; resolve the config/tooling command collision before publishing`,
          "error",
        ));
      }
      continue;
    }
    seenIds.set(spec.id, argvKey);
    uniqueSpecs.push(spec);
  }
  const commands: LocalToolingCommand[] = [];
  for (const spec of uniqueSpecs) {
    const outcome = toolingCommand(spec.id, spec.argv, root, runner);
    commands.push(outcome.command);
    if (outcome.finding) findings.push(outcome.finding);
  }
  return {
    selected: uniqueSpecs.length > 0,
    changed_files: changedToolkitFiles,
    commands,
    findings,
    ok: !findings.some((item) => item.severity === "error"),
  };
}

export function localCheckDirtyPaths(root: string, allowedFiles: string[] = []): string[] {
  const allowed = new Set(allowedFiles.map((path) => resolve(root, path)));
  return dirtyPaths(root).filter((path) => !allowed.has(resolve(root, path)));
}

function asImpactSummary(report: ImpactReport, view: RepoView, pages: WikiPage[], metadata?: PrMetadata): LocalImpactSummary {
  return {
    base: report.base,
    merge_base: report.mergeBase,
    changed_files: [...report.changedFiles].sort((a, b) => a.localeCompare(b)),
    affected_pages: [...report.affectedPages].sort((a, b) => a.localeCompare(b)),
    affected_invariants: affectedInvariantIdsForReview(view, pages, report, metadata),
    affected_conflicts: report.affectedConflicts.map((item) => item.id).sort((a, b) => a.localeCompare(b)),
    removed_current_pages: report.removedCurrentPages.map((item) => item.id).sort((a, b) => a.localeCompare(b)),
    stale_pages: [...report.stalePages].sort((a, b) => a.localeCompare(b)),
    high_risk_stale_pages: [...report.highRiskStalePages].sort((a, b) => a.localeCompare(b)),
    advisory_stale_pages: [...report.advisoryStalePages].sort((a, b) => a.localeCompare(b)),
    unmapped_high_risk: [...report.unmappedHighRisk].sort((a, b) => a.localeCompare(b)),
    findings: [...report.findings],
  };
}

function reviewStatus(result: ReviewCheckResult, reportRaw: string | undefined): LocalReviewStatus {
  if (!result.required) return "not-required";
  if (reportRaw == null) return "review-required";
  if (result.ok) return "pass";
  const verdict = result.report?.verdict;
  return verdict === "NEEDS_RECONCILE" ? "needs-reconcile" : "invalid-report";
}

function asReviewSummary(result: ReviewCheckResult, reportRaw: string | undefined): LocalReviewSummary {
  return {
    ok: result.ok,
    required: result.required,
    status: reviewStatus(result, reportRaw),
    mode: result.mode,
    requirement_reasons: [...result.requirementReasons],
    findings: [...result.findings],
    affected_invariants: [...result.manifest.affected_invariant_ids].sort((a, b) => a.localeCompare(b)),
    affected_conflicts: [...result.manifest.affected_conflict_ids].sort((a, b) => a.localeCompare(b)),
    ...(result.report ? {
      bundle_digest: result.report.bundle_digest,
      reviewed_head_sha: result.report.reviewed_head_sha,
      reviewer: result.report.reviewer,
    } : { bundle_digest: result.manifest.bundle_digest }),
  };
}

function safeReport(reportRaw: string | undefined): unknown {
  if (reportRaw == null) return undefined;
  return parseFreshContextReport(reportRaw).report ?? reportRaw;
}

/**
 * Run the canonical local gate. This path deliberately composes the existing
 * validators, keeping the legacy command projections and v1 review semantics
 * intact while producing one exact, publishable result envelope.
 */
export function runLocalCheck(options: LocalCheckOptions): LocalCheckResult {
  const root = resolve(options.root);
  const headSha = gitShaSafe(root, "HEAD");
  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new UsageError("canonical local check requires a committed HEAD");
  const baseRef = resolveDiffBase(root, options.base);
  const baseSha = gitShaSafe(root, baseRef);
  if (!/^[0-9a-f]{40}$/.test(baseSha)) throw new UsageError(`canonical local check could not resolve base revision: ${baseRef}`);
  const mergeBaseSha = git(root, ["merge-base", baseRef, "HEAD"], true).trim();
  if (!/^[0-9a-f]{40}$/.test(mergeBaseSha)) throw new UsageError(`canonical local check could not resolve merge-base for ${baseRef}`);
  const dirty = options.dirtyPaths ?? localCheckDirtyPaths(root);
  const dirtyFindings = dirty.map((path) => finding("local-check-dirty", "canonical local check requires a committed candidate HEAD", "error", path));

  const metadataValidation = validatePrMetadata(options.metadataRaw, true, readConfig(options.view));
  const metadataDigest = hashContent(jsonStable(canonicalPrMetadata(metadataValidation.metadata)));
  const metadataFindings = metadataValidation.findings;

  let structuralPages = options.pages;
  let structuralFindings: Finding[] = [];
  try {
    const lint = allLintFindings(options.view, true);
    structuralPages = lint.pages;
    structuralFindings = [...lint.findings, ...(options.inventoryFindings ?? []), ...metadataFindings];
  } catch (error) {
    structuralFindings = [finding("local-check-structural-error", error instanceof Error ? error.message : String(error), "error"), ...metadataFindings];
  }

  let impact: LocalImpactSummary;
  let impactFindings: Finding[] = [];
  try {
    const report = impactReport(options.view, structuralPages, { base: baseRef, metadata: metadataValidation.metadata });
    impact = asImpactSummary(report, options.view, structuralPages, metadataValidation.metadata);
    impactFindings = [...report.findings];
  } catch (error) {
    impact = {
      base: baseRef,
      merge_base: mergeBaseSha,
      changed_files: [],
      affected_pages: [],
      affected_invariants: [],
      affected_conflicts: [],
      removed_current_pages: [],
      stale_pages: [],
      high_risk_stale_pages: [],
      advisory_stale_pages: [],
      unmapped_high_risk: [],
      findings: [],
    };
    impactFindings = [finding("local-check-impact-error", error instanceof Error ? error.message : String(error), "error")];
    impact.findings = impactFindings;
  }

  const tooling = runToolingChecks(
    options.view,
    root,
    impact.changed_files,
    options.runToolingChecks === true,
    options.argvRunner ?? defaultLocalArgvRunner,
  );

  let stateFindings: Finding[] = [];
  try {
    stateFindings = validateState(options.view, structuralPages).findings;
  } catch (error) {
    stateFindings = [finding("local-check-state-error", error instanceof Error ? error.message : String(error), "error")];
  }

  let review: LocalReviewSummary;
  try {
    const checked = reviewCheck(options.view, structuralPages, {
      base: baseRef,
      metadata: metadataValidation.metadata,
      report: safeReport(options.reportRaw),
      reviewerActor: options.reviewerActor,
      prAuthor: options.prAuthor,
    });
    review = asReviewSummary(checked, options.reportRaw);
  } catch (error) {
    const config = readConfig(options.view);
    review = {
      ok: false,
      required: true,
      status: options.reportRaw == null ? "review-required" : "invalid-report",
      mode: config.version === 1 ? (config.freshContext?.mode ?? "required") : "required",
      requirement_reasons: ["review validation could not complete"],
      findings: [finding("local-check-review-error", error instanceof Error ? error.message : String(error), "error")],
      affected_invariants: [],
      affected_conflicts: [],
    };
  }

  const stateSummary: LocalCheckSummary = { ok: okFindings(stateFindings), findings: stateFindings };
  const structuralSummary: LocalCheckSummary = { ok: okFindings(structuralFindings), findings: structuralFindings };
  const allFindings = [...dirtyFindings, ...structuralFindings, ...stateFindings, ...impactFindings, ...review.findings, ...tooling.findings];
  const warnings = allFindings.filter((item) => item.severity === "warning");
  const ok = !allFindings.some((item) => item.severity === "error") && review.ok;
  const core: Omit<LocalCheckResult, "result_digest"> = {
    version: LOCAL_CHECK_RESULT_VERSION,
    status: ok ? "pass" : "failure",
    ok,
    head_sha: headSha,
    base_ref: baseRef,
    base_sha: baseSha,
    merge_base_sha: mergeBaseSha,
    metadata_digest: metadataDigest,
    checks: {
      structural: structuralSummary,
      state: stateSummary,
      impact: { ...impact, findings: impactFindings },
      review,
      tooling,
    },
    findings: allFindings,
    warnings,
  };
  return { ...core, result_digest: localCheckDigest(core) };
}

export function writeLocalCheckResult(root: string, outputPath: string, result: LocalCheckResult): string {
  const target = resolve(root, outputPath);
  Bun.spawnSync(["mkdir", "-p", dirname(target)]);
  writeFileSync(target, jsonStable(result));
  return target;
}

export function readLocalInput(root: string, path: string | undefined): string | undefined {
  if (!path) return undefined;
  const target = resolve(root, path);
  if (!existsSync(target)) throw new UsageError(`local check input does not exist: ${relative(root, target)}`);
  return readFileSync(target, "utf8");
}
