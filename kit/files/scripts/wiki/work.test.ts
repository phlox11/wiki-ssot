import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildWorkQueue,
  compareGenerated,
  generateWorkQueue,
  jsonStable,
  loadWikiPages,
  parseWikiPage,
  validateWorkItems,
  type RepoView,
  type WikiPage,
  type WorkItem,
} from "./core";

const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function run(root: string, command: string[]) {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || result.stdout.toString());
  return result.stdout.toString();
}

function put(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-work-test-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Work Test"]);
  run(root, ["git", "config", "user.email", "wiki-work@example.invalid"]);
  return root;
}

function memoryView(files: Record<string, string>): RepoView {
  const paths = Object.keys(files).sort();
  return { root: "/memory", mode: "working", listFiles: () => paths, exists: (path) => path in files, read: (path) => files[path] };
}

function currentPage(id: string, kind = "product"): string {
  return `---
id: ${id}
summary: Current ${id}.
kind: ${kind}
status: current
authority: normative
owners: ["@owner"]
sources: [{path: source.ts}]
---

# ${id}

Current contract body.
`;
}

function proposalPage(items: WorkItem[], id = "proposal/work"): string {
  return `---
id: ${id}
summary: Work proposal.
kind: proposal
status: proposed
authority: normative
owners: ["@owner"]
sources: [{path: source.ts}]
work_items: ${JSON.stringify(items)}
---

# Work proposal

Detailed rationale stays with the owning proposal.
`;
}

function conflictPage(): string {
  return `---
id: conflict/C-900
conflict_id: C-900
summary: Owner decision is required.
kind: conflict
status: conflicted
authority: observed
owners: ["@owner"]
conflict_type: decision
severity: high
origin: baseline
opened_at: 2026-07-29
sources: [{path: source.ts}]
affected_pages: [product/test]
affected_invariants: [product/invariant]
resolution:
  state: decision_pending
  decision: null
  acceptance: ["Record the owner decision."]
---

# Decision
`;
}

function work(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "WK-01",
    title: "First task",
    state: "not-started",
    priority: "high",
    depends_on: [],
    context_pages: ["product/test"],
    acceptance: ["The task has deterministic evidence."],
    evidence: [],
    ...overrides,
  };
}

function pagesFor(items: WorkItem[], extras: Record<string, string> = {}): WikiPage[] {
  const files = {
    "source.ts": "export const value = true;\n",
    "wiki/product/test.md": currentPage("product/test"),
    "wiki/product/invariant.md": currentPage("product/invariant", "invariant"),
    "wiki/proposals/work.md": proposalPage(items),
    ...extras,
  };
  return loadWikiPages(memoryView(files)).pages;
}

describe("work item schema and queue", () => {
  test("derives ready and waiting states and recommends by priority then ID", () => {
    const pages = pagesFor([
      work({ id: "WK-00", title: "Completed prerequisite", state: "done", priority: "critical", evidence: ["source.ts"] }),
      work({ id: "WK-03", title: "Lower ready", priority: "normal", depends_on: ["WK-00"] }),
      work({ id: "WK-02", title: "Highest ready", priority: "critical", depends_on: ["WK-00"] }),
      work({ id: "WK-04", title: "Waiting", priority: "critical", depends_on: ["WK-03"] }),
    ]);
    expect(validateWorkItems(pages)).toEqual([]);
    const queue = buildWorkQueue(pages);
    expect(queue.recommended_next).toEqual({ kind: "work", id: "WK-02" });
    expect(queue.groups.ready.map((item) => item.id)).toEqual(["WK-02", "WK-03"]);
    expect(queue.groups.waiting.map((item) => [item.id, item.unmet_dependencies])).toEqual([["WK-04", ["WK-03"]]]);
    expect(queue.groups.done.map((item) => item.id)).toEqual(["WK-00"]);
  });

  test("finishes active work before recommending another ready item", () => {
    const pages = pagesFor([
      work({ id: "WK-01", priority: "critical" }),
      work({ id: "WK-02", state: "active", priority: "low" }),
    ]);
    expect(buildWorkQueue(pages).recommended_next).toEqual({ kind: "work", id: "WK-02" });
  });

  test("rejects duplicate, unknown, self, cyclic, and illegal lifecycle records", () => {
    const invalid = [
      work({ id: "WK-DONE", state: "done", evidence: [] }),
      work({ id: "WK-BLOCKED", state: "blocked", blocker: undefined }),
      work({ id: "WK-DEFERRED", state: "deferred", deferred_reason: undefined }),
      work({ id: "WK-WRONG-BLOCKER", blocker: "Stale blocker text." }),
      work({ id: "WK-WRONG-DEFERRED", deferred_reason: "Stale deferred text." }),
      work({ id: "WK-UNKNOWN", depends_on: ["WK-MISSING"] }),
      work({ id: "WK-SELF", depends_on: ["WK-SELF"] }),
      work({ id: "WK-CYCLE-A", depends_on: ["WK-CYCLE-B"] }),
      work({ id: "WK-CYCLE-B", depends_on: ["WK-CYCLE-A"] }),
      work({ id: "WK-PENDING" }),
      work({ id: "WK-ACTIVE", state: "active", depends_on: ["WK-PENDING"] }),
      work({ id: "WK-DONE-WAITING", state: "done", depends_on: ["WK-PENDING"], evidence: ["source.ts"] }),
      work({ id: "WK-CONTEXT", context_pages: ["proposal/work"] }),
    ];
    const pages = pagesFor(invalid, {
      "wiki/proposals/duplicate.md": proposalPage([work({ id: "WK-UNKNOWN", title: "Duplicate" })], "proposal/duplicate"),
    });
    const codes = validateWorkItems(pages).map((item) => item.code);
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
    const missingAcceptance = work({ id: "WK-MISSING-FIELD" }) as unknown as Record<string, unknown>;
    delete missingAcceptance.acceptance;
    const malformed = [
      { ...work({ id: "WK-BAD-STATE" }), state: "ready" },
      { ...work({ id: "WK-BAD-PRIORITY" }), priority: "urgent" },
      { ...work({ id: "WK-BLANK-ACCEPTANCE" }), acceptance: ["   "] },
      { ...work({ id: " WK-SPACED-ID" }) },
      missingAcceptance,
    ] as unknown as WorkItem[];
    const pages = pagesFor(malformed, {
      "wiki/proposals/archived.md": proposalPage([work({ id: "WK-ARCHIVED-LIVE" })], "proposal/archived")
        .replace("status: proposed", "status: archived"),
    });
    const codes = validateWorkItems(pages).map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining([
      "work-state",
      "work-priority",
      "work-acceptance",
      "work-id",
      "work-owner-status",
    ]));
  });

  test("generates a byte-stable human queue without completed rows", () => {
    const pages = pagesFor([
      work({ id: "WK-00", state: "done", evidence: ["source.ts"] }),
      work({ id: "WK-01", state: "blocked", blocker: "Owner must choose a policy." }),
      work({ id: "WK-02", state: "deferred", deferred_reason: "Wait for measured evidence." }),
    ]);
    const first = generateWorkQueue(pages);
    expect(first).toBe(generateWorkQueue(pages));
    expect(first).toContain("Repository work queue");
    expect(first).toContain("WK-01");
    expect(first).not.toContain("| WK-00 |");
  });

  test("orders equal-priority work by ID and detects a manually edited generated queue", () => {
    const pages = pagesFor([
      work({ id: "WK-02", priority: "high" }),
      work({ id: "WK-01", priority: "high" }),
    ]);
    const queue = buildWorkQueue(pages);
    expect(queue.recommended_next).toEqual({ kind: "work", id: "WK-01" });
    expect(queue.groups.ready.map((item) => item.id)).toEqual(["WK-01", "WK-02"]);
    const expected = { "wiki/work-queue.md": generateWorkQueue(pages) };
    const files = {
      "wiki/work-queue.md": `${expected["wiki/work-queue.md"]}manual edit\n`,
    };
    expect(compareGenerated(memoryView(files), expected)).toEqual([
      expect.objectContaining({ code: "generated-stale", path: "wiki/work-queue.md" }),
    ]);
  });
});

describe("work CLI and selected context", () => {
  function cliRepo(items: WorkItem[], includeConflict = true): string {
    const root = tempRepo();
    put(root, "source.ts", "export const value = true;\n");
    put(root, "wiki/product/test.md", currentPage("product/test"));
    put(root, "wiki/product/invariant.md", currentPage("product/invariant", "invariant"));
    put(root, "wiki/proposals/work.md", proposalPage(items));
    if (includeConflict) put(root, "wiki/conflicts/open/C-900.md", conflictPage());
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "fixture"]);
    return root;
  }

  test("lists repository work without a query and hides done unless --all is used", () => {
    const root = cliRepo([
      work({ id: "WK-00", state: "done", priority: "critical", evidence: ["source.ts"] }),
      work({ id: "WK-01", depends_on: ["WK-00"], priority: "critical" }),
    ]);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const result = JSON.parse(run(root, [process.execPath, cli, "work", "--json"]));
    expect(result.recommended_next).toEqual({ kind: "work", id: "WK-01" });
    expect(result.groups.ready[0].context_command).toBe("bun run wiki:context -- --work WK-01");
    expect(result.groups.done).toBeUndefined();
    expect(result.open_conflicts[0].id).toBe("C-900");
    const text = run(root, [process.execPath, cli, "work"]);
    expect(text).toContain(`Recommended next: ${result.recommended_next.id}`);
    expect(text).toContain("READY (1)");
    expect(text).toContain(`${result.groups.ready[0].id} [${result.groups.ready[0].queue_state}, ${result.groups.ready[0].priority}]`);
    expect(text).toContain(`OPEN DECISION CONFLICTS (${result.open_conflicts.length})`);
    const all = JSON.parse(run(root, [process.execPath, cli, "work", "--all", "--json"]));
    expect(all.groups.done[0].id).toBe("WK-00");
  });

  test("assembles authoritative current context and labels the proposal non-current", () => {
    const root = cliRepo([work({ id: "WK-01", context_pages: ["product/test"] })]);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const json = JSON.parse(run(root, [process.execPath, cli, "context", "--work", "WK-01", "--json"]));
    expect(json.requestedWork).toBe("WK-01");
    expect(json.pages.map((page: { id: string }) => page.id)).toEqual(["product/invariant", "product/test"]);
    expect(json.ownerPage).toMatchObject({ id: "proposal/work", status: "proposed", authority: "normative" });
    expect(json.conflicts[0].id).toBe("C-900");
    expect(json.sources.find((item: { pageId: string }) => item.pageId === "proposal/work").declared).toEqual([{ path: "source.ts" }]);
    const text = run(root, [process.execPath, cli, "context", "--work", "WK-01"]);
    expect(text).toContain("# CURRENT INVARIANT product/invariant");
    expect(text).toContain("# CURRENT PAGE product/test");
    expect(text).toContain("# NON-CURRENT WORK OWNER proposal/work");
    expect(text).toContain("Declared sources:");
    expect(text).not.toContain("# CURRENT PAGE proposal/work");
  });

  test("returns a valid empty queue and a conflict-only queue", () => {
    const empty = tempRepo();
    run(empty, ["git", "commit", "--allow-empty", "-qm", "empty"]);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    expect(run(empty, [process.execPath, cli, "work"]).trim()).toBe("No remaining work.");

    const conflictOnly = tempRepo();
    put(conflictOnly, "source.ts", "export const value = true;\n");
    put(conflictOnly, "wiki/product/test.md", currentPage("product/test"));
    put(conflictOnly, "wiki/product/invariant.md", currentPage("product/invariant", "invariant"));
    put(conflictOnly, "wiki/conflicts/open/C-900.md", conflictPage());
    run(conflictOnly, ["git", "add", "."]);
    run(conflictOnly, ["git", "commit", "-qm", "conflict"]);
    const result = JSON.parse(run(conflictOnly, [process.execPath, cli, "work", "--json"]));
    expect(result.recommended_next).toBeNull();
    expect(result.open_conflicts[0].id).toBe("C-900");
  });

  test("rejects unknown work IDs and mixed context selectors as usage errors", () => {
    const root = cliRepo([work({ id: "WK-01" })], false);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const unknown = Bun.spawnSync([process.execPath, cli, "context", "--work", "WK-MISSING"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr.toString()).toContain("unknown work item");
    const mixed = Bun.spawnSync([process.execPath, cli, "context", "--work", "WK-01", "--base", "HEAD"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(mixed.exitCode).toBe(2);
    expect(mixed.stderr.toString()).toContain("cannot be combined");
  });

  test("keeps generic fresh-session prompts free of internal identifiers", () => {
    const prompts = ["What work remains?", "What is unfinished?", "What should we do next?", "할 일 남은 거 뭐야?"];
    expect(prompts.every((prompt) => !/PV-\d|proposal\/|wiki:/.test(prompt))).toBe(true);
    const agents = readFileSync(join(process.cwd(), "AGENTS.md"), "utf8");
    expect(agents).toContain("wiki-ssot:work-discovery");
    expect(agents).toContain("run `bun run wiki:work`");
    expect(agents).toContain("할 일 남은 거 뭐야?");
    expect(agents).toContain("Do not require a proposal ID, work ID, or search term.");
  });
});

test("stable JSON preserves the public queue shape", () => {
  const queue = buildWorkQueue(pagesFor([work()]));
  expect(JSON.parse(jsonStable(queue))).toMatchObject({
    version: 1,
    recommended_next: { kind: "work", id: "WK-01" },
    groups: { ready: [{ id: "WK-01", queue_state: "ready" }] },
  });
});
