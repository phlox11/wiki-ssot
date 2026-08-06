#!/usr/bin/env bun

/**
 * Publishing-only TE-06 exit validation.
 *
 * The harness measures one exact committed publisher revision, keeps successful
 * diagnostics compact and content-addressed, and makes no model/provider call.
 * A sanitized controlled-publisher after-case is supplied separately.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { jsonStable } from "./core";
import {
  buildPrimaryCurrentReportAtRevision,
  type PrimaryCurrentReport,
} from "./primary-current";
import { measureTe04FocusedReview } from "./te04-focused-review";
import {
  validateControlledPublisher,
  validateControlledPublisherPerformance,
  type ControlledPublisher,
} from "./token-efficiency-baseline";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");

/** Exact combined revision after TE-05, TE-01/02, and TE-04 were merged. */
export const TE06_COMBINED_REVISION = "76e5d97a410d8e67659835e059e7b721541113c5" as const;

export const TE06_CONTEXT_CASES = [
  { id: "focused", selector: "recursive source mapping", kind: "topic" },
  { id: "broad", selector: "token context runtime cost efficiency", kind: "topic" },
  { id: "selected-work", selector: "TE-00", kind: "work" },
] as const;

export const TE06_MISS_CLASSIFICATIONS = [
  "concrete defect",
  "owner decision",
  "orchestrator limitation",
  "accepted limitation",
] as const;

export const TE06_OWNER_OPTIONS = [
  "token efficiency validated",
  "another bounded cycle",
  "not adopted",
] as const;

export type Te06MissClassification = typeof TE06_MISS_CLASSIFICATIONS[number];

export type Te06RemainingMiss = {
  description: string;
  classification: Te06MissClassification;
  evidenceDigest: string;
};

type ContextMeasurement = {
  id: typeof TE06_CONTEXT_CASES[number]["id"];
  selector: string;
  compact: { textBytes: number; jsonBytes: number; textDigest: string; semanticDigest: string };
  full: { available: true; textBytes: number; jsonBytes: number; textDigest: string; semanticDigest: string };
  removed: { textBytes: number; jsonBytes: number };
  semanticParity: true;
};

type SuiteResult = {
  id: "primary" | "kit" | "new-adoption" | "existing-bootstrap" | "work-context" | "review-portable";
  command: string;
  success: true;
  passedChecks: number;
  resultDigest: string;
};

export type Te06ControlledAfter = {
  availability: "available";
  source: "separately supplied sanitized controlled publisher";
  publisher: ControlledPublisher;
};

export type Te06ExitValidationReport = {
  version: 1;
  workItem: "TE-06";
  exactRevision: string;
  deterministic: {
    modelCalls: 0;
    providerCalls: 0;
    contextMeasurements: ContextMeasurement[];
    primary: {
      exactRevision: string;
      scenarioCount: number;
      scenariosPassing: number;
      correctness: Record<string, boolean>;
      summaryDigest: string;
    };
    kitManifest: { digest: string; fileCount: number };
    focusedReview: {
      implementationRevision: string;
      bundleDigest: string;
      exactPass: true;
      portableFixtureCorrect: true;
      reviewerSourceBreadth: number;
      nonDiffBundleBytes: number;
    };
    suites: SuiteResult[];
  };
  controlledPublisherAfter: Te06ControlledAfter | {
    availability: "unavailable";
    source: "separately supplied sanitized controlled publisher";
    limitation: string;
  };
  attribution: {
    engineOwned: string[];
    repositoryGuidanceAndOptionalOrchestration: string[];
    cacheEffects: string[];
    guardianAndApprovalBehavior: string[];
    providerLimitations: string[];
  };
  remainingMisses: Te06RemainingMiss[];
  ownerDecision: {
    selectedOption: null;
    options: [...typeof TE06_OWNER_OPTIONS];
  };
  reportDigest: string;
};

type CommandResult = { exitCode: number; stdout: string; stderr: string };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function command(command: string[], cwd: string): CommandResult {
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, GITHUB_EVENT_NAME: undefined, WIKI_PR_BODY: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function required(commandLine: string[], cwd: string): string {
  const result = command(commandLine, cwd);
  if (result.exitCode !== 0) throw new Error(`${commandLine.join(" ")} failed\n${result.stderr || result.stdout}`);
  return result.stdout;
}

function exactRevision(root: string, revision: string): string {
  const resolved = required(["git", "rev-parse", `${revision}^{commit}`], root).trim();
  if (!/^[0-9a-f]{40}$/.test(resolved)) throw new Error(`TE-06 revision is not an exact commit: ${revision}`);
  return resolved;
}

function bodyDigest(value: Record<string, unknown>): string {
  if (typeof value.bodyDigest === "string") return value.bodyDigest;
  if (typeof value.body === "string") return sha256(value.body);
  throw new Error(`context entry ${String(value.id ?? value.path ?? "unknown")} has no body binding`);
}

function canonicalEntry(value: Record<string, unknown>): Record<string, unknown> {
  const omitted = new Set(["body", "bodyDigest", "focusedCommand"]);
  const common = Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));
  return { ...common, bodyDigest: bodyDigest(value) };
}

/** Canonicalize only semantics intentionally shared by compact and full modes. */
export function canonicalContextSemantics(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("context JSON must be an object");
  const value = input as Record<string, unknown>;
  const entries = (key: string) => Array.isArray(value[key])
    ? (value[key] as unknown[]).map((item) => canonicalEntry(item as Record<string, unknown>))
    : [];
  return {
    version: value.version,
    query: value.query,
    requestedWork: value.requestedWork,
    requestedConflict: value.requestedConflict,
    work: value.work,
    pages: entries("pages"),
    conflicts: entries("conflicts"),
    nonCurrentPages: entries("nonCurrentPages"),
    ownerPage: value.ownerPage && typeof value.ownerPage === "object"
      ? canonicalEntry(value.ownerPage as Record<string, unknown>)
      : null,
    readOrder: value.readOrder,
  };
}

function contextArgs(item: typeof TE06_CONTEXT_CASES[number], full: boolean, json: boolean): string[] {
  const selector = item.kind === "work" ? ["--work", item.selector] : [item.selector];
  return ["scripts/wiki/cli.ts", "context", ...selector, ...(full ? ["--full"] : []), ...(json ? ["--json"] : [])];
}

function measureContext(root: string, item: typeof TE06_CONTEXT_CASES[number]): ContextMeasurement {
  const compactText = required([process.execPath, ...contextArgs(item, false, false)], root);
  const fullText = required([process.execPath, ...contextArgs(item, true, false)], root);
  const compactJsonText = required([process.execPath, ...contextArgs(item, false, true)], root);
  const fullJsonText = required([process.execPath, ...contextArgs(item, true, true)], root);
  const compactSemantics = jsonStable(canonicalContextSemantics(JSON.parse(compactJsonText)));
  const fullSemantics = jsonStable(canonicalContextSemantics(JSON.parse(fullJsonText)));
  const compactSemanticDigest = sha256(compactSemantics);
  const fullSemanticDigest = sha256(fullSemantics);
  if (compactSemanticDigest !== fullSemanticDigest) throw new Error(`${item.id} compact/full semantic parity failed`);
  const compactTextBytes = Buffer.byteLength(compactText);
  const fullTextBytes = Buffer.byteLength(fullText);
  const compactJsonBytes = Buffer.byteLength(compactJsonText);
  const fullJsonBytes = Buffer.byteLength(fullJsonText);
  if (compactTextBytes >= fullTextBytes || compactJsonBytes >= fullJsonBytes) {
    throw new Error(`${item.id} compact output is not smaller than retained full output`);
  }
  return {
    id: item.id,
    selector: item.selector,
    compact: {
      textBytes: compactTextBytes,
      jsonBytes: compactJsonBytes,
      textDigest: sha256(compactText),
      semanticDigest: compactSemanticDigest,
    },
    full: {
      available: true,
      textBytes: fullTextBytes,
      jsonBytes: fullJsonBytes,
      textDigest: sha256(fullText),
      semanticDigest: fullSemanticDigest,
    },
    removed: { textBytes: fullTextBytes - compactTextBytes, jsonBytes: fullJsonBytes - compactJsonBytes },
    semanticParity: true,
  };
}

function suiteResult(root: string, id: SuiteResult["id"], path: string): SuiteResult {
  const result = command([process.execPath, "test", path, "--max-concurrency=1"], root);
  if (result.exitCode !== 0) throw new Error(`${path} failed\n${result.stderr || result.stdout}`);
  const output = `${result.stdout}\n${result.stderr}`;
  const passedChecks = Number(output.match(/(?:^|\n)\s*(\d+) pass(?:\n|$)/)?.[1] ?? 0);
  if (passedChecks < 1 || !/(?:^|\n)\s*0 fail(?:\n|$)/.test(output)) {
    throw new Error(`${path} did not expose a successful bounded test count`);
  }
  return {
    id,
    command: `bun test ${path} --max-concurrency=1`,
    success: true,
    passedChecks,
    resultDigest: sha256(jsonStable({ id, command: path, success: true, passedChecks })),
  };
}

function recallComplete(metric: { found: number; required: number; ratio: number }): boolean {
  return metric.found === metric.required && metric.ratio === 1;
}

function primaryCorrectness(report: PrimaryCurrentReport): Record<string, boolean> {
  const summary = report.summary;
  return {
    authority: recallComplete(summary.currentPageRecall) && recallComplete(summary.authorityLabelRecall),
    invariants: recallComplete(summary.invariantRecall),
    conflicts: recallComplete(summary.conflictRecall),
    sources: recallComplete(summary.implementationSourceRecall),
    statusAndNonCurrentSeparation: recallComplete(summary.nonCurrentAuthorityLabelRecall)
      && summary.nonCurrentSeparationMatches === summary.scenarioCount,
    expectedActions: recallComplete(summary.expectedChangeRecall)
      && summary.wikiActionMatches === summary.scenarioCount,
    coverage: summary.coveragePathCount === summary.mappedCoveragePathCount + summary.reasonedExclusionPathCount
      && summary.uncoveredPathCount === 0,
    impact: summary.candidateGatesPassing === summary.scenarioCount,
    drift: summary.driftProbeCount === summary.driftProbesCaught && summary.driftEscapeCount === 0,
  };
}

export function validateTe06RemainingMisses(misses: Te06RemainingMiss[]): Te06RemainingMiss[] {
  for (const miss of misses) {
    if (!TE06_MISS_CLASSIFICATIONS.includes(miss.classification)) {
      throw new Error(`unsupported TE-06 remaining-miss classification: ${miss.classification}`);
    }
    if (!miss.description.trim() || !/^[0-9a-f]{64}$/.test(miss.evidenceDigest)) {
      throw new Error("TE-06 remaining misses require a description and digest-addressed evidence");
    }
  }
  return misses;
}

export function validateTe06ControlledPublisherAfter(input: unknown, revision: string): ControlledPublisher {
  const publisher = validateControlledPublisher(input);
  validateControlledPublisherPerformance(publisher.performance);
  if (publisher.exactRevision !== revision) throw new Error("controlled publisher after-case does not bind the TE-06 exact revision");
  return publisher;
}

export function buildTe06ExitValidation(options: {
  root?: string;
  revision?: string;
  controlledPublisherAfter?: unknown;
  remainingMisses?: Te06RemainingMiss[];
} = {}): Te06ExitValidationReport {
  const root = options.root ?? PROJECT_ROOT;
  const revision = exactRevision(root, options.revision ?? TE06_COMBINED_REVISION);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "wiki-ssot-te06-exit-"));
  const checkoutRoot = join(temporaryRoot, "repo");
  try {
    required(["git", "clone", "--quiet", "--shared", "--no-checkout", root, checkoutRoot], root);
    required(["git", "checkout", "--quiet", "--detach", revision], checkoutRoot);
    const nodeModules = join(root, "node_modules");
    if (!existsSync(nodeModules)) throw new Error("TE-06 exact-revision harness requires repository node_modules");
    symlinkSync(nodeModules, join(checkoutRoot, "node_modules"), "dir");

    const contexts = TE06_CONTEXT_CASES.map((item) => measureContext(checkoutRoot, item));
    const primary = buildPrimaryCurrentReportAtRevision(revision, {
      description: "exact combined TE-05/TE-01/TE-02/TE-04 revision",
    });
    const correctness = primaryCorrectness(primary);
    if (primary.engine.baseSha !== revision || primary.summary.scenarioCount !== 8
      || primary.summary.scenariosPassing !== 8 || Object.values(correctness).some((value) => !value)) {
      throw new Error("TE-06 Primary exact-revision correctness floor failed");
    }

    const kitManifest = JSON.parse(readFileSync(join(checkoutRoot, "kit/files/.wiki/kit-manifest.json"), "utf8")) as {
      digest?: unknown;
      files?: unknown;
    };
    if (typeof kitManifest.digest !== "string" || !/^[0-9a-f]{64}$/.test(kitManifest.digest)
      || !kitManifest.files || typeof kitManifest.files !== "object") {
      throw new Error("TE-06 kit manifest is not content-addressed");
    }

    const focused = measureTe04FocusedReview(checkoutRoot);
    if (!focused.exact_pass || !focused.portable_fixture_correct || focused.implementation_revision !== revision) {
      throw new Error("TE-06 current TE-04 exact PASS/portable measurement failed");
    }

    const suites: SuiteResult[] = [
      {
        id: "primary",
        command: "buildPrimaryCurrentReportAtRevision(<exact-revision>)",
        success: true,
        passedChecks: primary.summary.scenariosPassing,
        resultDigest: sha256(jsonStable({ revision, summary: primary.summary, correctness })),
      },
      suiteResult(checkoutRoot, "kit", "scripts/wiki/kit.test.ts"),
      suiteResult(checkoutRoot, "new-adoption", "scripts/wiki/new-repository-adoption.test.ts"),
      suiteResult(checkoutRoot, "existing-bootstrap", "scripts/wiki/existing-repo-bootstrap.test.ts"),
      suiteResult(checkoutRoot, "work-context", "scripts/wiki/work.test.ts"),
      {
        id: "review-portable",
        command: "measureTe04FocusedReview(<exact-revision>)",
        success: true,
        passedChecks: 2,
        resultDigest: sha256(jsonStable({
          revision,
          bundleDigest: focused.bundle_digest,
          exactPass: focused.exact_pass,
          portableFixtureCorrect: focused.portable_fixture_correct,
        })),
      },
    ];

    let controlledPublisherAfter: Te06ExitValidationReport["controlledPublisherAfter"] = {
      availability: "unavailable",
      source: "separately supplied sanitized controlled publisher",
      limitation: "No controlled publisher after-case was supplied to this deterministic repository harness.",
    };
    if (options.controlledPublisherAfter !== undefined) {
      const publisher = validateTe06ControlledPublisherAfter(options.controlledPublisherAfter, revision);
      controlledPublisherAfter = {
        availability: "available",
        source: "separately supplied sanitized controlled publisher",
        publisher,
      };
    }

    const core = {
      version: 1 as const,
      workItem: "TE-06" as const,
      exactRevision: revision,
      deterministic: {
        modelCalls: 0 as const,
        providerCalls: 0 as const,
        contextMeasurements: contexts,
        primary: {
          exactRevision: revision,
          scenarioCount: primary.summary.scenarioCount,
          scenariosPassing: primary.summary.scenariosPassing,
          correctness,
          summaryDigest: sha256(jsonStable(primary.summary)),
        },
        kitManifest: {
          digest: kitManifest.digest,
          fileCount: Object.keys(kitManifest.files as Record<string, unknown>).length,
        },
        focusedReview: {
          implementationRevision: focused.implementation_revision,
          bundleDigest: focused.bundle_digest,
          exactPass: true as const,
          portableFixtureCorrect: true as const,
          reviewerSourceBreadth: focused.reviewer_source_breadth,
          nonDiffBundleBytes: focused.non_diff_bundle_bytes,
        },
        suites,
      },
      controlledPublisherAfter,
      attribution: {
        engineOwned: [
          "Compact/full context projection, exact semantic parity, content digests, and focused review inputs are deterministic repository-engine behavior.",
          "Primary, impact, drift, review, portable, kit, and adoption correctness are repository test evidence.",
        ],
        repositoryGuidanceAndOptionalOrchestration: [
          "Phase handoffs, bounded reads, and optional role orchestration are repository guidance; the engine does not force provider fan-out.",
        ],
        cacheEffects: [
          "Cached input remains included in raw input; uncached input is raw minus cached and cache continuity is provider-controlled.",
        ],
        guardianAndApprovalBehavior: [
          "Guardian routing, approval prompts, and approval wait are external orchestration observations and are never inferred from deterministic bytes.",
        ],
        providerLimitations: [
          "Model request, first-token, and completion latency are available only when the sanitized controlled publisher exposes them.",
          "Raw token usage is not billed API cost or subscription-credit consumption, and repository tests do not prove model comprehension.",
        ],
      },
      remainingMisses: validateTe06RemainingMisses(options.remainingMisses ?? []),
      ownerDecision: {
        selectedOption: null,
        options: [...TE06_OWNER_OPTIONS] as [...typeof TE06_OWNER_OPTIONS],
      },
    };
    return { ...core, reportDigest: sha256(jsonStable(core)) };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function renderTe06ExitValidation(report: Te06ExitValidationReport): string {
  const { reportDigest, ...core } = report;
  if (sha256(jsonStable(core)) !== reportDigest) throw new Error("TE-06 report digest does not match its core");
  return jsonStable(report);
}

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

if (import.meta.main) {
  const afterPath = flagValue("--controlled-publisher-after");
  const report = buildTe06ExitValidation({
    revision: flagValue("--revision"),
    controlledPublisherAfter: afterPath ? JSON.parse(readFileSync(resolve(PROJECT_ROOT, afterPath), "utf8")) : undefined,
  });
  process.stdout.write(renderTe06ExitValidation(report));
}
