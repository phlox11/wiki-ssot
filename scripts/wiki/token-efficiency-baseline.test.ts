import { beforeAll, describe, expect, test } from "bun:test";
import {
  buildTokenEfficiencyBaselineReport,
  buildTokenEfficiencyEvidence,
  inspectControlledRollout,
  renderTokenEfficiencyEvidenceJson,
  renderTokenEfficiencyOwnerRatification,
  TOKEN_EFFICIENCY_BASELINE_ENGINE_REF,
  TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF,
  TOKEN_EFFICIENCY_EXPECTED,
  TOKEN_EFFICIENCY_REVIEW_BASE_REF,
  TOKEN_EFFICIENCY_REVIEW_CANDIDATE_REF,
  type ControlledRollout,
  type DeterministicTokenEfficiencyReport,
} from "./token-efficiency-baseline";

const rolloutFixture: ControlledRollout = {
  version: 1,
  kind: "sanitized-controlled-rollout",
  comparison: {
    taskLabel: "te00_controlled_rollout",
    contextSourceRevision: TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF,
    orchestration: "single controlled authoring agent; no subagents or guardians",
  },
  provenance: {
    kind: "sanitized",
    description: "Aggregated token-usage snapshots with no transcript, prompt, path, session, or thread data.",
    eventCount: 28,
  },
  agents: [{
    taskLabel: "te00_controlled_rollout",
    role: "default",
    model: "gpt-5.6-sol",
    effort: "high",
    modelCallCount: 25,
    rawInputTokens: 1_241_104,
    cachedInputTokens: 1_158_912,
    uncachedInputTokens: 82_192,
    outputTokens: 8_520,
    reasoningOutputTokens: 3_737,
    totalTokens: 1_249_624,
  }],
  totals: {
    agentCount: 1,
    modelCallCount: 25,
    rawInputTokens: 1_241_104,
    cachedInputTokens: 1_158_912,
    uncachedInputTokens: 82_192,
    outputTokens: 8_520,
    reasoningOutputTokens: 3_737,
    totalTokens: 1_249_624,
  },
};

let report: DeterministicTokenEfficiencyReport;

beforeAll(() => {
  report = buildTokenEfficiencyBaselineReport();
}, 60_000);

describe("TE-00 token-efficiency deterministic baseline", () => {
  test("pins the historical revisions and proposal-recorded byte cases", () => {
    expect(report.reportVersion).toBe(1);
    expect(report.deterministic.contextSourceRevision).toBe(TOKEN_EFFICIENCY_BASELINE_ENGINE_REF);
    expect(report.deterministic.reviewBundle.candidateRef).toBe(TOKEN_EFFICIENCY_REVIEW_CANDIDATE_REF);
    expect(report.deterministic.reviewBundle.baseRef).toBe(TOKEN_EFFICIENCY_REVIEW_BASE_REF);
    expect(report.summary).toEqual({
      mandatoryEntryBytes: TOKEN_EFFICIENCY_EXPECTED.mandatoryEntryBytes,
      focusedContextBytes: TOKEN_EFFICIENCY_EXPECTED.focusedContextBytes,
      broadContextBytes: TOKEN_EFFICIENCY_EXPECTED.broadContextBytes,
      selectedWorkContextBytes: TOKEN_EFFICIENCY_EXPECTED.selectedWorkContextBytes,
      recursiveTypeScriptBytes: TOKEN_EFFICIENCY_EXPECTED.recursiveTypeScriptBytes,
      reviewBundleBytes: TOKEN_EFFICIENCY_EXPECTED.reviewBundleBytes,
      reviewDiffBytes: TOKEN_EFFICIENCY_EXPECTED.reviewDiffBytes,
      reviewNonDiffBytes: TOKEN_EFFICIENCY_EXPECTED.reviewNonDiffBytes,
    });
    expect(report.deterministic.entry.text.bytes).toBe(16_940);
    expect(report.deterministic.entry.paths).toEqual([
      "AGENTS.md",
      "wiki/index.md",
      "wiki/current-status.md",
      "wiki/product/invariants.md",
    ]);
    expect(report.deterministic.recursiveTypeScript.fileCount).toBe(22);
    expect(report.deterministic.recursiveTypeScript.paths).toEqual([...report.deterministic.recursiveTypeScript.paths].sort());
  });

  test("captures text and JSON context metrics plus semantic counts", () => {
    expect(report.deterministic.focused.text.bytes).toBe(55_046);
    expect(report.deterministic.broad.text.bytes).toBe(92_758);
    expect(report.deterministic.selectedWork.text.bytes).toBe(65_031);
    for (const surface of [report.deterministic.focused, report.deterministic.broad, report.deterministic.selectedWork]) {
      expect(surface.json.bytes).toBeGreaterThan(0);
      expect(surface.semantic.pageCount).toBeGreaterThan(0);
      expect(surface.semantic.readOrderCount).toBeGreaterThan(0);
      expect(surface.semantic.pageIds).toEqual([...surface.semantic.pageIds].sort());
    }
    expect(report.deterministic.focused.semantic.nonCurrentPageIds).toContain("proposal/primary-findability-validation");
    expect(report.deterministic.broad.semantic.pageCount).toBe(4);
    expect(report.deterministic.selectedWork.workId).toBe("PV-20");
  });

  test("accounts for review bundle diff, components, files, and source breadth", () => {
    const bundle = report.deterministic.reviewBundle;
    expect(bundle.candidateSha).toBe(TOKEN_EFFICIENCY_REVIEW_CANDIDATE_REF);
    expect(bundle.baseSha).toBe(TOKEN_EFFICIENCY_REVIEW_BASE_REF);
    expect(bundle.metadata).toEqual({
      changeType: "feature",
      semanticChange: true,
      wikiAction: "update",
      affectedPages: ["architecture/engine", "operations/enforcement", "product/invariants", "product/scope"],
      affectedInvariants: ["product/invariants"],
      touchedConflicts: [],
    });
    expect(bundle.rawDiffBytes + bundle.rawNonDiffBytes).toBe(bundle.rawTotalBytes);
    expect(Object.values(bundle.componentBytes).reduce((sum, bytes) => sum + bytes, 0)).toBe(bundle.totalBytes);
    expect(bundle.comparisonTotalBytes).toBe(bundle.rawTotalBytes - bundle.digestBindingBytes);
    expect(bundle.comparisonDiffBytes + bundle.comparisonNonDiffBytes).toBe(bundle.comparisonTotalBytes);
    expect(bundle.comparisonTotalBytes).toBe(201_631);
    expect(bundle.comparisonDiffBytes).toBe(138_661);
    expect(bundle.comparisonNonDiffBytes).toBe(62_970);
    expect(bundle.files.map((file) => file.path)).toEqual([...bundle.files.map((file) => file.path)].sort((a, b) => a.localeCompare(b)));
    expect(bundle.fileBytes["diff.patch"]).toBe(138_661);
    expect(bundle.sourceBreadth).toMatchObject({ affectedPageCount: 4, invariantCount: 1, conflictCount: 0 });
    expect(bundle.rawTotalBytes).toBe(bundle.totalBytes);
    expect(bundle.rawTotalBytes).toBe(201_701);
    expect(bundle.digestBindingBytes).toBe(70);
    expect(bundle.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("rejects malformed, inconsistent, or privacy-unsafe rollout accounting", () => {
    expect(inspectControlledRollout(rolloutFixture).ok).toBe(true);
    const cases: unknown[] = [
      { ...rolloutFixture, agents: [{ ...rolloutFixture.agents[0], cachedInputTokens: 2_000_000 }] },
      { ...rolloutFixture, agents: [{ ...rolloutFixture.agents[0], uncachedInputTokens: 1 }] },
      { ...rolloutFixture, agents: [{ ...rolloutFixture.agents[0], reasoningOutputTokens: 9_000 }] },
      { ...rolloutFixture, agents: [{ ...rolloutFixture.agents[0], totalTokens: 1 }] },
      { ...rolloutFixture, agents: [{ ...rolloutFixture.agents[0], rawInputTokens: 1.5 }] },
      { ...rolloutFixture, totals: { ...rolloutFixture.totals, totalTokens: 1 } },
      { ...rolloutFixture, transcript: "private transcript" },
    ];
    for (const candidate of cases) {
      const checked = inspectControlledRollout(candidate);
      expect(checked.ok).toBe(false);
      expect(checked.errors.length).toBeGreaterThan(0);
    }
  });

  test("renders combined evidence stably from an inline rollout fixture", () => {
    const evidence = buildTokenEfficiencyEvidence(report, rolloutFixture);
    const json = renderTokenEfficiencyEvidenceJson(evidence);
    const markdown = renderTokenEfficiencyOwnerRatification(evidence);
    expect(renderTokenEfficiencyEvidenceJson(buildTokenEfficiencyEvidence(report, rolloutFixture))).toBe(json);
    expect(renderTokenEfficiencyOwnerRatification(buildTokenEfficiencyEvidence(report, rolloutFixture))).toBe(markdown);
    expect(json).toContain("te00_controlled_rollout");
    expect(markdown).toContain("PV-19 correctness floor");
    expect(markdown).toContain("40% of the reproduced deterministic context baseline");
    expect(markdown).toContain("60% of the controlled end-to-end baseline");
    expect(markdown).toContain("Decision: **unselected**");
    expect(markdown).toContain("no transcript, prompt, private path");
  });
});
