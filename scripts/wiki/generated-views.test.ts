import { describe, expect, test } from "bun:test";
import { parseWikiPage } from "./page-validation";
import {
  GENERATED_HEADER,
  buildRelationshipGraph,
  buildConflictMap,
  buildSourceMap,
  generateCatalog,
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
    page("wiki/product/main.md", { related: ["product/other"] }),
    page("wiki/product/other.md", { id: "product/other", affects: ["product/main"] }),
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
    page("wiki/conflicts/open/C-901.md", {
      id: "conflict/C-901",
      conflict_id: "C-901",
      kind: "conflict",
      status: "conflicted",
      authority: "observed",
      conflict_type: "implementation",
      severity: "medium",
      origin: "baseline",
      opened_at: "2026-01-02",
      affected_pages: ["product/main"],
      affected_invariants: [],
      resolution: { state: "open", acceptance: ["Record the implementation."] },
    }),
    page("wiki/conflicts/open/C-902.md", {
      id: "conflict/C-902",
      conflict_id: "C-902",
      kind: "conflict",
      status: "conflicted",
      authority: "observed",
      conflict_type: "documentation",
      severity: "low",
      origin: "baseline",
      opened_at: "2026-01-03",
      affected_pages: ["product/main"],
      affected_invariants: [],
      resolution: { state: "open", acceptance: ["Record the documentation."] },
    }),
  ] as WikiPage[];
}

describe("generated Wiki views", () => {
  test("renders byte-stable indexes and queue projections", () => {
    const pages = fixture();
    expect(generateIndex(pages)).toBe(generateIndex(pages));
    expect(generateCurrentStatus(pages)).toContain("Open conflicts | 3");
    expect(generateConflictsIndex(pages)).toContain("C-900");
    expect(generateConflictsIndex(pages)).toContain("C-901");
    expect(generateConflictsIndex(pages)).toContain("C-902");
    expect(generateWorkQueue(pages)).toContain("## Open conflicts");
    expect(generateIndex(pages).startsWith(GENERATED_HEADER)).toBe(true);
  });

  test("maps current and open-conflict source declarations separately", () => {
    const pages = fixture();
    expect(buildSourceMap(pages)).toEqual({ version: 1, exact: { "src/main.ts": ["product/main", "product/other"] }, globs: [] });
    expect(buildConflictMap(pages)).toEqual({ version: 1, exact: { "src/main.ts": ["C-900", "C-901", "C-902"] }, globs: [] });
  });

  test("preserves declared relationship directions without source nodes", () => {
    const graph = buildRelationshipGraph(fixture());
    expect(graph.nodes.filter((node) => node.type === "page").map((node) => node.id)).toEqual([
      "conflict/C-900", "conflict/C-901", "conflict/C-902", "product/main", "product/other",
    ]);
    expect(graph.nodes.some((node) => node.type === "work")).toBe(false);
    expect(graph.edges).toEqual([
      { from: "conflict/C-900", to: "product/main", type: "conflict-affected-page" },
      { from: "conflict/C-901", to: "product/main", type: "conflict-affected-page" },
      { from: "conflict/C-902", to: "product/main", type: "conflict-affected-page" },
      { from: "product/main", to: "product/other", type: "related" },
      { from: "product/other", to: "product/main", type: "affects" },
    ]);
  });

  test("keeps the root index bounded and exposes the complete catalog", () => {
    const pages = fixture();
    const index = generateIndex(pages);
    const catalog = generateCatalog(pages);
    expect(index).toContain("[Wiki catalog](./catalog.md)");
    expect(index).not.toContain("product/main");
    expect(catalog).toContain("## current / product");
    expect(catalog).toContain("[product/main](./product/main.md)");
    expect(catalog).toContain("[product/other](./product/other.md)");
    expect(catalog).toContain("Related");
    expect(catalog).toContain("Affects");
    expect(catalog).toContain("[product/other](./product/other.md)");
    expect(catalog).toContain("## conflicted / conflicts");
  });

  test("packages every generated core file with deterministic bytes", () => {
    const files = generatedCoreFiles(fixture(), "Demo");
    expect(Object.keys(files).sort()).toEqual([
      ".wiki/conflict-map.json",
      ".wiki/relationship-graph.json",
      ".wiki/source-map.json",
      "wiki/catalog.md",
      "wiki/conflicts.md",
      "wiki/current-status.md",
      "wiki/index.md",
      "wiki/work-queue.md",
    ]);
    expect(files["wiki/index.md"]).toContain("# Demo wiki");
    expect(files[".wiki/source-map.json"]).toContain("product/main");
  });
});
