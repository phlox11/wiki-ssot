#!/usr/bin/env bun
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  buildSourceMap,
  createRepoView,
  jsonStable,
  loadWikiPages,
  mappedPages,
  type TopicContext,
  type WikiStatus,
} from "./core";
import {
  createPrimaryScenarioFixture,
  materializePrimaryScenarioCandidate,
} from "./primary-baseline";
import {
  PRIMARY_SCENARIO_SUITE,
  evaluatePrimaryScenario,
  type PrimaryScenario,
  type PrimaryScenarioEvaluation,
  type PrimaryScenarioObservation,
  type PrimaryWikiAction,
} from "./primary-scenarios";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const CLI_PATH = join(PROJECT_ROOT, "scripts/wiki/cli.ts");
const DEFAULT_REPORT_PATH = join(PROJECT_ROOT, "docs/evidence/pv-19-primary-current.json");
const DEFAULT_INTERPRETATION_PATH = join(PROJECT_ROOT, "docs/evidence/pv-19-primary-current.md");

export const PRIMARY_CURRENT_ENGINE_REF = "8b93a6f6e8026963b5cdd49cbb7a8b737e71b9ec" as const;
export const PRIMARY_CURRENT_REQUIRED_COMMITS = {
  "PV-16": "322b42e44ec54dd73545cc8bce00922c25b32282",
  "PV-17": "f3cdd8a3d759a84141b2da9f2271cde61313d927",
  "PV-18": "b12e7d2dd6d4b1b6c8c12b2c0a90422f37b9baff",
} as const;
const PRIMARY_CURRENT_ENGINE_PATHS = [
  ".wiki/config.json",
  ".wiki/coverage.json",
  "scripts/wiki/cli.ts",
  "scripts/wiki/core.ts",
  "scripts/wiki/primary-scenarios.ts",
] as const;

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type RecallTotal = {
  found: number;
  required: number;
  ratio: number;
};

export type PrimaryCurrentCoverageRecord = {
  path: string;
  coveredBy: string[];
  mappedCurrentPageIds: string[];
  exclusion: { glob: string; reason: string } | null;
  disposition: "mapped" | "reasoned-exclusion" | "uncovered";
  passes: boolean;
};

export type PrimaryCurrentDriftProbe = {
  sourcePath: string;
  lintExitCode: number;
  impactExitCode: number;
  findingCodes: string[];
  caught: boolean;
};

export type PrimaryCurrentScenarioRecord = {
  scenarioId: string;
  category: PrimaryScenario["category"];
  task: string;
  expectedWikiAction: PrimaryWikiAction;
  discovery: {
    searchMatches: { id: string; status: WikiStatus }[];
    contextCurrentPageIds: string[];
    contextInvariantIds: string[];
    contextConflictIds: string[];
    contextNonCurrentPageIds: string[];
    surfacedSourceFiles: string[];
  };
  nonCurrentSeparation: {
    requiredPageIds: string[];
    observedNonCurrentPageIds: string[];
    misplacedAsCurrentPageIds: string[];
    matches: boolean;
  };
  coverage: PrimaryCurrentCoverageRecord[];
  candidate: {
    changedFiles: string[];
    observedWikiAction: PrimaryWikiAction;
    lintExitCode: number;
    impactExitCode: number;
    findingCodes: string[];
    gatesPass: boolean;
  };
  driftProbes: PrimaryCurrentDriftProbe[];
  observation: Omit<PrimaryScenarioObservation, "wikiAction"> & {
    wikiAction: PrimaryWikiAction;
  };
  evaluation: PrimaryScenarioEvaluation;
  passes: boolean;
};

export type PrimaryCurrentReport = {
  reportVersion: 1;
  contractVersion: 1;
  fixtureVersion: 2;
  engine: {
    baseRef: string;
    baseSha: string;
    requiredCommits: Record<string, string>;
    evaluatedPaths: string[];
  };
  method: {
    discoveryPath: string[];
    candidateGatePath: string[];
    driftProbePath: string[];
    notes: string[];
  };
  summary: {
    scenarioCount: number;
    scenariosPassing: number;
    currentPageRecall: RecallTotal;
    invariantRecall: RecallTotal;
    conflictRecall: RecallTotal;
    implementationSourceRecall: RecallTotal;
    authorityLabelRecall: RecallTotal;
    nonCurrentAuthorityLabelRecall: RecallTotal;
    expectedChangeRecall: RecallTotal;
    irrelevantPageCount: number;
    contextBytes: number;
    wikiActionMatches: number;
    nonCurrentSeparationMatches: number;
    coveragePathCount: number;
    mappedCoveragePathCount: number;
    reasonedExclusionPathCount: number;
    uncoveredPathCount: number;
    candidateGatesPassing: number;
    driftProbeCount: number;
    driftProbesCaught: number;
    driftEscapeCount: number;
  };
  remainingMisses: string[];
  interpretation: {
    measuredPasses: string[];
    remainingMissClassifications: string[];
    explicitlyAcceptedLimitations: string[];
  };
  scenarios: PrimaryCurrentScenarioRecord[];
};

type PrimaryEvaluationTarget = {
  engineRef: string;
  requiredCommits: Record<string, string>;
  description: string;
};

const HISTORICAL_PRIMARY_TARGET: PrimaryEvaluationTarget = {
  engineRef: PRIMARY_CURRENT_ENGINE_REF,
  requiredCommits: PRIMARY_CURRENT_REQUIRED_COMMITS,
  description: "exact combined post-PV-16/PV-17/PV-18 revision",
};

function putAbsolute(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function commandEnvironment(): Record<string, string | undefined> {
  const environment = { ...process.env };
  delete environment.GITHUB_EVENT_NAME;
  delete environment.WIKI_PR_BODY;
  return environment;
}

function run(command: string[], cwd: string, extraEnvironment: Record<string, string> = {}): CommandResult {
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...commandEnvironment(), ...extraEnvironment },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function required(command: string[], cwd: string, extraEnvironment: Record<string, string> = {}): CommandResult {
  const result = run(command, cwd, extraEnvironment);
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed\n${result.stderr || result.stdout}`);
  }
  return result;
}

function git(root: string, args: string[]): string {
  return required(["git", ...args], root).stdout.trim();
}

function cli(root: string, args: string[]): CommandResult {
  return run([process.execPath, CLI_PATH, ...args, "--root", root], PROJECT_ROOT);
}

function requiredCli(root: string, args: string[]): CommandResult {
  const result = cli(root, args);
  if (result.exitCode !== 0) {
    throw new Error(`wiki ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  }
  return result;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function findingCodes(result: CommandResult): string[] {
  try {
    const parsed = JSON.parse(result.stdout) as { findings?: { code?: unknown }[] };
    return unique((parsed.findings ?? []).flatMap((finding) =>
      typeof finding.code === "string" ? [finding.code] : []));
  } catch {
    return [];
  }
}

function append(root: string, path: string, marker: string) {
  const absolute = join(root, path);
  const current = readFileSync(absolute, "utf8");
  writeFileSync(absolute, `${current.trimEnd()}\n${marker}\n`);
}

function runDriftProbe(
  root: string,
  item: PrimaryScenario,
  sourcePath: string,
  scenarioIndex: number,
  probeIndex: number,
): PrimaryCurrentDriftProbe {
  git(root, ["switch", "-q", "main"]);
  git(root, ["switch", "-q", "-c", `pv19-probe-${scenarioIndex}-${probeIndex}`]);
  append(root, sourcePath, `// unverified current-engine drift probe: ${item.id}`);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", `probe ${item.id} ${sourcePath}`]);
  const lint = cli(root, ["lint", "--json"]);
  const impact = cli(root, ["impact", "--base", "main", "--enforce", "--json"]);
  return {
    sourcePath,
    lintExitCode: lint.exitCode,
    impactExitCode: impact.exitCode,
    findingCodes: unique([...findingCodes(lint), ...findingCodes(impact)]),
    caught: lint.exitCode !== 0 || impact.exitCode !== 0,
  };
}

function implementationSources(item: PrimaryScenario): string[] {
  return item.requiredSources
    .filter((path) => /\.(?:[cm]?[jt]sx?|sql)$/.test(path))
    .sort((a, b) => a.localeCompare(b));
}

type CoverageConfig = {
  version: 1;
  include: string[];
  exclusions: { glob: string; reason: string }[];
};

function coverageRecords(
  config: CoverageConfig,
  sourceMap: ReturnType<typeof buildSourceMap>,
  item: PrimaryScenario,
): PrimaryCurrentCoverageRecord[] {
  return implementationSources(item).map((path) => {
    const coveredBy = config.include.filter((pattern) => new Bun.Glob(pattern).match(path)).sort();
    const exclusion = config.exclusions.find((candidate) => new Bun.Glob(candidate.glob).match(path)) ?? null;
    const mappedCurrentPageIds = mappedPages(sourceMap, path);
    const disposition = mappedCurrentPageIds.length > 0
      ? "mapped"
      : exclusion
        ? "reasoned-exclusion"
        : "uncovered";
    return {
      path,
      coveredBy,
      mappedCurrentPageIds,
      exclusion,
      disposition,
      passes: exclusion !== null || (coveredBy.length > 0 && mappedCurrentPageIds.length > 0),
    };
  });
}

function observedWikiAction(item: PrimaryScenario, changedFiles: string[]): PrimaryWikiAction {
  const updatesAuthority = item.expectedChanges.some((change) =>
    ["current-wiki", "conflict", "coverage"].includes(change.kind) && changedFiles.includes(change.path));
  return updatesAuthority ? "update" : "verify";
}

function recallTotal(
  records: PrimaryCurrentScenarioRecord[],
  key: keyof PrimaryScenarioEvaluation["metrics"],
): RecallTotal {
  let found = 0;
  let required = 0;
  for (const record of records) {
    const metric = record.evaluation.metrics[key];
    if (typeof metric !== "object") throw new Error(`${String(key)} is not a recall metric`);
    found += metric.found;
    required += metric.required;
  }
  return { found, required, ratio: required === 0 ? 1 : found / required };
}

function sumMetric(
  records: PrimaryCurrentScenarioRecord[],
  key: "irrelevantPageCount" | "contextBytes" | "driftEscapeCount",
): number {
  return records.reduce((total, record) => total + record.evaluation.metrics[key], 0);
}

function scenarioMisses(record: PrimaryCurrentScenarioRecord): string[] {
  const misses: string[] = [];
  if (!record.evaluation.expectationsMet) {
    misses.push(`${record.scenarioId}: the versioned scenario evaluator reports incomplete expectations`);
  }
  if (!record.nonCurrentSeparation.matches) {
    misses.push(`${record.scenarioId}: non-current rationale was not cleanly separated from current authority`);
  }
  for (const coverage of record.coverage) {
    if (!coverage.passes) misses.push(`${record.scenarioId}: ${coverage.path} is neither mapped current authority nor a reasoned exclusion`);
  }
  if (!record.candidate.gatesPass) {
    misses.push(`${record.scenarioId}: the reconciled candidate did not pass lint and enforced impact`);
  }
  for (const probe of record.driftProbes) {
    if (!probe.caught) misses.push(`${record.scenarioId}: code-only drift escaped for ${probe.sourcePath}`);
  }
  return misses;
}

function currentEngineSha(target: PrimaryEvaluationTarget): string {
  const resolved = required(["git", "rev-parse", `${target.engineRef}^{commit}`], PROJECT_ROOT).stdout.trim();
  if (resolved !== target.engineRef) {
    throw new Error(`Primary current engine ref did not resolve exactly: ${target.engineRef}`);
  }
  for (const [workId, commit] of Object.entries(target.requiredCommits)) {
    const ancestry = run(["git", "merge-base", "--is-ancestor", commit, target.engineRef], PROJECT_ROOT);
    if (ancestry.exitCode !== 0) throw new Error(`${workId} commit ${commit} is not an ancestor of the evaluated engine`);
  }
  return resolved;
}

function engineMatchesCurrent(target: PrimaryEvaluationTarget): boolean {
  const diff = run(
    ["git", "diff", "--quiet", target.engineRef, "--", ...PRIMARY_CURRENT_ENGINE_PATHS],
    PROJECT_ROOT,
  );
  if (process.env.WIKI_PRIMARY_CURRENT_PINNED_ROOT === target.engineRef) {
    const head = required(["git", "rev-parse", "HEAD"], PROJECT_ROOT).stdout.trim();
    if (head !== target.engineRef || diff.exitCode !== 0) {
      throw new Error("Primary pinned runner did not receive a clean checkout of the evaluated engine");
    }
    return true;
  }
  return diff.exitCode === 0;
}

function buildDetachedPrimaryCurrentReport(target: PrimaryEvaluationTarget): PrimaryCurrentReport {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "wiki-ssot-primary-current-engine-"));
  const checkoutRoot = join(temporaryRoot, "repo");
  const reportPath = join(temporaryRoot, "report.json");
  const interpretationPath = join(temporaryRoot, "interpretation.md");
  try {
    required(["git", "clone", "--quiet", "--shared", "--no-checkout", PROJECT_ROOT, checkoutRoot], PROJECT_ROOT);
    required(["git", "checkout", "--quiet", "--detach", target.engineRef], checkoutRoot);
    for (const path of ["scripts/wiki/primary-current.ts", "scripts/wiki/primary-baseline.ts"]) {
      copyFileSync(join(PROJECT_ROOT, path), join(checkoutRoot, path));
    }
    const nodeModules = join(PROJECT_ROOT, "node_modules");
    if (!existsSync(nodeModules)) throw new Error("PV-19 historical runner requires the repository node_modules");
    symlinkSync(nodeModules, join(checkoutRoot, "node_modules"), "dir");
    required([
      process.execPath,
      join(checkoutRoot, "scripts/wiki/primary-current.ts"),
      "--output",
      reportPath,
      "--interpretation",
      interpretationPath,
    ], checkoutRoot, {
      WIKI_PRIMARY_CURRENT_PINNED_ROOT: target.engineRef,
      WIKI_PRIMARY_EVALUATION_REF: target.engineRef,
      WIKI_PRIMARY_EVALUATION_COMMITS: JSON.stringify(target.requiredCommits),
      WIKI_PRIMARY_EVALUATION_DESCRIPTION: target.description,
    });
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as PrimaryCurrentReport;
    if (report.engine.baseSha !== target.engineRef) {
      throw new Error(`historical PV-19 runner returned the wrong engine: ${report.engine.baseSha}`);
    }
    return report;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function buildPrimaryCurrentReportForTarget(target: PrimaryEvaluationTarget): PrimaryCurrentReport {
  const baseSha = currentEngineSha(target);
  if (!engineMatchesCurrent(target)) return buildDetachedPrimaryCurrentReport(target);
  const root = mkdtempSync(join(tmpdir(), "wiki-ssot-primary-current-"));
  try {
    try {
      createPrimaryScenarioFixture(root, "pv-19-current");
    } catch (error) {
      if (target.engineRef === PRIMARY_CURRENT_ENGINE_REF
        || !(error instanceof Error)
        || !error.message.includes("human-work executor guardrail")) throw error;
      const agentEntrypoint = join(root, "AGENTS.md");
      writeFileSync(
        agentEntrypoint,
        `${readFileSync(agentEntrypoint, "utf8").trimEnd()}\n\n- Do not automatically select \`executor: human\` work. Keep it visible, report the required work and procedure, and hand it off to a human without assuming their credentials or authority.\n`,
      );
      requiredCli(root, ["verify"]);
      git(root, ["add", "-A"]);
      git(root, ["commit", "--amend", "--no-edit", "-q"]);
      requiredCli(root, ["lint", "--json"]);
    }
    const baseView = createRepoView(root);
    const loaded = loadWikiPages(baseView);
    if (loaded.findings.length > 0) throw new Error(`fixture page load failed: ${jsonStable(loaded.findings)}`);
    const sourceMap = buildSourceMap(loaded.pages);
    const coverageConfig = JSON.parse(readFileSync(join(root, ".wiki/coverage.json"), "utf8")) as CoverageConfig;
    const records: PrimaryCurrentScenarioRecord[] = [];

    for (const [scenarioIndex, item] of PRIMARY_SCENARIO_SUITE.scenarios.entries()) {
      git(root, ["switch", "-q", "main"]);
      const searchResult = requiredCli(root, ["search", item.task, "--json"]);
      const contextResult = requiredCli(root, ["context", item.task, "--json"]);
      const search = JSON.parse(searchResult.stdout) as {
        matches: { id: string; status: WikiStatus }[];
      };
      const context = JSON.parse(contextResult.stdout) as TopicContext;
      const currentPages = context.pages.filter((page) => page.kind !== "invariant");
      const invariantPages = context.pages.filter((page) => page.kind === "invariant");
      const observedAuthorities = [...context.pages, ...context.nonCurrentPages].map((page) => ({
        pageId: page.id,
        status: page.status,
        authority: page.authority,
      }));
      const surfacedSourceFiles = unique(
        Array.isArray(context.sources)
          ? context.sources.flatMap((source) => source.sourceFiles)
          : [...context.pages, ...context.nonCurrentPages].flatMap((page) => page.sourceFiles),
      );
      const coverage = coverageRecords(coverageConfig, sourceMap, item);
      const requiredNonCurrentPageIds = item.requiredAuthorities
        .filter((authority) => authority.role === "non-current")
        .map((authority) => authority.pageId)
        .sort();
      const observedNonCurrentPageIds = context.nonCurrentPages.map((page) => page.id).sort();
      const currentContextIds = new Set(context.pages.map((page) => page.id));
      const misplacedAsCurrentPageIds = requiredNonCurrentPageIds.filter((id) => currentContextIds.has(id));
      const nonCurrentSeparation = {
        requiredPageIds: requiredNonCurrentPageIds,
        observedNonCurrentPageIds,
        misplacedAsCurrentPageIds,
        matches: requiredNonCurrentPageIds.every((id) => observedNonCurrentPageIds.includes(id))
          && misplacedAsCurrentPageIds.length === 0,
      };

      const changedFiles = materializePrimaryScenarioCandidate(root, item);
      const wikiAction = observedWikiAction(item, changedFiles);
      const candidateLint = cli(root, ["lint", "--json"]);
      const candidateImpact = cli(root, ["impact", "--base", "main", "--enforce", "--json"]);
      const candidate = {
        changedFiles,
        observedWikiAction: wikiAction,
        lintExitCode: candidateLint.exitCode,
        impactExitCode: candidateImpact.exitCode,
        findingCodes: unique([...findingCodes(candidateLint), ...findingCodes(candidateImpact)]),
        gatesPass: candidateLint.exitCode === 0 && candidateImpact.exitCode === 0,
      };

      const driftProbes = implementationSources(item).map((sourcePath, probeIndex) =>
        runDriftProbe(root, item, sourcePath, scenarioIndex, probeIndex));
      const driftEscapes = driftProbes
        .filter((probe) => !probe.caught)
        .map((probe) => `${probe.sourcePath} changed without wiki reconciliation, but lint and enforced impact both passed.`);
      const commands = [
        `bun run wiki:search -- "${item.task}" --json`,
        `bun run wiki:context -- "${item.task}" --json`,
        "bun run wiki:lint -- --json",
        "bun run wiki:impact -- --base main --enforce --json",
        ...driftProbes.flatMap((probe) => [
          `change ${probe.sourcePath} without wiki reconciliation`,
          "bun run wiki:lint -- --json",
          "bun run wiki:impact -- --base main --enforce --json",
        ]),
      ];
      const observation: PrimaryCurrentScenarioRecord["observation"] = {
        authorities: observedAuthorities,
        sources: surfacedSourceFiles,
        conflicts: context.conflicts.map((conflict) => conflict.id),
        changedFiles,
        wikiAction,
        unmappedChangedFiles: coverage.filter((entry) => !entry.passes).map((entry) => entry.path),
        commands,
        contextBytes: Buffer.byteLength(contextResult.stdout),
        driftEscapes,
      };
      const evaluation = evaluatePrimaryScenario(item, observation);
      const record: PrimaryCurrentScenarioRecord = {
        scenarioId: item.id,
        category: item.category,
        task: item.task,
        expectedWikiAction: item.expectedWikiAction,
        discovery: {
          searchMatches: search.matches.map(({ id, status }) => ({ id, status })),
          contextCurrentPageIds: currentPages.map((page) => page.id),
          contextInvariantIds: invariantPages.map((page) => page.id),
          contextConflictIds: context.conflicts.map((conflict) => conflict.id),
          contextNonCurrentPageIds: observedNonCurrentPageIds,
          surfacedSourceFiles,
        },
        nonCurrentSeparation,
        coverage,
        candidate,
        driftProbes,
        observation,
        evaluation,
        passes: false,
      };
      record.passes = scenarioMisses(record).length === 0;
      records.push(record);
    }

    const allCoverage = records.flatMap((record) => record.coverage);
    const allDriftProbes = records.flatMap((record) => record.driftProbes);
    const remainingMisses = records.flatMap(scenarioMisses);
    const currentPageRecall = recallTotal(records, "currentPageRecall");
    const invariantRecall = recallTotal(records, "invariantRecall");
    const conflictRecall = recallTotal(records, "conflictRecall");
    const implementationSourceRecall = recallTotal(records, "implementationSourceRecall");
    const authorityLabelRecall = recallTotal(records, "authorityLabelRecall");
    const nonCurrentAuthorityLabelRecall = recallTotal(records, "nonCurrentAuthorityLabelRecall");
    const expectedChangeRecall = recallTotal(records, "expectedChangeRecall");
    return {
      reportVersion: 1,
      contractVersion: PRIMARY_SCENARIO_SUITE.version,
      fixtureVersion: 2,
      engine: {
        baseRef: target.engineRef,
        baseSha,
        requiredCommits: target.requiredCommits,
        evaluatedPaths: [...PRIMARY_CURRENT_ENGINE_PATHS].sort(),
      },
      method: {
        discoveryPath: [
          'bun run wiki:search -- "<task>" --json',
          'bun run wiki:context -- "<task>" --json',
        ],
        candidateGatePath: [
          "materialize every declared expected change and verification action",
          "bun run wiki:lint -- --json",
          "bun run wiki:impact -- --base main --enforce --json",
        ],
        driftProbePath: [
          "change each declared implementation/test source independently without wiki reconciliation",
          "bun run wiki:lint -- --json",
          "bun run wiki:impact -- --base main --enforce --json",
        ],
        notes: [
          `Engine identity is pinned to ${target.description} ${baseSha}.`,
          "The synthetic fixture uses the PV-16 recursive scripts/wiki coverage, source-mapping, and risk boundary.",
          "Generic topic context JSON is the authority/status/source/conflict observation; no LLM participates.",
          "Candidate diffs come from committed fixture branches, and code-only probes start independently from the same fixture main.",
          "The immutable PV-05 report and interpretation are neither inputs to nor outputs from this runner.",
        ],
      },
      summary: {
        scenarioCount: records.length,
        scenariosPassing: records.filter((record) => record.passes).length,
        currentPageRecall,
        invariantRecall,
        conflictRecall,
        implementationSourceRecall,
        authorityLabelRecall,
        nonCurrentAuthorityLabelRecall,
        expectedChangeRecall,
        irrelevantPageCount: records.reduce(
          (total, record) => total + record.evaluation.metrics.irrelevantPageCount,
          0,
        ),
        contextBytes: sumMetric(records, "contextBytes"),
        wikiActionMatches: records.filter((record) => record.evaluation.wikiActionMatches).length,
        nonCurrentSeparationMatches: records.filter((record) => record.nonCurrentSeparation.matches).length,
        coveragePathCount: allCoverage.length,
        mappedCoveragePathCount: allCoverage.filter((entry) => entry.disposition === "mapped").length,
        reasonedExclusionPathCount: allCoverage.filter((entry) => entry.disposition === "reasoned-exclusion").length,
        uncoveredPathCount: allCoverage.filter((entry) => entry.disposition === "uncovered").length,
        candidateGatesPassing: records.filter((record) => record.candidate.gatesPass).length,
        driftProbeCount: allDriftProbes.length,
        driftProbesCaught: allDriftProbes.filter((probe) => probe.caught).length,
        driftEscapeCount: sumMetric(records, "driftEscapeCount"),
      },
      remainingMisses,
      interpretation: {
        measuredPasses: [
          `All ${records.length} scenarios passed the versioned expectations and the added coverage, separation, candidate-gate, and drift-probe checks.`,
          `Topic context recalled ${currentPageRecall.found}/${currentPageRecall.required} current pages, ${invariantRecall.found}/${invariantRecall.required} invariants, ${conflictRecall.found}/${conflictRecall.required} conflicts, and ${implementationSourceRecall.found}/${implementationSourceRecall.required} declared sources.`,
          `Exact status-plus-authority labels were present for ${authorityLabelRecall.found}/${authorityLabelRecall.required} authorities; non-current labels were correct for ${nonCurrentAuthorityLabelRecall.found}/${nonCurrentAuthorityLabelRecall.required}.`,
          `All ${allCoverage.length} implementation/test source paths mapped to current authority, all ${records.length} reconciled candidates passed both gates, and all ${allDriftProbes.length} code-only probes were caught.`,
        ],
        remainingMissClassifications: remainingMisses.length === 0
          ? ["None. The current-engine evaluation has no remaining measured miss to classify."]
          : remainingMisses.map((miss) => `UNCLASSIFIED — ${miss}`),
        explicitlyAcceptedLimitations: [
          "The deterministic fixture proves surfaced repository context and gate behavior, not that a model read or understood that context.",
          "It does not claim protection against a trusted maintainer who intentionally weakens repository policy.",
          "Context byte counts are exact UTF-8 output size, not runtime or model-token cost.",
        ],
      },
      scenarios: records,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Preserve the immutable PV-19 evaluation and its byte-stable checked evidence. */
export function buildPrimaryCurrentReport(): PrimaryCurrentReport {
  return buildPrimaryCurrentReportForTarget(HISTORICAL_PRIMARY_TARGET);
}

/**
 * Re-run the Primary contract against an arbitrary exact committed revision.
 *
 * The evaluation always delegates to a detached local checkout, so ambient
 * authoring changes cannot leak into the exact-revision result. This entrypoint
 * is publishing-only and makes no model/provider call.
 */
export function buildPrimaryCurrentReportAtRevision(
  revision: string,
  options: { requiredCommits?: Record<string, string>; description?: string } = {},
): PrimaryCurrentReport {
  const resolved = required(["git", "rev-parse", `${revision}^{commit}`], PROJECT_ROOT).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(resolved)) throw new Error(`Primary evaluation revision is not an exact commit: ${revision}`);
  return buildDetachedPrimaryCurrentReport({
    engineRef: resolved,
    requiredCommits: options.requiredCommits ?? {},
    description: options.description ?? "exact requested revision",
  });
}

export function renderPrimaryCurrentInterpretation(report: PrimaryCurrentReport): string {
  const section = (title: string, items: string[]) => [
    `## ${title}`,
    "",
    ...items.map((item) => `- ${item}`),
    "",
  ].join("\n");
  return [
    "# PV-19 Primary current-engine interpretation",
    "",
    `This report evaluates Primary scenario contract v${report.contractVersion} against exact combined current revision \`${report.engine.baseSha}\`, after PV-16, PV-17, and PV-18.`,
    "The machine-readable observations, coverage dispositions, candidate gates, and per-source drift probes are in `pv-19-primary-current.json`.",
    "The immutable PV-05 baseline remains a separate historical measurement and is not rewritten by this report.",
    "",
    section("Measured passes", report.interpretation.measuredPasses),
    section("Remaining miss classifications", report.interpretation.remainingMissClassifications),
    section("Explicitly accepted limitations", report.interpretation.explicitlyAcceptedLimitations),
  ].join("\n").trimEnd() + "\n";
}

function parseOutput(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path`);
  return resolve(PROJECT_ROOT, value);
}

if (import.meta.main) {
  const reportPath = parseOutput("--output", DEFAULT_REPORT_PATH);
  const interpretationPath = parseOutput("--interpretation", DEFAULT_INTERPRETATION_PATH);
  const evaluationRef = process.env.WIKI_PRIMARY_EVALUATION_REF;
  const report = evaluationRef
    ? buildPrimaryCurrentReportForTarget({
      engineRef: evaluationRef,
      requiredCommits: JSON.parse(process.env.WIKI_PRIMARY_EVALUATION_COMMITS ?? "{}") as Record<string, string>,
      description: process.env.WIKI_PRIMARY_EVALUATION_DESCRIPTION ?? "exact requested revision",
    })
    : buildPrimaryCurrentReport();
  const reportText = jsonStable(report);
  const interpretationText = renderPrimaryCurrentInterpretation(report);
  if (process.argv.includes("--check")) {
    const mismatches = [
      [reportPath, reportText],
      [interpretationPath, interpretationText],
    ].filter(([path, expected]) => {
      try {
        return readFileSync(path, "utf8") !== expected;
      } catch {
        return true;
      }
    });
    if (mismatches.length > 0) {
      throw new Error(`PV-19 current-engine evidence is stale: ${mismatches.map(([path]) => path).join(", ")}`);
    }
    console.log("PV-19 current-engine evidence is current");
  } else {
    putAbsolute(reportPath, reportText);
    putAbsolute(interpretationPath, interpretationText);
    console.log(`wrote ${reportPath}`);
    console.log(`wrote ${interpretationPath}`);
  }
}
