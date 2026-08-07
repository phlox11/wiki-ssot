#!/usr/bin/env bun

/**
 * KM-07 portable-kit growth guard.
 *
 * This file deliberately keeps the policy and the measurement function free of
 * repository writes.  The command-line adapter at the bottom only reads the
 * source tree and reports the result, which makes the same contract usable by
 * shipped adopters and by focused unit tests.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRepoView } from "./repository-view";
import { KIT_ENTRIES, type KitEntry } from "./kit-packaging";
import { jsonStable } from "./serialization";

export const KIT_GROWTH_THRESHOLDS = {
  lineThreshold: 1_000,
  byteThreshold: 65_536,
  cliLineThreshold: 250,
  reviewBundle: {
    path: "scripts/wiki/review-bundle.ts",
    lineThreshold: 1_000,
    byteThreshold: 69_632,
    name: "review-bundle-exact-revision",
  },
} as const;

export const KIT_GROWTH_ACTION =
  "Split the contract, document and justify a bounded exception, or obtain owner approval to revise the bound.";

export type KitContractArea = "production" | "regression" | "test-fixture" | "test-infrastructure";

export type KitGrowthSource = {
  /** Target path as declared in KIT_ENTRIES. */
  path: string;
  content: string;
  /** A source path is useful for diagnostics when a generated target differs. */
  sourcePath?: string;
  /** Explicit classification; omitted values fail closed. */
  contractArea?: KitContractArea;
  /** Whether this is a ratified kit-owned boundary. Defaults to files. */
  placement?: string;
};

export type KitGrowthMeasurement = {
  path: string;
  sourcePath: string;
  contractArea: KitContractArea | null;
  lines: number;
  bytes: number;
  thresholds: {
    line: number;
    byte: number;
    cliLine?: number;
  };
  exception: {
    name: string;
    line: number;
    byte: number;
    used: boolean;
  } | null;
};

export type KitGrowthFinding = {
  code: "kit-growth-lines" | "kit-growth-bytes" | "kit-growth-cli" | "kit-growth-unclassified" | "kit-growth-exception" | "kit-growth-duplicate-entry";
  path: string;
  severity: "error";
  message: string;
  contractArea?: KitContractArea;
};

export type KitGrowthReport = {
  reportVersion: 1;
  kind: "km-07-kit-growth-guard";
  ok: boolean;
  thresholds: typeof KIT_GROWTH_THRESHOLDS;
  files: KitGrowthMeasurement[];
  findings: KitGrowthFinding[];
  exceptionsUsed: Array<{
    path: string;
    name: string;
    lines: number;
    bytes: number;
    lineCap: number;
    byteCap: number;
    disposition: string;
  }>;
  scope: {
    placement: "files";
    extension: ".ts";
    lineDefinition: "LF byte count; a final newline contributes one line";
    encoding: "UTF-8";
    totalRepositoryLinesIgnored: true;
  };
};

/** Explicit contract-area ownership for every currently shipped TypeScript file. */
export const KIT_CONTRACT_AREAS: Readonly<Record<string, KitContractArea>> = {
  "scripts/wiki/core.ts": "production",
  "scripts/wiki/verification.ts": "production",
  "scripts/wiki/impact.ts": "production",
  "scripts/wiki/review-bundle.ts": "production",
  "scripts/wiki/review-attestation.ts": "production",
  "scripts/wiki/kit-packaging.ts": "production",
  "scripts/wiki/kit-growth-guard.ts": "production",
  "scripts/wiki/kit-growth-guard.test.ts": "regression",
  "scripts/wiki/discovery.ts": "production",
  "scripts/wiki/context.ts": "production",
  "scripts/wiki/generated-views.ts": "production",
  "scripts/wiki/model.ts": "production",
  "scripts/wiki/serialization.ts": "production",
  "scripts/wiki/repository-view.ts": "production",
  "scripts/wiki/page-validation.ts": "production",
  "scripts/wiki/work-validation.ts": "production",
  "scripts/wiki/cli.ts": "production",
  "scripts/wiki/cli-runtime.ts": "production",
  "scripts/wiki/cli-render.ts": "production",
  "scripts/wiki/cli-discovery-handlers.ts": "production",
  "scripts/wiki/cli-generation-handlers.ts": "production",
  "scripts/wiki/cli-validation-handlers.ts": "production",
  "scripts/wiki/cli-review-handlers.ts": "production",
  "scripts/wiki/github-attestation.ts": "production",
  "scripts/wiki/test-fixtures/fresh-context.ts": "test-fixture",
  "scripts/wiki/test-fixtures/wiki.ts": "test-fixture",
  "scripts/wiki/test-fixtures/work.ts": "test-fixture",
  "scripts/wiki/fresh-context-manifest.test.ts": "regression",
  "scripts/wiki/fresh-context-preflight.test.ts": "regression",
  "scripts/wiki/fresh-context-report.test.ts": "regression",
  "scripts/wiki/fresh-context-github.test.ts": "regression",
  "scripts/wiki/fresh-context-integration.test.ts": "regression",
  // Historical KM-00 boundaries remain classified in exit comparisons even
  // though KM-06 replaced them with the split suites below.
  "scripts/wiki/fresh-context.test.ts": "regression",
  "scripts/wiki/kit-packaging.test.ts": "regression",
  "scripts/wiki/wiki-pages.test.ts": "regression",
  "scripts/wiki/wiki-generated-data.test.ts": "regression",
  "scripts/wiki/wiki-coverage.test.ts": "regression",
  "scripts/wiki/wiki-impact-conflicts.test.ts": "regression",
  "scripts/wiki/wiki-repository-hooks.test.ts": "regression",
  "scripts/wiki/wiki.test.ts": "regression",
  "scripts/wiki/work-selected-context.test.ts": "regression",
  "scripts/wiki/work-topic-context.test.ts": "regression",
  "scripts/wiki/work.test.ts": "regression",
  "scripts/wiki/discovery.test.ts": "regression",
  "scripts/wiki/context.test.ts": "regression",
  "scripts/wiki/generated-views.test.ts": "regression",
  "scripts/wiki/serialization.test.ts": "regression",
  "scripts/wiki/repository-view.test.ts": "regression",
  "scripts/wiki/page-validation.test.ts": "regression",
  "scripts/wiki/work-validation.test.ts": "regression",
  "scripts/wiki/core-facade.test.ts": "regression",
  "scripts/wiki/verification.test.ts": "regression",
  "scripts/wiki/cli-handlers.test.ts": "regression",
  "scripts/wiki/impact.test.ts": "regression",
  "scripts/wiki/review-bundle.test.ts": "regression",
  "scripts/wiki/review-attestation.test.ts": "regression",
  "scripts/wiki/test-runner.test.ts": "regression",
  "scripts/wiki/test-runner.ts": "test-infrastructure",
};

export type KitGrowthEvaluationInput =
  | Record<string, string>
  | KitGrowthSource[]
  | ReadonlyArray<KitGrowthSource>;

export type KitGrowthEvaluationOptions = {
  /** Restrict evaluation to these entries. Defaults to the publisher KIT_ENTRIES. */
  entries?: readonly Pick<KitEntry, "target" | "placement" | "source">[];
  /** Explicit area map, merged over the shipped defaults. */
  classifications?: Readonly<Record<string, KitContractArea>>;
  /** Allow tests to evaluate an unclassified boundary without mutating KIT_ENTRIES. */
  exceptions?: Readonly<Record<string, { name?: string; lineThreshold?: number; byteThreshold?: number }>>;
};

function lineCount(content: string): number {
  return (content.match(/\n/g) ?? []).length;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sourceEntries(input: KitGrowthEvaluationInput, options: KitGrowthEvaluationOptions): KitGrowthSource[] {
  if (Array.isArray(input)) return input
    .filter((item) => (item.placement ?? "files") === "files" && item.path.endsWith(".ts"))
    .map((item) => ({ ...item }));
  const entries = options.entries ?? KIT_ENTRIES;
  return entries
    .filter((entry) => entry.placement === "files" && entry.target.endsWith(".ts"))
    .map((entry) => {
      const source = entry.source.kind === "copy" || entry.source.kind === "strip" ? entry.source.from : entry.target;
      const files = input as Record<string, string>;
      return { path: entry.target, sourcePath: source, content: files[entry.target] ?? files[source] ?? "", placement: entry.placement };
    });
}

function finding(
  code: KitGrowthFinding["code"],
  path: string,
  message: string,
  contractArea?: KitContractArea,
): KitGrowthFinding {
  return { code, path, severity: "error", message, ...(contractArea == null ? {} : { contractArea }) };
}

function isContractArea(value: unknown): value is KitContractArea {
  return value === "production" || value === "regression" || value === "test-fixture" || value === "test-infrastructure";
}

/**
 * Pure, injectable evaluation of the ratified kit-owned TypeScript boundaries.
 * It never reads or writes the repository and intentionally ignores every path
 * outside `placement=files` entries.
 */
export function evaluateKitGrowth(
  input: KitGrowthEvaluationInput,
  options: KitGrowthEvaluationOptions = {},
): KitGrowthReport {
  const classifications = { ...KIT_CONTRACT_AREAS, ...(options.classifications ?? {}) };
  const entries = sourceEntries(input, options);
  const findings: KitGrowthFinding[] = [];
  const duplicateCounts = new Map<string, number>();
  for (const item of entries) duplicateCounts.set(item.path, (duplicateCounts.get(item.path) ?? 0) + 1);

  const files: KitGrowthMeasurement[] = [];
  for (const item of entries.sort((left, right) => left.path.localeCompare(right.path))) {
    const candidateArea = item.contractArea ?? classifications[item.path] ?? null;
    const area = isContractArea(candidateArea) ? candidateArea : null;
    const lines = lineCount(item.content);
    const bytes = Buffer.byteLength(item.content, "utf8");
    const exceptionConfig = options.exceptions?.[item.path]
      ?? (item.path === KIT_GROWTH_THRESHOLDS.reviewBundle.path ? KIT_GROWTH_THRESHOLDS.reviewBundle : undefined);
    const isReviewBundle = item.path === KIT_GROWTH_THRESHOLDS.reviewBundle.path;
    const exception = isReviewBundle && exceptionConfig
      ? {
        name: exceptionConfig.name ?? KIT_GROWTH_THRESHOLDS.reviewBundle.name,
        line: exceptionConfig.lineThreshold ?? KIT_GROWTH_THRESHOLDS.reviewBundle.lineThreshold,
        byte: exceptionConfig.byteThreshold ?? KIT_GROWTH_THRESHOLDS.reviewBundle.byteThreshold,
        used: lines > KIT_GROWTH_THRESHOLDS.lineThreshold || bytes > KIT_GROWTH_THRESHOLDS.byteThreshold,
      }
      : null;
    const measurement: KitGrowthMeasurement = {
      path: item.path,
      sourcePath: item.sourcePath ?? item.path,
      contractArea: area,
      lines,
      bytes,
      thresholds: {
        line: exception?.line ?? KIT_GROWTH_THRESHOLDS.lineThreshold,
        byte: exception?.byte ?? KIT_GROWTH_THRESHOLDS.byteThreshold,
        ...(item.path === "scripts/wiki/cli.ts" ? { cliLine: KIT_GROWTH_THRESHOLDS.cliLineThreshold } : {}),
      },
      exception,
    };
    files.push(measurement);

    if ((duplicateCounts.get(item.path) ?? 0) > 1) {
      findings.push(finding("kit-growth-duplicate-entry", item.path,
        `${item.path} is listed more than once in KIT_ENTRIES. Ship the guard and every kit-owned boundary exactly once.`));
    }
    if (area == null) {
      findings.push(finding("kit-growth-unclassified", item.path,
        `${item.path} is a kit-owned TypeScript boundary without a named contract area. Classify it as production, regression, test-fixture, or test-infrastructure. ${KIT_GROWTH_ACTION}`));
      continue;
    }

    if (exception != null) {
      if (lines > exception.line || bytes > exception.byte) {
        findings.push(finding("kit-growth-exception", item.path,
          `${item.path} uses the bounded ${exception.name} exception but measures ${lines} LF lines and ${bytes} UTF-8 bytes (caps ${exception.line} lines/${exception.byte} bytes). ${KIT_GROWTH_ACTION}`,
          area));
      }
    } else {
      if (lines > KIT_GROWTH_THRESHOLDS.lineThreshold) {
        findings.push(finding("kit-growth-lines", item.path,
          `${item.path} is ${lines} LF lines, above the ${KIT_GROWTH_THRESHOLDS.lineThreshold}-line kit boundary. Split the contract or document and justify a bounded exception. ${KIT_GROWTH_ACTION}`,
          area));
      }
      if (bytes > KIT_GROWTH_THRESHOLDS.byteThreshold) {
        findings.push(finding("kit-growth-bytes", item.path,
          `${item.path} is ${bytes} UTF-8 bytes, above the ${KIT_GROWTH_THRESHOLDS.byteThreshold}-byte kit boundary. Split the contract or document and justify a bounded exception. ${KIT_GROWTH_ACTION}`,
          area));
      }
    }
    if (item.path === "scripts/wiki/cli.ts" && lines > KIT_GROWTH_THRESHOLDS.cliLineThreshold) {
      findings.push(finding("kit-growth-cli", item.path,
        `${item.path} is ${lines} LF lines, above the ${KIT_GROWTH_THRESHOLDS.cliLineThreshold}-line thin-entrypoint bound. Split the dispatcher contract or obtain owner approval to revise the bound. ${KIT_GROWTH_ACTION}`,
        area));
    }
  }

  const exceptionsUsed = files.filter((file) => file.exception?.used).map((file) => ({
    path: file.path,
    name: file.exception!.name,
    lines: file.lines,
    bytes: file.bytes,
    lineCap: file.exception!.line,
    byteCap: file.exception!.byte,
    disposition: "Retain only for the single fail-closed exact-revision bundle contract; split or obtain owner approval if it grows past the cap.",
  }));
  return {
    reportVersion: 1,
    kind: "km-07-kit-growth-guard",
    ok: findings.length === 0,
    thresholds: KIT_GROWTH_THRESHOLDS,
    files,
    findings,
    exceptionsUsed,
    scope: {
      placement: "files",
      extension: ".ts",
      lineDefinition: "LF byte count; a final newline contributes one line",
      encoding: "UTF-8",
      totalRepositoryLinesIgnored: true,
    },
  };
}

/** Evaluate the real source tree without writing any generated output. */
export function buildKitGrowthReport(root = resolve(import.meta.dir, "../..")): KitGrowthReport {
  const view = createRepoView(root);
  const entries = KIT_ENTRIES.filter((entry) => entry.placement === "files" && entry.target.endsWith(".ts"));
  const sources: KitGrowthSource[] = entries.map((entry) => {
    const sourcePath = entry.source.kind === "copy" || entry.source.kind === "strip" ? entry.source.from : entry.target;
    return {
      path: entry.target,
      sourcePath,
      content: view.exists(sourcePath) ? view.read(sourcePath) : "",
      placement: entry.placement,
    };
  });
  return evaluateKitGrowth(sources);
}

export const checkKitGrowth = buildKitGrowthReport;
export const evaluateKitGrowthGuard = evaluateKitGrowth;
export const buildKitGrowthGuardReport = buildKitGrowthReport;
export const runKitGrowthGuard = buildKitGrowthReport;
export const kitGrowthGuard = buildKitGrowthReport;

export function renderKitGrowthJson(report: KitGrowthReport): string {
  return jsonStable(report);
}

export const renderKitGrowthGuardJson = renderKitGrowthJson;

export function renderKitGrowthText(report: KitGrowthReport): string {
  if (report.ok) {
    const exception = report.exceptionsUsed.length === 0 ? "none" : report.exceptionsUsed.map((item) => item.path).join(", ");
    return `KM-07 kit growth guard passed (${report.files.length} kit-owned TypeScript files; exceptions: ${exception}).\n`;
  }
  return report.findings.map((item) => `ERROR [${item.code}] ${item.path}: ${item.message}`).join("\n") + "\n";
}

export type KitGrowthWriteResult = { mode: "check"; messages: string[] };

/** Check a rendered guard result without mutating the source tree. */
export function checkKitGrowthEvidence(report: KitGrowthReport, expectedJson: string): KitGrowthWriteResult {
  if (renderKitGrowthJson(report) !== expectedJson) throw new Error("KM-07 kit growth guard output is stale");
  return { mode: "check", messages: ["KM-07 kit growth guard is current"] };
}

function rootFlag(fallback: string): string {
  const index = process.argv.indexOf("--root");
  const value = index < 0 ? fallback : process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--root requires a value");
  return resolve(value);
}

if (import.meta.main) {
  try {
    const report = buildKitGrowthReport(rootFlag(resolve(import.meta.dir, "../..")));
    if (process.argv.includes("--json")) process.stdout.write(renderKitGrowthJson(report));
    else process.stdout.write(renderKitGrowthText(report));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

// Keep a small, stable export used by tests that need to prove the report is
// content-addressable without depending on a filesystem operation.
export function kitGrowthDigest(report: KitGrowthReport): string {
  return sha256(renderKitGrowthJson(report));
}
