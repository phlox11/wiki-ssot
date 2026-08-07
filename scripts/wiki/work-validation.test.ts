import { describe, expect, test } from "bun:test";
import { ownedWorkItems, validateWorkItems } from "./work-validation";
import type { WikiPage, WorkItem } from "./model";

function ownerPage(items: unknown[], status = "proposed"): WikiPage {
  return {
    path: "wiki/proposals/work.md",
    raw: "",
    body: "",
    data: {
      id: "proposal/work",
      summary: "Work proposal",
      kind: "proposal",
      status: status as WikiPage["data"]["status"],
      authority: "normative",
      owners: ["@owner"],
      sources: [{ path: "source.ts" }],
      work_items: items as WorkItem[],
    },
  };
}

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "WORK-1",
    title: "A bounded task",
    state: "not-started",
    priority: "normal",
    depends_on: [],
    context_pages: ["product/context"],
    acceptance: ["A deterministic criterion"],
    evidence: [],
    ...overrides,
  };
}

describe("work validation foundation", () => {
  test("normalizes omitted executor for valid queue ownership", () => {
    const owned = ownedWorkItems([ownerPage([item()])]);
    expect(owned).toHaveLength(1);
    expect(owned[0]?.item.executor).toBe("agent");
  });

  test("reports unknown dependencies, invalid context, and cycles", () => {
    const first = item({ id: "WORK-1", depends_on: ["MISSING"] });
    const second = item({ id: "WORK-2", depends_on: ["WORK-1"] });
    const pages = [ownerPage([first, second]), {
      ...ownerPage([]),
      path: "wiki/product/context.md",
      data: { ...ownerPage([]).data, id: "product/context", kind: "product", status: "current", work_items: undefined },
    } as WikiPage];
    const findings = validateWorkItems(pages);
    expect(findings.map((finding) => finding.code)).toContain("work-dependency-unknown");
    expect(validateWorkItems([ownerPage([item({ depends_on: ["WORK-2"] }), item({ id: "WORK-2", depends_on: ["WORK-1"] })]), pages[1]!]).map((finding) => finding.code)).toContain("work-dependency-cycle");
  });

  test("keeps malformed work out of the graph while reporting schema findings", () => {
    const findings = validateWorkItems([ownerPage([{ ...item(), id: "bad id", state: "active", executor: "robot" }])]);
    expect(findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(["work-id", "work-executor"]));
    expect(ownedWorkItems([ownerPage([{ ...item(), id: "bad id", executor: "robot" }])])).toEqual([]);
  });
});
