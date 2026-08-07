import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildConflictMap,
  buildSourceMap,
  changedFiles,
  cleanupTemporary,
  compareGenerated,
  createRepoView,
  generateConflictsIndex,
  generateCurrentStatus,
  generateIndex,
  generatedCoreFiles,
  hashContent,
  impactReport,
  isConflictGuardFinding,
  isHighRisk,
  isImplementationSourceChange,
  jsonStable,
  loadWikiPages,
  mappedPages,
  mappedConflicts,
  makeReviewBundle,
  parsePrMetadata,
  parseWikiPage,
  searchWikiPages,
  validateMarkdownLinks,
  validatePages,
  validateCoverage,
  validatePrMetadata,
  validateState,
  verifyState,
  tempRepo,
  run,
  put,
  frontmatter,
  conflictFrontmatter,
  memoryView,
  temporary,
  type RepoView,
  type WikiPage,
} from "./test-fixtures/wiki";

afterEach(cleanupTemporary);

describe("inventory and impact primitives", () => {
  test("maps exact paths and globs", () => {
    const map = { version: 1 as const, exact: { "a.ts": ["exact"] }, globs: [{ glob: "src/**/*.ts", pages: ["glob"] }] };
    expect(mappedPages(map, "a.ts")).toEqual(["exact"]);
    expect(mappedPages(map, "src/x/y.ts")).toEqual(["glob"]);
    const config = { version: 1 as const, name: "x", highRisk: ["src/api/**"], publishesKit: false };
    expect(isHighRisk(config, "src/api/routes.ts")).toBe(true);
    expect(isHighRisk(config, "src/ui/button.ts")).toBe(false);
  });

  test("parses the PR YAML contract", () => {
    const metadata = parsePrMetadata("before\n```yaml\nchange_type: feature\nsemantic_change: true\nwiki_action: update\naffected_pages: []\naffected_invariants: []\ntouched_conflicts: []\n```\nafter");
    expect(metadata?.change_type).toBe("feature");
    expect(metadata?.semantic_change).toBe(true);
    expect(metadata?.touched_conflicts).toEqual([]);
  });

  test("rejects missing and malformed PR metadata fields", () => {
    expect(validatePrMetadata(undefined, true).findings.map((item) => item.code)).toContain("metadata-missing");
    const invalid = validatePrMetadata("```yaml\nchange_type: magic\nsemantic_change: yes\nwiki_action: potato\naffected_pages: nope\naffected_invariants: []\ntouched_conflicts: nope\n```");
    expect(invalid.metadata).toBeUndefined();
    expect(invalid.findings.map((item) => item.code)).toEqual(expect.arrayContaining(["metadata-change-type", "metadata-semantic-change", "metadata-wiki-action", "metadata-affected-pages", "metadata-touched-conflicts"]));
    const shortRetain = validatePrMetadata("```yaml\nchange_type: refactor\nsemantic_change: false\nwiki_action: verify\naffected_pages: []\naffected_invariants: []\ntouched_conflicts:\n  - id: C-008\n    action: retain\n    reason: too short\n```");
    expect(shortRetain.findings.map((item) => item.code)).toContain("metadata-conflict-retain-reason");
    expect(isConflictGuardFinding({ code: "metadata-conflict-retain-reason", message: "x", severity: "error" })).toBe(true);
    expect(isConflictGuardFinding({ code: "stale-verification", message: "x", severity: "error" })).toBe(false);
  });

  test("requires major source coverage and accepts reasoned exclusions", () => {
    const config = { version: 1, include: ["src/**/*.ts"], exclusions: [{ glob: "src/generated.ts", reason: "Generated test evidence is excluded from maintained behavior." }] };
    const raw = frontmatter({ sources: [{ path: "src/mapped.ts" }] });
    const view = memoryView({
      ".wiki/coverage.json": jsonStable(config),
      "src/mapped.ts": "export const mapped = true;",
      "src/unmapped.ts": "export const unmapped = true;",
      "src/generated.ts": "generated",
      "wiki/product/test.md": raw,
    });
    const findings = validateCoverage(view, loadWikiPages(view).pages);
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe("src/unmapped.ts");
    expect(findings[0].message).toContain("add this path to a current page's sources");
  });

  test("reports empty and invalid coverage patterns without crashing", () => {
    const view = memoryView({
      ".wiki/coverage.json": jsonStable({ version: 1, include: ["typo/**/*.ts"], exclusions: [{ glob: 42, reason: "This malformed exclusion has a sufficiently long reason." }] }),
    });
    const codes = validateCoverage(view, []).map((item) => item.code);
    expect(codes).toContain("coverage-include-empty");
    expect(codes).toContain("coverage-exclusion-invalid");
  });
});

