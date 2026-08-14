import { readFileSync, writeFileSync } from "node:fs";
import {
  allLintFindings,
  auditReport,
  compareGenerated,
  generatedCoreFiles,
  impactReport,
  isConflictGuardFinding,
  readConfig,
  validatePrMetadata,
  verifyState,
  writeGenerated,
  jsonStable,
} from "./core";
import { generateInventories } from "./inventories";
import { validateGitHubIntegrationSeams } from "./github-attestation";
import { validateIntegrationSeams } from "./verification";
import { emit, has, many, one, printFindings, type CliContext } from "./cli-runtime";
import type { Finding } from "./model";
import { UsageError } from "./verification";
import { localCheckDirtyPaths, readLocalInput, runLocalCheck, writeLocalCheckResult } from "./local-check";
import { publishLocalStatus } from "./github-local-status";
import { resolve } from "node:path";

export function handleLint(context: CliContext): void {
  const result = allLintFindings(context.view, true);
  if (context.json) emit(context.io, { ok: !result.findings.some((item) => item.severity === "error"), mode: context.view.mode, findings: result.findings }, true);
  else {
    printFindings(context.io, result.findings);
    if (result.findings.length === 0) emit(context.io, `wiki lint passed (${context.view.mode})`, false);
  }
  process.exitCode = result.findings.some((item) => item.severity === "error") ? 1 : 0;
}

export function handleDoctor(context: CliContext): void {
  const findings = [...validateIntegrationSeams(context.view), ...validateGitHubIntegrationSeams(context.view)];
  const ok = !findings.some((item) => item.severity === "error");
  if (context.json) emit(context.io, { ok, findings }, true);
  else {
    printFindings(context.io, findings);
    if (ok) emit(context.io, "wiki integration doctor passed", false);
  }
  process.exitCode = ok ? 0 : 1;
}

export function handleAudit(context: CliContext): void {
  const report = auditReport(context.view, context.loaded.pages, generateInventories(context.view));
  if (context.json) emit(context.io, report, true);
  else {
    printFindings(context.io, report.findings);
    emit(context.io, report.ok
      ? `wiki audit passed (${report.highRiskStalePages.length} high-risk stale, ${report.advisoryStalePages.length} low-risk stale, ${report.openConflicts.length} open conflicts)`
      : `wiki audit failed (${report.findings.filter((item) => item.severity === "error").length} errors)`, false);
  }
  process.exitCode = report.ok ? 0 : 1;
}

export function handleImpact(context: CliContext): void {
  const metadataPath = one(context.parsed, "metadata");
  const metadataRaw = metadataPath ? readFileSync(metadataPath, "utf8") : process.env.WIKI_PR_BODY;
  const validated = validatePrMetadata(metadataRaw, metadataPath != null || process.env.GITHUB_EVENT_NAME === "pull_request");
  const report = impactReport(context.view, context.loaded.pages, { base: one(context.parsed, "base"), metadata: validated.metadata });
  report.findings.unshift(...validated.findings);
  emit(context.io, report, context.json);
  if ((has(context.parsed, "enforce") && report.findings.some((item) => item.severity === "error")) || (has(context.parsed, "enforce-conflicts") && report.findings.some(isConflictGuardFinding))) process.exitCode = 1;
}

export function handleVerify(context: CliContext): void {
  if (context.staged) throw new UsageError("verify cannot update the Git index snapshot");
  const reason = one(context.parsed, "unchanged");
  const state = verifyState(context.view, context.loaded.pages, many(context.parsed, "page"), reason === "true" ? "" : reason);
  writeFileSync(`${context.view.root}/.wiki/state.json`, jsonStable(state));
  emit(context.io, context.json ? { updated: Object.keys(state.pages).sort() } : `verified ${Object.keys(state.pages).length} page states`, context.json);
}

export function handleCheck(context: CliContext): void {
  if (one(context.parsed, "output") != null) {
    handleLocalCheck(context);
    return;
  }
  const lint = allLintFindings(context.view, true);
  const generated = compareGenerated(context.view, { ...generatedCoreFiles(lint.pages, readConfig(context.view).name), ...generateInventories(context.view) });
  const validated = validatePrMetadata(process.env.WIKI_PR_BODY, process.env.GITHUB_EVENT_NAME === "pull_request");
  const report = impactReport(context.view, lint.pages, { base: one(context.parsed, "base"), metadata: validated.metadata });
  report.findings.unshift(...validated.findings);
  const structural = [...lint.findings, ...generated];
  const findings = [...structural, ...report.findings];
  if (context.json) emit(context.io, { ok: !findings.some((item) => item.severity === "error"), findings, impact: report }, true);
  else printFindings(context.io, findings);
  if (structural.some((item) => item.severity === "error") || (has(context.parsed, "enforce") && report.findings.some((item) => item.severity === "error")) || (has(context.parsed, "enforce-conflicts") && report.findings.some(isConflictGuardFinding))) process.exitCode = 1;
}

/** The opt-in canonical local gate. Legacy `wiki:check` output remains above. */
export function handleLocalCheck(context: CliContext): void {
  if (context.staged) throw new UsageError("canonical wiki:check does not support --staged");
  const outputPath = one(context.parsed, "output");
  if (!outputPath || outputPath === "true") throw new UsageError("wiki:check --output requires a result path");
  const metadataPath = one(context.parsed, "metadata");
  const reportPath = one(context.parsed, "report");
  const metadataRaw = readLocalInput(context.root, metadataPath) ?? process.env.WIKI_PR_BODY;
  const reportRaw = readLocalInput(context.root, reportPath);
  const allowed = [metadataPath, reportPath, outputPath].filter((path): path is string => path != null);
  const dirty = localCheckDirtyPaths(context.root, allowed);
  const result = runLocalCheck({
    root: context.root,
    view: context.view,
    pages: context.loaded.pages,
    base: one(context.parsed, "base"),
    metadataRaw,
    reportRaw,
    dirtyPaths: dirty,
    inventoryFindings: compareGenerated(context.view, generateInventories(context.view)),
    // The canonical CLI gate is the only caller that opts into the full
    // toolkit-owned orchestration. Direct/unit callers keep this disabled so
    // they can exercise the aggregate without recursively running the suite.
    runToolingChecks: true,
    reviewerActor: one(context.parsed, "reviewer-actor"),
    prAuthor: one(context.parsed, "pr-author"),
  });
  const written = writeLocalCheckResult(context.root, outputPath, result);
  if (context.json) emit(context.io, { ...result, output: written }, true);
  else {
    printFindings(context.io, result.findings);
    emit(context.io, `${result.ok ? "wiki local check passed" : "wiki local check failed"}; result: ${written}`, false);
  }
  process.exitCode = result.ok ? 0 : 1;
}

export function handlePublish(context: CliContext): void {
  if (context.staged) throw new UsageError("publish requires a working repository");
  const resultPath = one(context.parsed, "result");
  if (!resultPath || resultPath === "true") throw new UsageError("publish requires --result <result.json>");
  const prRaw = one(context.parsed, "pr");
  const pr = prRaw == null || prRaw === "true" ? undefined : Number(prRaw);
  if (prRaw != null && (!Number.isInteger(pr) || (pr as number) <= 0)) throw new UsageError("--pr must be a positive pull request number");
  const published = publishLocalStatus({
    root: context.root,
    resultPath: resolve(context.root, resultPath),
    repo: one(context.parsed, "repo"),
    pr,
  });
  emit(context.io, context.json ? published : `published ${published.state} ${published.status_context} for ${published.repo}#${published.pr} (${published.comment} marker comment)`, context.json);
}

export type ValidationHandler = (context: CliContext) => void;

export const validationHandlers: Record<string, ValidationHandler> = {
  lint: handleLint,
  doctor: handleDoctor,
  audit: handleAudit,
  impact: handleImpact,
  verify: handleVerify,
  check: handleCheck,
  publish: handlePublish,
};
