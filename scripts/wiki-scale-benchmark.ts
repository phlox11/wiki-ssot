#!/usr/bin/env bun

/**
 * Publishing-only scale diagnostic.  It deliberately lives outside KIT_ENTRIES:
 * adopters keep the deterministic engine, while this repository owns the
 * disposable profile generator and its evidence.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cpus, tmpdir } from "node:os";
import {
  buildWorkQueue,
  createRepoView,
  generatedCoreFiles,
  hashContent,
  loadWikiPages,
  searchWikiPages,
  validatePages,
} from "./wiki/core";
import type { RelationshipGraph } from "./wiki/generated-views";
import { jsonStable } from "./wiki/serialization";

export type ScaleProfile = {
  name: "tiny" | "schooled" | "large";
  currentPages: number;
  proposalPages: number;
  workItems: number;
  conflicts: number;
  openConflicts: number;
  resolvedConflicts: number;
  declaredSourceFiles: number;
};

export const SCALE_PROFILES: Record<ScaleProfile["name"], ScaleProfile> = {
  tiny: {
    name: "tiny",
    currentPages: 3,
    proposalPages: 1,
    workItems: 4,
    conflicts: 2,
    openConflicts: 1,
    resolvedConflicts: 1,
    declaredSourceFiles: 6,
  },
  schooled: {
    name: "schooled",
    currentPages: 26,
    proposalPages: 5,
    workItems: 29,
    conflicts: 12,
    openConflicts: 3,
    resolvedConflicts: 9,
    declaredSourceFiles: 100,
  },
  large: {
    name: "large",
    currentPages: 1_000,
    proposalPages: 100,
    workItems: 10_000,
    conflicts: 1_000,
    openConflicts: 250,
    resolvedConflicts: 750,
    declaredSourceFiles: 10_000,
  },
};

export type ScalePhase = {
  name: string;
  wall_ms: number;
  peak_rss_bytes: number;
  input_count: number;
  input_bytes: number;
  output_count: number;
  output_bytes: number;
};

export type ScaleBenchmarkReport = {
  version: 1;
  environment: {
    bun_version: string;
    platform: string;
    arch: string;
    cpu_model: string;
    logical_cpus: number;
  };
  profile: ScaleProfile;
  profile_digest: string;
  input_digest: string;
  output_digest: string;
  phases: ScalePhase[];
  engine_total_ms: number;
  peak_rss_bytes: number;
  counts: {
    current_pages: number;
    proposal_pages: number;
    work_items: number;
    total_conflicts: number;
    open_conflicts: number;
    resolved_conflicts: number;
    catalog_pages: number;
    graph_nodes: number;
    graph_edges: number;
    source_files: number;
    search_matches: number;
  };
  correctness: {
    validation_findings: number;
    validation_finding_codes: string[];
    profile_counts_exact: boolean;
    queue_work_items: number;
    graph_has_no_source_nodes: boolean;
    catalog_complete: boolean;
    graph_counts_exact: boolean;
    root_index_bounded: boolean;
    generated_deterministic: boolean;
    search_exercised: boolean;
  };
  enforcement: {
    requested: boolean;
    passed: boolean;
    limits: { max_engine_phase_ms: number; max_peak_rss_bytes: number; max_root_index_bytes: number };
  };
};

export const SCALE_ENGINE_PHASE_LIMIT_MS = 30_000;

/** Return whether every measured engine phase stays within the timing boundary. */
export function enginePhasesWithinLimit(phases: Pick<ScalePhase, "wall_ms">[], maxMs = SCALE_ENGINE_PHASE_LIMIT_MS): boolean {
  return Number.isFinite(maxMs) && maxMs >= 0
    && phases.every((phase) => Number.isFinite(phase.wall_ms) && phase.wall_ms >= 0 && phase.wall_ms <= maxMs);
}

type SyntheticFiles = { files: Record<string, string>; sourceFiles: string[]; expectedGraphEdges: number };

function frontmatter(data: Record<string, unknown>, body = "# Synthetic page\n"): string {
  return `---\n${Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n\n${body}`;
}

function sourcePath(index: number): string {
  return `src/scale/source-${String(index).padStart(5, "0")}.ts`;
}

function makeSyntheticFiles(profile: ScaleProfile): SyntheticFiles {
  const files: Record<string, string> = {};
  const sourceFiles = Array.from({ length: profile.declaredSourceFiles }, (_, index) => sourcePath(index));
  for (const path of sourceFiles) files[path] = `export const source${path.match(/(\d+)\.ts$/)?.[1] ?? "0"} = 1;\n`;

  const currentIds = Array.from({ length: profile.currentPages }, (_, index) => `product/page-${String(index).padStart(4, "0")}`);
  const invariantId = currentIds[0];
  const sourceOwners = new Map<string, string[]>();
  sourceFiles.forEach((path, index) => {
    const owner = currentIds[index % currentIds.length];
    sourceOwners.set(owner, [...(sourceOwners.get(owner) ?? []), path]);
  });
  for (let index = 0; index < currentIds.length; index++) {
    const id = currentIds[index];
    const relations = index === 0 ? [] : [currentIds[index - 1]];
    const affects = index > 0 && index % 17 === 0 ? [invariantId] : [];
    files[`wiki/product/page-${String(index).padStart(4, "0")}.md`] = frontmatter({
      id,
      summary: `Synthetic current page ${index}.`,
      kind: index === 0 ? "invariant" : "product",
      status: "current",
      authority: index === 0 ? "normative" : "observed",
      owners: ["@scale-benchmark"],
      sources: (sourceOwners.get(id) ?? [sourceFiles[0]]).map((path) => ({ path })),
      related: relations,
      affects,
      tags: ["synthetic", "scale"],
    }, `# Synthetic page ${index}\n\nThis deterministic profile exercises the Wiki engine.\n`);
  }

  const workPerProposal = Math.floor(profile.workItems / profile.proposalPages);
  let remainder = profile.workItems % profile.proposalPages;
  let workIndex = 0;
  for (let proposalIndex = 0; proposalIndex < profile.proposalPages; proposalIndex++) {
    const count = workPerProposal + (remainder-- > 0 ? 1 : 0);
    const items: Record<string, unknown>[] = [];
    for (let local = 0; local < count; local++) {
      const id = `WS-${String(workIndex + 1).padStart(5, "0")}`;
      const done = workIndex === 0 || workIndex % 2 === 0;
      items.push({
        id,
        title: `Synthetic work item ${workIndex}.`,
        state: done ? "done" : "not-started",
        executor: "agent",
        priority: workIndex % 7 === 0 ? "high" : "normal",
        depends_on: workIndex === 0 ? [] : ["WS-00001"],
        context_pages: [currentIds[workIndex % currentIds.length]],
        acceptance: ["The deterministic synthetic contract is validated."],
        evidence: done ? ["scale-benchmark synthetic evidence"] : [],
      });
      workIndex += 1;
    }
    const proposalId = `proposal/scale-${String(proposalIndex).padStart(3, "0")}`;
    files[`wiki/proposals/scale-${String(proposalIndex).padStart(3, "0")}.md`] = frontmatter({
      id: proposalId,
      summary: `Synthetic proposal ${proposalIndex}.`,
      kind: "proposal",
      status: "proposed",
      authority: "normative",
      owners: ["@scale-benchmark"],
      sources: [{ path: sourceFiles[0] }],
      tags: ["synthetic", "scale"],
      work_items: items,
    }, `# Synthetic proposal ${proposalIndex}\n`);
  }

  for (let index = 0; index < profile.conflicts; index++) {
    // C-NNN is the schema contract; C-000 through C-999 gives the exact
    // 1,000-conflict diagnostic profile without inventing a fourth digit.
    const conflictId = `C-${String(index).padStart(3, "0")}`;
    const open = index < profile.openConflicts;
    const type = index % 3 === 0 ? "decision" : index % 3 === 1 ? "implementation" : "documentation";
    const data: Record<string, unknown> = {
      id: `conflict/${conflictId}`,
      conflict_id: conflictId,
      summary: `Synthetic ${type} conflict ${index}.`,
      kind: "conflict",
      status: open ? "conflicted" : "archived",
      authority: "observed",
      owners: ["@scale-benchmark"],
      conflict_type: type,
      severity: index % 3 === 0 ? "high" : index % 3 === 1 ? "medium" : "low",
      origin: "baseline",
      opened_at: "2026-01-01",
      sources: [{ path: sourceFiles[0] }],
      affected_pages: [currentIds[index % currentIds.length]],
      affected_invariants: [invariantId],
      tags: ["synthetic", "scale"],
      resolution: open
        ? { state: "open", acceptance: ["Record the deterministic conflict resolution."] }
        : { state: "verified", decision: "Synthetic resolution recorded.", acceptance: ["Record the deterministic conflict resolution."], evidence: [sourceFiles[0]] },
    };
    const directory = open ? "open" : "resolved";
    files[`wiki/conflicts/${directory}/${conflictId}.md`] = frontmatter(data, `# Synthetic conflict ${conflictId}\n`);
  }
  const relatedEdges = Math.max(0, profile.currentPages - 1);
  const affectsEdges = Math.floor(Math.max(0, profile.currentPages - 1) / 17);
  const conflictEdges = profile.conflicts * 2;
  const contextEdges = profile.workItems;
  const dependencyEdges = Math.max(0, profile.workItems - 1);
  return { files, sourceFiles, expectedGraphEdges: relatedEdges + affectsEdges + conflictEdges + contextEdges + dependencyEdges };
}

function runGit(root: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || `git ${args.join(" ")} failed`);
  return result.stdout.toString();
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
}

function rss(): number {
  const usage = process.resourceUsage?.();
  if (usage?.maxRSS != null) {
    // getrusage reports bytes on macOS and KiB on Linux; Bun exposes the
    // platform value without conversion.
    return process.platform === "linux" ? usage.maxRSS * 1024 : usage.maxRSS;
  }
  return process.memoryUsage().rss;
}

function measure<T>(name: string, inputCount: number, inputBytes: number, fn: () => T, output: (value: T) => { count: number; bytes: number }): { value: T; phase: ScalePhase } {
  const before = rss();
  const started = performance.now();
  const value = fn();
  const elapsed = performance.now() - started;
  const after = rss();
  const result = output(value);
  return {
    value,
    phase: {
      name,
      wall_ms: Number(elapsed.toFixed(3)),
      peak_rss_bytes: Math.max(before, after),
      input_count: inputCount,
      input_bytes: inputBytes,
      output_count: result.count,
      output_bytes: result.bytes,
    },
  };
}

function generatedBytes(files: Record<string, string>): number {
  return Object.values(files).reduce((total, content) => total + Buffer.byteLength(content, "utf8"), 0);
}

function graphCorrect(graph: RelationshipGraph, profile: ScaleProfile, expectedEdges: number): boolean {
  return graph.nodes.length === profile.currentPages + profile.proposalPages + profile.conflicts + profile.workItems
    && graph.edges.length === expectedEdges
    && graph.nodes.every((node) => node.type === "page" || node.type === "work")
    && !graph.nodes.some((node) => node.id.startsWith("src/"));
}

export type RunScaleOptions = { profile?: ScaleProfile["name"]; enforce?: boolean; keep?: boolean };

export function runScaleBenchmark(options: RunScaleOptions = {}): ScaleBenchmarkReport {
  const profile = SCALE_PROFILES[options.profile ?? "large"];
  if (!profile) throw new Error(`unknown scale profile: ${options.profile}`);
  const synthetic = makeSyntheticFiles(profile);
  const root = mkdtempSync(join(tmpdir(), `wiki-scale-${profile.name}-`));
  try {
    runGit(root, ["init", "-q"]);
    runGit(root, ["config", "user.name", "Wiki Scale Benchmark"]);
    runGit(root, ["config", "user.email", "wiki-scale@example.invalid"]);
    writeFiles(root, synthetic.files);
    runGit(root, ["add", "-A"]);
    runGit(root, ["commit", "-qm", `deterministic ${profile.name} scale profile`]);
    const view = createRepoView(root);
    const inputManifest = view.listFiles().map((path) => ({ path, digest: hashContent(view.read(path)), bytes: Buffer.byteLength(view.read(path), "utf8") }));
    const inputDigest = hashContent(jsonStable(inputManifest));
    const inputBytes = inputManifest.reduce((total, item) => total + item.bytes, 0);
    const phases: ScalePhase[] = [];
    const loadedMeasured = measure("loadWikiPages", inputManifest.length, inputBytes, () => loadWikiPages(view), (value) => ({ count: value.pages.length, bytes: value.pages.reduce((total, page) => total + Buffer.byteLength(page.raw, "utf8"), 0) }));
    phases.push(loadedMeasured.phase);
    const loaded = loadedMeasured.value;
    const validationMeasured = measure("validatePages", loaded.pages.length, inputBytes, () => validatePages(view, loaded.pages), (value) => ({ count: value.length, bytes: Buffer.byteLength(jsonStable(value), "utf8") }));
    phases.push(validationMeasured.phase);
    const queueMeasured = measure("buildWorkQueue", loaded.pages.length, inputBytes, () => buildWorkQueue(loaded.pages), (value) => ({ count: Object.values(value.groups).reduce((total, items) => total + items.length, 0), bytes: Buffer.byteLength(jsonStable(value), "utf8") }));
    phases.push(queueMeasured.phase);
    const searchMeasured = measure("searchWikiPages", loaded.pages.length, inputBytes, () => searchWikiPages(loaded.pages, "synthetic scale"), (value) => ({ count: value.length, bytes: Buffer.byteLength(jsonStable(value.map((match) => ({ id: match.page.data.id, score: match.score }))), "utf8") }));
    phases.push(searchMeasured.phase);
    const generatedMeasured = measure("generatedViews", loaded.pages.length, inputBytes, () => generatedCoreFiles(loaded.pages, "Scale benchmark"), (value) => ({ count: Object.keys(value).length, bytes: generatedBytes(value) }));
    phases.push(generatedMeasured.phase);
    const generated = generatedMeasured.value;
    const secondGenerated = generatedCoreFiles(loaded.pages, "Scale benchmark");
    const graph = JSON.parse(generated[".wiki/relationship-graph.json"] ?? "{}") as RelationshipGraph;
    const catalog = generated["wiki/catalog.md"] ?? "";
    const catalogIds = [...catalog.matchAll(/^\| \[([^\]]+)\]\(\.\/[^)]+\) \|/gm)].map((match) => match[1]).sort((a, b) => a.localeCompare(b));
    const expectedCatalogIds = loaded.pages.map((page) => page.data.id).sort((a, b) => a.localeCompare(b));
    const catalogComplete = catalogIds.length === expectedCatalogIds.length
      && new Set(catalogIds).size === expectedCatalogIds.length
      && catalogIds.every((id, index) => id === expectedCatalogIds[index]);
    const catalogPages = catalogIds.length;
    const generatedDigest = hashContent(jsonStable(generated));
    const secondDigest = hashContent(jsonStable(secondGenerated));
    const validationFindings = [...loaded.findings, ...validationMeasured.value];
    const current = loaded.pages.filter((page) => page.data.status === "current").length;
    const proposals = loaded.pages.filter((page) => page.data.status === "proposed").length;
    const totalConflicts = loaded.pages.filter((page) => page.data.kind === "conflict").length;
    const openConflicts = loaded.pages.filter((page) => page.data.kind === "conflict" && page.data.status === "conflicted").length;
    const rootIndexBytes = Buffer.byteLength(generated["wiki/index.md"] ?? "", "utf8");
    const peak = Math.max(...phases.map((phase) => phase.peak_rss_bytes), rss());
    const engineTotal = Number(phases.reduce((total, phase) => total + phase.wall_ms, 0).toFixed(3));
    const enforce = options.enforce ?? false;
    const limits = { max_engine_phase_ms: SCALE_ENGINE_PHASE_LIMIT_MS, max_peak_rss_bytes: 1_073_741_824, max_root_index_bytes: 65_536 };
    const queueWorkItems = Object.values(queueMeasured.value.groups).reduce((total, items) => total + items.length, 0);
    const profileCountsExact = current === profile.currentPages
      && proposals === profile.proposalPages
      && queueWorkItems === profile.workItems
      && totalConflicts === profile.conflicts
      && openConflicts === profile.openConflicts
      && totalConflicts - openConflicts === profile.resolvedConflicts
      && synthetic.sourceFiles.length === profile.declaredSourceFiles
      && catalogPages === profile.currentPages + profile.proposalPages + profile.conflicts;
    const correctness = {
      validation_findings: validationFindings.length,
      validation_finding_codes: validationFindings.map((finding) => finding.code).sort(),
      profile_counts_exact: profileCountsExact,
      queue_work_items: queueWorkItems,
      graph_has_no_source_nodes: !graph.nodes.some((node) => node.id.startsWith("src/")),
      catalog_complete: catalogComplete,
      graph_counts_exact: graphCorrect(graph, profile, synthetic.expectedGraphEdges),
      root_index_bounded: rootIndexBytes <= limits.max_root_index_bytes,
      generated_deterministic: generatedDigest === secondDigest,
      search_exercised: searchMeasured.value.length === loaded.pages.length,
    };
    const passed = !enforce || (enginePhasesWithinLimit(phases, limits.max_engine_phase_ms)
      && peak <= limits.max_peak_rss_bytes
      && correctness.validation_findings === 0
      && correctness.profile_counts_exact
      && correctness.queue_work_items === profile.workItems
      && correctness.graph_counts_exact
      && correctness.catalog_complete
      && correctness.graph_has_no_source_nodes
      && correctness.generated_deterministic
      && correctness.search_exercised
      && correctness.root_index_bounded);
    const report: ScaleBenchmarkReport = {
      version: 1,
      environment: {
        bun_version: process.versions.bun ?? Bun.version,
        platform: process.platform,
        arch: process.arch,
        cpu_model: cpus()[0]?.model ?? "unknown",
        logical_cpus: cpus().length,
      },
      profile,
      profile_digest: hashContent(jsonStable(profile)),
      input_digest: inputDigest,
      output_digest: generatedDigest,
      phases,
      engine_total_ms: engineTotal,
      peak_rss_bytes: peak,
      counts: {
        current_pages: current,
        proposal_pages: proposals,
        work_items: correctness.queue_work_items,
        total_conflicts: totalConflicts,
        open_conflicts: openConflicts,
        resolved_conflicts: totalConflicts - openConflicts,
        catalog_pages: catalogPages,
        graph_nodes: graph.nodes.length,
        graph_edges: graph.edges.length,
        source_files: synthetic.sourceFiles.length,
        search_matches: searchMeasured.value.length,
      },
      correctness,
      enforcement: { requested: enforce, passed, limits },
    };
    if (enforce && !passed) throw new Error(`scale profile ${profile.name} failed enforcement boundary`);
    return report;
  } finally {
    if (!options.keep) rmSync(root, { recursive: true, force: true });
  }
}

export function renderScaleMarkdown(report: ScaleBenchmarkReport): string {
  const { profile, counts, correctness, enforcement } = report;
  const displayCorrectnessValue = (value: unknown): string => {
    if (Array.isArray(value) && value.length === 0) return "";
    if (typeof value === "string" && value.length === 0) return "";
    return String(value);
  };
  return [
    `# Wiki scale benchmark: ${profile.name}`,
    "",
    `Profile digest: \`${report.profile_digest}\``,
    `Input digest: \`${report.input_digest}\``,
    `Output digest: \`${report.output_digest}\``,
    "",
    "## Environment",
    "",
    `- Bun: ${report.environment.bun_version}`,
    `- Platform: ${report.environment.platform}`,
    `- Architecture: ${report.environment.arch}`,
    `- CPU: ${report.environment.cpu_model}`,
    `- Logical CPUs: ${report.environment.logical_cpus}`,
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Engine phase total (ms) | ${report.engine_total_ms} |`,
    `| Engine phase limit (ms) | ${enforcement.limits.max_engine_phase_ms} |`,
    `| Peak RSS (bytes) | ${report.peak_rss_bytes} |`,
    `| Current pages | ${counts.current_pages} |`,
    `| Proposal pages | ${counts.proposal_pages} |`,
    `| Work items | ${counts.work_items} |`,
    `| Total conflicts | ${counts.total_conflicts} |`,
    `| Open conflicts | ${counts.open_conflicts} |`,
    `| Resolved conflicts | ${counts.resolved_conflicts} |`,
    `| Catalog pages | ${counts.catalog_pages} |`,
    `| Graph nodes | ${counts.graph_nodes} |`,
    `| Graph edges | ${counts.graph_edges} |`,
    `| Declared source files | ${counts.source_files} |`,
    "",
    "## Correctness",
    "",
    ...Object.entries(correctness).map(([key, value]) => {
      const display = displayCorrectnessValue(value);
      return display === "" ? `- ${key}` : `- ${key}: ${display}`;
    }),
    "",
    `Enforcement requested: ${enforcement.requested}; passed: ${enforcement.passed}.`,
    "",
  ].join("\n");
}

function argumentValue(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : undefined;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const profile = argumentValue(args, "--profile") as ScaleProfile["name"] | undefined;
  const report = runScaleBenchmark({ profile, enforce: args.includes("--enforce") });
  const outputJson = argumentValue(args, "--output-json");
  const outputMarkdown = argumentValue(args, "--output-markdown");
  if (outputJson) {
    mkdirSync(dirname(outputJson), { recursive: true });
    writeFileSync(outputJson, jsonStable(report), "utf8");
  }
  if (outputMarkdown) {
    mkdirSync(dirname(outputMarkdown), { recursive: true });
    writeFileSync(outputMarkdown, renderScaleMarkdown(report), "utf8");
  }
  process.stdout.write(jsonStable(report));
}
