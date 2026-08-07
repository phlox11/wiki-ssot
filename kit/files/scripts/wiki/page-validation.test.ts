import { describe, expect, test } from "bun:test";
import { loadWikiPages, parseWikiPage, validateMarkdownLinks, validatePages } from "./page-validation";
import type { RepoView } from "./repository-view";
import type { WikiPage } from "./model";

function memoryView(files: Record<string, string>): RepoView {
  const paths = Object.keys(files).sort();
  return { root: "/memory", mode: "working", listFiles: () => paths, exists: (path) => path in files, read: (path) => files[path] };
}

function page(id = "product/test", source = "source.ts"): string {
  return `---\nid: ${id}\nsummary: Test contract.\nkind: product\nstatus: current\nauthority: normative\nowners: ["@owner"]\nsources: [{path: ${source}}]\n---\n\n# Test\n`;
}

function parsed(id = "product/test"): WikiPage {
  return parseWikiPage(`wiki/${id}.md`, page(id));
}

describe("page validation foundation", () => {
  test("parses frontmatter and preserves raw/body bytes", () => {
    const raw = page();
    const result = parseWikiPage("wiki/product/test.md", raw);
    expect(result.raw).toBe(raw);
    expect(result.body).toContain("# Test");
    expect(() => parseWikiPage("bad.md", "# no frontmatter")).toThrow("missing YAML frontmatter");
  });

  test("loads malformed pages as findings while retaining valid pages", () => {
    const loaded = loadWikiPages(memoryView({
      "wiki/product/good.md": page("product/good"),
      "wiki/product/bad.md": "# malformed\n",
      "source.ts": "export const value = 1;\n",
    }));
    expect(loaded.pages.map((item) => item.data.id)).toEqual(["product/good"]);
    expect(loaded.findings.map((item) => item.code)).toEqual(["frontmatter-parse"]);
  });

  test("validates source symbols and schema relationships", () => {
    const view = memoryView({ "source.ts": "export const value = 1;\n" });
    const current = parseWikiPage("wiki/product/test.md", page());
    current.data.sources = [{ path: "source.ts", symbols: ["missing"] }];
    const findings = validatePages(view, [current]);
    expect(findings.map((item) => item.code)).toEqual(["source-symbol-missing"]);
    expect(findings[0]?.severity).toBe("warning");
  });

  test("accepts an injected publisher policy for managed kit links", () => {
    const view = memoryView({
      "docs/readme.md": "[missing](missing.md)\n",
      "kit/files/generated.md": "[missing](missing.md)\n",
    });
    expect(validateMarkdownLinks(view).map((item) => item.path)).toEqual(["docs/readme.md", "kit/files/generated.md"]);
    expect(validateMarkdownLinks(view, { publishesKit: true, isManagedPath: (path) => path.startsWith("kit/") })).toEqual([
      { code: "broken-link", message: "link target does not exist: missing.md", path: "docs/readme.md", severity: "error" },
    ]);
  });

  test("ignores system and generated wiki pages as content", () => {
    const loaded = loadWikiPages(memoryView({
      "wiki/index.md": "generated",
      "wiki/_generated/inventory.md": "generated",
      "wiki/product/test.md": page(),
      "source.ts": "export const value = 1;\n",
    }));
    expect(loaded.pages.map((item) => item.path)).toEqual(["wiki/product/test.md"]);
  });
});
