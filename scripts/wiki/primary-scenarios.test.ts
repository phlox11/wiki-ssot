import { describe, expect, test } from "bun:test";
import {
  PRIMARY_SCENARIO_CATEGORIES,
  PRIMARY_SCENARIO_SUITE,
  evaluatePrimaryScenario,
  renderPrimaryScenarioEvaluation,
  validatePrimaryScenarioSuite,
  type PrimaryScenario,
  type PrimaryScenarioObservation,
} from "./primary-scenarios";

function perfectObservation(item: PrimaryScenario): PrimaryScenarioObservation {
  return {
    authorities: item.requiredAuthorities.map((authority) => ({
      pageId: authority.pageId,
      status: authority.status,
      authority: authority.authority,
    })),
    sources: [...item.requiredSources],
    conflicts: [...item.requiredConflicts],
    changedFiles: item.expectedChanges.map((change) => change.path),
    wikiAction: item.expectedWikiAction,
    unmappedChangedFiles: [],
    commands: [
      `bun run wiki:search -- "${item.task}"`,
      `bun run wiki:context -- "${item.task}" --json`,
    ],
    contextBytes: 1024,
    driftEscapes: [],
  };
}

describe("Primary scenario contract v1", () => {
  test("covers every required scenario category with valid declarations", () => {
    expect(validatePrimaryScenarioSuite(PRIMARY_SCENARIO_SUITE)).toEqual([]);
    expect(PRIMARY_SCENARIO_SUITE.version).toBe(1);
    expect(PRIMARY_SCENARIO_SUITE.scenarios.map((item) => item.category).sort()).toEqual(
      [...PRIMARY_SCENARIO_CATEGORIES].sort(),
    );
    for (const item of PRIMARY_SCENARIO_SUITE.scenarios) {
      expect(item.task.trim()).not.toBe("");
      expect(item.requiredAuthorities.length).toBeGreaterThan(0);
      expect(item.requiredSources.length).toBeGreaterThan(0);
      expect(Array.isArray(item.requiredConflicts)).toBe(true);
      expect(item.expectedChanges.length).toBeGreaterThan(0);
      expect(["update", "verify"]).toContain(item.expectedWikiAction);
    }
  });

  test("declares the conflict, non-current authority, and coverage edges explicitly", () => {
    const byCategory = new Map(PRIMARY_SCENARIO_SUITE.scenarios.map((item) => [item.category, item]));
    expect(byCategory.get("code-wiki-disagreement")?.requiredConflicts).toEqual(["C-101"]);
    expect(byCategory.get("existing-conflict")?.requiredConflicts).toEqual(["C-201"]);
    expect(byCategory.get("mixed-current-proposed-query")?.requiredAuthorities).toContainEqual(
      expect.objectContaining({ pageId: "proposal/search-ranking", role: "non-current", status: "proposed" }),
    );
    expect(byCategory.get("coverage-edge")?.expectedChanges).toContainEqual(
      { path: ".wiki/coverage.json", kind: "coverage" },
    );
  });

  test("evaluates a complete observation without an LLM", () => {
    for (const item of PRIMARY_SCENARIO_SUITE.scenarios) {
      const result = evaluatePrimaryScenario(item, perfectObservation(item));
      expect(result.expectationsMet).toBe(true);
      expect(result.wikiActionMatches).toBe(true);
      expect(result.metrics.currentPageRecall.ratio).toBe(1);
      expect(result.metrics.invariantRecall.ratio).toBe(1);
      expect(result.metrics.conflictRecall.ratio).toBe(1);
      expect(result.metrics.implementationSourceRecall.ratio).toBe(1);
      expect(result.metrics.authorityLabelRecall.ratio).toBe(1);
      expect(result.metrics.nonCurrentAuthorityLabelRecall.ratio).toBe(1);
      expect(result.metrics.expectedChangeRecall.ratio).toBe(1);
    }
  });

  test("reports misses, bad authority labelling, irrelevant pages, unmapped files, and drift escapes", () => {
    const item = PRIMARY_SCENARIO_SUITE.scenarios.find(
      (candidate) => candidate.category === "mixed-current-proposed-query",
    )!;
    const result = evaluatePrimaryScenario(item, {
      authorities: [
        { pageId: "product/search", status: "current", authority: "normative" },
        { pageId: "proposal/search-ranking" },
        { pageId: "proposal/unrelated", status: "proposed", authority: "normative" },
      ],
      sources: [item.requiredSources[0]],
      conflicts: [],
      changedFiles: [item.expectedChanges[0].path],
      wikiAction: "verify",
      unmappedChangedFiles: ["src/search/new-edge.ts"],
      commands: ["bun run wiki:context -- search --json"],
      contextBytes: 4096,
      driftEscapes: ["Current and proposed pages were returned without distinct authority labels."],
    });
    expect(result.expectationsMet).toBe(false);
    expect(result.metrics.nonCurrentAuthorityLabelRecall).toEqual({ found: 0, required: 1, ratio: 0 });
    expect(result.metrics.implementationSourceRecall.ratio).toBe(0.5);
    expect(result.metrics.irrelevantPageCount).toBe(1);
    expect(result.metrics.unmappedChangedFileCount).toBe(1);
    expect(result.metrics.contextBytes).toBe(4096);
    expect(result.commandSequence).toEqual(["bun run wiki:context -- search --json"]);
    expect(result.driftEscapes).toHaveLength(1);
    expect(result.wikiActionMatches).toBe(false);
  });

  test("renders byte-stable evaluation JSON regardless of observation ordering", () => {
    const item = PRIMARY_SCENARIO_SUITE.scenarios.find((candidate) => candidate.category === "multi-area-change")!;
    const first = perfectObservation(item);
    const second: PrimaryScenarioObservation = {
      ...first,
      authorities: [...first.authorities].reverse(),
      sources: [...first.sources].reverse(),
      conflicts: [...first.conflicts].reverse(),
      changedFiles: [...first.changedFiles].reverse(),
      unmappedChangedFiles: [...first.unmappedChangedFiles].reverse(),
      driftEscapes: [...first.driftEscapes].reverse(),
    };
    expect(renderPrimaryScenarioEvaluation(evaluatePrimaryScenario(item, first))).toBe(
      renderPrimaryScenarioEvaluation(evaluatePrimaryScenario(item, second)),
    );
  });

  test("rejects duplicate IDs and missing required category coverage", () => {
    const only = PRIMARY_SCENARIO_SUITE.scenarios[0];
    const findings = validatePrimaryScenarioSuite({
      version: 1,
      scenarios: [only, { ...only }],
    });
    expect(findings).toContain(`duplicate scenario id: ${only.id}`);
    expect(findings).toContain("missing required category: semantics-preserving-refactor");
  });
});
