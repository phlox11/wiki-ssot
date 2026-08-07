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

  test("reports lifecycle, duplicate, and graph invariants in one validation pass", () => {
    const invalid = [
      item({ id: "DONE", state: "done", evidence: [] }),
      item({ id: "BLOCKED", state: "blocked" }),
      item({ id: "DEFERRED", state: "deferred" }),
      item({ id: "STALE-BLOCKER", blocker: "stale" }),
      item({ id: "STALE-DEFERRED", deferred_reason: "stale" }),
      item({ id: "UNKNOWN", depends_on: ["MISSING"] }),
      item({ id: "SELF", depends_on: ["SELF"] }),
      item({ id: "CYCLE-A", depends_on: ["CYCLE-B"] }),
      item({ id: "CYCLE-B", depends_on: ["CYCLE-A"] }),
      item({ id: "ACTIVE", state: "active", depends_on: ["PENDING"] }),
      item({ id: "PENDING" }),
      item({ id: "BAD-CONTEXT", context_pages: ["proposal/work"] }),
    ];
    const pages = [
      ownerPage(invalid),
      {
        ...ownerPage([]),
        path: "wiki/product/context.md",
        data: { ...ownerPage([]).data, id: "product/context", kind: "product", status: "current", work_items: undefined },
      } as WikiPage,
      {
        ...ownerPage([]),
        path: "wiki/proposals/duplicate.md",
        data: { ...ownerPage([item({ id: "UNKNOWN" })]).data, id: "proposal/duplicate", work_items: [item({ id: "UNKNOWN" })] },
      } as WikiPage,
    ];
    const codes = validateWorkItems(pages).map((finding) => finding.code);
    expect(codes).toEqual(expect.arrayContaining([
      "work-done-evidence",
      "work-blocker",
      "work-deferred-reason",
      "work-blocker-state",
      "work-deferred-state",
      "work-duplicate-id",
      "work-dependency-unknown",
      "work-self-dependency",
      "work-dependency-cycle",
      "work-state-dependencies",
      "work-context-page-unknown",
    ]));
  });

  test("rejects invalid enums, missing fields, whitespace IDs, and live work on archived proposals", () => {
    const missingAcceptance = item({ id: "MISSING-FIELD" }) as unknown as Record<string, unknown>;
    delete missingAcceptance.acceptance;
    const malformed = [
      { ...item({ id: "BAD-STATE" }), state: "ready" },
      { ...item({ id: "BAD-PRIORITY" }), priority: "urgent" },
      { ...item({ id: "BLANK-ACCEPTANCE" }), acceptance: ["   "] },
      { ...item({ id: " SPACED-ID" }) },
      missingAcceptance,
    ] as unknown as WorkItem[];
    const archived = ownerPage([item({ id: "ARCHIVED-LIVE" })], "archived");
    const codes = validateWorkItems([ownerPage(malformed), archived]).map((finding) => finding.code);
    expect(codes).toEqual(expect.arrayContaining([
      "work-state",
      "work-priority",
      "work-acceptance",
      "work-id",
      "work-owner-status",
    ]));
  });
});
