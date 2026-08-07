import type {
  ConflictOrigin,
  ConflictResolutionState,
  ConflictSeverity,
  ConflictType,
  WikiAuthority,
  WikiPage,
  WikiSource,
  WikiStatus,
  WorkExecutor,
  WorkItem,
  WorkPriority,
} from "./model";
import { ownedWorkItems } from "./work-validation";

/** Pages that participate in current-contract discovery, in stable ID order. */
export function currentPages(pages: WikiPage[]): WikiPage[] {
  return pages.filter((page) => page.data.status === "current").sort((a, b) => a.data.id.localeCompare(b.data.id));
}

export type WikiSearchMatch = {
  page: WikiPage;
  score: number;
};

export function searchWikiPages(pages: WikiPage[], query: string): WikiSearchMatch[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const matches = pages.flatMap((page) => {
    const haystack = `${page.data.id} ${page.data.summary} ${(page.data.tags ?? []).join(" ")} ${page.body}`.toLowerCase();
    const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
    return score > 0 ? [{ page, score }] : [];
  });
  const complete = matches.filter((item) => item.score === terms.length);
  return (complete.length > 0 ? complete : matches)
    .sort((a, b) => b.score - a.score || a.page.data.id.localeCompare(b.page.data.id));
}

export type ConflictSummary = {
  id: string;
  pageId: string;
  path: string;
  summary: string;
  type: ConflictType;
  severity: ConflictSeverity;
  origin: ConflictOrigin;
  openedAt: string;
  state: ConflictResolutionState;
  owner: string[];
  affectedPages: string[];
  affectedInvariants: string[];
  acceptance: string[];
  sources: WikiSource[];
};

export function conflictSummary(page: WikiPage): ConflictSummary {
  return {
    id: page.data.conflict_id!,
    pageId: page.data.id,
    path: page.path,
    summary: page.data.summary,
    type: page.data.conflict_type!,
    severity: page.data.severity!,
    origin: page.data.origin!,
    openedAt: page.data.opened_at!,
    state: page.data.resolution!.state,
    owner: page.data.owners,
    affectedPages: page.data.affected_pages ?? [],
    affectedInvariants: page.data.affected_invariants ?? [],
    acceptance: page.data.resolution!.acceptance,
    sources: page.data.sources,
  };
}

export function openConflicts(pages: WikiPage[]): WikiPage[] {
  const order: Record<ConflictSeverity, number> = { high: 0, medium: 1, low: 2 };
  return pages.filter((page) => page.data.kind === "conflict" && page.data.status === "conflicted")
    .sort((a, b) => order[a.data.severity!] - order[b.data.severity!] || a.data.conflict_id!.localeCompare(b.data.conflict_id!));
}

export type WorkQueueState = "ready" | "waiting" | "active" | "blocked" | "done" | "deferred";
export type WorkQueueItem = Omit<WorkItem, "executor"> & {
  executor: WorkExecutor;
  queue_state: WorkQueueState;
  unmet_dependencies: string[];
  owner_page: {
    id: string;
    path: string;
    owners: string[];
    status: WikiStatus;
    authority: WikiAuthority;
  };
  context_command: string;
};
export type WorkQueueGroups = {
  active: WorkQueueItem[];
  ready: WorkQueueItem[];
  waiting: WorkQueueItem[];
  blocked: WorkQueueItem[];
  deferred: WorkQueueItem[];
  done: WorkQueueItem[];
};
export type WorkQueue = {
  version: 1;
  recommended_next: { kind: "work"; id: string } | null;
  groups: WorkQueueGroups;
  open_conflicts: ConflictSummary[];
};

/** Public queue views can select agent, human, or all; `either` is included in both named views. */
export type WorkExecutorFilter = "agent" | "human" | "all";

export const WORK_PRIORITY_ORDER: Record<WorkPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

export function buildWorkQueue(pages: WikiPage[]): WorkQueue {
  const owned = ownedWorkItems(pages);
  const stateById = new Map(owned.map(({ item }) => [item.id, item.state]));
  const normalized = owned.map(({ item, page }): WorkQueueItem => {
    const unmet = item.depends_on.filter((dependency) => stateById.get(dependency) !== "done").sort((a, b) => a.localeCompare(b));
    const queueState: WorkQueueState = item.state === "not-started" ? (unmet.length === 0 ? "ready" : "waiting") : item.state;
    return {
      ...item,
      executor: item.executor ?? "agent",
      depends_on: [...item.depends_on].sort((a, b) => a.localeCompare(b)),
      context_pages: [...item.context_pages],
      acceptance: [...item.acceptance],
      evidence: [...item.evidence],
      queue_state: queueState,
      unmet_dependencies: unmet,
      owner_page: {
        id: page.data.id,
        path: page.path,
        owners: [...page.data.owners],
        status: page.data.status,
        authority: page.data.authority,
      },
      context_command: `bun run wiki:context -- --work ${item.id}`,
    };
  }).sort((a, b) => WORK_PRIORITY_ORDER[a.priority] - WORK_PRIORITY_ORDER[b.priority] || a.id.localeCompare(b.id));
  const groups: WorkQueueGroups = { active: [], ready: [], waiting: [], blocked: [], deferred: [], done: [] };
  for (const item of normalized) groups[item.queue_state].push(item);
  const queue: WorkQueue = {
    version: 1,
    recommended_next: null,
    groups,
    open_conflicts: openConflicts(pages).map(conflictSummary),
  };
  return projectWorkQueue(queue, "all");
}

export function executorVisible(item: WorkQueueItem, filter: WorkExecutorFilter): boolean {
  return filter === "all" || item.executor === "either" || item.executor === filter;
}

export function recommendedWork(groups: WorkQueueGroups): { kind: "work"; id: string } | null {
  // Recommendations are agent auto-selection. Human-exclusive work remains
  // visible in every projection, but is never selected automatically.
  const recommended = [...groups.active, ...groups.ready].find((item) => item.executor !== "human");
  return recommended ? { kind: "work", id: recommended.id } : null;
}

/**
 * Project a fully-derived repository queue for display. Dependency state and
 * unmet dependencies are intentionally computed before this visibility filter;
 * filtering a hidden prerequisite must never turn a waiting item into ready.
 */
export function projectWorkQueue(queue: WorkQueue, filter: WorkExecutorFilter = "all"): WorkQueue {
  const groups = (Object.keys(queue.groups) as (keyof WorkQueueGroups)[]).reduce((result, group) => {
    result[group] = queue.groups[group].filter((item) => executorVisible(item, filter));
    return result;
  }, {} as WorkQueueGroups);
  return {
    version: queue.version,
    recommended_next: recommendedWork(groups),
    groups,
    open_conflicts: queue.open_conflicts,
  };
}
