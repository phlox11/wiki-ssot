import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  KM07_EXIT_BASELINE_REVISION,
  buildKitModularityExitReport,
  renderKitModularityExitJson,
  renderKitModularityExitMarkdown,
  writeKitModularityExitEvidence,
} from "./kit-modularity-exit";

const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-ssot-km07-exit-"));
  temporary.push(root);
  return root;
}

function baselineFixture() {
  return JSON.parse(readFileSync(join(process.cwd(), "docs/evidence/km-00-portable-kit-baseline.json"), "utf8"));
}

describe("KM-07 portable-kit modularity exit", () => {
  test("binds a deterministic source tree, manifest, module surface, and test ownership map", () => {
    const first = buildKitModularityExitReport({ baselineReport: baselineFixture() });
    const second = buildKitModularityExitReport({ baselineReport: baselineFixture() });
    expect(first.kind).toBe("km-07-portable-kit-final");
    expect(first.baseline.revision).toBe(KM07_EXIT_BASELINE_REVISION);
    expect(first.digests.sourceTree).toMatch(/^[0-9a-f]{64}$/);
    expect(first.digests.manifest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.digests.sourceTree).toBe(second.digests.sourceTree);
    expect(renderKitModularityExitJson(first)).toBe(renderKitModularityExitJson(second));
    expect(renderKitModularityExitMarkdown(first)).toContain("Baseline versus current");
    expect(first.modules.files["scripts/wiki/cli.ts"]).toMatchObject({ contractArea: "production" });
    expect(first.modules.files["scripts/wiki/kit-growth-guard.ts"]).toMatchObject({ contractArea: "production" });
    expect(first.tests.ownership["scripts/wiki/kit-growth-guard.test.ts"]).toMatchObject({
      owner: "portable module growth guard contract",
      contractArea: "regression",
    });
    expect(first.modules.allPurposeProductionModules).toEqual([]);
    expect(first.cli.thin).toBe(true);
    expect(first.exception).toMatchObject({ path: "scripts/wiki/review-bundle.ts", withinCap: true });
  }, 120_000);

  test("reports changed working-tree breadth without including its own report outputs", () => {
    const report = buildKitModularityExitReport({ baselineReport: baselineFixture() });
    expect(report.changes.excluded).toEqual([
      "docs/evidence/km-07-portable-kit-final.json",
      "docs/evidence/km-07-portable-kit-final.md",
    ]);
    expect(report.changes.files.some((file) => file.path === "scripts/wiki/kit-modularity-exit.ts")).toBe(true);
    expect(report.changes.files.some((file) => file.path === "docs/evidence/km-07-portable-kit-final.json")).toBe(false);
  }, 120_000);

  test("writes exact JSON/Markdown evidence and detects stale output", () => {
    const output = tempDir();
    const jsonPath = join(output, "final.json");
    const markdownPath = join(output, "final.md");
    const report = buildKitModularityExitReport({ baselineReport: baselineFixture() });
    const written = writeKitModularityExitEvidence(report, jsonPath, markdownPath);
    expect(written.mode).toBe("write");
    expect(existsSync(jsonPath)).toBe(true);
    expect(readFileSync(jsonPath, "utf8")).toBe(renderKitModularityExitJson(report));
    expect(readFileSync(markdownPath, "utf8")).toBe(renderKitModularityExitMarkdown(report));
    expect(writeKitModularityExitEvidence(report, jsonPath, markdownPath, true).mode).toBe("check");
    writeFileSync(jsonPath, `${readFileSync(jsonPath, "utf8")}stale\n`, "utf8");
    expect(() => writeKitModularityExitEvidence(report, jsonPath, markdownPath, true)).toThrow("KM-07 exit evidence is stale");
  }, 120_000);
});
