import { dirname, extname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import ts from "typescript";
import type { Finding, WikiAuthority, WikiFrontmatter, WikiPage, WikiSource, WikiStatus, ConflictOrigin, ConflictResolutionState, ConflictSeverity, ConflictType } from "./model";
import { normalizeRepoPath, type RepoView } from "./repository-view";
import { validateWorkItems } from "./work-validation";

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

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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

export type MarkdownLinkPolicy = {
  publishesKit?: boolean;
  isManagedPath?: (path: string) => boolean;
  /** Backwards-compatible descriptive alias for callers naming the kit rule. */
  isKitManagedPath?: (path: string) => boolean;
};

export function validateMarkdownLinks(view: RepoView, policy: MarkdownLinkPolicy = {}): Finding[] {
  const { entries, findings } = loadLegacyAllowlist(view);
  // Generated kit payload is staged for another repository: its relative links
  // resolve once the payload lands at that repository's root, not against this
  // tree. Only the publisher gets that exemption, and `kit/README.md` never does
  // — it is hand-written, it lives here, and its links resolve here.
  const managedPath = policy.isManagedPath ?? policy.isKitManagedPath;
  const markdown = view.listFiles().filter((path) => path.endsWith(".md") && !path.startsWith("node_modules/") && !path.startsWith(".git/") && !(policy.publishesKit && managedPath?.(path)));
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
