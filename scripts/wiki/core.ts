import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import {
  createRepoView,
  expandSource,
  git,
  normalizeRepoPath,
  type RepoView,
} from "./repository-view";
import type {
  ConflictOrigin,
  ConflictResolution,
  ConflictResolutionState,
  ConflictSeverity,
  ConflictType,
  Finding,
  WikiAuthority,
  WikiFrontmatter,
  WikiPage,
  WikiSource,
  WikiStatus,
  WorkExecutor,
  WorkItem,
  WorkPriority,
  WorkState,
} from "./model";
import { isConflictGuardFinding } from "./model";
import { validateWorkItems } from "./work-validation";
import {
  isContentPage,
  loadWikiPages,
  parseWikiPage,
  validateMarkdownLinks as validateMarkdownLinksFoundation,
  validatePages,
  WIKI_SYSTEM_FILES,
  type MarkdownLinkPolicy,
} from "./page-validation";
import { hashContent, jsonStable } from "./serialization";
import {
  buildWorkQueue,
  conflictSummary,
  currentPages,
  openConflicts,
  projectWorkQueue,
  searchWikiPages,
} from "./discovery";
import type {
  ConflictSummary,
  WikiSearchMatch,
  WorkExecutorFilter,
  WorkQueue,
  WorkQueueGroups,
  WorkQueueItem,
  WorkQueueState,
} from "./discovery";
import {
  buildCompactTopicCandidateContext,
  buildPageContext,
  buildSelectedWorkContext,
  buildTopicContext,
  projectSelectedWorkContext,
  projectTopicContext,
} from "./context";
import type {
  CompactContextConflict,
  CompactContextPage,
  CompactSelectedWorkContext,
  CompactTopicContext,
  ContextSourceGlob,
  SelectedWorkContext,
  SelectedWorkContextConflict,
  SelectedWorkContextPage,
  SelectedWorkContextReadEntry,
  SelectedWorkContextSourceSummary,
  TopicContext,
  TopicContextCandidate,
} from "./context";
import {
  GENERATED_HEADER,
  buildConflictMap,
  buildSourceMap,
  generateConflictsIndex,
  generateCurrentStatus,
  generateIndex,
  generateWorkQueue,
  generatedCoreFiles,
} from "./generated-views";
import type { ConflictMap, SourceMap } from "./generated-views";
import {
  KIT_ENTRIES,
  KIT_EXCLUDE_END,
  KIT_EXCLUDE_START,
  KIT_MANIFEST_TARGET,
  KIT_ROOT,
  compareKit,
  isKitManagedPath,
  kitFiles,
  kitPath,
  stripKitExclusions,
  writeKit,
} from "./kit-packaging";
import type { KitEntry, KitOwnership, KitPlacement } from "./kit-packaging";
import {
  mappedConflicts,
  sourceHashes,
  readState,
  verifyState,
  validateState,
  validateIntegrationSeams,
  isHighRisk,
  validateCoverage,
  mappedPages,
  parseFreshContextPolicy,
  readConfig,
  UsageError,
} from "./verification";
import type {
  FreshContextMode,
  FreshContextRequiredWhen,
  FreshContextTrustPolicy,
  FreshContextPolicy,
  StateAudit,
  WikiConfig,
  WikiState,
} from "./verification";
import {
  changedFiles,
  resolveDiffBase,
  parsePrMetadata,
  validatePrMetadata,
  impactReport,
  isImplementationSourceChange,
  evaluateFreshContextRequirement,
  canonicalPrMetadata,
} from "./impact";
import type {
  ImpactReport,
  PrMetadata,
  FreshContextRequirement,
} from "./impact";
import {
  buildFocusedReviewManifest,
  validateFocusedReviewManifest,
  validateReviewBundleBindings,
  buildReviewManifest,
  makeReviewBundle,
  recursiveFiles,
} from "./review-bundle";
import type {
  ReviewManifest,
  FocusedBodyRole,
  FocusedSourceRole,
  FocusedBodyBinding,
  FocusedBodyObject,
  FocusedSourceDeclaration,
  FocusedSourceBinding,
  FocusedReviewManifest,
} from "./review-bundle";
import {
  validateFreshContextFindings,
  validateFreshContextAttestation,
  parseFreshContextReport,
  reviewCheck,
} from "./review-attestation";
import type {
  FreshContextVerdict,
  FreshContextClassification,
  FreshContextDisposition,
  FreshContextAuthorityKind,
  FreshContextFinding,
  FreshContextReportV1,
  FreshContextReportV2,
  FreshContextReport,
  FreshContextCheckResult,
  ReviewCheckResult,
} from "./review-attestation";

export {
  createRepoView,
  expandSource,
  normalizeRepoPath,
  isConflictGuardFinding,
  isContentPage,
  loadWikiPages,
  parseWikiPage,
  validatePages,
  WIKI_SYSTEM_FILES,
  validateWorkItems,
  hashContent,
  jsonStable,
};
export type {
  RepoView,
  ConflictOrigin,
  ConflictResolution,
  ConflictResolutionState,
  ConflictSeverity,
  ConflictType,
  Finding,
  WikiAuthority,
  WikiFrontmatter,
  WikiPage,
  WikiSource,
  WikiStatus,
  WorkExecutor,
  WorkItem,
  WorkPriority,
  WorkState,
};
export {
  buildWorkQueue,
  conflictSummary,
  currentPages,
  openConflicts,
  projectWorkQueue,
  searchWikiPages,
};
export type {
  ConflictSummary,
  WikiSearchMatch,
  WorkExecutorFilter,
  WorkQueue,
  WorkQueueGroups,
  WorkQueueItem,
  WorkQueueState,
};
export {
  buildCompactTopicCandidateContext,
  buildPageContext,
  buildSelectedWorkContext,
  buildTopicContext,
  projectSelectedWorkContext,
  projectTopicContext,
};
export type {
  CompactContextConflict,
  CompactContextPage,
  CompactSelectedWorkContext,
  CompactTopicContext,
  ContextSourceGlob,
  SelectedWorkContext,
  SelectedWorkContextConflict,
  SelectedWorkContextPage,
  SelectedWorkContextReadEntry,
  SelectedWorkContextSourceSummary,
  TopicContext,
  TopicContextCandidate,
};
export {
  GENERATED_HEADER,
  buildConflictMap,
  buildSourceMap,
  generateConflictsIndex,
  generateCurrentStatus,
  generateIndex,
  generateWorkQueue,
  generatedCoreFiles,
};
export type { ConflictMap, SourceMap };
export {
  KIT_ENTRIES,
  KIT_EXCLUDE_END,
  KIT_EXCLUDE_START,
  KIT_MANIFEST_TARGET,
  KIT_ROOT,
  compareKit,
  isKitManagedPath,
  kitFiles,
  kitPath,
  stripKitExclusions,
  writeKit,
};
export type { KitEntry, KitOwnership, KitPlacement };

export {
  mappedConflicts,
  sourceHashes,
  readState,
  verifyState,
  validateState,
  validateIntegrationSeams,
  isHighRisk,
  validateCoverage,
  mappedPages,
  parseFreshContextPolicy,
  readConfig,
  UsageError,
};
export type {
  FreshContextMode,
  FreshContextRequiredWhen,
  FreshContextTrustPolicy,
  FreshContextPolicy,
  StateAudit,
  WikiConfig,
  WikiState,
};
export {
  changedFiles,
  resolveDiffBase,
  parsePrMetadata,
  validatePrMetadata,
  impactReport,
  isImplementationSourceChange,
  evaluateFreshContextRequirement,
};
export type { ImpactReport, PrMetadata, FreshContextRequirement };
export {
  buildFocusedReviewManifest,
  validateFocusedReviewManifest,
  validateReviewBundleBindings,
  buildReviewManifest,
  makeReviewBundle,
  recursiveFiles,
};
export type {
  ReviewManifest,
  FocusedBodyRole,
  FocusedSourceRole,
  FocusedBodyBinding,
  FocusedBodyObject,
  FocusedSourceDeclaration,
  FocusedSourceBinding,
  FocusedReviewManifest,
};
export {
  validateFreshContextFindings,
  validateFreshContextAttestation,
  parseFreshContextReport,
  reviewCheck,
};
export type {
  FreshContextVerdict,
  FreshContextClassification,
  FreshContextDisposition,
  FreshContextAuthorityKind,
  FreshContextFinding,
  FreshContextReportV1,
  FreshContextReportV2,
  FreshContextReport,
  FreshContextCheckResult,
  ReviewCheckResult,
};

function pushFinding(findings: Finding[], path: string, code: string, message: string, severity: Finding["severity"] = "error") {
  findings.push({ code, message, path, severity });
}

/** Compatibility wrapper retaining the historical one-argument API. */
export function validateMarkdownLinks(view: RepoView): Finding[] {
  const config = readConfig(view);
  const policy: MarkdownLinkPolicy = {
    publishesKit: config.publishesKit,
    isManagedPath: isKitManagedPath,
  };
  return validateMarkdownLinksFoundation(view, policy);
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

export type AuditReport = {
  ok: boolean;
  findings: Finding[];
  stalePages: string[];
  highRiskStalePages: string[];
  advisoryStalePages: string[];
  openConflicts: ConflictSummary[];
};

export function allLintFindings(view: RepoView, checkGenerated = true): { pages: WikiPage[]; findings: Finding[] } {
  const loaded = loadWikiPages(view);
  const findings = [...loaded.findings, ...validatePages(view, loaded.pages), ...validateMarkdownLinks(view), ...validateCoverage(view, loaded.pages), ...validateIntegrationSeams(view)];
  if (checkGenerated) findings.push(...compareGenerated(view, generatedCoreFiles(loaded.pages, readConfig(view).name)));
  return { pages: loaded.pages, findings };
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
