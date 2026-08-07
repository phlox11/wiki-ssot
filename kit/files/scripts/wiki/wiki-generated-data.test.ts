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

describe("deterministic generated data", () => {
  const page = parseWikiPage("wiki/product/test.md", frontmatter()) as WikiPage;
  const conflict = parseWikiPage("wiki/conflicts/open/C-900.md", conflictFrontmatter()) as WikiPage;

  test("index, status, and source map are byte stable", () => {
    expect(generateIndex([page, conflict])).toBe(generateIndex([page, conflict]));
    expect(generateCurrentStatus([page, conflict])).toContain("Open conflicts (1)");
    expect(generateConflictsIndex([page, conflict])).toContain("C-900");
    expect(jsonStable(buildSourceMap([page, conflict]))).toBe(jsonStable(buildSourceMap([page, conflict])));
    expect(mappedConflicts(buildConflictMap([page, conflict]), "source.ts")).toEqual(["C-900"]);
  });

  test("detects manual generated edits", () => {
    const expected = generatedCoreFiles([page]);
    const files = { "source.ts": "", "wiki/product/test.md": frontmatter(), ...expected, "wiki/index.md": `${expected["wiki/index.md"]}manual\n` };
    expect(compareGenerated(memoryView(files), expected).map((item) => item.code)).toContain("generated-stale");
  });

  test("hashes identical content identically", () => {
    expect(hashContent("same")).toBe(hashContent("same"));
    expect(hashContent("same")).not.toBe(hashContent("different"));
  });
});

