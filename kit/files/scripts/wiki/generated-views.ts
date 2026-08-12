import type { WikiPage, WorkState } from "./model";
import {
  buildWorkQueue,
  conflictSummary,
  currentPages,
  openConflicts,
  type WorkQueueGroups,
  type WorkQueueItem,
} from "./discovery";
import { ownedWorkItems } from "./work-validation";
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
        : "**Recommended next:** none. Do not invent work; inspect blockers and open conflicts below.",
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
  lines.push("## Open conflicts", "");
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
  lines.push("The root index is bounded by first path-segment group count. Open the complete [Wiki catalog](./catalog.md) to drill down to every content page.", "");
  for (const [group, items] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${group}`, "");
    lines.push(`- ${items.length} current page${items.length === 1 ? "" : "s"} — [Browse ${group} in the catalog](./catalog.md)`);
    lines.push("");
  }
  if (groups.size === 0) lines.push("No current pages yet.", "");
  lines.push("- [Current status](./current-status.md)", "- [Outstanding work](./work-queue.md)", "- [Open conflicts](./conflicts.md)", "- [Changelog](./changelog.md)", "");
  return `${lines.join("\n").trimEnd()}\n`;
}

const CATALOG_STATUS_ORDER: WikiPage["data"]["status"][] = ["current", "proposed", "conflicted", "deprecated", "archived"];

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ").trim() || "—";
}

function pageLink(id: string, pagesById: Map<string, WikiPage>): string {
  const page = pagesById.get(id);
  return page == null ? markdownCell(id) : `[${markdownCell(id)}](./${page.path.slice("wiki/".length)})`;
}

function relationLinks(ids: string[] | undefined, pagesById: Map<string, WikiPage>): string {
  return ids == null || ids.length === 0 ? "—" : [...ids].sort((a, b) => a.localeCompare(b)).map((id) => pageLink(id, pagesById)).join(", ");
}

/** Complete deterministic catalog of every parsed Wiki content page. */
export function generateCatalog(pages: WikiPage[]): string {
  const pagesById = new Map(pages.map((page) => [page.data.id, page]));
  const lines = [
    "---",
    "id: generated/catalog",
    "summary: Deterministic catalog of every Wiki content page.",
    "kind: generated",
    "status: archived",
    "authority: derived",
    'owners: ["@repository-maintainers"]',
    "sources: []",
    "tags: [generated, catalog]",
    "---",
    "",
    GENERATED_HEADER,
    "",
    "# Wiki catalog",
    "",
    "Complete generated catalog of every Wiki content page. Current pages are authority; other lifecycle records remain explicitly non-current.",
    "",
  ];
  for (const status of CATALOG_STATUS_ORDER) {
    const lifecycle = pages.filter((page) => page.data.status === status);
    if (lifecycle.length === 0) continue;
    const groups = new Map<string, WikiPage[]>();
    for (const page of lifecycle) {
      const group = page.path.split("/")[1] ?? "other";
      groups.set(group, [...(groups.get(group) ?? []), page]);
    }
    for (const [group, items] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`## ${status} / ${group}`, "", "| ID | Kind | Authority | Summary | Related | Affects |", "|---|---|---|---|---|---|");
      for (const page of items.sort((a, b) => a.data.id.localeCompare(b.data.id))) {
        lines.push(`| ${pageLink(page.data.id, pagesById)} | ${markdownCell(page.data.kind)} | ${markdownCell(page.data.authority)} | ${markdownCell(page.data.summary)} | ${relationLinks(page.data.related, pagesById)} | ${relationLinks(page.data.affects, pagesById)} |`);
      }
      lines.push("");
    }
  }
  if (pages.length === 0) lines.push("No Wiki content pages yet.", "");
  return `${lines.join("\n").trimEnd()}\n`;
}

export function generateCurrentStatus(pages: WikiPage[]): string {
  const current = currentPages(pages);
  const proposals = pages.filter((page) => page.data.status === "proposed");
  const queue = buildWorkQueue(pages);
  const outstanding = queue.groups.active.length + queue.groups.ready.length + queue.groups.waiting.length + queue.groups.blocked.length + queue.groups.deferred.length;
  const totalWork = Object.values(queue.groups).reduce((total, items) => total + items.length, 0);
  const totalConflicts = pages.filter((page) => page.data.kind === "conflict").length;
  const conflicts = openConflicts(pages);
  const archived = pages.filter((page) => page.data.status === "archived").length;
  const deprecated = pages.filter((page) => page.data.status === "deprecated").length;
  const invariants = current.filter((page) => page.data.kind === "invariant");
  const humanOutstanding = ["active", "ready"]
    .flatMap((group) => queue.groups[group as keyof WorkQueueGroups])
    .some((item) => item.executor === "human");
  const lines = [GENERATED_HEADER, "", "# Current status", "", "The current contract is a mutable snapshot. Done work and resolved conflicts remain durable records; Git is the history of record for ordinary changes.", "", "## Cumulative records", "", "| Record | Count |", "|---|---:|", `| Current pages | ${current.length} |`, `| Proposal pages | ${proposals.length} |`, `| Total work | ${totalWork} |`, `| Outstanding work | ${outstanding} |`, `| Done work | ${queue.groups.done.length} |`, `| Total conflicts | ${totalConflicts} |`, `| Open conflicts | ${conflicts.length} |`, `| Resolved conflicts | ${Math.max(0, totalConflicts - conflicts.length)} |`, `| Archived pages | ${archived} |`, `| Deprecated pages | ${deprecated} |`, ""];
  lines.push("## Current invariants", "");
  if (invariants.length === 0) lines.push("No current invariant pages.", "");
  else for (const page of invariants) lines.push(`- [${page.data.id}](./${page.path.slice("wiki/".length)}) — ${page.data.summary}`);
  lines.push("", "## Work and conflicts", "");
  lines.push(queue.recommended_next
    ? `Recommended next: \`${queue.recommended_next.id}\`. Run \`bun run wiki:context -- --work ${queue.recommended_next.id}\`.`
    : humanOutstanding
      ? "No agent-recommendable work is available; human-only work remains and requires human execution. Do not infer an agent task or assume authority."
      : "No agent-recommendable work is available; inspect the complete queue and open conflicts for details.");
  lines.push("", "See the [complete Wiki catalog](./catalog.md), [repository work queue](./work-queue.md), or run `bun run wiki:work`.", "");
  lines.push(`### Open conflicts (${conflicts.length})`, "", "| Severity | Count |", "|---|---:|");
  for (const severity of ["high", "medium", "low"] as const) lines.push(`| ${severity} | ${conflicts.filter((page) => page.data.severity === severity).length} |`);
  lines.push("", "See [open conflicts](./conflicts.md) or run `bun run wiki:conflicts`.", "");
  return lines.join("\n");
}

export type SourceMap = { version: 1; exact: Record<string, string[]>; globs: { glob: string; pages: string[] }[] };
export type ConflictMap = { version: 1; exact: Record<string, string[]>; globs: { glob: string; conflicts: string[] }[] };

export type RelationshipGraphNode = {
  id: string;
  type: "page" | "work";
  path?: string;
  kind?: string;
  status?: WikiPage["data"]["status"];
  state?: WorkState;
};
export type RelationshipGraphEdge = {
  from: string;
  to: string;
  type: "related" | "affects" | "conflict-affected-page" | "conflict-affected-invariant" | "work-context-page" | "work-depends-on";
};
export type RelationshipGraph = { version: 1; nodes: RelationshipGraphNode[]; edges: RelationshipGraphEdge[] };

/** Build only declared page/work relationships; source mappings remain separate. */
export function buildRelationshipGraph(pages: WikiPage[]): RelationshipGraph {
  const nodes: RelationshipGraphNode[] = pages.map((page) => ({ id: page.data.id, type: "page", path: page.path, kind: page.data.kind, status: page.data.status }));
  const edges: RelationshipGraphEdge[] = [];
  for (const page of pages) {
    for (const target of page.data.related ?? []) edges.push({ from: page.data.id, to: target, type: "related" });
    for (const target of page.data.affects ?? []) edges.push({ from: page.data.id, to: target, type: "affects" });
    if (page.data.kind === "conflict") {
      for (const target of page.data.affected_pages ?? []) edges.push({ from: page.data.id, to: target, type: "conflict-affected-page" });
      for (const target of page.data.affected_invariants ?? []) edges.push({ from: page.data.id, to: target, type: "conflict-affected-invariant" });
    }
  }
  for (const { item, page } of ownedWorkItems(pages)) {
    nodes.push({ id: item.id, type: "work", kind: "work", path: page.path, state: item.state });
    for (const target of item.context_pages) edges.push({ from: item.id, to: target, type: "work-context-page" });
    for (const target of item.depends_on) edges.push({ from: item.id, to: target, type: "work-depends-on" });
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id) || a.type.localeCompare(b.type));
  edges.sort((a, b) => `${a.from}\0${a.to}\0${a.type}`.localeCompare(`${b.from}\0${b.to}\0${b.type}`));
  return { version: 1, nodes, edges };
}

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
    "wiki/catalog.md": generateCatalog(pages),
    "wiki/current-status.md": generateCurrentStatus(pages),
    "wiki/conflicts.md": generateConflictsIndex(pages),
    "wiki/work-queue.md": generateWorkQueue(pages),
    ".wiki/source-map.json": jsonStable(buildSourceMap(pages)),
    ".wiki/conflict-map.json": jsonStable(buildConflictMap(pages)),
    ".wiki/relationship-graph.json": jsonStable(buildRelationshipGraph(pages)),
  };
}
