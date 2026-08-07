import type { Finding, WorkExecutor, WorkItem, WorkPriority, WorkState, WikiPage } from "./model";

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function pushFinding(findings: Finding[], path: string, code: string, message: string, severity: Finding["severity"] = "error") {
  findings.push({ code, message, path, severity });
}

const WORK_EXECUTORS = new Set<WorkExecutor>(["agent", "human", "either"]);

export function normalizedWorkExecutor(item: Record<string, unknown>): WorkExecutor | undefined {
  // Omission is the backwards-compatible agent default. An explicit
  // undefined/null is still malformed input and must not enter the graph.
  if (!("executor" in item)) return "agent";
  return WORK_EXECUTORS.has(item.executor as WorkExecutor) ? item.executor as WorkExecutor : undefined;
}

export type OwnedWorkItem = { item: WorkItem; page: WikiPage };

export function ownedWorkItems(pages: WikiPage[]): OwnedWorkItem[] {
  const states = new Set<WorkState>(["not-started", "active", "blocked", "done", "deferred"]);
  const priorities = new Set<WorkPriority>(["critical", "high", "normal", "low"]);
  const items: OwnedWorkItem[] = [];
  for (const page of pages) {
    if (!Array.isArray(page.data.work_items)) continue;
    for (const raw of page.data.work_items as unknown[]) {
      if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.id !== "string" || typeof item.title !== "string") continue;
      if (!states.has(item.state as WorkState) || !priorities.has(item.priority as WorkPriority)) continue;
      if (!stringArray(item.depends_on) || !stringArray(item.context_pages) || !stringArray(item.acceptance) || !stringArray(item.evidence)) continue;
      const executor = normalizedWorkExecutor(item);
      if (!executor) continue;
      items.push({ page, item: { ...item, executor } as WorkItem });
    }
  }
  return items;
}

/** Validate proposal-owned work item schemas and the repository-wide graph. */
export function validateWorkItems(pages: WikiPage[]): Finding[] {
  const findings: Finding[] = [];
  const states = new Set<WorkState>(["not-started", "active", "blocked", "done", "deferred"]);
  const priorities = new Set<WorkPriority>(["critical", "high", "normal", "low"]);
  const pageById = new Map(pages.map((page) => [page.data.id, page]));
  const workById = new Map<string, OwnedWorkItem>();
  const seenIds = new Map<string, string>();
  const validItems: OwnedWorkItem[] = [];

  for (const page of pages) {
    const rawItems = (page.data as unknown as Record<string, unknown>).work_items;
    if (rawItems == null) continue;
    if (page.data.kind !== "proposal") {
      pushFinding(findings, page.path, "work-owner-kind", "work_items are allowed only on kind: proposal pages");
    }
    if (!Array.isArray(rawItems)) {
      pushFinding(findings, page.path, "work-items-shape", "work_items must be an array");
      continue;
    }
    for (const [index, raw] of rawItems.entries()) {
      const label = `work_items[${index}]`;
      if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        pushFinding(findings, page.path, "work-item-shape", `${label} must be a mapping`);
        continue;
      }
      const item = raw as Record<string, unknown>;
      const rawId = typeof item.id === "string" ? item.id : "";
      const id = rawId.trim();
      const validId = rawId === id && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(id);
      if (!validId) {
        pushFinding(findings, page.path, "work-id", `${label}.id must be a stable non-empty identifier without whitespace`);
      } else if (seenIds.has(id)) {
        pushFinding(findings, page.path, "work-duplicate-id", `work item ${id} is already owned by ${seenIds.get(id)}`);
      } else {
        seenIds.set(id, page.data.id);
      }
      if (typeof item.title !== "string" || item.title.trim().length === 0) pushFinding(findings, page.path, "work-title", `${label}.title must be a non-empty string`);
      if (!states.has(item.state as WorkState)) pushFinding(findings, page.path, "work-state", `${label}.state is invalid: ${String(item.state)}`);
      if (!priorities.has(item.priority as WorkPriority)) pushFinding(findings, page.path, "work-priority", `${label}.priority is invalid: ${String(item.priority)}`);
      if (normalizedWorkExecutor(item) == null) pushFinding(findings, page.path, "work-executor", `${label}.executor must be one of agent, human, or either when provided; omission defaults to agent`);
      for (const field of ["depends_on", "context_pages", "acceptance", "evidence"] as const) {
        if (!stringArray(item[field])) pushFinding(findings, page.path, `work-${field.replaceAll("_", "-")}`, `${label}.${field} must be a string array`);
      }
      if (stringArray(item.context_pages) && item.context_pages.length === 0) pushFinding(findings, page.path, "work-context-pages", `${label}.context_pages must name at least one current page`);
      if (stringArray(item.acceptance) && item.acceptance.length === 0) pushFinding(findings, page.path, "work-acceptance", `${label}.acceptance must contain at least one objective criterion`);
      const state = item.state as WorkState;
      const blocker = typeof item.blocker === "string" ? item.blocker.trim() : "";
      const deferredReason = typeof item.deferred_reason === "string" ? item.deferred_reason.trim() : "";
      if (state === "blocked" && blocker.length === 0) pushFinding(findings, page.path, "work-blocker", `${label} is blocked and requires a non-empty blocker`);
      if (state !== "blocked" && item.blocker != null) pushFinding(findings, page.path, "work-blocker-state", `${label}.blocker is allowed only when state is blocked`);
      if (state === "deferred" && deferredReason.length === 0) pushFinding(findings, page.path, "work-deferred-reason", `${label} is deferred and requires a non-empty deferred_reason`);
      if (state !== "deferred" && item.deferred_reason != null) pushFinding(findings, page.path, "work-deferred-state", `${label}.deferred_reason is allowed only when state is deferred`);
      if (state === "done" && (!stringArray(item.evidence) || item.evidence.length === 0)) pushFinding(findings, page.path, "work-done-evidence", `${label} is done and requires durable evidence`);
      if (page.data.status !== "proposed" && !["done", "deferred"].includes(state)) {
        pushFinding(findings, page.path, "work-owner-status", `${label} is non-terminal but its proposal status is ${page.data.status}`);
      }
      if (validId && !workById.has(id) && states.has(state) && priorities.has(item.priority as WorkPriority)
        && normalizedWorkExecutor(item) != null
        && stringArray(item.depends_on) && stringArray(item.context_pages) && stringArray(item.acceptance) && stringArray(item.evidence)
        && typeof item.title === "string" && item.title.trim().length > 0) {
        workById.set(id, { page, item: { ...item, executor: normalizedWorkExecutor(item) } as WorkItem });
      }
      if (validId && states.has(state) && priorities.has(item.priority as WorkPriority)
        && normalizedWorkExecutor(item) != null
        && stringArray(item.depends_on) && stringArray(item.context_pages) && stringArray(item.acceptance) && stringArray(item.evidence)
        && typeof item.title === "string" && item.title.trim().length > 0) {
        validItems.push({ page, item: { ...item, executor: normalizedWorkExecutor(item) } as WorkItem });
      }
    }
  }

  for (const owned of validItems) {
    const item = owned.item;
    const id = item.id;
    for (const dependency of item.depends_on) {
      if (dependency === id) pushFinding(findings, owned.page.path, "work-self-dependency", `${id} cannot depend on itself`);
      else if (!workById.has(dependency)) pushFinding(findings, owned.page.path, "work-dependency-unknown", `${id} depends on unknown work item ${dependency}`);
    }
    for (const pageId of item.context_pages) {
      const context = pageById.get(pageId);
      if (!context || context.data.status !== "current" || context.data.kind === "conflict") {
        pushFinding(findings, owned.page.path, "work-context-page-unknown", `${id} context_pages must reference a current non-conflict page: ${pageId}`);
      }
    }
    if (["active", "done"].includes(item.state)) {
      const unmet = item.depends_on.filter((dependency) => workById.get(dependency)?.item.state !== "done");
      if (unmet.length > 0) pushFinding(findings, owned.page.path, "work-state-dependencies", `${id} is ${item.state} with unmet dependencies: ${unmet.join(", ")}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const reportedCycles = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id];
      const key = [...new Set(cycle)].sort().join("|");
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        pushFinding(findings, workById.get(id)!.page.path, "work-dependency-cycle", `work dependency cycle: ${cycle.join(" -> ")}`);
      }
      return;
    }
    visiting.add(id);
    stack.push(id);
    for (const dependency of workById.get(id)?.item.depends_on ?? []) if (workById.has(dependency)) visit(dependency);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...workById.keys()].sort()) visit(id);
  return findings;
}
