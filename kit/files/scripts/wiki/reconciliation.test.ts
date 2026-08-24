import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildReconciliationPlan, reconciliationText } from "./reconciliation";
import type { WikiPage } from "./model";
import { parseWikiPage } from "./page-validation";
import type { RepoView } from "./repository-view";
import { hashContent, jsonStable } from "./serialization";
import { KIT_ENTRIES } from "./kit-packaging";
import { KIT_CONTRACT_AREAS } from "./kit-growth-guard";
import { MANAGED_AGENT_RULES, renderManagedAgentBlock } from "./agent-rules";
import { runCli } from "./cli";
import { CLI_COMMANDS, type CliIo } from "./cli-runtime";

function memoryView(files: Record<string, string>): RepoView {
  const paths = Object.keys(files).sort();
  return {
    root: "/memory",
    mode: "working",
    listFiles: () => [...paths],
    exists: (path) => Object.prototype.hasOwnProperty.call(files, path),
    read: (path) => {
      if (!(path in files)) throw new Error(`missing ${path}`);
      return files[path];
    },
  };
}

function currentPage(id: string, path: string, source: string, authority = "normative"): WikiPage {
  return parseWikiPage(path, [
    "---",
    `id: ${id}`,
    `summary: ${id} contract`,
    "kind: architecture",
    "status: current",
    `authority: ${authority}`,
    "owners: [\"@owner\"]",
    `sources: [{path: ${JSON.stringify(source)}}]`,
    "---",
    "",
    `# ${id}`,
    "",
  ].join("\n"));
}

function conflictPage(): WikiPage {
  return parseWikiPage("wiki/conflicts/open/C-900.md", [
    "---",
    "id: conflict/C-900",
    "summary: Open implementation conflict",
    "kind: conflict",
    "status: conflicted",
    "authority: observed",
    "owners: [\"@owner\"]",
    "conflict_id: C-900",
    "conflict_type: implementation",
    "severity: high",
    "origin: baseline",
    "opened_at: 2026-08-24",
    "affected_pages: [product/stale]",
    "affected_invariants: []",
    "sources: [{path: source-stale.ts}]",
    "resolution:",
    "  state: open",
    "  acceptance: [\"Owner decides the observable contract and records evidence.\"]",
    "---",
    "",
    "# Conflict",
    "",
  ].join("\n"));
}

describe("repository-wide reconciliation planning", () => {
  test("dispatches the last public command in JSON without writing", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io: CliIo = { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) };
    const stateBefore = readFileSync(".wiki/state.json", "utf8");
    expect(CLI_COMMANDS.at(-1)).toBe("reconcile");
    expect(runCli(["reconcile", "--json"], { cwd: process.cwd(), io })).toBe(0);
    const output = JSON.parse(stdout.join("")) as { kind: string; pages: unknown[]; semanticScope: string };
    expect(output.kind).toBe("wiki-reconciliation-plan");
    expect(output.pages.length).toBeGreaterThan(0);
    expect(output.semanticScope).toBe("semantic_reconciliation_required");
    expect(stderr).toEqual([]);
    expect(readFileSync(".wiki/state.json", "utf8")).toBe(stateBefore);
  });

  test("includes every current page, classifies ledger state, changed sources, and conflicts", () => {
    const files = {
      "source-current.ts": "export const current = 1;\n",
      "source-stale.ts": "export const stale = 2;\n",
      ".wiki/state.json": jsonStable({
        version: 1,
        pages: {
          "product/current": { sources: { "source-current.ts": hashContent("export const current = 1;\n") }, verification: { kind: "updated" } },
          "product/stale": { sources: { "source-stale.ts": "old" }, verification: { kind: "updated" } },
        },
      }),
    };
    const pages = [
      currentPage("product/stale", "wiki/product/stale.md", "source-stale.ts", "observed"),
      currentPage("product/current", "wiki/product/current.md", "source-current.ts"),
      conflictPage(),
    ];
    const plan = buildReconciliationPlan(memoryView(files), pages);
    expect(plan.pages.map((page) => page.id)).toEqual(["product/current", "product/stale"]);
    expect(plan.pages.map((page) => page.ledger)).toEqual(["current", "stale"]);
    expect(plan.pages[1].changedSourcePaths).toEqual(["source-stale.ts"]);
    expect(plan.pages[1].relevantOpenConflictIds).toEqual(["C-900"]);
    expect(plan.pages.every((page) => page.semanticScope === "semantic_reconciliation_required")).toBe(true);
    expect(plan.pages[0].fullContextCommand).toBe("bun run wiki:context -- --page product/current --full");
    expect(plan.pages[0].updatedVerifyCommand).toBe("bun run wiki:verify -- --page product/current");
    expect(plan.pages[0].unchangedVerifyCommand).toContain("--unchanged");
  });

  test("keeps current ledger pages in semantic scope and produces stable JSON/text digest", () => {
    const source = "export const value = true;\n";
    const page = currentPage("product/current", "wiki/product/current.md", "source.ts");
    const files = {
      "source.ts": source,
      ".wiki/state.json": jsonStable({ version: 1, pages: { "product/current": { sources: { "source.ts": hashContent(source) }, verification: { kind: "updated" } } } }),
    };
    const first = buildReconciliationPlan(memoryView(files), [page]);
    const second = buildReconciliationPlan(memoryView(files), [page]);
    expect(first.status).toBe("needs-reconcile"); // repository seams are absent in this minimal view
    expect(first.pages[0].ledger).toBe("current");
    expect(first.planDigest).toBe(second.planDigest);
    expect(jsonStable(first)).toBe(jsonStable(second));
    expect(reconciliationText(first)).toBe(reconciliationText(second));
    expect(reconciliationText(first)).toContain("semantic_reconciliation_required");
  });

  test("returns a deterministic blocked plan for malformed page input without writing", () => {
    const files = { ".wiki/state.json": "{\"version\":1,\"pages\":{}}\n" };
    const view = memoryView(files);
    const before = files[".wiki/state.json"];
    const malformed = [{ code: "frontmatter-parse", message: "missing YAML frontmatter", path: "wiki/bad.md", severity: "error" as const }];
    const first = buildReconciliationPlan(view, [], malformed);
    const second = buildReconciliationPlan(view, [], malformed);
    expect(first.status).toBe("blocked");
    expect(first.findings.structural).toEqual(expect.arrayContaining([expect.objectContaining({ code: "frontmatter-parse" })]));
    expect(first.planDigest).toBe(second.planDigest);
    expect(first.pages).toEqual([]);
    // The planner has no write API; the in-memory view remains unchanged.
    expect(view.read(".wiki/state.json")).toBe(files[".wiki/state.json"]);
    expect(before).toBe(files[".wiki/state.json"]);
  });

  test("ships the command, portable modules, and the typed broad-reconcile rule", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["wiki:reconcile"]).toBe("bun scripts/wiki/cli.ts reconcile");
    expect(KIT_ENTRIES.some((entry) => entry.target === "scripts/wiki/reconciliation.ts" && entry.placement === "files")).toBe(true);
    expect(KIT_ENTRIES.some((entry) => entry.target === "scripts/wiki/cli-reconciliation-handler.ts" && entry.placement === "files")).toBe(true);
    expect(KIT_ENTRIES.some((entry) => entry.target === "scripts/wiki/reconciliation.test.ts" && entry.placement === "files")).toBe(true);
    expect(KIT_CONTRACT_AREAS["scripts/wiki/reconciliation.ts"]).toBe("production");
    expect(KIT_CONTRACT_AREAS["scripts/wiki/reconciliation.test.ts"]).toBe("regression");
    const rendered = renderManagedAgentBlock();
    expect(MANAGED_AGENT_RULES.length).toBe(9);
    expect(rendered).toContain("bun run wiki:reconcile");
    expect(rendered).toContain("Never mass-verify before semantic reconciliation");
  });
});
