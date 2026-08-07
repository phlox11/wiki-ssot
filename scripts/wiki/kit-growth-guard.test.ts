import { describe, expect, test } from "bun:test";
import {
  KIT_GROWTH_THRESHOLDS,
  KIT_CONTRACT_AREAS,
  buildKitGrowthReport,
  evaluateKitGrowth,
  kitGrowthDigest,
  renderKitGrowthJson,
  type KitGrowthSource,
} from "./kit-growth-guard";

function source(path: string, content: string, contractArea: KitGrowthSource["contractArea"] = "production"): KitGrowthSource {
  return { path, sourcePath: path, content, placement: "files", contractArea };
}

describe("KM-07 kit growth guard", () => {
  test("measures LF lines and UTF-8 bytes only for injected kit-owned files", () => {
    const report = evaluateKitGrowth([
      source("scripts/wiki/small.ts", "é\n"),
      { path: "src/not-kit.ts", content: "x\n", placement: "reference" },
      { path: "scripts/wiki/readme.md", content: "x\n", placement: "files" },
    ], { classifications: { "scripts/wiki/small.ts": "production" } });
    const measured = report.files.find((file) => file.path === "scripts/wiki/small.ts");
    expect(measured).toMatchObject({ lines: 1, bytes: 3, contractArea: "production" });
    expect(report.files.map((file) => file.path)).toEqual(["scripts/wiki/small.ts"]);
  });

  test("fails the general line and byte bounds with actionable split guidance", () => {
    const report = evaluateKitGrowth([
      source("scripts/wiki/large.ts", `${"x\n".repeat(1_001)}`),
    ]);
    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toEqual(["kit-growth-lines"]);
    expect(report.findings[0].message).toContain("Split the contract");
    expect(report.findings[0].message).toContain("owner approval");

    const bytes = "x".repeat(KIT_GROWTH_THRESHOLDS.byteThreshold + 1);
    const byteReport = evaluateKitGrowth([source("scripts/wiki/bytes.ts", bytes)]);
    expect(byteReport.findings.map((finding) => finding.code)).toEqual(["kit-growth-bytes"]);
  });

  test("keeps the CLI entrypoint thin independently of the general bound", () => {
    const report = evaluateKitGrowth([
      source("scripts/wiki/cli.ts", `${"x\n".repeat(KIT_GROWTH_THRESHOLDS.cliLineThreshold + 1)}`),
    ]);
    expect(report.findings.map((finding) => finding.code)).toEqual(["kit-growth-cli"]);
  });

  test("fails closed for a new kit-owned path with no named contract area", () => {
    const report = evaluateKitGrowth([
      { path: "scripts/wiki/new-boundary.ts", content: "export const value = 1;\n", placement: "files" },
    ]);
    expect(report.ok).toBe(false);
    expect(report.findings).toEqual([
      expect.objectContaining({ code: "kit-growth-unclassified", path: "scripts/wiki/new-boundary.ts" }),
    ]);
    expect(report.findings[0].message).toContain("production, regression, test-fixture, or test-infrastructure");
  });

  test("permits only the exact review-bundle exception within its bounded cap", () => {
    const report = evaluateKitGrowth([
      source("scripts/wiki/review-bundle.ts", `${"x\n".repeat(976)}${"é".repeat(33_000)}`),
    ]);
    expect(report.ok).toBe(true);
    expect(report.exceptionsUsed).toHaveLength(1);
    expect(report.exceptionsUsed[0]).toMatchObject({ path: "scripts/wiki/review-bundle.ts", byteCap: 69_632 });

    const tooLarge = evaluateKitGrowth([
      source("scripts/wiki/review-bundle.ts", `${"x\n".repeat(1_001)}`),
    ]);
    expect(tooLarge.findings.map((finding) => finding.code)).toEqual(["kit-growth-exception"]);
  });

  test("does not let an exception name another boundary", () => {
    const report = evaluateKitGrowth([
      source("scripts/wiki/large.ts", "x\n"),
    ], { exceptions: { "scripts/wiki/large.ts": { name: "made-up" } } });
    expect(report.files[0].exception).toBeNull();
    expect(report.ok).toBe(true);
  });

  test("publisher output is deterministic and current files stay within the ratified screen", () => {
    const first = buildKitGrowthReport();
    const second = buildKitGrowthReport();
    expect(renderKitGrowthJson(first)).toBe(renderKitGrowthJson(second));
    expect(kitGrowthDigest(first)).toBe(kitGrowthDigest(second));
    expect(first.ok).toBe(true);
    expect(first.scope.totalRepositoryLinesIgnored).toBe(true);
    expect(KIT_CONTRACT_AREAS["scripts/wiki/kit-growth-guard.ts"]).toBe("production");
    expect(first.files.find((file) => file.path === "scripts/wiki/review-bundle.ts")?.exception?.used).toBe(true);
  });
});
