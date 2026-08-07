import { afterEach, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRepoView } from "./repository-view";
import { loadWikiPages } from "./page-validation";
import {
  changedFiles,
  evaluateFreshContextRequirement,
  impactReport,
  isImplementationSourceChange,
  parsePrMetadata,
  resolveDiffBase,
  validatePrMetadata,
  type ImpactReport,
  type PrMetadata,
} from "./impact";
import { hashContent, jsonStable } from "./serialization";
import type { FreshContextPolicy } from "./verification";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "impact-test-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Impact Test"]);
  run(root, ["git", "config", "user.email", "impact@example.invalid"]);
  return root;
}

function run(root: string, command: string[]) {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

function put(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

const metadata: PrMetadata = {
  change_type: "refactor",
  semantic_change: false,
  wiki_action: "verify",
  affected_pages: ["architecture/contracts"],
  affected_invariants: [],
  touched_conflicts: [],
};

describe("impact boundaries", () => {
  test("keeps metadata parsing and implementation-source classification stable", () => {
    const raw = [
      "```yaml",
      "change_type: feature",
      "semantic_change: true",
      "wiki_action: update",
      "affected_pages: []",
      "affected_invariants: []",
      "touched_conflicts: []",
      "```",
    ].join("\n");
    expect(parsePrMetadata(raw)?.change_type).toBe("feature");
    expect(validatePrMetadata(undefined, true).findings.map((item) => item.code)).toContain("metadata-missing");
    expect(isImplementationSourceChange("src/app.ts")).toBe(true);
    expect(isImplementationSourceChange("wiki/product/page.md")).toBe(false);
    expect(isImplementationSourceChange(".wiki/state.json")).toBe(false);
    expect(isImplementationSourceChange("kit/files/scripts/wiki/core.ts", true)).toBe(false);
  });

  test("classifies exact changed paths, merge base, stale verification, and high-risk mapping", () => {
    const root = tempRepo();
    const source = "src/contracts.ts";
    put(root, source, "export const value = 1;\n");
    put(root, ".wiki/config.json", jsonStable({ version: 1, name: "impact", highRisk: ["src/**"] }));
    put(root, "wiki/architecture/contracts.md", `---
id: architecture/contracts
summary: Contract
kind: architecture
status: current
authority: observed
owners: ["@owner"]
sources:
  - path: src/contracts.ts
---

# Contracts
`);
    put(root, ".wiki/state.json", jsonStable({ version: 1, pages: { "architecture/contracts": { sources: { [source]: hashContent("export const value = 1;\n") }, verification: { kind: "updated" } } } }));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "baseline"]);
    put(root, source, "export const value = 2;\n");
    run(root, ["git", "add", source]);
    run(root, ["git", "commit", "-qm", "change"]);
    expect(resolveDiffBase(root, "HEAD~1")).toBe("HEAD~1");
    expect(changedFiles(root, "HEAD~1")).toEqual([source]);
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const report = impactReport(view, pages, { base: "HEAD~1", metadata });
    expect(report.affectedPages).toEqual(["architecture/contracts"]);
    expect(report.highRiskStalePages).toEqual(["architecture/contracts"]);
    expect(report.findings.map((item) => item.code)).toContain("stale-verification");
  });

  test("fails invalid diff bases and requires declared affected pages", () => {
    const root = tempRepo();
    put(root, "README.md", "baseline\n");
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "baseline"]);
    expect(() => changedFiles(root, "not-a-revision")).toThrow("revision does not exist");
    expect(() => resolveDiffBase(root, "not-a-revision")).toThrow("revision does not exist");
  });

  test("selects Fresh-context review from changed paths and affected signals", () => {
    const policy: FreshContextPolicy = {
      mode: "required",
      requiredVerdict: "PASS",
      evidenceRequired: true,
      trust: { allowedReviewers: ["*"], requireDifferentActor: false, requireAuthenticatedActor: false },
      requiredWhen: {
        kind: "risk-based",
        changedFileGlobs: ["src/**"],
        affectedInvariants: true,
        affectedConflicts: true,
        removedCurrentPages: true,
      },
    };
    const emptyImpact: ImpactReport = {
      base: "origin/main",
      mergeBase: "0".repeat(40),
      changedFiles: ["docs/readme.md"],
      affectedPages: [],
      affectedConflicts: [],
      removedCurrentPages: [],
      stalePages: [],
      highRiskStalePages: [],
      advisoryStalePages: [],
      unmappedHighRisk: [],
      findings: [],
    };
    const manifest = { affected_invariant_ids: ["product/invariants"], affected_conflict_ids: [] };
    expect(evaluateFreshContextRequirement(policy, manifest, emptyImpact)).toEqual({
      applies: true,
      reasons: ["affected invariants: product/invariants"],
    });
    expect(evaluateFreshContextRequirement(policy, { affected_invariant_ids: [], affected_conflict_ids: [] }, { ...emptyImpact, changedFiles: ["src/app.ts"] })).toEqual({
      applies: true,
      reasons: ["changed file matches src/**: src/app.ts"],
    });
  });
});
