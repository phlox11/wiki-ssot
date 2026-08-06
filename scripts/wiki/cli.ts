#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  UsageError,
  allLintFindings,
  buildCompactTopicCandidateContext,
  buildPageContext,
  buildSelectedWorkContext,
  buildReusableWorkContextArtifact,
  buildTopicContext,
  auditReport,
  buildWorkQueue,
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
  projectWorkQueue,
  projectSelectedWorkContext,
  projectTopicContext,
  readConfig,
  reviewCheck,
  searchWikiPages,
  validateIntegrationSeams,
  validatePages,
  validatePrMetadata,
  validateReusableWorkContextArtifact,
  verifyState,
  writeGenerated,
  writeKit,
  type Finding,
  type PrMetadata,
  type SelectedWorkContextConflict,
  type SelectedWorkContextPage,
  type CompactContextConflict,
  type CompactContextPage,
  type CompactSelectedWorkContext,
  type CompactTopicContext,
  type WikiSource,
  type WorkExecutorFilter,
  type WorkQueueItem,
} from "./core";
import { validateGitHubIntegrationSeams } from "./github-attestation";
import { generateInventories } from "./inventories";

type ParsedArgs = { positional: string[]; flags: Map<string, string[]> };

const BOOLEAN_FLAGS = new Set(["json", "staged", "check", "enforce", "enforce-conflicts", "all", "full"]);

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
  throw new UsageError("usage: bun scripts/wiki/cli.ts <lint|inventory|index|generated|kit|work|search|conflicts|context|impact|verify|review-preflight|review-bundle|review-check|doctor|check|audit> [options]");
}

function sourceText(sources: WikiSource[]): string {
  if (sources.length === 0) return "- none";
  return sources.map((source) => "path" in source
    ? `- path: ${source.path}${source.symbols?.length ? ` (symbols: ${source.symbols.join(", ")})` : ""}`
    : `- glob: ${source.glob}`).join("\n");
}

function workText(item: WorkQueueItem): string {
  const details = [
    `${item.id} [${item.queue_state}, ${item.priority}]\t${item.title}`,
    `  Executor: ${item.executor}`,
    `  Owner: ${item.owner_page.id} (${item.owner_page.path}; ${item.owner_page.owners.join(", ")})`,
    `  Dependencies: ${item.depends_on.join(", ") || "none"}`,
  ];
  if (item.unmet_dependencies.length > 0) details.push(`  Waiting on: ${item.unmet_dependencies.join(", ")}`);
  if (item.blocker) details.push(`  Blocker: ${item.blocker}`);
  if (item.deferred_reason) details.push(`  Deferred: ${item.deferred_reason}`);
  if (item.evidence.length > 0) details.push(`  Evidence: ${item.evidence.join("; ")}`);
  details.push(`  Context: ${item.context_command}`);
  return details.join("\n");
}

function workHelp(): string {
  return [
    "Usage: bun run wiki:work [--executor agent|human|all] [--all] [--json]",
    "",
    "Executor filters:",
    "  all     show agent, human, and either work (default)",
    "  agent   show agent and either work",
    "  human   show human and either work",
    "",
    "--all includes completed rows in addition to the visible outstanding groups.",
    "Combine --all with --executor to include completed rows for that executor view.",
    "Recommendations are agent auto-selection: human-only work is never recommended.",
  ].join("\n");
}

function contextHelp(): string {
  return [
    "Usage: bun run wiki:context -- \"<terms>\" [--full] [--json]",
    "       bun run wiki:context -- --work <ID> [--full] [--json]",
    "       bun run wiki:context -- --page <ID> [--full] [--json]",
    "       bun run wiki:context -- --conflict C-NNN [--all] [--full] [--json]",
    "",
    "Default topic and selected-work output is compact and body-free.",
    "Use --full for exhaustive page and conflict bodies.",
    "Partial-only topic queries return ordered candidates with focused commands.",
  ].join("\n");
}

function workExecutorFilter(parsed: ParsedArgs): WorkExecutorFilter {
  if (!has(parsed, "executor")) return "all";
  const value = one(parsed, "executor");
  if (value == null || value === "true") throw new UsageError("work --executor requires a value: agent, human, or all");
  if (value === "all" || value === "agent" || value === "human") return value;
  throw new UsageError(`work --executor must be one of agent, human, or all; received ${value || "(missing value)"}`);
}

function exactSourceText(sources: SelectedWorkContextPage["exactSources"]): string {
  if (sources.length === 0) return "- none";
  return sources.map((source) => `- ${source.path}${source.symbols?.length ? ` (symbols: ${source.symbols.join(", ")})` : ""}`).join("\n");
}

function sourceGlobText(globs: SelectedWorkContextPage["sourceGlobs"]): string {
  if (globs.length === 0) return "- none";
  return globs.map((source) => [
    `- ${source.glob}`,
    ...(source.matchedFiles.length > 0 ? source.matchedFiles.map((path) => `  - ${path}`) : ["  - no matches"]),
  ].join("\n")).join("\n");
}

function stringListText(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- none";
}

function contextSourceText(page: SelectedWorkContextPage | SelectedWorkContextConflict | CompactContextPage | CompactContextConflict): string[] {
  return [
    "Relevant open conflicts:",
    stringListText(page.relevantOpenConflicts),
    "",
    "Declared sources:",
    sourceText(page.sources),
    "",
    "Exact sources:",
    exactSourceText(page.exactSources),
    "",
    "Source globs and deterministic matches:",
    sourceGlobText(page.sourceGlobs),
    "",
    "Expanded source files:",
    stringListText(page.sourceFiles),
  ];
}

function contextPageText(page: SelectedWorkContextPage, label: string): string {
  return [
    `# ${label} ${page.id}`,
    "",
    `Kind: ${page.kind}`,
    `Status: ${page.status}`,
    `Authority: ${page.authority}`,
    `Owners: ${page.owners.join(", ")}`,
    `Wiki page: ${page.path}`,
    `Summary: ${page.summary}`,
    "",
    ...contextSourceText(page),
    "",
    page.body.trim(),
    "",
  ].join("\n");
}

function compactContextPageText(page: CompactContextPage, label: string): string {
  return [
    `# ${label} ${page.id}`,
    "",
    `Kind: ${page.kind}`,
    `Status: ${page.status}`,
    `Authority: ${page.authority}`,
    `Owners: ${page.owners.join(", ")}`,
    `Wiki page: ${page.path}`,
    `Summary: ${page.summary}`,
    `Body digest: ${page.bodyDigest}`,
    `Focused context: ${page.focusedCommand}`,
    "",
    ...contextSourceText(page),
    "",
    "Body omitted in compact mode; use the focused context command for full text.",
    "",
  ].join("\n");
}

function compactContextConflictText(conflict: CompactContextConflict, label = "OPEN CONFLICT"): string {
  return [
    `# ${label} ${conflict.id} [${conflict.severity}, ${conflict.type}, ${conflict.state}]`,
    "",
    conflict.summary,
    "",
    `Kind: ${conflict.kind}`,
    `Status: ${conflict.status}`,
    `Authority: ${conflict.authority}`,
    `Owners: ${conflict.owner.join(", ")}`,
    `Wiki page: ${conflict.path}`,
    `Body digest: ${conflict.bodyDigest}`,
    `Focused context: ${conflict.focusedCommand}`,
    "",
    ...contextSourceText(conflict),
    "",
    "Acceptance:",
    ...conflict.acceptance.map((criterion) => `- ${criterion}`),
    "",
    "Body omitted in compact mode; use the focused context command for full text.",
    "",
  ].join("\n");
}

function compactWorkText(context: CompactSelectedWorkContext): string {
  const work = context.work;
  const workSection = [
    `# WORK ${work.id} [${work.queue_state}, ${work.priority}]`,
    "",
    work.title,
    "",
    "Projection: compact",
    `Stored state: ${work.state}`,
    `Executor: ${work.executor}`,
    ...(work.executor === "human"
      ? ["Execution guardrail: This work requires human execution. Agents must not execute it or assume credentials or authority; report the procedure and hand off to a human."]
      : work.executor === "either"
        ? ["Authorization guardrail: Either permits agent or human execution but does not grant additional credentials or authority; follow the existing authority boundary."]
        : ["Authorization guardrail: Executor metadata does not grant credentials or authority; follow the existing authority boundary."]),
    `Owner proposal: ${work.owner_page.id} (${work.owner_page.path})`,
    `Dependencies: ${work.depends_on.join(", ") || "none"}`,
    `Unmet dependencies: ${work.unmet_dependencies.join(", ") || "none"}`,
    ...(work.blocker ? [`Blocker: ${work.blocker}`] : []),
    ...(work.deferred_reason ? [`Deferred reason: ${work.deferred_reason}`] : []),
    `Evidence: ${work.evidence.join("; ") || "none"}`,
    `Next context command: ${work.context_command}`,
    "",
    "Acceptance:",
    ...work.acceptance.map((criterion) => `- ${criterion}`),
    "",
  ].join("\n");
  const readOrderSection = [
    "# AUTHORITATIVE READ ORDER",
    "",
    "Current authority is read before non-current proposal rationale:",
    ...context.readOrder.map((entry, index) => entry.kind === "source"
      ? `${index + 1}. SOURCE ${entry.path} (declared by ${entry.declaredBy.join(", ")})`
      : `${index + 1}. ${entry.kind.toUpperCase()} ${entry.id} (${entry.path})`),
    "",
  ].join("\n");
  const currentSections = context.pages
    .filter((page) => page.kind === "invariant")
    .map((page) => compactContextPageText(page, "CURRENT INVARIANT"));
  const conflictSections = context.conflicts.map((conflict) => compactContextConflictText(conflict));
  const pageSections = context.pages
    .filter((page) => page.kind !== "invariant")
    .map((page) => compactContextPageText(page, "CURRENT PAGE"));
  const ownerSection = compactContextPageText(context.ownerPage, "NON-CURRENT WORK OWNER");
  return [workSection, readOrderSection, ...currentSections, ...conflictSections, ...pageSections, ownerSection].join("\n---\n\n");
}

function compactTopicText(context: CompactTopicContext): string {
  const topicSection = [
    "# TOPIC CONTEXT",
    "",
    `Query: ${context.query}`,
    `Projection: compact (${context.matchMode} match${context.matchMode === "partial" ? ", candidates shown before body expansion" : ""})`,
    "",
  ].join("\n");
  const readOrderSection = [
    "# AUTHORITATIVE READ ORDER",
    "",
    "Current authority and open conflict resolution contracts are read before non-current rationale:",
    ...(context.readOrder.length > 0
      ? context.readOrder.map((entry, index) => entry.kind === "source"
        ? `${index + 1}. SOURCE ${entry.path} (declared by ${entry.declaredBy.join(", ")})`
        : `${index + 1}. ${entry.kind.toUpperCase()} ${entry.id} (${entry.path})`)
      : ["- none"]),
    "",
  ].join("\n");
  const currentSections = context.pages
    .filter((page) => page.kind === "invariant")
    .map((page) => compactContextPageText(page, "CURRENT INVARIANT"));
  const conflictSections = context.conflicts.map((conflict) => compactContextConflictText(conflict));
  const pageSections = context.pages
    .filter((page) => page.kind !== "invariant")
    .map((page) => compactContextPageText(page, "CURRENT PAGE"));
  const rationaleSections = context.nonCurrentPages
    .map((page) => compactContextPageText(page, `NON-CURRENT RATIONALE [${page.status.toUpperCase()}]`));
  const candidateSection = context.candidates.length === 0
    ? ""
    : [
      "# PARTIAL-MATCH CANDIDATES",
      "",
      "Candidates are compact metadata; use each focused command for full page or conflict context.",
      ...context.candidates.map((candidate) => [
        `${candidate.order}. ${candidate.id} [score ${candidate.score}]`,
        `   Kind: ${candidate.kind}`,
        `   Status: ${candidate.status}`,
        `   Authority: ${candidate.authority}`,
        `   Wiki page: ${candidate.path}`,
        `   Summary: ${candidate.summary}`,
        `   Body digest: ${candidate.bodyDigest}`,
        `   Focused context: ${candidate.focusedCommand}`,
      ].join("\n")),
      "",
    ].join("\n");
  if (context.matchMode === "partial") return [topicSection, candidateSection].filter((section) => section.length > 0).join("\n---\n\n");
  return [topicSection, readOrderSection, ...currentSections, ...conflictSections, ...pageSections, ...rationaleSections, candidateSection]
    .filter((section) => section.length > 0)
    .join("\n---\n\n");
}

async function main() {
  const parsed = args(process.argv.slice(2));
  const command = parsed.positional.shift() ?? usage();
  const json = has(parsed, "json");
  const staged = has(parsed, "staged");
  const view = createRepoView(resolve(one(parsed, "root") ?? process.cwd()), staged);
  const loaded = loadWikiPages(view);

  // Work owns a dedicated help surface so executor filtering can be explained
  // without changing the behavior of other commands' --help handling.
  if (command === "work" && has(parsed, "help")) {
    if (parsed.positional.length > 0) throw new UsageError("work --help does not accept a query or work ID");
    emit(workHelp(), false);
    return;
  }

  if (command === "context" && has(parsed, "help")) {
    if (parsed.positional.length > 0) throw new UsageError("context --help does not accept a query or selector");
    emit(contextHelp(), false);
    return;
  }

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
    // This CLI is shipped inside the kit it generates. Without the guard, running
    // it in an adopting repository deletes whatever that project keeps in `kit/`
    // and replaces it with a distribution of their own files.
    if (!readConfig(view).publishesKit) {
      throw new UsageError('kit generation is only for the repository that publishes the distribution; set "publishesKit": true in .wiki/config.json to enable it');
    }
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

  if (command === "work") {
    if (parsed.positional.length > 0) throw new UsageError("work does not accept a query or work ID; run it without arguments, then use context --work <ID>");
    const executor = workExecutorFilter(parsed);
    const findings = validatePages(view, loaded.pages);
    if (findings.length > 0) {
      if (json) emit({ ok: false, findings }, true);
      else printFindings(findings);
      process.exitCode = 1;
      return;
    }
    const queue = projectWorkQueue(buildWorkQueue(loaded.pages), executor);
    const groups = {
      active: queue.groups.active,
      ready: queue.groups.ready,
      waiting: queue.groups.waiting,
      blocked: queue.groups.blocked,
      deferred: queue.groups.deferred,
      ...(has(parsed, "all") ? { done: queue.groups.done } : {}),
    };
    if (json) {
      emit({ version: queue.version, recommended_next: queue.recommended_next, groups, open_conflicts: queue.open_conflicts }, true);
      return;
    }
    const outstanding = queue.groups.active.length + queue.groups.ready.length + queue.groups.waiting.length + queue.groups.blocked.length + queue.groups.deferred.length;
    if (outstanding === 0 && queue.open_conflicts.length === 0 && (!has(parsed, "all") || queue.groups.done.length === 0)) {
      emit("No remaining work.", false);
      return;
    }
    const humanOutstanding = ["active", "ready"]
      .flatMap((group) => queue.groups[group as keyof typeof queue.groups])
      .some((item) => item.executor === "human");
    const lines = [
      queue.recommended_next
        ? `Recommended next: ${queue.recommended_next.id}`
        : humanOutstanding
          ? "Recommended next: none (no agent-recommendable work; human-only work remains visible)"
          : "Recommended next: none",
      "",
    ];
    for (const [heading, items] of [
      ["ACTIVE", queue.groups.active],
      ["READY", queue.groups.ready],
      ["WAITING", queue.groups.waiting],
      ["BLOCKED", queue.groups.blocked],
    ] as const) {
      lines.push(`${heading} (${items.length})`, ...(items.length > 0 ? items.map(workText) : ["none"]), "");
    }
    lines.push(`OPEN DECISION CONFLICTS (${queue.open_conflicts.length})`);
    lines.push(...(queue.open_conflicts.length > 0
      ? queue.open_conflicts.map((item) => `${item.id} [${item.severity}, ${item.type}, ${item.state}]\t${item.summary}\n  Context: bun run wiki:context -- --conflict ${item.id}`)
      : ["none"]), "");
    lines.push(`DEFERRED (${queue.groups.deferred.length})`, ...(queue.groups.deferred.length > 0 ? queue.groups.deferred.map(workText) : ["none"]));
    if (has(parsed, "all")) lines.push("", `DONE (${queue.groups.done.length})`, ...(queue.groups.done.length > 0 ? queue.groups.done.map(workText) : ["none"]));
    else if (queue.groups.done.length > 0) lines.push("", `Completed work hidden: ${queue.groups.done.length}. Run bun run wiki:work -- --all to inspect it.`);
    emit(lines.join("\n").trimEnd(), false);
    return;
  }

  if (command === "search") {
    const query = parsed.positional.join(" ").trim() || one(parsed, "query")?.trim();
    if (!query) throw new UsageError("search requires a query");
    const matches = searchWikiPages(loaded.pages, query).map(({ page, score }) => ({
      id: page.data.id,
      path: page.path,
      summary: page.data.summary,
      status: page.data.status,
      score,
    }));
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
    const requestedWorkInput = one(parsed, "work")?.trim();
    const requestedPageInput = one(parsed, "page")?.trim();
    const artifactPath = one(parsed, "artifact");
    const reusePath = one(parsed, "reuse");
    const artifactMode = artifactPath != null || reusePath != null;
    if (artifactPath && reusePath) throw new UsageError("context --artifact and --reuse are mutually exclusive");
    if (artifactMode && !requestedWorkInput) throw new UsageError("context --artifact/--reuse requires --work <ID>");
    if (requestedWorkInput && (requestedConflict || requestedPageInput || query || (has(parsed, "base") && !artifactMode))) throw new UsageError("context --work cannot be combined with a query, --page, --conflict, or --base unless creating or reusing an artifact");
    if (requestedPageInput && (requestedConflict || requestedWorkInput || query || artifactMode || has(parsed, "base"))) throw new UsageError("context --page cannot be combined with a query, --work, --conflict, --artifact, --reuse, or --base");
    if (artifactMode && (!one(parsed, "base") || !one(parsed, "metadata"))) throw new UsageError("context --artifact/--reuse requires --base <ref> and --metadata <pr-body>");
    if (requestedWorkInput) {
      const findings = validatePages(view, loaded.pages);
      if (findings.length > 0) {
        if (json) emit({ ok: false, findings }, true);
        else printFindings(findings);
        process.exitCode = 1;
        return;
      }
      const queue = buildWorkQueue(loaded.pages);
      const workItems = Object.values(queue.groups).flat();
      const work = workItems.find((item) => item.id === requestedWorkInput)
        ?? workItems.find((item) => item.id.toLowerCase() === requestedWorkInput.toLowerCase());
      if (!work) throw new UsageError(`unknown work item: ${requestedWorkInput}`);
      if (artifactMode) {
        if (staged) throw new UsageError("reusable context artifacts require a working repository");
        const metadataPath = resolve(view.root, one(parsed, "metadata")!);
        const validated = validatePrMetadata(readFileSync(metadataPath, "utf8"), true);
        if (validated.findings.some((item) => item.severity === "error") || !validated.metadata) {
          if (json) emit({ ok: false, findings: validated.findings }, true);
          else printFindings(validated.findings);
          process.exitCode = 1;
          return;
        }
        const allowed = new Set([metadataPath, artifactPath, reusePath]
          .filter((path): path is string => path != null)
          .map((path) => resolve(view.root, path)));
        const reuseArtifactPath = reusePath == null ? undefined : resolve(view.root, reusePath);
        const gitPaths = (command: string[]) => {
          const result = Bun.spawnSync(["git", ...command], { cwd: view.root, stdout: "pipe", stderr: "pipe" });
          if (result.exitCode !== 0) throw new UsageError(result.stderr.toString().trim() || `git ${command.join(" ")} failed`);
          return result.stdout.toString().split("\0").filter(Boolean);
        };
        const dirtyPaths = [...new Set([
          ...gitPaths(["diff", "--name-only", "-z", "HEAD"]),
          ...gitPaths(["ls-files", "--others", "--exclude-standard", "-z"]),
        ].filter((path) => !allowed.has(resolve(view.root, path))))].sort((a, b) => a.localeCompare(b));
        if (dirtyPaths.length > 0) {
          const findings: Finding[] = dirtyPaths.map((path) => ({
            code: "context-artifact-dirty",
            message: "reusable context requires a committed exact HEAD",
            path,
            severity: "error",
          }));
          if (json) emit({ ok: false, findings }, true);
          else printFindings(findings);
          process.exitCode = 1;
          return;
        }
        const artifact = buildReusableWorkContextArtifact(view, loaded.pages, work, {
          base: one(parsed, "base")!,
          metadata: validated.metadata,
        });
        if (reusePath) {
          let candidate: unknown;
          try {
            candidate = JSON.parse(readFileSync(reuseArtifactPath!, "utf8"));
          } catch (error) {
            const findings: Finding[] = [{ code: "context-artifact-malformed", message: error instanceof Error ? error.message : String(error), path: reuseArtifactPath, severity: "error" }];
            if (json) emit({ ok: false, findings }, true);
            else printFindings(findings);
            process.exitCode = 1;
            return;
          }
          const findings = validateReusableWorkContextArtifact(candidate, artifact);
          if (json) emit({
            ok: findings.length === 0,
            artifact_digest: artifact.artifact_digest,
            head_sha: artifact.repository.head_sha,
            findings,
          }, true);
          else if (findings.length === 0) emit(`reusable context valid ${artifact.artifact_digest}\nRead required sources directly in artifact read_order; the artifact does not replace source inspection.`, false);
          else printFindings(findings);
          if (findings.length > 0) process.exitCode = 1;
          return;
        }
        const output = resolve(view.root, artifactPath!);
        const rendered = jsonStable(artifact);
        if (existsSync(output) && readFileSync(output, "utf8") !== rendered) throw new UsageError(`refusing to overwrite different context artifact: ${artifactPath}`);
        writeFileSync(output, rendered);
        if (json) emit({
          ok: true,
          artifact_digest: artifact.artifact_digest,
          path: output,
          head_sha: artifact.repository.head_sha,
          required_sources: artifact.bindings.sources.length,
        }, true);
        else emit([
          `wrote ${output}`,
          `Artifact digest: ${artifact.artifact_digest}`,
          `HEAD: ${artifact.repository.head_sha}`,
          `Required sources: ${artifact.bindings.sources.length}`,
          "Read required sources directly in artifact read_order; the artifact does not replace source inspection.",
        ].join("\n"), false);
        return;
      }
      const context = buildSelectedWorkContext(view, loaded.pages, work);
      if (!has(parsed, "full")) {
        const compact = projectSelectedWorkContext(context, "compact") as CompactSelectedWorkContext;
        if (json) emit(compact, true);
        else emit(compactWorkText(compact), false);
      } else if (json) {
        emit(projectSelectedWorkContext(context, "full"), true);
      } else {
        const workSection = [
          `# WORK ${work.id} [${work.queue_state}, ${work.priority}]`,
          "",
          work.title,
          "",
          `Stored state: ${work.state}`,
          `Executor: ${work.executor}`,
          ...(work.executor === "human"
            ? ["Execution guardrail: This work requires human execution. Agents must not execute it or assume credentials or authority; report the procedure and hand off to a human."]
            : work.executor === "either"
              ? ["Authorization guardrail: Either permits agent or human execution but does not grant additional credentials or authority; follow the existing authority boundary."]
              : ["Authorization guardrail: Executor metadata does not grant credentials or authority; follow the existing authority boundary."]),
          `Owner proposal: ${work.owner_page.id} (${work.owner_page.path})`,
          `Dependencies: ${work.depends_on.join(", ") || "none"}`,
          `Unmet dependencies: ${work.unmet_dependencies.join(", ") || "none"}`,
          ...(work.blocker ? [`Blocker: ${work.blocker}`] : []),
          ...(work.deferred_reason ? [`Deferred reason: ${work.deferred_reason}`] : []),
          `Evidence: ${work.evidence.join("; ") || "none"}`,
          `Next context command: ${work.context_command}`,
          "",
          "Acceptance:",
          ...work.acceptance.map((criterion) => `- ${criterion}`),
          "",
        ].join("\n");
        const readOrderSection = [
          "# AUTHORITATIVE READ ORDER",
          "",
          "Current authority is read before non-current proposal rationale:",
          ...context.readOrder.map((entry, index) => entry.kind === "source"
            ? `${index + 1}. SOURCE ${entry.path} (declared by ${entry.declaredBy.join(", ")})`
            : `${index + 1}. ${entry.kind.toUpperCase()} ${entry.id} (${entry.path})`),
          "",
        ].join("\n");
        const currentSections = [
          ...context.pages.filter((page) => page.kind === "invariant").map((page) => contextPageText(page, "CURRENT INVARIANT")),
        ];
        const conflictSections = context.conflicts.map((item) => [
          `# OPEN CONFLICT ${item.id} [${item.severity}, ${item.type}, ${item.state}]`,
          "",
          item.summary,
          "",
          `Kind: ${item.kind}`,
          `Status: ${item.status}`,
          `Authority: ${item.authority}`,
          `Owners: ${item.owner.join(", ")}`,
          `Wiki page: ${item.path}`,
          "",
          ...contextSourceText(item),
          "",
          "Acceptance:",
          ...item.acceptance.map((criterion) => `- ${criterion}`),
          "",
          item.body.trim(),
          "",
        ].join("\n"));
        const pageSections = context.pages
          .filter((page) => page.kind !== "invariant")
          .map((page) => contextPageText(page, "CURRENT PAGE"));
        const sourceSection = [
          "# SOURCE READ ORDER",
          "",
          ...context.readOrder.filter((entry) => entry.kind === "source").map((entry) => `- ${entry.path} (declared by ${entry.declaredBy.join(", ")})`),
          "",
        ].join("\n");
        const ownerSection = contextPageText(context.ownerPage, "NON-CURRENT WORK OWNER");
        emit([workSection, readOrderSection, ...currentSections, ...conflictSections, ...pageSections, sourceSection, ownerSection].join("\n---\n\n"), false);
      }
      return;
    }
    if (requestedPageInput) {
      let context;
      try {
        context = buildPageContext(view, loaded.pages, requestedPageInput);
      } catch (error) {
        throw new UsageError(error instanceof Error ? error.message : String(error));
      }
      if (!has(parsed, "full")) {
        const compact = projectTopicContext(context, "compact") as CompactTopicContext;
        if (json) emit(compact, true);
        else emit(compactTopicText(compact), false);
      } else if (json) {
        emit(projectTopicContext(context, "full"), true);
      } else {
        const topicSection = [
          "# TOPIC CONTEXT",
          "",
          `Query: ${context.query}`,
          "",
        ].join("\n");
        const readOrderSection = [
          "# AUTHORITATIVE READ ORDER",
          "",
          "Current authority and open conflict resolution contracts are read before non-current rationale:",
          ...(context.readOrder.length > 0
            ? context.readOrder.map((entry, index) => entry.kind === "source"
              ? `${index + 1}. SOURCE ${entry.path} (declared by ${entry.declaredBy.join(", ")})`
              : `${index + 1}. ${entry.kind.toUpperCase()} ${entry.id} (${entry.path})`)
            : ["- none"]),
          "",
        ].join("\n");
        const currentSections = [
          ...context.pages.filter((page) => page.kind === "invariant").map((page) => contextPageText(page, "CURRENT INVARIANT")),
        ];
        const conflictSections = context.conflicts.map((item) => [
          `# OPEN CONFLICT ${item.id} [${item.severity}, ${item.type}, ${item.state}]`,
          "",
          item.summary,
          "",
          `Kind: ${item.kind}`,
          `Status: ${item.status}`,
          `Authority: ${item.authority}`,
          `Owners: ${item.owner.join(", ")}`,
          `Wiki page: ${item.path}`,
          "",
          ...contextSourceText(item),
          "",
          "Acceptance:",
          ...item.acceptance.map((criterion) => `- ${criterion}`),
          "",
          item.body.trim(),
          "",
        ].join("\n"));
        const pageSections = context.pages
          .filter((page) => page.kind !== "invariant")
          .map((page) => contextPageText(page, "CURRENT PAGE"));
        const sourceEntries = context.readOrder.filter((entry) => entry.kind === "source");
        const sourceSection = [
          "# SOURCE READ ORDER",
          "",
          ...(sourceEntries.length > 0
            ? sourceEntries.map((entry) => `- ${entry.path} (declared by ${entry.declaredBy.join(", ")})`)
            : ["- none"]),
          "",
        ].join("\n");
        const rationaleSections = context.nonCurrentPages
          .map((page) => contextPageText(page, `NON-CURRENT RATIONALE [${page.status.toUpperCase()}]`));
        emit([
          topicSection,
          readOrderSection,
          ...currentSections,
          ...conflictSections,
          ...pageSections,
          sourceSection,
          ...rationaleSections,
        ].join("\n---\n\n"), false);
      }
      return;
    }
    if (query) {
      const matches = searchWikiPages(loaded.pages, query);
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const complete = matches.length > 0 && matches.some((match) => match.score === terms.length);
      if (!has(parsed, "full") && !complete) {
        const compact = buildCompactTopicCandidateContext(loaded.pages, query, matches);
        if (json) emit(compact, true);
        else emit(compactTopicText(compact), false);
        return;
      }
      const context = buildTopicContext(view, loaded.pages, query);
      if (!has(parsed, "full")) {
        const compact = projectTopicContext(context, "compact", matches) as CompactTopicContext;
        if (json) emit(compact, true);
        else emit(compactTopicText(compact), false);
      } else if (json) {
        emit(projectTopicContext(context, "full"), true);
      } else {
        const topicSection = [
          "# TOPIC CONTEXT",
          "",
          `Query: ${query}`,
          "",
        ].join("\n");
        const readOrderSection = [
          "# AUTHORITATIVE READ ORDER",
          "",
          "Current authority and open conflict resolution contracts are read before non-current rationale:",
          ...(context.readOrder.length > 0
            ? context.readOrder.map((entry, index) => entry.kind === "source"
              ? `${index + 1}. SOURCE ${entry.path} (declared by ${entry.declaredBy.join(", ")})`
              : `${index + 1}. ${entry.kind.toUpperCase()} ${entry.id} (${entry.path})`)
            : ["- none"]),
          "",
        ].join("\n");
        const currentSections = [
          ...context.pages.filter((page) => page.kind === "invariant").map((page) => contextPageText(page, "CURRENT INVARIANT")),
        ];
        const conflictSections = context.conflicts.map((item) => [
          `# OPEN CONFLICT ${item.id} [${item.severity}, ${item.type}, ${item.state}]`,
          "",
          item.summary,
          "",
          `Kind: ${item.kind}`,
          `Status: ${item.status}`,
          `Authority: ${item.authority}`,
          `Owners: ${item.owner.join(", ")}`,
          `Wiki page: ${item.path}`,
          "",
          ...contextSourceText(item),
          "",
          "Acceptance:",
          ...item.acceptance.map((criterion) => `- ${criterion}`),
          "",
          item.body.trim(),
          "",
        ].join("\n"));
        const pageSections = context.pages
          .filter((page) => page.kind !== "invariant")
          .map((page) => contextPageText(page, "CURRENT PAGE"));
        const sourceEntries = context.readOrder.filter((entry) => entry.kind === "source");
        const sourceSection = [
          "# SOURCE READ ORDER",
          "",
          ...(sourceEntries.length > 0
            ? sourceEntries.map((entry) => `- ${entry.path} (declared by ${entry.declaredBy.join(", ")})`)
            : ["- none"]),
          "",
        ].join("\n");
        const rationaleSections = context.nonCurrentPages
          .map((page) => contextPageText(page, `NON-CURRENT RATIONALE [${page.status.toUpperCase()}]`));
        emit([
          topicSection,
          readOrderSection,
          ...currentSections,
          ...conflictSections,
          ...pageSections,
          sourceSection,
          ...rationaleSections,
        ].join("\n---\n\n"), false);
      }
      return;
    }
    const ids = new Set<string>();
    const conflictIds = new Set<string>();
    if (requestedConflict) {
      const page = loaded.pages.find((item) => item.data.kind === "conflict" && (item.data.conflict_id === requestedConflict || item.data.id.toUpperCase() === requestedConflict));
      if (!page) throw new UsageError(`unknown conflict: ${requestedConflict}`);
      conflictIds.add(page.data.conflict_id!);
      for (const id of page.data.affected_pages ?? []) ids.add(id);
      for (const id of page.data.affected_invariants ?? []) ids.add(id);
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
    if (json) emit({ query: null, requestedConflict: requestedConflict ?? null, conflicts, pages }, true);
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
