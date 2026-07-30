#!/usr/bin/env bun
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
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
  type WikiAuthority,
  type WikiSource,
  type WikiStatus,
} from "./core";
import {
  PRIMARY_SCENARIO_SUITE,
  evaluatePrimaryScenario,
  type PrimaryAuthorityRole,
  type PrimaryScenario,
  type PrimaryScenarioEvaluation,
  type PrimaryScenarioObservation,
} from "./primary-scenarios";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const CLI_PATH = join(PROJECT_ROOT, "scripts/wiki/cli.ts");
const DEFAULT_REPORT_PATH = join(PROJECT_ROOT, "docs/evidence/pv-05-primary-baseline.json");
const DEFAULT_INTERPRETATION_PATH = join(PROJECT_ROOT, "docs/evidence/pv-05-primary-baseline.md");
export const PRIMARY_BASELINE_ENGINE_REF = "58869b75dc23374b918a79d9731c601764018ead" as const;

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type FixturePage = {
  id: string;
  status: WikiStatus;
  authority: WikiAuthority;
  role: PrimaryAuthorityRole;
  tasks: string[];
  sources: WikiSource[];
};

type RecallTotal = {
  found: number;
  required: number;
  ratio: number;
};

export type PrimaryBaselineScenarioRecord = {
  scenarioId: string;
  category: PrimaryScenario["category"];
  task: string;
  discovery: {
    searchMatches: { id: string; status: WikiStatus }[];
    contextPageIds: string[];
    contextConflictIds: string[];
  };
  observation: Omit<PrimaryScenarioObservation, "wikiAction"> & { wikiAction: PrimaryScenarioObservation["wikiAction"] | null };
  driftProbe: {
    sourcePath: string;
    lintExitCode: number;
    impactExitCode: number;
    findingCodes: string[];
    caught: boolean;
  };
  evaluation: PrimaryScenarioEvaluation;
};

export type PrimaryBaselineReport = {
  reportVersion: 1;
  contractVersion: 1;
  fixtureVersion: 1;
  engine: {
    baseRef: typeof PRIMARY_BASELINE_ENGINE_REF;
    baseSha: string;
    unchangedPaths: string[];
  };
  method: {
    discoveryPath: string[];
    driftProbePath: string[];
    notes: string[];
  };
  summary: {
    scenarioCount: number;
    scenariosMeetingAllExpectations: number;
    currentPageRecall: RecallTotal;
    invariantRecall: RecallTotal;
    conflictRecall: RecallTotal;
    implementationSourceRecall: RecallTotal;
    authorityLabelRecall: RecallTotal;
    nonCurrentAuthorityLabelRecall: RecallTotal;
    expectedChangeRecall: RecallTotal;
    irrelevantPageCount: number;
    unmappedChangedFileCount: number;
    contextBytes: number;
    commandCount: number;
    driftEscapeCount: number;
    wikiActionMatches: number;
  };
  interpretation: {
    measuredPasses: string[];
    measuredFailures: string[];
    hypothesesNotEstablished: string[];
  };
  scenarios: PrimaryBaselineScenarioRecord[];
};

function put(root: string, path: string, content: string) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

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

function run(command: string[], cwd: string): CommandResult {
  const result = Bun.spawnSync(command, {
    cwd,
    env: commandEnvironment(),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function required(command: string[], cwd: string): CommandResult {
  const result = run(command, cwd);
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

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function pagePath(id: string): string {
  return `wiki/${id}.md`;
}

function pageKind(page: FixturePage): string {
  if (page.role === "invariant") return "invariant";
  if (page.role === "non-current") return "proposal";
  if (page.id.startsWith("architecture/")) return "architecture";
  if (page.id.startsWith("product/")) return "product";
  return "feature";
}

function yamlSources(sources: WikiSource[]): string {
  return sources.map((source) => "path" in source
    ? `  - path: ${source.path}`
    : `  - glob: ${source.glob}`).join("\n");
}

function renderPage(page: FixturePage): string {
  const body = page.tasks.map((task) => `- ${task}`).join("\n");
  return `---
id: ${page.id}
summary: Synthetic baseline authority for ${page.id}.
kind: ${pageKind(page)}
status: ${page.status}
authority: ${page.authority}
owners: ["@fixture"]
sources:
${yamlSources(page.sources)}
tags: [primary-baseline]
---

# ${page.id}

The controlled fixture associates this authority with these task prompts:

${body}
`;
}

function renderConflict(item: PrimaryScenario, id: string): string {
  const affectsInvariant = item.requiredAuthorities.some((authority) => authority.role === "invariant");
  const affectedPages = item.requiredAuthorities
    .filter((authority) => authority.role === "current-page")
    .map((authority) => authority.pageId);
  const affectedInvariants = item.requiredAuthorities
    .filter((authority) => authority.role === "invariant")
    .map((authority) => authority.pageId);
  return `---
id: conflict/${id}
summary: Synthetic baseline conflict ${id}.
kind: conflict
status: conflicted
authority: normative
owners: ["@fixture"]
sources:
${yamlSources(item.requiredSources.map((path) => ({ path })))}
conflict_id: ${id}
conflict_type: implementation
severity: medium
origin: baseline
opened_at: 2026-01-01
affected_pages: [${affectedPages.join(", ")}]
affected_invariants: [${affectedInvariants.join(", ")}]
resolution:
  state: open
  decision: null
  acceptance:
    - Reconcile the synthetic implementation evidence with current intent.
  evidence: []
---

# ${id}

${item.task}

This ${affectsInvariant ? "also affects an invariant" : "affects the current page"}.
`;
}

function sourceContent(path: string): string {
  if (path.endsWith(".sql")) return "-- synthetic primary baseline source\nSELECT 1;\n";
  return `export const primaryBaselineFixture = ${JSON.stringify(path)};\n`;
}

function fixturePages(): FixturePage[] {
  const pages = new Map<string, FixturePage>();
  for (const item of PRIMARY_SCENARIO_SUITE.scenarios) {
    for (const expectation of item.requiredAuthorities) {
      const existing = pages.get(expectation.pageId);
      const baselineSources: WikiSource[] = item.category === "coverage-edge"
        ? expectation.pageId === "architecture/engine"
          ? [{ path: ".wiki/coverage.json" }, { glob: "scripts/wiki/*.ts" }]
          : [{ path: ".wiki/coverage.json" }]
        : item.requiredSources.map((path) => ({ path }));
      if (existing) {
        existing.tasks.push(item.task);
        existing.sources = unique([...existing.sources, ...baselineSources].map((source) => JSON.stringify(source)))
          .map((source) => JSON.parse(source) as WikiSource);
      } else {
        pages.set(expectation.pageId, {
          id: expectation.pageId,
          status: expectation.status,
          authority: expectation.authority,
          role: expectation.role,
          tasks: [item.task],
          sources: baselineSources,
        });
      }
    }
  }
  return [...pages.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function createFixture(root: string) {
  put(root, ".wiki/config.json", jsonStable({
    version: 1,
    name: "Primary baseline fixture",
    publishesKit: false,
    highRisk: ["src/**/*.ts", "test/**/*.ts", "db/**/*.sql", "scripts/wiki/*.ts"],
    freshContext: {
      mode: "required",
      requiredVerdict: "PASS",
      evidenceRequired: true,
      requiredWhen: { kind: "all" },
      trust: {
        allowedReviewers: ["*"],
        requireDifferentActor: false,
        requireAuthenticatedActor: true,
      },
    },
  }));
  put(root, ".wiki/coverage.json", jsonStable({
    version: 1,
    include: ["src/**/*.ts", "test/**/*.ts", "db/**/*.sql", "scripts/wiki/*.ts"],
    exclusions: [],
  }));
  put(root, "AGENTS.md", `<!-- wiki-ssot:fresh-context-guardrail -->
<!-- wiki-ssot:work-discovery -->

Run bun run wiki:work for generic remaining-work requests.
`);
  put(root, "package.json", jsonStable({
    scripts: {
      "wiki:work": "bun scripts/wiki/cli.ts work",
      "wiki:review-preflight": "bun scripts/wiki/cli.ts review-preflight",
      "wiki:review-check": "bun scripts/wiki/cli.ts review-check",
      "wiki:doctor": "bun scripts/wiki/cli.ts doctor",
    },
  }));
  put(root, "wiki/changelog.md", "# Changelog\n\nSynthetic Primary baseline fixture.\n");

  for (const item of PRIMARY_SCENARIO_SUITE.scenarios) {
    for (const path of item.requiredSources) {
      if (path === ".wiki/coverage.json") continue;
      put(root, path, sourceContent(path));
    }
    for (const conflict of item.requiredConflicts) {
      put(root, `wiki/conflicts/open/${conflict}.md`, renderConflict(item, conflict));
    }
  }
  put(root, "scripts/wiki/root.ts", "export const rootFixture = true;\n");
  for (const page of fixturePages()) put(root, pagePath(page.id), renderPage(page));

  required(["git", "init", "-q", "-b", "main"], root);
  git(root, ["config", "user.name", "Primary Baseline"]);
  git(root, ["config", "user.email", "primary-baseline@example.invalid"]);
  requiredCli(root, ["generated"]);
  requiredCli(root, ["verify"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "synthetic baseline"]);
  const lint = requiredCli(root, ["lint", "--json"]);
  const parsed = JSON.parse(lint.stdout) as { ok: boolean };
  if (!parsed.ok) throw new Error("synthetic baseline fixture did not pass wiki:lint");
}

function parseSearch(stdout: string): { id: string; status: WikiStatus }[] {
  return stdout.split("\n").flatMap((line) => {
    const [id, status] = line.split("\t");
    if (!id || !["current", "proposed", "deprecated", "conflicted", "archived"].includes(status)) return [];
    return [{ id, status: status as WikiStatus }];
  });
}

function parseContext(
  stdout: string,
  knownPageIds: Set<string>,
): { pageIds: string[]; conflictIds: string[] } {
  const pageIds: string[] = [];
  const conflictIds: string[] = [];
  for (const line of stdout.split("\n")) {
    const conflict = line.match(/^# OPEN CONFLICT (C-\d{3})\b/);
    if (conflict) {
      conflictIds.push(conflict[1]);
      continue;
    }
    const page = line.match(/^# ([^\s].*)$/);
    if (page && knownPageIds.has(page[1])) pageIds.push(page[1]);
  }
  return {
    pageIds: unique(pageIds).sort(),
    conflictIds: unique(conflictIds).sort(),
  };
}

function append(root: string, path: string, marker: string) {
  const absolute = join(root, path);
  const current = readFileSync(absolute, "utf8");
  writeFileSync(absolute, `${current.trimEnd()}\n${marker}\n`);
}

function resolveConflict(root: string, id: string) {
  const from = join(root, `wiki/conflicts/open/${id}.md`);
  const to = join(root, `wiki/conflicts/resolved/${id}.md`);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
  const resolved = readFileSync(to, "utf8")
    .replace("status: conflicted", "status: archived")
    .replace("  state: open", "  state: verified")
    .replace("  decision: null", "  decision: Synthetic fixture resolution")
    .replace("  evidence: []", "  evidence:\n    - test/export/job.test.ts");
  writeFileSync(to, resolved);
}

function materializeCandidate(root: string, item: PrimaryScenario): string[] {
  git(root, ["switch", "-q", "-c", `candidate-${item.id}`]);
  let needsVerification = false;
  for (const change of item.expectedChanges) {
    if (change.kind === "verification") {
      needsVerification = true;
      continue;
    }
    if (change.kind === "conflict" && change.path === "wiki/conflicts/resolved/C-201.md") {
      resolveConflict(root, "C-201");
      continue;
    }
    if (change.kind === "coverage") {
      const coverage = JSON.parse(readFileSync(join(root, change.path), "utf8")) as { include: string[] };
      coverage.include.push("scripts/wiki/parsers/*.ts");
      put(root, change.path, jsonStable(coverage));
      continue;
    }
    if (change.kind === "current-wiki" && item.category === "coverage-edge") {
      const absolute = join(root, change.path);
      const current = readFileSync(absolute, "utf8");
      writeFileSync(
        absolute,
        current.replace(
          "  - glob: scripts/wiki/*.ts",
          "  - glob: scripts/wiki/*.ts\n  - glob: scripts/wiki/parsers/*.ts",
        ),
      );
    }
    append(root, change.path, `// candidate materialization: ${item.id}`);
  }
  // RepoView includes tracked paths from the index, so stage renames before a
  // read command or it would still try to open the removed conflict path.
  git(root, ["add", "-A"]);
  if (needsVerification) requiredCli(root, ["verify"]);
  requiredCli(root, ["generated"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", `materialize ${item.id}`]);
  return git(root, ["diff", "--name-only", "main...HEAD"]).split("\n").filter(Boolean).sort();
}

function findingCodes(result: CommandResult): string[] {
  try {
    const parsed = JSON.parse(result.stdout) as { findings?: { code?: unknown }[] };
    return unique((parsed.findings ?? []).flatMap((finding) => typeof finding.code === "string" ? [finding.code] : []));
  } catch {
    return [];
  }
}

function driftSource(item: PrimaryScenario): string {
  return item.requiredSources.find((path) => !path.startsWith(".wiki/")) ?? item.requiredSources[0];
}

function runDriftProbe(root: string, item: PrimaryScenario) {
  git(root, ["switch", "-q", "main"]);
  git(root, ["switch", "-q", "-c", `probe-${item.id}`]);
  const sourcePath = driftSource(item);
  append(root, sourcePath, `// unverified drift probe: ${item.id}`);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", `probe ${item.id}`]);
  const lint = cli(root, ["lint", "--json"]);
  const impact = cli(root, ["impact", "--base", "main", "--enforce", "--json"]);
  const caught = lint.exitCode !== 0 || impact.exitCode !== 0;
  return {
    sourcePath,
    lintExitCode: lint.exitCode,
    impactExitCode: impact.exitCode,
    findingCodes: unique([...findingCodes(lint), ...findingCodes(impact)]).sort(),
    caught,
  };
}

function recallTotal(
  records: PrimaryBaselineScenarioRecord[],
  key: keyof PrimaryScenarioEvaluation["metrics"],
): RecallTotal {
  let found = 0;
  let requiredCount = 0;
  for (const record of records) {
    const metric = record.evaluation.metrics[key];
    if (typeof metric !== "object") throw new Error(`${String(key)} is not a recall metric`);
    found += metric.found;
    requiredCount += metric.required;
  }
  return {
    found,
    required: requiredCount,
    ratio: requiredCount === 0 ? 1 : found / requiredCount,
  };
}

function sumMetric(
  records: PrimaryBaselineScenarioRecord[],
  key: "irrelevantPageCount" | "unmappedChangedFileCount" | "contextBytes" | "commandCount" | "driftEscapeCount",
): number {
  return records.reduce((total, record) => total + record.evaluation.metrics[key], 0);
}

function engineBaseSha(): string {
  const unchangedPaths = [
    "scripts/wiki/core.ts",
    "scripts/wiki/cli.ts",
    "scripts/wiki/primary-scenarios.ts",
  ];
  const resolved = required(
    ["git", "rev-parse", `${PRIMARY_BASELINE_ENGINE_REF}^{commit}`],
    PROJECT_ROOT,
  ).stdout.trim();
  if (resolved !== PRIMARY_BASELINE_ENGINE_REF) {
    throw new Error(`PV-05 baseline engine ref did not resolve exactly: ${PRIMARY_BASELINE_ENGINE_REF}`);
  }
  const diff = run(
    ["git", "diff", "--quiet", PRIMARY_BASELINE_ENGINE_REF, "--", ...unchangedPaths],
    PROJECT_ROOT,
  );
  if (diff.exitCode !== 0) {
    throw new Error(`PV-05 baseline requires the unmodified engine and scenario contract: ${unchangedPaths.join(", ")}`);
  }
  return resolved;
}

export function buildPrimaryBaselineReport(): PrimaryBaselineReport {
  const baseSha = engineBaseSha();
  const root = mkdtempSync(join(tmpdir(), "wiki-ssot-primary-baseline-"));
  try {
    createFixture(root);
    const baseView = createRepoView(root);
    const loaded = loadWikiPages(baseView);
    if (loaded.findings.length > 0) throw new Error(`fixture page load failed: ${jsonStable(loaded.findings)}`);
    const knownPageIds = new Set(loaded.pages.filter((page) => page.data.kind !== "conflict").map((page) => page.data.id));
    const sourceMap = buildSourceMap(loaded.pages);
    const records: PrimaryBaselineScenarioRecord[] = [];

    for (const item of PRIMARY_SCENARIO_SUITE.scenarios) {
      git(root, ["switch", "-q", "main"]);
      const search = requiredCli(root, ["search", item.task]);
      const context = requiredCli(root, ["context", item.task]);
      const searchMatches = parseSearch(search.stdout);
      const contextResult = parseContext(context.stdout, knownPageIds);
      const changedFiles = materializeCandidate(root, item);
      const unmappedChangedFiles = item.expectedChanges
        .filter((change) => change.kind === "implementation" || change.kind === "test")
        .map((change) => change.path)
        .filter((path) => mappedPages(sourceMap, path).length === 0)
        .sort();
      const driftProbe = runDriftProbe(root, item);
      const driftEscapes = driftProbe.caught
        ? []
        : [`${driftProbe.sourcePath} changed without wiki update or verification, but wiki:lint and wiki:impact --enforce both passed.`];
      const statusById = new Map(searchMatches.map((match) => [match.id, match.status]));
      const observation: PrimaryScenarioObservation = {
        authorities: contextResult.pageIds.map((pageId) => ({
          pageId,
          status: statusById.get(pageId),
        })),
        // The documented default text context prints only the wiki page path,
        // not the page's declared implementation sources.
        sources: [],
        conflicts: contextResult.conflictIds,
        changedFiles,
        wikiAction: undefined,
        unmappedChangedFiles,
        commands: [
          `bun run wiki:search -- "${item.task}"`,
          `bun run wiki:context -- "${item.task}"`,
          "bun run wiki:lint -- --json",
          "bun run wiki:impact -- --base main --enforce --json",
        ],
        contextBytes: Buffer.byteLength(context.stdout),
        driftEscapes,
      };
      records.push({
        scenarioId: item.id,
        category: item.category,
        task: item.task,
        discovery: {
          searchMatches,
          contextPageIds: contextResult.pageIds,
          contextConflictIds: contextResult.conflictIds,
        },
        observation: { ...observation, wikiAction: observation.wikiAction ?? null },
        driftProbe,
        evaluation: evaluatePrimaryScenario(item, observation),
      });
    }

    const currentPageRecall = recallTotal(records, "currentPageRecall");
    const invariantRecall = recallTotal(records, "invariantRecall");
    const conflictRecall = recallTotal(records, "conflictRecall");
    const implementationSourceRecall = recallTotal(records, "implementationSourceRecall");
    const authorityLabelRecall = recallTotal(records, "authorityLabelRecall");
    const nonCurrentAuthorityLabelRecall = recallTotal(records, "nonCurrentAuthorityLabelRecall");
    const expectedChangeRecall = recallTotal(records, "expectedChangeRecall");
    const irrelevantPageCount = sumMetric(records, "irrelevantPageCount");
    const unmappedChangedFileCount = sumMetric(records, "unmappedChangedFileCount");
    const driftEscapeCount = sumMetric(records, "driftEscapeCount");
    const wikiActionMatches = records.filter((record) => record.evaluation.wikiActionMatches).length;
    return {
      reportVersion: 1,
      contractVersion: PRIMARY_SCENARIO_SUITE.version,
      fixtureVersion: 1,
      engine: {
        baseRef: PRIMARY_BASELINE_ENGINE_REF,
        baseSha,
        unchangedPaths: [
          "scripts/wiki/cli.ts",
          "scripts/wiki/core.ts",
          "scripts/wiki/primary-scenarios.ts",
        ],
      },
      method: {
        discoveryPath: [
          'bun run wiki:search -- "<task>"',
          'bun run wiki:context -- "<task>"',
        ],
        driftProbePath: [
          "change one declared implementation source without a wiki update or verification",
          "bun run wiki:lint -- --json",
          "bun run wiki:impact -- --base main --enforce --json",
        ],
        notes: [
          `Engine identity is pinned to immutable commit ${baseSha}; advancing a branch ref does not rewrite historical PV-05 evidence.`,
          "Each expected candidate is materialized and committed in a synthetic git fixture; changedFiles comes from git diff.",
          "Unmapped changed files are implementation/test expectations with no current-page source mapping at the baseline.",
          "Context bytes are exact UTF-8 bytes from the default text context output; runtime and model-token cost are not claimed.",
        ],
      },
      summary: {
        scenarioCount: records.length,
        scenariosMeetingAllExpectations: records.filter((record) => record.evaluation.expectationsMet).length,
        currentPageRecall,
        invariantRecall,
        conflictRecall,
        implementationSourceRecall,
        authorityLabelRecall,
        nonCurrentAuthorityLabelRecall,
        expectedChangeRecall,
        irrelevantPageCount,
        unmappedChangedFileCount,
        contextBytes: sumMetric(records, "contextBytes"),
        commandCount: sumMetric(records, "commandCount"),
        driftEscapeCount,
        wikiActionMatches,
      },
      interpretation: {
        measuredPasses: [
          `The default query context recalled ${currentPageRecall.found}/${currentPageRecall.required} controlling current pages, ${invariantRecall.found}/${invariantRecall.required} invariants, and ${conflictRecall.found}/${conflictRecall.required} required conflicts.`,
          `Synthetic candidate diffs contained ${expectedChangeRecall.found}/${expectedChangeRecall.required} declared expected changes.`,
        ],
        measuredFailures: [
          `Exact status+authority labelling was present for ${authorityLabelRecall.found}/${authorityLabelRecall.required} required authorities; the default text context omits both labels and search omits authority.`,
          `The default text context surfaced ${implementationSourceRecall.found}/${implementationSourceRecall.required} required implementation sources.`,
          `Substring query matching returned ${irrelevantPageCount} irrelevant page occurrences across ${records.length} scenarios.`,
          `${unmappedChangedFileCount} expected implementation/test files lacked a baseline current-page mapping, and ${driftEscapeCount} code-only probe passed both deterministic drift gates.`,
          `The default discovery path stated the required update/verify wiki action in ${wikiActionMatches}/${records.length} scenarios.`,
        ],
        hypothesesNotEstablished: [
          "This deterministic fixture does not measure whether an LLM reads or understands surfaced context.",
          "It does not establish runtime or model-token cost, nor whether new- and existing-repository adoption defaults diverge; those require PV-08, PV-09, and PV-11 evidence.",
          "It identifies search over-return but does not establish that ranking is the correct remedy; PV-07 remains evidence-driven.",
        ],
      },
      scenarios: records,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function renderPrimaryBaselineInterpretation(report: PrimaryBaselineReport): string {
  const section = (title: string, items: string[]) => [
    `## ${title}`,
    "",
    ...items.map((item) => `- ${item}`),
    "",
  ].join("\n");
  return [
    "# PV-05 Primary baseline interpretation",
    "",
    `This report measures Primary scenario contract v${report.contractVersion} against the unmodified engine at immutable revision \`${report.engine.baseSha}\`.`,
    "The machine-readable observations and per-scenario metrics are in `pv-05-primary-baseline.json`.",
    "",
    section("Measured passes", report.interpretation.measuredPasses),
    section("Measured failures", report.interpretation.measuredFailures),
    section("Hypotheses not established", report.interpretation.hypothesesNotEstablished),
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
  const report = buildPrimaryBaselineReport();
  const reportText = jsonStable(report);
  const interpretationText = renderPrimaryBaselineInterpretation(report);
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
      throw new Error(`PV-05 baseline evidence is stale: ${mismatches.map(([path]) => path).join(", ")}`);
    }
    console.log("PV-05 baseline evidence is current");
  } else {
    putAbsolute(reportPath, reportText);
    putAbsolute(interpretationPath, interpretationText);
    console.log(`wrote ${reportPath}`);
    console.log(`wrote ${interpretationPath}`);
  }
}
