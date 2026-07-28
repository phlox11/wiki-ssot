#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  UsageError,
  allLintFindings,
  auditReport,
  compareGenerated,
  compareKit,
  conflictSummary,
  createRepoView,
  generatedCoreFiles,
  impactReport,
  isConflictGuardFinding,
  jsonStable,
  kitFiles,
  loadWikiPages,
  makeReviewBundle,
  openConflicts,
  parseFreshContextReport,
  parseFreshContextPolicy,
  readConfig,
  reviewCheck,
  validateIntegrationSeams,
  validatePrMetadata,
  verifyState,
  writeGenerated,
  writeKit,
  type Finding,
  type PrMetadata,
} from "./core";
import { validateGitHubIntegrationSeams } from "./github-attestation";
import { generateInventories } from "./inventories";

type ParsedArgs = { positional: string[]; flags: Map<string, string[]> };

const BOOLEAN_FLAGS = new Set(["json", "staged", "check", "enforce", "enforce-conflicts", "all"]);

function args(input: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let index = 0; index < input.length; index++) {
    const token = input[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equal = token.indexOf("=");
    const key = equal === -1 ? token.slice(2) : token.slice(2, equal);
    let value = equal === -1 ? undefined : token.slice(equal + 1);
    if (value == null && !BOOLEAN_FLAGS.has(key) && input[index + 1] != null && !input[index + 1].startsWith("--")) value = input[++index];
    flags.set(key, [...(flags.get(key) ?? []), value ?? "true"]);
  }
  return { positional, flags };
}

function has(parsed: ParsedArgs, key: string): boolean {
  return parsed.flags.has(key);
}

function one(parsed: ParsedArgs, key: string): string | undefined {
  return parsed.flags.get(key)?.at(-1);
}

function many(parsed: ParsedArgs, key: string): string[] {
  return parsed.flags.get(key) ?? [];
}

function printFindings(findings: Finding[]) {
  for (const finding of findings) {
    const location = finding.path ? `${finding.path}: ` : "";
    console.error(`${finding.severity.toUpperCase()} [${finding.code}] ${location}${finding.message}`);
  }
}

function emit(value: unknown, json: boolean) {
  if (json) process.stdout.write(jsonStable(value));
  else if (typeof value === "string") process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage(): never {
  throw new UsageError("usage: bun scripts/wiki/cli.ts <lint|inventory|index|generated|kit|search|conflicts|context|impact|verify|review-preflight|review-bundle|review-check|doctor|check|audit> [options]");
}

async function main() {
  const parsed = args(process.argv.slice(2));
  const command = parsed.positional.shift() ?? usage();
  const json = has(parsed, "json");
  const staged = has(parsed, "staged");
  const view = createRepoView(resolve(one(parsed, "root") ?? process.cwd()), staged);
  const loaded = loadWikiPages(view);

  if (command === "lint") {
    const result = allLintFindings(view, true);
    if (json) emit({ ok: !result.findings.some((item) => item.severity === "error"), mode: view.mode, findings: result.findings }, true);
    else {
      printFindings(result.findings);
      if (result.findings.length === 0) console.log(`wiki lint passed (${view.mode})`);
    }
    process.exitCode = result.findings.some((item) => item.severity === "error") ? 1 : 0;
    return;
  }

  if (command === "doctor") {
    const findings = [...validateIntegrationSeams(view), ...validateGitHubIntegrationSeams(view)];
    const ok = !findings.some((item) => item.severity === "error");
    if (json) emit({ ok, findings }, true);
    else {
      printFindings(findings);
      if (ok) console.log("wiki integration doctor passed");
    }
    process.exitCode = ok ? 0 : 1;
    return;
  }

  if (loaded.findings.some((item) => item.severity === "error")) {
    if (json) emit({ ok: false, findings: loaded.findings }, true);
    else printFindings(loaded.findings);
    process.exitCode = 1;
    return;
  }

  if (command === "inventory") {
    if (staged) throw new UsageError("inventory does not write in --staged mode");
    const files = generateInventories(view);
    writeGenerated(view.root, files);
    emit(json ? { written: Object.keys(files).sort() } : `wrote ${Object.keys(files).length} inventory files`, json);
    return;
  }

  if (command === "index") {
    if (staged) throw new UsageError("index does not write in --staged mode");
    const files = generatedCoreFiles(loaded.pages, readConfig(view).name);
    writeGenerated(view.root, files);
    emit(json ? { written: Object.keys(files).sort() } : `wrote ${Object.keys(files).length} index files`, json);
    return;
  }

  if (command === "generated") {
    const expected = { ...generatedCoreFiles(loaded.pages, readConfig(view).name), ...generateInventories(view) };
    if (has(parsed, "check") || staged) {
      const findings = compareGenerated(view, expected);
      if (json) emit({ ok: findings.length === 0, findings }, true);
      else printFindings(findings);
      process.exitCode = findings.length > 0 ? 1 : 0;
    } else {
      writeGenerated(view.root, expected);
      emit(json ? { written: Object.keys(expected).sort() } : `wrote ${Object.keys(expected).length} generated files`, json);
    }
    return;
  }

  if (command === "kit") {
    const { files, findings: sourceFindings } = kitFiles(view);
    if (has(parsed, "check") || staged) {
      const findings = [...sourceFindings, ...compareKit(view, files)];
      if (json) emit({ ok: findings.length === 0, findings }, true);
      else printFindings(findings);
      process.exitCode = findings.length > 0 ? 1 : 0;
      return;
    }
    if (sourceFindings.length > 0) {
      // A kit written from an unreadable source would publish a silently
      // incomplete payload, so refuse rather than emit a partial one.
      if (json) emit({ ok: false, findings: sourceFindings }, true);
      else printFindings(sourceFindings);
      process.exitCode = 1;
      return;
    }
    const result = writeKit(view, files);
    emit(json ? result : `wrote ${result.written.length} kit files${result.removed.length > 0 ? `, removed ${result.removed.length}` : ""}`, json);
    return;
  }

  if (command === "audit") {
    const report = auditReport(view, loaded.pages, generateInventories(view));
    if (json) emit(report, true);
    else {
      printFindings(report.findings);
      console.log(report.ok
        ? `wiki audit passed (${report.highRiskStalePages.length} high-risk stale, ${report.advisoryStalePages.length} low-risk stale, ${report.openConflicts.length} open conflicts)`
        : `wiki audit failed (${report.findings.filter((item) => item.severity === "error").length} errors)`);
    }
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  if (command === "search") {
    const query = parsed.positional.join(" ").trim() || one(parsed, "query")?.trim();
    if (!query) throw new UsageError("search requires a query");
    const terms = query.toLowerCase().split(/\s+/);
    const matches = loaded.pages.map((page) => {
      const haystack = `${page.data.id} ${page.data.summary} ${(page.data.tags ?? []).join(" ")} ${page.body}`.toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { id: page.data.id, path: page.path, summary: page.data.summary, status: page.data.status, score };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    if (json) emit({ query, matches }, true);
    else emit(matches.map((item) => `${item.id}\t${item.status}\t${item.path}\t${item.summary}`).join("\n") || "no matches", false);
    return;
  }

  if (command === "conflicts") {
    const requested = parsed.positional[0]?.toUpperCase();
    const candidates = has(parsed, "all") ? loaded.pages.filter((page) => page.data.kind === "conflict") : openConflicts(loaded.pages);
    const selected = requested ? candidates.filter((page) => page.data.conflict_id === requested || page.data.id.toUpperCase() === requested) : candidates;
    if (requested && selected.length === 0) throw new UsageError(`unknown ${has(parsed, "all") ? "" : "open "}conflict: ${requested}`);
    const conflicts = selected.map(conflictSummary);
    if (json) emit({ open: openConflicts(loaded.pages).length, conflicts }, true);
    else if (requested) {
      const item = conflicts[0];
      emit([
        `${item.id} [${item.severity}, ${item.type}, ${item.state}]`,
        item.summary,
        `Owner: ${item.owner.join(", ")}`,
        `Page: ${item.path}`,
        `Affected pages: ${item.affectedPages.join(", ") || "none"}`,
        `Affected invariants: ${item.affectedInvariants.join(", ") || "none"}`,
        "Acceptance:",
        ...item.acceptance.map((criterion) => `- ${criterion}`),
      ].join("\n"), false);
    } else {
      const groups = (["high", "medium", "low"] as const).flatMap((severity) => {
        const items = conflicts.filter((item) => item.severity === severity);
        return items.length === 0 ? [] : [severity.toUpperCase(), ...items.map((item) => `${item.id}\t${item.type}\t${item.state}\t${item.summary}`), ""];
      });
      emit([`Open conflicts: ${conflicts.length}`, "", ...groups].join("\n").trimEnd(), false);
    }
    return;
  }

  if (command === "context") {
    const query = parsed.positional.join(" ").trim() || one(parsed, "query")?.trim();
    const requestedConflict = one(parsed, "conflict")?.toUpperCase();
    const ids = new Set<string>();
    const conflictIds = new Set<string>();
    if (requestedConflict) {
      const page = loaded.pages.find((item) => item.data.kind === "conflict" && (item.data.conflict_id === requestedConflict || item.data.id.toUpperCase() === requestedConflict));
      if (!page) throw new UsageError(`unknown conflict: ${requestedConflict}`);
      conflictIds.add(page.data.conflict_id!);
      for (const id of page.data.affected_pages ?? []) ids.add(id);
      for (const id of page.data.affected_invariants ?? []) ids.add(id);
    } else if (query) {
      const terms = query.toLowerCase().split(/\s+/);
      for (const page of loaded.pages) {
        const text = `${page.data.id} ${page.data.summary} ${(page.data.tags ?? []).join(" ")} ${page.body}`.toLowerCase();
        if (!terms.some((term) => text.includes(term))) continue;
        if (page.data.kind === "conflict") conflictIds.add(page.data.conflict_id!);
        else ids.add(page.data.id);
      }
    } else {
      const report = impactReport(view, loaded.pages, { base: one(parsed, "base") });
      for (const id of report.affectedPages) ids.add(id);
      for (const conflict of report.affectedConflicts) conflictIds.add(conflict.id);
    }
    if (!requestedConflict) {
      for (const page of openConflicts(loaded.pages)) {
        if ((page.data.affected_pages ?? []).some((id) => ids.has(id)) || (page.data.affected_invariants ?? []).some((id) => ids.has(id))) conflictIds.add(page.data.conflict_id!);
      }
    }
    for (const conflictId of conflictIds) {
      const conflict = loaded.pages.find((page) => page.data.kind === "conflict" && page.data.conflict_id === conflictId);
      for (const id of conflict?.data.affected_pages ?? []) ids.add(id);
      for (const id of conflict?.data.affected_invariants ?? []) ids.add(id);
    }
    const pages = loaded.pages.filter((page) => page.data.kind !== "conflict" && ids.has(page.data.id)).map((page) => ({ id: page.data.id, path: page.path, summary: page.data.summary, sources: page.data.sources, body: page.body }));
    const conflicts = openConflicts(loaded.pages).filter((page) => conflictIds.has(page.data.conflict_id!)).map(conflictSummary);
    if (json) emit({ query: query ?? null, requestedConflict: requestedConflict ?? null, conflicts, pages }, true);
    else {
      const conflictText = conflicts.map((item) => `# OPEN CONFLICT ${item.id} [${item.severity}, ${item.type}, ${item.state}]\n\n${item.summary}\n\nSource file: ${item.path}\n\nAcceptance:\n${item.acceptance.map((criterion) => `- ${criterion}`).join("\n")}\n`).join("\n---\n\n");
      const pageText = pages.map((page) => `# ${page.id}\n\nSource file: ${page.path}\n\n${page.body.trim()}\n`).join("\n---\n\n");
      emit([conflictText, pageText].filter(Boolean).join("\n---\n\n") || "no context pages or conflicts", false);
    }
    return;
  }

  if (command === "impact") {
    const metadataPath = one(parsed, "metadata");
    const metadataRaw = metadataPath ? readFileSync(metadataPath, "utf8") : process.env.WIKI_PR_BODY;
    const validated = validatePrMetadata(metadataRaw, metadataPath != null || process.env.GITHUB_EVENT_NAME === "pull_request");
    const report = impactReport(view, loaded.pages, { base: one(parsed, "base"), metadata: validated.metadata });
    report.findings.unshift(...validated.findings);
    emit(report, json);
    if ((has(parsed, "enforce") && report.findings.some((item) => item.severity === "error")) || (has(parsed, "enforce-conflicts") && report.findings.some(isConflictGuardFinding))) process.exitCode = 1;
    return;
  }

  if (command === "verify") {
    if (staged) throw new UsageError("verify cannot update the Git index snapshot");
    const reason = one(parsed, "unchanged");
    const state = verifyState(view, loaded.pages, many(parsed, "page"), reason === "true" ? "" : reason);
    writeFileSync(`${view.root}/.wiki/state.json`, jsonStable(state));
    emit(json ? { updated: Object.keys(state.pages).sort() } : `verified ${Object.keys(state.pages).length} page states`, json);
    return;
  }

  if (command === "review-preflight") {
    if (staged) throw new UsageError("review-preflight requires a working repository");
    const metadataPath = one(parsed, "metadata");
    const reportPath = one(parsed, "report");
    const outputPath = one(parsed, "output");
    const allowedFiles = new Set([metadataPath, reportPath].filter((path): path is string => path != null).map((path) => resolve(view.root, path)));
    const allowedOutput = outputPath ? resolve(view.root, outputPath) : undefined;
    const isAllowedLocalArtifact = (path: string) => {
      const absolute = resolve(view.root, path);
      if (allowedFiles.has(absolute)) return true;
      if (!allowedOutput) return false;
      const nested = relative(allowedOutput, absolute);
      return nested === "" || (!nested.startsWith("..") && !isAbsolute(nested));
    };
    const gitPaths = (command: string[]) => {
      const result = Bun.spawnSync(["git", ...command], { cwd: view.root, stdout: "pipe", stderr: "pipe" });
      if (result.exitCode !== 0) throw new UsageError(result.stderr.toString().trim() || `git ${command.join(" ")} failed`);
      return result.stdout.toString().split("\0").filter(Boolean);
    };
    const dirtyPaths = [...new Set([
      ...gitPaths(["diff", "--name-only", "-z", "HEAD"]),
      ...gitPaths(["ls-files", "--others", "--exclude-standard", "-z"]),
    ].filter((path) => !isAllowedLocalArtifact(path)))].sort((a, b) => a.localeCompare(b));
    if (dirtyPaths.length > 0) {
      const findings: Finding[] = dirtyPaths.map((path) => ({
        code: "fresh-context-preflight-dirty",
        message: "preflight requires a committed candidate HEAD; commit this change before generating the review bundle",
        path,
        severity: "error",
      }));
      const result = { ok: false, ready: false, status: "invalid-candidate", findings };
      if (json) emit(result, true);
      else printFindings(findings);
      process.exitCode = 1;
      return;
    }
    const metadataRaw = metadataPath ? readFileSync(metadataPath, "utf8") : process.env.WIKI_PR_BODY;
    const validated = validatePrMetadata(metadataRaw, true);
    if (validated.findings.some((item) => item.severity === "error")) {
      const result = { ok: false, ready: false, status: "invalid-metadata", findings: validated.findings };
      if (json) emit(result, true);
      else printFindings(validated.findings);
      process.exitCode = 1;
      return;
    }

    // The PR-body fresh_context block is only a publication mirror. Preflight
    // validates the independent report before that mirror is populated.
    const semanticMetadata: PrMetadata = { ...validated.metadata };
    delete semanticMetadata.fresh_context;

    const policyPath = one(parsed, "policy-file");
    let policy;
    if (policyPath) {
      try {
        const raw = JSON.parse(readFileSync(policyPath, "utf8")) as { freshContext?: unknown };
        policy = parseFreshContextPolicy(raw.freshContext);
      } catch {
        policy = undefined;
      }
      if (!policy) {
        const findings: Finding[] = [{ code: "fresh-context-config-invalid", message: "trusted policy file does not contain a valid freshContext policy", path: policyPath, severity: "error" }];
        const result = { ok: false, ready: false, status: "invalid-policy", findings };
        if (json) emit(result, true);
        else printFindings(findings);
        process.exitCode = 1;
        return;
      }
    }

    const reportRaw = reportPath && existsSync(reportPath) ? readFileSync(reportPath, "utf8") : undefined;
    const parsedReportResult = reportRaw == null ? undefined : parseFreshContextReport(reportRaw);
    const parsedReport = parsedReportResult?.report;
    const declaredReviewer = parsedReport != null && typeof parsedReport === "object" && !Array.isArray(parsedReport)
      && typeof (parsedReport as Record<string, unknown>).reviewer === "string"
      ? String((parsedReport as Record<string, unknown>).reviewer)
      : undefined;
    const result = reviewCheck(view, loaded.pages, {
      base: one(parsed, "base"),
      metadata: semanticMetadata,
      report: parsedReport ?? reportRaw,
      reviewerActor: one(parsed, "reviewer-actor") ?? declaredReviewer,
      prAuthor: one(parsed, "pr-author") ?? process.env.WIKI_PR_AUTHOR,
      policy,
    });
    const impactErrors = result.impact.findings.filter((finding) => finding.severity === "error");
    if (impactErrors.length > 0) {
      const output = { ok: false, ready: false, status: "invalid-impact", findings: impactErrors, impact: result.impact, manifest: result.manifest };
      if (json) emit(output, true);
      else printFindings(impactErrors);
      process.exitCode = 1;
      return;
    }
    if (!result.required) {
      const output = {
        ok: true,
        ready: true,
        status: "not-required",
        requirementReasons: result.requirementReasons,
        impact: result.impact,
        manifest: result.manifest,
      };
      emit(json ? output : "preflight ready: Fresh-context review is not required", json);
      return;
    }
    if (reportRaw == null) {
      const directory = makeReviewBundle(view, loaded.pages, result.impact, outputPath, semanticMetadata);
      const output = {
        ok: true,
        ready: false,
        status: "review-required",
        directory,
        manifest: result.manifest,
        requirementReasons: result.requirementReasons,
        nextAction: "Give this bundle to a context-isolated reviewer. Disposition every returned finding — fix it here, track it in an open conflict, or record a named follow-up — then rerun review-preflight with the new bundle/report. Do not invent a product decision to close a finding.",
      };
      emit(json ? output : `preflight review required\nbundle: ${directory}`, json);
      return;
    }
    if (result.ok) {
      const output = {
        ok: true,
        ready: true,
        status: "pass",
        report: result.report,
        manifest: result.manifest,
        requirementReasons: result.requirementReasons,
      };
      emit(json ? output : "preflight ready: independent Fresh-context report passed", json);
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
    if (json) emit(output, true);
    else {
      printFindings(result.findings);
      console.error(output.nextAction);
    }
    process.exitCode = 1;
    return;
  }

  if (command === "review-bundle") {
    if (staged) throw new UsageError("review-bundle requires a working repository");
    const metadataPath = one(parsed, "metadata");
    const metadataRaw = metadataPath ? readFileSync(metadataPath, "utf8") : process.env.WIKI_PR_BODY;
    const validated = validatePrMetadata(metadataRaw, true);
    if (validated.findings.some((item) => item.severity === "error")) {
      if (json) emit({ ok: false, findings: validated.findings }, true);
      else printFindings(validated.findings);
      process.exitCode = 1;
      return;
    }
    const report = impactReport(view, loaded.pages, { base: one(parsed, "base"), metadata: validated.metadata });
    report.findings.unshift(...validated.findings);
    const directory = makeReviewBundle(view, loaded.pages, report, one(parsed, "output"), validated.metadata);
    const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, "utf8"));
    emit(json ? { directory, manifest, verdicts: ["PASS", "NEEDS_RECONCILE"] } : directory, json);
    return;
  }

  if (command === "review-check") {
    if (staged) throw new UsageError("review-check requires a working repository");
    const metadataPath = one(parsed, "metadata");
    const metadataRaw = metadataPath ? readFileSync(metadataPath, "utf8") : process.env.WIKI_PR_BODY;
    const validated = validatePrMetadata(metadataRaw, true);
    if (validated.findings.some((item) => item.severity === "error")) {
      if (json) emit({ ok: false, findings: validated.findings }, true);
      else printFindings(validated.findings);
      process.exitCode = 1;
      return;
    }
    const reportPath = one(parsed, "report");
    const reportRaw = reportPath && existsSync(reportPath) ? readFileSync(reportPath, "utf8") : undefined;
    const parsedReport = reportRaw == null ? undefined : (parseFreshContextReport(reportRaw).report ?? reportRaw);
    const policyPath = one(parsed, "policy-file");
    let policy;
    if (policyPath) {
      try {
        const raw = JSON.parse(readFileSync(policyPath, "utf8")) as { freshContext?: unknown };
        policy = parseFreshContextPolicy(raw.freshContext);
      } catch {
        policy = undefined;
      }
      if (!policy) {
        const findings: Finding[] = [{ code: "fresh-context-config-invalid", message: "trusted policy file does not contain a valid freshContext policy", path: policyPath, severity: "error" }];
        if (json) emit({ ok: false, findings }, true);
        else printFindings(findings);
        process.exitCode = 1;
        return;
      }
    }
    const result = reviewCheck(view, loaded.pages, {
      base: one(parsed, "base"),
      metadata: validated.metadata,
      report: parsedReport,
      reviewerActor: one(parsed, "reviewer-actor") ?? process.env.WIKI_REVIEWER_ACTOR,
      prAuthor: one(parsed, "pr-author") ?? process.env.WIKI_PR_AUTHOR,
      policy,
    });
    if (json) emit(result, true);
    else {
      printFindings(result.findings);
      if (result.ok && result.required) console.log(`fresh-context review check passed (${result.mode})`);
      else if (result.ok) console.log("fresh-context review is not required for this change");
    }
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (command === "check") {
    const lint = allLintFindings(view, true);
    const generated = compareGenerated(view, { ...generatedCoreFiles(lint.pages, readConfig(view).name), ...generateInventories(view) });
    const validated = validatePrMetadata(process.env.WIKI_PR_BODY, process.env.GITHUB_EVENT_NAME === "pull_request");
    const report = impactReport(view, lint.pages, { base: one(parsed, "base"), metadata: validated.metadata });
    report.findings.unshift(...validated.findings);
    const structural = [...lint.findings, ...generated];
    const findings = [...structural, ...report.findings];
    if (json) emit({ ok: !findings.some((item) => item.severity === "error"), findings, impact: report }, true);
    else printFindings(findings);
    if (structural.some((item) => item.severity === "error") || (has(parsed, "enforce") && report.findings.some((item) => item.severity === "error")) || (has(parsed, "enforce-conflicts") && report.findings.some(isConflictGuardFinding))) process.exitCode = 1;
    return;
  }

  usage();
}

try {
  await main();
} catch (error) {
  if (error instanceof UsageError) {
    console.error(error.message);
    process.exitCode = 2;
  } else {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}
