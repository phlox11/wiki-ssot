import type { WikiSource } from "./model";
import type { WorkQueueItem, WorkExecutorFilter } from "./discovery";
import type {
  CompactContextConflict,
  CompactContextPage,
  CompactSelectedWorkContext,
  CompactTopicContext,
  SelectedWorkContext,
  SelectedWorkContextConflict,
  SelectedWorkContextPage,
  TopicContext,
} from "./context";

export function sourceText(sources: WikiSource[]): string {
  if (sources.length === 0) return "- none";
  return sources.map((source) => "path" in source
    ? `- path: ${source.path}${source.symbols?.length ? ` (symbols: ${source.symbols.join(", ")})` : ""}`
    : `- glob: ${source.glob}`).join("\n");
}

export function workText(item: WorkQueueItem): string {
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

export function workHelp(): string {
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

export function contextHelp(): string {
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

export function exactSourceText(sources: SelectedWorkContextPage["exactSources"]): string {
  if (sources.length === 0) return "- none";
  return sources.map((source) => `- ${source.path}${source.symbols?.length ? ` (symbols: ${source.symbols.join(", ")})` : ""}`).join("\n");
}

export function sourceGlobText(sources: SelectedWorkContextPage["sourceGlobs"]): string {
  if (sources.length === 0) return "- none";
  return sources.map((source) => [
    `- ${source.glob}`,
    ...(source.matchedFiles.length > 0 ? source.matchedFiles.map((path) => `  - ${path}`) : ["  - no matches"]),
  ].join("\n")).join("\n");
}

export function stringListText(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- none";
}

export function contextSourceText(page: SelectedWorkContextPage | SelectedWorkContextConflict | CompactContextPage | CompactContextConflict): string[] {
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

export function contextPageText(page: SelectedWorkContextPage, label: string): string {
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

export function compactContextPageText(page: CompactContextPage, label: string): string {
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

export function compactContextConflictText(conflict: CompactContextConflict, label = "OPEN CONFLICT"): string {
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

export function compactWorkText(context: CompactSelectedWorkContext): string {
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

export function compactTopicText(context: CompactTopicContext): string {
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
        `   Owners: ${candidate.owners.join(", ") || "none"}`,
        `   Relevant open conflicts: ${candidate.relevantOpenConflicts.join(", ") || "none"}`,
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

function fullConflictText(item: SelectedWorkContextConflict): string {
  return [
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
  ].join("\n");
}

function sourceReadOrder(entries: SelectedWorkContext["readOrder"]): string {
  return [
    "# SOURCE READ ORDER",
    "",
    ...entries.filter((entry) => entry.kind === "source").map((entry) => `- ${entry.path} (declared by ${entry.declaredBy.join(", ")})`),
    "",
  ].join("\n");
}

function readOrder(entries: SelectedWorkContext["readOrder"], description: string): string {
  return [
    "# AUTHORITATIVE READ ORDER",
    "",
    description,
    ...entries.map((entry, index) => entry.kind === "source"
      ? `${index + 1}. SOURCE ${entry.path} (declared by ${entry.declaredBy.join(", ")})`
      : `${index + 1}. ${entry.kind.toUpperCase()} ${entry.id} (${entry.path})`),
    "",
  ].join("\n");
}

export function fullSelectedWorkText(context: SelectedWorkContext): string {
  const work = context.work;
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
  const currentSections = context.pages.filter((page) => page.kind === "invariant").map((page) => contextPageText(page, "CURRENT INVARIANT"));
  const conflictSections = context.conflicts.map(fullConflictText);
  const pageSections = context.pages.filter((page) => page.kind !== "invariant").map((page) => contextPageText(page, "CURRENT PAGE"));
  const ownerSection = contextPageText(context.ownerPage, "NON-CURRENT WORK OWNER");
  return [workSection, readOrder(context.readOrder, "Current authority is read before non-current proposal rationale:"), ...currentSections, ...conflictSections, ...pageSections, sourceReadOrder(context.readOrder), ownerSection].join("\n---\n\n");
}

export function fullTopicText(context: TopicContext): string {
  const topicSection = ["# TOPIC CONTEXT", "", `Query: ${context.query}`, ""].join("\n");
  const currentSections = context.pages.filter((page) => page.kind === "invariant").map((page) => contextPageText(page, "CURRENT INVARIANT"));
  const conflictSections = context.conflicts.map(fullConflictText);
  const pageSections = context.pages.filter((page) => page.kind !== "invariant").map((page) => contextPageText(page, "CURRENT PAGE"));
  const rationaleSections = context.nonCurrentPages.map((page) => contextPageText(page, `NON-CURRENT RATIONALE [${page.status.toUpperCase()}]`));
  return [topicSection, readOrder(context.readOrder, "Current authority and open conflict resolution contracts are read before non-current rationale:"), ...currentSections, ...conflictSections, ...pageSections, sourceReadOrder(context.readOrder), ...rationaleSections].join("\n---\n\n");
}

/** Kept as a named export to make renderer ownership explicit in architecture checks. */
export type { WorkExecutorFilter };
