import { describe, expect, test } from "bun:test";
import { parseWikiPage } from "./page-validation";
import {
  buildWorkQueue,
  conflictSummary,
  currentPages,
  openConflicts,
  projectWorkQueue,
  searchWikiPages,
} from "./discovery";
import { generateCurrentStatus, generateWorkQueue } from "./generated-views";
import { jsonStable } from "./serialization";
import type { WikiPage, WorkItem } from "./model";

function page(path: string, overrides: Record<string, unknown> = {}, body = "Body") {
  const data = {
    id: path.replace(/^wiki\//, "").replace(/\.md$/, ""),
    summary: "A deterministic page.",
    kind: "product",
    status: "current",
    authority: "normative",
    owners: ["@owner"],
    sources: [{ path: "src/main.ts" }],
    ...overrides,
  };
  return parseWikiPage(path, `---\n${Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n\n${body}\n`);
}

function work(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "WK-01",
    title: "Implement the contract",
    state: "not-started",
    priority: "normal",
    depends_on: [],
    context_pages: ["product/main"],
    acceptance: ["The implementation is covered by a focused test."],
    evidence: [],
    ...overrides,
  };
}

function pages(items: WorkItem[] = []): WikiPage[] {
  return [
    page("wiki/product/main.md"),
    page("wiki/product/invariant.md", { id: "product/invariant", kind: "invariant" }),
    page("wiki/proposals/work.md", {
      id: "proposal/work",
      kind: "proposal",
      status: "proposed",
      work_items: items,
    }),
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
      resolution: { state: "open", acceptance: ["Record the owner decision."] },
    }),
  ] as WikiPage[];
}

describe("discovery projections", () => {
  test("keeps current, search, and conflict ordering deterministic", () => {
    const input = pages();
    expect(currentPages([...input].reverse()).map((item) => item.data.id)).toEqual(["product/invariant", "product/main"]);
    expect(searchWikiPages(input, "deterministic page").map((item) => item.page.data.id)).toEqual([
      "conflict/C-900",
      "product/invariant",
      "product/main",
      "proposal/work",
    ]);
    expect(openConflicts([...input].reverse()).map((item) => item.data.conflict_id)).toEqual(["C-900"]);
    expect(conflictSummary(input[3]).id).toBe("C-900");
  });

  test("derives queue state before executor filtering and recommends by priority", () => {
    const full = buildWorkQueue(pages([
      work({ id: "WK-02", priority: "critical" }),
      work({ id: "WK-01", priority: "high", depends_on: ["WK-02"] }),
      work({ id: "WK-HUMAN", priority: "critical", executor: "human" }),
    ]));
    expect(full.groups.ready.map((item) => item.id)).toEqual(["WK-02", "WK-HUMAN"]);
    expect(full.groups.waiting.map((item) => [item.id, item.unmet_dependencies])).toEqual([["WK-01", ["WK-02"]]]);
    expect(full.recommended_next).toEqual({ kind: "work", id: "WK-02" });
    const agent = projectWorkQueue(full, "agent");
    expect(agent.groups.waiting[0]).toMatchObject({ id: "WK-01", queue_state: "waiting", unmet_dependencies: ["WK-02"] });
    expect(agent.groups.ready.map((item) => item.id)).toEqual(["WK-02"]);
  });

  test("normalizes executor defaults and keeps human-only work visible without recommending it", () => {
    const full = buildWorkQueue(pages([
      work({ id: "WK-HUMAN-ACTIVE", executor: "human", state: "active" }),
      work({ id: "WK-HUMAN-READY", executor: "human" }),
      work({ id: "WK-EITHER", executor: "either" }),
    ]));
    expect(full.groups.active.map((item) => [item.id, item.executor])).toEqual([["WK-HUMAN-ACTIVE", "human"]]);
    expect(full.groups.ready.map((item) => [item.id, item.executor])).toEqual([["WK-EITHER", "either"], ["WK-HUMAN-READY", "human"]]);
    expect(full.recommended_next).toEqual({ kind: "work", id: "WK-EITHER" });
    const humanOnly = projectWorkQueue(buildWorkQueue(pages([work({ id: "WK-HUMAN", executor: "human" })])), "agent");
    expect(humanOnly.groups.ready).toEqual([]);
    expect(humanOnly.recommended_next).toBeNull();
    expect(generateWorkQueue(pages([work({ id: "WK-HUMAN", executor: "human" })]))).toContain("no agent-recommendable work is available");
    expect(generateCurrentStatus(pages([work({ id: "WK-HUMAN", executor: "human" })]))).toContain("human-only work remains");
  });

  test("keeps queue JSON and generated work bytes deterministic", () => {
    const input = pages([
      work({ id: "WK-02", priority: "high" }),
      work({ id: "WK-01", priority: "high" }),
      work({ id: "WK-DONE", state: "done", evidence: ["src/main.ts"] }),
    ]);
    const queue = buildWorkQueue(input);
    expect(queue.groups.ready.map((item) => item.id)).toEqual(["WK-01", "WK-02"]);
    expect(JSON.parse(jsonStable(queue)).groups.ready.every((item: { executor?: string }) => item.executor != null)).toBe(true);
    expect(generateWorkQueue(input)).toBe(generateWorkQueue(input));
    expect(generateWorkQueue(input)).not.toContain("| WK-DONE |");
  });
});
