#!/usr/bin/env bun

/**
 * TE-04 deterministic focused-review measurement.
 *
 * The fixture is a disposable publisher candidate derived from the exact
 * current repository revision. It performs no model/provider call: model-call
 * and provider timing fields are explicitly unavailable, while deterministic
 * bundle bytes, source breadth, exact PASS, and local active-time diagnostics
 * are observed from the repository engine.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { jsonStable } from "./core";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const CLI_PATH = "scripts/wiki/cli.ts";
/** Engine entrypoints copied into the disposable candidate as one dependency closure. */
export const TE04_ENGINE_PATHS = [
  "scripts/wiki/core.ts",
  "scripts/wiki/discovery.ts",
  "scripts/wiki/context.ts",
  "scripts/wiki/generated-views.ts",
  "scripts/wiki/model.ts",
  "scripts/wiki/serialization.ts",
  "scripts/wiki/repository-view.ts",
  "scripts/wiki/page-validation.ts",
  "scripts/wiki/work-validation.ts",
  CLI_PATH,
] as const;
/** TE-00 publisher review source breadth observed by the pinned baseline. */
export const TE00_REVIEWER_SOURCE_BREADTH = 33;

export type Te04Availability = "available" | "unavailable";
export type Te04Diagnostic = {
  availability: Te04Availability;
  value: number | null;
  method: string;
  limitation: string;
};
export type Te04FocusedReviewMeasurement = {
  version: 1;
  base_sha: string;
  candidate_sha: string;
  implementation_revision: string;
  bundle_digest: string;
  exact_pass: boolean;
  portable_fixture_correct: boolean;
  raw_bundle_bytes: number;
  component_bytes: Record<string, number>;
  diff_bytes: number;
  non_diff_bundle_bytes: number;
  reviewer_source_breadth: number;
  reviewer_source_paths: string[];
  model_calls: Te04Diagnostic;
  reviewer_active_time: Te04Diagnostic;
  provider_latency: Te04Diagnostic;
  notes: string[];
};

type CommandResult = { exitCode: number; stdout: string; stderr: string };

function command(root: string, args: string[], env?: Record<string, string>): CommandResult {
  const result = Bun.spawnSync([process.execPath, ...args], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function required(root: string, args: string[], env?: Record<string, string>): string {
  const result = command(root, args, env);
  if (result.exitCode !== 0) throw new Error(`${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  return result.stdout;
}

function requiredExternal(root: string, args: string[], env?: Record<string, string>): string {
  const result = Bun.spawnSync(args, { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  if (result.exitCode !== 0) throw new Error(`${args.join(" ")} failed\n${result.stderr.toString() || result.stdout.toString()}`);
  return result.stdout.toString();
}

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || `git ${args.join(" ")} failed`);
  return result.stdout.toString().trim();
}

function engineSource(root: string, path: string): string {
  const source = join(root, path);
  if (existsSync(source)) return readFileSync(source, "utf8");
  // Historical TE-06 checkouts predate the KM-01 split. Their copied core
  // still needs the foundation modules when this harness runs from the
  // current publisher checkout, so use the current source only for a missing
  // dependency and keep the exact checkout as the candidate base.
  const fallback = join(PROJECT_ROOT, path);
  if (existsSync(fallback)) return readFileSync(fallback, "utf8");
  throw new Error(`TE-04 engine source is missing from ${root} and ${PROJECT_ROOT}: ${path}`);
}

function recursiveFiles(root: string): string[] {
  const output: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) output.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  visit(root);
  return output.sort((a, b) => a.localeCompare(b));
}

function metadata(): string {
  return [
    "```yaml",
    "change_type: reconcile",
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

/** Run the fixed disposable candidate and return deterministic TE-04 metrics. */
export function measureTe04FocusedReview(root = PROJECT_ROOT): Te04FocusedReviewMeasurement {
  const started = performance.now();
  const temporaryRoot = mkdtempSync(join(tmpdir(), "wiki-ssot-te04-review-"));
  const candidateRoot = join(temporaryRoot, "candidate");
  const metadataPath = join(temporaryRoot, "metadata.md");
  const policyPath = join(temporaryRoot, "policy.json");
  const reportPath = join(temporaryRoot, "report.json");
  const outputPath = join(temporaryRoot, "bundle");
  try {
    const repositorySha = git(root, ["rev-parse", "HEAD^{commit}"]);
    const clone = Bun.spawnSync(["git", "clone", "--quiet", "--shared", "--no-checkout", root, candidateRoot], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (clone.exitCode !== 0) throw new Error(clone.stderr.toString());
    requiredExternal(candidateRoot, ["git", "checkout", "--quiet", "--detach", repositorySha]);
    const nodeModules = join(PROJECT_ROOT, "node_modules");
    if (existsSync(nodeModules)) {
      symlinkSync(nodeModules, join(candidateRoot, "node_modules"), "dir");
      writeFileSync(join(candidateRoot, ".git/info/exclude"), "\nnode_modules\n", { flag: "a" });
    }

    const cli = join(candidateRoot, CLI_PATH);
    const page = join(candidateRoot, "wiki/architecture/engine.md");
    // The harness is also runnable from a dirty authoring checkout. Copy the
    // two engine entrypoints into the disposable candidate so its exact
    // implementation revision includes the current focused-review code; the
    // candidate itself remains isolated and is never pushed.
    for (const path of TE04_ENGINE_PATHS) {
      writeFileSync(join(candidateRoot, path), engineSource(root, path), "utf8");
    }
    // Use the Git blob to detect a dirty authoring checkout before the copy.
    // Historical exact-revision checkouts may not contain the newer foundation
    // files. They are copied for module resolution and ignored in that
    // historical fixture because its checked-out core does not import them;
    // this keeps the pinned TE-06 bundle byte-stable.
    const enginePathsInRoot = TE04_ENGINE_PATHS.filter((path) => existsSync(join(root, path)));
    const historicalDependencyFallback = enginePathsInRoot.length < TE04_ENGINE_PATHS.length;
    if (historicalDependencyFallback) {
      const supplemental = TE04_ENGINE_PATHS.filter((path) => !enginePathsInRoot.includes(path));
      writeFileSync(join(candidateRoot, ".git/info/exclude"), `\n${supplemental.join("\n")}\n`, { flag: "a" });
    }
    const copiedEngineDiffersFromRepository = enginePathsInRoot.some((path) => {
      const result = Bun.spawnSync(["git", "show", `${repositorySha}:${path}`], { cwd: root, stdout: "pipe", stderr: "pipe" });
      return result.exitCode !== 0 || result.stdout.toString() !== engineSource(root, path);
    });
    if (copiedEngineDiffersFromRepository) {
      requiredExternal(candidateRoot, ["git", "add", ...enginePathsInRoot]);
      requiredExternal(candidateRoot, ["git", "-c", "user.name=TE-04 fixture", "-c", "user.email=te04-fixture@example.invalid", "commit", "--quiet", "-m", "TE-04 current engine snapshot"], {
        GIT_AUTHOR_NAME: "TE-04 fixture",
        GIT_AUTHOR_EMAIL: "te04-fixture@example.invalid",
        GIT_COMMITTER_NAME: "TE-04 fixture",
        GIT_COMMITTER_EMAIL: "te04-fixture@example.invalid",
        GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
      });
    }
    const baseSha = git(candidateRoot, ["rev-parse", "HEAD^{commit}"]);
    writeFileSync(page, `${readFileSync(page, "utf8")}\n## TE-04 disposable focused-review candidate\n\nThis marker exists only in the fixed measurement fixture.\n`, "utf8");
    writeFileSync(metadataPath, metadata(), "utf8");
    writeFileSync(policyPath, jsonStable({ freshContext: {
      mode: "required",
      requiredVerdict: "PASS",
      evidenceRequired: true,
      trust: { allowedReviewers: ["te04-fixture-reviewer"], requireDifferentActor: false, requireAuthenticatedActor: true },
      requiredWhen: { kind: "all" },
    } }), "utf8");
    required(candidateRoot, [cli, "verify", "--page", "architecture/engine"]);
    requiredExternal(candidateRoot, ["git", "add", CLI_PATH, "wiki/architecture/engine.md", ".wiki/state.json"]);
    requiredExternal(candidateRoot, ["git", "-c", "user.name=TE-04 fixture", "-c", "user.email=te04-fixture@example.invalid", "commit", "--quiet", "-m", "TE-04 disposable focused review candidate"], {
      GIT_AUTHOR_NAME: "TE-04 fixture",
      GIT_AUTHOR_EMAIL: "te04-fixture@example.invalid",
      GIT_COMMITTER_NAME: "TE-04 fixture",
      GIT_COMMITTER_EMAIL: "te04-fixture@example.invalid",
      GIT_AUTHOR_DATE: "2000-01-02T00:00:00Z",
      GIT_COMMITTER_DATE: "2000-01-02T00:00:00Z",
    });
    const candidateSha = git(candidateRoot, ["rev-parse", "HEAD^{commit}"]);
    required(candidateRoot, [cli, "review-bundle", "--base", baseSha, "--metadata", metadataPath, "--output", outputPath, "--json"]);
    const manifest = JSON.parse(readFileSync(join(outputPath, "manifest.json"), "utf8")) as Record<string, unknown>;
    const focused = JSON.parse(readFileSync(join(outputPath, "focused-manifest.json"), "utf8")) as { source_roles?: Array<{ path?: string }> };
    const paths = recursiveFiles(outputPath);
    const fileBytes = Object.fromEntries(paths.map((path) => [path, Buffer.byteLength(readFileSync(join(outputPath, path), "utf8"))]));
    const rawBundleBytes = Object.values(fileBytes).reduce((sum, value) => sum + value, 0);
    const diffBytes = fileBytes["diff.patch"] ?? 0;
    const componentBytes: Record<string, number> = {};
    for (const [path, bytes] of Object.entries(fileBytes)) {
      const component = path === "diff.patch" ? "diff" : path.startsWith("objects/") ? "objects" : path === "focused-manifest.json" ? "focused-manifest" : path.startsWith("sources") ? "sources" : path.startsWith("PROMPT") || path.startsWith("REPORT") ? "review-contract" : path;
      componentBytes[component] = (componentBytes[component] ?? 0) + bytes;
    }
    const sourcePaths = (focused.source_roles ?? []).flatMap((source) => typeof source.path === "string" ? [source.path] : []).sort((a, b) => a.localeCompare(b));

    const report = {
      version: 1,
      verdict: "PASS",
      reviewed_head_sha: candidateSha,
      merge_base_sha: baseSha,
      bundle_digest: typeof manifest.bundle_digest === "string" ? manifest.bundle_digest : "",
      reviewer: "te04-fixture-reviewer",
      evidence: ["Deterministic focused manifest, diff, metadata, object digests, and portable preflight PASS were checked."],
      summary: "The disposable current-engine fixture preserves exact PASS without a provider call.",
    };
    writeFileSync(reportPath, jsonStable(report), "utf8");
    const preflightRaw = required(candidateRoot, [cli, "review-preflight", "--base", baseSha, "--metadata", metadataPath, "--policy-file", policyPath, "--report", reportPath, "--reviewer-actor", "te04-fixture-reviewer", "--pr-author", "te04-fixture-author", "--json"]);
    const preflight = JSON.parse(preflightRaw) as { status?: string; ready?: boolean };
    if (preflight.status !== "pass") throw new Error(`TE-04 disposable preflight did not PASS\n${preflightRaw}`);
    const activeMs = performance.now() - started;
    return {
      version: 1,
      base_sha: baseSha,
      candidate_sha: candidateSha,
      implementation_revision: baseSha,
      bundle_digest: String(manifest.bundle_digest ?? ""),
      exact_pass: preflight.status === "pass" && preflight.ready === true,
      portable_fixture_correct: preflight.status === "pass",
      raw_bundle_bytes: rawBundleBytes,
      component_bytes: componentBytes,
      diff_bytes: diffBytes,
      non_diff_bundle_bytes: rawBundleBytes - diffBytes,
      reviewer_source_breadth: sourcePaths.length,
      reviewer_source_paths: sourcePaths,
      model_calls: { availability: "unavailable", value: null, method: "deterministic local harness; no provider invocation", limitation: "Model calls require an external controlled pilot and are not inferred from repository bytes." },
      reviewer_active_time: { availability: "available", value: activeMs, method: "local monotonic timer around disposable candidate and preflight", limitation: "Process and filesystem time are diagnostic only; no provider latency claim." },
      provider_latency: { availability: "unavailable", value: null, method: "not captured", limitation: "The deterministic harness intentionally makes no model/provider call." },
      notes: [
        `Reviewer source breadth is ${sourcePaths.length}; TE-00 pinned breadth reference is ${TE00_REVIEWER_SOURCE_BREADTH}.`,
        "Non-diff bytes include the focused manifest, content-addressed Wiki objects, source declarations, and review contract files.",
        "Exact PASS and portable fixture correctness are local engine evidence; model-call count and provider timing remain external observations.",
      ],
    };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const report = measureTe04FocusedReview();
  console.log(jsonStable(report));
}
