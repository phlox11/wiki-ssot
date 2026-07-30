import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jsonStable } from "./core";
import {
  buildPrimaryBaselineReport,
  renderPrimaryBaselineInterpretation,
  type PrimaryBaselineReport,
} from "./primary-baseline";
import { PRIMARY_SCENARIO_SUITE } from "./primary-scenarios";

const root = resolve(import.meta.dir, "../..");
let report: PrimaryBaselineReport;

beforeAll(() => {
  report = buildPrimaryBaselineReport();
}, 30_000);

describe("PV-05 Primary baseline", () => {
  test("records every version 1 scenario and every required metric", () => {
    expect(report.reportVersion).toBe(1);
    expect(report.contractVersion).toBe(PRIMARY_SCENARIO_SUITE.version);
    expect(report.scenarios.map((item) => item.scenarioId)).toEqual(
      PRIMARY_SCENARIO_SUITE.scenarios.map((item) => item.id),
    );
    for (const item of report.scenarios) {
      expect(item.observation.commands).toHaveLength(4);
      expect(item.observation.contextBytes).toBeGreaterThan(0);
      expect(item.evaluation.metrics).toEqual(expect.objectContaining({
        currentPageRecall: expect.any(Object),
        invariantRecall: expect.any(Object),
        conflictRecall: expect.any(Object),
        implementationSourceRecall: expect.any(Object),
        authorityLabelRecall: expect.any(Object),
        nonCurrentAuthorityLabelRecall: expect.any(Object),
        irrelevantPageCount: expect.any(Number),
        unmappedChangedFileCount: expect.any(Number),
        driftEscapeCount: expect.any(Number),
      }));
    }
  });

  test("locks the measured failures without treating hypotheses as results", () => {
    expect(report.summary.currentPageRecall.ratio).toBe(1);
    expect(report.summary.invariantRecall.ratio).toBe(1);
    expect(report.summary.conflictRecall.ratio).toBe(1);
    expect(report.summary.implementationSourceRecall.ratio).toBe(0);
    expect(report.summary.authorityLabelRecall.ratio).toBe(0);
    expect(report.summary.nonCurrentAuthorityLabelRecall.ratio).toBe(0);
    expect(report.summary.unmappedChangedFileCount).toBe(2);
    expect(report.summary.driftEscapeCount).toBe(1);
    expect(report.summary.wikiActionMatches).toBe(0);
    expect(report.interpretation.measuredFailures).not.toEqual([]);
    expect(report.interpretation.hypothesesNotEstablished).not.toEqual([]);
  });

  test("keeps the committed JSON and interpretation byte-stable", () => {
    expect(readFileSync(resolve(root, "docs/evidence/pv-05-primary-baseline.json"), "utf8"))
      .toBe(jsonStable(report));
    expect(readFileSync(resolve(root, "docs/evidence/pv-05-primary-baseline.md"), "utf8"))
      .toBe(renderPrimaryBaselineInterpretation(report));
  });

  test("ignores ambient CI pull-request event metadata", () => {
    const result = Bun.spawnSync(
      [process.execPath, resolve(import.meta.dir, "primary-baseline.ts"), "--check"],
      {
        cwd: root,
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: "pull_request",
          WIKI_PR_BODY: "ambient CI metadata must not change synthetic fixture measurements",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode, result.stderr.toString() || result.stdout.toString()).toBe(0);
  }, 30_000);
});
