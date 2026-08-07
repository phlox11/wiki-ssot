import { describe, expect, beforeAll, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildKitModularityBaselineReport,
  compilerSurface,
  KIT_MODULARITY_BASELINE_REVISION,
  KIT_MODULARITY_EXPECTED,
  renderKitModularityBaselineJson,
  renderKitModularityBaselineMarkdown,
  writeKitModularityBaselineEvidence,
  type KitModularityBaselineReport,
} from "./kit-modularity-baseline";

const root = resolve(import.meta.dir, "../..");
const expectedManifestDigest = "4963245ac4504cb8c6062dea1816a748af88f63deb669411ab6e242a4cd7b52e";
const expectedEntriesDigest = "5250acbdc9f064a1bf363d370692726d8ce8e82ae64a52b065a57180af2852ad";
const expectedFixtureDigest = "9bdbc1073fb13fc6c7ae2488f34902e5d2268f50187e03ebb8ab295afff9e6cc";

let report: KitModularityBaselineReport;

beforeAll(async () => {
  report = await buildKitModularityBaselineReport(root);
}, 120_000);

describe("KM-00 portable-kit modularity baseline", () => {
  test("reproduces the pinned metrics and content-addressed digests", () => {
    expect(report.exactRevision).toBe(KIT_MODULARITY_BASELINE_REVISION);
    expect(report.summary).toEqual({
      copiedToolingLines: KIT_MODULARITY_EXPECTED.copiedTooling.lines,
      copiedToolingBytes: KIT_MODULARITY_EXPECTED.copiedTooling.bytes,
      typeScriptLines: 9834,
      typeScriptBytes: 521052,
      splitTargetLines: KIT_MODULARITY_EXPECTED.splitTargets.lines,
      splitTargetBytes: KIT_MODULARITY_EXPECTED.splitTargets.bytes,
      splitTargetShare: KIT_MODULARITY_EXPECTED.splitTargets.bytes / KIT_MODULARITY_EXPECTED.copiedTooling.bytes,
      manifestDigest: expectedManifestDigest,
    });
    expect(report.kit.entriesDigest).toBe(expectedEntriesDigest);
    expect(report.kit.manifestDigest).toBe(expectedManifestDigest);
    expect(report.cli.fixtureDigest).toBe(expectedFixtureDigest);
    expect(renderKitModularityBaselineJson(report)).toEndWith("\n");
    expect(renderKitModularityBaselineMarkdown(report)).toContain(`Manifest v2 digest: \`${expectedManifestDigest}\`.`);
  });

  test("records compiler import, export, type-only, and re-export edges", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "wiki-ssot-km00-ast-"));
    try {
      writeFileSync(join(fixtureRoot, "types.ts"), [
        "export type Foo = { value: string };",
        "export interface Bar { value: number }",
        "export const value = 1;",
      ].join("\n") + "\n", "utf8");
      writeFileSync(join(fixtureRoot, "surface.ts"), [
        "import type { Foo } from './types';",
        "import { type Bar, value } from './types';",
        "export { value as renamed } from './types';",
        "export type { Foo as ExportedFoo } from './types';",
        "export const use = (input: Foo, bar: Bar) => value + bar.value + input.value.length;",
      ].join("\n") + "\n", "utf8");
      const surface = compilerSurface(fixtureRoot, ["surface.ts", "types.ts"]);
      const edges = surface.edges.filter((edge) => edge.from === "surface.ts" && edge.resolved === "types.ts");
      expect(edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "import", typeOnly: true, names: ["Foo"], specifier: "./types" }),
        expect.objectContaining({ kind: "import", typeOnly: false, names: ["Bar", "value"], specifier: "./types" }),
        expect.objectContaining({ kind: "export", typeOnly: false, names: ["value"], specifier: "./types" }),
        expect.objectContaining({ kind: "export", typeOnly: true, names: ["Foo"], specifier: "./types" }),
      ]));
      expect(surface.files["surface.ts"].exports).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "ExportedFoo", kind: "type", typeOnly: true }),
        expect.objectContaining({ name: "renamed", typeOnly: false }),
      ]));
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("catalogs only CLI commands and keeps package-only scripts separate", () => {
    expect(report.cli.commandCount).toBe(17);
    expect(report.cli.commands).not.toContain("hooks:install");
    expect(report.cli.commands).not.toContain("tooling:typecheck");
    expect(report.cli.contract).toMatchObject({
      commandSource: "scripts/wiki/cli.ts usage()",
      packageOnlyScripts: ["wiki:hooks:install", "wiki:tooling:test", "wiki:tooling:typecheck"],
    });
    expect(report.cli.writeCommands).toEqual(["inventory", "index", "generated", "kit", "verify", "review-preflight", "review-bundle"]);
    expect(report.cli.fixtures.map((fixture) => fixture.id)).toEqual([
      "lint-json", "work-json", "context-work-json", "generated-write-json", "generated-check-json",
      "kit-write-json", "kit-check-json", "review-check-json", "work-help", "usage-error",
    ]);
    expect(report.cli.fixtures.filter((fixture) => fixture.writes).map((fixture) => fixture.id)).toEqual([
      "generated-write-json", "kit-write-json",
    ]);
    expect(report.cli.fixtures.find((fixture) => fixture.id === "usage-error")).toMatchObject({ exitCode: 2, format: "usage" });
  });

  test("retains test ownership, screen evidence, and sequencing contract", () => {
    expect(report.tests.discoveredExactlyOnce).toBe(true);
    expect(report.tests.discovered).toContain("scripts/wiki/fresh-context.test.ts");
    expect(report.tests.suites["scripts/wiki/fresh-context.test.ts"].shipped).toBe(true);
    expect(report.method.changeCouplingMethod).toContain("git log --no-merges");
    expect(report.screen.rule).toMatchObject({ lineThreshold: 1000, byteThreshold: 65536, materialByteThreshold: 30720, dispatcherLineThreshold: 250 });
    const targets = report.screen.targets as Record<string, { metric: { lines: number; bytes: number }; candidate: boolean }>;
    expect(targets["scripts/wiki/core.ts"]).toMatchObject({ metric: { lines: 4144, bytes: 230066 }, candidate: true });
    expect(targets["scripts/wiki/cli.ts"]).toMatchObject({ metric: { lines: 1277, bytes: 58274 }, candidate: true });
    expect(targets["scripts/wiki/wiki.test.ts"]).toMatchObject({ metric: { lines: 745, bytes: 41668 }, candidate: true });
    expect(report.sequencing).toMatchObject({ prerequisite: "TE-06-OWNER", noProductionModuleMoved: true });
    expect((report.sequencing.order as string[]).slice(0, 3)).toEqual(["KM-00 baseline", "KM-00-OWNER ratification", "KM-01"]);
  });

  test("writes evidence and detects stale --check output in temporary paths", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "wiki-ssot-km00-output-"));
    const jsonPath = join(outputRoot, "baseline.json");
    const markdownPath = join(outputRoot, "baseline.md");
    try {
      const written = writeKitModularityBaselineEvidence(report, jsonPath, markdownPath);
      expect(written.mode).toBe("write");
      expect(written.messages).toEqual([`wrote ${jsonPath}`, `wrote ${markdownPath}`]);
      expect(existsSync(jsonPath)).toBe(true);
      expect(existsSync(markdownPath)).toBe(true);
      expect(readFileSync(jsonPath, "utf8")).toBe(renderKitModularityBaselineJson(report));
      expect(readFileSync(markdownPath, "utf8")).toBe(renderKitModularityBaselineMarkdown(report));

      const current = writeKitModularityBaselineEvidence(report, jsonPath, markdownPath, true);
      expect(current.mode).toBe("check");
      expect(current.messages[0]).toContain("current");

      writeFileSync(jsonPath, `${readFileSync(jsonPath, "utf8")}stale\n`, "utf8");
      expect(() => writeKitModularityBaselineEvidence(report, jsonPath, markdownPath, true)).toThrow(`KM-00 evidence is stale: ${jsonPath}, ${markdownPath}`);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  }, 180_000);
});
