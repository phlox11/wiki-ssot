import { beforeAll, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { jsonStable, searchWikiPages, type WikiPage } from "./core";
import {
  buildPrimaryBaselineReport,
  materializePrimaryBaselineFixturePages,
  PRIMARY_BASELINE_ENGINE_REF,
  renderPrimaryBaselineInterpretation,
  type PrimaryBaselineReport,
} from "./primary-baseline";
import { PRIMARY_SCENARIO_SUITE } from "./primary-scenarios";

const root = resolve(import.meta.dir, "../..");
let report: PrimaryBaselineReport;

function matchedTerms(page: WikiPage, query: string): string[] {
  const haystack = `${page.data.id} ${page.data.summary} ${(page.data.tags ?? []).join(" ")} ${page.body}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter((term) => haystack.includes(term));
}

function originalAnyTermSearch(pages: WikiPage[], query: string) {
  return pages.map((page) => ({
    id: page.data.id,
    status: page.data.status,
    score: matchedTerms(page, query).length,
  }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

beforeAll(() => {
  report = buildPrimaryBaselineReport();
}, 30_000);

describe("PV-05 Primary baseline", () => {
  test("records every version 1 scenario and every required metric", () => {
    expect(report.reportVersion).toBe(1);
    expect(report.contractVersion).toBe(PRIMARY_SCENARIO_SUITE.version);
    expect(report.engine.baseRef).toBe(PRIMARY_BASELINE_ENGINE_REF);
    expect(report.engine.baseSha).toBe(PRIMARY_BASELINE_ENGINE_REF);
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

  test("reproduces the feature-query noise and keeps every authority with complete-match preference", () => {
    const scenario = PRIMARY_SCENARIO_SUITE.scenarios.find((item) => item.id === "primary-v1-feature-change")!;
    const baseline = report.scenarios.find((item) => item.scenarioId === scenario.id)!;
    const pages = materializePrimaryBaselineFixturePages();
    const original = originalAnyTermSearch(pages, scenario.task);

    expect(original.map(({ id, status }) => ({ id, status }))).toEqual(baseline.discovery.searchMatches);
    expect(baseline.evaluation.irrelevantPages).toContain("features/orders");

    const orders = pages.find((page) => page.data.id === "features/orders")!;
    expect(matchedTerms(orders, scenario.task)).toEqual(["for", "while", "the", "and"]);

    const candidateIds = searchWikiPages(pages, scenario.task).map((item) => item.page.data.id);
    expect(candidateIds).toEqual(scenario.requiredAuthorities.map((item) => item.pageId).sort());
    expect(candidateIds).not.toContain("features/orders");
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

  test("keeps historical evidence current after origin/main advances", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "wiki-ssot-primary-post-merge-"));
    const cloneRoot = join(temporaryRoot, "repo");
    try {
      const clone = Bun.spawnSync(["git", "clone", "--quiet", "--shared", root, cloneRoot], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(clone.exitCode, clone.stderr.toString() || clone.stdout.toString()).toBe(0);

      for (const path of [
        "scripts/wiki/primary-baseline.ts",
        "docs/evidence/pv-05-primary-baseline.json",
        "docs/evidence/pv-05-primary-baseline.md",
      ]) {
        copyFileSync(resolve(root, path), resolve(cloneRoot, path));
      }
      const nodeModules = resolve(root, "node_modules");
      expect(existsSync(nodeModules)).toBe(true);
      symlinkSync(nodeModules, resolve(cloneRoot, "node_modules"), "dir");

      const advance = Bun.spawnSync(
        ["git", "-C", cloneRoot, "update-ref", "refs/remotes/origin/main", "HEAD"],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(advance.exitCode, advance.stderr.toString() || advance.stdout.toString()).toBe(0);

      const result = Bun.spawnSync(
        [process.execPath, resolve(cloneRoot, "scripts/wiki/primary-baseline.ts"), "--check"],
        {
          cwd: cloneRoot,
          env: {
            ...process.env,
            GITHUB_EVENT_NAME: "push",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(result.exitCode, result.stderr.toString() || result.stdout.toString()).toBe(0);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
