#!/usr/bin/env bun

/**
 * TE-00 is a publishing-only measurement harness.  It deliberately does not
 * call a model, a tokenizer, or a provider.  Repository observations are
 * collected from one immutable revision and the external usage records are
 * accepted only after privacy and accounting validation.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { jsonStable } from "./core";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const CLI_NAME = "scripts/wiki/cli.ts";

/** The one immutable, pre-optimization publisher revision used by TE-00. */
export const TOKEN_EFFICIENCY_BASELINE_ENGINE_REF =
  "6fd3a85414e00892930557cb8335e2d88ec90d66" as const;
export const TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF = TOKEN_EFFICIENCY_BASELINE_ENGINE_REF;
export const TE00_CONTEXT_SOURCE_REVISION = TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF;
/** SHA of the fixed disposable candidate commit derived from the pinned base. */
export const TOKEN_EFFICIENCY_REVIEW_CANDIDATE_REF = "d70befec1ac13e173ea3cc5b004d789b58a98368" as const;
export const TE00_REVIEW_CANDIDATE = TOKEN_EFFICIENCY_REVIEW_CANDIDATE_REF;

export const TOKEN_EFFICIENCY_QUERIES = {
  focused: "recursive source mapping",
  broad: "token context runtime cost efficiency",
  selectedWork: "TE-00",
} as const;

export const TOKEN_EFFICIENCY_ENTRY_PATHS = [
  "AGENTS.md",
  "wiki/index.md",
  "wiki/current-status.md",
  "wiki/product/invariants.md",
] as const;
export const TOKEN_EFFICIENCY_SOURCE_GLOB = "scripts/wiki/**/*.ts" as const;

/** Byte-stable disposable review-candidate recipe shared by TE-00 and TE-06. */
export const TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE = {
  candidateMessage: "TE-00 deterministic disposable publisher candidate",
  candidateAuthor: "TE-00 fixture <te00-fixture@example.invalid>",
  candidateDate: "2000-01-01T00:00:00Z",
  cliMarker: "// TE-00 deterministic candidate marker.",
  pageMarker: "## TE-00 disposable candidate\n\nThis marker exists only in the fixed review fixture.",
  metadataProfile: "feature/architecture-engine/no-invariants/no-conflicts",
} as const;

export const TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE_DIGEST = createHash("sha256")
  .update(jsonStable(TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE))
  .digest("hex") as string;

/**
 * The fixed TE-00 comparison task reused by the TE-06 controlled after-case.
 * Keep this identity free of revision and runtime observations so the digest
 * remains stable across the before and after publisher records.
 */
export const TOKEN_EFFICIENCY_COMPARISON_TASK = {
  focusedTopic: TOKEN_EFFICIENCY_QUERIES.focused,
  broadDiscovery: TOKEN_EFFICIENCY_QUERIES.broad,
  selectedWork: TOKEN_EFFICIENCY_QUERIES.selectedWork,
  sourceExpansion: TOKEN_EFFICIENCY_SOURCE_GLOB,
  reviewBundle: "deterministic current review bundle measurement",
  reviewCandidateRecipeDigest: TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE_DIGEST,
} as const;

export const TOKEN_EFFICIENCY_COMPARISON_TASK_DIGEST = createHash("sha256")
  .update(jsonStable(TOKEN_EFFICIENCY_COMPARISON_TASK))
  .digest("hex") as string;

/** Controls held constant for the TE-00 publisher before/after records. */
export const TOKEN_EFFICIENCY_ORCHESTRATION =
  "one default measurement agent on gpt-5.6-sol high; no child agents or guardians; deterministic harness uses disposable local clones and makes no model or provider call" as const;

/** Reproduced values for the pinned revision; tests bind the report to these bytes. */
export const TOKEN_EFFICIENCY_EXPECTED = {
  mandatoryEntryBytes: 16_919,
  mandatoryEntryLines: 135,
  focusedContextBytes: 55_043,
  broadContextBytes: 114_294,
  selectedWorkContextBytes: 66_479,
  recursiveTypeScriptBytes: 588_463,
  recursiveTypeScriptLines: 12_647,
  reviewBundleBytes: 60_946,
  reviewDiffBytes: 3_602,
  reviewNonDiffBytes: 57_344,
} as const;

export const SCHOOLED_SESSION_ID = "019fd1e6-816a-7742-b356-f28c945d6110" as const;

const DEFAULT_JSON_PATH = join(PROJECT_ROOT, "docs/evidence/te-00-token-efficiency-baseline.json");
const DEFAULT_MARKDOWN_PATH = join(PROJECT_ROOT, "docs/evidence/te-00-token-efficiency-baseline.md");
const DEFAULT_SCHOOLED_PATH = join(PROJECT_ROOT, "docs/evidence/te-00-schooled-diagnosis.json");
const DEFAULT_PUBLISHER_PATH = join(PROJECT_ROOT, "docs/evidence/te-00-controlled-publisher.json");

type CommandResult = { exitCode: number; stdout: string; stderr: string };

export type TextMetric = { lines: number; words: number; bytes: number };

export type SemanticCounts = {
  pageCount: number;
  currentPageCount: number;
  nonCurrentPageCount: number;
  conflictCount: number;
  sourceDeclarationCount: number;
  sourceFileCount: number;
  readOrderCount: number;
  sourceIds: string[];
  pageIds: string[];
  nonCurrentPageIds: string[];
  conflictIds: string[];
};

export type ContextMeasurement = {
  label: "focused" | "broad" | "selected-work";
  query: string | null;
  workId: string | null;
  text: TextMetric;
  json: TextMetric;
  semantic: SemanticCounts;
};

export type EntryMeasurement = {
  paths: string[];
  files: Record<string, TextMetric>;
  text: TextMetric;
  json: TextMetric;
  semantic: { fileCount: number; sourcePathCount: number; currentAuthorityFileCount: number };
};

export type RecursiveSourceMeasurement = {
  glob: typeof TOKEN_EFFICIENCY_SOURCE_GLOB;
  paths: string[];
  files: Record<string, TextMetric>;
  fileCount: number;
  text: TextMetric;
};

export type ReviewBundleFile = { path: string; bytes: number; component: string };

export type ReviewBundleMeasurement = {
  candidateRef: typeof TOKEN_EFFICIENCY_REVIEW_CANDIDATE_REF;
  baseRef: typeof TOKEN_EFFICIENCY_BASELINE_ENGINE_REF;
  candidateBaseRef: typeof TOKEN_EFFICIENCY_BASELINE_ENGINE_REF;
  candidateSha: string;
  baseSha: string;
  candidateCommit: { message: string; author: string; authoredAt: string };
  metadata: {
    changeType: "feature";
    semanticChange: true;
    wikiAction: "update";
    affectedPages: string[];
    affectedInvariants: string[];
    touchedConflicts: [];
  };
  digest: string;
  files: ReviewBundleFile[];
  fileBytes: Record<string, number>;
  componentBytes: Record<string, number>;
  rawDiffBytes: number;
  rawNonDiffBytes: number;
  digestBindingBytes: number;
  comparisonDiffBytes: number;
  comparisonNonDiffBytes: number;
  comparisonTotalBytes: number;
  diffBytes: number;
  nonDiffBytes: number;
  totalBytes: number;
  rawTotalBytes: number;
  sourceBreadth: {
    sourceFileCount: number;
    sourcePathCount: number;
    sourcePaths: string[];
    sourceFiles: string[];
    globMatches: Record<string, string[]>;
    affectedPageCount: number;
    invariantCount: number;
    conflictCount: number;
  };
};

export type DeterministicTokenEfficiencyReport = {
  reportVersion: 1;
  contractVersion: 1;
  deterministic: {
    contextSourceRevision: typeof TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF;
    entry: EntryMeasurement;
    focused: ContextMeasurement;
    broad: ContextMeasurement;
    selectedWork: ContextMeasurement;
    recursiveTypeScript: RecursiveSourceMeasurement;
    reviewBundle: ReviewBundleMeasurement;
  };
  summary: {
    mandatoryEntryBytes: number;
    mandatoryEntryLines: number;
    focusedContextBytes: number;
    broadContextBytes: number;
    selectedWorkContextBytes: number;
    recursiveTypeScriptBytes: number;
    recursiveTypeScriptLines: number;
    reviewBundleBytes: number;
    reviewDiffBytes: number;
    reviewNonDiffBytes: number;
  };
  method: {
    textEncoding: "UTF-8";
    contextCommands: string[];
    sourceExpansion: string;
    reviewBundleCommand: string;
    historicalCheckout: string;
    notes: string[];
  };
};

/** A metric whose availability is explicit instead of using a magic zero. */
export type PerformanceMetric = {
  availability: "available" | "unavailable";
  valueMs: number | null;
  method: string;
  limitation: string;
};

export type PhaseMeasurement = PerformanceMetric & { modelCalls?: number; toolCalls?: number };

export type PerformanceEvidence = {
  modelRequest: PerformanceMetric;
  firstToken: PerformanceMetric;
  completion: PerformanceMetric;
  toolDuration: PerformanceMetric;
  approvalWait: PerformanceMetric;
  coordinationWait: PerformanceMetric;
  activeWallExcludingUserIdle: PerformanceMetric;
  phases: {
    implementation: PhaseMeasurement;
    publication: PhaseMeasurement;
    merge: PhaseMeasurement;
    cleanup: PhaseMeasurement;
    mergeCleanupCombined?: PhaseMeasurement;
  };
};

export type UsageAgent = {
  role: string;
  pathLabel: string;
  model: string;
  effort: string;
  calls: number;
  rawInputTokens: number;
  cachedInputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  compactions: number;
  toolCalls: number;
  outputBytes: number;
  activeMs: number;
  wallMs: number;
};

export type UsageTotals = Omit<UsageAgent, "role" | "pathLabel" | "model" | "effort"> & { agentCount: number };

export type NumericDistribution = { [key: string]: number | NumericDistribution };

export type SchooledDiagnosis = {
  version: 1;
  kind: "sanitized-schooled-diagnosis";
  sessionId: typeof SCHOOLED_SESSION_ID;
  repository: { label: string; url: string };
  agents: UsageAgent[];
  totals: UsageTotals;
  inputDistribution: NumericDistribution;
  artifactCategories: NumericDistribution;
  success: boolean;
  limitations: string[];
  performance: PerformanceEvidence;
};

export type ControlledPublisher = {
  version: 1;
  kind: "sanitized-controlled-publisher";
  taskLabel: string;
  exactRevision: string;
  orchestration: string;
  agents: UsageAgent[];
  totals: UsageTotals;
  inputDistribution: NumericDistribution;
  artifactCategories: NumericDistribution;
  success: boolean;
  limitations: string[];
  performance: PerformanceEvidence;
};

// Transitional names keep downstream callers source-compatible while the
// contract calls this input a controlled publisher rather than a generic
// rollout.
export type ControlledRolloutAgent = UsageAgent;
export type ControlledRolloutTotals = UsageTotals;
export type ControlledRollout = ControlledPublisher;
export type RolloutValidation = Validation<ControlledPublisher>;

export type Validation<T> = { ok: boolean; errors: string[]; value?: T };

export type TokenEfficiencyEvidence = {
  evidenceVersion: 1;
  kind: "te-00-token-efficiency-baseline";
  externalSchooledDiagnosis: SchooledDiagnosis;
  deterministicPublisherBytes: DeterministicTokenEfficiencyReport;
  controlledPublisher: ControlledPublisher;
  /** Aliases retained for callers that consume the original publishing API. */
  deterministic: DeterministicTokenEfficiencyReport;
  comparison: {
    exactTask: string;
    preOptimizationRevision: typeof TOKEN_EFFICIENCY_BASELINE_ENGINE_REF;
    correctnessFloor: string[];
    optimizationTargets: string[];
    modelAndEffortControls: string[];
    orchestrationControls: string[];
    acceptedVarianceOptions: string[];
    limitations: string[];
  };
  separation: {
    externalDiagnosis: string;
    deterministicEngine: string;
    controlledPublisherOrchestrator: string;
    cacheEffects: string;
    approvalEffects: string;
    limitations: string;
  };
  cacheEffects: { rawInputIncludesCached: true; uncachedDefinition: string; externalCacheObservation: string };
  approvalEffects: { repositoryControlled: false; observation: string };
  limitations: string[];
  ownerRatification: { decision: string; rationale: string; options: string[] };
};

function run(command: string[], cwd: string, extraEnvironment: Record<string, string | undefined> = {}): CommandResult {
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, ...extraEnvironment },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function required(command: string[], cwd: string, extraEnvironment: Record<string, string | undefined> = {}): CommandResult {
  const result = run(command, cwd, extraEnvironment);
  if (result.exitCode !== 0) throw new Error(`${command.join(" ")} failed\n${result.stderr || result.stdout}`);
  return result;
}

function git(root: string, args: string[], allowFailure = false): string {
  const result = run(["git", ...args], root);
  if (result.exitCode !== 0) {
    if (allowFailure) return "";
    throw new Error(`git ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

/** Read a Git blob without trimming its terminal newline. */
function gitBlob(root: string, path: string): string {
  const args = ["show", `${TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF}:${path}`];
  const result = run(["git", ...args], root);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  return result.stdout;
}

function metric(text: string): TextMetric {
  const trimmed = text.trim();
  return {
    lines: (text.match(/\n/g) ?? []).length,
    words: trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length,
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

function sumMetrics(metrics: TextMetric[]): TextMetric {
  return metrics.reduce((sum, item) => ({
    lines: sum.lines + item.lines,
    words: sum.words + item.words,
    bytes: sum.bytes + item.bytes,
  }), { lines: 0, words: 0, bytes: 0 });
}

function sorted<T>(values: T[], compare = (a: T, b: T) => String(a).localeCompare(String(b))): T[] {
  return [...values].sort(compare);
}

function contextSemantic(value: unknown): SemanticCounts {
  const object = value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const pages = Array.isArray(object.pages) ? object.pages.filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item)) : [];
  const nonCurrent = Array.isArray(object.nonCurrentPages) ? object.nonCurrentPages.filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item)) : [];
  const conflicts = Array.isArray(object.conflicts) ? object.conflicts.filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item)) : [];
  const sources = Array.isArray(object.sources) ? object.sources.filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item)) : [];
  const sourceFiles = new Set<string>();
  for (const item of [...pages, ...nonCurrent, ...sources]) {
    for (const path of Array.isArray(item.sourceFiles) ? item.sourceFiles : []) if (typeof path === "string") sourceFiles.add(path);
  }
  const sourceIds = sources.flatMap((item) => typeof item.pageId === "string" ? [item.pageId] : []);
  const ids = (items: Record<string, unknown>[], key: string) => items.flatMap((item) => typeof item[key] === "string" ? [item[key] as string] : []);
  return {
    pageCount: pages.length,
    currentPageCount: pages.filter((page) => page.status === "current").length,
    nonCurrentPageCount: nonCurrent.length,
    conflictCount: conflicts.length,
    sourceDeclarationCount: sources.reduce((count, source) => count + (Array.isArray(source.declared) ? source.declared.length : 1), 0),
    sourceFileCount: sourceFiles.size,
    readOrderCount: Array.isArray(object.readOrder) ? object.readOrder.length : 0,
    sourceIds: sorted([...new Set(sourceIds)]),
    pageIds: sorted(ids(pages, "id")),
    nonCurrentPageIds: sorted(ids(nonCurrent, "id")),
    conflictIds: sorted(ids(conflicts, "id")),
  };
}

function cli(root: string, args: string[]): CommandResult {
  return run([process.execPath, join(root, CLI_NAME), ...args], root, {
    // Pull-request ambient variables are not part of a deterministic fixture.
    GITHUB_EVENT_NAME: undefined,
    WIKI_PR_BODY: undefined,
  });
}

function requiredCli(root: string, args: string[]): CommandResult {
  const result = cli(root, args);
  if (result.exitCode !== 0) throw new Error(`wiki ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  return result;
}

function trackedSourcePaths(root: string): string[] {
  return git(root, ["ls-tree", "-r", "--name-only", TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF, "--", "scripts/wiki"])
    .split("\n")
    .filter((path) => path.endsWith(".ts") && path !== "scripts/wiki/token-efficiency-baseline.ts")
    .sort((a, b) => a.localeCompare(b));
}

function entryMeasurement(root: string): EntryMeasurement {
  const files = Object.fromEntries(TOKEN_EFFICIENCY_ENTRY_PATHS.map((path) => [path, metric(gitBlob(root, path))])) as Record<string, TextMetric>;
  return {
    paths: [...TOKEN_EFFICIENCY_ENTRY_PATHS],
    files,
    text: sumMetrics(Object.values(files)),
    json: metric(jsonStable({ paths: [...TOKEN_EFFICIENCY_ENTRY_PATHS], files })),
    semantic: { fileCount: 4, sourcePathCount: 4, currentAuthorityFileCount: 1 },
  };
}

function contextMeasurement(root: string, label: ContextMeasurement["label"], query: string | null, workId: string | null): ContextMeasurement {
  const args = workId == null ? ["context", query!, "--json"] : ["context", "--work", workId, "--json"];
  const jsonResult = requiredCli(root, args);
  const value = JSON.parse(jsonResult.stdout) as unknown;
  const textResult = workId == null
    ? requiredCli(root, ["context", query!])
    : requiredCli(root, ["context", "--work", workId]);
  return { label, query, workId, text: metric(textResult.stdout), json: metric(jsonResult.stdout), semantic: contextSemantic(value) };
}

function recursiveSourceMeasurement(root: string): RecursiveSourceMeasurement {
  const paths = trackedSourcePaths(root);
  const files = Object.fromEntries(paths.map((path) => [path, metric(gitBlob(root, path))])) as Record<string, TextMetric>;
  return { glob: TOKEN_EFFICIENCY_SOURCE_GLOB, paths, files, fileCount: paths.length, text: sumMetrics(Object.values(files)) };
}

function canonicalMetadata(): string {
  return [
    "```yaml",
    "change_type: feature",
    "semantic_change: true",
    "wiki_action: update",
    "affected_pages:",
    "  - architecture/engine",
    "affected_invariants: []",
    "touched_conflicts: []",
    "fresh_context:",
    "  verdict: PENDING",
    "  reviewed_head_sha: \"\"",
    "  bundle_digest: \"\"",
    "  reviewer: \"\"",
    "  evidence: []",
    "```",
    "",
  ].join("\n");
}

function componentFor(path: string): string {
  if (path === "diff.patch") return "diff";
  if (path.startsWith("pages/")) return "pages";
  if (path.startsWith("invariants/")) return "invariants";
  if (path.startsWith("conflicts/")) return "conflicts";
  if (path === "manifest.json") return "manifest";
  if (path === "impact.json") return "impact";
  if (path === "pr-metadata.json") return "metadata";
  if (path === "sources.json") return "sources";
  return "review-contract";
}

function filePaths(root: string, relativeRoot: string): string[] {
  const absolute = join(root, relativeRoot);
  if (!existsSync(absolute)) return [];
  const output: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) output.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  if (statSync(absolute).isDirectory()) visit(absolute);
  else output.push(relative(root, absolute).replaceAll("\\", "/"));
  return output.sort((a, b) => a.localeCompare(b));
}

function reviewBundleMeasurement(root: string): ReviewBundleMeasurement {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "wiki-ssot-te00-review-"));
  const candidateRoot = join(temporaryRoot, "candidate");
  const metadataPath = join(temporaryRoot, "metadata.md");
  const outputPath = join(temporaryRoot, "bundle");
  const candidateMessage = TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE.candidateMessage;
  const candidateAuthor = TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE.candidateAuthor;
  const candidateDate = TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE.candidateDate;
  try {
    required(["git", "clone", "--quiet", "--shared", "--no-checkout", root, candidateRoot], root);
    required(["git", "checkout", "--quiet", "--detach", TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF], candidateRoot);
    const nodeModules = join(PROJECT_ROOT, "node_modules");
    if (existsSync(nodeModules)) symlinkSync(nodeModules, join(candidateRoot, "node_modules"), "dir");
    const cliPath = join(candidateRoot, CLI_NAME);
    if (!existsSync(cliPath)) throw new Error("TE-00 candidate checkout does not contain the Wiki CLI");
    // The candidate is a fixed, semantics-preserving source marker plus a
    // current-page reconciliation marker.  It is never pushed or retained.
    writeFileSync(join(candidateRoot, "scripts/wiki/cli.ts"), `${readFileSync(join(candidateRoot, "scripts/wiki/cli.ts"), "utf8")}\n${TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE.cliMarker}\n`, "utf8");
    const pagePath = join(candidateRoot, "wiki/architecture/engine.md");
    writeFileSync(pagePath, `${readFileSync(pagePath, "utf8")}\n${TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE.pageMarker}\n`, "utf8");
    writeFileSync(metadataPath, canonicalMetadata(), "utf8");
    requiredCli(candidateRoot, ["verify", "--page", "architecture/engine"]);
    required(["git", "add", "scripts/wiki/cli.ts", "wiki/architecture/engine.md", ".wiki/state.json"], candidateRoot);
    required(["git", "-c", "user.name=TE-00 fixture", "-c", "user.email=te00-fixture@example.invalid", "commit", "--quiet", "-m", candidateMessage], candidateRoot, {
      GIT_AUTHOR_NAME: "TE-00 fixture",
      GIT_AUTHOR_EMAIL: "te00-fixture@example.invalid",
      GIT_COMMITTER_NAME: "TE-00 fixture",
      GIT_COMMITTER_EMAIL: "te00-fixture@example.invalid",
      GIT_AUTHOR_DATE: candidateDate,
      GIT_COMMITTER_DATE: candidateDate,
    });
    const candidateSha = git(candidateRoot, ["rev-parse", "HEAD"]);
    const baseSha = git(candidateRoot, ["rev-parse", `${TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF}^{commit}`]);
    if (baseSha !== TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF) throw new Error("TE-00 review base is not pinned");
    if (candidateSha !== TOKEN_EFFICIENCY_REVIEW_CANDIDATE_REF) throw new Error(`TE-00 disposable candidate drifted: ${candidateSha}`);
    requiredCli(candidateRoot, ["review-bundle", "--base", TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF, "--metadata", metadataPath, "--output", outputPath, "--json"]);
    const manifest = JSON.parse(readFileSync(join(outputPath, "manifest.json"), "utf8")) as Record<string, unknown>;
    const paths = filePaths(outputPath, "");
    const fileBytes = Object.fromEntries(paths.map((path) => [path, Buffer.byteLength(readFileSync(join(outputPath, path)), "utf8")]));
    const rawTotalBytes = Object.values(fileBytes).reduce((sum, bytes) => sum + bytes, 0);
    const files = paths.map((path) => ({ path, bytes: fileBytes[path], component: componentFor(path) }));
    const componentBytes: Record<string, number> = {};
    for (const file of files) componentBytes[file.component] = (componentBytes[file.component] ?? 0) + file.bytes;
    const digest = typeof manifest.bundle_digest === "string" ? manifest.bundle_digest : "";
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("TE-00 review bundle did not return a SHA-256 digest");
    const withoutDigest = { ...manifest };
    delete withoutDigest.bundle_digest;
    const digestBindingBytes = Buffer.byteLength(jsonStable(manifest), "utf8") - Buffer.byteLength(jsonStable(withoutDigest), "utf8");
    if (digestBindingBytes <= 0 || digestBindingBytes >= rawTotalBytes) throw new Error("TE-00 digest binding accounting is invalid");
    const rawDiffBytes = fileBytes["diff.patch"] ?? 0;
    const rawNonDiffBytes = rawTotalBytes - rawDiffBytes;
    const comparisonTotalBytes = rawTotalBytes - digestBindingBytes;
    const comparisonDiffBytes = rawDiffBytes;
    const comparisonNonDiffBytes = comparisonTotalBytes - comparisonDiffBytes;
    const sourceObject = JSON.parse(readFileSync(join(outputPath, "sources.json"), "utf8")) as Record<string, unknown>;
    const sourcePathSet = new Set<string>();
    const globSet = new Set<string>();
    for (const value of Object.values((sourceObject.affectedPages ?? {}) as Record<string, unknown>)) {
      for (const source of Array.isArray(value) ? value : []) {
        if (source == null || typeof source !== "object" || Array.isArray(source)) continue;
        const declaration = source as Record<string, unknown>;
        if (typeof declaration.path === "string") sourcePathSet.add(declaration.path);
        if (typeof declaration.glob === "string") globSet.add(declaration.glob);
      }
    }
    const candidateTree = git(candidateRoot, ["ls-tree", "-r", "--name-only", candidateSha]).split("\n").filter(Boolean).sort((a, b) => a.localeCompare(b));
    const globMatches: Record<string, string[]> = {};
    const sourceFileSet = new Set(sourcePathSet);
    for (const pattern of sorted([...globSet])) {
      let glob: Bun.Glob;
      try { glob = new Bun.Glob(pattern); } catch { throw new Error(`TE-00 review source glob is invalid: ${pattern}`); }
      const matches = candidateTree.filter((path) => glob.match(path)).sort((a, b) => a.localeCompare(b));
      globMatches[pattern] = matches;
      for (const path of matches) sourceFileSet.add(path);
    }
    const sourcePaths = sorted([...sourcePathSet]);
    const sourceFiles = sorted([...sourceFileSet]);
    return {
      candidateRef: TOKEN_EFFICIENCY_REVIEW_CANDIDATE_REF,
      baseRef: TOKEN_EFFICIENCY_BASELINE_ENGINE_REF,
      candidateBaseRef: TOKEN_EFFICIENCY_BASELINE_ENGINE_REF,
      candidateSha,
      baseSha,
      candidateCommit: { message: candidateMessage, author: candidateAuthor, authoredAt: candidateDate },
      metadata: { changeType: "feature", semanticChange: true, wikiAction: "update", affectedPages: ["architecture/engine"], affectedInvariants: [], touchedConflicts: [] },
      digest,
      files,
      fileBytes,
      componentBytes,
      rawDiffBytes,
      rawNonDiffBytes,
      digestBindingBytes,
      comparisonDiffBytes,
      comparisonNonDiffBytes,
      comparisonTotalBytes,
      diffBytes: rawDiffBytes,
      nonDiffBytes: rawNonDiffBytes,
      totalBytes: rawTotalBytes,
      rawTotalBytes,
      sourceBreadth: {
        sourceFileCount: sourceFiles.length,
        sourcePathCount: sourcePaths.length,
        sourcePaths,
        sourceFiles,
        globMatches,
        affectedPageCount: 1,
        invariantCount: 0,
        conflictCount: 0,
      },
    };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function buildAtRoot(root: string): DeterministicTokenEfficiencyReport {
  const baseSha = git(root, ["rev-parse", `${TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF}^{commit}`]);
  const head = git(root, ["rev-parse", "HEAD"]);
  if (process.env.WIKI_TE00_PINNED_ROOT === TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF && head !== TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF) {
    throw new Error("TE-00 pinned runner did not receive the immutable context/source checkout");
  }
  if (baseSha !== TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF) throw new Error("TE-00 context/source revision is unavailable");
  const entry = entryMeasurement(root);
  const focused = contextMeasurement(root, "focused", TOKEN_EFFICIENCY_QUERIES.focused, null);
  const broad = contextMeasurement(root, "broad", TOKEN_EFFICIENCY_QUERIES.broad, null);
  const selectedWork = contextMeasurement(root, "selected-work", null, TOKEN_EFFICIENCY_QUERIES.selectedWork);
  const recursiveTypeScript = recursiveSourceMeasurement(root);
  const reviewBundle = reviewBundleMeasurement(root);
  return {
    reportVersion: 1,
    contractVersion: 1,
    deterministic: { contextSourceRevision: TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF, entry, focused, broad, selectedWork, recursiveTypeScript, reviewBundle },
    summary: {
      mandatoryEntryBytes: entry.text.bytes,
      mandatoryEntryLines: entry.text.lines,
      focusedContextBytes: focused.text.bytes,
      broadContextBytes: broad.text.bytes,
      selectedWorkContextBytes: selectedWork.text.bytes,
      recursiveTypeScriptBytes: recursiveTypeScript.text.bytes,
      recursiveTypeScriptLines: recursiveTypeScript.text.lines,
      reviewBundleBytes: reviewBundle.comparisonTotalBytes,
      reviewDiffBytes: reviewBundle.comparisonDiffBytes,
      reviewNonDiffBytes: reviewBundle.comparisonNonDiffBytes,
    },
    method: {
      textEncoding: "UTF-8",
      contextCommands: [
        `bun run wiki:context -- "${TOKEN_EFFICIENCY_QUERIES.focused}"`,
        `bun run wiki:context -- "${TOKEN_EFFICIENCY_QUERIES.broad}"`,
        `bun run wiki:context -- --work ${TOKEN_EFFICIENCY_QUERIES.selectedWork}`,
      ],
      sourceExpansion: TOKEN_EFFICIENCY_SOURCE_GLOB,
      reviewBundleCommand: `bun run wiki:review-bundle -- --base ${TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF}`,
      historicalCheckout: `git clone --shared --no-checkout; git checkout --detach ${TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF}`,
      notes: [
        "Deterministic measurements are UTF-8 bytes and are not model-token, runtime, billing, or subscription-credit claims.",
        "The context/source and disposable review candidate are local immutable checkouts; no candidate is pushed.",
        "The copied TE-00 runner is excluded from the pinned scripts/wiki/**/*.ts source expansion.",
      ],
    },
  };
}

/** Build against the exact pinned revision even after this publisher advances. */
function buildHistoricalReport(): DeterministicTokenEfficiencyReport {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "wiki-ssot-te00-engine-"));
  const checkoutRoot = join(temporaryRoot, "repo");
  const outputPath = join(temporaryRoot, "report.json");
  try {
    required(["git", "clone", "--quiet", "--shared", "--no-checkout", PROJECT_ROOT, checkoutRoot], PROJECT_ROOT);
    required(["git", "checkout", "--quiet", "--detach", TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF], checkoutRoot);
    const source = join(import.meta.dir, "token-efficiency-baseline.ts");
    mkdirSync(dirname(join(checkoutRoot, "scripts/wiki/token-efficiency-baseline.ts")), { recursive: true });
    writeFileSync(join(checkoutRoot, "scripts/wiki/token-efficiency-baseline.ts"), readFileSync(source, "utf8"), "utf8");
    writeFileSync(join(checkoutRoot, ".git/info/exclude"), "\nscripts/wiki/token-efficiency-baseline.ts\n", { flag: "a" });
    const nodeModules = join(PROJECT_ROOT, "node_modules");
    if (existsSync(nodeModules)) symlinkSync(nodeModules, join(checkoutRoot, "node_modules"), "dir");
    required([process.execPath, join(checkoutRoot, "scripts/wiki/token-efficiency-baseline.ts"), "--internal-output", outputPath], checkoutRoot, {
      WIKI_TE00_PINNED_ROOT: TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF,
    });
    return JSON.parse(readFileSync(outputPath, "utf8")) as DeterministicTokenEfficiencyReport;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function buildTokenEfficiencyBaselineReport(): DeterministicTokenEfficiencyReport {
  // Always measure from a disposable checkout.  Even when HEAD currently
  // equals the pin, this working tree contains the untracked TE-00 runner and
  // tests; allowing those files into wiki:context would silently rewrite the
  // claimed historical source boundary.
  return process.env.WIKI_TE00_PINNED_ROOT === TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF
    ? buildAtRoot(PROJECT_ROOT)
    : buildHistoricalReport();
}

export const buildTokenEfficiencyReport = buildTokenEfficiencyBaselineReport;
export const buildTE00BaselineReport = buildTokenEfficiencyBaselineReport;

const TOKEN_FIELD_ALIASES: Record<string, string[]> = {
  calls: ["calls", "modelCallCount", "modelCalls"],
  rawInputTokens: ["rawInputTokens", "inputTokens", "rawInput"],
  cachedInputTokens: ["cachedInputTokens", "cachedInput"],
  uncachedInputTokens: ["uncachedInputTokens", "derivedUncachedInputTokens", "uncachedInput"],
  outputTokens: ["outputTokens", "output"],
  reasoningOutputTokens: ["reasoningOutputTokens", "reasoningOutput"],
  totalTokens: ["totalTokens", "total"],
  compactions: ["compactions", "compactionCount"],
  toolCalls: ["toolCalls", "tools"],
  outputBytes: ["outputBytes", "artifactBytes"],
  activeMs: ["activeMs", "activeWallMs"],
  wallMs: ["wallMs", "wallClockMs"],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function forbiddenKey(key: string): boolean {
  return /^(transcript|prompt|source(?:Body|Text|Content)|tool(?:Body|Input|Output|Payload)|privatePath|absolutePath|workingDirectory|sessionPath|threadId|filePath|localPath)$/i.test(key)
    || /^(transcript|prompt|source.?body|tool.?body|tool.?input|tool.?payload|private.?path|absolute.?path|working.?directory|session.?path|thread.?id|file.?path|local.?path)$/i.test(key);
}

function unsafePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\") || /(^|\s)\/(?:Users|private|var|tmp|home)(?:\/|\s|$)/i.test(value);
}

function scanPrivacy(value: unknown, path = "input"): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => scanPrivacy(item, `${path}[${index}]`));
  if (!isObject(value)) {
    if (typeof value === "string" && unsafePath(value)) return [`${path} contains an absolute/private path`];
    return [];
  }
  const errors: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const categoryKey = path.endsWith(".artifactCategories") || path.endsWith(".inputDistribution");
    if (!categoryKey && forbiddenKey(key)) errors.push(`${path}.${key} is not permitted in sanitized input`);
    if (/(^|_)(path|pathname|directory|filename)$/i.test(key) && typeof child === "string" && unsafePath(child)) errors.push(`${path}.${key} contains an absolute/private path`);
    errors.push(...scanPrivacy(child, `${path}.${key}`));
  }
  return errors;
}

function normalizeAliases(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeAliases);
  if (!isObject(value)) return value;
  const copy: Record<string, unknown> = { ...value };
  for (const [canonical, aliases] of Object.entries(TOKEN_FIELD_ALIASES)) {
    if (copy[canonical] === undefined) {
      const alias = aliases.find((key) => copy[key] !== undefined);
      if (alias != null) copy[canonical] = copy[alias];
    }
  }
  if (Array.isArray(copy.agents)) copy.agents = copy.agents.map(normalizeAliases);
  if (copy.totals === undefined && isObject(copy.overall)) copy.totals = normalizeAliases(copy.overall);
  if (isObject(copy.totals)) copy.totals = normalizeAliases(copy.totals);
  if (isObject(copy.performance)) copy.performance = normalizeAliases(copy.performance);
  return copy;
}

function numericMap(value: unknown, path: string, errors: string[]): NumericDistribution {
  if (!isObject(value)) {
    errors.push(`${path} must be an object of non-negative numbers`);
    return {};
  }
  const output: NumericDistribution = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isFinite(item) && item >= 0) output[key] = item;
    else if (isObject(item)) output[key] = numericMap(item, `${path}.${key}`, errors);
    else errors.push(`${path}.${key} must be a finite non-negative number or nested distribution`);
  }
  return output;
}

function performanceMetric(value: unknown, path: string, errors: string[]): PerformanceMetric | undefined {
  if (!isObject(value)) {
    errors.push(`${path} must declare availability, valueMs, method, and limitation`);
    return undefined;
  }
  const availability = value.availability;
  const valueMs = value.valueMs;
  if (availability !== "available" && availability !== "unavailable") errors.push(`${path}.availability must be available or unavailable`);
  if (availability === "available" && (typeof valueMs !== "number" || !Number.isFinite(valueMs) || valueMs < 0)) errors.push(`${path}.valueMs must be a finite non-negative number when available`);
  if (availability === "unavailable" && valueMs !== null) errors.push(`${path}.valueMs must be null when unavailable`);
  if (!nonEmpty(value.method)) errors.push(`${path}.method must be a non-empty string`);
  if (typeof value.limitation !== "string") errors.push(`${path}.limitation must be a string`);
  if (availability === "unavailable" && !nonEmpty(value.limitation)) errors.push(`${path}.limitation must explain why the metric is unavailable`);
  return { availability: availability as PerformanceMetric["availability"], valueMs: valueMs as number | null, method: String(value.method ?? ""), limitation: String(value.limitation ?? "") };
}

function phaseMeasurement(value: unknown, path: string, errors: string[]): PhaseMeasurement | undefined {
  const metricValue = isObject(value) && value.activeWall != null ? performanceMetric(value.activeWall, `${path}.activeWall`, errors) : performanceMetric(value, path, errors);
  if (!metricValue) return undefined;
  const result: PhaseMeasurement = { ...metricValue };
  if (isObject(value) && value.modelCalls !== undefined) {
    if (!isInteger(value.modelCalls)) errors.push(`${path}.modelCalls must be a finite non-negative integer`);
    else result.modelCalls = value.modelCalls;
  }
  if (isObject(value) && value.toolCalls !== undefined) {
    if (!isInteger(value.toolCalls)) errors.push(`${path}.toolCalls must be a finite non-negative integer`);
    else result.toolCalls = value.toolCalls;
  }
  return result;
}

function performanceEvidence(value: unknown, path: string, errors: string[]): PerformanceEvidence | undefined {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const alias = (name: string, names: string[]) => names.map((item) => value[item]).find((item) => item !== undefined);
  const modelRequest = performanceMetric(alias("modelRequest", ["modelRequest", "request", "requestLatency"]), `${path}.modelRequest`, errors);
  const firstToken = performanceMetric(alias("firstToken", ["firstToken", "ttft", "firstTokenLatency", "ttftLatency"]), `${path}.firstToken`, errors);
  const completion = performanceMetric(alias("completion", ["completion", "completionLatency"]), `${path}.completion`, errors);
  const toolDuration = performanceMetric(alias("toolDuration", ["toolDuration", "tool"]), `${path}.toolDuration`, errors);
  const approvalWait = performanceMetric(alias("approvalWait", ["approvalWait", "approval"]), `${path}.approvalWait`, errors);
  const coordinationWait = performanceMetric(alias("coordinationWait", ["coordinationWait", "coordination"]), `${path}.coordinationWait`, errors);
  const activeWall = performanceMetric(alias("activeWallExcludingUserIdle", ["activeWallExcludingUserIdle", "activeWall", "activeWallMs"]), `${path}.activeWallExcludingUserIdle`, errors);
  const phaseObject = isObject(value.phases) ? value.phases : isObject(value.phaseTiming) ? value.phaseTiming : undefined;
  if (!phaseObject) errors.push(`${path}.phases must explicitly include implementation, publication, merge, and cleanup`);
  const phases = phaseObject ?? {};
  const implementation = phaseMeasurement(phases.implementation, `${path}.phases.implementation`, errors);
  const publication = phaseMeasurement(phases.publication, `${path}.phases.publication`, errors);
  const merge = phaseMeasurement(phases.merge, `${path}.phases.merge`, errors);
  const cleanup = phaseMeasurement(phases.cleanup, `${path}.phases.cleanup`, errors);
  const combined = phases.mergeCleanupCombined === undefined ? undefined : phaseMeasurement(phases.mergeCleanupCombined, `${path}.phases.mergeCleanupCombined`, errors);
  if (!modelRequest || !firstToken || !completion || !toolDuration || !approvalWait || !coordinationWait || !activeWall || !implementation || !publication || !merge || !cleanup) return undefined;
  return { modelRequest, firstToken, completion, toolDuration, approvalWait, coordinationWait, activeWallExcludingUserIdle: activeWall, phases: { implementation, publication, merge, cleanup, ...(combined ? { mergeCleanupCombined: combined } : {}) } };
}

export function inspectPerformanceEvidence(input: unknown): Validation<PerformanceEvidence> {
  const errors = scanPrivacy(input);
  const value = performanceEvidence(input, "performance", errors);
  return errors.length || !value ? { ok: false, errors } : { ok: true, errors: [], value };
}

export function validatePerformanceEvidence(input: unknown): PerformanceEvidence {
  const checked = inspectPerformanceEvidence(input);
  if (!checked.ok || !checked.value) throw new Error(`invalid performance evidence:\n${checked.errors.join("\n")}`);
  return checked.value;
}

export const inspectControlledPublisherPerformance = inspectPerformanceEvidence;
export const validateControlledPublisherPerformance = validatePerformanceEvidence;

function normalizeAgent(value: unknown, index: number, errors: string[]): UsageAgent | undefined {
  if (!isObject(value)) { errors.push(`agents[${index}] must be an object`); return undefined; }
  const pathLabel = value.pathLabel ?? value.path ?? value.role;
  for (const [key, item] of [["role", value.role], ["pathLabel", pathLabel], ["model", value.model], ["effort", value.effort]] as const) if (!nonEmpty(item) || (key === "pathLabel" && unsafePath(item))) errors.push(`agents[${index}].${key} must be a sanitized non-empty label`);
  const numbers = ["calls", "rawInputTokens", "cachedInputTokens", "uncachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens", "compactions", "toolCalls", "outputBytes", "activeMs", "wallMs"] as const;
  const result = {} as Record<string, number>;
  for (const key of numbers) { if (!isInteger(value[key])) errors.push(`agents[${index}].${key} must be a finite non-negative integer`); else result[key] = value[key] as number; }
  if (errors.some((error) => error.startsWith(`agents[${index}].`))) return undefined;
  if (result.cachedInputTokens > result.rawInputTokens) errors.push(`agents[${index}].cachedInputTokens cannot exceed rawInputTokens`);
  if (result.uncachedInputTokens !== result.rawInputTokens - result.cachedInputTokens) errors.push(`agents[${index}].uncachedInputTokens must equal rawInputTokens - cachedInputTokens`);
  if (result.reasoningOutputTokens > result.outputTokens) errors.push(`agents[${index}].reasoningOutputTokens cannot exceed outputTokens`);
  if (result.totalTokens !== result.rawInputTokens + result.outputTokens) errors.push(`agents[${index}].totalTokens must equal rawInputTokens + outputTokens`);
  if (result.calls < 1) errors.push(`agents[${index}].calls must be at least one`);
  return { role: String(value.role), pathLabel: String(pathLabel), model: String(value.model), effort: String(value.effort), ...result } as UsageAgent;
}

function aggregate(agents: UsageAgent[]): UsageTotals {
  const fields = ["calls", "rawInputTokens", "cachedInputTokens", "uncachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens", "compactions", "toolCalls", "outputBytes", "activeMs", "wallMs"] as const;
  const totals = Object.fromEntries(fields.map((field) => [field, agents.reduce((sum, agent) => sum + agent[field], 0)])) as Omit<UsageTotals, "agentCount">;
  return { agentCount: agents.length, ...totals };
}

function validateUsage(value: unknown, path: string, errors: string[]): { agents: UsageAgent[]; totals: UsageTotals } {
  const object = isObject(value) ? value : {};
  if (!Array.isArray(object.agents) || object.agents.length === 0) errors.push(`${path}.agents must be a non-empty array`);
  const agents = Array.isArray(object.agents) ? object.agents.flatMap((item, index) => { const agent = normalizeAgent(item, index, errors); return agent ? [agent] : []; }) : [];
  const expected = aggregate(agents);
  if (!isObject(object.totals)) errors.push(`${path}.totals must be an object`);
  else for (const field of Object.keys(expected) as (keyof UsageTotals)[]) if (object.totals[field] !== expected[field]) errors.push(`${path}.totals.${field} must equal the aggregate of agents`);
  return { agents, totals: expected };
}

function commonOutcome(value: Record<string, unknown>, path: string, errors: string[]): { inputDistribution: NumericDistribution; artifactCategories: NumericDistribution; success: boolean; limitations: string[]; performance?: PerformanceEvidence } {
  const inputDistribution = numericMap(value.inputDistribution, `${path}.inputDistribution`, errors);
  const artifactCategories = numericMap(value.artifactCategories ?? value.artifacts, `${path}.artifactCategories`, errors);
  if (typeof value.success !== "boolean") errors.push(`${path}.success must be a boolean`);
  if (!Array.isArray(value.limitations) || !value.limitations.every(nonEmpty)) errors.push(`${path}.limitations must be a non-empty string array`);
  const performance = performanceEvidence(value.performance, `${path}.performance`, errors);
  return { inputDistribution, artifactCategories, success: value.success as boolean, limitations: Array.isArray(value.limitations) ? value.limitations.map(String) : [], performance };
}

function repositoryRef(value: unknown, errors: string[]): { label: string; url: string } {
  const object = isObject(value) ? value : {};
  const label = object.label ?? object.repositoryLabel;
  const url = object.url ?? object.repositoryUrl;
  if (!nonEmpty(label) || unsafePath(String(label))) errors.push("repository.label must be a sanitized non-empty label");
  if (!nonEmpty(url) || unsafePath(String(url)) || !/^https?:\/\//.test(String(url))) errors.push("repository.url must be an https/http URL, not a local path");
  return { label: String(label ?? ""), url: String(url ?? "") };
}

export function inspectSchooledDiagnosis(input: unknown): Validation<SchooledDiagnosis> {
  const errors = scanPrivacy(input);
  if (!isObject(input)) return { ok: false, errors: [...errors, "schooled diagnosis must be an object"] };
  const value = normalizeAliases(input) as Record<string, unknown>;
  if (value.version !== 1) errors.push("diagnosis.version must be 1");
  if (value.kind !== "sanitized-schooled-diagnosis") errors.push("diagnosis.kind must be sanitized-schooled-diagnosis");
  if (value.sessionId !== SCHOOLED_SESSION_ID) errors.push(`diagnosis.sessionId must equal ${SCHOOLED_SESSION_ID}`);
  const repository = repositoryRef(value.repository ?? value.repo ?? { label: value.repositoryLabel ?? value.repoLabel, url: value.repositoryUrl ?? value.repoUrl }, errors);
  const usage = validateUsage(value, "diagnosis", errors);
  const outcome = commonOutcome(value, "diagnosis", errors);
  if (errors.length || !outcome.performance) return { ok: false, errors };
  return { ok: true, errors: [], value: { version: 1, kind: "sanitized-schooled-diagnosis", sessionId: SCHOOLED_SESSION_ID, repository, ...usage, inputDistribution: outcome.inputDistribution, artifactCategories: outcome.artifactCategories, success: outcome.success, limitations: outcome.limitations, performance: outcome.performance } };
}

export function validateSchooledDiagnosis(input: unknown): SchooledDiagnosis {
  const checked = inspectSchooledDiagnosis(input);
  if (!checked.ok || !checked.value) throw new Error(`invalid schooled diagnosis:\n${checked.errors.join("\n")}`);
  return checked.value;
}

export function inspectControlledPublisher(input: unknown): Validation<ControlledPublisher> {
  const errors = scanPrivacy(input);
  if (!isObject(input)) return { ok: false, errors: [...errors, "controlled publisher input must be an object"] };
  const value = normalizeAliases(input) as Record<string, unknown>;
  if (value.version !== 1) errors.push("publisher.version must be 1");
  if (value.kind !== "sanitized-controlled-publisher" && value.kind !== "sanitized-controlled-rollout") errors.push("publisher.kind must be sanitized-controlled-publisher");
  const taskLabel = value.taskLabel ?? (isObject(value.comparison) ? value.comparison.taskLabel : undefined);
  const exactRevision = value.exactRevision ?? (isObject(value.comparison) ? value.comparison.contextSourceRevision : undefined);
  const orchestration = value.orchestration ?? (isObject(value.comparison) ? value.comparison.orchestration : undefined);
  if (!nonEmpty(taskLabel)) errors.push("publisher.taskLabel must be a non-empty string");
  if (!nonEmpty(exactRevision) || !/^[0-9a-f]{40}$/.test(String(exactRevision))) errors.push("publisher.exactRevision must be a 40-character revision");
  if (!nonEmpty(orchestration)) errors.push("publisher.orchestration must be a non-empty string");
  const usage = validateUsage(value, "publisher", errors);
  const outcome = commonOutcome(value, "publisher", errors);
  if (errors.length || !outcome.performance) return { ok: false, errors };
  return { ok: true, errors: [], value: { version: 1, kind: "sanitized-controlled-publisher", taskLabel: String(taskLabel), exactRevision: String(exactRevision), orchestration: String(orchestration), ...usage, inputDistribution: outcome.inputDistribution, artifactCategories: outcome.artifactCategories, success: outcome.success, limitations: outcome.limitations, performance: outcome.performance } };
}

export function validateControlledPublisher(input: unknown): ControlledPublisher {
  const checked = inspectControlledPublisher(input);
  if (!checked.ok || !checked.value) throw new Error(`invalid controlled publisher:\n${checked.errors.join("\n")}`);
  return checked.value;
}

/** Compatibility aliases for the first TE-00 publishing API draft. */
export const inspectControlledRollout = inspectControlledPublisher;
export const validateControlledRollout = validateControlledPublisher;
export const validateTE00ControlledRollout = validateControlledPublisher;

export function buildTokenEfficiencyEvidence(
  report: DeterministicTokenEfficiencyReport,
  diagnosisInput: unknown,
  publisherInput?: unknown,
): TokenEfficiencyEvidence {
  // Accept a small object envelope as well as the preferred two-file API;
  // this keeps callers from accidentally mixing the two sanitized layers.
  let diagnosisCandidate = diagnosisInput;
  let publisherCandidate = publisherInput;
  if (publisherCandidate === undefined && isObject(diagnosisInput)) {
    const envelope = diagnosisInput as Record<string, unknown>;
    const candidateDiagnosis = envelope.schooledDiagnosis ?? envelope.externalSchooledDiagnosis ?? envelope.diagnosis;
    const candidatePublisher = envelope.controlledPublisher ?? envelope.publisher ?? envelope.rollout;
    if (candidateDiagnosis !== undefined && candidatePublisher !== undefined) {
      diagnosisCandidate = candidateDiagnosis;
      publisherCandidate = candidatePublisher;
    }
  }
  const diagnosis = validateSchooledDiagnosis(diagnosisCandidate);
  const publisher = validateControlledPublisher(publisherCandidate);
  return {
    evidenceVersion: 1,
    kind: "te-00-token-efficiency-baseline",
    externalSchooledDiagnosis: diagnosis,
    deterministicPublisherBytes: report,
    controlledPublisher: publisher,
    deterministic: report,
    comparison: {
      exactTask: "Measure focused topic, broad discovery, selected-work, recursive TypeScript source expansion, and a deterministic review bundle from the pinned publisher revision.",
      preOptimizationRevision: TOKEN_EFFICIENCY_BASELINE_ENGINE_REF,
      correctnessFloor: [
        "PV-19 correctness floor: preserve 100% of current-page, invariant, conflict, implementation-source, authority/status, non-current-label, expected-change, Wiki-action, coverage, impact, review, and drift expectations.",
        "Do not trade source traceability, exact-HEAD binding, or independent review for smaller context or bundles.",
      ],
      optimizationTargets: [
        "Remove repeated full-body expansion, broad re-reading, duplicate review input, repeated discovery and polling, oversized success output, and unnecessary role or phase round trips where the repository structure causes them.",
        "Keep token, byte, call, tool, and elapsed-time measurements as before/after diagnostic evidence instead of standalone percentage pass thresholds.",
        "Demonstrate that each structural change removes its reproduced waste without weakening the correctness floor or hiding work in an external orchestrator.",
      ],
      modelAndEffortControls: ["Keep task, role, model, reasoning effort, and call accounting fixed for before/after comparisons."],
      orchestrationControls: ["Keep orchestration/fan-out and approval policy fixed; repository code does not control provider routing or cache continuity."],
      acceptedVarianceOptions: ["No blanket percentage reduction or variance gate applies; record before/after values and attribute model/cache behavior, orchestration, approval, provider latency, and sampling limitations explicitly."],
      limitations: ["UTF-8 bytes and supplied token counts are evidence, not billed API cost, subscription credits, runtime latency, or proof of comprehension.", "Schooled diagnosis is external and sanitized; it is not a publisher-engine measurement.", "Sanitized evidence retains no transcript, prompt, private path, session body, or source/tool body."],
    },
    separation: {
      externalDiagnosis: "Schooled session usage and timings are supplied external diagnosis; no transcript, prompt, source body, or tool body is retained.",
      deterministicEngine: "Pinned repository text/JSON bytes, semantic counts, source breadth, and review bundle accounting are deterministic engine evidence.",
      controlledPublisherOrchestrator: "Publisher agents, calls, models, effort, tool/artifact totals, and performance are controlled rollout observations.",
      cacheEffects: "Raw input includes cached input; uncached input is derived as raw minus cached and is not added twice.",
      approvalEffects: "Approval waits are reported when available and remain external approval-system observations.",
      limitations: "Unavailable performance fields retain null values and non-empty limitations instead of being interpreted as zero.",
    },
    cacheEffects: { rawInputIncludesCached: true, uncachedDefinition: "uncachedInputTokens = rawInputTokens - cachedInputTokens", externalCacheObservation: "Cache continuity and misses are orchestrator observations, not engine guarantees." },
    approvalEffects: { repositoryControlled: false, observation: "Approval wait is recorded separately from request, tool, coordination, and active wall measurements." },
    limitations: ["No model/provider calls are made by this harness.", "No comparison candidate is pushed; the disposable candidate is removed after bundle measurement.", "The owner rejected fixed percentage reduction gates; measurements remain diagnostic evidence for structural improvements."],
    ownerRatification: {
      decision: "ratified: structural improvement without fixed percentage budgets",
      rationale: "The measured time and token cost comes from structural waste. Remove reproduced unnecessary expansion, rereading, duplication, polling, and round trips while preserving correctness; do not substitute arbitrary reduction percentages for that work.",
      options: ["ratify the publisher contract", "request another bounded measurement cycle", "do not adopt the optimization"],
    },
  };
}

export const buildCombinedTokenEfficiencyEvidence = buildTokenEfficiencyEvidence;
export const buildTokenEfficiencyBaselineEvidence = buildTokenEfficiencyEvidence;

export function renderTokenEfficiencyEvidenceJson(evidence: TokenEfficiencyEvidence): string {
  return jsonStable(evidence);
}

export function renderTokenEfficiencyOwnerRatification(evidence: TokenEfficiencyEvidence): string {
  const report = evidence.deterministicPublisherBytes.summary;
  const totals = evidence.controlledPublisher.totals;
  return [
    "# TE-00 token-efficiency baseline",
    "",
    `The deterministic publisher evidence is pinned to \`${evidence.comparison.preOptimizationRevision}\` and measured as UTF-8 bytes. External schooled diagnosis and controlled publisher rollout metrics remain separate layers; neither claims billed cost or subscription credits.`,
    "",
    "## Correctness floor and structural objectives",
    "",
    ...evidence.comparison.correctnessFloor.map((item) => `- ${item}`),
    ...evidence.comparison.optimizationTargets.map((item) => `- ${item}`),
    "",
    "## Reproduced deterministic publisher bytes",
    "",
    `- Entry ${report.mandatoryEntryBytes}; focused ${report.focusedContextBytes}; broad ${report.broadContextBytes}; selected work ${report.selectedWorkContextBytes}; recursive TypeScript ${report.recursiveTypeScriptBytes}; review ${report.reviewBundleBytes} (${report.reviewDiffBytes} diff, ${report.reviewNonDiffBytes} non-diff).`,
    `- Review candidate \`${evidence.deterministicPublisherBytes.deterministic.reviewBundle.candidateSha}\` is derived from exact base \`${evidence.deterministicPublisherBytes.deterministic.reviewBundle.baseSha}\`, with no push and no retained worktree.`,
    "",
    "## Controlled publisher rollout and performance",
    "",
    `- ${totals.agentCount} agent(s), ${totals.calls} model calls, ${totals.rawInputTokens} raw input tokens (${totals.cachedInputTokens} cached; ${totals.uncachedInputTokens} derived uncached), ${totals.outputTokens} output tokens (${totals.reasoningOutputTokens} reasoning subset), ${totals.totalTokens} total.`,
    "- Request, first-token, completion, tool, approval, coordination, and active-wall metrics distinguish available values from unavailable values with explicit limitations.",
    "- Implementation, publication, merge, and cleanup phases are reported independently; a supplied merge/cleanup combined observation is retained separately when applicable.",
    "",
    "## Layer separation, measurement interpretation, and limitations",
    "",
    "- Cached input is included in raw input and is never added twice; reasoning output is a subset of output.",
    "- External cache continuity, approval behavior, provider latency, model routing, and optional orchestration are observations, not repository guarantees.",
    ...evidence.comparison.limitations.map((item) => `- ${item}`),
    ...evidence.limitations.map((item) => `- ${item}`),
    "",
    "## Owner ratification",
    "",
    `Decision: **${evidence.ownerRatification.decision}**`,
    "",
    evidence.ownerRatification.rationale,
    "",
  ].join("\n");
}

export const renderTokenEfficiencyBaselineMarkdown = renderTokenEfficiencyOwnerRatification;
export const renderTokenEfficiencyInterpretation = renderTokenEfficiencyOwnerRatification;
export const renderTokenEfficiencyMarkdown = renderTokenEfficiencyOwnerRatification;
export const renderTokenEfficiencyEvidenceMarkdown = renderTokenEfficiencyOwnerRatification;

function flagPath(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path`);
  return resolve(PROJECT_ROOT, value);
}

function readInput(path: string): unknown {
  if (!existsSync(path)) throw new Error(`sanitized TE-00 input is missing: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

if (import.meta.main) {
  const internalOutputIndex = process.argv.indexOf("--internal-output");
  if (internalOutputIndex !== -1) {
    const output = process.argv[internalOutputIndex + 1];
    if (!output) throw new Error("--internal-output requires a path");
    const report = process.env.WIKI_TE00_PINNED_ROOT === TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF
      ? buildAtRoot(PROJECT_ROOT)
      : buildHistoricalReport();
    writeFileSync(output, jsonStable(report), "utf8");
  } else {
    const report = buildTokenEfficiencyBaselineReport();
    const diagnosis = validateSchooledDiagnosis(readInput(flagPath("--schooled", flagPath("--diagnosis", DEFAULT_SCHOOLED_PATH))));
    const publisher = validateControlledPublisher(readInput(flagPath("--publisher", flagPath("--controlled-publisher", flagPath("--rollout", DEFAULT_PUBLISHER_PATH)))));
    const evidence = buildTokenEfficiencyEvidence(report, diagnosis, publisher);
    const jsonPath = flagPath("--output", DEFAULT_JSON_PATH);
    const markdownPath = flagPath("--markdown", flagPath("--interpretation", DEFAULT_MARKDOWN_PATH));
    const jsonText = renderTokenEfficiencyEvidenceJson(evidence);
    const markdownText = renderTokenEfficiencyOwnerRatification(evidence);
    if (process.argv.includes("--check")) {
      const mismatches = [[jsonPath, jsonText], [markdownPath, markdownText]].filter(([path, expected]) => {
        try { return readFileSync(path, "utf8") !== expected; } catch { return true; }
      });
      if (mismatches.length > 0) throw new Error(`TE-00 evidence is stale: ${mismatches.map(([path]) => path).join(", ")}`);
      console.log("TE-00 token-efficiency evidence is current");
    } else {
      mkdirSync(dirname(jsonPath), { recursive: true });
      mkdirSync(dirname(markdownPath), { recursive: true });
      writeFileSync(jsonPath, jsonText, "utf8");
      writeFileSync(markdownPath, markdownText, "utf8");
      console.log(`wrote ${jsonPath}`);
      console.log(`wrote ${markdownPath}`);
    }
  }
}
