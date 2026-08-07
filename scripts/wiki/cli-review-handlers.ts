import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { emit, has, isAllowedLocalArtifact, one, printFindings, type CliContext } from "./cli-runtime";
import { impactReport, validatePrMetadata, type PrMetadata } from "./impact";
import { makeReviewBundle } from "./review-bundle";
import { parseFreshContextReport, reviewCheck } from "./review-attestation";
import { parseFreshContextPolicy, UsageError } from "./verification";
import type { Finding } from "./model";

function readPolicy(context: CliContext, path: string | undefined) {
  if (!path) return undefined;
  let policy;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { freshContext?: unknown };
    policy = parseFreshContextPolicy(raw.freshContext);
  } catch {
    policy = undefined;
  }
  if (!policy) {
    const findings: Finding[] = [{ code: "fresh-context-config-invalid", message: "trusted policy file does not contain a valid freshContext policy", path, severity: "error" }];
    if (context.json) emit(context.io, { ok: false, findings }, true);
    else printFindings(context.io, findings);
    process.exitCode = 1;
    return null;
  }
  return policy;
}

function gitPaths(context: CliContext, command: string[]): string[] {
  const result = Bun.spawnSync(["git", ...command], { cwd: context.view.root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new UsageError(result.stderr.toString().trim() || `git ${command.join(" ")} failed`);
  return result.stdout.toString().split("\0").filter(Boolean);
}

function dirtyCandidatePaths(context: CliContext, metadataPath: string | undefined, reportPath: string | undefined, outputPath: string | undefined): string[] {
  const allowedFiles = new Set([metadataPath, reportPath].filter((path): path is string => path != null).map((path) => resolve(context.view.root, path)));
  const allowedOutput = outputPath ? resolve(context.view.root, outputPath) : undefined;
  const dirty = [...new Set([
    ...gitPaths(context, ["diff", "--name-only", "-z", "HEAD"]),
    ...gitPaths(context, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ].filter((path) => !isAllowedLocalArtifact(context.view.root, allowedFiles, allowedOutput, path)))].sort((a, b) => a.localeCompare(b));
  return dirty;
}

export function handleReviewPreflight(context: CliContext): void {
  if (context.staged) throw new UsageError("review-preflight requires a working repository");
  const metadataPath = one(context.parsed, "metadata");
  const reportPath = one(context.parsed, "report");
  const outputPath = one(context.parsed, "output");
  const dirtyPaths = dirtyCandidatePaths(context, metadataPath, reportPath, outputPath);
  if (dirtyPaths.length > 0) {
    const findings: Finding[] = dirtyPaths.map((path) => ({ code: "fresh-context-preflight-dirty", message: "preflight requires a committed candidate HEAD; commit this change before generating the review bundle", path, severity: "error" }));
    const result = { ok: false, ready: false, status: "invalid-candidate", findings };
    if (context.json) emit(context.io, result, true);
    else printFindings(context.io, findings);
    process.exitCode = 1;
    return;
  }
  const metadataRaw = metadataPath ? readFileSync(metadataPath, "utf8") : process.env.WIKI_PR_BODY;
  const validated = validatePrMetadata(metadataRaw, true);
  if (validated.findings.some((item) => item.severity === "error")) {
    const result = { ok: false, ready: false, status: "invalid-metadata", findings: validated.findings };
    if (context.json) emit(context.io, result, true);
    else printFindings(context.io, validated.findings);
    process.exitCode = 1;
    return;
  }
  const semanticMetadata: PrMetadata = { ...validated.metadata };
  delete semanticMetadata.fresh_context;
  const policyPath = one(context.parsed, "policy-file");
  const policy = readPolicy(context, policyPath);
  if (policy === null) return;
  const reportRaw = reportPath && existsSync(reportPath) ? readFileSync(reportPath, "utf8") : undefined;
  const parsedReportResult = reportRaw == null ? undefined : parseFreshContextReport(reportRaw);
  const parsedReport = parsedReportResult?.report;
  const declaredReviewer = parsedReport != null && typeof parsedReport === "object" && !Array.isArray(parsedReport)
    && typeof (parsedReport as Record<string, unknown>).reviewer === "string"
    ? String((parsedReport as Record<string, unknown>).reviewer)
    : undefined;
  const result = reviewCheck(context.view, context.loaded.pages, {
    base: one(context.parsed, "base"),
    metadata: semanticMetadata,
    report: parsedReport ?? reportRaw,
    reviewerActor: one(context.parsed, "reviewer-actor") ?? declaredReviewer,
    prAuthor: one(context.parsed, "pr-author") ?? process.env.WIKI_PR_AUTHOR,
    policy,
  });
  const impactErrors = result.impact.findings.filter((finding) => finding.severity === "error");
  if (impactErrors.length > 0) {
    const output = { ok: false, ready: false, status: "invalid-impact", findings: impactErrors, impact: result.impact, manifest: result.manifest };
    if (context.json) emit(context.io, output, true);
    else printFindings(context.io, impactErrors);
    process.exitCode = 1;
    return;
  }
  if (!result.required) {
    const output = { ok: true, ready: true, status: "not-required", requirementReasons: result.requirementReasons, impact: result.impact, manifest: result.manifest };
    emit(context.io, context.json ? output : "preflight ready: Fresh-context review is not required", context.json);
    return;
  }
  if (reportRaw == null) {
    const directory = makeReviewBundle(context.view, context.loaded.pages, result.impact, outputPath, semanticMetadata);
    const output = {
      ok: true,
      ready: false,
      status: "review-required",
      directory,
      manifest: result.manifest,
      requirementReasons: result.requirementReasons,
      nextAction: "Give this bundle to a context-isolated reviewer. Disposition every returned finding — fix it here, track it in an open conflict, or record a named follow-up — then rerun review-preflight with the new bundle/report. Do not invent a product decision to close a finding.",
    };
    emit(context.io, context.json ? output : `preflight review required\nbundle: ${directory}`, context.json);
    return;
  }
  if (result.ok) {
    const output = { ok: true, ready: true, status: "pass", report: result.report, manifest: result.manifest, requirementReasons: result.requirementReasons };
    emit(context.io, context.json ? output : "preflight ready: independent Fresh-context report passed", context.json);
    return;
  }
  const reportVerdict = parsedReport != null && typeof parsedReport === "object" && !Array.isArray(parsedReport)
    ? (parsedReport as Record<string, unknown>).verdict
    : undefined;
  const status = reportVerdict === "NEEDS_RECONCILE" ? "needs-reconcile" : "invalid-report";
  const output = {
    ok: false,
    ready: false,
    status,
    report: result.report ?? parsedReport,
    findings: result.findings,
    manifest: result.manifest,
    nextAction: status === "needs-reconcile"
      ? "Disposition each finding against its acceptance criteria: fix what this candidate broke or declared, open or link a conflict for a pre-existing mismatch or undecided intent, and record a follow-up for an out-of-scope defect. Rerun deterministic checks, then generate a new bundle for the new HEAD."
      : "Replace the malformed, stale, or untrusted report with one produced from the current bundle.",
  };
  if (context.json) emit(context.io, output, true);
  else {
    printFindings(context.io, result.findings);
    context.io.stderr(`${output.nextAction}\n`);
  }
  process.exitCode = 1;
}

export function handleReviewBundle(context: CliContext): void {
  if (context.staged) throw new UsageError("review-bundle requires a working repository");
  const metadataPath = one(context.parsed, "metadata");
  const metadataRaw = metadataPath ? readFileSync(metadataPath, "utf8") : process.env.WIKI_PR_BODY;
  const validated = validatePrMetadata(metadataRaw, true);
  if (validated.findings.some((item) => item.severity === "error")) {
    if (context.json) emit(context.io, { ok: false, findings: validated.findings }, true);
    else printFindings(context.io, validated.findings);
    process.exitCode = 1;
    return;
  }
  const report = impactReport(context.view, context.loaded.pages, { base: one(context.parsed, "base"), metadata: validated.metadata });
  report.findings.unshift(...validated.findings);
  const directory = makeReviewBundle(context.view, context.loaded.pages, report, one(context.parsed, "output"), validated.metadata);
  const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, "utf8"));
  emit(context.io, context.json ? { directory, manifest, verdicts: ["PASS", "NEEDS_RECONCILE"] } : directory, context.json);
}

export function handleReviewCheck(context: CliContext): void {
  if (context.staged) throw new UsageError("review-check requires a working repository");
  const metadataPath = one(context.parsed, "metadata");
  const metadataRaw = metadataPath ? readFileSync(metadataPath, "utf8") : process.env.WIKI_PR_BODY;
  const validated = validatePrMetadata(metadataRaw, true);
  if (validated.findings.some((item) => item.severity === "error")) {
    if (context.json) emit(context.io, { ok: false, findings: validated.findings }, true);
    else printFindings(context.io, validated.findings);
    process.exitCode = 1;
    return;
  }
  const reportPath = one(context.parsed, "report");
  const reportRaw = reportPath && existsSync(reportPath) ? readFileSync(reportPath, "utf8") : undefined;
  const parsedReport = reportRaw == null ? undefined : (parseFreshContextReport(reportRaw).report ?? reportRaw);
  const policy = readPolicy(context, one(context.parsed, "policy-file"));
  if (policy === null) return;
  const result = reviewCheck(context.view, context.loaded.pages, {
    base: one(context.parsed, "base"),
    metadata: validated.metadata,
    report: parsedReport,
    reviewerActor: one(context.parsed, "reviewer-actor") ?? process.env.WIKI_REVIEWER_ACTOR,
    prAuthor: one(context.parsed, "pr-author") ?? process.env.WIKI_PR_AUTHOR,
    policy,
  });
  if (context.json) emit(context.io, result, true);
  else {
    printFindings(context.io, result.findings);
    if (result.ok && result.required) emit(context.io, `fresh-context review check passed (${result.mode})`, false);
    else if (result.ok) emit(context.io, "fresh-context review is not required for this change", false);
  }
  process.exitCode = result.ok ? 0 : 1;
}

export type ReviewHandler = (context: CliContext) => void;

export const reviewHandlers: Record<string, ReviewHandler> = {
  "review-preflight": handleReviewPreflight,
  "review-bundle": handleReviewBundle,
  "review-check": handleReviewCheck,
};
