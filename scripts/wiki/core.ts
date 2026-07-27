import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
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
  const markdown = view.listFiles().filter((path) => path.endsWith(".md") && !path.startsWith("node_modules/") && !path.startsWith(".git/"));
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
  lines.push("- [Open conflicts](./conflicts.md)", "- [Changelog](./changelog.md)", "");
  return `${lines.join("\n").trimEnd()}\n`;
}

export function generateCurrentStatus(pages: WikiPage[]): string {
  const lines = [GENERATED_HEADER, "", "# Current status", "", "| ID | Kind | Authority | Owner | Sources |", "|---|---|---|---|---:|"];
  for (const page of currentPages(pages)) lines.push(`| [${page.data.id}](./${page.path.slice("wiki/".length)}) | ${page.data.kind} | ${page.data.authority} | ${page.data.owners.join(", ")} | ${page.data.sources.length} |`);
  if (currentPages(pages).length === 0) lines.push("| — | — | — | — | 0 |");
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
    else if (path.endsWith(".md") && !content.startsWith(GENERATED_HEADER)) pushFinding(findings, path, "generated-header", "generated Markdown requires the do-not-edit header");
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
  const fallback: WikiConfig = { version: 1, name: "Project", highRisk: [] };
  if (!view.exists(".wiki/config.json")) return fallback;
  try {
    const raw = JSON.parse(view.read(".wiki/config.json")) as Record<string, unknown>;
    const freshContext = parseFreshContextPolicy(raw.freshContext);
    return {
      version: 1,
      name: typeof raw.name === "string" && raw.name.length > 0 ? raw.name : "Project",
      highRisk: Array.isArray(raw.highRisk) ? raw.highRisk.filter((item): item is string => typeof item === "string" && item.length > 0) : [],
      ...(freshContext ? { freshContext } : {}),
    };
  } catch {
    return fallback;
  }
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
    if (files.some(isImplementationSourceChange) && metadata.wiki_action === "none") findings.push({ code: "implementation-wiki-none", message: "implementation changes cannot use wiki_action: none", severity: "error" });
    const removedCurrentPaths = new Set(removedCurrentPages.map((page) => page.path));
    const changedCurrentDocs = files.filter((path) => removedCurrentPaths.has(path) || pages.some((page) => page.path === path && page.data.status === "current"));
    const implementationChanged = files.some(isImplementationSourceChange);
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
        if (head?.data.origin === "introduced_by_change" && head.data.severity === "high" && files.some(isImplementationSourceChange)) {
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

export function isImplementationSourceChange(path: string): boolean {
  if (path.endsWith(".md")) return false;
  if (path.startsWith("wiki/_generated/")) return false;
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

function reviewBundleFiles(view: RepoView, pages: WikiPage[], report: ImpactReport, metadata?: PrMetadata): Record<string, string> {
  const files: Record<string, string> = {};
  files["diff.patch"] = git(view.root, ["diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", `${report.mergeBase}..HEAD`], true);
  files["impact.json"] = jsonStable(canonicalImpactReport(report));
  files["pr-metadata.json"] = jsonStable(canonicalPrMetadata(metadata));
  for (const id of [...report.affectedPages].sort((a, b) => a.localeCompare(b))) {
    const page = pages.find((item) => item.data.id === id);
    if (page) files[`pages/${id.replaceAll("/", "_")}.md`] = page.raw;
  }
  for (const removed of [...report.removedCurrentPages].sort((a, b) => a.id.localeCompare(b.id))) {
    const baseRaw = git(view.root, ["show", `${report.mergeBase}:${removed.path}`], true);
    if (baseRaw) files[`pages/removed_${removed.id.replaceAll("/", "_")}.md`] = baseRaw;
  }
  const invariants = currentPages(pages).filter((page) => page.data.kind === "invariant");
  for (const page of invariants) files[`invariants/${page.data.id.replaceAll("/", "_")}.md`] = page.raw;
  for (const conflict of [...report.affectedConflicts].sort((a, b) => a.id.localeCompare(b.id))) {
    const page = pages.find((item) => item.data.kind === "conflict" && item.data.conflict_id === conflict.id);
    if (page) files[`conflicts/${conflict.id}.md`] = page.raw;
    else {
      const baseRaw = git(view.root, ["show", `${report.mergeBase}:${conflict.path}`], true);
      if (baseRaw) files[`conflicts/${conflict.id}.md`] = baseRaw;
    }
  }
  const affectedSources = Object.fromEntries([...report.affectedPages].sort((a, b) => a.localeCompare(b)).map((id) => {
    const page = pages.find((item) => item.data.id === id);
    return [id, page?.data.sources ?? []];
  }));
  files["sources.json"] = jsonStable({
    affectedPages: affectedSources,
    affectedConflicts: [...report.affectedConflicts].sort((a, b) => a.id.localeCompare(b.id)),
    removedCurrentPages: [...report.removedCurrentPages].sort((a, b) => a.id.localeCompare(b.id)),
    invariants: invariants.map((page) => page.data.id),
  });
  files["PROMPT.md"] = `# Fresh-context wiki reconciliation

Read \`manifest.json\`, \`impact.json\`, \`pr-metadata.json\`, \`diff.patch\`, \`pages/**\`, \`invariants/**\`, \`conflicts/**\`, and \`sources.json\`. Inspect the referenced repository primary sources directly. Verify current behavior, intent, invariants, conflict actions, acceptance criteria, and sources independently. Do not trust the author summary and do not resolve an open decision conflict without an explicit owner decision.

Report every discrepancy as a structured finding described by \`REPORT.md\`, and decide its disposition instead of assuming this candidate must fix it:

- A problem this candidate introduced, or a contract the PR itself declares, has to be fixed here. The engine enforces this: those classifications accept no deferring disposition.
- A mismatch that predates the candidate, an undecidable product intent, or a documentation disagreement may instead be tracked by an open conflict this candidate introduces or already links, with acceptance criteria.
- A real defect outside this change's semantic scope belongs in a named follow-up, not in this diff.

Classify by what you actually found. \`REPORT.md\` lists which dispositions each classification admits, and the engine rejects a pair outside that table, so a classification chosen to widen your deferral options fails the report rather than passing it.

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

A disposition naming a conflict must name one that is open at the reviewed HEAD, carries the conflict type its classification implies, declares \`origin: baseline\` whenever the classification says the problem predates this candidate, and lists at least one of the finding's \`page:\` scope refs among its affected pages. The author writes that \`origin\` and you write the classification independently; the engine only requires that the two agree.

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

export function buildReviewManifest(view: RepoView, pages: WikiPage[], report: ImpactReport, metadata?: PrMetadata): ReviewManifest {
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
  };
  return { ...core, bundle_digest: hashContent(jsonStable(core)) };
}

export function makeReviewBundle(view: RepoView, pages: WikiPage[], report: ImpactReport, output?: string, metadata?: PrMetadata): string {
  const directory = output ? resolve(view.root, output) : mkdtempSync(join(tmpdir(), "wiki-review-"));
  const files = { ...reviewBundleFiles(view, pages, report, metadata), "manifest.json": jsonStable(buildReviewManifest(view, pages, report, metadata)) };
  for (const [path, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    Bun.spawnSync(["mkdir", "-p", dirname(join(directory, path))]);
    writeFileSync(join(directory, path), content);
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
 * says the same thing. Disagreement means one of the two is misreporting who
 * caused the break, and `conflict-introduced-high-risk` — which keys on
 * `origin: introduced_by_change` — is only load-bearing while they agree.
 */
const FRESH_CONTEXT_PREEXISTING_CLASSIFICATIONS = new Set<FreshContextClassification>([
  "preexisting_implementation_mismatch",
  "decision_ambiguity",
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
 * When `conflicts` is supplied it also adjudicates the disposition: whether the
 * classification may be retired that way at all, and — for a disposition that
 * points at a conflict — whether that conflict actually exists and makes the
 * same claim the finding does. Omitting `conflicts` keeps the historical
 * shape-only behaviour for callers that hold no repository view; `reviewCheck`
 * always supplies the open conflicts at HEAD, so an empty array correctly means
 * every conflict pointer is dangling.
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

    const scopedPages = nonEmptyStrings(item.scope_refs)
      ? item.scope_refs.filter((ref) => ref.startsWith("page:")).map((ref) => ref.slice("page:".length).trim()).filter((ref) => ref.length > 0)
      : [];
    if (scopedPages.length > 0 && conflict.affectedPages.length > 0 && !scopedPages.some((id) => conflict.affectedPages.includes(id))) {
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
  // HEAD, so a finding cannot be retired by naming a conflict the candidate
  // never opened, one already resolved, or one that never existed.
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
