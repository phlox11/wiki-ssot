import { beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  buildTe06ControlledComparison,
  TE06_COMPARISON_TASK_DIGEST,
  TE06_CONTROLLED_COMPARISON_ORCHESTRATION,
  TE06_CONTROLLED_COMPARISON_REVISION,
  normalizeTe06ComparisonTask,
  renderTe06ControlledComparisonCompact,
  renderTe06ControlledComparison,
  validateTe06ControlledComparisonCompact,
  validateTe06ControlledComparison,
  type Te06ControlledComparisonRecord,
} from "./te06-controlled-comparison";

const root = resolve(import.meta.dir, "../..");
let record: Te06ControlledComparisonRecord;

beforeAll(() => {
  record = buildTe06ControlledComparison(root);
}, 120_000);

describe("TE-06 fixed TE-00 controlled comparison", () => {
  test("binds the exact task, revision, orchestration, and model-free controls", () => {
    expect(record.kind).toBe("te06-controlled-comparison");
    expect(record.exactRevision).toBe(TE06_CONTROLLED_COMPARISON_REVISION);
    expect(record.comparisonTaskDigest).toBe(TE06_COMPARISON_TASK_DIGEST);
    expect(record.orchestration).toBe(TE06_CONTROLLED_COMPARISON_ORCHESTRATION);
    expect(record.deterministic.modelCalls).toBe(0);
    expect(record.deterministic.providerCalls).toBe(0);
    expect(record.comparisonTask).toEqual(normalizeTe06ComparisonTask(record.comparisonTask));
    expect(record.deterministic.focused.query).toBe("recursive source mapping");
    expect(record.deterministic.broad.query).toBe("token context runtime cost efficiency");
    expect(record.deterministic.selectedWork.workId).toBe("TE-00");
    expect(record.deterministic.recursiveTypeScript.glob).toBe("scripts/wiki/**/*.ts");
    expect(record.deterministic.reviewBundle.baseSha).toBe(TE06_CONTROLLED_COMPARISON_REVISION);
  });

  test("keeps successful output compact, digest-addressed, and body-free", () => {
    const rendered = renderTe06ControlledComparisonCompact(record);
    const full = renderTe06ControlledComparison(record);
    expect(JSON.parse(rendered).reportDigest).toBe(record.reportDigest);
    expect(JSON.parse(rendered).comparisonTaskDigest).toBe(record.comparisonTaskDigest);
    expect(rendered).toContain("reportDigest");
    expect(rendered).toContain("comparisonTaskDigest");
    expect(rendered).not.toMatch(/(?:promptBody|sourceBody|toolOutput|privatePath|workingDirectory)/i);
    expect(rendered).not.toMatch(/\/Users\/|\/private\/|\/tmp\//);
    expect(Buffer.byteLength(rendered, "utf8")).toBeLessThan(2_500);
    expect(Buffer.byteLength(rendered, "utf8")).toBeLessThan(Buffer.byteLength(full, "utf8"));
    expect(record.reportDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("rejects exact-revision substitution", () => {
    expect(() => buildTe06ControlledComparison(root, "HEAD")).toThrow("must bind exact revision");
    const substituted = structuredClone(record);
    substituted.exactRevision = "0".repeat(40) as typeof TE06_CONTROLLED_COMPARISON_REVISION;
    expect(() => validateTe06ControlledComparison(substituted)).toThrow("does not bind the TE-06 exact revision");
  });

  test("rejects task identity and orchestration substitution", () => {
    const taskSubstitution = structuredClone(record) as any;
    taskSubstitution.comparisonTask = { ...taskSubstitution.comparisonTask, broadDiscovery: "all repository context" };
    expect(() => validateTe06ControlledComparison(taskSubstitution)).toThrow("task identity does not match");

    const digestSubstitution = structuredClone(record);
    digestSubstitution.comparisonTaskDigest = "0".repeat(64);
    expect(() => validateTe06ControlledComparison(digestSubstitution)).toThrow("task digest does not match");

    const orchestrationSubstitution = structuredClone(record);
    orchestrationSubstitution.orchestration = "run the complete TE-06 exit suite" as typeof TE06_CONTROLLED_COMPARISON_ORCHESTRATION;
    expect(() => validateTe06ControlledComparison(orchestrationSubstitution)).toThrow("orchestration does not match");

    const recipeSubstitution = structuredClone(record) as any;
    recipeSubstitution.deterministic.reviewBundle.candidateCommit.message = "unrelated candidate workload";
    expect(() => validateTe06ControlledComparison(recipeSubstitution)).toThrow("review candidate recipe does not match");
  });

  test("binds compact stdout to the separately retained full report", () => {
    const compact = JSON.parse(renderTe06ControlledComparisonCompact(record));
    expect(validateTe06ControlledComparisonCompact(compact, record).reportDigest).toBe(record.reportDigest);
    const tampered = { ...compact, summary: { ...compact.summary, broadContextBytes: compact.summary.broadContextBytes + 1 } };
    expect(() => validateTe06ControlledComparisonCompact(tampered, record)).toThrow("does not bind the full report digest");
    const wrongDigest = { ...compact, reportDigest: "0".repeat(64) };
    expect(() => validateTe06ControlledComparisonCompact(wrongDigest, record)).toThrow("does not bind the full report digest");
  });

  test("rejects prompt, source-body, and private-path retention", () => {
    const privateRecord = structuredClone(record) as any;
    privateRecord.promptBody = "do not retain";
    expect(() => validateTe06ControlledComparison(privateRecord)).toThrow("forbidden body field");
    const pathRecord = structuredClone(record) as any;
    pathRecord.deterministic.reviewBundle.sourceBreadth.sourcePaths.push("/Users/private/source.ts");
    expect(() => validateTe06ControlledComparison(pathRecord)).toThrow("private path");
  });

  test("reproduces a byte-stable deterministic record", () => {
    const repeat = buildTe06ControlledComparison(root);
    expect(renderTe06ControlledComparison(repeat)).toBe(renderTe06ControlledComparison(record));
    expect(renderTe06ControlledComparisonCompact(repeat)).toBe(renderTe06ControlledComparisonCompact(record));
  }, 120_000);
});
