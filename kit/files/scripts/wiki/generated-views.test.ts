import { describe, expect, test } from "bun:test";
import { parseWikiPage } from "./page-validation";
import {
  GENERATED_HEADER,
  buildConflictMap,
  buildSourceMap,
  generateConflictsIndex,
  generateCurrentStatus,
  generateIndex,
  generateWorkQueue,
  generatedCoreFiles,
} from "./generated-views";
import type { WikiPage } from "./model";

function page(path: string, overrides: Record<string, unknown> = {}): WikiPage {
  const data = {
    id: path.replace(/^wiki\//, "").replace(/\.md$/, ""),
    summary: "Generated view page.",
    kind: "product",
    status: "current",
    authority: "normative",
    owners: ["@owner"],
    sources: [{ path: "src/main.ts" }],
    ...overrides,
  };
  return parseWikiPage(path, `---\n${Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n\n# Page\n`);
}

function fixture(): WikiPage[] {
  return [
    page("wiki/product/main.md"),
    page("wiki/conflicts/open/C-900.md", {
      id: "conflict/C-900",
      conflict_id: "C-900",
      kind: "conflict",
      status: "conflicted",
      authority: "observed",
      conflict_type: "decision",
      severity: "high",
      origin: "baseline",
      opened_at: "2026-01-01",
      affected_pages: ["product/main"],
      affected_invariants: [],
      resolution: { state: "open", acceptance: ["Record the decision."] },
    }),
  ] as WikiPage[];
}

describe("generated Wiki views", () => {
  test("renders byte-stable indexes and queue projections", () => {
    const pages = fixture();
    expect(generateIndex(pages)).toBe(generateIndex(pages));
    expect(generateCurrentStatus(pages)).toContain("Open conflicts (1)");
    expect(generateConflictsIndex(pages)).toContain("C-900");
    expect(generateWorkQueue(pages)).toContain("Open decision conflicts");
    expect(generateIndex(pages).startsWith(GENERATED_HEADER)).toBe(true);
  });

  test("maps current and open-conflict source declarations separately", () => {
    const pages = fixture();
    expect(buildSourceMap(pages)).toEqual({ version: 1, exact: { "src/main.ts": ["product/main"] }, globs: [] });
    expect(buildConflictMap(pages)).toEqual({ version: 1, exact: { "src/main.ts": ["C-900"] }, globs: [] });
  });

  test("packages every generated core file with deterministic bytes", () => {
    const files = generatedCoreFiles(fixture(), "Demo");
    expect(Object.keys(files).sort()).toEqual([
      ".wiki/conflict-map.json",
      ".wiki/source-map.json",
      "wiki/conflicts.md",
      "wiki/current-status.md",
      "wiki/index.md",
      "wiki/work-queue.md",
    ]);
    expect(files["wiki/index.md"]).toContain("# Demo wiki");
    expect(files[".wiki/source-map.json"]).toContain("product/main");
  });
});
