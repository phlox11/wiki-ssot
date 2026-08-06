import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jsonStable } from "./core";
import {
  buildTe06ExitValidation,
  canonicalContextSemantics,
  renderTe06ExitValidation,
  TE06_CONTEXT_CASES,
  TE06_COMBINED_REVISION,
  TE06_MISS_CLASSIFICATIONS,
  TE06_OWNER_OPTIONS,
  validateTe06ControlledPublisherAfter,
  validateTe06ControlledComparison,
  validateTe06RemainingMisses,
  type Te06ExitValidationReport,
} from "./te06-exit-validation";
import {
  buildTe06ControlledComparison,
  TE06_COMPARISON_TASK_DIGEST,
  TE06_CONTROLLED_COMPARISON_ORCHESTRATION,
  TE06_CONTROLLED_COMPARISON_REVISION,
  TE06_CONTROLLED_PUBLISHER_TASK_LABEL,
} from "./te06-controlled-comparison";

const root = resolve(import.meta.dir, "../..");
let report: Te06ExitValidationReport;

beforeAll(() => {
  const comparisonPath = resolve(root, "docs/evidence/te-06-controlled-comparison.json");
  const comparison = existsSync(comparisonPath)
    ? JSON.parse(readFileSync(comparisonPath, "utf8"))
    : buildTe06ControlledComparison(root);
  const controlled = JSON.parse(readFileSync(resolve(root, "docs/evidence/te-06-controlled-publisher.json"), "utf8"));
  report = buildTe06ExitValidation({ controlledComparison: comparison, controlledPublisherAfter: controlled });
}, 180_000);

describe("TE-06 exact-revision exit validation", () => {
  test("binds every deterministic result to one exact committed revision", () => {
    expect(report.version).toBe(1);
    expect(report.workItem).toBe("TE-06");
    expect(report.exactRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(report.exactRevision).toBe(TE06_COMBINED_REVISION);
    expect(report.deterministic.primary.exactRevision).toBe(report.exactRevision);
    expect(report.deterministic.focusedReview.implementationRevision).toBe(report.exactRevision);
    expect(report.deterministic.kitManifest.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(report.deterministic.modelCalls).toBe(0);
    expect(report.deterministic.providerCalls).toBe(0);
    expect(report.controlledComparison.availability).toBe("available");
    if (report.controlledComparison.availability !== "available") throw new Error("controlled comparison unavailable");
    expect(report.controlledComparison.comparison.exactRevision).toBe(TE06_CONTROLLED_COMPARISON_REVISION);
    expect(report.controlledComparison.comparison.comparisonTaskDigest).toBe(TE06_COMPARISON_TASK_DIGEST);
    expect(report.controlledComparison.comparison.orchestration).toBe(TE06_CONTROLLED_COMPARISON_ORCHESTRATION);
  });

  test("rejects controlled-comparison revision, task, and orchestration substitution", () => {
    if (report.controlledComparison.availability !== "available") throw new Error("controlled comparison unavailable");
    const comparison = report.controlledComparison.comparison;
    expect(() => validateTe06ControlledComparison({ ...comparison, exactRevision: "0".repeat(40) }, report.exactRevision))
      .toThrow("does not bind the TE-06 exact revision");
    expect(() => validateTe06ControlledComparison({ ...comparison, comparisonTask: { ...comparison.comparisonTask, focusedTopic: "all source" } }, report.exactRevision))
      .toThrow("task identity does not match");
    expect(() => validateTe06ControlledComparison({ ...comparison, orchestration: "complete exit correctness suite" }, report.exactRevision))
      .toThrow("orchestration does not match");
  });

  test("retains full output while compact text and JSON are smaller and semantically identical", () => {
    expect(report.deterministic.contextMeasurements.map((item) => item.id))
      .toEqual(TE06_CONTEXT_CASES.map((item) => item.id));
    for (const item of report.deterministic.contextMeasurements) {
      expect(item.full.available).toBe(true);
      expect(item.compact.textBytes).toBeLessThan(item.full.textBytes);
      expect(item.compact.jsonBytes).toBeLessThan(item.full.jsonBytes);
      expect(item.removed.textBytes).toBe(item.full.textBytes - item.compact.textBytes);
      expect(item.removed.jsonBytes).toBe(item.full.jsonBytes - item.compact.jsonBytes);
      expect(item.semanticParity).toBe(true);
      expect(item.compact.semanticDigest).toBe(item.full.semanticDigest);
      expect(item.compact.textDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(item.full.textDigest).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("canonical semantics reject body substitution while accepting compact/full body bindings", () => {
    const common = { id: "page/test", kind: "page", status: "current", authority: "normative", path: "wiki/test.md" };
    const body = "\n# Test\n";
    const digest = createHash("sha256").update(body).digest("hex");
    expect(canonicalContextSemantics({ version: 1, pages: [{ ...common, body }], conflicts: [], nonCurrentPages: [], readOrder: [] }))
      .toEqual(canonicalContextSemantics({ version: 1, pages: [{ ...common, bodyDigest: digest }], conflicts: [], nonCurrentPages: [], readOrder: [] }));
    expect(canonicalContextSemantics({ version: 1, pages: [{ ...common, bodyDigest: "0".repeat(64) }], conflicts: [], nonCurrentPages: [], readOrder: [] }))
      .not.toEqual(canonicalContextSemantics({ version: 1, pages: [{ ...common, body }], conflicts: [], nonCurrentPages: [], readOrder: [] }));
  });

  test("preserves the complete Primary correctness floor", () => {
    expect(report.deterministic.primary.scenarioCount).toBe(8);
    expect(report.deterministic.primary.scenariosPassing).toBe(8);
    expect(Object.keys(report.deterministic.primary.correctness).sort()).toEqual([
      "authority",
      "conflicts",
      "coverage",
      "drift",
      "expectedActions",
      "impact",
      "invariants",
      "sources",
      "statusAndNonCurrentSeparation",
    ]);
    expect(Object.values(report.deterministic.primary.correctness).every(Boolean)).toBe(true);
    expect(report.deterministic.primary.summaryDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("records bounded suite summaries and current exact review/portable correctness", () => {
    expect(report.deterministic.suites.map((suite) => suite.id)).toEqual([
      "primary",
      "kit",
      "new-adoption",
      "existing-bootstrap",
      "work-context",
      "review-portable",
    ]);
    for (const suite of report.deterministic.suites) {
      expect(suite.success).toBe(true);
      expect(suite.passedChecks).toBeGreaterThan(0);
      expect(suite.resultDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(suite).not.toHaveProperty("stdout");
      expect(suite).not.toHaveProperty("stderr");
    }
    expect(report.deterministic.focusedReview).toMatchObject({
      exactPass: true,
      portableFixtureCorrect: true,
    });
    expect(report.deterministic.focusedReview.bundleDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("accepts a separate sanitized controlled after-case with complete accounting and timing availability", () => {
    expect(report.controlledPublisherAfter.availability).toBe("available");
    if (report.controlledPublisherAfter.availability !== "available") throw new Error("controlled after-case unavailable");
    const publisher = report.controlledPublisherAfter.publisher;
    expect(publisher.exactRevision).toBe(report.exactRevision);
    expect(publisher.taskLabel).toBe(TE06_CONTROLLED_PUBLISHER_TASK_LABEL);
    expect(publisher.orchestration).toBe(TE06_CONTROLLED_COMPARISON_ORCHESTRATION);
    expect(publisher.agents.length).toBeGreaterThan(0);
    for (const agent of publisher.agents) {
      expect(agent.uncachedInputTokens).toBe(agent.rawInputTokens - agent.cachedInputTokens);
      expect(agent.reasoningOutputTokens).toBeLessThanOrEqual(agent.outputTokens);
      expect(agent.totalTokens).toBe(agent.rawInputTokens + agent.outputTokens);
    }
    expect(publisher.performance).toHaveProperty("modelRequest.availability");
    expect(publisher.performance).toHaveProperty("firstToken.availability");
    expect(publisher.performance).toHaveProperty("completion.availability");
    expect(publisher.performance).toHaveProperty("toolDuration.availability");
    expect(publisher.performance).toHaveProperty("approvalWait.availability");
    expect(publisher.performance).toHaveProperty("coordinationWait.availability");
    expect(publisher.performance).toHaveProperty("activeWallExcludingUserIdle.availability");
    expect(Object.keys(publisher.performance.phases).sort()).toEqual(["cleanup", "implementation", "merge", "publication"]);
    const serialized = renderTe06ExitValidation(report);
    expect(serialized).not.toContain("promptBody");
    expect(serialized).not.toContain("sourceBody");
    expect(serialized).not.toContain("/Users/");
    expect(() => validateTe06ControlledPublisherAfter({ ...publisher, prompt: "private prompt" }, report.exactRevision))
      .toThrow("invalid controlled publisher");
    expect(() => validateTe06ControlledPublisherAfter({ ...publisher, exactRevision: "0".repeat(40) }, report.exactRevision))
      .toThrow("does not bind the TE-06 exact revision");
    expect(() => validateTe06ControlledPublisherAfter({ ...publisher, taskLabel: "te06-broad-exit-suite" }, report.exactRevision))
      .toThrow("task does not match the fixed TE-00 comparison task");
    expect(() => validateTe06ControlledPublisherAfter({ ...publisher, orchestration: "full TE-06 exit suite" }, report.exactRevision))
      .toThrow("orchestration does not match TE-00 controls");
  });

  test("separates attribution layers and limits miss classification vocabulary", () => {
    expect(Object.keys(report.attribution).sort()).toEqual([
      "cacheEffects",
      "engineOwned",
      "guardianAndApprovalBehavior",
      "providerLimitations",
      "repositoryGuidanceAndOptionalOrchestration",
    ]);
    expect(TE06_MISS_CLASSIFICATIONS).toEqual([
      "concrete-defect",
      "owner-decision",
      "orchestrator-limitation",
      "explicitly-accepted-limitation",
    ]);
    expect(report.remainingMisses).toEqual([]);
    expect(() => validateTe06RemainingMisses([{
      description: "unknown class",
      classification: "other" as never,
      evidenceDigest: "0".repeat(64),
    }])).toThrow("unsupported TE-06 remaining-miss classification");
  });

  test("presents exactly three owner options without selecting one", () => {
    expect(report.ownerDecision).toEqual({
      selectedOption: null,
      options: [
        "publisher token and performance efficiency validated with portable correctness preserved",
        "another bounded efficiency cycle",
        "optimization not adopted",
      ],
    });
    expect(report.ownerDecision.options).toEqual([...TE06_OWNER_OPTIONS]);
  });

  test("renders byte-stably and binds a self-digest over the report core", () => {
    const rendered = renderTe06ExitValidation(report);
    expect(renderTe06ExitValidation(JSON.parse(rendered))).toBe(rendered);
    expect(rendered).toBe(jsonStable(report));
    expect(readFileSync(resolve(root, "docs/evidence/te-06-token-performance.json"), "utf8")).toBe(rendered);
    expect(report.reportDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});
