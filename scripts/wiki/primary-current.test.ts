import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jsonStable } from "./core";
import {
  buildPrimaryCurrentReport,
  PRIMARY_CURRENT_ENGINE_REF,
  PRIMARY_CURRENT_REQUIRED_COMMITS,
  renderPrimaryCurrentInterpretation,
  type PrimaryCurrentReport,
} from "./primary-current";
import { PRIMARY_SCENARIO_SUITE } from "./primary-scenarios";

const root = resolve(import.meta.dir, "../..");
let report: PrimaryCurrentReport;

beforeAll(() => {
  report = buildPrimaryCurrentReport();
}, 60_000);

describe("PV-19 Primary current-engine evaluation", () => {
  test("binds all eight versioned scenarios to the exact combined post-PV-16/PV-17/PV-18 revision", () => {
    expect(report.reportVersion).toBe(1);
    expect(report.contractVersion).toBe(PRIMARY_SCENARIO_SUITE.version);
    expect(report.fixtureVersion).toBe(2);
    expect(report.engine.baseRef).toBe(PRIMARY_CURRENT_ENGINE_REF);
    expect(report.engine.baseSha).toBe(PRIMARY_CURRENT_ENGINE_REF);
    expect(report.engine.requiredCommits).toEqual(PRIMARY_CURRENT_REQUIRED_COMMITS);
    expect(report.scenarios.map((item) => item.scenarioId)).toEqual(
      PRIMARY_SCENARIO_SUITE.scenarios.map((item) => item.id),
    );
  });

  test("records complete authority, source, action, coverage, and gate results", () => {
    expect(report.summary).toMatchObject({
      scenarioCount: 8,
      scenariosPassing: 8,
      currentPageRecall: { found: 9, required: 9, ratio: 1 },
      invariantRecall: { found: 4, required: 4, ratio: 1 },
      conflictRecall: { found: 2, required: 2, ratio: 1 },
      implementationSourceRecall: { found: 18, required: 18, ratio: 1 },
      authorityLabelRecall: { found: 14, required: 14, ratio: 1 },
      nonCurrentAuthorityLabelRecall: { found: 1, required: 1, ratio: 1 },
      expectedChangeRecall: { found: 32, required: 32, ratio: 1 },
      irrelevantPageCount: 0,
      wikiActionMatches: 8,
      nonCurrentSeparationMatches: 8,
      coveragePathCount: 17,
      mappedCoveragePathCount: 17,
      reasonedExclusionPathCount: 0,
      uncoveredPathCount: 0,
      candidateGatesPassing: 8,
      driftProbeCount: 17,
      driftProbesCaught: 17,
      driftEscapeCount: 0,
    });
    for (const item of report.scenarios) {
      expect(item.passes).toBe(true);
      expect(item.evaluation.expectationsMet).toBe(true);
      expect(item.evaluation.wikiActionMatches).toBe(true);
      expect(item.nonCurrentSeparation.matches).toBe(true);
      expect(item.coverage.every((entry) => entry.passes)).toBe(true);
      expect(item.candidate.gatesPass).toBe(true);
      expect(item.driftProbes.every((probe) => probe.caught)).toBe(true);
      expect(item.driftProbes.every((probe) => probe.findingCodes.includes("stale-verification"))).toBe(true);
    }
  });

  test("proves both nested coverage-edge paths map and cannot drift through the gates", () => {
    const edge = report.scenarios.find((item) => item.category === "coverage-edge");
    expect(edge).toBeDefined();
    expect(edge?.coverage).toEqual([
      {
        path: "scripts/wiki/parsers/edge.test.ts",
        coveredBy: ["scripts/wiki/**/*.ts"],
        mappedCurrentPageIds: ["architecture/engine"],
        exclusion: null,
        disposition: "mapped",
        passes: true,
      },
      {
        path: "scripts/wiki/parsers/edge.ts",
        coveredBy: ["scripts/wiki/**/*.ts"],
        mappedCurrentPageIds: ["architecture/engine"],
        exclusion: null,
        disposition: "mapped",
        passes: true,
      },
    ]);
    expect(edge?.driftProbes).toEqual([
      {
        sourcePath: "scripts/wiki/parsers/edge.test.ts",
        lintExitCode: 0,
        impactExitCode: 1,
        findingCodes: ["stale-verification"],
        caught: true,
      },
      {
        sourcePath: "scripts/wiki/parsers/edge.ts",
        lintExitCode: 0,
        impactExitCode: 1,
        findingCodes: ["stale-verification"],
        caught: true,
      },
    ]);
  });

  test("has no measured miss requiring a defect, decision, or limitation classification", () => {
    expect(report.remainingMisses).toEqual([]);
    expect(report.interpretation.remainingMissClassifications).toEqual([
      "None. The current-engine evaluation has no remaining measured miss to classify.",
    ]);
    expect(report.interpretation.explicitlyAcceptedLimitations).not.toEqual([]);
  });

  test("keeps the committed JSON and interpretation byte-stable", () => {
    expect(readFileSync(resolve(root, "docs/evidence/pv-19-primary-current.json"), "utf8"))
      .toBe(jsonStable(report));
    expect(readFileSync(resolve(root, "docs/evidence/pv-19-primary-current.md"), "utf8"))
      .toBe(renderPrimaryCurrentInterpretation(report));
  });

  test("ignores ambient pull-request event metadata", () => {
    const result = Bun.spawnSync(
      [process.execPath, resolve(import.meta.dir, "primary-current.ts"), "--check"],
      {
        cwd: root,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: "pull_request",
          WIKI_PR_BODY: "ambient metadata must not change synthetic current-engine measurements",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode, result.stderr.toString() || result.stdout.toString()).toBe(0);
  }, 90_000);
});
