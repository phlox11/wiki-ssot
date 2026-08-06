#!/usr/bin/env bun

/**
 * TE-06's publisher-only after-case for the fixed TE-00 comparison.
 *
 * This command is deliberately model/provider free.  It checks out the one
 * ratified combined revision into a disposable worktree and measures only the
 * fixed topic, discovery, selected-work, recursive source, and review-bundle
 * surfaces.  The successful JSON is a compact, digest-addressed artifact; it
 * never contains prompt, source, command output, or private path bodies.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { jsonStable } from "./core";
import {
  TOKEN_EFFICIENCY_COMPARISON_TASK,
  TOKEN_EFFICIENCY_COMPARISON_TASK_DIGEST,
  TOKEN_EFFICIENCY_ORCHESTRATION,
  TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE,
  TOKEN_EFFICIENCY_SOURCE_GLOB,
  type ContextMeasurement as Te00ContextMeasurement,
  type RecursiveSourceMeasurement as Te00RecursiveSourceMeasurement,
  type ReviewBundleMeasurement as Te00ReviewBundleMeasurement,
} from "./token-efficiency-baseline";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const CLI_PATH = "scripts/wiki/cli.ts";

/** The exact combined revision after TE-05, TE-01/02, and TE-04. */
export const TE06_CONTROLLED_COMPARISON_REVISION =
  "76e5d97a410d8e67659835e059e7b721541113c5" as const;

/** The publisher task label retained by the separately audited after-case. */
export const TE06_CONTROLLED_PUBLISHER_TASK_LABEL = "te06-publisher-after-control" as const;

/** Byte-for-byte TE-00 orchestration control string. */
export const TE06_CONTROLLED_COMPARISON_ORCHESTRATION = TOKEN_EFFICIENCY_ORCHESTRATION;

/** Stable names retained as aliases for callers that use the shorter TE-06 form. */
export const TE06_COMPARISON_TASK_IDENTITY = TOKEN_EFFICIENCY_COMPARISON_TASK;
export const TE06_COMPARISON_TASK_DIGEST = TOKEN_EFFICIENCY_COMPARISON_TASK_DIGEST;
export const TE06_CONTROLLED_COMPARISON_TASK_IDENTITY = TE06_COMPARISON_TASK_IDENTITY;
export const TE06_CONTROLLED_COMPARISON_TASK_DIGEST = TE06_COMPARISON_TASK_DIGEST;

export type Te06ComparisonTaskIdentity = typeof TOKEN_EFFICIENCY_COMPARISON_TASK;

export type Te06ComparisonContextMeasurement = {
  label: Te00ContextMeasurement["label"];
  query: string | null;
  workId: string | null;
  text: { lines: number; words: number; bytes: number };
  json: { lines: number; words: number; bytes: number };
  semantic: Te00ContextMeasurement["semantic"];
};

export type Te06ComparisonSourceMeasurement = Te00RecursiveSourceMeasurement;
export type Te06ComparisonReviewMeasurement = Omit<Te00ReviewBundleMeasurement, "candidateRef" | "baseRef" | "candidateBaseRef"> & {
  candidateRef: string;
  baseRef: string;
  candidateBaseRef: string;
};

export type Te06ControlledComparisonRecord = {
  version: 1;
  kind: "te06-controlled-comparison";
  comparisonTask: Te06ComparisonTaskIdentity;
  comparisonTaskDigest: string;
  exactRevision: typeof TE06_CONTROLLED_COMPARISON_REVISION;
  orchestration: typeof TE06_CONTROLLED_COMPARISON_ORCHESTRATION;
  deterministic: {
    modelCalls: 0;
    providerCalls: 0;
    focused: Te06ComparisonContextMeasurement;
    broad: Te06ComparisonContextMeasurement;
    selectedWork: Te06ComparisonContextMeasurement;
    recursiveTypeScript: Te06ComparisonSourceMeasurement;
    reviewBundle: Te06ComparisonReviewMeasurement;
  };
  summary: {
    focusedContextBytes: number;
    broadContextBytes: number;
    selectedWorkContextBytes: number;
    recursiveTypeScriptBytes: number;
    recursiveTypeScriptLines: number;
    reviewBundleBytes: number;
    reviewDiffBytes: number;
    reviewNonDiffBytes: number;
  };
  reportDigest: string;
};

/** The successful default stdout projection; full evidence stays digest-bound. */
export type Te06ControlledComparisonCompact = {
  version: 1;
  kind: "te06-controlled-comparison-compact";
  comparisonTask: Te06ComparisonTaskIdentity;
  comparisonTaskDigest: string;
  exactRevision: typeof TE06_CONTROLLED_COMPARISON_REVISION;
  orchestration: typeof TE06_CONTROLLED_COMPARISON_ORCHESTRATION;
  summary: {
    focusedContextBytes: number;
    broadContextBytes: number;
    selectedWorkContextBytes: number;
    recursiveTypeScriptBytes: number;
    reviewBundleBytes: number;
  };
  reportDigest: string;
};

type CommandResult = { exitCode: number; stdout: string; stderr: string };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function command(commandLine: string[], cwd: string, environment: Record<string, string | undefined> = {}): CommandResult {
  const result = Bun.spawnSync(commandLine, {
    cwd,
    env: { ...process.env, GITHUB_EVENT_NAME: undefined, WIKI_PR_BODY: undefined, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function required(commandLine: string[], cwd: string, environment: Record<string, string | undefined> = {}): string {
  const result = command(commandLine, cwd, environment);
  if (result.exitCode !== 0) throw new Error(`${commandLine.join(" ")} failed\n${result.stderr || result.stdout}`);
  return result.stdout;
}

function git(root: string, args: string[]): string {
  return required(["git", ...args], root).trim();
}

function metric(text: string): { lines: number; words: number; bytes: number } {
  const trimmed = text.trim();
  return {
    lines: (text.match(/\n/g) ?? []).length,
    words: trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length,
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

function sumMetrics(metrics: Array<{ lines: number; words: number; bytes: number }>) {
  return metrics.reduce((sum, item) => ({
    lines: sum.lines + item.lines,
    words: sum.words + item.words,
    bytes: sum.bytes + item.bytes,
  }), { lines: 0, words: 0, bytes: 0 });
}

function sorted<T>(values: T[], compare = (a: T, b: T) => String(a).localeCompare(String(b))): T[] {
  return [...values].sort(compare);
}

function assertPrivacy(value: unknown, path = "input"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPrivacy(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "string") {
    if (value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:[\\/]/.test(value)) {
      throw new Error(`TE-06 controlled comparison contains a private path at ${path}`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:transcript|prompt(?:Body|Text|Content)?|source(?:Body|Text|Content)|tool(?:Body|Input|Output|Payload)|privatePath|absolutePath|workingDirectory)$/i.test(key)) {
      throw new Error(`TE-06 controlled comparison retains forbidden body field ${path}.${key}`);
    }
    assertPrivacy(child, `${path}.${key}`);
  }
}

function bodyDigest(value: Record<string, unknown>): string {
  if (typeof value.bodyDigest === "string" && /^[0-9a-f]{64}$/.test(value.bodyDigest)) return value.bodyDigest;
  if (typeof value.body === "string") return sha256(value.body);
  throw new Error(`context entry ${String(value.id ?? value.path ?? "unknown")} has no body binding`);
}

function canonicalEntry(value: Record<string, unknown>): Record<string, unknown> {
  const omitted = new Set(["body", "bodyDigest", "focusedCommand"]);
  return {
    ...Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key))),
    bodyDigest: bodyDigest(value),
  };
}

function canonicalContextSemantics(value: unknown): Te00ContextMeasurement["semantic"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("context JSON must be an object");
  const object = value as Record<string, unknown>;
  const entries = (key: string) => Array.isArray(object[key])
    ? object[key].map((item) => canonicalEntry(item as Record<string, unknown>))
    : [];
  const pages = Array.isArray(object.pages) ? object.pages.filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item)) : [];
  const nonCurrent = Array.isArray(object.nonCurrentPages) ? object.nonCurrentPages.filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item)) : [];
  const conflicts = Array.isArray(object.conflicts) ? object.conflicts.filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item)) : [];
  const sources = Array.isArray(object.sources) ? object.sources.filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item)) : [];
  const sourceFiles = new Set<string>();
  for (const item of [...pages, ...nonCurrent, ...sources]) {
    for (const path of Array.isArray(item.sourceFiles) ? item.sourceFiles : []) if (typeof path === "string") sourceFiles.add(path);
  }
  const ids = (items: Record<string, unknown>[], key: string) => sorted(items.flatMap((item) => typeof item[key] === "string" ? [item[key] as string] : []));
  const sourceIds = sorted([...new Set(sources.flatMap((item) => typeof item.pageId === "string" ? [item.pageId] : []))]);
  return {
    pageCount: pages.length,
    currentPageCount: pages.filter((page) => page.status === "current").length,
    nonCurrentPageCount: nonCurrent.length,
    conflictCount: conflicts.length,
    sourceDeclarationCount: sources.reduce((count, source) => count + (Array.isArray(source.declared) ? source.declared.length : 1), 0),
    sourceFileCount: sourceFiles.size,
    readOrderCount: Array.isArray(object.readOrder) ? object.readOrder.length : 0,
    sourceIds,
    pageIds: ids(pages, "id"),
    nonCurrentPageIds: ids(nonCurrent, "id"),
    conflictIds: ids(conflicts, "id"),
  };
}

function contextArgs(label: Te06ComparisonContextMeasurement["label"]): string[] {
  if (label === "selected-work") return ["context", "--work", TOKEN_EFFICIENCY_COMPARISON_TASK.selectedWork];
  const query = label === "focused" ? TOKEN_EFFICIENCY_COMPARISON_TASK.focusedTopic : TOKEN_EFFICIENCY_COMPARISON_TASK.broadDiscovery;
  return ["context", query];
}

function contextMeasurement(root: string, label: Te06ComparisonContextMeasurement["label"]): Te06ComparisonContextMeasurement {
  const args = contextArgs(label);
  const jsonResult = command([process.execPath, join(root, CLI_PATH), ...args, "--json"], root);
  if (jsonResult.exitCode !== 0) throw new Error(`TE-06 ${label} JSON context failed\n${jsonResult.stderr || jsonResult.stdout}`);
  const textResult = command([process.execPath, join(root, CLI_PATH), ...args], root);
  if (textResult.exitCode !== 0) throw new Error(`TE-06 ${label} text context failed\n${textResult.stderr || textResult.stdout}`);
  const value = JSON.parse(jsonResult.stdout) as unknown;
  const semantic = canonicalContextSemantics(value);
  return {
    label,
    query: label === "selected-work" ? null : label === "focused" ? TOKEN_EFFICIENCY_COMPARISON_TASK.focusedTopic : TOKEN_EFFICIENCY_COMPARISON_TASK.broadDiscovery,
    workId: label === "selected-work" ? TOKEN_EFFICIENCY_COMPARISON_TASK.selectedWork : null,
    text: metric(textResult.stdout),
    json: metric(jsonResult.stdout),
    semantic,
  };
}

function gitBlob(root: string, revision: string, path: string): string {
  return required(["git", "show", `${revision}:${path}`], root);
}

function recursiveSourceMeasurement(root: string, revision: string): Te06ComparisonSourceMeasurement {
  const paths = git(root, ["ls-tree", "-r", "--name-only", revision, "--", "scripts/wiki"])
    .split("\n")
    .filter((path) => path.endsWith(".ts"))
    .sort((a, b) => a.localeCompare(b));
  const files = Object.fromEntries(paths.map((path) => [path, metric(gitBlob(root, revision, path))]));
  return {
    glob: TOKEN_EFFICIENCY_SOURCE_GLOB,
    paths,
    files,
    fileCount: paths.length,
    text: sumMetrics(Object.values(files)),
  };
}

function metadata(): string {
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

function recursiveFiles(root: string): string[] {
  const output: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) output.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  visit(root);
  return output.sort((a, b) => a.localeCompare(b));
}

function componentFor(path: string): string {
  if (path === "diff.patch") return "diff";
  if (path.startsWith("objects/")) return "objects";
  if (path === "focused-manifest.json") return "focused-manifest";
  if (path.startsWith("sources")) return "sources";
  if (path.startsWith("PROMPT") || path.startsWith("REPORT")) return "review-contract";
  return path;
}

function reviewBundleMeasurement(root: string, revision: string): Te06ComparisonReviewMeasurement {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "wiki-ssot-te06-comparison-review-"));
  const candidateRoot = join(temporaryRoot, "candidate");
  const metadataPath = join(temporaryRoot, "metadata.md");
  const outputPath = join(temporaryRoot, "bundle");
  const candidateMessage = TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE.candidateMessage;
  const candidateAuthor = TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE.candidateAuthor;
  const candidateDate = TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE.candidateDate;
  try {
    const clone = command(["git", "clone", "--quiet", "--shared", "--no-checkout", root, candidateRoot], root);
    if (clone.exitCode !== 0) throw new Error(clone.stderr || clone.stdout);
    required(["git", "checkout", "--quiet", "--detach", revision], candidateRoot);
    const nodeModules = join(PROJECT_ROOT, "node_modules");
    if (existsSync(nodeModules)) symlinkSync(nodeModules, join(candidateRoot, "node_modules"), "dir");
    const cli = join(candidateRoot, CLI_PATH);
    const page = join(candidateRoot, "wiki/architecture/engine.md");
    if (!existsSync(cli) || !existsSync(page)) throw new Error("TE-06 comparison candidate is missing engine entrypoints");
    writeFileSync(cli, `${readFileSync(cli, "utf8")}\n${TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE.cliMarker}\n`, "utf8");
    writeFileSync(page, `${readFileSync(page, "utf8")}\n${TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE.pageMarker}\n`, "utf8");
    writeFileSync(metadataPath, metadata(), "utf8");
    required([process.execPath, cli, "verify", "--page", "architecture/engine"], candidateRoot);
    required(["git", "add", CLI_PATH, "wiki/architecture/engine.md", ".wiki/state.json"], candidateRoot);
    required(["git", "-c", "user.name=TE-00 fixture", "-c", "user.email=te00-fixture@example.invalid", "commit", "--quiet", "-m", candidateMessage], candidateRoot, {
      GIT_AUTHOR_NAME: "TE-00 fixture",
      GIT_AUTHOR_EMAIL: "te00-fixture@example.invalid",
      GIT_COMMITTER_NAME: "TE-00 fixture",
      GIT_COMMITTER_EMAIL: "te00-fixture@example.invalid",
      GIT_AUTHOR_DATE: candidateDate,
      GIT_COMMITTER_DATE: candidateDate,
    });
    const candidateSha = git(candidateRoot, ["rev-parse", "HEAD^{commit}"]);
    const baseSha = git(candidateRoot, ["rev-parse", `${revision}^{commit}`]);
    if (baseSha !== revision) throw new Error("TE-06 comparison review base drifted");
    required([process.execPath, cli, "review-bundle", "--base", revision, "--metadata", metadataPath, "--output", outputPath, "--json"], candidateRoot);
    const manifest = JSON.parse(readFileSync(join(outputPath, "manifest.json"), "utf8")) as Record<string, unknown>;
    const paths = recursiveFiles(outputPath);
    const fileBytes = Object.fromEntries(paths.map((path) => [path, Buffer.byteLength(readFileSync(join(outputPath, path)), "utf8")])) as Record<string, number>;
    const rawTotalBytes = Object.values(fileBytes).reduce((sum, bytes) => sum + bytes, 0);
    const files = paths.map((path) => ({ path, bytes: fileBytes[path], component: componentFor(path) }));
    const componentBytes: Record<string, number> = {};
    for (const file of files) componentBytes[file.component] = (componentBytes[file.component] ?? 0) + file.bytes;
    const digest = typeof manifest.bundle_digest === "string" ? manifest.bundle_digest : "";
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("TE-06 comparison review bundle did not return a SHA-256 digest");
    const withoutDigest = { ...manifest };
    delete withoutDigest.bundle_digest;
    const digestBindingBytes = Buffer.byteLength(jsonStable(manifest), "utf8") - Buffer.byteLength(jsonStable(withoutDigest), "utf8");
    if (digestBindingBytes <= 0 || digestBindingBytes >= rawTotalBytes) throw new Error("TE-06 comparison digest binding accounting is invalid");
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
      try { glob = new Bun.Glob(pattern); } catch { throw new Error(`TE-06 comparison review source glob is invalid: ${pattern}`); }
      const matches = candidateTree.filter((path) => glob.match(path)).sort((a, b) => a.localeCompare(b));
      globMatches[pattern] = matches;
      for (const path of matches) sourceFileSet.add(path);
    }
    const sourcePaths = sorted([...sourcePathSet]);
    const sourceFiles = sorted([...sourceFileSet]);
    return {
      candidateRef: candidateSha,
      baseRef: revision,
      candidateBaseRef: revision,
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

function exactRevision(root: string, revision: string): string {
  const resolved = git(root, ["rev-parse", `${revision}^{commit}`]);
  if (!/^[0-9a-f]{40}$/.test(resolved)) throw new Error(`TE-06 comparison revision is not an exact commit: ${revision}`);
  if (resolved !== TE06_CONTROLLED_COMPARISON_REVISION) {
    throw new Error(`TE-06 comparison must bind exact revision ${TE06_CONTROLLED_COMPARISON_REVISION}`);
  }
  return resolved;
}

function reportCore(record: Omit<Te06ControlledComparisonRecord, "reportDigest">): Omit<Te06ControlledComparisonRecord, "reportDigest"> {
  return record;
}

export function normalizeTe06ComparisonTask(input: unknown = TOKEN_EFFICIENCY_COMPARISON_TASK): Te06ComparisonTaskIdentity {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("TE-06 comparison task must be an object");
  const value = input as Record<string, unknown>;
  const candidate = (value.identity && typeof value.identity === "object" && !Array.isArray(value.identity))
    ? value.identity as Record<string, unknown>
    : value;
  const normalized = {
    focusedTopic: candidate.focusedTopic ?? candidate.focused,
    broadDiscovery: candidate.broadDiscovery ?? candidate.broad,
    selectedWork: candidate.selectedWork,
    sourceExpansion: candidate.sourceExpansion ?? candidate.sourceGlob,
    reviewBundle: candidate.reviewBundle,
    reviewCandidateRecipeDigest: candidate.reviewCandidateRecipeDigest,
  };
  if (normalized.focusedTopic !== TOKEN_EFFICIENCY_COMPARISON_TASK.focusedTopic
    || normalized.broadDiscovery !== TOKEN_EFFICIENCY_COMPARISON_TASK.broadDiscovery
    || normalized.selectedWork !== TOKEN_EFFICIENCY_COMPARISON_TASK.selectedWork
    || normalized.sourceExpansion !== TOKEN_EFFICIENCY_COMPARISON_TASK.sourceExpansion
    || normalized.reviewBundle !== TOKEN_EFFICIENCY_COMPARISON_TASK.reviewBundle
    || normalized.reviewCandidateRecipeDigest !== TOKEN_EFFICIENCY_COMPARISON_TASK.reviewCandidateRecipeDigest) {
    throw new Error("TE-06 comparison task identity does not match fixed TE-00 task");
  }
  return TOKEN_EFFICIENCY_COMPARISON_TASK;
}

export function validateTe06ControlledComparison(input: unknown, revision: string = TE06_CONTROLLED_COMPARISON_REVISION): Te06ControlledComparisonRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid TE-06 controlled comparison record");
  assertPrivacy(input);
  const value = input as Record<string, unknown>;
  if (value.version !== 1 || value.kind !== "te06-controlled-comparison") throw new Error("invalid TE-06 controlled comparison record version/kind");
  const exact = typeof value.exactRevision === "string" ? value.exactRevision : "";
  if (exact !== revision || exact !== TE06_CONTROLLED_COMPARISON_REVISION) throw new Error("controlled comparison does not bind the TE-06 exact revision");
  const task = normalizeTe06ComparisonTask(value.comparisonTask);
  const digest = value.comparisonTaskDigest;
  if (digest !== TE06_COMPARISON_TASK_DIGEST) throw new Error("controlled comparison task digest does not match fixed TE-00 task");
  if (value.orchestration !== TE06_CONTROLLED_COMPARISON_ORCHESTRATION) throw new Error("controlled comparison orchestration does not match TE-00 controls");
  if (!value.deterministic || typeof value.deterministic !== "object" || Array.isArray(value.deterministic)) throw new Error("controlled comparison deterministic section is missing");
  const deterministic = value.deterministic as Record<string, unknown>;
  if (deterministic.modelCalls !== 0 || deterministic.providerCalls !== 0) throw new Error("controlled comparison must be model/provider free");
  const focused = deterministic.focused as Record<string, unknown> | undefined;
  const broad = deterministic.broad as Record<string, unknown> | undefined;
  const selectedWork = deterministic.selectedWork as Record<string, unknown> | undefined;
  const recursiveTypeScript = deterministic.recursiveTypeScript as Record<string, unknown> | undefined;
  const reviewBundle = deterministic.reviewBundle as Record<string, unknown> | undefined;
  if (focused?.query !== TOKEN_EFFICIENCY_COMPARISON_TASK.focusedTopic
    || broad?.query !== TOKEN_EFFICIENCY_COMPARISON_TASK.broadDiscovery
    || selectedWork?.workId !== TOKEN_EFFICIENCY_COMPARISON_TASK.selectedWork
    || recursiveTypeScript?.glob !== TOKEN_EFFICIENCY_SOURCE_GLOB
    || !reviewBundle || reviewBundle.baseSha !== exact || reviewBundle.candidateBaseRef !== exact) {
    throw new Error("controlled comparison deterministic surfaces do not match the fixed TE-00 task");
  }
  const candidateCommit = reviewBundle.candidateCommit as Record<string, unknown> | undefined;
  if (candidateCommit?.message !== TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE.candidateMessage
    || candidateCommit.author !== TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE.candidateAuthor
    || candidateCommit.authoredAt !== TOKEN_EFFICIENCY_REVIEW_CANDIDATE_RECIPE.candidateDate) {
    throw new Error("controlled comparison review candidate recipe does not match TE-00");
  }
  const reportDigest = typeof value.reportDigest === "string" ? value.reportDigest : "";
  const core = { ...value };
  delete core.reportDigest;
  if (!/^[0-9a-f]{64}$/.test(reportDigest) || sha256(jsonStable(core)) !== reportDigest) throw new Error("controlled comparison report digest does not match its core");
  return { ...value, comparisonTask: task, comparisonTaskDigest: digest, exactRevision: exact, orchestration: TE06_CONTROLLED_COMPARISON_ORCHESTRATION, reportDigest } as Te06ControlledComparisonRecord;
}

export function buildTe06ControlledComparison(root = PROJECT_ROOT, revision: string = TE06_CONTROLLED_COMPARISON_REVISION): Te06ControlledComparisonRecord {
  const requested = exactRevision(root, revision);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "wiki-ssot-te06-comparison-"));
  const checkoutRoot = join(temporaryRoot, "repo");
  try {
    const clone = command(["git", "clone", "--quiet", "--shared", "--no-checkout", root, checkoutRoot], root);
    if (clone.exitCode !== 0) throw new Error(clone.stderr || clone.stdout);
    required(["git", "checkout", "--quiet", "--detach", requested], checkoutRoot);
    const nodeModules = join(PROJECT_ROOT, "node_modules");
    if (!existsSync(nodeModules)) throw new Error("TE-06 comparison requires repository node_modules");
    symlinkSync(nodeModules, join(checkoutRoot, "node_modules"), "dir");
    if (!existsSync(join(checkoutRoot, CLI_PATH))) throw new Error("TE-06 comparison checkout is missing the Wiki CLI");

    const focused = contextMeasurement(checkoutRoot, "focused");
    const broad = contextMeasurement(checkoutRoot, "broad");
    const selectedWork = contextMeasurement(checkoutRoot, "selected-work");
    const recursiveTypeScript = recursiveSourceMeasurement(checkoutRoot, requested);
    const reviewBundle = reviewBundleMeasurement(checkoutRoot, requested);
    const core = {
      version: 1 as const,
      kind: "te06-controlled-comparison" as const,
      comparisonTask: TE06_COMPARISON_TASK_IDENTITY,
      comparisonTaskDigest: TE06_COMPARISON_TASK_DIGEST,
      exactRevision: requested as typeof TE06_CONTROLLED_COMPARISON_REVISION,
      orchestration: TE06_CONTROLLED_COMPARISON_ORCHESTRATION,
      deterministic: {
        modelCalls: 0 as const,
        providerCalls: 0 as const,
        focused,
        broad,
        selectedWork,
        recursiveTypeScript,
        reviewBundle,
      },
      summary: {
        focusedContextBytes: focused.text.bytes,
        broadContextBytes: broad.text.bytes,
        selectedWorkContextBytes: selectedWork.text.bytes,
        recursiveTypeScriptBytes: recursiveTypeScript.text.bytes,
        recursiveTypeScriptLines: recursiveTypeScript.text.lines,
        reviewBundleBytes: reviewBundle.comparisonTotalBytes,
        reviewDiffBytes: reviewBundle.comparisonDiffBytes,
        reviewNonDiffBytes: reviewBundle.comparisonNonDiffBytes,
      },
    };
    return { ...core, reportDigest: sha256(jsonStable(reportCore(core))) };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export const buildTe06ControlledComparisonRecord = buildTe06ControlledComparison;

export function compactTe06ControlledComparison(record: Te06ControlledComparisonRecord): Te06ControlledComparisonCompact {
  const validated = validateTe06ControlledComparison(record);
  return {
    version: 1,
    kind: "te06-controlled-comparison-compact",
    comparisonTask: validated.comparisonTask,
    comparisonTaskDigest: validated.comparisonTaskDigest,
    exactRevision: validated.exactRevision,
    orchestration: validated.orchestration,
    summary: {
      focusedContextBytes: validated.summary.focusedContextBytes,
      broadContextBytes: validated.summary.broadContextBytes,
      selectedWorkContextBytes: validated.summary.selectedWorkContextBytes,
      recursiveTypeScriptBytes: validated.summary.recursiveTypeScriptBytes,
      reviewBundleBytes: validated.summary.reviewBundleBytes,
    },
    reportDigest: validated.reportDigest,
  };
}

export function renderTe06ControlledComparisonCompact(record: Te06ControlledComparisonRecord): string {
  return jsonStable(compactTe06ControlledComparison(record));
}

/** Validate the bounded stdout projection against its separately retained full record. */
export function validateTe06ControlledComparisonCompact(input: unknown, full: Te06ControlledComparisonRecord): Te06ControlledComparisonCompact {
  const expected = compactTe06ControlledComparison(full);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid TE-06 compact controlled comparison");
  const value = input as Record<string, unknown>;
  if (jsonStable(value) !== jsonStable(expected)) throw new Error("TE-06 compact comparison does not bind the full report digest");
  return expected;
}

export const renderTe06ControlledComparison = (record: Te06ControlledComparisonRecord): string => {
  const validated = validateTe06ControlledComparison(record);
  return jsonStable(validated);
};

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

if (import.meta.main) {
  try {
    const record = buildTe06ControlledComparison(PROJECT_ROOT, flagValue("--revision") ?? TE06_CONTROLLED_COMPARISON_REVISION);
    const rendered = process.argv.includes("--full")
      ? renderTe06ControlledComparison(record)
      : renderTe06ControlledComparisonCompact(record);
    const output = flagValue("--output");
    if (output) writeFileSync(resolve(PROJECT_ROOT, output), rendered, "utf8");
    process.stdout.write(rendered);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
