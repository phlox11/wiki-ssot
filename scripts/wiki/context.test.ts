import { describe, expect, test } from "bun:test";
import { parseWikiPage } from "./page-validation";
import {
  buildCompactTopicCandidateContext,
  buildPageContext,
  buildSelectedWorkContext,
  buildTopicContext,
  projectSelectedWorkContext,
  projectTopicContext,
} from "./context";
import { buildWorkQueue, searchWikiPages } from "./discovery";
import type { RepoView } from "./repository-view";
import type { WikiPage, WorkItem } from "./model";
import type { CompactSelectedWorkContext, CompactTopicContext } from "./context";

const view: RepoView = {
  root: "/memory",
  mode: "working",
  listFiles: () => [
    "src/a.ts",
    "src/main.ts",
    "wiki/conflicts/open/C-900.md",
    "wiki/product/invariant.md",
    "wiki/product/main.md",
    "wiki/proposals/work.md",
  ],
  exists: (path) => view.listFiles().includes(path),
  read: (path) => `// ${path}\n`,
};

function rawPage(path: string, overrides: Record<string, unknown> = {}, body = "Body") {
  const data = {
    id: path.replace(/^wiki\//, "").replace(/\.md$/, ""),
    summary: "A context page.",
    kind: "product",
    status: "current",
    authority: "normative",
    owners: ["@owner"],
    sources: [{ path: "src/main.ts" }],
    ...overrides,
  };
  return parseWikiPage(path, `---\n${Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n\n${body}\n`);
}

function allPages(): WikiPage[] {
  const item: WorkItem = {
    id: "WK-01",
    title: "Context work",
    state: "not-started",
    priority: "normal",
    depends_on: [],
    context_pages: ["product/main"],
    acceptance: ["Read all controlling context."],
    evidence: [],
  };
  return [
    rawPage("wiki/product/main.md", { summary: "Context main.", sources: [{ path: "src/main.ts" }, { glob: "src/*.ts" }] }),
    rawPage("wiki/product/invariant.md", { id: "product/invariant", kind: "invariant", summary: "Invariant contract." }),
    rawPage("wiki/proposals/work.md", { id: "proposal/work", summary: "Work proposal.", kind: "proposal", status: "proposed", work_items: [item] }),
    rawPage("wiki/conflicts/open/C-900.md", {
      id: "conflict/C-900",
      conflict_id: "C-900",
      kind: "conflict",
      status: "conflicted",
      authority: "observed",
      conflict_type: "decision",
      severity: "high",
      origin: "baseline",
      opened_at: "2026-01-01",
      sources: [{ path: "src/main.ts" }],
      affected_pages: ["product/main"],
      affected_invariants: ["product/invariant"],
      summary: "Open conflict.",
      resolution: { state: "open", acceptance: ["Record a decision."] },
    }),
  ] as WikiPage[];
}

describe("context projections", () => {
  test("reads invariant, conflict, current page, then sorted expanded sources", () => {
    const pages = allPages();
    const queue = buildWorkQueue(pages);
    const context = buildSelectedWorkContext(view, pages, queue.groups.ready[0]);
    expect(context.pages.map((item) => item.id)).toEqual(["product/invariant", "product/main"]);
    expect(context.conflicts.map((item) => item.id)).toEqual(["C-900"]);
    expect(context.readOrder).toEqual([
      { kind: "invariant", id: "product/invariant", path: "wiki/product/invariant.md" },
      { kind: "conflict", id: "C-900", path: "wiki/conflicts/open/C-900.md" },
      { kind: "page", id: "product/main", path: "wiki/product/main.md" },
      { kind: "source", path: "src/a.ts", declaredBy: ["product/main"] },
      { kind: "source", path: "src/main.ts", declaredBy: ["C-900", "product/invariant", "product/main"] },
    ]);
    expect(context.pages.find((item) => item.id === "product/main")?.sourceFiles).toEqual(["src/a.ts", "src/main.ts"]);
  });

  test("keeps full bodies while compact projections expose stable digests and commands", () => {
    const pages = allPages();
    const queue = buildWorkQueue(pages);
    const full = buildSelectedWorkContext(view, pages, queue.groups.ready[0]);
    const compact = projectSelectedWorkContext(full, "compact") as CompactSelectedWorkContext;
    expect(projectSelectedWorkContext(full, "full")).toBe(full);
    expect(compact.pages[0]).not.toHaveProperty("body");
    expect(compact.pages[0].bodyDigest).toHaveLength(64);
    expect(compact.pages[0].focusedCommand).toContain("--page product/invariant --full");
  });

  test("builds partial candidates without source expansion and closes conflicts for focused pages", () => {
    const pages = allPages();
    const matches = searchWikiPages(pages, "context work");
    const partial = buildCompactTopicCandidateContext(pages, "context work", matches);
    expect(partial.matchMode).toBe("partial");
    expect(partial.pages).toEqual([]);
    expect(partial.candidates.map((candidate) => candidate.id)).toEqual(["product/main", "proposal/work"]);
    expect(partial.candidates.find((candidate) => candidate.id === "product/main")?.relevantOpenConflicts).toEqual(["C-900"]);

    const topic = buildTopicContext(view, pages, "context work");
    const compact = projectTopicContext(topic, "compact", matches) as CompactTopicContext;
    expect(compact.pages).toEqual([]);
    expect(compact.candidates.map((candidate) => candidate.id)).toEqual(partial.candidates.map((candidate) => candidate.id));
    const focused = buildPageContext(view, pages, "product/main");
    expect(focused.pages.map((item) => item.id)).toEqual(["product/invariant", "product/main"]);
    expect(focused.conflicts.map((item) => item.id)).toEqual(["C-900"]);
  });
});
