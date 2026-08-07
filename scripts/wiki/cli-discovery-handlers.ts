import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCompactTopicCandidateContext,
  buildPageContext,
  buildSelectedWorkContext,
  buildTopicContext,
  projectSelectedWorkContext,
  projectTopicContext,
} from "./context";
import { buildReusableWorkContextArtifact, validateReusableWorkContextArtifact } from "./core";
import {
  buildWorkQueue,
  conflictSummary,
  openConflicts,
  projectWorkQueue,
  searchWikiPages,
  type WorkExecutorFilter,
  type WorkQueueItem,
} from "./discovery";
import { validatePages } from "./page-validation";
import { jsonStable, emit, has, one, printFindings, type CliContext, type ParsedArgs, usage } from "./cli-runtime";
import { UsageError } from "./verification";
import {
  compactTopicText,
  compactWorkText,
  contextHelp,
  contextPageText,
  fullSelectedWorkText,
  fullTopicText,
  sourceText,
  workHelp,
  workText,
} from "./cli-render";
import type { Finding } from "./model";
import type { PrMetadata } from "./impact";
import { impactReport, validatePrMetadata } from "./impact";
import type { CompactSelectedWorkContext, CompactTopicContext } from "./context";

function workExecutorFilter(parsed: ParsedArgs): WorkExecutorFilter {
  if (!has(parsed, "executor")) return "all";
  const value = one(parsed, "executor");
  if (value == null || value === "true") throw new UsageError("work --executor requires a value: agent, human, or all");
  if (value === "all" || value === "agent" || value === "human") return value;
  throw new UsageError(`work --executor must be one of agent, human, or all; received ${value || "(missing value)"}`);
}

export function handleWork(context: CliContext): void {
  if (has(context.parsed, "help")) {
    if (context.parsed.positional.length > 0) throw new UsageError("work --help does not accept a query or work ID");
    emit(context.io, workHelp(), false);
    return;
  }
  if (context.parsed.positional.length > 0) throw new UsageError("work does not accept a query or work ID; run it without arguments, then use context --work <ID>");
  const executor = workExecutorFilter(context.parsed);
  const findings = validatePages(context.view, context.loaded.pages);
  if (findings.length > 0) {
    if (context.json) emit(context.io, { ok: false, findings }, true);
    else printFindings(context.io, findings);
    process.exitCode = 1;
    return;
  }
  const queue = projectWorkQueue(buildWorkQueue(context.loaded.pages), executor);
  const groups = {
    active: queue.groups.active,
    ready: queue.groups.ready,
    waiting: queue.groups.waiting,
    blocked: queue.groups.blocked,
    deferred: queue.groups.deferred,
    ...(has(context.parsed, "all") ? { done: queue.groups.done } : {}),
  };
  if (context.json) {
    emit(context.io, { version: queue.version, recommended_next: queue.recommended_next, groups, open_conflicts: queue.open_conflicts }, true);
    return;
  }
  const outstanding = queue.groups.active.length + queue.groups.ready.length + queue.groups.waiting.length + queue.groups.blocked.length + queue.groups.deferred.length;
  if (outstanding === 0 && queue.open_conflicts.length === 0 && (!has(context.parsed, "all") || queue.groups.done.length === 0)) {
    emit(context.io, "No remaining work.", false);
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
  if (has(context.parsed, "all")) lines.push("", `DONE (${queue.groups.done.length})`, ...(queue.groups.done.length > 0 ? queue.groups.done.map(workText) : ["none"]));
  else if (queue.groups.done.length > 0) lines.push("", `Completed work hidden: ${queue.groups.done.length}. Run bun run wiki:work -- --all to inspect it.`);
  emit(context.io, lines.join("\n").trimEnd(), false);
}

export function handleSearch(context: CliContext): void {
  const query = context.parsed.positional.join(" ").trim() || one(context.parsed, "query")?.trim();
  if (!query) throw new UsageError("search requires a query");
  const matches = searchWikiPages(context.loaded.pages, query).map(({ page, score }) => ({
    id: page.data.id,
    path: page.path,
    summary: page.data.summary,
    status: page.data.status,
    score,
  }));
  if (context.json) emit(context.io, { query, matches }, true);
  else emit(context.io, matches.map((item) => `${item.id}\t${item.status}\t${item.path}\t${item.summary}`).join("\n") || "no matches", false);
}

export function handleConflicts(context: CliContext): void {
  const requested = context.parsed.positional[0]?.toUpperCase();
  const candidates = has(context.parsed, "all") ? context.loaded.pages.filter((page) => page.data.kind === "conflict") : openConflicts(context.loaded.pages);
  const selected = requested ? candidates.filter((page) => page.data.conflict_id === requested || page.data.id.toUpperCase() === requested) : candidates;
  if (requested && selected.length === 0) throw new UsageError(`unknown ${has(context.parsed, "all") ? "" : "open "}conflict: ${requested}`);
  const conflicts = selected.map(conflictSummary);
  if (context.json) emit(context.io, { open: openConflicts(context.loaded.pages).length, conflicts }, true);
  else if (requested) {
    const item = conflicts[0];
    emit(context.io, [
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
    emit(context.io, [`Open conflicts: ${conflicts.length}`, "", ...groups].join("\n").trimEnd(), false);
  }
}

function contextError(context: CliContext, findings: Finding[]): void {
  if (context.json) emit(context.io, { ok: false, findings }, true);
  else printFindings(context.io, findings);
  process.exitCode = 1;
}

function gitPaths(context: CliContext, command: string[]): string[] {
  const result = Bun.spawnSync(["git", ...command], { cwd: context.view.root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new UsageError(result.stderr.toString().trim() || `git ${command.join(" ")} failed`);
  return result.stdout.toString().split("\0").filter(Boolean);
}

function contextArtifactDirtyPaths(context: CliContext, allowed: Set<string>): string[] {
  return [...new Set([
    ...gitPaths(context, ["diff", "--name-only", "-z", "HEAD"]),
    ...gitPaths(context, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ].filter((path) => !allowed.has(resolve(context.view.root, path))))].sort((a, b) => a.localeCompare(b));
}

function contextFullOrCompactWork(context: CliContext, work: WorkQueueItem): void {
  const selected = buildSelectedWorkContext(context.view, context.loaded.pages, work);
  if (!has(context.parsed, "full")) {
    const compact = projectSelectedWorkContext(selected, "compact");
    if (context.json) emit(context.io, compact, true);
    else emit(context.io, compactWorkText(compact as CompactSelectedWorkContext), false);
  } else if (context.json) emit(context.io, projectSelectedWorkContext(selected, "full"), true);
  else emit(context.io, fullSelectedWorkText(selected), false);
}

function contextFullOrCompactPage(context: CliContext, requestedPage: string): void {
  let selected;
  try {
    selected = buildPageContext(context.view, context.loaded.pages, requestedPage);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  if (!has(context.parsed, "full")) {
    const compact = projectTopicContext(selected, "compact");
    if (context.json) emit(context.io, compact, true);
    else emit(context.io, compactTopicText(compact as CompactTopicContext), false);
  } else if (context.json) emit(context.io, projectTopicContext(selected, "full"), true);
  else emit(context.io, fullTopicText(selected), false);
}

function contextFullOrCompactQuery(context: CliContext, query: string): boolean {
  const matches = searchWikiPages(context.loaded.pages, query);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const complete = matches.length > 0 && matches.some((match) => match.score === terms.length);
  if (!has(context.parsed, "full") && !complete) {
    const compact = buildCompactTopicCandidateContext(context.loaded.pages, query, matches);
    if (context.json) emit(context.io, compact, true);
    else emit(context.io, compactTopicText(compact as CompactTopicContext), false);
    return true;
  }
  const selected = buildTopicContext(context.view, context.loaded.pages, query);
  if (!has(context.parsed, "full")) {
    const compact = projectTopicContext(selected, "compact", matches);
    if (context.json) emit(context.io, compact, true);
    else emit(context.io, compactTopicText(compact as CompactTopicContext), false);
  } else if (context.json) emit(context.io, projectTopicContext(selected, "full"), true);
  else emit(context.io, fullTopicText(selected), false);
  return true;
}

export function handleContext(context: CliContext): void {
  if (has(context.parsed, "help")) {
    if (context.parsed.positional.length > 0) throw new UsageError("context --help does not accept a query or selector");
    emit(context.io, contextHelp(), false);
    return;
  }
  const query = context.parsed.positional.join(" ").trim() || one(context.parsed, "query")?.trim();
  const requestedConflict = one(context.parsed, "conflict")?.toUpperCase();
  const requestedWorkInput = one(context.parsed, "work")?.trim();
  const requestedPageInput = one(context.parsed, "page")?.trim();
  const artifactPath = one(context.parsed, "artifact");
  const reusePath = one(context.parsed, "reuse");
  const artifactMode = artifactPath != null || reusePath != null;
  if (artifactPath && reusePath) throw new UsageError("context --artifact and --reuse are mutually exclusive");
  if (artifactMode && !requestedWorkInput) throw new UsageError("context --artifact/--reuse requires --work <ID>");
  if (requestedWorkInput && (requestedConflict || requestedPageInput || query || (has(context.parsed, "base") && !artifactMode))) throw new UsageError("context --work cannot be combined with a query, --page, --conflict, or --base unless creating or reusing an artifact");
  if (requestedPageInput && (requestedConflict || requestedWorkInput || query || artifactMode || has(context.parsed, "base"))) throw new UsageError("context --page cannot be combined with a query, --work, --conflict, --artifact, --reuse, or --base");
  if (artifactMode && (!one(context.parsed, "base") || !one(context.parsed, "metadata"))) throw new UsageError("context --artifact/--reuse requires --base <ref> and --metadata <pr-body>");

  if (requestedWorkInput) {
    const findings = validatePages(context.view, context.loaded.pages);
    if (findings.length > 0) {
      contextError(context, findings);
      return;
    }
    const queue = buildWorkQueue(context.loaded.pages);
    const workItems = Object.values(queue.groups).flat();
    const work = workItems.find((item) => item.id === requestedWorkInput)
      ?? workItems.find((item) => item.id.toLowerCase() === requestedWorkInput.toLowerCase());
    if (!work) throw new UsageError(`unknown work item: ${requestedWorkInput}`);
    if (artifactMode) {
      if (context.staged) throw new UsageError("reusable context artifacts require a working repository");
      const metadataPath = resolve(context.view.root, one(context.parsed, "metadata")!);
      const validated = validatePrMetadata(readFileSync(metadataPath, "utf8"), true);
      if (validated.findings.some((item) => item.severity === "error") || !validated.metadata) {
        contextError(context, validated.findings);
        return;
      }
      const allowed = new Set([metadataPath, artifactPath, reusePath]
        .filter((path): path is string => path != null)
        .map((path) => resolve(context.view.root, path)));
      const reuseArtifactPath = reusePath == null ? undefined : resolve(context.view.root, reusePath);
      const dirtyPaths = contextArtifactDirtyPaths(context, allowed);
      if (dirtyPaths.length > 0) {
        const dirtyFindings: Finding[] = dirtyPaths.map((path) => ({
          code: "context-artifact-dirty",
          message: "reusable context requires a committed exact HEAD",
          path,
          severity: "error",
        }));
        contextError(context, dirtyFindings);
        return;
      }
      const artifact = buildReusableWorkContextArtifact(context.view, context.loaded.pages, work, {
        base: one(context.parsed, "base")!,
        metadata: validated.metadata as PrMetadata,
      });
      if (reusePath) {
        let candidate: unknown;
        try {
          candidate = JSON.parse(readFileSync(reuseArtifactPath!, "utf8"));
        } catch (error) {
          const malformed: Finding[] = [{ code: "context-artifact-malformed", message: error instanceof Error ? error.message : String(error), path: reuseArtifactPath, severity: "error" }];
          contextError(context, malformed);
          return;
        }
        const findings = validateReusableWorkContextArtifact(candidate, artifact);
        if (context.json) emit(context.io, { ok: findings.length === 0, artifact_digest: artifact.artifact_digest, head_sha: artifact.repository.head_sha, findings }, true);
        else if (findings.length === 0) emit(context.io, `reusable context valid ${artifact.artifact_digest}\nRead required sources directly in artifact read_order; the artifact does not replace source inspection.`, false);
        else printFindings(context.io, findings);
        if (findings.length > 0) process.exitCode = 1;
        return;
      }
      const output = resolve(context.view.root, artifactPath!);
      const rendered = jsonStable(artifact);
      if (existsSync(output) && readFileSync(output, "utf8") !== rendered) throw new UsageError(`refusing to overwrite different context artifact: ${artifactPath}`);
      writeFileSync(output, rendered);
      if (context.json) emit(context.io, { ok: true, artifact_digest: artifact.artifact_digest, path: output, head_sha: artifact.repository.head_sha, required_sources: artifact.bindings.sources.length }, true);
      else emit(context.io, [`wrote ${output}`, `Artifact digest: ${artifact.artifact_digest}`, `HEAD: ${artifact.repository.head_sha}`, `Required sources: ${artifact.bindings.sources.length}`, "Read required sources directly in artifact read_order; the artifact does not replace source inspection."].join("\n"), false);
      return;
    }
    contextFullOrCompactWork(context, work);
    return;
  }
  if (requestedPageInput) {
    contextFullOrCompactPage(context, requestedPageInput);
    return;
  }
  if (query) {
    contextFullOrCompactQuery(context, query);
    return;
  }
  handleImpactContext(context, requestedConflict);
}

function handleImpactContext(context: CliContext, requestedConflict: string | undefined): void {
  const ids = new Set<string>();
  const conflictIds = new Set<string>();
  if (requestedConflict) {
    const page = context.loaded.pages.find((item) => item.data.kind === "conflict" && (item.data.conflict_id === requestedConflict || item.data.id.toUpperCase() === requestedConflict));
    if (!page) throw new UsageError(`unknown conflict: ${requestedConflict}`);
    if (!has(context.parsed, "all") && page.data.status !== "conflicted") throw new UsageError(`unknown open conflict: ${requestedConflict}`);
    conflictIds.add(page.data.conflict_id!);
    for (const id of page.data.affected_pages ?? []) ids.add(id);
    for (const id of page.data.affected_invariants ?? []) ids.add(id);
  } else {
    const report = impactReport(context.view, context.loaded.pages, { base: one(context.parsed, "base") });
    for (const id of report.affectedPages) ids.add(id);
    for (const conflict of report.affectedConflicts) conflictIds.add(conflict.id);
  }
  if (!requestedConflict) {
    for (const page of openConflicts(context.loaded.pages)) {
      if ((page.data.affected_pages ?? []).some((id) => ids.has(id)) || (page.data.affected_invariants ?? []).some((id) => ids.has(id))) conflictIds.add(page.data.conflict_id!);
    }
  }
  for (const conflictId of conflictIds) {
    const conflict = context.loaded.pages.find((page) => page.data.kind === "conflict" && page.data.conflict_id === conflictId);
    for (const id of conflict?.data.affected_pages ?? []) ids.add(id);
    for (const id of conflict?.data.affected_invariants ?? []) ids.add(id);
  }
  const pages = context.loaded.pages
    .filter((page) => page.data.kind !== "conflict" && ids.has(page.data.id))
    .map((page) => ({ id: page.data.id, path: page.path, summary: page.data.summary, sources: page.data.sources, body: page.body }));
  const conflictCandidates = requestedConflict && has(context.parsed, "all")
    ? context.loaded.pages.filter((page) => page.data.kind === "conflict")
    : openConflicts(context.loaded.pages);
  const conflicts = conflictCandidates
    .filter((page) => conflictIds.has(page.data.conflict_id!))
    .map((page) => ({
      ...conflictSummary(page),
      kind: page.data.kind,
      status: page.data.status,
      authority: page.data.authority,
      owners: page.data.owners,
      ...(has(context.parsed, "full") ? { body: page.body, resolution: page.data.resolution } : {}),
    }));
  if (context.json) emit(context.io, { query: null, requestedConflict: requestedConflict ?? null, conflicts, pages }, true);
  else {
    const conflictText = conflicts.map((item) => [
      item.status === "conflicted"
        ? `# OPEN CONFLICT ${item.id} [${item.severity}, ${item.type}, ${item.state}]`
        : `# RESOLVED CONFLICT ${item.id} [${item.status}, ${item.severity}, ${item.type}, ${item.state}]`,
      "",
      item.summary,
      "",
      `Kind: ${item.kind}`,
      `Status: ${item.status}`,
      `Authority: ${item.authority}`,
      `Lifecycle: ${item.status === "conflicted" ? "open (current workflow)" : "resolved (non-current)"}`,
      `Owners: ${item.owner.join(", ") || "none"}`,
      `Wiki page: ${item.path}`,
      `Source file: ${item.path}`,
      "",
      "Sources:",
      sourceText(item.sources),
      "",
      "Acceptance:",
      ...item.acceptance.map((criterion) => `- ${criterion}`),
      ...(item.resolution?.decision ? ["", `Decision: ${item.resolution.decision}`] : []),
      ...(item.resolution?.evidence?.length ? [`Evidence: ${item.resolution.evidence.join(", ")}`] : []),
      ...(item.body != null ? ["", item.body.trim()] : []),
      "",
    ].join("\n")).join("\n---\n\n");
    const pageText = pages.map((page) => `# ${page.id}\n\nSource file: ${page.path}\n\n${page.body.trim()}\n`).join("\n---\n\n");
    emit(context.io, [conflictText, pageText].filter(Boolean).join("\n---\n\n") || "no context pages or conflicts", false);
  }
}

export type DiscoveryHandler = (context: CliContext) => void;

export const discoveryHandlers: Record<string, DiscoveryHandler> = {
  work: handleWork,
  search: handleSearch,
  conflicts: handleConflicts,
  context: handleContext,
};
