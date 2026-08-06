import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import ts from "typescript";

export const GENERATED_HEADER = "<!-- GENERATED FILE. DO NOT EDIT. Run the matching wiki command. -->";

export type WikiStatus = "current" | "proposed" | "deprecated" | "conflicted" | "archived";
export type WikiAuthority = "normative" | "observed" | "derived";
export type WikiSource = { path: string; symbols?: string[] } | { glob: string };
export type ConflictType = "decision" | "implementation" | "documentation";
export type ConflictSeverity = "high" | "medium" | "low";
export type ConflictOrigin = "baseline" | "introduced_by_change";
export type ConflictResolutionState = "open" | "decision_pending" | "implementing" | "verified";
export type ConflictResolution = {
  state: ConflictResolutionState;
  decision?: string | null;
  acceptance: string[];
  evidence?: string[];
};
export type WorkState = "not-started" | "active" | "blocked" | "done" | "deferred";
export type WorkPriority = "critical" | "high" | "normal" | "low";
export type WorkExecutor = "agent" | "human" | "either";
export type WorkItem = {
  id: string;
  title: string;
  state: WorkState;
  priority: WorkPriority;
  /** Optional in proposal frontmatter; queue projections always normalize it. */
  executor?: WorkExecutor;
  depends_on: string[];
  context_pages: string[];
  acceptance: string[];
  evidence: string[];
  blocker?: string;
  deferred_reason?: string;
};

export type WikiFrontmatter = {
  id: string;
  summary: string;
  kind: string;
  status: WikiStatus;
  authority: WikiAuthority;
  owners: string[];
  sources: WikiSource[];
  affects?: string[];
  related?: string[];
  tags?: string[];
  conflict_id?: string;
  conflict_type?: ConflictType;
  severity?: ConflictSeverity;
  origin?: ConflictOrigin;
  opened_at?: string;
  affected_pages?: string[];
  affected_invariants?: string[];
  resolution?: ConflictResolution;
  work_items?: WorkItem[];
};

export type WikiPage = {
  path: string;
  body: string;
  raw: string;
  data: WikiFrontmatter;
};

export type Finding = {
  code: string;
  message: string;
  path?: string;
  severity: "error" | "warning";
};

export function isConflictGuardFinding(finding: Finding): boolean {
  return finding.severity === "error" && (finding.code.startsWith("conflict-") || finding.code.startsWith("metadata-"));
}

export interface RepoView {
  root: string;
  mode: "working" | "staged";
  listFiles(): string[];
  exists(path: string): boolean;
  read(path: string): string;
}

function git(root: string, args: string[], allowFailure = false): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    if (allowFailure) return "";
    throw new Error(result.stderr.toString().trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.toString();
}

function gitFileList(root: string, staged: boolean): string[] {
  const args = staged
    ? ["ls-files", "--cached", "-z"]
    : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"];
  return git(root, args)
    .split("\0")
    .filter(Boolean)
    .sort();
}

export function createRepoView(root = process.cwd(), staged = false): RepoView {
  const normalizedRoot = resolve(root);
  const files = gitFileList(normalizedRoot, staged);
  const fileSet = new Set(files);
  return {
    root: normalizedRoot,
    mode: staged ? "staged" : "working",
    listFiles: () => [...files],
    exists: (path) => fileSet.has(normalizeRepoPath(path)),
    read: (path) => {
      const repoPath = normalizeRepoPath(path);
      if (!fileSet.has(repoPath)) throw new Error(`file not found in ${staged ? "Git index" : "repository"}: ${repoPath}`);
      return staged ? git(normalizedRoot, ["show", `:${repoPath}`]) : readFileSync(join(normalizedRoot, repoPath), "utf8");
    },
  };
}

export function normalizeRepoPath(path: string): string {
  return normalize(path).replaceAll("\\", "/").replace(/^\.\//, "");
}

export function parseWikiPage(path: string, raw: string): WikiPage {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error("missing YAML frontmatter");
  const data = parseYaml(match[1]) as WikiFrontmatter;
  if (data == null || typeof data !== "object" || Array.isArray(data)) throw new Error("frontmatter must be a mapping");
  return { path, raw, body: raw.slice(match[0].length), data };
}

export const WIKI_SYSTEM_FILES = new Set([
  "wiki/README.md",
  "wiki/SCHEMA.md",
  "wiki/WORKFLOW.md",
  "wiki/index.md",
  "wiki/current-status.md",
  "wiki/conflicts.md",
  "wiki/work-queue.md",
  "wiki/changelog.md",
]);

export function isContentPage(path: string): boolean {
  return path.startsWith("wiki/") && path.endsWith(".md") && !path.startsWith("wiki/_generated/") && !WIKI_SYSTEM_FILES.has(path);
}

export function loadWikiPages(view: RepoView): { pages: WikiPage[]; findings: Finding[] } {
  const pages: WikiPage[] = [];
  const findings: Finding[] = [];
  for (const path of view.listFiles().filter(isContentPage)) {
    try {
      pages.push(parseWikiPage(path, view.read(path)));
    } catch (error) {
      findings.push({
        code: "frontmatter-parse",
        message: error instanceof Error ? error.message : String(error),
        path,
        severity: "error",
      });
    }
  }
  return { pages, findings };
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function validateSource(source: unknown): source is WikiSource {
  if (source == null || typeof source !== "object" || Array.isArray(source)) return false;
  const item = source as Record<string, unknown>;
  if (typeof item.path === "string" && item.path.length > 0) {
    return item.symbols == null || stringArray(item.symbols);
  }
  return typeof item.glob === "string" && item.glob.length > 0;
}

function pushFinding(findings: Finding[], path: string, code: string, message: string, severity: Finding["severity"] = "error") {
  findings.push({ code, message, path, severity });
}

export function validatePages(view: RepoView, pages: WikiPage[]): Finding[] {
  const findings: Finding[] = [];
  const ids = new Map<string, string>();
  const statuses = new Set<WikiStatus>(["current", "proposed", "deprecated", "conflicted", "archived"]);
  const authorities = new Set<WikiAuthority>(["normative", "observed", "derived"]);
  const conflictTypes = new Set<ConflictType>(["decision", "implementation", "documentation"]);
  const conflictSeverities = new Set<ConflictSeverity>(["high", "medium", "low"]);
  const conflictOrigins = new Set<ConflictOrigin>(["baseline", "introduced_by_change"]);
  const conflictStates = new Set<ConflictResolutionState>(["open", "decision_pending", "implementing", "verified"]);

  for (const page of pages) {
    const data = page.data as unknown as Record<string, unknown>;
    for (const field of ["id", "summary", "kind", "status", "authority", "owners", "sources"] as const) {
      if (!(field in data)) pushFinding(findings, page.path, "frontmatter-required", `missing required field: ${field}`);
    }
    if (typeof data.id !== "string" || data.id.trim().length === 0) {
      pushFinding(findings, page.path, "frontmatter-id", "id must be a non-empty string");
    } else if (ids.has(data.id)) {
      pushFinding(findings, page.path, "duplicate-id", `id ${data.id} is already used by ${ids.get(data.id)}`);
    } else {
      ids.set(data.id, page.path);
    }
    if (typeof data.summary !== "string" || data.summary.trim().length === 0) pushFinding(findings, page.path, "frontmatter-summary", "summary must be a non-empty string");
    if (typeof data.kind !== "string" || data.kind.trim().length === 0) pushFinding(findings, page.path, "frontmatter-kind", "kind must be a non-empty string");
    if (!statuses.has(data.status as WikiStatus)) pushFinding(findings, page.path, "frontmatter-status", `invalid status: ${String(data.status)}`);
    if (!authorities.has(data.authority as WikiAuthority)) pushFinding(findings, page.path, "frontmatter-authority", `invalid authority: ${String(data.authority)}`);
    if (!stringArray(data.owners) || data.owners.length === 0) pushFinding(findings, page.path, "frontmatter-owners", "owners must be a non-empty string array");
    if (!Array.isArray(data.sources) || !data.sources.every(validateSource)) pushFinding(findings, page.path, "frontmatter-sources", "sources must contain {path, symbols?} or {glob} entries");
    if (data.status === "current" && Array.isArray(data.sources) && data.sources.length === 0) pushFinding(findings, page.path, "current-without-source", "current pages require at least one primary source");
    for (const field of ["affects", "related", "tags"] as const) {
      if (data[field] != null && !stringArray(data[field])) pushFinding(findings, page.path, `frontmatter-${field}`, `${field} must be a string array`);
    }
    if (data.kind === "conflict") {
      const resolution = data.resolution as Record<string, unknown> | undefined;
      if (typeof data.conflict_id !== "string" || !/^C-\d{3}$/.test(data.conflict_id)) pushFinding(findings, page.path, "conflict-id", "conflict_id must use C-NNN form");
      else if (data.id !== `conflict/${data.conflict_id}`) pushFinding(findings, page.path, "conflict-page-id", `conflict page id must be conflict/${data.conflict_id}`);
      if (!conflictTypes.has(data.conflict_type as ConflictType)) pushFinding(findings, page.path, "conflict-type", `invalid conflict_type: ${String(data.conflict_type)}`);
      if (!conflictSeverities.has(data.severity as ConflictSeverity)) pushFinding(findings, page.path, "conflict-severity", `invalid conflict severity: ${String(data.severity)}`);
      if (!conflictOrigins.has(data.origin as ConflictOrigin)) pushFinding(findings, page.path, "conflict-origin", `invalid conflict origin: ${String(data.origin)}`);
      if (!isIsoCalendarDate(data.opened_at)) pushFinding(findings, page.path, "conflict-opened-at", "opened_at must be a real YYYY-MM-DD calendar date");
      if (!stringArray(data.affected_pages) || data.affected_pages.length === 0) pushFinding(findings, page.path, "conflict-affected-pages", "conflicts require at least one affected current page ID");
      if (!Array.isArray(data.affected_invariants) || !data.affected_invariants.every((item) => typeof item === "string" && item.length > 0)) pushFinding(findings, page.path, "conflict-affected-invariants", "affected_invariants must be a string array");
      if (!Array.isArray(data.sources) || data.sources.length === 0) pushFinding(findings, page.path, "conflict-without-source", "conflicts require at least one primary source");
      if (resolution == null || typeof resolution !== "object" || Array.isArray(resolution)) {
        pushFinding(findings, page.path, "conflict-resolution", "resolution must be an object");
      } else {
        if (!conflictStates.has(resolution.state as ConflictResolutionState)) pushFinding(findings, page.path, "conflict-resolution-state", `invalid resolution state: ${String(resolution.state)}`);
        if (!stringArray(resolution.acceptance) || resolution.acceptance.length === 0) pushFinding(findings, page.path, "conflict-acceptance", "resolution.acceptance requires at least one non-empty criterion");
        if (resolution.evidence != null && !stringArray(resolution.evidence)) pushFinding(findings, page.path, "conflict-evidence", "resolution.evidence must be a string array");
      }
      const isOpenPath = page.path.startsWith("wiki/conflicts/open/");
      const isResolvedPath = page.path.startsWith("wiki/conflicts/resolved/");
      if (!isOpenPath && !isResolvedPath) pushFinding(findings, page.path, "conflict-path", "conflict pages must live under wiki/conflicts/open or wiki/conflicts/resolved");
      if (isOpenPath && data.status !== "conflicted") pushFinding(findings, page.path, "conflict-open-status", "open conflict pages require status: conflicted");
      if (isOpenPath && resolution?.state === "verified") pushFinding(findings, page.path, "conflict-open-resolution-state", "verified conflicts must move to wiki/conflicts/resolved and become archived");
      if (isResolvedPath && (data.status !== "archived" || resolution?.state !== "verified")) pushFinding(findings, page.path, "conflict-resolved-status", "resolved conflicts require status: archived and resolution.state: verified");
      if (isResolvedPath && (!stringArray(resolution?.evidence) || resolution.evidence.length === 0)) pushFinding(findings, page.path, "conflict-resolution-evidence", "resolved conflicts require resolution.evidence");
      if (isResolvedPath && (typeof resolution?.decision !== "string" || resolution.decision.trim().length === 0)) pushFinding(findings, page.path, "conflict-resolution-decision", "resolved conflicts require resolution.decision");
    } else if (page.path.startsWith("wiki/conflicts/")) {
      pushFinding(findings, page.path, "conflict-kind", "files under wiki/conflicts must use kind: conflict");
    }
  }

  const pageById = new Map(pages.map((page) => [page.data.id, page]));
  for (const page of pages) {
    for (const field of ["affects", "related"] as const) {
      for (const id of page.data[field] ?? []) {
        if (!ids.has(id)) pushFinding(findings, page.path, "dangling-page-id", `${field} references unknown page id: ${id}`);
      }
    }
    const sources = Array.isArray(page.data.sources) ? page.data.sources : [];
    for (const source of sources) {
      if ("path" in source) {
        if (!view.exists(source.path)) pushFinding(findings, page.path, "source-missing", `source path does not exist: ${source.path}`);
        else if (source.symbols != null) validateSymbols(view, source.path, source.symbols, page.path, findings);
      } else {
        let glob: Bun.Glob;
        try {
          glob = new Bun.Glob(source.glob);
        } catch {
          pushFinding(findings, page.path, "source-glob-invalid", `invalid source glob: ${source.glob}`);
          continue;
        }
        if (!view.listFiles().some((path) => glob.match(path))) pushFinding(findings, page.path, "source-glob-empty", `source glob matches no files: ${source.glob}`);
      }
    }
    if (page.data.status === "current" && sources.length > 0 && sources.every((source) => {
      const sourcePath = "path" in source ? source.path : source.glob;
      return sourcePath.startsWith("wiki/proposals/");
    })) {
      pushFinding(findings, page.path, "proposal-only-current", "a current page cannot rely only on proposal sources");
    }
    if (page.data.kind === "conflict") {
      for (const id of page.data.affected_pages ?? []) {
        const affected = pageById.get(id);
        if (!affected || affected.data.status !== "current") pushFinding(findings, page.path, "conflict-page-unknown", `affected_pages must reference a current page: ${id}`);
      }
      for (const id of page.data.affected_invariants ?? []) {
        const invariant = pageById.get(id);
        if (!invariant || invariant.data.status !== "current" || invariant.data.kind !== "invariant") pushFinding(findings, page.path, "conflict-invariant-unknown", `affected_invariants must reference a current invariant: ${id}`);
      }
    }
  }
  findings.push(...validateWorkItems(pages));
  return findings;
}

type OwnedWorkItem = { item: WorkItem; page: WikiPage };

const WORK_EXECUTORS = new Set<WorkExecutor>(["agent", "human", "either"]);

function normalizedWorkExecutor(item: Record<string, unknown>): WorkExecutor | undefined {
  // Omission is the backwards-compatible agent default. An explicit
  // undefined/null is still malformed input and must not enter the graph.
  if (!("executor" in item)) return "agent";
  return WORK_EXECUTORS.has(item.executor as WorkExecutor) ? item.executor as WorkExecutor : undefined;
}

function ownedWorkItems(pages: WikiPage[]): OwnedWorkItem[] {
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

function validateSymbols(view: RepoView, sourcePath: string, symbols: string[], pagePath: string, findings: Finding[]) {
  if (![".ts", ".tsx", ".js", ".jsx"].includes(extname(sourcePath))) return;
  const source = ts.createSourceFile(sourcePath, view.read(sourcePath), ts.ScriptTarget.Latest, true);
  const exported = new Set<string>();
  for (const node of source.statements) {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) exported.add(declaration.name.text);
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) {
      exported.add(node.name.text);
    }
  }
  for (const symbol of symbols) {
    if (!exported.has(symbol)) pushFinding(findings, pagePath, "source-symbol-missing", `${sourcePath} does not export ${symbol}`, "warning");
  }
}

type LegacyAllow = { source: string; target: string; reason: string; expires: string };

function loadLegacyAllowlist(view: RepoView): { entries: LegacyAllow[]; findings: Finding[] } {
  if (!view.exists(".wiki/legacy-link-allowlist.json")) return { entries: [], findings: [] };
  try {
    const entries = JSON.parse(view.read(".wiki/legacy-link-allowlist.json")) as LegacyAllow[];
    const findings: Finding[] = [];
    if (!Array.isArray(entries)) throw new Error("allowlist must be an array");
    for (const entry of entries) {
      if (!entry.source || !entry.target || !entry.reason || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) {
        findings.push({ code: "legacy-allowlist-invalid", message: "each entry requires source, target, reason and YYYY-MM-DD expires", path: ".wiki/legacy-link-allowlist.json", severity: "error" });
      } else if (entry.expires < new Date().toISOString().slice(0, 10)) {
        findings.push({ code: "legacy-allowlist-expired", message: `expired allowlist entry: ${entry.source} -> ${entry.target}`, path: ".wiki/legacy-link-allowlist.json", severity: "error" });
      }
    }
    return { entries, findings };
  } catch (error) {
    return { entries: [], findings: [{ code: "legacy-allowlist-parse", message: error instanceof Error ? error.message : String(error), path: ".wiki/legacy-link-allowlist.json", severity: "error" }] };
  }
}

function markdownTargets(raw: string): string[] {
  const withoutCode = raw.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...withoutCode.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g)].map((match) => match[1]);
}

export function validateMarkdownLinks(view: RepoView): Finding[] {
  const { entries, findings } = loadLegacyAllowlist(view);
  // Generated kit payload is staged for another repository: its relative links
  // resolve once the payload lands at that repository's root, not against this
  // tree. Only the publisher gets that exemption, and `kit/README.md` never does
  // — it is hand-written, it lives here, and its links resolve here.
  const publishesKit = readConfig(view).publishesKit;
  const markdown = view.listFiles().filter((path) => path.endsWith(".md") && !path.startsWith("node_modules/") && !path.startsWith(".git/") && !(publishesKit && isKitManagedPath(path)));
  for (const source of markdown) {
    for (const rawTarget of markdownTargets(view.read(source))) {
      if (rawTarget.startsWith("#") || /^(https?:|mailto:|tel:|data:)/.test(rawTarget)) continue;
      let decoded = rawTarget;
      try { decoded = decodeURIComponent(rawTarget); } catch { /* invalid encoding is handled as a missing link */ }
      const targetWithoutAnchor = decoded.split("#", 1)[0].split("?", 1)[0];
      if (!targetWithoutAnchor) continue;
      const target = normalizeRepoPath(targetWithoutAnchor.startsWith("/") ? targetWithoutAnchor.slice(1) : join(dirname(source), targetWithoutAnchor));
      const valid = view.exists(target) || view.exists(join(target, "README.md")) || view.listFiles().some((path) => path.startsWith(`${target.replace(/\/$/, "")}/`));
      if (!valid && !entries.some((entry) => entry.source === source && entry.target === rawTarget)) {
        pushFinding(findings, source, "broken-link", `link target does not exist: ${rawTarget}`);
      }
    }
  }
  return findings;
}

export function jsonStable(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input != null && typeof input === "object") return Object.fromEntries(Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sort(item)]));
    return input;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

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

export type ContextSourceGlob = {
  glob: string;
  matchedFiles: string[];
};

export type SelectedWorkContextPage = {
  id: string;
  kind: string;
  path: string;
  summary: string;
  status: WikiStatus;
  authority: WikiAuthority;
  owners: string[];
  sources: WikiSource[];
  exactSources: Extract<WikiSource, { path: string }>[];
  sourceGlobs: ContextSourceGlob[];
  sourceFiles: string[];
  relevantOpenConflicts: string[];
  body: string;
};

export type SelectedWorkContextConflict = ConflictSummary & {
  kind: "conflict";
  status: "conflicted";
  authority: WikiAuthority;
  exactSources: Extract<WikiSource, { path: string }>[];
  sourceGlobs: ContextSourceGlob[];
  sourceFiles: string[];
  relevantOpenConflicts: string[];
  body: string;
};

export type SelectedWorkContextReadEntry =
  | { kind: "invariant" | "conflict" | "page"; id: string; path: string }
  | { kind: "source"; path: string; declaredBy: string[] };

export type SelectedWorkContextSourceSummary = {
  pageId: string;
  path: string;
  status: WikiStatus;
  authority: WikiAuthority;
  declared: WikiSource[];
  exactSources: Extract<WikiSource, { path: string }>[];
  sourceGlobs: ContextSourceGlob[];
  sourceFiles: string[];
  relevantOpenConflicts: string[];
};

export type SelectedWorkContext = {
  version: 1;
  query: null;
  requestedConflict: null;
  requestedWork: string;
  work: WorkQueueItem;
  readOrder: SelectedWorkContextReadEntry[];
  pages: SelectedWorkContextPage[];
  conflicts: SelectedWorkContextConflict[];
  ownerPage: SelectedWorkContextPage;
  sources: SelectedWorkContextSourceSummary[];
};

/**
 * The compact context projection deliberately keeps routing and authority
 * metadata while dropping page bodies.  `buildSelectedWorkContext` and
 * `buildTopicContext` remain the exhaustive semantic models used by exact
 * context artifacts and by the explicit `--full` CLI mode; this projection is
 * only a presentation boundary for ordinary discovery.
 */
export type CompactContextPage = Omit<SelectedWorkContextPage, "body"> & {
  bodyDigest: string;
  focusedCommand: string;
};

export type CompactContextConflict = Omit<SelectedWorkContextConflict, "body"> & {
  bodyDigest: string;
  focusedCommand: string;
};

export type TopicContextCandidate = {
  /** Stable one-based order in the deterministic search result. */
  order: number;
  score: number;
  id: string;
  kind: string;
  path: string;
  summary: string;
  status: WikiStatus;
  authority: WikiAuthority;
  owners: string[];
  bodyDigest: string;
  relevantOpenConflicts: string[];
  focusedCommand: string;
};

export type CompactSelectedWorkContext = Omit<
  SelectedWorkContext,
  "pages" | "conflicts" | "ownerPage" | "sources"
> & {
  mode: "compact";
  pages: CompactContextPage[];
  conflicts: CompactContextConflict[];
  ownerPage: CompactContextPage;
};

export type CompactTopicContext = Omit<
  TopicContext,
  "pages" | "conflicts" | "nonCurrentPages" | "sources"
> & {
  mode: "compact";
  /** `partial` exposes candidates before any focused body expansion. */
  matchMode: "complete" | "partial" | "none";
  pages: CompactContextPage[];
  conflicts: CompactContextConflict[];
  nonCurrentPages: CompactContextPage[];
  candidates: TopicContextCandidate[];
};

export type TopicContext = {
  version: 1;
  query: string;
  requestedConflict: null;
  requestedWork: null;
  readOrder: SelectedWorkContextReadEntry[];
  pages: SelectedWorkContextPage[];
  conflicts: SelectedWorkContextConflict[];
  nonCurrentPages: SelectedWorkContextPage[];
  sources: SelectedWorkContextSourceSummary[];
};

const WORK_PRIORITY_ORDER: Record<WorkPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

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

function executorVisible(item: WorkQueueItem, filter: WorkExecutorFilter): boolean {
  return filter === "all" || item.executor === "either" || item.executor === filter;
}

function recommendedWork(groups: WorkQueueGroups): { kind: "work"; id: string } | null {
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

function contextSourceFields(view: RepoView, sources: WikiSource[]) {
  const exactSources = sources
    .filter((source): source is Extract<WikiSource, { path: string }> => "path" in source)
    .map((source) => ({ ...source, ...(source.symbols ? { symbols: [...source.symbols] } : {}) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const sourceGlobs = sources
    .filter((source): source is Extract<WikiSource, { glob: string }> => "glob" in source)
    .map((source) => ({ glob: source.glob, matchedFiles: expandSource(view, source) }))
    .sort((a, b) => a.glob.localeCompare(b.glob));
  const sourceFiles = [...new Set(sources.flatMap((source) => expandSource(view, source)))].sort((a, b) => a.localeCompare(b));
  return { exactSources, sourceGlobs, sourceFiles };
}

function selectedWorkContextPage(view: RepoView, page: WikiPage, conflicts: WikiPage[]): SelectedWorkContextPage {
  const relevantOpenConflicts = conflicts
    .filter((conflict) => (conflict.data.affected_pages ?? []).includes(page.data.id)
      || (conflict.data.affected_invariants ?? []).includes(page.data.id))
    .map((conflict) => conflict.data.conflict_id!);
  return {
    id: page.data.id,
    kind: page.data.kind,
    path: page.path,
    summary: page.data.summary,
    status: page.data.status,
    authority: page.data.authority,
    owners: [...page.data.owners],
    sources: page.data.sources,
    ...contextSourceFields(view, page.data.sources),
    relevantOpenConflicts,
    body: page.body,
  };
}

function selectedWorkContextConflict(view: RepoView, page: WikiPage): SelectedWorkContextConflict {
  return {
    ...conflictSummary(page),
    kind: "conflict",
    status: "conflicted",
    authority: page.data.authority,
    ...contextSourceFields(view, page.data.sources),
    relevantOpenConflicts: [page.data.conflict_id!],
    body: page.body,
  };
}

function contextReadOrder(
  pages: SelectedWorkContextPage[],
  conflicts: SelectedWorkContextConflict[],
): SelectedWorkContextReadEntry[] {
  const declarations = new Map<string, Set<string>>();
  const addSourceDeclarations = (id: string, sourceFiles: string[]) => {
    for (const path of sourceFiles) {
      const declaredBy = declarations.get(path) ?? new Set<string>();
      declaredBy.add(id);
      declarations.set(path, declaredBy);
    }
  };
  for (const page of pages) addSourceDeclarations(page.id, page.sourceFiles);
  for (const conflict of conflicts) addSourceDeclarations(conflict.id, conflict.sourceFiles);

  return [
    ...pages.filter((page) => page.kind === "invariant").map((page) => ({ kind: "invariant" as const, id: page.id, path: page.path })),
    ...conflicts.map((conflict) => ({ kind: "conflict" as const, id: conflict.id, path: conflict.path })),
    ...pages.filter((page) => page.kind !== "invariant").map((page) => ({ kind: "page" as const, id: page.id, path: page.path })),
    ...[...declarations.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, declaredBy]) => ({ kind: "source" as const, path, declaredBy: [...declaredBy].sort((a, b) => a.localeCompare(b)) })),
  ];
}

function contextSourceSummary(page: SelectedWorkContextPage | SelectedWorkContextConflict): SelectedWorkContextSourceSummary {
  return {
    pageId: "pageId" in page ? page.pageId : page.id,
    path: page.path,
    status: page.status,
    authority: page.authority,
    declared: page.sources,
    exactSources: page.exactSources,
    sourceGlobs: page.sourceGlobs,
    sourceFiles: page.sourceFiles,
    relevantOpenConflicts: page.relevantOpenConflicts,
  };
}

export function buildSelectedWorkContext(view: RepoView, pages: WikiPage[], work: WorkQueueItem): SelectedWorkContext {
  const ownerPage = pages.find((page) => page.data.id === work.owner_page.id);
  if (!ownerPage) throw new Error(`work owner page is missing: ${work.owner_page.id}`);

  const requestedPageIds = new Set(work.context_pages);
  for (const page of currentPages(pages)) if (page.data.kind === "invariant") requestedPageIds.add(page.data.id);
  const selectedPages = currentPages(pages).filter((page) => requestedPageIds.has(page.data.id));
  const invariantPages = selectedPages.filter((page) => page.data.kind === "invariant");
  const otherPages = selectedPages.filter((page) => page.data.kind !== "invariant");
  const relevantConflictPages = openConflicts(pages)
    .filter((page) => (page.data.affected_pages ?? []).some((id) => requestedPageIds.has(id))
      || (page.data.affected_invariants ?? []).some((id) => requestedPageIds.has(id)));

  const contextPages = [...invariantPages, ...otherPages]
    .map((page) => selectedWorkContextPage(view, page, relevantConflictPages));
  const conflicts = relevantConflictPages.map((page) => selectedWorkContextConflict(view, page));
  const owner = selectedWorkContextPage(view, ownerPage, relevantConflictPages);

  return {
    version: 1,
    query: null,
    requestedConflict: null,
    requestedWork: work.id,
    work,
    readOrder: contextReadOrder(contextPages, conflicts),
    pages: contextPages,
    conflicts,
    ownerPage: owner,
    sources: [...contextPages.map(contextSourceSummary), ...conflicts.map(contextSourceSummary), contextSourceSummary(owner)],
  };
}

export function buildTopicContext(view: RepoView, pages: WikiPage[], query: string): TopicContext {
  const matches = searchWikiPages(pages, query).map(({ page }) => page);
  const matchedCurrentIds = new Set(matches
    .filter((page) => page.data.status === "current" && page.data.kind !== "conflict")
    .map((page) => page.data.id));
  const selectedConflictIds = new Set(matches
    .filter((page) => page.data.kind === "conflict" && page.data.status === "conflicted")
    .map((page) => page.data.conflict_id!));
  const conflictPages = openConflicts(pages);

  let changed = true;
  while (changed) {
    changed = false;
    for (const page of conflictPages) {
      const conflictId = page.data.conflict_id!;
      const relevant = selectedConflictIds.has(conflictId)
        || (page.data.affected_pages ?? []).some((id) => matchedCurrentIds.has(id))
        || (page.data.affected_invariants ?? []).some((id) => matchedCurrentIds.has(id));
      if (!relevant) continue;
      if (!selectedConflictIds.has(conflictId)) {
        selectedConflictIds.add(conflictId);
        changed = true;
      }
      for (const id of [...(page.data.affected_pages ?? []), ...(page.data.affected_invariants ?? [])]) {
        const affected = pages.find((candidate) => candidate.data.id === id);
        if (affected?.data.status === "current" && affected.data.kind !== "conflict" && !matchedCurrentIds.has(id)) {
          matchedCurrentIds.add(id);
          changed = true;
        }
      }
    }
  }

  const selectedConflictPages = conflictPages.filter((page) => selectedConflictIds.has(page.data.conflict_id!));
  const selectedCurrentPages = currentPages(pages).filter((page) => matchedCurrentIds.has(page.data.id));
  const contextPages = [
    ...selectedCurrentPages.filter((page) => page.data.kind === "invariant"),
    ...selectedCurrentPages.filter((page) => page.data.kind !== "invariant"),
  ].map((page) => selectedWorkContextPage(view, page, selectedConflictPages));
  const conflicts = selectedConflictPages.map((page) => selectedWorkContextConflict(view, page));
  const nonCurrentPages = matches
    .filter((page) => page.data.status !== "current"
      && !(page.data.kind === "conflict" && page.data.status === "conflicted"))
    .sort((a, b) => a.data.id.localeCompare(b.data.id))
    .map((page) => selectedWorkContextPage(view, page, selectedConflictPages));

  const context: TopicContext = {
    version: 1,
    query,
    requestedConflict: null,
    requestedWork: null,
    readOrder: contextReadOrder(contextPages, conflicts),
    pages: contextPages,
    conflicts,
    nonCurrentPages,
    sources: [...contextPages, ...conflicts, ...nonCurrentPages].map(contextSourceSummary),
  };
  return context;
}

function focusedContextCommand(page: SelectedWorkContextPage | SelectedWorkContextConflict): string {
  if (page.kind === "conflict") {
    const conflictId = "id" in page && page.id.startsWith("C-") ? page.id : page.id.replace(/^conflict\//, "");
    const all = page.status === "conflicted" ? "" : " --all";
    return `bun run wiki:context --${all} --conflict ${conflictId} --full`;
  }
  return `bun run wiki:context -- --page ${page.id} --full`;
}

function compactContextPage(page: SelectedWorkContextPage): CompactContextPage {
  const { body, ...metadata } = page;
  return {
    ...metadata,
    bodyDigest: hashContent(body),
    focusedCommand: focusedContextCommand(page),
  };
}

function compactContextConflict(page: SelectedWorkContextConflict): CompactContextConflict {
  const { body, ...metadata } = page;
  return {
    ...metadata,
    bodyDigest: hashContent(body),
    focusedCommand: focusedContextCommand(page),
  };
}

function topicCandidate(
  match: WikiSearchMatch,
  order: number,
  selectedConflicts: Array<WikiPage | SelectedWorkContextConflict>,
): TopicContextCandidate {
  const { page, score } = match;
  const relevantOpenConflicts = selectedConflicts
    .filter((conflict) => {
      const affectedPages = "data" in conflict ? conflict.data.affected_pages ?? [] : conflict.affectedPages;
      const affectedInvariants = "data" in conflict ? conflict.data.affected_invariants ?? [] : conflict.affectedInvariants;
      return affectedPages.includes(page.data.id) || affectedInvariants.includes(page.data.id);
    })
    .map((conflict) => "data" in conflict ? conflict.data.conflict_id! : conflict.id)
    .sort((a, b) => a.localeCompare(b));
  if (page.data.kind === "conflict" && page.data.status === "conflicted" && page.data.conflict_id != null) {
    relevantOpenConflicts.push(page.data.conflict_id);
  }
  relevantOpenConflicts.sort((a, b) => a.localeCompare(b));
  const conflictCandidate = page.data.kind === "conflict";
  const focusedCommand = conflictCandidate
    ? `bun run wiki:context --${page.data.status === "conflicted" ? "" : " --all"} --conflict ${page.data.conflict_id ?? page.data.id.replace(/^conflict\//, "")} --full`
    : `bun run wiki:context -- --page ${page.data.id} --full`;
  return {
    order,
    score,
    id: page.data.id,
    kind: page.data.kind,
    path: page.path,
    summary: page.data.summary,
    status: page.data.status,
    authority: page.data.authority,
    owners: [...page.data.owners],
    bodyDigest: hashContent(page.body),
    relevantOpenConflicts,
    focusedCommand,
  };
}

/**
 * Build the bounded partial-match route directly from search results and Wiki
 * frontmatter. This function intentionally accepts no RepoView: it cannot
 * expand source globs, construct a source read order, or assemble page bodies.
 * Candidates carry only routing metadata plus a stable body digest; callers
 * follow the focused command before requesting exhaustive context.
 */
export function buildCompactTopicCandidateContext(
  pages: WikiPage[],
  query: string,
  matches: WikiSearchMatch[] = searchWikiPages(pages, query),
): CompactTopicContext {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const complete = matches.length > 0 && matches.some((match) => match.score === terms.length);
  const matchMode: CompactTopicContext["matchMode"] = matches.length === 0 ? "none" : complete ? "complete" : "partial";
  const candidates = matchMode === "partial"
    ? matches.map((match, index) => topicCandidate(match, index + 1, openConflicts(pages)))
    : [];
  return {
    version: 1,
    mode: "compact",
    query,
    requestedConflict: null,
    requestedWork: null,
    matchMode,
    readOrder: [],
    pages: [],
    conflicts: [],
    nonCurrentPages: [],
    candidates,
  };
}

/**
 * Project an exhaustive selected-work model for ordinary discovery.  Passing
 * `full` returns the original object unchanged so reusable context digests and
 * the historical exhaustive representation remain stable.
 */
export function projectSelectedWorkContext(
  context: SelectedWorkContext,
  mode: "compact" | "full" = "compact",
): SelectedWorkContext | CompactSelectedWorkContext {
  if (mode === "full") return context;
  return {
    version: context.version,
    mode: "compact",
    query: context.query,
    requestedConflict: context.requestedConflict,
    requestedWork: context.requestedWork,
    work: context.work,
    readOrder: context.readOrder,
    pages: context.pages.map(compactContextPage),
    conflicts: context.conflicts.map(compactContextConflict),
    ownerPage: compactContextPage(context.ownerPage),
  };
}

/**
 * Project an exhaustive topic model for complete-match discovery. The optional
 * explicit search results preserve deterministic match-mode/candidate metadata
 * for callers that already built the exhaustive model (the default partial
 * route uses buildCompactTopicCandidateContext before that model is built).
 */
export function projectTopicContext(
  context: TopicContext,
  mode: "compact" | "full" = "compact",
  matches: WikiSearchMatch[] = [],
): TopicContext | CompactTopicContext {
  if (mode === "full") return context;
  const terms = context.query.toLowerCase().split(/\s+/).filter(Boolean);
  const complete = matches.length > 0 && matches.some((match) => match.score === terms.length);
  const matchMode: CompactTopicContext["matchMode"] = matches.length === 0 ? "none" : complete ? "complete" : "partial";
  const conflicts = context.conflicts.map(compactContextConflict);
  const candidates = matchMode === "partial"
    ? matches.map((match, index) => topicCandidate(match, index + 1, context.conflicts))
    : [];
  // Partial-only discovery is deliberately a routing surface: candidates carry
  // the metadata needed to choose a page or conflict, while the caller must
  // follow a focused command before any page/source expansion occurs.
  if (matchMode === "partial") {
    return {
      version: context.version,
      mode: "compact",
      query: context.query,
      requestedConflict: context.requestedConflict,
      requestedWork: context.requestedWork,
      matchMode,
      readOrder: [],
      pages: [],
      conflicts: [],
      nonCurrentPages: [],
      candidates,
    };
  }
  return {
    version: context.version,
    mode: "compact",
    query: context.query,
    requestedConflict: context.requestedConflict,
    requestedWork: context.requestedWork,
    matchMode,
    readOrder: context.readOrder,
    pages: context.pages.map(compactContextPage),
    conflicts,
    nonCurrentPages: context.nonCurrentPages.map(compactContextPage),
    candidates,
  };
}

/**
 * Build a focused page context used by compact candidate follow-up commands.
 * It intentionally uses the same current-authority/conflict/source ordering as
 * topic and selected-work context, but selects one exact page ID rather than a
 * substring query.
 */
export function buildPageContext(view: RepoView, pages: WikiPage[], pageId: string): TopicContext {
  const target = pages.find((page) => page.data.id === pageId);
  if (!target) throw new Error(`unknown page: ${pageId}`);
  if (target.data.kind === "conflict") throw new Error(`conflict pages require --conflict ${target.data.conflict_id ?? pageId}`);

  const requestedIds = new Set<string>();
  if (target.data.status === "current") requestedIds.add(target.data.id);
  for (const page of currentPages(pages)) if (page.data.kind === "invariant") requestedIds.add(page.data.id);

  const relevantConflictPages = openConflicts(pages).filter((page) => (page.data.affected_pages ?? []).includes(target.data.id)
    || (page.data.affected_invariants ?? []).includes(target.data.id));
  for (const conflict of relevantConflictPages) {
    for (const id of [...(conflict.data.affected_pages ?? []), ...(conflict.data.affected_invariants ?? [])]) {
      const affected = pages.find((page) => page.data.id === id);
      if (affected?.data.status === "current" && affected.data.kind !== "conflict") requestedIds.add(id);
    }
  }
  const selectedCurrentPages = currentPages(pages).filter((page) => requestedIds.has(page.data.id));
  const contextPages = [
    ...selectedCurrentPages.filter((page) => page.data.kind === "invariant"),
    ...selectedCurrentPages.filter((page) => page.data.kind !== "invariant"),
  ].map((page) => selectedWorkContextPage(view, page, relevantConflictPages));
  const conflicts = relevantConflictPages.map((page) => selectedWorkContextConflict(view, page));
  const nonCurrentPages = target.data.status === "current" ? [] : [selectedWorkContextPage(view, target, relevantConflictPages)];
  return {
    version: 1,
    query: pageId,
    requestedConflict: null,
    requestedWork: null,
    readOrder: contextReadOrder(contextPages, conflicts),
    pages: contextPages,
    conflicts,
    nonCurrentPages,
    sources: [...contextPages, ...conflicts, ...nonCurrentPages].map(contextSourceSummary),
  };
}

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

export function mappedConflicts(conflictMap: ConflictMap, path: string): string[] {
  const ids = new Set(conflictMap.exact[path] ?? []);
  for (const item of conflictMap.globs) if (new Bun.Glob(item.glob).match(path)) for (const id of item.conflicts) ids.add(id);
  return [...ids].sort();
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

export function writeGenerated(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    Bun.spawnSync(["mkdir", "-p", dirname(join(root, path))]);
    writeFileSync(join(root, path), content);
  }
}

export function compareGenerated(view: RepoView, expected: Record<string, string>): Finding[] {
  const findings: Finding[] = [];
  for (const [path, content] of Object.entries(expected)) {
    if (!view.exists(path)) pushFinding(findings, path, "generated-missing", `generated file is missing; regenerate ${path}`);
    else if (view.read(path) !== content) pushFinding(findings, path, "generated-stale", `generated file differs from deterministic output; regenerate ${path}`);
    else if (path.endsWith(".md") && !content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trimStart().startsWith(GENERATED_HEADER)) {
      pushFinding(findings, path, "generated-header", "generated Markdown requires the do-not-edit header");
    }
  }
  return findings;
}

export function expandSource(view: RepoView, source: WikiSource): string[] {
  if ("path" in source) return view.exists(source.path) ? [source.path] : [];
  const glob = new Bun.Glob(source.glob);
  return view.listFiles().filter((path) => glob.match(path)).sort();
}

export function hashContent(content: string | Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

export function sourceHashes(view: RepoView, page: WikiPage): Record<string, string> {
  const result: Record<string, string> = {};
  for (const source of page.data.sources) for (const path of expandSource(view, source)) result[path] = hashContent(view.read(path));
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

export type ReusableWorkContextArtifact = {
  version: 1;
  selector: { kind: "work"; id: string };
  repository: {
    base_ref: string;
    base_sha: string;
    merge_base_sha: string;
    head_sha: string;
    metadata_digest: string;
  };
  work: {
    id: string;
    title: string;
    state: WorkState;
    queue_state: WorkQueueState;
    executor: WorkExecutor;
    owner_page: { id: string; path: string };
    acceptance: string[];
  };
  read_order: SelectedWorkContextReadEntry[];
  bindings: {
    context_digest: string;
    pages: { id: string; path: string; digest: string }[];
    conflicts: { id: string; path: string; digest: string }[];
    sources: { path: string; declared_by: string[]; digest: string }[];
  };
  artifact_digest: string;
};

function reusableArtifactCore(
  view: RepoView,
  pages: WikiPage[],
  work: WorkQueueItem,
  options: { base: string; metadata: PrMetadata },
): Omit<ReusableWorkContextArtifact, "artifact_digest"> {
  const context = buildSelectedWorkContext(view, pages, work);
  const baseRef = resolveDiffBase(view.root, options.base);
  const baseSha = git(view.root, ["rev-parse", "--verify", `${baseRef}^{commit}`]).trim();
  const mergeBaseSha = git(view.root, ["merge-base", baseRef, "HEAD"]).trim();
  const headSha = git(view.root, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  const contextPages = [...context.pages, context.ownerPage]
    .map((page) => ({ id: page.id, path: page.path, digest: hashContent(view.read(page.path)) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const conflicts = context.conflicts
    .map((conflict) => ({ id: conflict.id, path: conflict.path, digest: hashContent(view.read(conflict.path)) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const sourceDeclarations = new Map<string, Set<string>>();
  for (const summary of context.sources) {
    for (const path of summary.sourceFiles) {
      const declaredBy = sourceDeclarations.get(path) ?? new Set<string>();
      declaredBy.add(summary.pageId);
      sourceDeclarations.set(path, declaredBy);
    }
  }
  const sources = [...sourceDeclarations.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, declaredBy]) => ({ path, declared_by: [...declaredBy].sort((a, b) => a.localeCompare(b)), digest: hashContent(view.read(path)) }));
  const readOrderSources = new Map(
    context.readOrder
      .filter((entry): entry is Extract<SelectedWorkContextReadEntry, { kind: "source" }> => entry.kind === "source")
      .map((entry) => [entry.path, new Set(entry.declaredBy)]),
  );
  for (const [path, declaredBy] of sourceDeclarations) {
    const existing = readOrderSources.get(path) ?? new Set<string>();
    for (const id of declaredBy) existing.add(id);
    readOrderSources.set(path, existing);
  }
  const readOrder: SelectedWorkContextReadEntry[] = [
    ...context.readOrder.filter((entry) => entry.kind !== "source"),
    ...[...readOrderSources.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, declaredBy]) => ({ kind: "source" as const, path, declaredBy: [...declaredBy].sort((a, b) => a.localeCompare(b)) })),
  ];
  return {
    version: 1,
    selector: { kind: "work", id: work.id },
    repository: {
      base_ref: baseRef,
      base_sha: baseSha,
      merge_base_sha: mergeBaseSha,
      head_sha: headSha,
      metadata_digest: hashContent(jsonStable(canonicalPrMetadata(options.metadata))),
    },
    work: {
      id: work.id,
      title: work.title,
      state: work.state,
      queue_state: work.queue_state,
      executor: work.executor,
      owner_page: { id: work.owner_page.id, path: work.owner_page.path },
      acceptance: [...work.acceptance],
    },
    read_order: readOrder,
    bindings: {
      context_digest: hashContent(jsonStable(context)),
      pages: contextPages,
      conflicts,
      sources,
    },
  };
}

/**
 * Produce the small, body-free context handoff used between authoring and
 * implementation roles at one committed repository revision.
 */
export function buildReusableWorkContextArtifact(
  view: RepoView,
  pages: WikiPage[],
  work: WorkQueueItem,
  options: { base: string; metadata: PrMetadata },
): ReusableWorkContextArtifact {
  const core = reusableArtifactCore(view, pages, work, options);
  return { ...core, artifact_digest: hashContent(jsonStable(core)) };
}

/**
 * Recompute every binding. A reused artifact is all-or-nothing: it never
 * degrades into a partially trusted shortcut when repository context moved.
 */
export function validateReusableWorkContextArtifact(
  candidate: unknown,
  expected: ReusableWorkContextArtifact,
): Finding[] {
  if (candidate == null || typeof candidate !== "object" || Array.isArray(candidate)) {
    return [{ code: "context-artifact-malformed", message: "reusable context artifact must be a JSON object", severity: "error" }];
  }
  const artifact = candidate as Partial<ReusableWorkContextArtifact>;
  const findings: Finding[] = [];
  const stale = (code: string, message: string) => findings.push({ code, message, severity: "error" });
  if (artifact.version !== 1 || artifact.selector?.kind !== "work" || typeof artifact.selector.id !== "string"
    || typeof artifact.artifact_digest !== "string" || artifact.repository == null || artifact.bindings == null) {
    return [{ code: "context-artifact-malformed", message: "reusable context artifact is missing its version, selector, repository, bindings, or digest", severity: "error" }];
  }
  const { artifact_digest: declaredDigest, ...candidateCore } = artifact as ReusableWorkContextArtifact;
  if (hashContent(jsonStable(candidateCore)) !== declaredDigest) stale("context-artifact-digest-invalid", "reusable context artifact content does not match its artifact_digest");
  if (artifact.selector.id !== expected.selector.id) stale("context-artifact-selector-stale", `artifact work ${artifact.selector.id} does not match ${expected.selector.id}`);
  if (artifact.repository.base_ref !== expected.repository.base_ref || artifact.repository.base_sha !== expected.repository.base_sha
    || artifact.repository.merge_base_sha !== expected.repository.merge_base_sha) {
    stale("context-artifact-base-stale", "artifact base ref, base SHA, or merge-base SHA changed");
  }
  if (artifact.repository.head_sha !== expected.repository.head_sha) stale("context-artifact-head-stale", "artifact HEAD no longer matches the committed repository HEAD");
  if (artifact.repository.metadata_digest !== expected.repository.metadata_digest) stale("context-artifact-metadata-stale", "artifact PR metadata digest changed");
  if (jsonStable(artifact.bindings?.pages) !== jsonStable(expected.bindings.pages)) stale("context-artifact-pages-stale", "a controlling page digest changed");
  if (jsonStable(artifact.bindings?.conflicts) !== jsonStable(expected.bindings.conflicts)) stale("context-artifact-conflicts-stale", "a controlling conflict digest changed");
  if (jsonStable(artifact.bindings?.sources) !== jsonStable(expected.bindings.sources)) stale("context-artifact-sources-stale", "a required source digest or declaration changed");
  if (artifact.bindings?.context_digest !== expected.bindings.context_digest
    || jsonStable(artifact.work) !== jsonStable(expected.work)
    || jsonStable(artifact.read_order) !== jsonStable(expected.read_order)) {
    stale("context-artifact-context-stale", "selected work context or read order changed");
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Portable kit
//
// `kit/` is this toolkit's copy-paste distribution for other repositories. It is
// generated from the files below, never hand-edited: `wiki:kit` writes it and
// `wiki:kit --check` fails when it drifts from its sources.
//
// The payload is split by ownership because adoption and upgrade need opposite rules:
//   kit/files/**  stays kit-owned. Adoption copies it wholesale and an upgrade
//                 replaces it, so engine and rail improvements actually reach an
//                 adopting repository.
//   kit/managed/** owns only a marked block inside a shared host file. Content
//                 outside the block remains project-owned.
//   kit/seed/**   becomes the adopter's on first copy. Adoption writes each file
//                 only when it is absent and an upgrade never touches it, so
//                 project policy, recorded source hashes, and a project-specific
//                 inventory implementation survive.
// `.wiki/kit-manifest.json` ships that split plus a sha256 per file, which is
// what lets an upgrade tell an untouched file from a locally edited one instead
// of overwriting both alike.
// ---------------------------------------------------------------------------

export const KIT_ROOT = "kit";
export const KIT_MANIFEST_TARGET = ".wiki/kit-manifest.json";
export const KIT_EXCLUDE_START = "<!-- kit:exclude:start -->";
export const KIT_EXCLUDE_END = "<!-- kit:exclude:end -->";

/** Scripts that drive this repository's own distribution and mean nothing downstream. */
const KIT_OMITTED_SCRIPTS = new Set(["wiki:kit"]);

export type KitOwnership = "kit" | "seed";

/**
 * Where a generated file sits under `kit/`, which decides what happens to it in
 * an adopting repository:
 *   files     copied on adoption and replaced on upgrade
 *   seed      copied only when absent and never updated
 *   managed   one marked block is replaced while surrounding host content stays
 *   reference read from the kit checkout, never copied — so nothing an adopter
 *             merges and deletes gets re-dropped by the next upgrade
 */
export type KitPlacement = "files" | "seed" | "managed" | "reference";

type KitSource =
  | { kind: "copy"; from: string }
  | { kind: "strip"; from: string }
  | { kind: "managed-block"; from: string; start: string; end: string; legacyMarkers?: string[] }
  | { kind: "legacy-v1-workflow"; host: string; wiki: string }
  | { kind: "literal"; content: string }
  | { kind: "package-fragment"; from: string };

export type KitEntry = { target: string; placement: KitPlacement; source: KitSource };

const KIT_CONFIG_TEMPLATE = jsonStable({
  version: 1,
  name: "your-repo",
  highRisk: ["src/contracts/**", "src/db/**", "migrations/**"],
  freshContext: {
    mode: "required",
    requiredVerdict: "PASS",
    evidenceRequired: true,
    requiredWhen: {
      kind: "risk-based",
      changedFileGlobs: [".github/workflows/**", ".wiki/config.json", "AGENTS.md", "scripts/wiki/**", "wiki/SCHEMA.md", "wiki/WORKFLOW.md"],
      affectedInvariants: true,
      affectedConflicts: true,
      removedCurrentPages: true,
    },
    trust: { allowedReviewers: ["*"], requireDifferentActor: false, requireAuthenticatedActor: true },
  },
});

const KIT_COVERAGE_TEMPLATE = jsonStable({ version: 1, include: [], exclusions: [] });

const KIT_STATE_TEMPLATE = jsonStable({ version: 1, pages: {} });

const KIT_CHANGELOG_TEMPLATE = `# Changelog

Record only current-contract changes here: product-contract changes, significant architecture decisions, invariant changes, large reconciles, and schema or process changes. Git remains the source of truth for ordinary change history.

- Wiki established from the wiki-ssot kit.
`;

/**
 * Every file the kit ships, with how it is produced and who owns it afterwards.
 * Adding a file here is the only way it reaches an adopting repository.
 */
export const KIT_ENTRIES: KitEntry[] = [
  { target: "scripts/wiki/core.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/core.ts" } },
  { target: "scripts/wiki/cli.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/cli.ts" } },
  { target: "scripts/wiki/github-attestation.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/github-attestation.ts" } },
  // Reference, not copied at all: it is documentation of the inventory patterns,
  // read from the kit checkout when someone writes their own `inventories.ts`.
  // Delivering it would mean an adopter carrying a file they never run, and seed
  // placement could not even let them delete it — "seed" means "written when
  // absent", so the next sync would put it straight back.
  { target: "scripts/wiki/inventories.example.ts", placement: "reference", source: { kind: "copy", from: "scripts/wiki/inventories.example.ts" } },
  { target: "scripts/wiki/wiki.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/wiki.test.ts" } },
  { target: "scripts/wiki/work.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/work.test.ts" } },
  { target: "scripts/wiki/fresh-context.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/fresh-context.test.ts" } },
  { target: "scripts/wiki/test-runner.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/test-runner.ts" } },
  { target: "scripts/wiki/tsconfig.json", placement: "files", source: { kind: "copy", from: "scripts/wiki/tsconfig.json" } },
  { target: ".github/workflows/wiki-ssot.yml", placement: "files", source: { kind: "copy", from: ".github/workflows/wiki-ssot.yml" } },
  { target: ".github/workflows/wiki-audit.yml", placement: "files", source: { kind: "copy", from: ".github/workflows/wiki-audit.yml" } },
  {
    target: "migrations/v1/checks.yml",
    placement: "reference",
    source: { kind: "legacy-v1-workflow", host: ".github/workflows/checks.yml", wiki: ".github/workflows/wiki-ssot.yml" },
  },
  {
    target: "migrations/v1/host-checks.yml",
    placement: "reference",
    source: { kind: "copy", from: ".github/workflows/checks.yml" },
  },
  {
    target: ".github/pull_request_template.md",
    placement: "managed",
    source: {
      kind: "managed-block", from: ".github/pull_request_template.md",
      start: "<!-- wiki-ssot:managed:start -->", end: "<!-- wiki-ssot:managed:end -->",
      legacyMarkers: ["fresh_context:"],
    },
  },
  {
    target: ".husky/pre-commit",
    placement: "managed",
    source: {
      kind: "managed-block", from: ".husky/pre-commit",
      start: "# wiki-ssot:managed:start", end: "# wiki-ssot:managed:end",
      legacyMarkers: ["bun run wiki:lint --staged"],
    },
  },
  {
    target: ".husky/pre-push",
    placement: "managed",
    source: {
      kind: "managed-block", from: ".husky/pre-push",
      start: "# wiki-ssot:managed:start", end: "# wiki-ssot:managed:end",
      legacyMarkers: ["refs/heads/main"],
    },
  },
  {
    target: "AGENTS.md",
    placement: "managed",
    source: {
      kind: "managed-block", from: "AGENTS.md",
      start: "<!-- wiki-ssot:managed:start -->", end: "<!-- wiki-ssot:managed:end -->",
      legacyMarkers: ["<!-- wiki-ssot:fresh-context-guardrail -->"],
    },
  },
  { target: "wiki/README.md", placement: "files", source: { kind: "strip", from: "wiki/README.md" } },
  { target: "wiki/SCHEMA.md", placement: "files", source: { kind: "strip", from: "wiki/SCHEMA.md" } },
  { target: "wiki/WORKFLOW.md", placement: "files", source: { kind: "strip", from: "wiki/WORKFLOW.md" } },
  { target: "CLAUDE.md", placement: "seed", source: { kind: "strip", from: "CLAUDE.md" } },
  { target: ".gitignore", placement: "seed", source: { kind: "copy", from: ".gitignore" } },
  { target: "tsconfig.json", placement: "seed", source: { kind: "copy", from: "tsconfig.json" } },
  { target: "scripts/wiki/inventories.ts", placement: "seed", source: { kind: "copy", from: "scripts/wiki/inventories.ts" } },
  { target: ".wiki/config.json", placement: "seed", source: { kind: "literal", content: KIT_CONFIG_TEMPLATE } },
  { target: ".wiki/coverage.json", placement: "seed", source: { kind: "literal", content: KIT_COVERAGE_TEMPLATE } },
  { target: ".wiki/state.json", placement: "seed", source: { kind: "literal", content: KIT_STATE_TEMPLATE } },
  { target: "wiki/changelog.md", placement: "seed", source: { kind: "literal", content: KIT_CHANGELOG_TEMPLATE } },
  // Merged into an existing package.json and then discarded, so it must not be a
  // payload file: an upgrade would keep re-creating what the adopter deleted.
  { target: "package.kit.json", placement: "reference", source: { kind: "package-fragment", from: "package.json" } },
];

export function kitPath(entry: Pick<KitEntry, "target" | "placement">): string {
  return entry.placement === "reference" ? `${KIT_ROOT}/${entry.target}` : `${KIT_ROOT}/${entry.placement}/${entry.target}`;
}

/** Everything under `kit/` the generator owns. `kit/README.md` is hand-written. */
export function isKitManagedPath(path: string): boolean {
  return path.startsWith(`${KIT_ROOT}/`) && path !== `${KIT_ROOT}/README.md`;
}

/**
 * Drop `kit:exclude` regions so instance-only guidance — rules about developing
 * this engine, links to pages only this repository has — never ships downstream.
 */
export function stripKitExclusions(raw: string): { content: string; error?: string } {
  const kept: string[] = [];
  let depth = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === KIT_EXCLUDE_START) { depth += 1; continue; }
    if (trimmed === KIT_EXCLUDE_END) {
      if (depth === 0) return { content: raw, error: `unbalanced ${KIT_EXCLUDE_END}` };
      depth -= 1;
      continue;
    }
    if (depth === 0) kept.push(line);
  }
  if (depth !== 0) return { content: raw, error: `unclosed ${KIT_EXCLUDE_START}` };
  return { content: kept.join("\n") };
}

function kitPackageFragment(raw: string): { content: string; error?: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { content: "", error: "package.json is not valid JSON" }; }
  const pkg = parsed as { engines?: unknown; scripts?: Record<string, string>; devDependencies?: unknown };
  const scripts = Object.fromEntries(Object.entries(pkg.scripts ?? {})
    .filter(([name]) => name.startsWith("wiki:") && !KIT_OMITTED_SCRIPTS.has(name)));
  return { content: jsonStable({ engines: pkg.engines, scripts, devDependencies: pkg.devDependencies }) };
}

function extractManagedBlock(raw: string, source: Extract<KitSource, { kind: "managed-block" }>): { content: string; error?: string } {
  const starts = raw.split(source.start).length - 1;
  const ends = raw.split(source.end).length - 1;
  const startIndex = raw.indexOf(source.start);
  const endIndex = raw.indexOf(source.end, startIndex + source.start.length);
  if (starts !== 1 || ends !== 1 || startIndex < 0 || endIndex < startIndex) {
    return { content: "", error: `managed source must contain exactly one ordered ${source.start}/${source.end} block` };
  }
  const block = raw.slice(startIndex, endIndex + source.end.length);
  const stripped = stripKitExclusions(block);
  return stripped.error ? stripped : { content: `${stripped.content.trim()}\n` };
}

function renderKitEntry(view: RepoView, entry: KitEntry, findings: Finding[]): string | null {
  const source = entry.source;
  if (source.kind === "literal") return source.content;
  if (source.kind === "legacy-v1-workflow") {
    const missing = [source.host, source.wiki].filter((path) => !view.exists(path));
    if (missing.length > 0) {
      for (const path of missing) pushFinding(findings, path, "kit-source-missing", `kit entry ${entry.target} has no source file`);
      return null;
    }
    const host = view.read(source.host);
    const wiki = view.read(source.wiki);
    const delimiter = "jobs:\n";
    const hostJobsAt = host.indexOf(delimiter);
    const wikiJobsAt = wiki.indexOf(delimiter);
    if (hostJobsAt < 0 || wikiJobsAt < 0) {
      pushFinding(findings, source.wiki, "kit-source-invalid", `kit entry ${entry.target} cannot reconstruct the version 1 combined workflow`);
      return null;
    }
    const combinedHeader = wiki.slice(0, wikiJobsAt).replace(/^name: wiki-ssot$/m, "name: checks");
    const hostJobs = host.slice(hostJobsAt + delimiter.length).trimEnd();
    const wikiJobs = wiki.slice(wikiJobsAt + delimiter.length);
    return `${combinedHeader}${delimiter}${hostJobs}\n\n${wikiJobs}`;
  }
  if (!view.exists(source.from)) {
    pushFinding(findings, source.from, "kit-source-missing", `kit entry ${entry.target} has no source file`);
    return null;
  }
  const raw = view.read(source.from);
  if (source.kind === "copy") return raw;
  if (source.kind === "package-fragment") {
    const fragment = kitPackageFragment(raw);
    if (fragment.error) {
      pushFinding(findings, source.from, "kit-source-invalid", `kit entry ${entry.target}: ${fragment.error}`);
      return null;
    }
    return fragment.content;
  }
  if (source.kind === "managed-block") {
    const block = extractManagedBlock(raw, source);
    if (block.error) {
      pushFinding(findings, source.from, "kit-managed-block-invalid", `kit entry ${entry.target}: ${block.error}`);
      return null;
    }
    return block.content;
  }
  const stripped = stripKitExclusions(raw);
  if (stripped.error) {
    pushFinding(findings, source.from, "kit-exclude-unbalanced", `kit entry ${entry.target}: ${stripped.error}`);
    return null;
  }
  return stripped.content;
}

export function kitFiles(view: RepoView): { files: Record<string, string>; findings: Finding[] } {
  const findings: Finding[] = [];
  const rendered: { entry: KitEntry; content: string }[] = [];
  for (const entry of KIT_ENTRIES) {
    const content = renderKitEntry(view, entry, findings);
    if (content != null) rendered.push({ entry, content });
  }

  // Reference files are read from the kit checkout, never copied, so they stay
  // out of the file map a sync walks. They are still part of the kit, so they
  // are hashed separately and folded into the digest — otherwise changing the
  // dependencies an adopter must merge would leave the digest, and every
  // "are you up to date" check built on it, claiming nothing moved.
  const manifestFiles: Record<string, { sha256: string; ownership: KitOwnership }> = {};
  const manifestReference: Record<string, string> = {};
  const manifestManaged: Record<string, { sha256: string; start: string; end: string; legacyMarkers?: string[] }> = {};
  for (const { entry, content } of rendered) {
    if (entry.placement === "reference") manifestReference[entry.target] = hashContent(content);
    else if (entry.placement === "managed") {
      const source = entry.source as Extract<KitSource, { kind: "managed-block" }>;
      manifestManaged[entry.target] = {
        sha256: hashContent(content), start: source.start, end: source.end,
        ...(source.legacyMarkers == null ? {} : { legacyMarkers: source.legacyMarkers }),
      };
    }
    else manifestFiles[entry.target] = { sha256: hashContent(content), ownership: entry.placement === "files" ? "kit" : "seed" };
  }
  const manifest = {
    version: 2,
    kit: "wiki-ssot",
    // Content-addressed rather than tagged: the digest identifies exactly which
    // kit an adopter holds without a version string or a timestamp to drift.
    digest: hashContent(jsonStable({ files: manifestFiles, managed: manifestManaged, reference: manifestReference })),
    files: manifestFiles,
    managed: manifestManaged,
    reference: manifestReference,
  };

  const files: Record<string, string> = {};
  for (const { entry, content } of rendered) files[kitPath(entry)] = content;
  files[kitPath({ target: KIT_MANIFEST_TARGET, placement: "files" })] = jsonStable(manifest);
  return { files, findings };
}

/**
 * Byte comparison only. `compareGenerated` additionally demands the do-not-edit
 * header on every generated Markdown file, which must never appear in a kit file
 * that becomes an adopter's own `AGENTS.md` or `wiki/SCHEMA.md`.
 */
export function compareKit(view: RepoView, expected: Record<string, string>): Finding[] {
  const findings: Finding[] = [];
  for (const [path, content] of Object.entries(expected)) {
    if (!view.exists(path)) pushFinding(findings, path, "kit-missing", `kit file is missing; run bun run wiki:kit`);
    else if (view.read(path) !== content) pushFinding(findings, path, "kit-stale", `kit file differs from its source; run bun run wiki:kit`);
  }
  for (const path of view.listFiles()) {
    // Test on disk, not through the view: `git ls-files --cached` still lists a
    // file `wiki:kit` just deleted until the deletion is staged, which would
    // make a freshly regenerated kit report its own removals as orphans.
    if (isKitManagedPath(path) && !(path in expected) && existsSync(join(view.root, path))) {
      pushFinding(findings, path, "kit-orphan", `kit file is no longer produced by the generator; run bun run wiki:kit`);
    }
  }
  return findings;
}

export function writeKit(view: RepoView, files: Record<string, string>): { written: string[]; removed: string[] } {
  const removed: string[] = [];
  for (const path of view.listFiles()) {
    if (!isKitManagedPath(path) || path in files) continue;
    rmSync(join(view.root, path), { force: true });
    removed.push(path);
  }
  writeGenerated(view.root, files);
  return { written: Object.keys(files).sort(), removed: removed.sort() };
}

export type WikiState = {
  version: 1;
  pages: Record<string, { sources: Record<string, string>; verification: { kind: "updated" | "unchanged"; reason?: string } }>;
};

export type StateAudit = {
  stalePages: string[];
  highRiskStalePages: string[];
  advisoryStalePages: string[];
  findings: Finding[];
};

export type AuditReport = {
  ok: boolean;
  findings: Finding[];
  stalePages: string[];
  highRiskStalePages: string[];
  advisoryStalePages: string[];
  openConflicts: ConflictSummary[];
};

export function readState(view: RepoView): WikiState {
  if (!view.exists(".wiki/state.json")) return { version: 1, pages: {} };
  return JSON.parse(view.read(".wiki/state.json")) as WikiState;
}

export function verifyState(view: RepoView, pages: WikiPage[], ids: string[], unchangedReason?: string): WikiState {
  if (unchangedReason != null && unchangedReason.trim().length < 20) throw new UsageError("--unchanged reason must contain at least 20 characters");
  const state = readState(view);
  const selected = ids.length === 0 ? currentPages(pages) : ids.map((id) => pages.find((page) => page.data.id === id) ?? (() => { throw new UsageError(`unknown page id: ${id}`); })());
  if (ids.length === 0) state.pages = {};
  for (const page of selected) {
    state.pages[page.data.id] = {
      sources: sourceHashes(view, page),
      verification: unchangedReason == null ? { kind: "updated" } : { kind: "unchanged", reason: unchangedReason.trim() },
    };
  }
  state.pages = Object.fromEntries(Object.entries(state.pages).sort(([a], [b]) => a.localeCompare(b)));
  return state;
}

export class UsageError extends Error {}

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateState(view: RepoView, pages: WikiPage[]): StateAudit {
  let state: WikiState;
  try {
    state = readState(view);
  } catch (error) {
    return {
      stalePages: [],
      highRiskStalePages: [],
      advisoryStalePages: [],
      findings: [{ code: "state-parse", message: error instanceof Error ? error.message : String(error), path: ".wiki/state.json", severity: "error" }],
    };
  }
  const findings: Finding[] = [];
  const stalePages: string[] = [];
  const highRiskStalePages: string[] = [];
  const advisoryStalePages: string[] = [];
  if (state.version !== 1 || state.pages == null || typeof state.pages !== "object" || Array.isArray(state.pages)) {
    findings.push({ code: "state-invalid", message: "state requires version 1 and a pages object", path: ".wiki/state.json", severity: "error" });
    return { stalePages, highRiskStalePages, advisoryStalePages, findings };
  }
  const config = readConfig(view);
  const current = currentPages(pages);
  const currentIds = new Set(current.map((page) => page.data.id));
  for (const id of Object.keys(state.pages)) {
    if (!currentIds.has(id)) findings.push({ code: "state-non-current-page", message: `state contains a non-current page: ${id}`, path: ".wiki/state.json", severity: "warning" });
  }
  for (const page of current) {
    const entry = state.pages[page.data.id];
    const actual = sourceHashes(view, page);
    const stored = entry?.sources ?? {};
    if (entry?.verification?.kind === "unchanged" && (entry.verification.reason?.trim().length ?? 0) < 20) {
      findings.push({ code: "state-unchanged-reason", message: `unchanged verification requires a 20+ character reason: ${page.data.id}`, path: ".wiki/state.json", severity: "error" });
    } else if (entry != null && !["updated", "unchanged"].includes(entry.verification?.kind)) {
      findings.push({ code: "state-verification-kind", message: `invalid verification kind: ${page.data.id}`, path: ".wiki/state.json", severity: "error" });
    }
    if (jsonStable(stored) === jsonStable(actual)) continue;
    stalePages.push(page.data.id);
    const changedSources = new Set([...Object.keys(stored), ...Object.keys(actual)].filter((path) => stored[path] !== actual[path]));
    const highRisk = [...changedSources].some((path) => isHighRisk(config, path));
    (highRisk ? highRiskStalePages : advisoryStalePages).push(page.data.id);
    findings.push({
      code: highRisk ? "state-stale-high-risk" : "state-stale-low-risk",
      message: `${highRisk ? "high-risk" : "low-risk"} sources changed since verification: ${page.data.id}`,
      path: ".wiki/state.json",
      severity: "error",
    });
  }
  return { stalePages: stalePages.sort(), highRiskStalePages: highRiskStalePages.sort(), advisoryStalePages: advisoryStalePages.sort(), findings };
}

export function allLintFindings(view: RepoView, checkGenerated = true): { pages: WikiPage[]; findings: Finding[] } {
  const loaded = loadWikiPages(view);
  const findings = [...loaded.findings, ...validatePages(view, loaded.pages), ...validateMarkdownLinks(view), ...validateCoverage(view, loaded.pages), ...validateIntegrationSeams(view)];
  if (checkGenerated) findings.push(...compareGenerated(view, generatedCoreFiles(loaded.pages, readConfig(view).name)));
  return { pages: loaded.pages, findings };
}

export type FreshContextMode = "advisory" | "required";
export type FreshContextTrustPolicy = {
  allowedReviewers: string[];
  requireDifferentActor: boolean;
  requireAuthenticatedActor: boolean;
};
export type FreshContextRequiredWhen =
  | { kind: "all" }
  | {
    kind: "risk-based";
    changedFileGlobs: string[];
    affectedInvariants: boolean;
    affectedConflicts: boolean;
    removedCurrentPages: boolean;
  };
export type FreshContextPolicy = {
  mode: FreshContextMode;
  requiredVerdict: "PASS";
  evidenceRequired: boolean;
  trust: FreshContextTrustPolicy;
  requiredWhen?: FreshContextRequiredWhen;
};
export type WikiConfig = {
  version: 1;
  name: string;
  highRisk: string[];
  /**
   * True only in the repository that publishes the `kit/` distribution. This
   * engine is shipped verbatim inside that distribution, so every rule about
   * `kit/` has to be opt-in: in an adopting repository `kit/` is an ordinary
   * directory holding whatever that project keeps there, and silently exempting
   * it from the wiki rails — or letting `wiki:kit` overwrite it — would be a
   * rule about this repository's layout leaking into theirs.
   */
  publishesKit: boolean;
  freshContext?: FreshContextPolicy;
};

export function parseFreshContextPolicy(value: unknown): FreshContextPolicy | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const policy = value as Record<string, unknown>;
  const trust = policy.trust;
  if (policy.mode !== "advisory" && policy.mode !== "required") return undefined;
  if (policy.requiredVerdict !== "PASS" || typeof policy.evidenceRequired !== "boolean") return undefined;
  if (trust == null || typeof trust !== "object" || Array.isArray(trust)) return undefined;
  const trustValue = trust as Record<string, unknown>;
  if (!stringArray(trustValue.allowedReviewers) || trustValue.allowedReviewers.length === 0 || typeof trustValue.requireDifferentActor !== "boolean" || typeof trustValue.requireAuthenticatedActor !== "boolean") return undefined;
  let requiredWhen: FreshContextRequiredWhen | undefined;
  if (policy.requiredWhen != null) {
    if (typeof policy.requiredWhen !== "object" || Array.isArray(policy.requiredWhen)) return undefined;
    const required = policy.requiredWhen as Record<string, unknown>;
    if (required.kind === "all") {
      requiredWhen = { kind: "all" };
    } else if (required.kind === "risk-based") {
      if (!stringArray(required.changedFileGlobs)
        || required.changedFileGlobs.some((pattern) => pattern.trim().length === 0)
        || typeof required.affectedInvariants !== "boolean"
        || typeof required.affectedConflicts !== "boolean"
        || typeof required.removedCurrentPages !== "boolean") return undefined;
      try {
        for (const pattern of required.changedFileGlobs) new Bun.Glob(pattern);
      } catch {
        return undefined;
      }
      if (required.changedFileGlobs.length === 0 && !required.affectedInvariants && !required.affectedConflicts && !required.removedCurrentPages) return undefined;
      requiredWhen = {
        kind: "risk-based",
        changedFileGlobs: [...required.changedFileGlobs].sort((a, b) => a.localeCompare(b)),
        affectedInvariants: required.affectedInvariants,
        affectedConflicts: required.affectedConflicts,
        removedCurrentPages: required.removedCurrentPages,
      };
    } else {
      return undefined;
    }
  }
  return {
    mode: policy.mode,
    requiredVerdict: "PASS",
    evidenceRequired: policy.evidenceRequired,
    trust: {
      allowedReviewers: [...trustValue.allowedReviewers].sort((a, b) => a.localeCompare(b)),
      requireDifferentActor: trustValue.requireDifferentActor,
      requireAuthenticatedActor: trustValue.requireAuthenticatedActor,
    },
    ...(requiredWhen ? { requiredWhen } : {}),
  };
}

export function readConfig(view: RepoView): WikiConfig {
  const fallback: WikiConfig = { version: 1, name: "Project", highRisk: [], publishesKit: false };
  if (!view.exists(".wiki/config.json")) return fallback;
  try {
    const raw = JSON.parse(view.read(".wiki/config.json")) as Record<string, unknown>;
    const freshContext = parseFreshContextPolicy(raw.freshContext);
    return {
      version: 1,
      name: typeof raw.name === "string" && raw.name.length > 0 ? raw.name : "Project",
      highRisk: Array.isArray(raw.highRisk) ? raw.highRisk.filter((item): item is string => typeof item === "string" && item.length > 0) : [],
      publishesKit: raw.publishesKit === true,
      ...(freshContext ? { freshContext } : {}),
    };
  } catch {
    return fallback;
  }
}

function agentEntrypointContractGaps(agents: string): string[] {
  const lines = agents
    .split(/\r?\n/)
    .map((line) => line.replace(/[‘’]/g, "'").toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
  const gaps: string[] = [];
  const hasLine = (predicate: (line: string) => boolean) => lines.some(predicate);
  const hasWorkCommand = (line: string) => /(?:^|\s)bun run wiki:work(?=$|[\s,.;:—–])/.test(line);
  const explicitlyNegatesAction = (line: string, action: RegExp) => {
    const negation = /\b(?:do not|does not|don't|never|avoid|ignore|skip|must not|should not|cannot|can't|refuse to|not to)\b/g;
    for (const match of line.matchAll(negation)) {
      const sameClause = line.slice((match.index ?? 0) + match[0].length).split(/[.;—–]/, 1)[0];
      if (action.test(sameClause)) return true;
    }
    return false;
  };
  const hasNegatedWorkAction = (line: string) => explicitlyNegatesAction(
    line,
    /(?:^\s*bun run wiki:work\b|\b(?:run(?:ning)?|execut(?:e|ing)|us(?:e|ing)|invok(?:e|ing))\b[^.;]*\bbun run wiki:work\b)/,
  );
  const hasNoQueryPrerequisite = (line: string) =>
    /(without|no (?:known )?(?:node|id|search term)|before topic search)/.test(line)
    || /\b(?:do not require|(?:do|does) not need)\s+(?:(?:a|an|any|the)\s+)?(?:known\s+)?(?:node|proposal id|work id|search term)\b/.test(line);

  if (!hasLine((line) =>
    !explicitlyNegatesAction(line, /\b(start|begin|open|read|consult)\b/)
    && /\b(start|begin|open|read|consult)\b/.test(line)
    && line.includes("wiki/index.md")
    && line.includes("wiki/current-status.md")
    && line.includes("kind: invariant"))) {
    gaps.push("the wiki index/current-status/invariant read route");
  }
  if (!hasLine((line) =>
    !hasNegatedWorkAction(line)
    && hasWorkCommand(line)
    && /(what remains|unfinished|what should (?:we|you) do next|what should happen next|remaining[- ]work|next[- ]work)/.test(line)
    && hasNoQueryPrerequisite(line))) {
    gaps.push("the no-query generic remaining-work route");
  }
  if (!hasLine((line) =>
    !explicitlyNegatesAction(line, /\b(run|execute|follow|use|open)\b/)
    && /\bselect(?:ed|ing)?\b/.test(line)
    && /(returned|result|printed)/.test(line)
    && /\b(run|execute|follow|use|open)\b/.test(line)
    && line.includes("wiki:context -- --work <id>"))) {
    gaps.push("the selected-work context route");
  }
  if (!hasLine((line) =>
    !explicitlyNegatesAction(line, /\b(search|run|execute|use|open|consult)\b/)
    && /\b(search|topic)\b/.test(line)
    && /\b(edit|editing|implement|implementation)\b/.test(line)
    && line.includes('wiki:search -- "<task terms>"')
    && line.includes('wiki:context -- "<task terms>"'))) {
    gaps.push("the topic search/context route");
  }
  if (!hasLine((line) =>
    !explicitlyNegatesAction(line, /\b(label|present|state|treat|keep)\w*\b/)
    && ["proposed", "conflicted", "deprecated", "archived"].every((status) => line.includes(status))
    && /\b(label|present|state|status|treat)\w*\b/.test(line)
    && /(not current|non-current)/.test(line))) {
    gaps.push("the non-current authority boundary");
  }
  // Executor metadata is a routing contract, not an authorization mechanism.
  // This guardrail intentionally accepts the required negative authority
  // clause ("do not assume authority") instead of sending it through the
  // generic route-negation detector above.
  const humanOnlyNotAutoSelected = lines.some((line) =>
    ( /\bhuman[- ](?:only|exclusive)\b/.test(line)
      || /\bexecutor\s*:\s*human\b/.test(line)
      || /\bhuman\s+work\b/.test(line) )
    && (
      /\b(?:never|not|must not|should not|cannot|can't|do not)\b[^.;—–]{0,120}\b(?:auto[- ]?select(?:ed|ion)?|recommend(?:ed|ation)?|select(?:ed)? automatically|automatically\s+select)\b/.test(line)
      || /\b(?:never|not|must not|should not|cannot|can't|do not)\b[^.;—–]{0,120}\b(?:auto[- ]?select(?:ed|ion)?|recommend(?:ed|ation)?|select(?:ed)? automatically|automatically\s+select)\b[^.;—–]{0,120}(?:human[- ](?:only|exclusive)|executor\s*:\s*human|human\s+work)\b/.test(line)
    ));
  const reportsProcedure = lines.some((line) =>
    /\b(?:report|document|describe|provide|explain|state)\b[^.;—–]{0,120}\b(?:procedure|steps?|process|instructions?)\b/.test(line)
    && !explicitlyNegatesAction(line, /\b(?:report|document|describe|provide|explain|state)\b/));
  const handsOffToHuman = lines.some((line) =>
    /\b(?:hand(?:\s+it)?[- ]off|handoff|escalat(?:e|ion)|refer)\b[^.;—–]{0,100}\bhumans?\b/.test(line)
    && !explicitlyNegatesAction(line, /\b(?:hand(?:\s+it)?[- ]off|handoff|escalat(?:e|ion)|refer)\b/));
  const doesNotAssumeAuthority = lines.some((line) =>
    /\b(?:do not|must not|should not|never|cannot|can't)\s+(?:assume|presume)\s+(?:(?:any|additional|extra)\s+)?(?:credentials?|authority|permissions?)(?:\s+or\s+(?:credentials?|authority|permissions?))?\b/.test(line)
    || /\bno\s+(?:assumed|assumption of)\s+(?:credentials?|authority|permissions?)\b/.test(line)
    || /\bwithout\s+assuming\b[^.;—–]{0,100}\b(?:credentials?|authority|permissions?)\b/.test(line));
  if (!humanOnlyNotAutoSelected || !reportsProcedure || !handsOffToHuman || !doesNotAssumeAuthority) {
    gaps.push("the human-work executor guardrail (human-only auto-selection exclusion, procedure report/handoff, and no assumed authority)");
  }
  return gaps;
}

export function validateIntegrationSeams(view: RepoView): Finding[] {
  const findings: Finding[] = [];
  let configRaw: Record<string, unknown> | undefined;
  if (!view.exists(".wiki/config.json")) {
    findings.push({ code: "fresh-context-config-missing", message: ".wiki/config.json must declare an explicit freshContext policy", path: ".wiki/config.json", severity: "error" });
  } else {
    try {
      const parsed = JSON.parse(view.read(".wiki/config.json")) as unknown;
      if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) configRaw = parsed as Record<string, unknown>;
      else throw new Error("config must be a JSON object");
    } catch (error) {
      findings.push({ code: "fresh-context-config-invalid", message: error instanceof Error ? error.message : String(error), path: ".wiki/config.json", severity: "error" });
    }
    if (configRaw && configRaw.freshContext == null) {
      findings.push({ code: "fresh-context-config-missing", message: ".wiki/config.json must declare an explicit freshContext policy; missing policy never falls back silently to advisory", path: ".wiki/config.json", severity: "error" });
    } else if (configRaw && !parseFreshContextPolicy(configRaw.freshContext)) {
      findings.push({ code: "fresh-context-config-invalid", message: "freshContext requires mode, requiredVerdict: PASS, evidenceRequired, a complete trust policy, and a valid optional requiredWhen selector", path: ".wiki/config.json", severity: "error" });
    }
  }

  const agents = view.exists("AGENTS.md") ? view.read("AGENTS.md") : "";
  if (!agents.includes("wiki-ssot:fresh-context-guardrail")) {
    findings.push({ code: "fresh-context-agents-marker-missing", message: "root AGENTS.md must contain the wiki-ssot:fresh-context-guardrail integration marker", path: "AGENTS.md", severity: "error" });
  }
  const entrypointGaps = agentEntrypointContractGaps(agents);
  if (!agents.includes("wiki-ssot:work-discovery") || entrypointGaps.includes("the no-query generic remaining-work route")) {
    findings.push({ code: "work-discovery-entrypoint-missing", message: "root AGENTS.md must route generic remaining-work requests to bun run wiki:work without requiring a known node, ID, or search term", path: "AGENTS.md", severity: "error" });
  }
  if (entrypointGaps.length > 0) {
    findings.push({
      code: "agent-entrypoint-contract-incomplete",
      message: `root AGENTS.md must provide a meaningful provider-neutral wiki route; missing ${entrypointGaps.join(", ")}`,
      path: "AGENTS.md",
      severity: "error",
    });
  }

  const packagePath = "package.json";
  let scripts: Record<string, unknown> = {};
  if (view.exists(packagePath)) {
    try {
      const parsed = JSON.parse(view.read(packagePath)) as { scripts?: Record<string, unknown> };
      scripts = parsed.scripts ?? {};
    } catch {
      // The ordinary package/tooling checks report malformed package.json.
    }
  }
  if (scripts["wiki:review-preflight"] !== "bun scripts/wiki/cli.ts review-preflight"
    || scripts["wiki:review-check"] !== "bun scripts/wiki/cli.ts review-check"
    || scripts["wiki:doctor"] !== "bun scripts/wiki/cli.ts doctor") {
    findings.push({ code: "fresh-context-command-missing", message: "package.json must expose the canonical wiki:review-preflight, wiki:review-check, and wiki:doctor CLI entrypoints", path: packagePath, severity: "error" });
  }
  if (scripts["wiki:work"] !== "bun scripts/wiki/cli.ts work") {
    findings.push({ code: "work-command-missing", message: "package.json must expose the canonical wiki:work CLI entrypoint", path: packagePath, severity: "error" });
  }

  return findings;
}

export function isHighRisk(config: WikiConfig, path: string): boolean {
  return config.highRisk.some((pattern) => pattern === path || new Bun.Glob(pattern).match(path));
}

type CoverageConfig = {
  version: 1;
  include: string[];
  exclusions: { glob: string; reason: string }[];
};

export function validateCoverage(view: RepoView, pages: WikiPage[]): Finding[] {
  if (!view.exists(".wiki/coverage.json")) return [];
  let config: CoverageConfig;
  try {
    config = JSON.parse(view.read(".wiki/coverage.json")) as CoverageConfig;
  } catch (error) {
    return [{ code: "coverage-config-parse", message: error instanceof Error ? error.message : String(error), path: ".wiki/coverage.json", severity: "error" }];
  }
  if (config.version !== 1 || !Array.isArray(config.include) || !config.include.every((item) => typeof item === "string" && item.length > 0) || !Array.isArray(config.exclusions)) {
    return [{ code: "coverage-config-invalid", message: "coverage config requires version 1, include[], and exclusions[]", path: ".wiki/coverage.json", severity: "error" }];
  }
  const findings: Finding[] = [];
  const sourceMap = buildSourceMap(pages);
  const exclusionGlobs: Bun.Glob[] = [];
  for (const exclusion of config.exclusions) {
    if (exclusion == null || typeof exclusion !== "object" || typeof exclusion.glob !== "string" || typeof exclusion.reason !== "string" || exclusion.reason.trim().length < 20) {
      findings.push({ code: "coverage-exclusion-invalid", message: "coverage exclusions require a glob and a 20+ character reason", path: ".wiki/coverage.json", severity: "error" });
      continue;
    }
    try { exclusionGlobs.push(new Bun.Glob(exclusion.glob)); }
    catch { findings.push({ code: "coverage-exclusion-glob-invalid", message: `invalid coverage exclusion: ${exclusion.glob}`, path: ".wiki/coverage.json", severity: "error" }); }
  }
  const files = new Set<string>();
  for (const pattern of config.include) {
    let glob: Bun.Glob;
    try { glob = new Bun.Glob(pattern); }
    catch {
      findings.push({ code: "coverage-glob-invalid", message: `invalid coverage include: ${pattern}`, path: ".wiki/coverage.json", severity: "error" });
      continue;
    }
    const matched = view.listFiles().filter((path) => glob.match(path));
    if (matched.length === 0) findings.push({ code: "coverage-include-empty", message: `coverage include matches no tracked files: ${pattern}`, path: ".wiki/coverage.json", severity: "error" });
    for (const path of matched) files.add(path);
  }
  for (const path of [...files].sort()) {
    if (exclusionGlobs.some((glob) => glob.match(path))) continue;
    if (mappedPages(sourceMap, path).length === 0) findings.push({ code: "coverage-unmapped", message: `major code source has no current wiki mapping: ${path} — add this path to a current page's sources: (the feature/architecture page it implements), or add a reasoned exclusion to .wiki/coverage.json`, path, severity: "error" });
  }
  return findings;
}

export function mappedPages(sourceMap: SourceMap, path: string): string[] {
  const ids = new Set(sourceMap.exact[path] ?? []);
  for (const item of sourceMap.globs) if (new Bun.Glob(item.glob).match(path)) for (const id of item.pages) ids.add(id);
  return [...ids].sort();
}

export function changedFiles(root: string, base?: string): string[] {
  const chosen = resolveDiffBase(root, base);
  const result = Bun.spawnSync(["git", "diff", "--name-only", `${chosen}...HEAD`], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new UsageError(`invalid --base ${chosen}: ${result.stderr.toString().trim() || "git diff failed"}`);
  return result.stdout.toString().split("\n").filter(Boolean).sort();
}

export function resolveDiffBase(root: string, base?: string): string {
  const exists = (ref: string) => Bun.spawnSync(["git", "rev-parse", "--verify", `${ref}^{commit}`], { cwd: root, stdout: "pipe", stderr: "pipe" }).exitCode === 0;
  if (base != null) {
    if (!exists(base)) throw new UsageError(`invalid --base ${base}: revision does not exist`);
    return base;
  }
  if (exists("origin/main")) return "origin/main";
  if (exists("HEAD~1")) return "HEAD~1";
  if (exists("HEAD")) return "HEAD";
  throw new UsageError("repository has no commit to use as an impact base");
}

export type PrMetadata = {
  change_type?: string;
  semantic_change?: boolean;
  wiki_action?: "update" | "verify" | "none";
  affected_pages?: string[];
  affected_invariants?: string[];
  touched_conflicts?: { id: string; action: "resolve" | "retain" | "introduce"; reason?: string }[];
  fresh_context?: {
    verdict: "PENDING" | "PASS" | "NEEDS_RECONCILE";
    reviewed_head_sha: string;
    bundle_digest: string;
    reviewer: string;
    evidence: string[];
  };
};

export function parsePrMetadata(raw?: string): PrMetadata | undefined {
  return validatePrMetadata(raw).metadata;
}

const CHANGE_TYPES = new Set(["feature", "fix", "refactor", "operations", "proposal", "editorial", "reconcile", "chore", "test", "docs"]);
const WIKI_ACTIONS = new Set(["update", "verify", "none"]);
const CONFLICT_ACTIONS = new Set(["resolve", "retain", "introduce"]);

export function validatePrMetadata(raw?: string, required = false): { metadata?: PrMetadata; findings: Finding[] } {
  const findings: Finding[] = [];
  if (!raw?.trim()) {
    if (required) findings.push({ code: "metadata-missing", message: "PR body requires a parseable yaml metadata block", severity: "error" });
    return { findings };
  }
  const fenced = raw.match(/```ya?ml\s*\n([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? raw;
  let parsed: unknown;
  try { parsed = parseYaml(candidate); }
  catch (error) {
    findings.push({ code: "metadata-parse", message: error instanceof Error ? error.message : String(error), severity: "error" });
    return { findings };
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    findings.push({ code: "metadata-shape", message: "PR metadata must be a YAML mapping", severity: "error" });
    return { findings };
  }
  const value = parsed as Record<string, unknown>;
  if (typeof value.change_type !== "string" || !CHANGE_TYPES.has(value.change_type)) findings.push({ code: "metadata-change-type", message: `invalid or missing change_type: ${String(value.change_type)}`, severity: "error" });
  if (typeof value.semantic_change !== "boolean") findings.push({ code: "metadata-semantic-change", message: "semantic_change must be boolean", severity: "error" });
  if (typeof value.wiki_action !== "string" || !WIKI_ACTIONS.has(value.wiki_action)) findings.push({ code: "metadata-wiki-action", message: `invalid or missing wiki_action: ${String(value.wiki_action)}`, severity: "error" });
  for (const field of ["affected_pages", "affected_invariants"] as const) {
    if (!Array.isArray(value[field]) || !(value[field] as unknown[]).every((item) => typeof item === "string")) findings.push({ code: `metadata-${field.replaceAll("_", "-")}`, message: `${field} must be a string array`, severity: "error" });
  }
  if (!Array.isArray(value.touched_conflicts)) {
    findings.push({ code: "metadata-touched-conflicts", message: "touched_conflicts must be an array", severity: "error" });
  } else {
    const seen = new Set<string>();
    for (const item of value.touched_conflicts) {
      if (item == null || typeof item !== "object" || Array.isArray(item)) {
        findings.push({ code: "metadata-conflict-touch", message: "each touched_conflicts entry must be an object", severity: "error" });
        continue;
      }
      const touch = item as Record<string, unknown>;
      if (typeof touch.id !== "string" || !/^C-\d{3}$/.test(touch.id)) findings.push({ code: "metadata-conflict-id", message: `invalid conflict id: ${String(touch.id)}`, severity: "error" });
      else if (seen.has(touch.id)) findings.push({ code: "metadata-conflict-duplicate", message: `duplicate conflict metadata: ${touch.id}`, severity: "error" });
      else seen.add(touch.id);
      if (typeof touch.action !== "string" || !CONFLICT_ACTIONS.has(touch.action)) findings.push({ code: "metadata-conflict-action", message: `invalid conflict action: ${String(touch.action)}`, severity: "error" });
      if (touch.action === "retain" && (typeof touch.reason !== "string" || touch.reason.trim().length < 20)) findings.push({ code: "metadata-conflict-retain-reason", message: `retaining ${String(touch.id)} requires a 20+ character reason`, severity: "error" });
    }
  }
  if (value.fresh_context == null) {
    if (required) findings.push({ code: "metadata-fresh-context-missing", message: "PR metadata requires the structured fresh_context block even when the template is bypassed", severity: "error" });
  } else if (typeof value.fresh_context !== "object" || Array.isArray(value.fresh_context)) {
    findings.push({ code: "metadata-fresh-context-shape", message: "fresh_context must be a mapping", severity: "error" });
  } else {
    const fresh = value.fresh_context as Record<string, unknown>;
    if (!["PENDING", "PASS", "NEEDS_RECONCILE"].includes(String(fresh.verdict))) findings.push({ code: "metadata-fresh-context-verdict", message: "fresh_context.verdict must be PENDING, PASS, or NEEDS_RECONCILE", severity: "error" });
    for (const field of ["reviewed_head_sha", "bundle_digest", "reviewer"] as const) {
      if (typeof fresh[field] !== "string") findings.push({ code: "metadata-fresh-context-shape", message: `fresh_context.${field} must be a string`, severity: "error" });
    }
    if (!Array.isArray(fresh.evidence) || !fresh.evidence.every((item) => typeof item === "string")) findings.push({ code: "metadata-fresh-context-shape", message: "fresh_context.evidence must be a string array", severity: "error" });
    if (fresh.verdict === "PASS" || fresh.verdict === "NEEDS_RECONCILE") {
      if (typeof fresh.reviewed_head_sha !== "string" || !/^[0-9a-f]{40}$/.test(fresh.reviewed_head_sha)
        || typeof fresh.bundle_digest !== "string" || !/^[0-9a-f]{64}$/.test(fresh.bundle_digest)
        || typeof fresh.reviewer !== "string" || fresh.reviewer.trim().length === 0) {
        findings.push({ code: "metadata-fresh-context-binding", message: "completed fresh_context status requires exact reviewed_head_sha, bundle_digest, and reviewer", severity: "error" });
      }
      if (!Array.isArray(fresh.evidence) || fresh.evidence.length === 0 || fresh.evidence.some((item) => typeof item !== "string" || item.trim().length === 0)) {
        findings.push({ code: "metadata-fresh-context-evidence", message: "completed fresh_context status requires non-empty evidence", severity: "error" });
      }
    }
  }
  return findings.length > 0 ? { findings } : { metadata: value as PrMetadata, findings };
}

export type ImpactReport = {
  base: string;
  mergeBase: string;
  changedFiles: string[];
  affectedPages: string[];
  affectedConflicts: ConflictSummary[];
  removedCurrentPages: { id: string; path: string; headStatus?: WikiStatus }[];
  stalePages: string[];
  highRiskStalePages: string[];
  advisoryStalePages: string[];
  unmappedHighRisk: string[];
  findings: Finding[];
};

export function impactReport(view: RepoView, pages: WikiPage[], options: { base?: string; metadata?: PrMetadata } = {}): ImpactReport {
  const resolvedBase = resolveDiffBase(view.root, options.base);
  const mergeBase = git(view.root, ["merge-base", resolvedBase, "HEAD"]).trim();
  if (!mergeBase) throw new UsageError(`invalid --base ${resolvedBase}: no merge base with HEAD`);
  const files = changedFiles(view.root, resolvedBase);
  const config = readConfig(view);
  const sourceMap = buildSourceMap(pages);
  const baseConflictPaths = git(view.root, ["ls-tree", "-r", "--name-only", mergeBase, "--", "wiki/conflicts"], true).split("\n").filter((path) => path.endsWith(".md"));
  const baseConflicts = baseConflictPaths.flatMap((path) => {
    const raw = git(view.root, ["show", `${mergeBase}:${path}`], true);
    if (!raw) return [];
    try {
      const page = parseWikiPage(path, raw);
      return page.data.kind === "conflict" ? [page] : [];
    } catch {
      return [];
    }
  });
  const conflictsById = new Map<string, WikiPage>();
  for (const page of [...baseConflicts, ...pages.filter((item) => item.data.kind === "conflict")]) conflictsById.set(page.data.conflict_id!, page);
  const conflictMap = buildConflictMap([...baseConflicts, ...pages]);
  const affected = new Set<string>();
  const affectedConflictIds = new Set<string>();
  const highRiskAffected = new Set<string>();
  const unmappedHighRisk: string[] = [];
  const removedCurrentPages: { id: string; path: string; headStatus?: WikiStatus }[] = [];
  for (const path of files) {
    const mapped = mappedPages(sourceMap, path);
    for (const id of mapped) affected.add(id);
    for (const id of mappedConflicts(conflictMap, path)) affectedConflictIds.add(id);
    if (isHighRisk(config, path)) for (const id of mapped) highRiskAffected.add(id);
    const directlyChanged = pages.find((page) => page.path === path && page.data.status === "current");
    if (directlyChanged) affected.add(directlyChanged.data.id);
    const directlyChangedConflict = pages.find((page) => page.path === path && page.data.kind === "conflict");
    if (directlyChangedConflict?.data.conflict_id) affectedConflictIds.add(directlyChangedConflict.data.conflict_id);
    if (isContentPage(path)) {
      const baseRaw = git(view.root, ["show", `${mergeBase}:${path}`], true);
      if (baseRaw) {
        try {
          const basePage = parseWikiPage(path, baseRaw);
          if (basePage.data.status === "current") {
            affected.add(basePage.data.id);
            if (!pages.some((page) => page.data.id === basePage.data.id && page.data.status === "current")) {
              const headPage = pages.find((page) => page.data.id === basePage.data.id);
              removedCurrentPages.push({ id: basePage.data.id, path, ...(headPage ? { headStatus: headPage.data.status } : {}) });
            }
          }
          if (basePage.data.kind === "conflict" && basePage.data.conflict_id) affectedConflictIds.add(basePage.data.conflict_id);
        } catch {
          // A deleted non-page or malformed historical page is handled by the ordinary diff review.
        }
      }
    }
    if (isHighRisk(config, path) && mapped.length === 0) unmappedHighRisk.push(path);
  }
  for (const id of options.metadata?.affected_pages ?? []) {
    if (pages.some((page) => page.data.id === id && page.data.status === "current")) affected.add(id);
  }
  const state = readState(view);
  const stalePages: string[] = [];
  const removedIds = new Set(removedCurrentPages.map((page) => page.id));
  for (const id of affected) {
    if (removedIds.has(id)) continue;
    const page = pages.find((item) => item.data.id === id);
    if (!page || jsonStable(state.pages[id]?.sources ?? {}) !== jsonStable(sourceHashes(view, page))) stalePages.push(id);
  }
  const highRiskStalePages = stalePages.filter((id) => highRiskAffected.has(id)).sort();
  const advisoryStalePages = stalePages.filter((id) => !highRiskAffected.has(id)).sort();
  const findings: Finding[] = unmappedHighRisk.map((path) => ({ code: "unmapped-high-risk", message: `high-risk source has no current wiki page: ${path}`, path, severity: "error" as const }));
  for (const page of removedCurrentPages) findings.push({ code: "current-page-removed", message: `page was removed from current SSOT without a current page retaining its ID: ${page.id}`, path: page.path, severity: "error" });
  for (const id of highRiskStalePages) findings.push({ code: "stale-verification", message: `high-risk affected page has stale or missing source verification: ${id}`, severity: "error" });
  for (const id of advisoryStalePages) findings.push({ code: "stale-verification-low-risk", message: `low-risk affected page has stale or missing source verification: ${id}`, severity: "error" });
  const metadata = options.metadata;
  if (metadata) {
    const pageById = new Map(pages.map((page) => [page.data.id, page]));
    const removedIds = new Set(removedCurrentPages.map((page) => page.id));
    for (const id of metadata.affected_pages ?? []) {
      if (!pageById.has(id) && !removedIds.has(id)) findings.push({ code: "metadata-page-unknown", message: `affected_pages references unknown page: ${id}`, severity: "error" });
    }
    for (const id of metadata.affected_invariants ?? []) {
      const page = pageById.get(id);
      if (!page || page.data.kind !== "invariant") findings.push({ code: "metadata-invariant-unknown", message: `affected_invariants must reference an invariant page: ${id}`, severity: "error" });
    }
    if (metadata.semantic_change === true && metadata.change_type !== "proposal" && ["update", "verify"].includes(metadata.wiki_action ?? "") && (metadata.affected_pages?.length ?? 0) === 0) {
      findings.push({ code: "metadata-pages-required", message: "semantic update/verify changes require affected_pages", severity: "error" });
    }
    if (metadata.semantic_change === true && metadata.wiki_action !== "none") {
      const declared = new Set(metadata.affected_pages ?? []);
      for (const id of affected) if (!declared.has(id)) findings.push({ code: "metadata-page-omitted", message: `affected page is missing from PR metadata: ${id}`, severity: "error" });
    }
    if (metadata.semantic_change === true && metadata.wiki_action === "none") findings.push({ code: "semantic-wiki-none", message: "semantic changes cannot use wiki_action: none", severity: "error" });
    // Bind the flag explicitly: passing the predicate to `.some` directly would
    // hand it the array index as `publishesKit`, granting the exemption from the
    // second element onward.
    const isImplementationSource = (path: string) => isImplementationSourceChange(path, config.publishesKit);
    if (files.some(isImplementationSource) && metadata.wiki_action === "none") findings.push({ code: "implementation-wiki-none", message: "implementation changes cannot use wiki_action: none", severity: "error" });
    const removedCurrentPaths = new Set(removedCurrentPages.map((page) => page.path));
    const changedCurrentDocs = files.filter((path) => removedCurrentPaths.has(path) || pages.some((page) => page.path === path && page.data.status === "current"));
    const implementationChanged = files.some(isImplementationSource);
    if (changedCurrentDocs.length > 0 && !implementationChanged && !["proposal", "editorial", "reconcile"].includes(metadata.change_type ?? "")) {
      findings.push({ code: "current-doc-only-policy", message: "current semantic documentation changes without code require proposal, editorial, or reconcile change_type", severity: "error" });
    }
    const touches = new Map((metadata.touched_conflicts ?? []).map((touch) => [touch.id, touch]));
    for (const id of affectedConflictIds) {
      if (!touches.has(id)) findings.push({ code: "conflict-not-declared", message: `changed sources or conflict records affect open conflict ${id}; declare resolve, retain, or introduce`, severity: "error" });
    }
    const baseById = new Map(baseConflicts.map((page) => [page.data.conflict_id!, page]));
    const headById = new Map(pages.filter((page) => page.data.kind === "conflict").map((page) => [page.data.conflict_id!, page]));
    for (const touch of metadata.touched_conflicts ?? []) {
      const head = headById.get(touch.id);
      const base = baseById.get(touch.id);
      const conflict = head ?? base;
      if (!conflict) {
        findings.push({ code: "metadata-conflict-unknown", message: `touched_conflicts references unknown conflict: ${touch.id}`, severity: "error" });
        continue;
      }
      if (touch.action === "introduce") {
        if (base) findings.push({ code: "conflict-introduce-existing", message: `${touch.id} already existed at the merge base`, severity: "error" });
        if (!head || head.data.status !== "conflicted") findings.push({ code: "conflict-introduce-state", message: `${touch.id} introduce requires an open conflicted page`, severity: "error" });
        if (head?.data.origin === "introduced_by_change" && head.data.severity === "high" && files.some(isImplementationSource)) {
          findings.push({ code: "conflict-introduced-high-risk", message: `a PR may not introduce a new high-severity implementation conflict: ${touch.id}`, severity: "error" });
        }
      }
      if (touch.action === "retain") {
        if (!base) findings.push({ code: "conflict-retain-missing-base", message: `${touch.id} retain requires the conflict to exist at the merge base; use introduce for a new conflict`, severity: "error" });
        if (!head || head.data.status !== "conflicted") findings.push({ code: "conflict-retain-state", message: `${touch.id} retain requires the conflict to remain open`, severity: "error" });
      }
      if (touch.action === "resolve") {
        if (!base) findings.push({ code: "conflict-resolve-missing-base", message: `${touch.id} resolve requires the conflict to exist at the merge base`, severity: "error" });
        const resolution = head?.data.resolution;
        if (!head || head.data.status !== "archived" || resolution?.state !== "verified" || !head.path.startsWith("wiki/conflicts/resolved/")) {
          findings.push({ code: "conflict-resolution-incomplete", message: `${touch.id} resolve requires a verified archived page under wiki/conflicts/resolved`, severity: "error" });
          continue;
        }
        if (!resolution.decision?.trim() || !(resolution.evidence?.length)) findings.push({ code: "conflict-resolution-evidence", message: `${touch.id} resolve requires a decision and evidence`, severity: "error" });
        const declaredPages = new Set(metadata.affected_pages ?? []);
        for (const id of head.data.affected_pages ?? []) {
          if (!declaredPages.has(id)) findings.push({ code: "conflict-resolution-page", message: `${touch.id} resolution must declare affected page ${id}`, severity: "error" });
          const page = pages.find((item) => item.data.id === id);
          if (!page || !files.includes(page.path)) findings.push({ code: "conflict-resolution-page-update", message: `${touch.id} resolution must update current page ${id}`, severity: "error" });
        }
        const declaredInvariants = new Set(metadata.affected_invariants ?? []);
        for (const id of head.data.affected_invariants ?? []) if (!declaredInvariants.has(id)) findings.push({ code: "conflict-resolution-invariant", message: `${touch.id} resolution must declare affected invariant ${id}`, severity: "error" });
        const changedEvidence = head.data.sources.some((source) => files.some((path) => "path" in source ? source.path === path : new Bun.Glob(source.glob).match(path)));
        if (!changedEvidence) findings.push({ code: "conflict-resolution-source", message: `${touch.id} resolution must update at least one declared primary source`, severity: "error" });
      }
    }
  }
  const affectedConflicts = [...affectedConflictIds].map((id) => conflictsById.get(id)).filter((page): page is WikiPage => page != null).map(conflictSummary)
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    base: resolvedBase,
    mergeBase,
    changedFiles: files,
    affectedPages: [...affected].sort(),
    affectedConflicts,
    removedCurrentPages: removedCurrentPages.sort((a, b) => a.id.localeCompare(b.id)),
    stalePages: stalePages.sort(),
    highRiskStalePages,
    advisoryStalePages,
    unmappedHighRisk: unmappedHighRisk.sort(),
    findings,
  };
}

/**
 * `publishesKit` defaults to false so the exemption is never granted by accident.
 * In the publishing repository `kit/**` is a derived copy of files that already
 * carry the wiki obligation, and `wiki:kit --check` keeps the copy honest;
 * elsewhere `kit/` is an ordinary directory and gets no exemption at all.
 */
export function isImplementationSourceChange(path: string, publishesKit = false): boolean {
  if (path.endsWith(".md")) return false;
  if (path.startsWith("wiki/_generated/")) return false;
  if (publishesKit && isKitManagedPath(path)) return false;
  if ([".wiki/state.json", ".wiki/source-map.json", ".wiki/conflict-map.json"].includes(path)) return false;
  return true;
}

export function auditReport(view: RepoView, pages: WikiPage[], extraGenerated: Record<string, string> = {}): AuditReport {
  const lint = allLintFindings(view, false);
  const generated = compareGenerated(view, { ...generatedCoreFiles(pages, readConfig(view).name), ...extraGenerated });
  const state = validateState(view, pages);
  const findings = [...lint.findings, ...generated, ...state.findings];
  return {
    ok: !findings.some((finding) => finding.severity === "error"),
    findings,
    stalePages: state.stalePages,
    highRiskStalePages: state.highRiskStalePages,
    advisoryStalePages: state.advisoryStalePages,
    openConflicts: openConflicts(pages).map(conflictSummary),
  };
}

export type ReviewManifest = {
  version: 1;
  base_ref: string;
  merge_base_sha: string;
  head_sha: string;
  pr_metadata_digest: string;
  impact_report_digest: string;
  diff_digest: string;
  affected_page_ids: string[];
  affected_invariant_ids: string[];
  affected_conflict_ids: string[];
  file_digests: Record<string, string>;
  bundle_digest: string;
  /**
   * TE-04 keeps the v1 manifest envelope so existing Fresh-context reports
   * remain valid, while binding the new focused reviewer-input projection by
   * digest.  The field is optional on hand-authored v1 fixtures for backwards
   * compatibility; publisher-generated manifests always populate it.
   */
  focused_manifest_digest?: string;
};

export type FocusedBodyRole = "affected_page" | "invariant" | "removed_page" | "conflict";
export type FocusedSourceRole = "changed_source" | "affected_authority_source" | "relevant_test" | "supporting_source";
export type FocusedBodyBinding = {
  role: FocusedBodyRole;
  id: string;
  wiki_path: string;
  lifecycle: "head" | "merge-base";
  digest: string;
};
export type FocusedBodyObject = {
  digest: string;
  object_path: string;
  bytes: number;
};
export type FocusedSourceDeclaration = {
  id: string;
  page_id: string;
  declaration: WikiSource;
  matched_via: "path" | "glob";
  expanded_glob?: string;
};
export type FocusedSourceBinding = {
  path: string;
  roles: FocusedSourceRole[];
  declared_by: string[];
  declaration_ids: string[];
  head_digest?: string;
  merge_base_digest?: string;
  lifecycle: "head" | "merge-base" | "added" | "removed" | "changed" | "unchanged";
};
export type FocusedReviewManifest = {
  version: 1;
  head_sha: string;
  merge_base_sha: string;
  diff_digest: string;
  impact_report_digest: string;
  pr_metadata_digest: string;
  changed_files: string[];
  body_roles: FocusedBodyBinding[];
  objects: FocusedBodyObject[];
  source_declarations: FocusedSourceDeclaration[];
  source_roles: FocusedSourceBinding[];
};

export type FreshContextVerdict = "PENDING" | "PASS" | "NEEDS_RECONCILE";

/**
 * A version 2 finding states what the reviewer found, which authority controls
 * it, and what the candidate already does about it. The disposition is a
 * reviewer observation of the reviewed tree, never an author claim: every
 * disposition that points somewhere must name the conflict or follow-up it
 * points at, so a finding cannot be retired by gesture.
 */
export type FreshContextClassification =
  | "candidate_regression"
  | "declared_contract_violation"
  | "preexisting_implementation_mismatch"
  | "decision_ambiguity"
  | "documentation_disagreement"
  | "unrelated_defect"
  | "suggestion";
export type FreshContextDisposition =
  | "unresolved"
  | "fixed"
  | "conflict_introduced"
  | "existing_conflict_linked"
  | "followup_created"
  | "recorded"
  | "dismissed_with_reason";
export type FreshContextAuthorityKind = "normative" | "observed" | "derived" | "test" | "metadata";
export type FreshContextFinding = {
  id: string;
  classification: FreshContextClassification;
  disposition: FreshContextDisposition;
  scope_refs: string[];
  discrepancy: string;
  authority: { kind: FreshContextAuthorityKind; ref: string };
  acceptance_criteria: string[];
  evidence: string[];
  conflict_id?: string;
  followup_ref?: string;
  dismissal_reason?: string;
};

type FreshContextReportBase = {
  verdict: FreshContextVerdict;
  reviewed_head_sha: string;
  merge_base_sha: string;
  bundle_digest: string;
  reviewer: string;
  evidence: string[];
  summary?: string;
};
export type FreshContextReportV1 = FreshContextReportBase & { version: 1; findings?: string[] };
export type FreshContextReportV2 = FreshContextReportBase & { version: 2; findings?: FreshContextFinding[] };
export type FreshContextReport = FreshContextReportV1 | FreshContextReportV2;
export type FreshContextCheckResult = {
  ok: boolean;
  mode: FreshContextMode;
  report?: FreshContextReport;
  findings: Finding[];
};
export type ReviewCheckResult = FreshContextCheckResult & {
  manifest: ReviewManifest;
  impact: ImpactReport;
  required: boolean;
  requirementReasons: string[];
};

export type FreshContextRequirement = {
  applies: boolean;
  reasons: string[];
};

export function evaluateFreshContextRequirement(
  policy: FreshContextPolicy,
  manifest: ReviewManifest,
  impact: ImpactReport,
): FreshContextRequirement {
  const requiredWhen = policy.requiredWhen ?? { kind: "all" as const };
  if (requiredWhen.kind === "all") {
    return { applies: true, reasons: ["policy requires Fresh-context review for every pull request"] };
  }

  const reasons = new Set<string>();
  for (const pattern of requiredWhen.changedFileGlobs) {
    let glob: Bun.Glob;
    try {
      glob = new Bun.Glob(pattern);
    } catch {
      return { applies: true, reasons: [`invalid trusted Fresh-context risk glob fails closed: ${pattern}`] };
    }
    for (const path of impact.changedFiles) {
      if (glob.match(path)) reasons.add(`changed file matches ${pattern}: ${path}`);
    }
  }
  if (requiredWhen.affectedInvariants && manifest.affected_invariant_ids.length > 0) {
    reasons.add(`affected invariants: ${manifest.affected_invariant_ids.join(", ")}`);
  }
  if (requiredWhen.affectedConflicts && manifest.affected_conflict_ids.length > 0) {
    reasons.add(`affected conflicts: ${manifest.affected_conflict_ids.join(", ")}`);
  }
  if (requiredWhen.removedCurrentPages && impact.removedCurrentPages.length > 0) {
    reasons.add(`removed or demoted current pages: ${impact.removedCurrentPages.map((page) => page.id).join(", ")}`);
  }
  return { applies: reasons.size > 0, reasons: [...reasons].sort((a, b) => a.localeCompare(b)) };
}

function canonicalPrMetadata(metadata?: PrMetadata): unknown {
  if (!metadata) return null;
  return {
    change_type: metadata.change_type,
    semantic_change: metadata.semantic_change,
    wiki_action: metadata.wiki_action,
    affected_pages: [...(metadata.affected_pages ?? [])].sort((a, b) => a.localeCompare(b)),
    affected_invariants: [...(metadata.affected_invariants ?? [])].sort((a, b) => a.localeCompare(b)),
    touched_conflicts: [...(metadata.touched_conflicts ?? [])]
      .map((touch) => ({ id: touch.id, action: touch.action, ...(touch.reason == null ? {} : { reason: touch.reason.trim() }) }))
      .sort((a, b) => a.id.localeCompare(b.id) || a.action.localeCompare(b.action)),
  };
}

function canonicalImpactReport(report: ImpactReport): ImpactReport {
  const lexical = (a: string, b: string) => a.localeCompare(b);
  return {
    ...report,
    changedFiles: [...report.changedFiles].sort(lexical),
    affectedPages: [...report.affectedPages].sort(lexical),
    affectedConflicts: [...report.affectedConflicts].sort((a, b) => a.id.localeCompare(b.id)),
    removedCurrentPages: [...report.removedCurrentPages].sort((a, b) => a.id.localeCompare(b.id)),
    stalePages: [...report.stalePages].sort(lexical),
    highRiskStalePages: [...report.highRiskStalePages].sort(lexical),
    advisoryStalePages: [...report.advisoryStalePages].sort(lexical),
    unmappedHighRisk: [...report.unmappedHighRisk].sort(lexical),
    findings: [...report.findings].sort((a, b) => a.code.localeCompare(b.code) || (a.path ?? "").localeCompare(b.path ?? "") || a.message.localeCompare(b.message)),
  };
}

type FocusedReviewData = {
  manifest: FocusedReviewManifest;
  objects: Record<string, string>;
};

function focusedSourcePath(path: string): boolean {
  return /(^|\/)[^/]+\.(?:test|spec)\.[^/]+$/.test(path) || path.endsWith(".test.ts") || path.endsWith(".spec.ts");
}

function canonicalSourceDeclaration(source: WikiSource): WikiSource {
  return "path" in source
    ? { path: source.path, ...(source.symbols ? { symbols: [...source.symbols].sort((a, b) => a.localeCompare(b)) } : {}) }
    : { glob: source.glob };
}

function pageAtRevision(root: string, revision: string, path: string): WikiPage | undefined {
  const raw = git(root, ["show", `${revision}:${path}`], true);
  if (!raw) return undefined;
  try { return parseWikiPage(path, raw); } catch { return undefined; }
}

function filesAtRevision(root: string, revision: string): string[] {
  return git(root, ["ls-tree", "-r", "--name-only", revision], true)
    .split("\n")
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function sourceAtRevision(root: string, revision: string, path: string): { exists: boolean; raw: string } {
  // `git show` returns an empty string both for an empty blob and for a
  // missing path.  cat-file's exit code preserves that existence bit so an
  // empty source still receives a real SHA-256 digest and lifecycle state.
  const result = Bun.spawnSync(["git", "cat-file", "-p", `${revision}:${path}`], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0
    ? { exists: true, raw: result.stdout.toString() }
    : { exists: false, raw: "" };
}

function expandSourceAtRevision(root: string, revision: string, source: WikiSource, files: string[]): string[] {
  if ("path" in source) return files.includes(source.path) ? [source.path] : [];
  const glob = new Bun.Glob(source.glob);
  return files.filter((path) => glob.match(path)).sort((a, b) => a.localeCompare(b));
}

function focusedReviewData(view: RepoView, pages: WikiPage[], report: ImpactReport, metadata?: PrMetadata): FocusedReviewData {
  const headSha = git(view.root, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  const diff = git(view.root, ["diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", `${report.mergeBase}..HEAD`], true);
  const impact = jsonStable(canonicalImpactReport(report));
  const metadataDigest = hashContent(jsonStable(canonicalPrMetadata(metadata)));
  const objects = new Map<string, string>();
  const bodyRoles: FocusedBodyBinding[] = [];
  const addBody = (role: FocusedBodyRole, id: string, wikiPath: string, lifecycle: "head" | "merge-base", raw: string) => {
    if (!raw) return;
    const digest = hashContent(raw);
    const objectPath = `objects/${digest}.md`;
    objects.set(digest, raw);
    bodyRoles.push({ role, id, wiki_path: wikiPath, lifecycle, digest });
  };

  const currentById = new Map(pages.map((page) => [page.data.id, page]));
  const changedSet = new Set(report.changedFiles);
  for (const id of [...report.affectedPages].sort((a, b) => a.localeCompare(b))) {
    const page = currentById.get(id);
    if (page) addBody("affected_page", id, page.path, "head", page.raw);
  }
  const invariants = currentPages(pages).filter((page) => page.data.kind === "invariant");
  for (const page of invariants) addBody("invariant", page.data.id, page.path, "head", page.raw);
  // A current invariant may be demoted or removed by the candidate. Preserve
  // its merge-base authority body whenever the enclosing manifest still binds
  // its ID, so the risk signal cannot disappear with the HEAD page kind.
  const baseInvariantPaths = git(view.root, ["ls-tree", "-r", "--name-only", report.mergeBase, "--", "wiki"], true)
    .split("\n").filter(isContentPage);
  for (const path of baseInvariantPaths) {
    const basePage = pageAtRevision(view.root, report.mergeBase, path);
    if (!basePage || basePage.data.status !== "current" || basePage.data.kind !== "invariant") continue;
    const headPage = currentById.get(basePage.data.id);
    if (!headPage || headPage.data.kind !== "invariant" || headPage.data.status !== "current") addBody("invariant", basePage.data.id, basePage.path, "merge-base", basePage.raw);
  }
  for (const removed of [...report.removedCurrentPages].sort((a, b) => a.id.localeCompare(b.id))) {
    const raw = git(view.root, ["show", `${report.mergeBase}:${removed.path}`], true);
    if (raw) addBody("removed_page", removed.id, removed.path, "merge-base", raw);
  }
  for (const conflict of [...report.affectedConflicts].sort((a, b) => a.id.localeCompare(b.id))) {
    const page = pages.find((item) => item.data.kind === "conflict" && item.data.conflict_id === conflict.id);
    const raw = page?.raw ?? git(view.root, ["show", `${report.mergeBase}:${conflict.path}`], true);
    if (raw) addBody("conflict", conflict.id, page?.path ?? conflict.path, page ? "head" : "merge-base", raw);
  }
  const bodyBindings = bodyRoles.sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id));
  const objectRefs: FocusedBodyObject[] = [...objects.entries()]
    .map(([digest, raw]) => ({ digest, object_path: `objects/${digest}.md`, bytes: Buffer.byteLength(raw, "utf8") }))
    .sort((a, b) => a.digest.localeCompare(b.digest));

  type UndigestedDeclaration = Omit<FocusedSourceDeclaration, "id">;
  const declarations = new Map<string, UndigestedDeclaration[]>();
  const authorityIds = new Set([
    ...report.affectedPages,
    ...(metadata?.affected_invariants ?? []),
    ...report.affectedConflicts.flatMap((conflict) => conflict.affectedInvariants),
  ]);
  const mergeBaseFiles = filesAtRevision(view.root, report.mergeBase);
  const headFiles = new Set(view.listFiles());
  const addDeclarations = (page: WikiPage, authority: boolean, revision: "head" | "merge-base") => {
    for (const rawDeclaration of page.data.sources) {
      const declaration = canonicalSourceDeclaration(rawDeclaration);
      // Exact declarations remain explicit primary inputs.  Broad globs are
      // focused to changed matches; otherwise a recursive publisher glob would
      // reintroduce the unrelated source breadth TE-04 is removing.
      const expanded = revision === "merge-base"
        ? expandSourceAtRevision(view.root, report.mergeBase, rawDeclaration, mergeBaseFiles)
        : expandSource(view, rawDeclaration);
      const paths = "path" in rawDeclaration
        ? expanded
        : expanded.filter((path) => changedSet.has(path) || (revision === "merge-base" && !headFiles.has(path)));
      // Keep an exact declaration even when the file was deleted from HEAD;
      // its merge-base digest remains independently verifiable.
      const candidates = "path" in rawDeclaration && paths.length === 0 ? [rawDeclaration.path] : paths;
      for (const path of candidates) {
        const item: UndigestedDeclaration = {
          page_id: page.data.id,
          declaration,
          matched_via: "path" in rawDeclaration ? "path" : "glob",
          ...( "glob" in rawDeclaration ? { expanded_glob: rawDeclaration.glob } : {}),
        };
        const existing = declarations.get(path) ?? [];
        if (!existing.some((entry) => jsonStable(entry) === jsonStable(item))) existing.push(item);
        declarations.set(path, existing);
      }
    }
    // `authority` is consumed below when role sets are assigned.  Keep the
    // argument explicit so adding a second provenance boundary cannot silently
    // drop the page identity.
    void authority;
  };
  const requiredPageIds = new Set([...report.affectedPages, ...invariants.map((page) => page.data.id)]);
  for (const page of pages.filter((item) => item.data.status === "current" && requiredPageIds.has(item.data.id))) addDeclarations(page, authorityIds.has(page.data.id), "head");
  // The merge-base declaration view is required for every affected current
  // authority page, not only invariants. Keep all merge-base invariants for
  // their independent authority bodies, then add affected product/architecture
  // pages whose globs can still explain a deleted source at HEAD.
  const baseAuthorityPaths = git(view.root, ["ls-tree", "-r", "--name-only", report.mergeBase, "--", "wiki"], true)
    .split("\n").filter(isContentPage);
  for (const path of baseAuthorityPaths) {
    const basePage = pageAtRevision(view.root, report.mergeBase, path);
    if (basePage?.data.status !== "current") continue;
    if (basePage.data.kind === "invariant" || authorityIds.has(basePage.data.id)) addDeclarations(basePage, authorityIds.has(basePage.data.id), "merge-base");
  }
  for (const conflictPage of pages.filter((item) => item.data.kind === "conflict" && report.affectedConflicts.some((summary) => summary.id === item.data.conflict_id))) addDeclarations(conflictPage, false, "head");
  for (const summary of report.affectedConflicts) {
    if (pages.some((page) => page.data.kind === "conflict" && page.data.conflict_id === summary.id)) continue;
    const basePage = pageAtRevision(view.root, report.mergeBase, summary.path);
    if (basePage?.data.kind === "conflict") addDeclarations(basePage, false, "merge-base");
  }

  // Do not emit a lifecycle record for a stale declaration that is absent
  // from both revisions.  A changed path is retained because the diff itself
  // is the provenance even when an unusual tree state cannot be read here.
  for (const path of [...declarations.keys()]) {
    const baseState = sourceAtRevision(view.root, report.mergeBase, path);
    if (!headFiles.has(path) && !baseState.exists && !changedSet.has(path)) declarations.delete(path);
  }
  const sourceBindings: FocusedSourceBinding[] = [];
  const declarationEntries = [...new Map(
    [...declarations.values()].flat().map((entry) => [jsonStable(entry), entry] as const),
  ).values()]
    .sort((a, b) => jsonStable(a).localeCompare(jsonStable(b)))
    .map((entry, index) => ({ ...entry, id: `D-${String(index + 1).padStart(4, "0")}` }));
  const declarationIds = new Map(declarationEntries.map((entry) => [jsonStable({ ...entry, id: undefined }), entry.id]));
  const sourcePaths = new Set([...declarations.keys(), ...report.changedFiles]);
  for (const path of [...sourcePaths].sort((a, b) => a.localeCompare(b))) {
    const records = (declarations.get(path) ?? []).sort((a, b) => a.page_id.localeCompare(b.page_id) || jsonStable(a.declaration).localeCompare(jsonStable(b.declaration)) || a.matched_via.localeCompare(b.matched_via));
    const declaredBy = [...new Set(records.map((entry) => entry.page_id))].sort((a, b) => a.localeCompare(b));
    const roles = new Set<FocusedSourceRole>();
    if (changedSet.has(path)) roles.add("changed_source");
    if (records.some((entry) => authorityIds.has(entry.page_id))) roles.add("affected_authority_source");
    if (focusedSourcePath(path)) roles.add("relevant_test");
    if (roles.size === 0 || (roles.size === 1 && roles.has("changed_source") && declaredBy.length === 0)) roles.add("supporting_source");
    const headExists = headFiles.has(path);
    const headRaw = headExists ? view.read(path) : "";
    const baseState = sourceAtRevision(view.root, report.mergeBase, path);
    const headDigest = headExists ? hashContent(headRaw) : undefined;
    const baseDigest = baseState.exists ? hashContent(baseState.raw) : undefined;
    // A stale declaration that is absent from both revisions was removed from
    // `declarations` above. Changed files always exist on at least one side,
    // and exact declarations retain their path when one side is deleted.
    if (!headExists && !baseState.exists) continue;
    const lifecycle: FocusedSourceBinding["lifecycle"] = headExists && baseState.exists
      ? headDigest === baseDigest ? "unchanged" : "changed"
      : headExists ? "added" : "removed";
    sourceBindings.push({
      path,
      roles: [...roles].sort((a, b) => a.localeCompare(b)),
      declared_by: declaredBy,
      declaration_ids: records.map((entry) => declarationIds.get(jsonStable(entry))).filter((id): id is string => id != null).sort((a, b) => a.localeCompare(b)),
      ...(headDigest ? { head_digest: headDigest } : {}),
      ...(baseDigest ? { merge_base_digest: baseDigest } : {}),
      lifecycle,
    });
  }

  const manifest: FocusedReviewManifest = {
    version: 1,
    head_sha: headSha,
    merge_base_sha: report.mergeBase,
    diff_digest: hashContent(diff),
    impact_report_digest: hashContent(impact),
    pr_metadata_digest: metadataDigest,
    changed_files: [...report.changedFiles].sort((a, b) => a.localeCompare(b)),
    body_roles: bodyBindings,
    objects: objectRefs,
    source_declarations: declarationEntries,
    source_roles: sourceBindings,
  };
  return { manifest, objects: Object.fromEntries([...objects.entries()].map(([digest, raw]) => [`objects/${digest}.md`, raw])) };
}

function reviewBundleFiles(view: RepoView, pages: WikiPage[], report: ImpactReport, metadata?: PrMetadata): Record<string, string> {
  const files: Record<string, string> = {};
  files["diff.patch"] = git(view.root, ["diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", `${report.mergeBase}..HEAD`], true);
  files["impact.json"] = jsonStable(canonicalImpactReport(report));
  files["pr-metadata.json"] = jsonStable(canonicalPrMetadata(metadata));
  const focused = focusedReviewData(view, pages, report, metadata);
  for (const [path, content] of Object.entries(focused.objects)) files[path] = content;
  const invariants = currentPages(pages).filter((page) => page.data.kind === "invariant");
  const affectedSources = Object.fromEntries([...report.affectedPages].sort((a, b) => a.localeCompare(b)).map((id) => {
    const page = pages.find((item) => item.data.id === id);
    return [id, page?.data.sources ?? []];
  }));
  files["sources.json"] = jsonStable({
    affectedPages: affectedSources,
    affectedConflicts: [...report.affectedConflicts].sort((a, b) => a.id.localeCompare(b.id)),
    removedCurrentPages: [...report.removedCurrentPages].sort((a, b) => a.id.localeCompare(b.id)),
    invariants: invariants.map((page) => page.data.id),
    focusedManifest: "focused-manifest.json",
  });
  files["focused-manifest.json"] = jsonStable(focused.manifest);
  files["PROMPT.md"] = `# Fresh-context wiki reconciliation

Read \`manifest.json\`, \`focused-manifest.json\`, \`impact.json\`, \`pr-metadata.json\`, \`diff.patch\`, \`objects/**\`, and \`sources.json\`. The focused manifest is the single deterministic index of reviewer inputs: body roles point at content-addressed \`objects/<sha256>.md\` files, while source roles carry changed, affected-authority, relevant-test, and supporting provenance. An affected page that is also an invariant intentionally has two role records sharing one object digest. Removed-page and conflict role aliases, when present for compatibility, are filesystem links to those objects rather than second body copies; reviewers should read the object path recorded by the role. Inspect the referenced repository primary sources directly. Verify current behavior, intent, invariants, conflict actions, acceptance criteria, and sources independently. Do not trust the author summary and do not resolve an open decision conflict without an explicit owner decision.

Report every discrepancy as a structured finding described by \`REPORT.md\`, and decide its disposition instead of assuming this candidate must fix it:

- A problem this candidate introduced, or a contract the PR itself declares, has to be fixed here. The engine enforces this: those classifications accept no deferring disposition, only \`fixed\` or \`unresolved\`.
- A mismatch that predates the candidate, an undecidable product intent, or a documentation disagreement may instead be tracked by an open conflict this candidate introduces or already links, with acceptance criteria.
- A real defect outside this change's semantic scope belongs in a named follow-up, not in this diff.

Classify by what you actually found. \`REPORT.md\` lists which dispositions each classification admits, and the engine rejects a pair outside that table. It cannot tell whether the classification itself is honest: a regression relabelled as pre-existing buys deferrals the engine will accept. That judgement is yours alone, which makes it the one that matters.

Return the report as:

- \`PASS\` only when code, tests, metadata, wiki, and conflict lifecycle agree, and every remaining finding is either fixed, named where it is tracked, dismissed with a reason, or a \`recorded\` suggestion. A \`PASS\` may not carry an \`unresolved\` finding.
- \`NEEDS_RECONCILE\` when anything is stale, unsupported, ambiguous, or violates an invariant or conflict resolution contract and is not yet tracked anywhere.

Scope is not permission to be exhaustive about the repository: a finding must bind to this candidate's diff, declared metadata, affected pages, invariants, or conflicts.
`;
  files["REPORT.md"] = `# Fresh-context report contract

Create a JSON report from \`REPORT.example.json\`, or \`REPORT.findings.example.json\` when there is anything to report. Copy the exact \`head_sha\`, \`merge_base_sha\`, and \`bundle_digest\` from \`manifest.json\`. Set \`reviewer\` to the authenticated actor that will publish the attestation. Evidence must identify the files, tests, invariants, or conflict criteria actually checked; PASS without evidence is invalid.

Version 2 findings are structured. Each entry requires:

- \`id\` — unique within the report.
- \`classification\` — \`candidate_regression\`, \`declared_contract_violation\`, \`preexisting_implementation_mismatch\`, \`decision_ambiguity\`, \`documentation_disagreement\`, \`unrelated_defect\`, or \`suggestion\`.
- \`disposition\` — what the reviewed tree already does about it: \`unresolved\` (nothing yet, so the verdict cannot be \`PASS\`), \`fixed\`, \`conflict_introduced\`, \`existing_conflict_linked\`, \`followup_created\`, \`recorded\` (noted without action), or \`dismissed_with_reason\`. This is your observation of the candidate, never the author's claim. \`conflict_introduced\` and \`existing_conflict_linked\` require \`conflict_id\`; \`followup_created\` requires \`followup_ref\`; \`dismissed_with_reason\` requires a 20+ character \`dismissal_reason\`.
- \`scope_refs\` — one or more \`page:\`, \`source:\`, \`invariant:\`, \`conflict:\`, \`test:\`, or \`metadata:\` references binding the finding to this candidate.
- \`discrepancy\`, \`authority\` (\`{kind, ref}\` naming the controlling normative/observed/derived/test/metadata source), \`evidence\`, and \`acceptance_criteria\` (objective and closable; only a \`suggestion\` may omit them).

The engine refuses a \`PASS\` that carries an \`unresolved\` finding, and it adjudicates which disposition may retire which classification:

| classification | may be retired by |
|---|---|
| \`candidate_regression\`, \`declared_contract_violation\` | \`fixed\` |
| \`preexisting_implementation_mismatch\`, \`documentation_disagreement\` | \`fixed\`, \`conflict_introduced\`, \`existing_conflict_linked\`, \`followup_created\`, \`dismissed_with_reason\` |
| \`decision_ambiguity\` | \`fixed\`, \`conflict_introduced\`, \`existing_conflict_linked\` |
| \`unrelated_defect\` | \`fixed\`, \`existing_conflict_linked\`, \`followup_created\`, \`dismissed_with_reason\` |
| \`suggestion\` | \`fixed\`, \`followup_created\`, \`recorded\`, \`dismissed_with_reason\` |

\`unresolved\` stays available everywhere, but it blocks \`PASS\`. So a break this candidate caused, or a contract the PR itself declares, is closed only by fixing it: classify honestly rather than reaching for a classification whose deferrals are wider.

A disposition naming a conflict must name one that is open at the reviewed HEAD, carries the conflict type its classification implies where one is implied, declares \`origin: baseline\` whenever the classification says the problem predates this candidate, and lists at least one of the finding's \`page:\` scope refs among its affected pages. \`unrelated_defect\` implies no conflict type; \`decision_ambiguity\` is exempt from the \`origin\` rule, because this candidate may legitimately raise a new question about its own behaviour. The author writes that \`origin\` and you write the classification independently; the engine only requires that the two agree.

A \`version: 1\` report with free-text \`findings\` is still accepted so an in-flight review is not invalidated, but it cannot express a disposition. Prefer version 2.

Publish the report through the repository's trusted attestation channel. A report in the author's editable PR body is only a status mirror and is not proof of independent review.
`;
  files["REPORT.example.json"] = jsonStable({
    version: 2,
    verdict: "PASS",
    reviewed_head_sha: "<copy manifest.head_sha>",
    merge_base_sha: "<copy manifest.merge_base_sha>",
    bundle_digest: "<copy manifest.bundle_digest>",
    reviewer: "<authenticated reviewer actor>",
    evidence: ["Describe the primary sources, tests, invariants, and conflicts inspected."],
    summary: "Explain why the current implementation and wiki agree.",
  });
  files["REPORT.findings.example.json"] = jsonStable({
    version: 2,
    verdict: "NEEDS_RECONCILE",
    reviewed_head_sha: "<copy manifest.head_sha>",
    merge_base_sha: "<copy manifest.merge_base_sha>",
    bundle_digest: "<copy manifest.bundle_digest>",
    reviewer: "<authenticated reviewer actor>",
    evidence: ["<page, source, test, or conflict actually inspected>"],
    summary: "One finding must be fixed here; the other is already tracked by an open conflict.",
    findings: [
      {
        id: "FC-001",
        classification: "candidate_regression",
        disposition: "unresolved",
        scope_refs: ["source:<path changed by this candidate>", "page:<affected page id>"],
        discrepancy: "<what the candidate broke, stated against the controlling authority>",
        authority: { kind: "normative", ref: "<wiki page or invariant that governs it>" },
        acceptance_criteria: ["<objective, checkable condition that closes this finding>"],
        evidence: ["<file or test that demonstrates the break>"],
      },
      {
        id: "FC-002",
        classification: "preexisting_implementation_mismatch",
        disposition: "existing_conflict_linked",
        conflict_id: "C-000",
        scope_refs: ["page:<affected page id>", "conflict:C-000"],
        discrepancy: "<mismatch that predates this candidate>",
        authority: { kind: "normative", ref: "<wiki page that states the intended contract>" },
        acceptance_criteria: ["<condition recorded in the conflict's resolution.acceptance>"],
        evidence: ["<source read at the merge base showing the mismatch predates the diff>"],
      },
    ],
  });
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

export function buildFocusedReviewManifest(view: RepoView, pages: WikiPage[], report: ImpactReport, metadata?: PrMetadata): FocusedReviewManifest {
  return focusedReviewData(view, pages, report, metadata).manifest;
}

/** Validate focused reviewer inputs and their optional emitted object bytes. */
export function validateFocusedReviewManifest(
  focused: FocusedReviewManifest,
  files: Record<string, string> = {},
  expected?: ReviewManifest,
  enforceRequired = true,
): Finding[] {
  const findings: Finding[] = [];
  const error = (code: string, message: string, path = "focused-manifest.json") => findings.push({ code, message, path, severity: "error" });
  if (focused == null || typeof focused !== "object") return [{ code: "focused-manifest-shape", message: "focused manifest must be an object", path: "focused-manifest.json", severity: "error" }];
  if (focused.version !== 1) error("focused-manifest-version", "focused manifest version must be 1");
  for (const [field, value, length] of [
    ["head_sha", focused.head_sha, 40],
    ["merge_base_sha", focused.merge_base_sha, 40],
    ["diff_digest", focused.diff_digest, 64],
    ["impact_report_digest", focused.impact_report_digest, 64],
    ["pr_metadata_digest", focused.pr_metadata_digest, 64],
  ] as const) {
    if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) error("focused-manifest-digest", `${field} must be a lowercase digest`, field);
  }
  if (!Array.isArray(focused.changed_files) || focused.changed_files.some((path) => typeof path !== "string" || path.length === 0)) error("focused-manifest-changed-files", "changed_files must be a string array");
  const objects = new Map<string, FocusedBodyObject>();
  if (!Array.isArray(focused.objects)) error("focused-manifest-objects", "objects must be an array");
  for (const [index, object] of (Array.isArray(focused.objects) ? focused.objects : []).entries()) {
    if (object == null || typeof object !== "object" || !/^[0-9a-f]{64}$/.test(object.digest) || object.object_path !== `objects/${object.digest}.md` || !Number.isInteger(object.bytes) || object.bytes < 0) {
      error("focused-manifest-object-malformed", `objects[${index}] must bind a SHA-256 digest to objects/<digest>.md`, `focused-manifest.json:objects[${index}]`);
      continue;
    }
    if (objects.has(object.digest)) error("focused-manifest-object-duplicate", `duplicate body object digest: ${object.digest}`, `focused-manifest.json:objects[${index}]`);
    objects.set(object.digest, object);
    if (Object.keys(files).length > 0) {
      const raw = files[object.object_path];
      if (raw == null) error("focused-manifest-object-missing", `body object is missing from bundle: ${object.object_path}`, object.object_path);
      else {
        if (hashContent(raw) !== object.digest) error("focused-manifest-object-digest", `body object digest does not match bytes: ${object.object_path}`, object.object_path);
        if (Buffer.byteLength(raw, "utf8") !== object.bytes) error("focused-manifest-object-bytes", `body object byte count does not match bytes: ${object.object_path}`, object.object_path);
      }
    }
  }
  const bodyRoles = new Set<string>();
  if (!Array.isArray(focused.body_roles)) error("focused-manifest-body-roles", "body_roles must be an array");
  for (const [index, role] of (Array.isArray(focused.body_roles) ? focused.body_roles : []).entries()) {
    const valid = role != null && typeof role === "object"
      && ["affected_page", "invariant", "removed_page", "conflict"].includes(role.role)
      && typeof role.id === "string" && typeof role.wiki_path === "string"
      && ["head", "merge-base"].includes(role.lifecycle)
      && /^[0-9a-f]{64}$/.test(role.digest)
      && objects.has(role.digest);
    if (!valid) {
      error("focused-manifest-body-role", `body_roles[${index}] has an invalid or unbound object role`, `focused-manifest.json:body_roles[${index}]`);
      continue;
    }
    const key = `${role.role}:${role.id}:${role.lifecycle}`;
    if (bodyRoles.has(key)) error("focused-manifest-body-role-duplicate", `duplicate body role: ${key}`, `focused-manifest.json:body_roles[${index}]`);
    bodyRoles.add(key);
  }
  const sourceRoles = new Set<FocusedSourceRole>(["changed_source", "affected_authority_source", "relevant_test", "supporting_source"]);
  const declarationsById = new Map<string, FocusedSourceDeclaration>();
  if (!Array.isArray(focused.source_declarations)) error("focused-manifest-source-declarations", "source_declarations must be an array");
  for (const [index, declaration] of (Array.isArray(focused.source_declarations) ? focused.source_declarations : []).entries()) {
    if (declaration == null || typeof declaration !== "object" || typeof declaration.id !== "string" || typeof declaration.page_id !== "string" || !["path", "glob"].includes(declaration.matched_via) || declaration.declaration == null || typeof declaration.declaration !== "object") {
      error("focused-manifest-declaration", `source_declarations[${index}] is malformed`, `focused-manifest.json:source_declarations[${index}]`);
      continue;
    }
    if (declarationsById.has(declaration.id)) error("focused-manifest-declaration-duplicate", `duplicate source declaration ID: ${declaration.id}`, `focused-manifest.json:source_declarations[${index}]`);
    declarationsById.set(declaration.id, declaration);
  }
  const seenSources = new Set<string>();
  const referencedDeclarationIds = new Set<string>();
  if (!Array.isArray(focused.source_roles)) error("focused-manifest-source-roles", "source_roles must be an array");
  for (const [index, source] of (Array.isArray(focused.source_roles) ? focused.source_roles : []).entries()) {
    const valid = source != null && typeof source === "object" && typeof source.path === "string" && source.path.length > 0
      && Array.isArray(source.roles) && source.roles.length > 0 && source.roles.every((role) => sourceRoles.has(role))
      && Array.isArray(source.declared_by) && source.declared_by.every((id) => typeof id === "string")
      && Array.isArray(source.declaration_ids) && source.declaration_ids.every((id) => typeof id === "string" && declarationsById.has(id))
      && ["head", "merge-base", "added", "removed", "changed", "unchanged"].includes(source.lifecycle)
      && (source.head_digest == null || /^[0-9a-f]{64}$/.test(source.head_digest))
      && (source.merge_base_digest == null || /^[0-9a-f]{64}$/.test(source.merge_base_digest));
    if (!valid) {
      error("focused-manifest-source-role", `source_roles[${index}] is malformed or has an unknown role`, `focused-manifest.json:source_roles[${index}]`);
      continue;
    }
    if (seenSources.has(source.path)) error("focused-manifest-source-duplicate", `source path appears more than once: ${source.path}`, `focused-manifest.json:source_roles[${index}]`);
    seenSources.add(source.path);
    if (source.roles.includes("changed_source") && !(focused.changed_files as string[]).includes(source.path)) error("focused-manifest-changed-source-missing", `changed_source role is not bound to changed_files: ${source.path}`, source.path);
    if (source.roles.includes("relevant_test") && !focusedSourcePath(source.path)) error("focused-manifest-test-misclassified", `relevant_test role is not a test path: ${source.path}`, source.path);
    const hasHead = source.head_digest != null;
    const hasMergeBase = source.merge_base_digest != null;
    const sameDigest = hasHead && hasMergeBase && source.head_digest === source.merge_base_digest;
    const lifecycleConsistent = source.lifecycle === "added" || source.lifecycle === "head"
      ? hasHead && !hasMergeBase
      : source.lifecycle === "removed" || source.lifecycle === "merge-base"
        ? !hasHead && hasMergeBase
        : source.lifecycle === "changed"
          ? hasHead && hasMergeBase && !sameDigest
          : source.lifecycle === "unchanged"
            ? hasHead && hasMergeBase && sameDigest
            : false;
    if (!lifecycleConsistent) error("focused-manifest-lifecycle-binding", `source lifecycle does not match its head/merge-base digests: ${source.path}`, source.path);
    if (source.roles.includes("affected_authority_source") && (source.declared_by.length === 0 || source.declaration_ids.length === 0)) error("focused-manifest-authority-provenance", `affected_authority_source requires declaring page and declaration provenance: ${source.path}`, source.path);
    const declarationOwners = [...new Set(source.declaration_ids.map((id) => declarationsById.get(id)?.page_id).filter((id): id is string => id != null))].sort((a, b) => a.localeCompare(b));
    const declaredBy = [...new Set(source.declared_by)].sort((a, b) => a.localeCompare(b));
    if (jsonStable(declarationOwners) !== jsonStable(declaredBy)) error("focused-manifest-declared-by", `declared_by does not exactly match source declaration owners: ${source.path}`, source.path);
    for (const declarationId of source.declaration_ids) {
      referencedDeclarationIds.add(declarationId);
      const declaration = declarationsById.get(declarationId);
      if (!declaration) continue;
      if (!source.declared_by.includes(declaration.page_id)) error("focused-manifest-declaration-owner", `source declaration owner is missing from declared_by: ${source.path}`, source.path);
      const declarationValue = declaration.declaration as Record<string, unknown>;
      const exactPath = typeof declarationValue.path === "string" ? declarationValue.path : undefined;
      const globPattern = typeof declarationValue.glob === "string" ? declarationValue.glob : undefined;
      if (declaration.matched_via === "path" && exactPath == null) error("focused-manifest-declaration-shape", `exact source declaration is missing its path provenance: ${source.path}`, source.path);
      if (declaration.matched_via === "glob" && globPattern == null) error("focused-manifest-declaration-shape", `glob source declaration is missing its glob provenance: ${source.path}`, source.path);
      if (declaration.matched_via === "path" && exactPath != null && exactPath !== source.path) error("focused-manifest-declaration-path", `exact source declaration does not bind its source path: ${source.path}`, source.path);
      if (declaration.matched_via === "glob" && (typeof declaration.expanded_glob !== "string" || declaration.expanded_glob.length === 0 || declaration.expanded_glob !== globPattern)) error("focused-manifest-declaration-glob", `glob source declaration is missing or misclassified expanded provenance: ${source.path}`, source.path);
    }
  }
  for (const declarationId of declarationsById.keys()) {
    if (!referencedDeclarationIds.has(declarationId)) error("focused-manifest-declaration-unreferenced", `source declaration is not bound to any source role: ${declarationId}`, `focused-manifest.json:source_declarations`);
  }
  if (expected) {
    if (focused.head_sha !== expected.head_sha) error("focused-manifest-head-binding", "focused manifest HEAD does not match the enclosing ReviewManifest");
    if (focused.merge_base_sha !== expected.merge_base_sha) error("focused-manifest-base-binding", "focused manifest merge base does not match the enclosing ReviewManifest");
    if (focused.diff_digest !== expected.diff_digest) error("focused-manifest-diff-binding", "focused manifest diff digest does not match the enclosing ReviewManifest");
    if (focused.impact_report_digest !== expected.impact_report_digest) error("focused-manifest-impact-binding", "focused manifest impact digest does not match the enclosing ReviewManifest");
    if (focused.pr_metadata_digest !== expected.pr_metadata_digest) error("focused-manifest-metadata-binding", "focused manifest metadata digest does not match the enclosing ReviewManifest");
    for (const [path, digest] of Object.entries(expected.file_digests)) {
      const raw = files[path];
      if (raw == null) error("focused-manifest-file-missing", `enclosing bundle file is missing: ${path}`, path);
      else if (hashContent(raw) !== digest) error("focused-manifest-file-digest", `enclosing bundle file digest does not match manifest: ${path}`, path);
    }
    const core = { ...expected } as Record<string, unknown>;
    delete core.bundle_digest;
    if (hashContent(jsonStable(core)) !== expected.bundle_digest) error("focused-manifest-bundle-binding", "enclosing ReviewManifest bundle digest is not self-consistent", "manifest.json");
    const requireBody = (role: FocusedBodyRole, id: string) => {
      if (!bodyRoles.has(`${role}:${id}:head`) && !bodyRoles.has(`${role}:${id}:merge-base`)) error(`focused-manifest-${role}-missing`, `required ${role} role is missing: ${id}`);
    };
    if (enforceRequired) {
      for (const id of expected.affected_page_ids) requireBody("affected_page", id);
      for (const id of expected.affected_invariant_ids) requireBody("invariant", id);
      for (const id of expected.affected_conflict_ids) requireBody("conflict", id);
    }
    const sourceByPath = new Map((Array.isArray(focused.source_roles) ? focused.source_roles : []).map((source) => [source.path, source]));
    if (enforceRequired) {
      for (const path of focused.changed_files) {
        const source = sourceByPath.get(path);
        if (!source || !source.roles.includes("changed_source")) error("focused-manifest-changed-source-required", `changed file is missing changed_source classification: ${path}`, path);
        if (focusedSourcePath(path) && !source?.roles.includes("relevant_test")) error("focused-manifest-relevant-test-required", `changed test is missing relevant_test classification: ${path}`, path);
      }
    }
    if (expected.focused_manifest_digest && Object.keys(files).length > 0 && files["focused-manifest.json"] != null && hashContent(files["focused-manifest.json"]) !== expected.focused_manifest_digest) error("focused-manifest-digest-binding", "focused manifest digest does not match the enclosing ReviewManifest");
    let canonicalChangedFiles: string[] | undefined;
    const impactRaw = files["impact.json"];
    if (impactRaw != null) {
      try {
        const impact = JSON.parse(impactRaw) as { changedFiles?: unknown };
        if (!Array.isArray(impact.changedFiles) || impact.changedFiles.some((path) => typeof path !== "string" || path.length === 0)) {
          error("focused-manifest-impact-changed-files", "bound impact.json changedFiles must be a string array", "impact.json");
        } else {
          canonicalChangedFiles = [...impact.changedFiles].sort((a, b) => a.localeCompare(b));
          if (new Set(canonicalChangedFiles).size !== canonicalChangedFiles.length) error("focused-manifest-impact-changed-files", "bound impact.json changedFiles must not contain duplicates", "impact.json");
          if (!Array.isArray(focused.changed_files) || jsonStable(focused.changed_files) !== jsonStable(canonicalChangedFiles)) error("focused-manifest-changed-files-binding", "focused changed_files must exactly match the digest-bound impact.json changedFiles", "focused-manifest.json:changed_files");
        }
      } catch {
        error("focused-manifest-impact-changed-files", "bound impact.json must be valid JSON with canonical changedFiles", "impact.json");
      }
    }
    const authorityPageIds = new Set([...expected.affected_page_ids, ...expected.affected_invariant_ids]);
    type AuthorityDeclaration = { page_id: string; declaration: WikiSource; matched_via: "path" | "glob" };
    const authorityExact = new Map<string, AuthorityDeclaration[]>();
    const authorityGlobs: AuthorityDeclaration[] = [];
    const authorityBodyKeys = new Set<string>();
    for (const bodyRole of Array.isArray(focused.body_roles) ? focused.body_roles : []) {
      const isAuthorityBody = (bodyRole.role === "affected_page" && expected.affected_page_ids.includes(bodyRole.id))
        || (bodyRole.role === "invariant" && expected.affected_invariant_ids.includes(bodyRole.id));
      if (!isAuthorityBody) continue;
      const bodyObject = objects.get(bodyRole.digest);
      const raw = bodyObject ? files[bodyObject.object_path] : undefined;
      if (raw == null) continue;
      const bodyKey = `${bodyRole.role}:${bodyRole.id}:${bodyRole.digest}`;
      if (authorityBodyKeys.has(bodyKey)) continue;
      authorityBodyKeys.add(bodyKey);
      let authorityPage: WikiPage;
      try {
        authorityPage = parseWikiPage(bodyRole.wiki_path, raw);
      } catch {
        error("focused-manifest-authority-body", `authority body cannot be parsed for ${bodyRole.id}`, bodyRole.wiki_path);
        continue;
      }
      if (authorityPage.data.id !== bodyRole.id) error("focused-manifest-authority-body", `authority body ID does not match its bound role: ${bodyRole.id}`, bodyRole.wiki_path);
      for (const rawDeclaration of authorityPage.data.sources) {
        const declaration: AuthorityDeclaration = {
          page_id: authorityPage.data.id,
          declaration: canonicalSourceDeclaration(rawDeclaration),
          matched_via: "path" in rawDeclaration ? "path" : "glob",
        };
        if ("path" in rawDeclaration) {
          const path = rawDeclaration.path;
          const records = authorityExact.get(path) ?? [];
          if (!records.some((record) => record.page_id === declaration.page_id && jsonStable(record.declaration) === jsonStable(declaration.declaration))) records.push(declaration);
          authorityExact.set(path, records);
        } else {
          if (!authorityGlobs.some((record) => record.page_id === declaration.page_id && jsonStable(record.declaration) === jsonStable(declaration.declaration))) {
            authorityGlobs.push(declaration);
          }
        }
      }
    }
    const declarationMatches = (source: FocusedSourceBinding, requirement: AuthorityDeclaration): boolean => source.declaration_ids.some((id) => {
      const declaration = declarationsById.get(id);
      if (!declaration || declaration.page_id !== requirement.page_id || declaration.matched_via !== requirement.matched_via) return false;
      if (jsonStable(declaration.declaration) !== jsonStable(requirement.declaration)) return false;
      return requirement.matched_via !== "glob" || ("glob" in requirement.declaration && declaration.expanded_glob === requirement.declaration.glob);
    });
    for (const [path, requirements] of authorityExact.entries()) {
      const matches = (Array.isArray(focused.source_roles) ? focused.source_roles : []).filter((source) => source.path === path);
      if (matches.length !== 1) {
        error("focused-manifest-authority-source-required", `exact affected authority source is missing its sole source binding: ${path}`, path);
        continue;
      }
      const source = matches[0];
      if (!source.roles.includes("affected_authority_source")) error("focused-manifest-authority-role-required", `exact affected authority source is missing affected_authority_source: ${path}`, path);
      for (const requirement of requirements) {
        if (!source.declared_by.includes(requirement.page_id)) error("focused-manifest-authority-provenance", `exact authority source is missing declaring page provenance: ${path}`, path);
        if (!declarationMatches(source, requirement)) error("focused-manifest-authority-declaration-required", `exact authority source is missing its canonical declaration ID: ${path}`, path);
      }
    }
    if (canonicalChangedFiles) {
      for (const requirement of authorityGlobs) {
        if (!("glob" in requirement.declaration)) continue;
        const pattern = requirement.declaration.glob;
        let glob: Bun.Glob;
        try {
          glob = new Bun.Glob(pattern);
        } catch {
          error("focused-manifest-authority-glob", `authority source glob is invalid: ${pattern}`);
          continue;
        }
        for (const path of canonicalChangedFiles.filter((candidate) => glob.match(candidate))) {
          const matches = (Array.isArray(focused.source_roles) ? focused.source_roles : []).filter((source) => source.path === path);
          if (matches.length !== 1) {
            error("focused-manifest-authority-source-required", `changed authority glob match is missing its sole source binding: ${path}`, path);
            continue;
          }
          const source = matches[0];
          if (!source.roles.includes("affected_authority_source")) error("focused-manifest-authority-role-required", `changed authority glob match is missing affected_authority_source: ${path}`, path);
          if (!source.declared_by.includes(requirement.page_id)) error("focused-manifest-authority-provenance", `changed authority glob match is missing declaring page provenance: ${path}`, path);
          if (!declarationMatches(source, requirement)) error("focused-manifest-authority-declaration-required", `changed authority glob match is missing its canonical declaration ID: ${path}`, path);
        }
      }
    }
    for (const source of Array.isArray(focused.source_roles) ? focused.source_roles : []) {
      const hasAuthorityDeclaration = source.declaration_ids.some((id) => authorityPageIds.has(declarationsById.get(id)?.page_id ?? ""));
      if (hasAuthorityDeclaration && !source.roles.includes("affected_authority_source")) error("focused-manifest-authority-role-required", `source declaration from an affected authority page is missing affected_authority_source: ${source.path}`, source.path);
      if (!hasAuthorityDeclaration && source.roles.includes("affected_authority_source")) error("focused-manifest-authority-role-misclassified", `affected_authority_source is not backed by an affected authority declaration: ${source.path}`, source.path);
    }
    if (canonicalChangedFiles) {
      for (const path of canonicalChangedFiles) {
        const matches = (Array.isArray(focused.source_roles) ? focused.source_roles : []).filter((source) => source.path === path);
        if (matches.length !== 1) error("focused-manifest-changed-source-binding", `each canonical changed path must have exactly one source binding: ${path}`, path);
        else if (!matches[0].roles.includes("changed_source")) error("focused-manifest-changed-source-binding", `canonical changed path is missing changed_source classification: ${path}`, path);
        if (enforceRequired && focusedSourcePath(path) && matches.length === 1 && !matches[0].roles.includes("relevant_test")) error("focused-manifest-relevant-test-required", `changed test is missing relevant_test classification: ${path}`, path);
      }
    }
  }
  return findings;
}

/** Alias used by callers that validate the complete bundle envelope. */
export const validateReviewBundleBindings = validateFocusedReviewManifest;

export function buildReviewManifest(view: RepoView, pages: WikiPage[], report: ImpactReport, metadata?: PrMetadata): ReviewManifest {
  const focused = focusedReviewData(view, pages, report, metadata);
  const files = reviewBundleFiles(view, pages, report, metadata);
  const fileDigests = Object.fromEntries(Object.entries(files).map(([path, content]) => [path, hashContent(content)]).sort(([a], [b]) => a.localeCompare(b)));
  const baseInvariantIds = new Set(git(view.root, ["ls-tree", "-r", "--name-only", report.mergeBase, "--", "wiki"], true)
    .split("\n")
    .filter(isContentPage)
    .flatMap((path) => {
      const raw = git(view.root, ["show", `${report.mergeBase}:${path}`], true);
      if (!raw) return [];
      try {
        const page = parseWikiPage(path, raw);
        return page.data.status === "current" && page.data.kind === "invariant" ? [page.data.id] : [];
      } catch {
        return [];
      }
    }));
  const affectedInvariantIds = new Set(metadata?.affected_invariants ?? []);
  for (const id of report.affectedPages) {
    if (baseInvariantIds.has(id) || pages.find((page) => page.data.id === id)?.data.kind === "invariant") affectedInvariantIds.add(id);
  }
  for (const conflict of report.affectedConflicts) for (const id of conflict.affectedInvariants) affectedInvariantIds.add(id);
  const core = {
    version: 1 as const,
    base_ref: report.base.trim().replaceAll("\\", "/"),
    merge_base_sha: report.mergeBase,
    head_sha: git(view.root, ["rev-parse", "--verify", "HEAD^{commit}"]).trim(),
    pr_metadata_digest: hashContent(jsonStable(canonicalPrMetadata(metadata))),
    impact_report_digest: hashContent(files["impact.json"]),
    diff_digest: hashContent(files["diff.patch"]),
    affected_page_ids: [...report.affectedPages].sort((a, b) => a.localeCompare(b)),
    affected_invariant_ids: [...affectedInvariantIds].sort((a, b) => a.localeCompare(b)),
    affected_conflict_ids: report.affectedConflicts.map((conflict) => conflict.id).sort((a, b) => a.localeCompare(b)),
    file_digests: fileDigests,
    focused_manifest_digest: hashContent(files["focused-manifest.json"]),
  };
  const manifest = { ...core, bundle_digest: hashContent(jsonStable(core)) };
  const bindingFindings = validateFocusedReviewManifest(focused.manifest, files, manifest, false);
  if (bindingFindings.some((finding) => finding.severity === "error")) throw new Error(bindingFindings.map((finding) => finding.message).join("; "));
  return manifest;
}

export function makeReviewBundle(view: RepoView, pages: WikiPage[], report: ImpactReport, output?: string, metadata?: PrMetadata): string {
  const directory = output ? resolve(view.root, output) : mkdtempSync(join(tmpdir(), "wiki-review-"));
  const files: Record<string, string> = { ...reviewBundleFiles(view, pages, report, metadata), "manifest.json": jsonStable(buildReviewManifest(view, pages, report, metadata)) };
  for (const [path, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    Bun.spawnSync(["mkdir", "-p", dirname(join(directory, path))]);
    writeFileSync(join(directory, path), content);
  }
  // Keep the old removed-page/conflict paths as compatibility links only. The
  // body bytes live exactly once under objects/<sha256>.md and the focused
  // manifest remains the authoritative role-to-object index.
  const focused = JSON.parse(files["focused-manifest.json"]) as FocusedReviewManifest;
  for (const role of focused.body_roles.filter((item) => item.role === "removed_page" || item.role === "conflict")) {
    const alias = role.role === "removed_page"
      ? `pages/removed_${role.id.replaceAll("/", "_")}.md`
      : `conflicts/${role.id}.md`;
    const aliasPath = join(directory, alias);
    Bun.spawnSync(["mkdir", "-p", dirname(aliasPath)]);
    rmSync(aliasPath, { force: true });
    symlinkSync(relative(dirname(aliasPath), join(directory, `objects/${role.digest}.md`)), aliasPath);
  }
  return directory;
}

function normalizedActor(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

const FRESH_CONTEXT_CLASSIFICATIONS = new Set<string>([
  "candidate_regression",
  "declared_contract_violation",
  "preexisting_implementation_mismatch",
  "decision_ambiguity",
  "documentation_disagreement",
  "unrelated_defect",
  "suggestion",
]);
const FRESH_CONTEXT_DISPOSITIONS = new Set<string>([
  "unresolved",
  "fixed",
  "conflict_introduced",
  "existing_conflict_linked",
  "followup_created",
  "recorded",
  "dismissed_with_reason",
]);
const FRESH_CONTEXT_AUTHORITY_KINDS = new Set<string>(["normative", "observed", "derived", "test", "metadata"]);
const FRESH_CONTEXT_SCOPE_KINDS = ["page", "source", "invariant", "conflict", "test", "metadata"] as const;
const FRESH_CONTEXT_DISPOSITION_FIELD: Partial<Record<FreshContextDisposition, "conflict_id" | "followup_ref" | "dismissal_reason">> = {
  conflict_introduced: "conflict_id",
  existing_conflict_linked: "conflict_id",
  followup_created: "followup_ref",
  dismissed_with_reason: "dismissal_reason",
};

/**
 * Which dispositions retire which classification. This encodes the workflow
 * rule rather than inventing one: fix what this candidate broke or what the PR
 * itself declares; track a pre-existing mismatch, an undecided product
 * decision, or a documentation disagreement in an open conflict; record a named
 * follow-up for a defect outside this change's semantic scope.
 *
 * `unresolved` and `fixed` are legal everywhere — the first is the state a
 * finding starts in, and fixing something is never the wrong answer. What the
 * table actually withholds is the deferral: a break this candidate caused
 * cannot be pushed into a conflict, a follow-up, or a dismissal, so the only
 * way past it is to fix it. `recorded` retires nothing, so it stays limited to
 * a `suggestion`, which asserts no contract to begin with.
 */
const FRESH_CONTEXT_CLASSIFICATION_DISPOSITIONS: Record<FreshContextClassification, Set<FreshContextDisposition>> = {
  candidate_regression: new Set(["unresolved", "fixed"]),
  declared_contract_violation: new Set(["unresolved", "fixed"]),
  preexisting_implementation_mismatch: new Set([
    "unresolved",
    "fixed",
    "conflict_introduced",
    "existing_conflict_linked",
    "followup_created",
    "dismissed_with_reason",
  ]),
  decision_ambiguity: new Set(["unresolved", "fixed", "conflict_introduced", "existing_conflict_linked"]),
  documentation_disagreement: new Set([
    "unresolved",
    "fixed",
    "conflict_introduced",
    "existing_conflict_linked",
    "followup_created",
    "dismissed_with_reason",
  ]),
  unrelated_defect: new Set(["unresolved", "fixed", "existing_conflict_linked", "followup_created", "dismissed_with_reason"]),
  suggestion: new Set(["unresolved", "fixed", "followup_created", "recorded", "dismissed_with_reason"]),
};

/** The conflict type a classification must be tracked under when it points at one. */
const FRESH_CONTEXT_CLASSIFICATION_CONFLICT_TYPE: Partial<Record<FreshContextClassification, ConflictType>> = {
  preexisting_implementation_mismatch: "implementation",
  decision_ambiguity: "decision",
  documentation_disagreement: "documentation",
};

/**
 * Classifications that assert the problem predates the candidate. The author
 * writes a conflict's `origin`; the reviewer independently writes
 * `classification`. They are the same judgement made by different parties, so a
 * finding that says "this was already broken" may only point at a conflict that
 * says the same thing.
 *
 * `decision_ambiguity` is deliberately absent. It reports that intent is
 * undecided, not that something is broken, and a change can legitimately raise
 * a new question about its own behaviour — a conflict honestly recording
 * `origin: introduced_by_change`. Requiring `baseline` there would leave that
 * conflict as the only allowed disposition while making it illegal, and
 * inventing the decision to close it is forbidden outright.
 */
const FRESH_CONTEXT_PREEXISTING_CLASSIFICATIONS = new Set<FreshContextClassification>([
  "preexisting_implementation_mismatch",
  "documentation_disagreement",
  "unrelated_defect",
]);

function nonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

/**
 * Shape validation for version 2 findings. It proves a finding is actionable —
 * bound to the reviewed change, attributed to a controlling authority, closable
 * against stated criteria, and honest about where an undone finding is tracked.
 *
 * It also adjudicates the disposition. The classification-to-disposition table
 * always applies, because it needs nothing beyond the finding itself. Resolving
 * a conflict pointer does need a repository view, so that half runs only when
 * `conflicts` is supplied. `reviewCheck` always supplies the open conflicts at
 * HEAD, so an empty array correctly means every conflict pointer is dangling.
 */
export function validateFreshContextFindings(
  raw: unknown,
  severity: Finding["severity"],
  conflicts?: ConflictSummary[],
): Finding[] {
  const byConflictId = conflicts == null ? undefined : new Map(conflicts.map((item) => [item.id, item]));
  const findings: Finding[] = [];
  const push = (code: string, message: string) => findings.push({ code, message, severity });
  if (raw == null) return findings;
  if (!Array.isArray(raw)) {
    push("fresh-context-finding-malformed", "version 2 findings must be an array of structured findings");
    return findings;
  }
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const label = `finding ${index + 1}`;
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
      push("fresh-context-finding-malformed", `${label} must be a mapping`);
      return;
    }
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (id.length === 0) push("fresh-context-finding-malformed", `${label} requires a non-empty id`);
    else if (seen.has(id)) push("fresh-context-finding-malformed", `duplicate finding id: ${id}`);
    else seen.add(id);
    const name = id.length > 0 ? id : label;

    const classification = typeof item.classification === "string" ? item.classification : undefined;
    if (classification == null || !FRESH_CONTEXT_CLASSIFICATIONS.has(classification)) push("fresh-context-finding-malformed", `${name} requires a known classification`);
    if (typeof item.discrepancy !== "string" || item.discrepancy.trim().length === 0) push("fresh-context-finding-malformed", `${name} requires a non-empty discrepancy`);
    if (!nonEmptyStrings(item.evidence)) push("fresh-context-finding-malformed", `${name} requires non-empty evidence entries`);

    if (!nonEmptyStrings(item.scope_refs)) {
      push("fresh-context-finding-scope-missing", `${name} requires at least one scope_refs entry binding it to the reviewed change`);
    } else {
      for (const ref of item.scope_refs) {
        const kind = ref.slice(0, ref.indexOf(":"));
        if (!FRESH_CONTEXT_SCOPE_KINDS.includes(kind as (typeof FRESH_CONTEXT_SCOPE_KINDS)[number]) || ref.slice(kind.length + 1).trim().length === 0) {
          push("fresh-context-finding-scope-missing", `${name} scope ref must be <${FRESH_CONTEXT_SCOPE_KINDS.join("|")}>:<ref>, received ${ref}`);
        }
      }
    }

    const authority = item.authority as Record<string, unknown> | undefined;
    const authorityValid = authority != null && typeof authority === "object" && !Array.isArray(authority)
      && typeof authority.kind === "string" && FRESH_CONTEXT_AUTHORITY_KINDS.has(authority.kind)
      && typeof authority.ref === "string" && authority.ref.trim().length > 0;
    if (!authorityValid) push("fresh-context-finding-authority-missing", `${name} requires authority.kind and a non-empty authority.ref naming the controlling source`);

    if (classification !== "suggestion" && !nonEmptyStrings(item.acceptance_criteria)) {
      push("fresh-context-finding-acceptance-missing", `${name} requires objective acceptance_criteria; only a suggestion may omit them`);
    }

    const rawDisposition = typeof item.disposition === "string" ? item.disposition : undefined;
    if (rawDisposition == null || !FRESH_CONTEXT_DISPOSITIONS.has(rawDisposition)) {
      push("fresh-context-finding-malformed", `${name} requires a known disposition`);
      return;
    }
    const disposition = rawDisposition as FreshContextDisposition;

    // Only adjudicable once the classification itself parsed; an unknown
    // classification already reported its own finding above.
    if (classification != null && FRESH_CONTEXT_CLASSIFICATIONS.has(classification)) {
      const allowed = FRESH_CONTEXT_CLASSIFICATION_DISPOSITIONS[classification as FreshContextClassification];
      if (!allowed.has(disposition)) {
        push(
          "fresh-context-disposition-not-allowed",
          `${name} classification ${classification} cannot be retired by ${disposition}; allowed: ${[...allowed].sort((a, b) => a.localeCompare(b)).join(", ")}`,
        );
      }
    }

    const required = FRESH_CONTEXT_DISPOSITION_FIELD[disposition];
    if (required == null) return;
    const value = item[required];
    if (typeof value !== "string" || value.trim().length === 0) {
      push("fresh-context-disposition-incomplete", `${name} disposition ${disposition} requires ${required}`);
      return;
    }
    if (required === "dismissal_reason" && value.trim().length < 20) {
      push("fresh-context-disposition-incomplete", `${name} dismissal_reason requires at least 20 characters`);
      return;
    }
    if (required !== "conflict_id" || byConflictId == null) return;

    // A disposition that points at a conflict is only worth anything if the
    // conflict is real, open, and says what the finding says.
    const conflict = byConflictId.get(value.trim());
    if (conflict == null) {
      push("fresh-context-conflict-unknown", `${name} disposition ${disposition} names ${value.trim()}, which is not an open conflict at the reviewed HEAD`);
      return;
    }
    if (classification == null || !FRESH_CONTEXT_CLASSIFICATIONS.has(classification)) return;
    const typed = classification as FreshContextClassification;

    const expectedType = FRESH_CONTEXT_CLASSIFICATION_CONFLICT_TYPE[typed];
    if (expectedType != null && conflict.type !== expectedType) {
      push("fresh-context-conflict-mismatch", `${name} classification ${typed} requires a ${expectedType} conflict, but ${conflict.id} is ${conflict.type}`);
    }
    if (FRESH_CONTEXT_PREEXISTING_CLASSIFICATIONS.has(typed) && conflict.origin !== "baseline") {
      push(
        "fresh-context-conflict-mismatch",
        `${name} classification ${typed} states the problem predates this candidate, but ${conflict.id} declares origin ${conflict.origin}`,
      );
    }

    // Every conflict declares at least one affected current page, so a finding
    // that claims to be tracked by one has to name a page as well. Without this
    // a `source:`-only scope could be retired by any open conflict of the
    // implied type, about any subject.
    const scopedPages = nonEmptyStrings(item.scope_refs)
      ? item.scope_refs.filter((ref) => ref.startsWith("page:")).map((ref) => ref.slice("page:".length).trim()).filter((ref) => ref.length > 0)
      : [];
    if (scopedPages.length === 0) {
      push("fresh-context-conflict-mismatch", `${name} names ${conflict.id} but declares no page: scope ref to share with it`);
    } else if (!scopedPages.some((id) => conflict.affectedPages.includes(id))) {
      push(
        "fresh-context-conflict-mismatch",
        `${name} scopes pages ${scopedPages.join(", ")} but ${conflict.id} declares affected pages ${conflict.affectedPages.join(", ")}`,
      );
    }
  });
  return findings;
}

export function validateFreshContextAttestation(input: {
  policy: FreshContextPolicy;
  manifest: ReviewManifest;
  report?: unknown;
  reviewerActor?: string;
  prAuthor?: string;
  conflicts?: ConflictSummary[];
}): FreshContextCheckResult {
  const severity: Finding["severity"] = input.policy.mode === "required" ? "error" : "warning";
  const finding = (code: string, message: string): Finding => ({ code, message, severity });
  if (input.report == null) {
    const findings = [finding("fresh-context-missing", "no fresh-context report was supplied")];
    return { ok: input.policy.mode === "advisory", mode: input.policy.mode, findings };
  }
  if (typeof input.report !== "object" || Array.isArray(input.report)) {
    const findings = [finding("fresh-context-malformed", "fresh-context report must be a mapping")];
    return { ok: input.policy.mode === "advisory", mode: input.policy.mode, findings };
  }
  const raw = input.report as Record<string, unknown>;
  const verdicts = new Set(["PENDING", "PASS", "NEEDS_RECONCILE"]);
  const sha40 = /^[0-9a-f]{40}$/;
  const sha256 = /^[0-9a-f]{64}$/;
  const hasSummary = typeof raw.summary === "string" && raw.summary.trim().length > 0;
  const version = raw.version === 1 || raw.version === 2 ? raw.version : undefined;
  const hasFindings = version === 2
    ? Array.isArray(raw.findings) && raw.findings.length > 0
    : stringArray(raw.findings) && raw.findings.length > 0;
  const structurallyValid = version != null
    && typeof raw.verdict === "string" && verdicts.has(raw.verdict)
    && typeof raw.reviewed_head_sha === "string" && sha40.test(raw.reviewed_head_sha)
    && typeof raw.merge_base_sha === "string" && sha40.test(raw.merge_base_sha)
    && typeof raw.bundle_digest === "string" && sha256.test(raw.bundle_digest)
    && typeof raw.reviewer === "string" && raw.reviewer.trim().length > 0
    && Array.isArray(raw.evidence) && raw.evidence.every((item) => typeof item === "string")
    && (hasSummary || hasFindings);
  if (!structurallyValid) {
    const findings = [finding("fresh-context-malformed", "report requires version 1 or 2, a known verdict, exact SHA/digest fields, reviewer, evidence[], and summary or findings")];
    return { ok: input.policy.mode === "advisory", mode: input.policy.mode, findings };
  }
  const report = raw as FreshContextReport;
  const findings: Finding[] = [];
  if (report.version === 2) {
    findings.push(...validateFreshContextFindings(report.findings, severity, input.conflicts));
    // A PASS states that nothing is left dangling. A finding the reviewer left
    // `unresolved` is by definition dangling, so the two cannot coexist.
    if (report.verdict === "PASS") {
      const entries = Array.isArray(report.findings) ? report.findings : [];
      const unresolved = entries.filter((item) => item?.disposition === "unresolved").map((item) => item.id);
      if (unresolved.length > 0) findings.push(finding("fresh-context-finding-unresolved", `PASS cannot carry an unresolved finding: ${unresolved.join(", ")}`));
    }
  }
  if (report.verdict !== input.policy.requiredVerdict) findings.push(finding("fresh-context-not-pass", `required verdict is ${input.policy.requiredVerdict}, received ${report.verdict}`));
  if (input.policy.evidenceRequired && (report.evidence.length === 0 || report.evidence.some((item) => item.trim().length === 0))) findings.push(finding("fresh-context-evidence-missing", "PASS requires at least one non-empty evidence entry"));
  if (report.reviewed_head_sha !== input.manifest.head_sha) findings.push(finding("fresh-context-head-stale", `reviewed HEAD ${report.reviewed_head_sha} does not match current HEAD ${input.manifest.head_sha}`));
  if (report.merge_base_sha !== input.manifest.merge_base_sha) findings.push(finding("fresh-context-base-stale", `reviewed merge-base ${report.merge_base_sha} does not match current merge-base ${input.manifest.merge_base_sha}`));
  if (report.bundle_digest !== input.manifest.bundle_digest) findings.push(finding("fresh-context-bundle-stale", `reviewed bundle ${report.bundle_digest} does not match current bundle ${input.manifest.bundle_digest}`));

  const reviewer = normalizedActor(input.reviewerActor ?? report.reviewer);
  const declaredReviewer = normalizedActor(report.reviewer);
  const allowed = input.policy.trust.allowedReviewers.map(normalizedActor);
  const trustFailures: string[] = [];
  if (input.policy.trust.requireAuthenticatedActor && !input.reviewerActor?.trim()) trustFailures.push("authenticated reviewer actor is required");
  if (input.reviewerActor && reviewer !== declaredReviewer) trustFailures.push("report reviewer does not match the authenticated attestation actor");
  if (!allowed.includes("*") && !allowed.includes(reviewer)) trustFailures.push(`reviewer ${reviewer} is not in allowedReviewers`);
  if (input.policy.trust.requireDifferentActor) {
    if (!input.prAuthor?.trim()) trustFailures.push("PR author identity is required by the trust policy");
    else if (reviewer === normalizedActor(input.prAuthor)) trustFailures.push("reviewer must differ from the PR author");
  }
  if (trustFailures.length > 0) findings.push(finding("fresh-context-reviewer-untrusted", trustFailures.join("; ")));
  return {
    ok: input.policy.mode === "advisory" || !findings.some((item) => item.severity === "error"),
    mode: input.policy.mode,
    report,
    findings,
  };
}

export function parseFreshContextReport(raw: string): { report?: unknown; findings: Finding[] } {
  try {
    const report = parseYaml(raw) as unknown;
    return { report, findings: [] };
  } catch (error) {
    return {
      findings: [{
        code: "fresh-context-malformed",
        message: error instanceof Error ? error.message : String(error),
        severity: "error",
      }],
    };
  }
}

export function reviewCheck(view: RepoView, pages: WikiPage[], options: {
  base?: string;
  metadata?: PrMetadata;
  report?: unknown;
  reviewerActor?: string;
  prAuthor?: string;
  policy?: FreshContextPolicy;
}): ReviewCheckResult {
  const impact = impactReport(view, pages, { base: options.base, metadata: options.metadata });
  const manifest = buildReviewManifest(view, pages, impact, options.metadata);
  const policy = options.policy ?? readConfig(view).freshContext;
  if (!policy) {
    return {
      ok: false,
      mode: "required",
      manifest,
      impact,
      required: true,
      requirementReasons: ["Fresh-context policy is missing or invalid"],
      findings: [{
        code: "fresh-context-config-missing",
        message: "an explicit valid freshContext policy is required; missing configuration does not fall back to advisory",
        path: ".wiki/config.json",
        severity: "error",
      }],
    };
  }
  const requirement = evaluateFreshContextRequirement(policy, manifest, impact);
  if (!requirement.applies) {
    return {
      ok: true,
      mode: policy.mode,
      manifest,
      impact,
      required: false,
      requirementReasons: [],
      findings: [],
    };
  }
  // Conflict pointers are resolved against the open conflicts at the reviewed
  // HEAD, so a finding cannot be retired by naming a conflict that never
  // existed or one already resolved. Whether the candidate opened the conflict
  // or inherited it is the author-side `touched_conflicts` guard's job, so
  // `conflict_introduced` and `existing_conflict_linked` resolve identically
  // here.
  const checked = validateFreshContextAttestation({
    policy,
    manifest,
    report: options.report,
    reviewerActor: options.reviewerActor,
    prAuthor: options.prAuthor,
    conflicts: openConflicts(pages)
      .filter((page) => page.data.conflict_id != null && page.data.conflict_type != null && page.data.severity != null
        && page.data.origin != null && page.data.opened_at != null && page.data.resolution != null)
      .map(conflictSummary),
  });
  const severity: Finding["severity"] = policy.mode === "required" ? "error" : "warning";
  const mirror = options.metadata?.fresh_context;
  if (mirror && checked.report) {
    if (mirror.verdict !== checked.report.verdict) checked.findings.push({ code: "fresh-context-not-pass", message: `PR metadata fresh_context verdict ${mirror.verdict} does not mirror attested verdict ${checked.report.verdict}`, severity });
    if (mirror.reviewed_head_sha !== checked.report.reviewed_head_sha) checked.findings.push({ code: "fresh-context-head-stale", message: "PR metadata fresh_context reviewed_head_sha does not mirror the attested HEAD", severity });
    if (mirror.bundle_digest !== checked.report.bundle_digest) checked.findings.push({ code: "fresh-context-bundle-stale", message: "PR metadata fresh_context bundle_digest does not mirror the attested bundle", severity });
    if (normalizedActor(mirror.reviewer) !== normalizedActor(checked.report.reviewer)) checked.findings.push({ code: "fresh-context-reviewer-untrusted", message: "PR metadata fresh_context reviewer does not mirror the authenticated attestation reviewer", severity });
    if (jsonStable(mirror.evidence) !== jsonStable(checked.report.evidence)) checked.findings.push({ code: "fresh-context-evidence-missing", message: "PR metadata fresh_context evidence does not mirror the attested evidence", severity });
  }
  checked.ok = policy.mode === "advisory" || !checked.findings.some((item) => item.severity === "error");
  return {
    ...checked,
    manifest,
    impact,
    required: policy.mode === "required",
    requirementReasons: requirement.reasons,
  };
}

export function recursiveFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) result.push(...recursiveFiles(full));
    else result.push(full);
  }
  return result;
}
