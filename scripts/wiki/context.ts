import { expandSource, type RepoView } from "./repository-view";
import { hashContent } from "./serialization";
import type { WikiAuthority, WikiPage, WikiSource, WikiStatus } from "./model";
import {
  conflictSummary,
  currentPages,
  openConflicts,
  searchWikiPages,
  type ConflictSummary,
  type WikiSearchMatch,
  type WorkQueueItem,
} from "./discovery";

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
 * Project an exhaustive selected-work model for ordinary discovery. Passing
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
