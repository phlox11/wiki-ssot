import type { WikiPage } from "./model";
import {
  buildWorkQueue,
  conflictSummary,
  currentPages,
  openConflicts,
  type WorkQueueGroups,
  type WorkQueueItem,
} from "./discovery";
import { jsonStable } from "./serialization";

export const GENERATED_HEADER = "<!-- GENERATED FILE. DO NOT EDIT. Run the matching wiki command. -->";

function renderWorkTable(items: WorkQueueItem[]): string[] {
  const lines = [
    "| ID | Priority | Executor | Owner page | Dependencies | Summary | Context |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const item of items) {
    const owner = `[${item.owner_page.id}](./${item.owner_page.path.slice("wiki/".length)})`;
    const dependencies = item.depends_on.length > 0 ? item.depends_on.join(", ") : "—";
    const reason = item.queue_state === "blocked"
      ? ` — Blocker: ${item.blocker}`
      : item.queue_state === "deferred"
        ? ` — Deferred: ${item.deferred_reason}`
        : item.queue_state === "waiting"
          ? ` — Waiting on: ${item.unmet_dependencies.join(", ")}`
          : "";
    lines.push(`| ${item.id} | ${item.priority} | ${item.executor} | ${owner} | ${dependencies} | ${item.title}${reason} | \`${item.context_command}\` |`);
  }
  if (items.length === 0) lines.push("| — | — | — | — | — | None | — |");
  return lines;
}

export function generateWorkQueue(pages: WikiPage[]): string {
  const queue = buildWorkQueue(pages);
  const outstanding = ["active", "ready", "waiting", "blocked", "deferred"]
    .reduce((total, group) => total + queue.groups[group as keyof WorkQueueGroups].length, 0);
  const humanOutstanding = ["active", "ready"]
    .flatMap((group) => queue.groups[group as keyof WorkQueueGroups])
    .some((item) => item.executor === "human");
  const lines = [
    "---",
    "id: generated/work-queue",
    "summary: Deterministic repository-wide projection of outstanding proposal work.",
    "kind: generated",
    "status: archived",
    "authority: derived",
    'owners: ["@repository-maintainers"]',
    "sources: []",
    "tags: [generated, work, queue]",
    "---",
    "",
    GENERATED_HEADER,
    "",
    "# Repository work queue",
    "",
    "This is a deterministic view of structured `work_items` on proposal pages. It is not current product authority; open the owning proposal and then the returned current context.",
    "",
    queue.recommended_next
      ? `**Recommended next:** \`${queue.recommended_next.id}\` — run \`bun run wiki:context -- --work ${queue.recommended_next.id}\`.`
      : humanOutstanding
        ? "**Recommended next:** none; no agent-recommendable work is available. Human-only work remains visible below and requires human execution; do not invent work or assume authority."
        : "**Recommended next:** none. Do not invent work; inspect blockers and open decisions below.",
    "",
    `Outstanding work: ${outstanding}. Completed work hidden: ${queue.groups.done.length}; run \`bun run wiki:work -- --all\` to inspect it.`,
    "",
  ];
  for (const [heading, group] of [
    ["Active", "active"],
    ["Ready", "ready"],
    ["Waiting", "waiting"],
    ["Blocked", "blocked"],
  ] as const) {
    lines.push(`## ${heading}`, "", ...renderWorkTable(queue.groups[group]), "");
  }
  lines.push("## Open decision conflicts", "");
  if (queue.open_conflicts.length === 0) {
    lines.push("No open conflicts.", "");
  } else {
    lines.push("| ID | Severity | Type | State | Summary |", "|---|---|---|---|---|");
    for (const conflict of queue.open_conflicts) lines.push(`| [${conflict.id}](./${conflict.path.slice("wiki/".length)}) | ${conflict.severity} | ${conflict.type} | ${conflict.state} | ${conflict.summary} |`);
    lines.push("");
  }
  lines.push("## Deferred", "", ...renderWorkTable(queue.groups.deferred), "");
  if (outstanding === 0 && queue.open_conflicts.length === 0) lines.push("No remaining work.", "");
  return `${lines.join("\n").trimEnd()}\n`;
}

export function generateConflictsIndex(pages: WikiPage[]): string {
  const conflicts = openConflicts(pages);
  const lines = [
    GENERATED_HEADER,
    "",
    "# Open conflicts",
    "",
    "Conflicts are not the current SSOT. Related work must resolve them with an explicit decision or implementation that satisfies every acceptance criterion.",
    "",
    "Humans run `bun run wiki:conflicts`; agents run `bun run wiki:context -- --conflict C-NNN` for full context.",
    "",
    "| ID | Severity | Type | State | Owner | Affected pages | Summary |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const page of conflicts) {
    const item = conflictSummary(page);
    lines.push(`| [${item.id}](./${page.path.slice("wiki/".length)}) | ${item.severity} | ${item.type} | ${item.state} | ${item.owner.join(", ")} | ${item.affectedPages.join(", ")} | ${item.summary} |`);
  }
  if (conflicts.length === 0) lines.push("| — | — | — | — | — | — | No open conflicts |");
  lines.push("");
  return lines.join("\n");
}

export function generateIndex(pages: WikiPage[], name = "Project"): string {
  const groups = new Map<string, WikiPage[]>();
  for (const page of currentPages(pages)) {
    const group = page.path.split("/")[1] ?? "other";
    groups.set(group, [...(groups.get(group) ?? []), page]);
  }
  const lines = [GENERATED_HEADER, "", `# ${name} wiki`, "", "Pages with `status: current` are the single source of truth for current development intent and contracts.", ""];
  for (const [group, items] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${group}`, "");
    for (const page of items) lines.push(`- [${page.data.id}](./${page.path.slice("wiki/".length)}) — ${page.data.summary}`);
    lines.push("");
  }
  if (groups.size === 0) lines.push("No current pages yet.", "");
  lines.push("- [Outstanding work](./work-queue.md)", "- [Open conflicts](./conflicts.md)", "- [Changelog](./changelog.md)", "");
  return `${lines.join("\n").trimEnd()}\n`;
}

export function generateCurrentStatus(pages: WikiPage[]): string {
  const lines = [GENERATED_HEADER, "", "# Current status", "", "| ID | Kind | Authority | Owner | Sources |", "|---|---|---|---|---:|"];
  for (const page of currentPages(pages)) lines.push(`| [${page.data.id}](./${page.path.slice("wiki/".length)}) | ${page.data.kind} | ${page.data.authority} | ${page.data.owners.join(", ")} | ${page.data.sources.length} |`);
  if (currentPages(pages).length === 0) lines.push("| — | — | — | — | 0 |");
  const queue = buildWorkQueue(pages);
  const outstanding = queue.groups.active.length + queue.groups.ready.length + queue.groups.waiting.length + queue.groups.blocked.length + queue.groups.deferred.length;
  const humanOutstanding = ["active", "ready"]
    .flatMap((group) => queue.groups[group as keyof WorkQueueGroups])
    .some((item) => item.executor === "human");
  lines.push("", `## Outstanding work (${outstanding})`, "");
  lines.push(queue.recommended_next
    ? `Recommended next: \`${queue.recommended_next.id}\`. Run \`bun run wiki:context -- --work ${queue.recommended_next.id}\`.`
    : outstanding > 0 && humanOutstanding
      ? "No agent-recommendable work is available; human-only work remains and requires human execution. Do not infer an agent task or assume authority."
      : "No active or ready work is available; do not infer a task from blocked or deferred records.");
  lines.push("", "See the [repository work queue](./work-queue.md) or run `bun run wiki:work`.", "");
  const conflicts = openConflicts(pages);
  lines.push("", `## Open conflicts (${conflicts.length})`, "", "| Severity | Count |", "|---|---:|");
  for (const severity of ["high", "medium", "low"] as const) lines.push(`| ${severity} | ${conflicts.filter((page) => page.data.severity === severity).length} |`);
  lines.push("", "See [open conflicts](./conflicts.md) or run `bun run wiki:conflicts`.", "");
  return lines.join("\n");
}

export type SourceMap = { version: 1; exact: Record<string, string[]>; globs: { glob: string; pages: string[] }[] };
export type ConflictMap = { version: 1; exact: Record<string, string[]>; globs: { glob: string; conflicts: string[] }[] };

export function buildSourceMap(pages: WikiPage[]): SourceMap {
  const exact: Record<string, string[]> = {};
  const globPages = new Map<string, string[]>();
  for (const page of currentPages(pages)) {
    for (const source of page.data.sources) {
      if ("path" in source) exact[source.path] = [...new Set([...(exact[source.path] ?? []), page.data.id])].sort();
      else globPages.set(source.glob, [...new Set([...(globPages.get(source.glob) ?? []), page.data.id])].sort());
    }
  }
  return { version: 1, exact, globs: [...globPages].sort(([a], [b]) => a.localeCompare(b)).map(([glob, ids]) => ({ glob, pages: ids })) };
}

export function buildConflictMap(pages: WikiPage[]): ConflictMap {
  const exact: Record<string, string[]> = {};
  const globs = new Map<string, string[]>();
  for (const page of openConflicts(pages)) {
    const id = page.data.conflict_id!;
    for (const source of page.data.sources) {
      if ("path" in source) exact[source.path] = [...new Set([...(exact[source.path] ?? []), id])].sort();
      else globs.set(source.glob, [...new Set([...(globs.get(source.glob) ?? []), id])].sort());
    }
  }
  return { version: 1, exact, globs: [...globs].sort(([a], [b]) => a.localeCompare(b)).map(([glob, conflicts]) => ({ glob, conflicts })) };
}

export function generatedCoreFiles(pages: WikiPage[], name = "Project"): Record<string, string> {
  return {
    "wiki/index.md": generateIndex(pages, name),
    "wiki/current-status.md": generateCurrentStatus(pages),
    "wiki/conflicts.md": generateConflictsIndex(pages),
    "wiki/work-queue.md": generateWorkQueue(pages),
    ".wiki/source-map.json": jsonStable(buildSourceMap(pages)),
    ".wiki/conflict-map.json": jsonStable(buildConflictMap(pages)),
  };
}
