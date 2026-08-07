#!/usr/bin/env bun

/**
 * KM-07 publisher-only exit evidence.
 *
 * The exit report measures the current source tree and rendered kit against the
 * pinned KM-00 JSON. It never uses a model/provider, never records a timestamp,
 * and never binds its result to the current HEAD: source and manifest digests
 * are the exact inputs that identify this measurement.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import {
  compilerSurface,
  KIT_MODULARITY_BASELINE_REVISION,
  type ExportSymbol,
  type ImportEdge,
  type KitModularityBaselineReport,
  type ModuleSurface,
} from "./kit-modularity-baseline";
import { KIT_CONTRACT_AREAS, type KitContractArea } from "./kit-growth-guard";
import { buildKitGrowthReport } from "./kit-growth-guard";
import { KIT_ENTRIES, kitFiles } from "./kit-packaging";
import { createRepoView } from "./repository-view";
import { jsonStable } from "./serialization";
import { discoverWikiTestFiles } from "./test-runner";

export const KM07_EXIT_BASELINE_REVISION = KIT_MODULARITY_BASELINE_REVISION;
export const KM07_EXIT_KIND = "km-07-portable-kit-final" as const;
export const KM07_EXIT_JSON_PATH = "docs/evidence/km-07-portable-kit-final.json";
export const KM07_EXIT_MARKDOWN_PATH = "docs/evidence/km-07-portable-kit-final.md";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const DEFAULT_BASELINE_PATH = join(PROJECT_ROOT, "docs/evidence/km-00-portable-kit-baseline.json");
const DEFAULT_JSON_PATH = join(PROJECT_ROOT, KM07_EXIT_JSON_PATH);
const DEFAULT_MARKDOWN_PATH = join(PROJECT_ROOT, KM07_EXIT_MARKDOWN_PATH);
const MANIFEST_TARGET = "kit/files/.wiki/kit-manifest.json";

type Metric = { lines: number; bytes: number };
type DigestRecord = { path: string; sha256: string; lines: number; bytes: number };

export type KitModuleComparison = {
  path: string;
  contractArea: KitContractArea | null;
  baseline: { metric: Metric; exports: ExportSymbol[]; dependencies: ImportEdge[] } | null;
  current: { metric: Metric; exports: ExportSymbol[]; dependencies: ImportEdge[] } | null;
  delta: Metric;
  exports: { added: string[]; removed: string[]; unchanged: string[] };
  dependencies: { added: string[]; removed: string[]; unchanged: string[] };
};

export type KitTestOwnership = {
  path: string;
  owner: string;
  contractArea: KitContractArea | null;
  testCount: number;
  describeCount: number;
  shipped: boolean;
};

export type KitPayloadTotals = {
  files: number;
  lines: number;
  bytes: number;
  manifestFiles: number;
  toolingFiles: number;
  toolingLines: number;
  toolingBytes: number;
  manifestDigest: string;
};

export type KitChangedFile = {
  path: string;
  status: string;
  baseline: Metric;
  current: Metric;
  delta: Metric;
};

export type KitChangedBreadth = {
  baseRevision: string;
  excluded: string[];
  files: KitChangedFile[];
  fileCount: number;
  addedLines: number;
  deletedLines: number;
  addedBytes: number;
  deletedBytes: number;
  digest: string;
};

export type KitModularityExitReport = {
  reportVersion: 1;
  contractVersion: 1;
  kind: typeof KM07_EXIT_KIND;
  baseline: {
    revision: typeof KM07_EXIT_BASELINE_REVISION;
    manifestDigest: string;
    entriesDigest: string;
    payload: KitPayloadTotals;
    modules: { paths: string[]; totals: Metric };
    testCount: number;
  };
  current: {
    sourceTreeDigest: string;
    manifestDigest: string;
    entriesDigest: string;
    payload: KitPayloadTotals;
    modules: { paths: string[]; totals: Metric };
    testCount: number;
  };
  modules: {
    paths: string[];
    files: Record<string, KitModuleComparison>;
    currentImportEdges: ImportEdge[];
    currentExports: Record<string, string[]>;
    allPurposeProductionModules: string[];
  };
  tests: {
    ownership: Record<string, KitTestOwnership>;
    baselineOwnership: Record<string, { testCount: number; describeCount: number; shipped: boolean }>;
    discoveredExactlyOnce: boolean;
    contractAreas: Record<string, KitContractArea | null>;
  };
  payload: {
    baseline: KitPayloadTotals;
    current: KitPayloadTotals;
    regressionExplanations: string[];
  };
  cli: {
    path: "scripts/wiki/cli.ts";
    baseline: Metric;
    current: Metric;
    lineThreshold: 250;
    thin: boolean;
    result: "pass" | "fail";
  };
  exception: {
    path: "scripts/wiki/review-bundle.ts";
    baseline: Metric;
    current: Metric;
    lineCap: 1_000;
    byteCap: 69_632;
    used: boolean;
    withinCap: boolean;
    disposition: string;
  };
  changes: KitChangedBreadth;
  digests: {
    sourceTree: string;
    manifest: string;
    entries: string;
    changedFiles: string;
  };
  method: {
    modelCalls: 0;
    providerCalls: 0;
    sourceEncoding: "UTF-8";
    lineDefinition: "LF byte count; a final newline contributes one line";
    moduleSurface: string;
    changedFiles: string;
    reportInputs: string;
  };
  summary: {
    status: "pass" | "fail";
    baselineRevision: typeof KM07_EXIT_BASELINE_REVISION;
    baselineVsCurrent: string;
    noAllPurposeProductionModule: boolean;
    cliThin: boolean;
    exceptionWithinCap: boolean;
  };
};

export type KitModularityExitOptions = {
  root?: string;
  baselinePath?: string;
  baselineReport?: KitModularityBaselineReport;
  baselineRevision?: string;
  excludePaths?: string[];
};

function metric(value: string | Uint8Array | null | undefined): Metric {
  if (value == null) return { lines: 0, bytes: 0 };
  const source = typeof value === "string" ? value : Buffer.from(value).toString("utf8");
  return { lines: (source.match(/\n/g) ?? []).length, bytes: Buffer.byteLength(source, "utf8") };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sorted<T>(values: Iterable<T>, compare = (left: T, right: T) => String(left).localeCompare(String(right))): T[] {
  return [...values].sort(compare);
}

function git(root: string, args: string[]): { ok: boolean; stdout: string } {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, stdout: result.stdout.toString() };
}

function stableDigest(value: unknown): string {
  return sha256(jsonStable(value));
}

function entryRecords() {
  return KIT_ENTRIES.map((entry) => ({ target: entry.target, placement: entry.placement, source: entry.source }));
}

function sourcePathFor(entry: (typeof KIT_ENTRIES)[number]): string {
  return entry.source.kind === "copy" || entry.source.kind === "strip" ? entry.source.from : entry.target;
}

function ownerForTest(path: string): string {
  const name = path.replace(/^scripts\/wiki\//, "").replace(/\.test\.ts$/, "");
  if (name === "kit-growth-guard") return "portable module growth guard contract";
  if (name.startsWith("fresh-context")) return "fresh-context review contract";
  if (name.startsWith("wiki-")) return "Wiki engine contract";
  if (name.startsWith("work-")) return "work/context contract";
  if (name.startsWith("kit-")) return "portable kit packaging contract";
  if (name === "test-runner") return "portable test discovery contract";
  if (name.startsWith("cli-")) return "CLI contract";
  return `${name} contract`;
}

function areaForPath(path: string): KitContractArea | null {
  return KIT_CONTRACT_AREAS[path] ?? (path.endsWith(".test.ts") ? "regression" : null);
}

function testCounts(path: string, content: string): { testCount: number; describeCount: number } {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  let testCount = 0;
  let describeCount = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === "test" || node.expression.text === "it") testCount += 1;
      if (node.expression.text === "describe") describeCount += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { testCount, describeCount };
}

function metricTotals(items: Iterable<Metric>): Metric {
  return [...items].reduce((sum, item) => ({ lines: sum.lines + item.lines, bytes: sum.bytes + item.bytes }), { lines: 0, bytes: 0 });
}

function exportNames(exports: ExportSymbol[]): string[] {
  return sorted(new Set(exports.map((item) => `${item.name}:${item.kind}:${item.typeOnly ? "type" : "value"}`)));
}

function dependencyNames(imports: ImportEdge[]): string[] {
  return sorted(new Set(imports.map((item) => `${item.kind}:${item.specifier}->${item.resolved ?? "?"}:${item.typeOnly ? "type" : "value"}:${item.names.join(",")}`)));
}

function surfacePart(surface: ModuleSurface | undefined): { metric: Metric; exports: ExportSymbol[]; dependencies: ImportEdge[] } | null {
  return surface == null ? null : { metric: surface.metric, exports: surface.exports, dependencies: surface.imports };
}

function differences(left: string[], right: string[]): { added: string[]; removed: string[]; unchanged: string[] } {
  const a = new Set(left); const b = new Set(right);
  return {
    added: sorted([...b].filter((item) => !a.has(item))),
    removed: sorted([...a].filter((item) => !b.has(item))),
    unchanged: sorted([...a].filter((item) => b.has(item))),
  };
}

function sourceRecords(root: string): { records: DigestRecord[]; contents: Record<string, string>; entries: typeof KIT_ENTRIES } {
  const view = createRepoView(root);
  const entries = KIT_ENTRIES.filter((entry) => entry.placement === "files" && entry.target.startsWith("scripts/wiki/") && entry.target.endsWith(".ts"));
  const contents: Record<string, string> = {};
  for (const entry of entries) {
    const sourcePath = sourcePathFor(entry);
    contents[entry.target] = view.exists(sourcePath) ? view.read(sourcePath) : "";
  }
  const records = sorted(Object.entries(contents).map(([path, content]) => ({ path, sha256: sha256(content), ...metric(content) })), (a, b) => a.path.localeCompare(b.path));
  return { records, contents, entries };
}

function renderedPayload(root: string, source: ReturnType<typeof sourceRecords>): { payload: KitPayloadTotals; manifest: Record<string, unknown>; generated: Record<string, string> } {
  const view = createRepoView(root);
  const rendered = kitFiles(view);
  if (rendered.findings.length > 0) throw new Error(`cannot render current kit: ${rendered.findings.map((finding) => finding.message).join("; ")}`);
  const manifestText = rendered.files[MANIFEST_TARGET];
  if (manifestText == null) throw new Error(`current kit is missing ${MANIFEST_TARGET}`);
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  const manifestFiles = (manifest.files ?? {}) as Record<string, unknown>;
  const managed = (manifest.managed ?? {}) as Record<string, unknown>;
  const reference = (manifest.reference ?? {}) as Record<string, unknown>;
  // `rendered.files` is the exact kit payload map. Its lines/bytes are the
  // apples-to-apples payload measured against KM-00's generated kit paths.
  const allMetrics = Object.values(rendered.files).map((content) => metric(content));
  const toolingEntries = source.entries;
  const tooling = metricTotals(toolingEntries.map((entry) => metric(source.contents[entry.target])));
  return {
    payload: {
      files: Object.keys(rendered.files).length,
      lines: metricTotals(allMetrics).lines,
      bytes: metricTotals(allMetrics).bytes,
      manifestFiles: Object.keys(manifestFiles).length + Object.keys(managed).length + Object.keys(reference).length,
      toolingFiles: toolingEntries.length,
      toolingLines: tooling.lines,
      toolingBytes: tooling.bytes,
      manifestDigest: String(manifest.digest ?? ""),
    },
    manifest,
    generated: rendered.files,
  };
}

function baselinePayload(root: string, report: KitModularityBaselineReport): KitPayloadTotals {
  const manifest = report.kit.manifest as Record<string, unknown>;
  const files = Object.keys((manifest.files ?? {}) as Record<string, unknown>);
  const managed = Object.keys((manifest.managed ?? {}) as Record<string, unknown>);
  const reference = Object.keys((manifest.reference ?? {}) as Record<string, unknown>);
  const generatedKitPaths = report.kit.generatedPaths.filter((path) => path.startsWith("kit/"));
  const generatedContents = generatedKitPaths.map((path) => baselineContent(root, report.exactRevision, path));
  const generatedMetric = metricTotals(generatedContents.map((content) => metric(content)));
  return {
    files: generatedKitPaths.length,
    lines: generatedMetric.lines,
    bytes: generatedMetric.bytes,
    manifestFiles: files.length + managed.length + reference.length,
    toolingFiles: report.modules.paths.length,
    // Compare the same TypeScript-only total on both sides; copiedTooling also
    // includes tsconfig.json in KM-00 and is not a source-module metric.
    toolingLines: report.modules.typeScriptTotals.lines,
    toolingBytes: report.modules.typeScriptTotals.bytes,
    manifestDigest: report.kit.manifestDigest,
  };
}

function baselineReport(root: string, options: KitModularityExitOptions): KitModularityBaselineReport {
  if (options.baselineReport != null) return options.baselineReport;
  const path = options.baselinePath ?? join(root, "docs/evidence/km-00-portable-kit-baseline.json");
  if (!existsSync(path)) throw new Error(`KM-00 baseline evidence is missing: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as KitModularityBaselineReport;
}

function baselineContent(root: string, revision: string, path: string): string {
  const result = git(root, ["show", `${revision}:${path}`]);
  return result.ok ? result.stdout : "";
}

function changedBreadth(root: string, revision: string, excludePaths: string[]): KitChangedBreadth {
  const excluded = sorted(new Set(excludePaths));
  const excludedSet = new Set(excluded);
  const entries = new Map<string, string>();
  const diff = git(root, ["diff", "--name-status", revision, "--"]).stdout;
  for (const line of diff.split(/\r?\n/).filter(Boolean)) {
    const columns = line.split(/\t+/);
    const status = columns[0].trim();
    const path = columns[columns.length - 1];
    if (path && !excludedSet.has(path)) entries.set(path, status);
  }
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]).stdout;
  for (const path of untracked.split(/\r?\n/).filter(Boolean)) if (!excludedSet.has(path)) entries.set(path, "??");
  const files = sorted([...entries.entries()].map(([path, status]) => {
    const currentPath = join(root, path);
    const current = existsSync(currentPath) ? readFileSync(currentPath) : null;
    const before = baselineContent(root, revision, path);
    const baselineMetric = metric(before || (status === "??" ? null : before));
    const currentMetric = metric(current);
    return { path, status, baseline: baselineMetric, current: currentMetric, delta: { lines: currentMetric.lines - baselineMetric.lines, bytes: currentMetric.bytes - baselineMetric.bytes } };
  }), (a, b) => a.path.localeCompare(b.path));
  const addedLines = files.reduce((sum, item) => sum + Math.max(0, item.delta.lines), 0);
  const deletedLines = files.reduce((sum, item) => sum + Math.max(0, -item.delta.lines), 0);
  const addedBytes = files.reduce((sum, item) => sum + Math.max(0, item.delta.bytes), 0);
  const deletedBytes = files.reduce((sum, item) => sum + Math.max(0, -item.delta.bytes), 0);
  return {
    baseRevision: revision,
    excluded,
    files,
    fileCount: files.length,
    addedLines,
    deletedLines,
    addedBytes,
    deletedBytes,
    digest: stableDigest(files),
  };
}

function currentTests(source: ReturnType<typeof sourceRecords>): { ownership: Record<string, KitTestOwnership>; total: number } {
  const ownership: Record<string, KitTestOwnership> = {};
  for (const entry of source.entries.filter((item) => item.target.endsWith(".test.ts"))) {
    const counts = testCounts(entry.target, source.contents[entry.target]);
    ownership[entry.target] = {
      path: entry.target,
      owner: ownerForTest(entry.target),
      contractArea: areaForPath(entry.target),
      testCount: counts.testCount,
      describeCount: counts.describeCount,
      shipped: true,
    };
  }
  return { ownership: Object.fromEntries(Object.entries(ownership).sort(([a], [b]) => a.localeCompare(b))), total: Object.values(ownership).reduce((sum, item) => sum + item.testCount, 0) };
}

function discoveredShippedTestsExactlyOnce(root: string, source: ReturnType<typeof sourceRecords>): boolean {
  const shipped = source.entries.filter((entry) => entry.target.endsWith(".test.ts")).map((entry) => entry.target).sort();
  const entries = new Map<string, number>();
  for (const entry of source.entries) entries.set(entry.target, (entries.get(entry.target) ?? 0) + 1);
  if (shipped.some((path) => entries.get(path) !== 1)) return false;
  let discovered: string[];
  try { discovered = discoverWikiTestFiles(root); } catch { return false; }
  return shipped.every((path) => discovered.filter((candidate) => candidate === path).length === 1);
}

function buildExit(root: string, options: KitModularityExitOptions = {}): KitModularityExitReport {
  const baseline = baselineReport(root, options);
  const source = sourceRecords(root);
  const currentSurface = compilerSurface(root, source.entries.map((entry) => sourcePathFor(entry)));
  const currentPayload = renderedPayload(root, source);
  const currentTestsReport = currentTests(source);
  const growth = buildKitGrowthReport(root);
  const baselineModules = baseline.modules.files;
  const paths = sorted(new Set([...Object.keys(baselineModules), ...Object.keys(currentSurface.files)]));
  const files: Record<string, KitModuleComparison> = {};
  for (const path of paths) {
    const before = baselineModules[path];
    const after = currentSurface.files[path];
    const baselinePart = before == null ? null : { metric: before.metric, exports: before.exports, dependencies: before.imports };
    const currentPart = surfacePart(after);
    const delta = { lines: (currentPart?.metric.lines ?? 0) - (baselinePart?.metric.lines ?? 0), bytes: (currentPart?.metric.bytes ?? 0) - (baselinePart?.metric.bytes ?? 0) };
    files[path] = {
      path,
      contractArea: areaForPath(path),
      baseline: baselinePart,
      current: currentPart,
      delta,
      exports: differences(exportNames(baselinePart?.exports ?? []), exportNames(currentPart?.exports ?? [])),
      dependencies: differences(dependencyNames(baselinePart?.dependencies ?? []), dependencyNames(currentPart?.dependencies ?? [])),
    };
  }
  const baselineTests: Record<string, { testCount: number; describeCount: number; shipped: boolean }> = {};
  for (const [path, suite] of Object.entries(baseline.tests.suites)) if (path.endsWith(".test.ts")) baselineTests[path] = { testCount: suite.testCount, describeCount: suite.describeCount, shipped: suite.shipped };
  const baselinePayloadTotals = baselinePayload(root, baseline);
  const moduleTotals = metricTotals(Object.values(currentSurface.files).map((item) => item.metric));
  const currentManifestDigest = currentPayload.payload.manifestDigest;
  const sourceTreeDigest = stableDigest(source.records);
  const entriesDigest = stableDigest(entryRecords());
  const changed = changedBreadth(root, options.baselineRevision ?? KM07_EXIT_BASELINE_REVISION, options.excludePaths ?? [KM07_EXIT_JSON_PATH, KM07_EXIT_MARKDOWN_PATH]);
  const cliCurrent = currentSurface.files["scripts/wiki/cli.ts"]?.metric ?? metric(null);
  const cliBaseline = baselineModules["scripts/wiki/cli.ts"]?.metric ?? metric(null);
  const reviewCurrent = currentSurface.files["scripts/wiki/review-bundle.ts"]?.metric ?? metric(null);
  const reviewBaseline = baselineModules["scripts/wiki/review-bundle.ts"]?.metric ?? metric(null);
  const exceptionWithinCap = reviewCurrent.lines <= 1_000 && reviewCurrent.bytes <= 69_632;
  const regressions: string[] = [];
  if (currentPayload.payload.toolingBytes > baselinePayloadTotals.toolingBytes) regressions.push("Portable payload bytes grew because KM-06 preserves split regression coverage and KM-07 ships the guard plus its regression test; this is measured rather than hidden.");
  if (currentPayload.payload.files > baselinePayloadTotals.files) regressions.push("Generated kit payload path count grew with preserved/split test fixtures and the shipped growth guard; adoption and upgrade assertions cover the added files.");
  if (reviewCurrent.bytes > 65_536) regressions.push("review-bundle.ts retains the single fail-closed exact-revision bundle exception; it remains bounded by 1,000 LF lines and 68 KiB (69,632 UTF-8 bytes).");
  if (regressions.length === 0) regressions.push("No measured payload regression beyond the pinned KM-00 baseline.");
  const ownership = currentTestsReport.ownership;
  const contractAreas = Object.fromEntries(source.entries.map((entry) => [entry.target, areaForPath(entry.target)]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
  const allPurposeProductionModules = sorted(new Set(growth.findings
    .filter((finding) => finding.contractArea === "production" && ["kit-growth-lines", "kit-growth-bytes", "kit-growth-cli"].includes(finding.code))
    .map((finding) => finding.path)));
  const discoveredExactlyOnce = discoveredShippedTestsExactlyOnce(root, source);
  const noAllPurposeProductionModule = allPurposeProductionModules.length === 0;
  return {
    reportVersion: 1,
    contractVersion: 1,
    kind: KM07_EXIT_KIND,
    baseline: {
      revision: KM07_EXIT_BASELINE_REVISION,
      manifestDigest: baseline.kit.manifestDigest,
      entriesDigest: baseline.kit.entriesDigest,
      payload: baselinePayloadTotals,
      modules: { paths: baseline.modules.paths, totals: baseline.modules.typeScriptTotals },
      testCount: Object.values(baselineTests).filter((suite) => suite.shipped).reduce((sum, suite) => sum + suite.testCount, 0),
    },
    current: {
      sourceTreeDigest,
      manifestDigest: currentManifestDigest,
      entriesDigest,
      payload: currentPayload.payload,
      modules: { paths: source.entries.map((entry) => entry.target).sort(), totals: moduleTotals },
      testCount: currentTestsReport.total,
    },
    modules: {
      paths,
      files,
      currentImportEdges: currentSurface.edges,
      currentExports: Object.fromEntries(Object.entries(currentSurface.files).sort(([a], [b]) => a.localeCompare(b)).map(([path, item]) => [path, exportNames(item.exports)])),
      // KM-07's initial exit target has no all-purpose production module. This
      // list is intentionally a structural result, not a second heuristic.
      allPurposeProductionModules,
    },
    tests: {
      ownership,
      baselineOwnership: baselineTests,
      discoveredExactlyOnce,
      contractAreas,
    },
    payload: { baseline: baselinePayloadTotals, current: currentPayload.payload, regressionExplanations: regressions },
    cli: {
      path: "scripts/wiki/cli.ts",
      baseline: cliBaseline,
      current: cliCurrent,
      lineThreshold: 250,
      thin: cliCurrent.lines <= 250,
      result: cliCurrent.lines <= 250 ? "pass" : "fail",
    },
    exception: {
      path: "scripts/wiki/review-bundle.ts",
      baseline: reviewBaseline,
      current: reviewCurrent,
      lineCap: 1_000,
      byteCap: 69_632,
      used: reviewCurrent.bytes > 65_536 || reviewCurrent.lines > 1_000,
      withinCap: exceptionWithinCap,
      disposition: "Retain the sole bounded exception for the fail-closed exact-revision bundle contract; do not split speculatively. Growth past 1,000 LF lines or 68 KiB requires a proven seam or explicit owner approval.",
    },
    changes: changed,
    digests: { sourceTree: sourceTreeDigest, manifest: currentManifestDigest, entries: entriesDigest, changedFiles: changed.digest },
    method: {
      modelCalls: 0,
      providerCalls: 0,
      sourceEncoding: "UTF-8",
      lineDefinition: "LF byte count; a final newline contributes one line",
      moduleSurface: "TypeScript compiler API createProgram/checker AST; exports and import/export declarations with type-only clauses",
      changedFiles: "git diff plus untracked working-tree paths since the pinned baseline; report outputs are excluded to avoid recursion",
      reportInputs: "Pinned KM-00 JSON, current KIT_ENTRIES, rendered kit manifest, and current source-tree content digests; no HEAD digest",
    },
    summary: {
      status: growth.ok && cliCurrent.lines <= 250 && exceptionWithinCap && discoveredExactlyOnce && noAllPurposeProductionModule ? "pass" : "fail",
      baselineRevision: KM07_EXIT_BASELINE_REVISION,
      baselineVsCurrent: `Portable TypeScript tooling is ${baselinePayloadTotals.toolingLines} lines/${baselinePayloadTotals.toolingBytes} bytes at KM-00 and ${currentPayload.payload.toolingLines} lines/${currentPayload.payload.toolingBytes} bytes now; exact generated kit payload has ${baselinePayloadTotals.files} versus ${currentPayload.payload.files} paths.`,
      noAllPurposeProductionModule,
      cliThin: cliCurrent.lines <= 250,
      exceptionWithinCap,
    },
  };
}

export function buildKitModularityExitReport(rootOrOptions: string | KitModularityExitOptions = PROJECT_ROOT, maybeOptions: KitModularityExitOptions = {}): KitModularityExitReport {
  const options = typeof rootOrOptions === "string" ? maybeOptions : rootOrOptions;
  const root = typeof rootOrOptions === "string" ? rootOrOptions : options.root ?? PROJECT_ROOT;
  return buildExit(root, options);
}

export const buildKM07ExitReport = buildKitModularityExitReport;
export const buildPortableKitFinalReport = buildKitModularityExitReport;
export const buildKitModularityFinalReport = buildKitModularityExitReport;

export function renderKitModularityExitJson(report: KitModularityExitReport): string {
  return jsonStable(report);
}

export const renderKM07ExitJson = renderKitModularityExitJson;
export const renderPortableKitFinalJson = renderKitModularityExitJson;

export function renderKitModularityExitMarkdown(report: KitModularityExitReport): string {
  const moduleRows = report.modules.paths.map((path) => {
    const item = report.modules.files[path];
    return `| \`${path}\` | ${item.baseline?.metric.lines ?? 0} | ${item.current?.metric.lines ?? 0} | ${item.baseline?.metric.bytes ?? 0} | ${item.current?.metric.bytes ?? 0} | ${item.contractArea ?? "unclassified"} |`;
  });
  const testRows = Object.values(report.tests.ownership).sort((a, b) => a.path.localeCompare(b.path)).map((item) => `| \`${item.path}\` | ${item.owner} | ${item.testCount} | ${item.contractArea ?? "unclassified"} |`);
  const changeRows = report.changes.files.slice(0, 80).map((item) => `| \`${item.path}\` | ${item.status} | ${item.delta.lines >= 0 ? "+" : ""}${item.delta.lines} | ${item.delta.bytes >= 0 ? "+" : ""}${item.delta.bytes} |`);
  return [
    "# KM-07 portable kit final exit evidence", "",
    `Status: **${report.summary.status.toUpperCase()}**.`, "",
    `Pinned KM-00 baseline: \`${report.baseline.revision}\`.`,
    `Measured source-tree digest: \`${report.digests.sourceTree}\`; rendered manifest digest: \`${report.digests.manifest}\`.`, "",
    "## Baseline versus current", "",
    report.summary.baselineVsCurrent, "",
    "| Module | KM-00 lines | Current lines | KM-00 bytes | Current bytes | Contract area |", "|---|---:|---:|---:|---:|---|", ...moduleRows, "",
    "## CLI and bounded exception", "",
    `- CLI entrypoint: ${report.cli.current.lines} LF lines (${report.cli.thin ? "thin/pass" : "over bound/fail"}; bound ${report.cli.lineThreshold}).`,
    `- review-bundle exception: ${report.exception.current.lines} lines / ${report.exception.current.bytes} bytes; ${report.exception.withinCap ? "within" : "over"} the 1,000-line/68 KiB cap.`,
    `- Disposition: ${report.exception.disposition}`, "",
    "## Payload and test ownership", "",
    `- Exact generated kit payload: ${report.payload.baseline.files} paths/${report.payload.baseline.lines} lines/${report.payload.baseline.bytes} bytes → ${report.payload.current.files} paths/${report.payload.current.lines} lines/${report.payload.current.bytes} bytes.`,
    `- Manifest-addressed entries: ${report.payload.baseline.manifestFiles} at KM-00 → ${report.payload.current.manifestFiles} now.`,
    `- Portable TypeScript tooling: ${report.payload.baseline.toolingLines} lines/${report.payload.baseline.toolingBytes} bytes → ${report.payload.current.toolingLines} lines/${report.payload.current.toolingBytes} bytes.`,
    ...report.payload.regressionExplanations.map((line) => `- ${line}`), "",
    "| Test suite | Named owner | Tests | Contract area |", "|---|---|---:|---|", ...testRows, "",
    "## Changed-file breadth", "",
    `- Since \`${report.changes.baseRevision}\`: ${report.changes.fileCount} files; +${report.changes.addedLines}/-${report.changes.deletedLines} LF lines; digest \`${report.changes.digest}\`.`,
    "| Path | Status | Δ lines | Δ bytes |", "|---|---|---:|---:|", ...changeRows, "",
    "## Determinism", "",
    "- Source and manifest digests are content-addressed; report files are excluded from changed-file breadth to avoid recursion.",
    "- Model/provider calls: 0/0; output uses sorted JSON keys and a trailing LF.", "",
  ].join("\n");
}

export const renderKM07ExitMarkdown = renderKitModularityExitMarkdown;
export const renderPortableKitFinalMarkdown = renderKitModularityExitMarkdown;

export type KitModularityExitEvidenceResult = { mode: "write" | "check"; messages: string[] };

export function writeKitModularityExitEvidence(
  report: KitModularityExitReport,
  jsonPath = DEFAULT_JSON_PATH,
  markdownPath = DEFAULT_MARKDOWN_PATH,
  check = false,
): KitModularityExitEvidenceResult {
  const json = renderKitModularityExitJson(report);
  const markdown = renderKitModularityExitMarkdown(report);
  if (check) {
    if (!existsSync(jsonPath) || readFileSync(jsonPath, "utf8") !== json || !existsSync(markdownPath) || readFileSync(markdownPath, "utf8") !== markdown) {
      throw new Error(`KM-07 exit evidence is stale: ${jsonPath}, ${markdownPath}`);
    }
    return { mode: "check", messages: ["KM-07 portable kit final evidence is current"] };
  }
  const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
  mkdirSync(dirname(jsonPath), { recursive: true });
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(jsonPath, json, "utf8");
  writeFileSync(markdownPath, markdown, "utf8");
  return { mode: "write", messages: [`wrote ${jsonPath}`, `wrote ${markdownPath}`] };
}

export const writeKM07ExitEvidence = writeKitModularityExitEvidence;
export const writeKitModularityFinalEvidence = writeKitModularityExitEvidence;

function flagValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? fallback : process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return resolve(value);
}

if (import.meta.main) {
  try {
    const root = flagValue("--root", PROJECT_ROOT);
    const report = buildKitModularityExitReport(root, { baselinePath: process.argv.includes("--baseline") ? flagValue("--baseline", DEFAULT_BASELINE_PATH) : undefined });
    const result = writeKitModularityExitEvidence(report, flagValue("--output", DEFAULT_JSON_PATH), flagValue("--markdown", DEFAULT_MARKDOWN_PATH), process.argv.includes("--check"));
    for (const message of result.messages) console.log(message);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
