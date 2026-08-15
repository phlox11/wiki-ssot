import { describe, expect, test } from "bun:test";
import { aggregateFindings, allLintFindings, buildRepositoryValidation, type LoadedWikiPages } from "./core";
import type { WikiPage } from "./model";
import type { RepoView } from "./repository-view";

function page(): WikiPage {
  return {
    path: "wiki/product/test.md",
    raw: "---\nid: product/test\nsummary: Test\nkind: product\nstatus: current\nauthority: observed\nowners: [\"@owner\"]\nsources:\n  - path: src/test.ts\n---\n\n# Test\n",
    body: "\n# Test\n",
    data: {
      id: "product/test",
      summary: "Test",
      kind: "product",
      status: "current",
      authority: "observed",
      owners: ["@owner"],
      sources: [{ path: "src/test.ts" }],
    },
  };
}

function view(): RepoView {
  const files: Record<string, string> = {
    ".wiki/config.json": JSON.stringify({ version: 1, name: "fixture", highRisk: [], publishesKit: false }),
    "src/test.ts": "export const value = 1;\n",
  };
  return {
    root: "/memory",
    mode: "working",
    listFiles: () => Object.keys(files).sort(),
    exists: (path) => path in files,
    read: (path) => files[path] ?? "",
  };
}

describe("repository validation aggregate", () => {
  test("uses injected page loading and exposes each deterministic projection", () => {
    const loaded: LoadedWikiPages = {
      pages: [page()],
      findings: [{ code: "injected-parse", message: "injected parse evidence", severity: "error" }],
    };
    const aggregate = buildRepositoryValidation(view(), {
      loaded,
      checkGenerated: false,
      checkInventory: true,
      checkState: true,
    });
    expect(aggregate.loaded).toBe(loaded);
    expect(aggregate.structural.map((item) => item.code)).toContain("injected-parse");
    expect(aggregate.integration).toEqual(expect.any(Array));
    expect(aggregate.coreGenerated).toEqual([]);
    expect(aggregate.inventoryGenerated).toEqual([]);
    expect(Array.isArray(aggregate.state.stalePages)).toBe(true);
    expect(Array.isArray(aggregate.state.findings)).toBe(true);
    expect(aggregateFindings(aggregate)).toEqual(expect.arrayContaining(aggregate.structural));
  });

  test("legacy lint facade can project the injected aggregate without reloading pages", () => {
    const loaded: LoadedWikiPages = { pages: [page()], findings: [] };
    const result = allLintFindings(view(), false, loaded);
    expect(result.pages).toBe(loaded.pages);
  });

  test("does not invoke the inventory adapter when inventory validation is disabled", () => {
    let calls = 0;
    const inventoryGenerator = () => {
      calls += 1;
      throw new Error("disabled inventory adapter must not run");
    };
    const disabled = buildRepositoryValidation(view(), {
      loaded: { pages: [page()], findings: [] },
      checkGenerated: false,
      checkInventory: false,
      checkState: false,
      inventoryGenerator,
    });
    expect(calls).toBe(0);
    expect(disabled.inventory).toEqual({});
    expect(disabled.inventoryGenerated).toEqual([]);

    const enabled = buildRepositoryValidation(view(), {
      loaded: { pages: [page()], findings: [] },
      checkGenerated: false,
      checkInventory: true,
      checkState: false,
      inventoryGenerator: () => {
        calls += 1;
        return { "wiki/_generated/inventory.md": "generated inventory\n" };
      },
    });
    expect(calls).toBe(1);
    expect(enabled.inventory).toEqual({ "wiki/_generated/inventory.md": "generated inventory\n" });
    expect(enabled.inventoryGenerated.map((item) => item.code)).toEqual(["generated-missing"]);
  });

  test("computes core generated output once and reuses it for comparison", () => {
    let calls = 0;
    const coreGenerator = (pages: WikiPage[], name: string) => {
      calls += 1;
      expect(pages).toHaveLength(1);
      expect(name).toBe("fixture");
      return { "wiki/_generated/core.md": "generated core\n" };
    };
    const enabled = buildRepositoryValidation(view(), {
      loaded: { pages: [page()], findings: [] },
      checkGenerated: true,
      checkInventory: false,
      checkState: false,
      extraGenerated: { "wiki/_generated/extra.md": "extra\n" },
      coreGenerator,
    });
    expect(calls).toBe(1);
    expect(enabled.generated).toEqual({
      "wiki/_generated/core.md": "generated core\n",
      "wiki/_generated/extra.md": "extra\n",
    });
    expect(enabled.coreGenerated.map((item) => item.path)).toEqual([
      "wiki/_generated/core.md",
      "wiki/_generated/extra.md",
    ]);

    calls = 0;
    const disabled = buildRepositoryValidation(view(), {
      loaded: { pages: [page()], findings: [] },
      checkGenerated: false,
      checkInventory: false,
      checkState: false,
      coreGenerator,
    });
    expect(calls).toBe(1);
    expect(disabled.coreGenerated).toEqual([]);
    expect(disabled.generated).toEqual({ "wiki/_generated/core.md": "generated core\n" });
  });
});
