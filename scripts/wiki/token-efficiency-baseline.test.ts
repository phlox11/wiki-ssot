import { beforeAll, describe, expect, test } from "bun:test";
import {
  buildTokenEfficiencyBaselineReport,
  buildTokenEfficiencyEvidence,
  inspectControlledPublisher,
  inspectSchooledDiagnosis,
  renderTokenEfficiencyEvidenceJson,
  renderTokenEfficiencyOwnerRatification,
  SCHOOLED_SESSION_ID,
  TOKEN_EFFICIENCY_BASELINE_ENGINE_REF,
  TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF,
  TOKEN_EFFICIENCY_EXPECTED,
  TOKEN_EFFICIENCY_QUERIES,
  type ControlledPublisher,
  type DeterministicTokenEfficiencyReport,
  type PerformanceEvidence,
  type SchooledDiagnosis,
  type UsageAgent,
  type UsageTotals,
} from "./token-efficiency-baseline";

function performance(): PerformanceEvidence {
  const unavailable = { availability: "unavailable" as const, valueMs: null, method: "not captured", limitation: "The local fixture has no provider timing sample." };
  const available = (valueMs: number) => ({ availability: "available" as const, valueMs, method: "controlled monotonic timer", limitation: "" });
  return {
    modelRequest: available(12),
    firstToken: unavailable,
    completion: available(28),
    toolDuration: available(4),
    approvalWait: unavailable,
    coordinationWait: unavailable,
    activeWallExcludingUserIdle: available(44),
    phases: {
      implementation: { ...available(30), modelCalls: 2, toolCalls: 3 },
      publication: { ...available(8), modelCalls: 1, toolCalls: 1 },
      merge: unavailable,
      cleanup: unavailable,
      mergeCleanupCombined: unavailable,
    },
  };
}

function agent(role: string, rawInputTokens: number, cachedInputTokens: number): UsageAgent {
  const outputTokens = 20;
  return {
    role,
    pathLabel: `${role}-controlled`,
    model: "gpt-5.6-sol",
    effort: "high",
    calls: 2,
    rawInputTokens,
    cachedInputTokens,
    uncachedInputTokens: rawInputTokens - cachedInputTokens,
    outputTokens,
    reasoningOutputTokens: 8,
    totalTokens: rawInputTokens + outputTokens,
    compactions: 1,
    toolCalls: 3,
    outputBytes: 240,
    activeMs: 40,
    wallMs: 50,
  };
}

function totals(agents: UsageAgent[]): UsageTotals {
  const fields = ["calls", "rawInputTokens", "cachedInputTokens", "uncachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens", "compactions", "toolCalls", "outputBytes", "activeMs", "wallMs"] as const;
  return {
    agentCount: agents.length,
    ...Object.fromEntries(fields.map((field) => [field, agents.reduce((sum, item) => sum + item[field], 0)])),
  } as UsageTotals;
}

function diagnosisFixture(): SchooledDiagnosis {
  const agents = [agent("primary", 1_000, 800), agent("guardian", 500, 400)];
  return {
    version: 1,
    kind: "sanitized-schooled-diagnosis",
    sessionId: SCHOOLED_SESSION_ID,
    repository: { label: "true-dragonsnest/schooled", url: "https://github.com/true-dragonsnest/schooled" },
    agents,
    totals: totals(agents),
    inputDistribution: { primary: 0.8, guardian: 0.2 },
    artifactCategories: { tests: 1000, validation: 500 },
    success: true,
    limitations: ["Sanitized aggregate only; prompt and source bodies were not retained."],
    performance: performance(),
  };
}

function publisherFixture(): ControlledPublisher {
  const agents = [agent("publisher", 900, 700)];
  return {
    version: 1,
    kind: "sanitized-controlled-publisher",
    taskLabel: "te00_publisher_baseline",
    exactRevision: TOKEN_EFFICIENCY_CONTEXT_SOURCE_REF,
    orchestration: "single controlled publisher author; no model/provider calls in the deterministic harness",
    agents,
    totals: totals(agents),
    inputDistribution: { context: 0.75, review: 0.25 },
    artifactCategories: { context: 800, review: 400 },
    success: true,
    limitations: ["Controlled fixture timing is illustrative and not a provider latency claim."],
    performance: performance(),
  };
}

let report: DeterministicTokenEfficiencyReport;

beforeAll(() => {
  report = buildTokenEfficiencyBaselineReport();
}, 60_000);

describe("TE-00 token-efficiency baseline", () => {
  test("pins one exact revision and reproduces every deterministic surface", () => {
    expect(report.reportVersion).toBe(1);
    expect(report.deterministic.contextSourceRevision).toBe(TOKEN_EFFICIENCY_BASELINE_ENGINE_REF);
    expect(report.deterministic.focused.query).toBe(TOKEN_EFFICIENCY_QUERIES.focused);
    expect(report.deterministic.broad.query).toBe(TOKEN_EFFICIENCY_QUERIES.broad);
    expect(report.deterministic.selectedWork.workId).toBe("TE-00");
    expect(report.deterministic.recursiveTypeScript.glob).toBe("scripts/wiki/**/*.ts");
    expect(report.summary).toEqual(TOKEN_EFFICIENCY_EXPECTED);
    expect(report.deterministic.recursiveTypeScript.paths).not.toContain("scripts/wiki/token-efficiency-baseline.ts");
    expect(report.deterministic.recursiveTypeScript.fileCount).toBeGreaterThan(0);
    expect(report.deterministic.reviewBundle.baseSha).toBe(TOKEN_EFFICIENCY_BASELINE_ENGINE_REF);
    expect(report.deterministic.reviewBundle.candidateBaseRef).toBe(TOKEN_EFFICIENCY_BASELINE_ENGINE_REF);
    expect(report.deterministic.reviewBundle.candidateSha).toBe(report.deterministic.reviewBundle.candidateRef);
    expect(report.deterministic.reviewBundle.candidateSha).not.toBe(TOKEN_EFFICIENCY_BASELINE_ENGINE_REF);
  });

  test("keeps semantic and source-breadth accounting deterministic", () => {
    for (const context of [report.deterministic.focused, report.deterministic.broad, report.deterministic.selectedWork]) {
      expect(context.text.bytes).toBeGreaterThan(0);
      expect(context.json.bytes).toBeGreaterThan(0);
      expect(context.semantic.readOrderCount).toBeGreaterThan(0);
      expect(context.semantic.pageIds).toEqual([...context.semantic.pageIds].sort((a, b) => a.localeCompare(b)));
      expect(context.semantic.sourceIds).toEqual([...context.semantic.sourceIds].sort((a, b) => a.localeCompare(b)));
    }
    const bundle = report.deterministic.reviewBundle;
    expect(bundle.rawDiffBytes + bundle.rawNonDiffBytes).toBe(bundle.rawTotalBytes);
    expect(bundle.comparisonDiffBytes + bundle.comparisonNonDiffBytes).toBe(bundle.comparisonTotalBytes);
    expect(bundle.comparisonTotalBytes).toBe(bundle.rawTotalBytes - bundle.digestBindingBytes);
    expect(Object.values(bundle.componentBytes).reduce((sum, bytes) => sum + bytes, 0)).toBe(bundle.rawTotalBytes);
    expect(bundle.sourceBreadth.sourceFileCount).toBeGreaterThan(bundle.sourceBreadth.sourcePathCount);
    expect(bundle.sourceBreadth.globMatches["scripts/wiki/**/*.ts"].length).toBe(report.deterministic.recursiveTypeScript.fileCount);
  });

  test("accepts sanitized schooled and publisher records with explicit performance availability", () => {
    const diagnosis = inspectSchooledDiagnosis(diagnosisFixture());
    const publisher = inspectControlledPublisher(publisherFixture());
    expect(diagnosis.ok).toBe(true);
    expect(publisher.ok).toBe(true);
    expect(diagnosis.value?.totals.uncachedInputTokens).toBe(300);
    expect(publisher.value?.performance.firstToken.valueMs).toBeNull();
    expect(publisher.value?.performance.firstToken.availability).toBe("unavailable");
    expect(publisher.value?.performance.phases.merge.limitation).toContain("no provider timing");
  });

  test("rejects malformed accounting, unavailable metrics without limitations, and privacy-unsafe bodies", () => {
    const diagnosis = diagnosisFixture();
    const malformedAccounting = structuredClone(diagnosis);
    malformedAccounting.agents[0].cachedInputTokens = malformedAccounting.agents[0].rawInputTokens + 1;
    expect(inspectSchooledDiagnosis(malformedAccounting).ok).toBe(false);

    const unavailableWithoutLimitation = structuredClone(diagnosis);
    unavailableWithoutLimitation.performance.approvalWait = { availability: "unavailable", valueMs: null, method: "not captured", limitation: "" };
    expect(inspectSchooledDiagnosis(unavailableWithoutLimitation).ok).toBe(false);

    const privateInput = structuredClone(diagnosis) as SchooledDiagnosis & { transcript?: string; sourceBody?: string; privatePath?: string };
    privateInput.transcript = "do not retain";
    privateInput.sourceBody = "private source";
    privateInput.privatePath = "/Users/private/repository";
    expect(inspectSchooledDiagnosis(privateInput).ok).toBe(false);
  });

  test("renders combined evidence byte-stably and leaves owner decision unselected", () => {
    const evidence = buildTokenEfficiencyEvidence(report, diagnosisFixture(), publisherFixture());
    const json = renderTokenEfficiencyEvidenceJson(evidence);
    const markdown = renderTokenEfficiencyOwnerRatification(evidence);
    expect(renderTokenEfficiencyEvidenceJson(buildTokenEfficiencyEvidence(report, diagnosisFixture(), publisherFixture()))).toBe(json);
    expect(renderTokenEfficiencyOwnerRatification(buildTokenEfficiencyEvidence(report, diagnosisFixture(), publisherFixture()))).toBe(markdown);
    expect(json).toContain("externalSchooledDiagnosis");
    expect(json).toContain("controlledPublisher");
    expect(markdown).toContain("Decision: **unselected**");
    expect(markdown).toContain("40% of the reproduced deterministic context baseline");
    expect(markdown).toContain("60% of the controlled end-to-end baseline");
    expect(markdown).toContain("no transcript, prompt, private path");
    expect(markdown).toContain("Cached input is included in raw input");
    expect(markdown).not.toContain("do not retain");
  });
});
