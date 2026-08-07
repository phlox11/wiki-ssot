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

describe("frontmatter schema", () => {
  test("accepts a valid current page", () => {
    const view = memoryView({ "source.ts": "export const value = 1", "wiki/product/test.md": frontmatter() });
    const loaded = loadWikiPages(view);
    expect(loaded.findings).toEqual([]);
    expect(validatePages(view, loaded.pages).filter((item) => item.severity === "error")).toEqual([]);
  });

  test("detects missing fields and invalid enums", () => {
    const raw = `---\nid: product/bad\nsummary: Bad\nkind: product\nstatus: live\nauthority: magic\nowners: []\nsources: []\n---\n`;
    const view = memoryView({ "wiki/product/bad.md": raw });
    const findings = validatePages(view, loadWikiPages(view).pages);
    expect(findings.map((item) => item.code)).toContain("frontmatter-status");
    expect(findings.map((item) => item.code)).toContain("frontmatter-authority");
    expect(findings.map((item) => item.code)).toContain("frontmatter-owners");
  });

  test("detects duplicate and dangling page IDs", () => {
    const first = frontmatter({ related: ["missing/page"] });
    const second = frontmatter({ summary: "Duplicate" });
    const view = memoryView({ "source.ts": "", "wiki/product/a.md": first, "wiki/product/b.md": second });
    const findings = validatePages(view, loadWikiPages(view).pages);
    expect(findings.map((item) => item.code)).toContain("duplicate-id");
    expect(findings.map((item) => item.code)).toContain("dangling-page-id");
  });

  test("rejects proposal-only evidence on a current page", () => {
    const view = memoryView({ "wiki/proposals/x.md": "proposal", "wiki/product/test.md": frontmatter({ sources: [{ path: "wiki/proposals/x.md" }] }) });
    expect(validatePages(view, loadWikiPages(view).pages).map((item) => item.code)).toContain("proposal-only-current");
  });

  test("validates open and resolved conflict lifecycle fields", () => {
    const validOpen = conflictFrontmatter();
    const openView = memoryView({
      "source.ts": "export const value = 1",
      "wiki/product/test.md": frontmatter(),
      "wiki/conflicts/open/C-900.md": validOpen,
    });
    expect(validatePages(openView, loadWikiPages(openView).pages).filter((item) => item.severity === "error")).toEqual([]);

    const invalid = conflictFrontmatter({ opened_at: "2026-02-30", sources: [], affected_pages: [], resolution: { state: "verified", acceptance: [] } });
    const invalidView = memoryView({ "source.ts": "", "wiki/product/test.md": frontmatter(), "wiki/conflicts/open/C-900.md": invalid });
    expect(validatePages(invalidView, loadWikiPages(invalidView).pages).map((item) => item.code)).toEqual(expect.arrayContaining([
      "conflict-opened-at",
      "conflict-without-source",
      "conflict-affected-pages",
      "conflict-acceptance",
    ]));

    const resolved = conflictFrontmatter({ status: "archived", resolution: { state: "verified", decision: "The implementation contract was adopted.", acceptance: ["Implemented."], evidence: ["source.ts and its test prove the behavior."] } });
    const resolvedView = memoryView({ "source.ts": "", "wiki/product/test.md": frontmatter(), "wiki/conflicts/resolved/C-900.md": resolved });
    expect(validatePages(resolvedView, loadWikiPages(resolvedView).pages).filter((item) => item.severity === "error")).toEqual([]);
  });
});

describe("Markdown links", () => {
  test("checks relative files but ignores URLs and code", () => {
    const view = memoryView({
      "docs/a.md": "[ok](./b.md) [bad](./missing.md) [web](https://example.com) `x[](missing-inline)`\n```md\n[x](missing-code)\n```",
      "docs/b.md": "# B",
    });
    const findings = validateMarkdownLinks(view);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("missing.md");
  });

  test("honors a non-expired legacy allowlist", () => {
    const view = memoryView({
      "a.md": "[old](missing.md)",
      ".wiki/legacy-link-allowlist.json": jsonStable([{ source: "a.md", target: "missing.md", reason: "Temporary legacy drift with an explicit replacement plan.", expires: "2099-01-01" }]),
    });
    expect(validateMarkdownLinks(view)).toEqual([]);
  });
});

describe("staged snapshot", () => {
  test("ignores an unstaged error after a valid page is staged", () => {
    const root = tempRepo();
    put(root, "source.ts", "export const value = 1;\n");
    put(root, "wiki/product/test.md", frontmatter());
    run(root, ["git", "add", "."]);
    put(root, "wiki/product/test.md", "not frontmatter\n");
    const staged = createRepoView(root, true);
    expect(staged.read("wiki/product/test.md")).toContain("id: \"product/test\"");
    expect(loadWikiPages(staged).findings).toEqual([]);
  });

  test("reads a newly staged file from the index", () => {
    const root = tempRepo();
    put(root, "new.md", "staged content\n");
    run(root, ["git", "add", "new.md"]);
    expect(createRepoView(root, true).read("new.md")).toBe("staged content\n");
  });
});

describe("baseline-proven query relevance", () => {
  test("keeps deterministic partial matches when no page contains every query term", () => {
    const pages = [
      parseWikiPage("wiki/features/checkout.md", `${frontmatter({
        id: "features/checkout",
        summary: "Refund checkout behavior.",
        kind: "feature",
      })}\nPartial refunds are supported.\n`),
      parseWikiPage("wiki/features/orders.md", `${frontmatter({
        id: "features/orders",
        summary: "Order export behavior.",
        kind: "feature",
      })}\nOrder exports are supported.\n`),
    ];
    expect(searchWikiPages(pages, "refund order").map((item) => item.page.data.id)).toEqual([
      "features/checkout",
      "features/orders",
    ]);
  });
});

