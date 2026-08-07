import { describe, expect, test } from "bun:test";
import { hashContent, jsonStable } from "./serialization";
import { parseWikiPage } from "./page-validation";
import { buildConflictMap, buildSourceMap } from "./generated-views";
import {
  UsageError,
  isHighRisk,
  mappedConflicts,
  mappedPages,
  parseFreshContextPolicy,
  readConfig,
  validateCoverage,
  validateIntegrationSeams,
  validateState,
  verifyState,
  type FreshContextPolicy,
} from "./verification";
import type { RepoView } from "./repository-view";

function view(files: Record<string, string>): RepoView {
  const paths = Object.keys(files).sort();
  return {
    root: "/memory",
    mode: "working",
    listFiles: () => paths,
    exists: (path) => path in files,
    read: (path) => files[path] ?? "",
  };
}

function page(id = "product/test", source = "src/value.ts") {
  return parseWikiPage(`wiki/${id}.md`, `---
id: ${id}
summary: Test contract
kind: product
status: current
authority: observed
owners: ["@owner"]
sources:
  - path: ${source}
---

# Test
`);
}

describe("verification boundaries", () => {
  test("maps exact and glob source/conflict paths deterministically", () => {
    const mapped = { version: 1 as const, exact: { "src/value.ts": ["product/test"] }, globs: [{ glob: "src/**/*.ts", pages: ["architecture/code"] }] };
    const conflicts = { version: 1 as const, exact: { "src/value.ts": ["C-002"] }, globs: [{ glob: "src/**/*.ts", conflicts: ["C-001"] }] };
    expect(mappedPages(mapped, "src/value.ts")).toEqual(["architecture/code", "product/test"]);
    expect(mappedConflicts(conflicts, "src/value.ts")).toEqual(["C-001", "C-002"]);
    expect(mappedPages(buildSourceMap([page()]), "src/value.ts")).toEqual(["product/test"]);
    expect(mappedConflicts(buildConflictMap([]), "src/value.ts")).toEqual([]);
  });

  test("normalizes and validates Fresh-context policy without changing trust semantics", () => {
    const policy: FreshContextPolicy = {
      mode: "required",
      requiredVerdict: "PASS",
      evidenceRequired: true,
      trust: { allowedReviewers: ["zeta", "alpha"], requireDifferentActor: false, requireAuthenticatedActor: true },
      requiredWhen: {
        kind: "risk-based",
        changedFileGlobs: ["src/**", "wiki/**"],
        affectedInvariants: true,
        affectedConflicts: false,
        removedCurrentPages: true,
      },
    };
    expect(parseFreshContextPolicy(policy)).toEqual({
      mode: "required",
      requiredVerdict: "PASS",
      evidenceRequired: true,
      trust: { allowedReviewers: ["alpha", "zeta"], requireDifferentActor: false, requireAuthenticatedActor: true },
      requiredWhen: { kind: "risk-based", changedFileGlobs: ["src/**", "wiki/**"], affectedInvariants: true, affectedConflicts: false, removedCurrentPages: true },
    });
    expect(parseFreshContextPolicy({ ...policy, requiredWhen: { kind: "risk-based", changedFileGlobs: [], affectedInvariants: false, affectedConflicts: false, removedCurrentPages: false } })).toBeUndefined();
  });

  test("reads a safe fallback and classifies configured high-risk paths", () => {
    expect(readConfig(view({}))).toEqual({ version: 1, name: "Project", highRisk: [], publishesKit: false });
    const config = readConfig(view({ ".wiki/config.json": jsonStable({ version: 1, name: "Demo", highRisk: ["src/contracts/**"], publishesKit: true }) }));
    expect(config.name).toBe("Demo");
    expect(config.publishesKit).toBe(true);
    expect(isHighRisk(config, "src/contracts/api.ts")).toBe(true);
    expect(isHighRisk(config, "src/ui.ts")).toBe(false);
  });

  test("fails closed on coverage omissions and malformed integration policy", () => {
    const current = page();
    const files = {
      ".wiki/coverage.json": jsonStable({ version: 1, include: ["src/**/*.ts"], exclusions: [] }),
      "src/mapped.ts": "export const mapped = true;\n",
      "src/unmapped.ts": "export const unmapped = true;\n",
      "wiki/product/test.md": current.raw,
      ".wiki/config.json": jsonStable({ version: 1, name: "x", highRisk: [] }),
    };
    expect(validateCoverage(view(files), [current]).map((item) => item.path)).toContain("src/unmapped.ts");
    expect(validateIntegrationSeams(view(files)).map((item) => item.code)).toEqual(expect.arrayContaining([
      "fresh-context-config-missing",
      "fresh-context-agents-marker-missing",
    ]));
  });

  test("state verification binds source hashes and rejects short unchanged explanations", () => {
    const source = "export const value = 1;\n";
    const current = page();
    const files = { "src/value.ts": source, "wiki/product/test.md": current.raw };
    expect(() => verifyState(view(files), [current], [current.data.id], "too short")).toThrow(UsageError);
    const state = verifyState(view(files), [current], [current.data.id], "Only a non-semantic refactor changed source organization.");
    expect(state.pages[current.data.id].sources).toEqual({ "src/value.ts": hashContent(source) });
    const stale = validateState(view({ ...files, ".wiki/state.json": jsonStable(state), "src/value.ts": "changed\n" }), [current]);
    expect(stale.stalePages).toEqual([current.data.id]);
  });
});
