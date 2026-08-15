import { expandSource, git, type RepoView } from "./repository-view";
import { isContentPage, parseWikiPage } from "./page-validation";
import type { Finding, WikiPage, WikiSource } from "./model";
import { buildConflictMap, buildSourceMap } from "./generated-views";
import { kitOwnedChangedFiles, resolveDiffBase, changedFiles } from "./impact";
import { mappedConflicts, mappedPages, readConfig } from "./verification";
import { hashContent, jsonStable } from "./serialization";

export type ScopeSourceSet = {
  count: number;
  bytes: number;
  digest: string;
};

export type ScopeCatalogSet = ScopeSourceSet & {
  declaration: WikiSource;
  declared_by: string[];
  expand_command: string;
};

export type ScopePageSummary = {
  id: string;
  path: string;
  mandatory: ScopeSourceSet;
  catalog: ScopeCatalogSet[];
};

export type ScopeGlobBreadth = ScopeCatalogSet & {
  page_id: string;
  reverse_pages: string[];
  reverse_invariants: string[];
  reverse_conflicts: string[];
};

export type ScopeReverseFanout = {
  declaration: WikiSource;
  pages: string[];
  invariants: string[];
  conflicts: string[];
};

export type ScopeCausalPath = {
  path: string;
  pages: string[];
  invariants: string[];
  conflicts: string[];
  source_bindings: { page_id: string; declaration: WikiSource }[];
  source_declarations: WikiSource[];
  review_reasons: string[];
  kit_owned: boolean;
};

export type ScopeReviewSurfaceGroup = {
  selector: "changed-file-rule" | "changed-kit-owned-files" | "affected-invariants" | "affected-conflicts" | "removed-current-pages";
  key: string;
  reason?: string;
  potential_file_count: number;
  potential_page_count: number;
  potential_invariant_count: number;
  potential_conflict_count: number;
  aggregate_digest: string;
};

export type ScopePotentialReview = {
  tracked_file_count: number;
  selected_file_count: number;
  selected_ratio: number;
  selected_digest: string;
};

export type ScopeBaseDelta = {
  added_pages: string[];
  removed_pages: string[];
  changed_declarations: string[];
  mandatory_count_delta: number;
  catalog_count_delta: number;
  catalog_bytes_delta: number;
};

export type ScopeReport = {
  version: 1;
  base: string;
  merge_base: string;
  head: string;
  changed_files: string[];
  pages: ScopePageSummary[];
  glob_breadth: ScopeGlobBreadth[];
  reverse_fanout: ScopeReverseFanout[];
  causal_paths: ScopeCausalPath[];
  potential_review_surface: ScopeReviewSurfaceGroup[];
  potential_review: ScopePotentialReview;
  base_delta: ScopeBaseDelta;
  findings: Finding[];
};

type RevisionPage = WikiPage;

function lexical(a: string, b: string): number {
  return a.localeCompare(b);
}

function sourceContext(source: WikiSource): "always" | "catalog" {
  return source.context ?? "always";
}

function canonicalSource(source: WikiSource): WikiSource {
  return "path" in source
    ? {
      path: source.path,
      ...(source.symbols ? { symbols: [...source.symbols].sort(lexical) } : {}),
      ...(source.context ? { context: source.context } : {}),
      ...(source.reason ? { reason: source.reason } : {}),
    }
    : {
      glob: source.glob,
      ...(source.context ? { context: source.context } : {}),
      ...(source.reason ? { reason: source.reason } : {}),
    };
}

function filesDigest(view: RepoView, paths: string[]): ScopeSourceSet {
  const sorted = [...new Set(paths)].sort(lexical);
  const records = sorted.map((path) => [path, hashContent(view.read(path))]);
  return {
    count: sorted.length,
    bytes: sorted.reduce((total, path) => total + Buffer.byteLength(view.read(path), "utf8"), 0),
    digest: hashContent(jsonStable(records)),
  };
}

function sourceSetForPage(view: RepoView, page: WikiPage): ScopePageSummary {
  const mandatory = page.data.sources
    .filter((source) => sourceContext(source) === "always")
    .flatMap((source) => expandSource(view, source));
  const catalog = page.data.sources
    .filter((source) => sourceContext(source) === "catalog")
    .map((source) => {
      const files = expandSource(view, source);
      return {
        ...filesDigest(view, files),
        declaration: canonicalSource(source),
        declared_by: [page.data.id],
        expand_command: `bun run wiki:context -- --page ${page.data.id} --full`,
      };
    })
    .sort((a, b) => jsonStable(a.declaration).localeCompare(jsonStable(b.declaration)));
  return {
    id: page.data.id,
    path: page.path,
    mandatory: filesDigest(view, mandatory),
    catalog,
  };
}

function revisionFiles(root: string, revision: string): string[] {
  return git(root, ["ls-tree", "-r", "--name-only", revision], true).split("\n").filter(Boolean).sort(lexical);
}

function revisionPage(root: string, revision: string, path: string): RevisionPage | undefined {
  const raw = git(root, ["show", `${revision}:${path}`], true);
  if (!raw) return undefined;
  try { return parseWikiPage(path, raw); } catch { return undefined; }
}

function revisionExpand(root: string, revision: string, source: WikiSource, files: string[]): string[] {
  if ("path" in source) return files.includes(source.path) ? [source.path] : [];
  let glob: Bun.Glob;
  try { glob = new Bun.Glob(source.glob); } catch { return []; }
  return files.filter((path) => glob.match(path)).sort(lexical);
}

function revisionRead(root: string, revision: string, path: string): string {
  return git(root, ["show", `${revision}:${path}`], true);
}

function revisionPageSummary(root: string, revision: string, files: string[], page: WikiPage): ScopePageSummary {
  const mandatory = page.data.sources
    .filter((source) => sourceContext(source) === "always")
    .flatMap((source) => revisionExpand(root, revision, source, files));
  const catalog = page.data.sources
    .filter((source) => sourceContext(source) === "catalog")
    .map((source) => {
      const matched = revisionExpand(root, revision, source, files);
      const records = matched.map((path) => [path, hashContent(revisionRead(root, revision, path))]);
      return {
        count: matched.length,
        bytes: matched.reduce((total, path) => total + Buffer.byteLength(revisionRead(root, revision, path), "utf8"), 0),
        digest: hashContent(jsonStable(records)),
        declaration: canonicalSource(source),
        declared_by: [page.data.id],
        expand_command: `bun run wiki:context -- --page ${page.data.id} --full`,
      };
    })
    .sort((a, b) => jsonStable(a.declaration).localeCompare(jsonStable(b.declaration)));
  const mandatoryRecords = [...new Set(mandatory)].sort(lexical).map((path) => [path, hashContent(revisionRead(root, revision, path))]);
  return {
    id: page.data.id,
    path: page.path,
    mandatory: {
      count: mandatoryRecords.length,
      bytes: [...new Set(mandatory)].reduce((total, path) => total + Buffer.byteLength(revisionRead(root, revision, path), "utf8"), 0),
      digest: hashContent(jsonStable(mandatoryRecords)),
    },
    catalog,
  };
}

function declarationKey(source: WikiSource): string {
  return jsonStable(canonicalSource(source));
}

function declarationStructuralKey(source: WikiSource): string {
  return "path" in source
    ? jsonStable({ path: source.path, ...(source.symbols ? { symbols: [...source.symbols].sort(lexical) } : {}) })
    : jsonStable({ glob: source.glob });
}

function changedDeclarationFindings(
  root: string,
  mergeBase: string,
  pages: WikiPage[],
  basePages: WikiPage[],
): Finding[] {
  const findings: Finding[] = [];
  const baseById = new Map(basePages.map((page) => [page.data.id, page]));
  const legacyRecords: { page: string; declaration: WikiSource }[] = [];
  for (const page of pages) {
    const base = baseById.get(page.data.id);
    const baseByStructural = new Map((base?.data.sources ?? []).map((source) => [declarationStructuralKey(source), source]));
    const legacy: WikiSource[] = [];
    for (const source of page.data.sources) {
      if (source.context != null) continue;
      const prior = baseByStructural.get(declarationStructuralKey(source));
      const unchangedLegacy = prior != null && prior.context == null;
      if (unchangedLegacy) legacy.push(source);
      else findings.push({
        code: "source-context-required",
        message: `new or changed source declaration must declare context (${"path" in source ? source.path : source.glob}): ${page.data.id}`,
        path: page.path,
        severity: "error",
      });
    }
    for (const declaration of legacy) legacyRecords.push({ page: page.data.id, declaration: canonicalSource(declaration) });
  }
  if (legacyRecords.length > 0) findings.push({
    code: "source-context-legacy",
    message: `legacy source declarations omit context and remain compatible as always (${legacyRecords.length} declarations across ${new Set(legacyRecords.map((item) => item.page)).size} pages; digest ${hashContent(jsonStable(legacyRecords.map((item) => ({ page: item.page, declaration: item.declaration })).sort((a, b) => a.page.localeCompare(b.page) || jsonStable(a.declaration).localeCompare(jsonStable(b.declaration)))))}; migration is optional)`,
    path: "wiki",
    severity: "warning",
  });
  // Keep the merge-base argument in the function contract so callers can
  // diagnose a missing base consistently; the comparison itself is by page ID.
  void root;
  void mergeBase;
  return findings;
}

function changedDeclarationPages(root: string, mergeBase: string, pages: WikiPage[]): WikiPage[] {
  const basePages = revisionFiles(root, mergeBase).filter(isContentPage).flatMap((path) => {
    const page = revisionPage(root, mergeBase, path);
    return page ? [page] : [];
  });
  const baseById = new Map(basePages.map((page) => [page.data.id, page]));
  return pages.filter((page) => {
    const base = baseById.get(page.data.id);
    return !base || jsonStable(page.data.sources.map(canonicalSource).sort((a, b) => jsonStable(a).localeCompare(jsonStable(b))))
      !== jsonStable(base.data.sources.map(canonicalSource).sort((a, b) => jsonStable(a).localeCompare(jsonStable(b))));
  });
}

function aggregateDigest(paths: string[]): string {
  return hashContent(jsonStable([...new Set(paths)].sort(lexical)));
}

function reviewSurface(
  view: RepoView,
  pages: WikiPage[],
  changed: string[],
  basePages: WikiPage[],
): { groups: ScopeReviewSurfaceGroup[]; selectedPaths: Set<string> } {
  const config = readConfig(view);
  if (config.version !== 2) return { groups: [], selectedPaths: new Set() };
  const sourceMap = buildSourceMap(pages);
  const conflictMap = buildConflictMap([...basePages, ...pages]);
  const allFiles = view.listFiles();
  const groups: ScopeReviewSurfaceGroup[] = [];
  const selectedPaths = new Set<string>();
  for (const rule of config.review.when.changedFileRules) {
    const glob = new Bun.Glob(rule.glob);
    const paths = allFiles.filter((path) => glob.match(path));
    for (const path of paths) selectedPaths.add(path);
    groups.push({
      selector: "changed-file-rule",
      key: rule.glob,
      reason: rule.reason,
      potential_file_count: paths.length,
      potential_page_count: new Set(paths.flatMap((path) => mappedPages(sourceMap, path))).size,
      potential_invariant_count: new Set(paths.flatMap((path) => mappedPages(sourceMap, path)).filter((id) => pages.find((page) => page.data.id === id)?.data.kind === "invariant")).size,
      potential_conflict_count: new Set(paths.flatMap((path) => mappedConflicts(conflictMap, path))).size,
      aggregate_digest: aggregateDigest(paths),
    });
  }
  if (config.review.when.changedKitOwnedFiles) {
    const paths = kitOwnedChangedFiles(view, allFiles);
    for (const path of paths) selectedPaths.add(path);
    groups.push({
      selector: "changed-kit-owned-files",
      key: "kit-owned",
      potential_file_count: paths.length,
      potential_page_count: new Set(paths.flatMap((path) => mappedPages(sourceMap, path))).size,
      potential_invariant_count: new Set(paths.flatMap((path) => mappedPages(sourceMap, path)).filter((id) => pages.find((page) => page.data.id === id)?.data.kind === "invariant")).size,
      potential_conflict_count: new Set(paths.flatMap((path) => mappedConflicts(conflictMap, path))).size,
      aggregate_digest: aggregateDigest(paths),
    });
  }
  const groupedSources = (kind: "invariant" | "conflict"): string[] => pages
    .filter((page) => page.data.kind === kind && page.data.status === (kind === "conflict" ? "conflicted" : "current"))
    .flatMap((page) => page.data.sources.flatMap((source) => expandSource(view, source)));
  if (config.review.when.affectedInvariants) {
    const paths = groupedSources("invariant");
    for (const path of paths) selectedPaths.add(path);
    groups.push({ selector: "affected-invariants", key: "current-invariants", potential_file_count: new Set(paths).size, potential_page_count: pages.filter((page) => page.data.kind === "invariant" && page.data.status === "current").length, potential_invariant_count: pages.filter((page) => page.data.kind === "invariant" && page.data.status === "current").length, potential_conflict_count: 0, aggregate_digest: aggregateDigest(paths) });
  }
  if (config.review.when.affectedConflicts) {
    const paths = groupedSources("conflict");
    for (const path of paths) selectedPaths.add(path);
    groups.push({ selector: "affected-conflicts", key: "open-conflicts", potential_file_count: new Set(paths).size, potential_page_count: pages.filter((page) => page.data.kind === "conflict" && page.data.status === "conflicted").length, potential_invariant_count: new Set(pages.filter((page) => page.data.kind === "conflict" && page.data.status === "conflicted").flatMap((page) => page.data.affected_invariants ?? [])).size, potential_conflict_count: pages.filter((page) => page.data.kind === "conflict" && page.data.status === "conflicted").length, aggregate_digest: aggregateDigest(paths) });
  }
  if (config.review.when.removedCurrentPages) {
    // The potential selector surface is the set of current pages that could be
    // removed by a one-file change, not only pages removed by this candidate.
    const removable = pages.filter((page) => page.data.status === "current");
    for (const page of removable) selectedPaths.add(page.path);
    groups.push({ selector: "removed-current-pages", key: "current-pages", potential_file_count: removable.length, potential_page_count: removable.length, potential_invariant_count: removable.filter((page) => page.data.kind === "invariant").length, potential_conflict_count: removable.filter((page) => page.data.kind === "conflict").length, aggregate_digest: aggregateDigest(removable.map((page) => page.path)) });
  }
  void changed;
  return { groups: groups.sort((a, b) => a.selector.localeCompare(b.selector) || a.key.localeCompare(b.key)), selectedPaths };
}

export function scopeReport(view: RepoView, pages: WikiPage[], options: { base?: string } = {}): ScopeReport {
  const base = resolveDiffBase(view.root, options.base);
  const mergeBase = git(view.root, ["merge-base", base, "HEAD"]).trim();
  const head = git(view.root, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  const changed = changedFiles(view.root, base);
  const baseFiles = revisionFiles(view.root, mergeBase);
  const basePages = baseFiles.filter(isContentPage).flatMap((path) => {
    const page = revisionPage(view.root, mergeBase, path);
    return page ? [page] : [];
  });
  const pageSummaries = pages
    .filter((page) => page.data.status === "current" || page.data.kind === "conflict")
    .map((page) => sourceSetForPage(view, page))
    .sort((a, b) => a.id.localeCompare(b.id));
  const sourceMap = buildSourceMap(pages);
  const conflictMap = buildConflictMap([...basePages, ...pages]);
  const breadth: ScopeGlobBreadth[] = [];
  const reverse = new Map<string, { declaration: WikiSource; pages: Set<string>; invariants: Set<string>; conflicts: Set<string> }>();
  for (const page of pages) {
    if (page.data.status !== "current" && page.data.kind !== "conflict") continue;
    for (const source of page.data.sources) {
      const key = declarationKey(source);
      const entry = reverse.get(key) ?? { declaration: canonicalSource(source), pages: new Set<string>(), invariants: new Set<string>(), conflicts: new Set<string>() };
      entry.pages.add(page.data.id);
      if (page.data.kind === "invariant") entry.invariants.add(page.data.id);
      if (page.data.kind === "conflict") entry.conflicts.add(page.data.conflict_id ?? page.data.id);
      reverse.set(key, entry);
      if ("glob" in source) {
        const files = expandSource(view, source);
        const set = filesDigest(view, files);
        const reversePages = new Set<string>();
        const reverseInvariants = new Set<string>();
        const reverseConflicts = new Set<string>();
        for (const path of files) {
          for (const id of mappedPages(sourceMap, path)) {
            reversePages.add(id);
            if (pages.find((candidate) => candidate.data.id === id)?.data.kind === "invariant") reverseInvariants.add(id);
          }
          for (const id of mappedConflicts(conflictMap, path)) reverseConflicts.add(id);
        }
        breadth.push({
          ...set,
          declaration: canonicalSource(source),
          declared_by: [page.data.id],
          expand_command: `bun run wiki:context -- --page ${page.data.id} --full`,
          page_id: page.data.id,
          reverse_pages: [...reversePages].sort(lexical),
          reverse_invariants: [...reverseInvariants].sort(lexical),
          reverse_conflicts: [...reverseConflicts].sort(lexical),
        });
      }
    }
  }
  const basePagesByPath = new Map(basePages.map((page) => [page.path, page]));
  const causalPaths: ScopeCausalPath[] = changed.map((path) => {
    const pageIds = new Set<string>(mappedPages(sourceMap, path));
    const sourceDeclarations: WikiSource[] = [];
    const sourceBindings: { page_id: string; declaration: WikiSource }[] = [];
    for (const page of pages) {
      for (const source of page.data.sources) {
        if (expandSource(view, source).includes(path)) {
          pageIds.add(page.data.id);
          sourceDeclarations.push(canonicalSource(source));
          sourceBindings.push({ page_id: page.data.id, declaration: canonicalSource(source) });
        }
      }
    }
    // A deleted current page is absent from HEAD mappings.  Preserve its
    // merge-base authority/source path so the causal chain remains visible.
    const removed = basePagesByPath.get(path);
    if (removed && removed.data.status === "current" && !pages.some((page) => page.data.id === removed.data.id)) {
      pageIds.add(removed.data.id);
      for (const source of removed.data.sources) {
        if (revisionExpand(view.root, mergeBase, source, baseFiles).includes(path)) {
          const declaration = canonicalSource(source);
          sourceDeclarations.push(declaration);
          sourceBindings.push({ page_id: removed.data.id, declaration });
        }
      }
    }
    const conflictIds = new Set(mappedConflicts(conflictMap, path));
    const invariantIds = new Set([...pageIds].filter((id) => pages.find((page) => page.data.id === id)?.data.kind === "invariant"));
    if (removed?.data.kind === "invariant") invariantIds.add(removed.data.id);
    const reviewReasons = configReasons(view, path);
    const config = readConfig(view);
    if (config.version === 2) {
      if (config.review.when.changedKitOwnedFiles && kitOwnedChangedFiles(view, [path]).length > 0) reviewReasons.push("changedKitOwnedFiles selects kit-owned files");
      if (config.review.when.affectedInvariants && invariantIds.size > 0) reviewReasons.push("affectedInvariants selects mapped invariants");
      if (config.review.when.affectedConflicts && conflictIds.size > 0) reviewReasons.push("affectedConflicts selects mapped conflicts");
      if (config.review.when.removedCurrentPages && removed?.data.status === "current" && !pages.some((page) => page.data.id === removed.data.id)) reviewReasons.push("removedCurrentPages selects removed current pages");
    }
    return {
      path,
      pages: [...pageIds].sort(lexical),
      invariants: [...invariantIds].sort(lexical),
      conflicts: [...conflictIds].sort(lexical),
      source_bindings: sourceBindings.sort((a, b) => a.page_id.localeCompare(b.page_id) || jsonStable(a.declaration).localeCompare(jsonStable(b.declaration))),
      source_declarations: sourceDeclarations.sort((a, b) => jsonStable(a).localeCompare(jsonStable(b))),
      review_reasons: [...new Set(reviewReasons)].sort(lexical),
      kit_owned: kitOwnedChangedFiles(view, [path]).length > 0,
    };
  });
  const changedPages = changedDeclarationPages(view.root, mergeBase, pages);
  // Validate unchanged legacy omissions as warnings too, while only newly
  // added/changed declarations become errors in `changedDeclarationFindings`.
  const findings = changedDeclarationFindings(view.root, mergeBase, pages, basePages);
  const baseSummary = new Map(basePages
    .filter((page) => page.data.status === "current" || page.data.kind === "conflict")
    .map((page) => [page.data.id, revisionPageSummary(view.root, mergeBase, baseFiles, page)]));
  const currentSummary = new Map(pageSummaries.map((page) => [page.id, page]));
  const addedPages = [...currentSummary.keys()].filter((id) => !baseSummary.has(id)).sort(lexical);
  const removedPages = [...baseSummary.keys()].filter((id) => !currentSummary.has(id)).sort(lexical);
  const changedDeclarations = changedPages.map((page) => page.data.id).sort(lexical);
  const mandatoryCount = [...currentSummary.values()].reduce((sum, page) => sum + page.mandatory.count, 0);
  const baseMandatoryCount = [...baseSummary.values()].reduce((sum, page) => sum + page.mandatory.count, 0);
  const catalogCount = [...currentSummary.values()].reduce((sum, page) => sum + page.catalog.reduce((inner, item) => inner + item.count, 0), 0);
  const baseCatalogCount = [...baseSummary.values()].reduce((sum, page) => sum + page.catalog.reduce((inner, item) => inner + item.count, 0), 0);
  const catalogBytes = [...currentSummary.values()].reduce((sum, page) => sum + page.catalog.reduce((inner, item) => inner + item.bytes, 0), 0);
  const baseCatalogBytes = [...baseSummary.values()].reduce((sum, page) => sum + page.catalog.reduce((inner, item) => inner + item.bytes, 0), 0);
  const review = reviewSurface(view, pages, changed, basePages);
  const selectedPaths = [...review.selectedPaths].sort(lexical);
  const report: ScopeReport = {
    version: 1,
    base,
    merge_base: mergeBase,
    head,
    changed_files: changed,
    pages: pageSummaries,
    glob_breadth: breadth.sort((a, b) => a.page_id.localeCompare(b.page_id) || jsonStable(a.declaration).localeCompare(jsonStable(b.declaration))),
    reverse_fanout: [...reverse.values()].map((item) => ({ declaration: item.declaration, pages: [...item.pages].sort(lexical), invariants: [...item.invariants].sort(lexical), conflicts: [...item.conflicts].sort(lexical) })).sort((a, b) => jsonStable(a.declaration).localeCompare(jsonStable(b.declaration))),
    causal_paths: causalPaths,
    potential_review_surface: review.groups,
    potential_review: {
      tracked_file_count: view.listFiles().length,
      selected_file_count: selectedPaths.length,
      selected_ratio: view.listFiles().length === 0 ? 0 : Number((selectedPaths.length / view.listFiles().length).toFixed(6)),
      selected_digest: aggregateDigest(selectedPaths),
    },
    base_delta: {
      added_pages: addedPages,
      removed_pages: removedPages,
      changed_declarations: changedDeclarations,
      mandatory_count_delta: mandatoryCount - baseMandatoryCount,
      catalog_count_delta: catalogCount - baseCatalogCount,
      catalog_bytes_delta: catalogBytes - baseCatalogBytes,
    },
    findings,
  };
  return report;
}

function configReasons(view: RepoView, path: string): string[] {
  const config = readConfig(view);
  if (config.version !== 2) return [];
  return config.review.when.changedFileRules.filter((rule) => new Bun.Glob(rule.glob).match(path)).map((rule) => rule.reason).sort(lexical);
}

export function scopeText(report: ScopeReport): string {
  const lines = [
    `Scope ${report.head} against ${report.base} (merge-base ${report.merge_base})`,
    `Changed files: ${report.changed_files.length}`,
    `Pages: ${report.pages.length}; glob declarations: ${report.glob_breadth.length}; causal paths: ${report.causal_paths.length}`,
    `Potential review groups: ${report.potential_review_surface.length}; selected ${report.potential_review.selected_file_count}/${report.potential_review.tracked_file_count} (${report.potential_review.selected_ratio})`,
    `Base delta: pages +${report.base_delta.added_pages.length}/-${report.base_delta.removed_pages.length}; declarations ${report.base_delta.changed_declarations.length}; mandatory ${report.base_delta.mandatory_count_delta >= 0 ? "+" : ""}${report.base_delta.mandatory_count_delta}; catalog ${report.base_delta.catalog_count_delta >= 0 ? "+" : ""}${report.base_delta.catalog_count_delta} files / ${report.base_delta.catalog_bytes_delta >= 0 ? "+" : ""}${report.base_delta.catalog_bytes_delta} bytes`,
  ];
  if (report.findings.length > 0) lines.push("", "Findings:", ...report.findings.map((item) => `${item.severity.toUpperCase()} [${item.code}] ${item.path ? `${item.path}: ` : ""}${item.message}`));
  return lines.join("\n");
}
