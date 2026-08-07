import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  cleanupTemporary,
  temporary,
  jsonStable,
  run,
  runResult,
  metadataBody,
  put,
  tempRepo,
  currentPage,
  proposalPage,
  conflictPage,
  resolvedConflictPage,
  work,
  cliRepo,
  topicCliRepo,
  type WorkItem,
} from "./test-fixtures/work";

afterEach(cleanupTemporary);

describe("generic topic context", () => {
  test("makes generic topic context authority-, source-, and conflict-complete", () => {
    const root = topicCliRepo();
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const search = JSON.parse(run(root, [process.execPath, cli, "search", "shared topic", "--json"]));
    expect(search.matches.map((match: { id: string }) => match.id)).toEqual([
      "conflict/C-900",
      "product/archived-topic",
      "product/deprecated-topic",
      "product/test",
      "proposal/topic",
    ]);

    const first = run(root, [process.execPath, cli, "context", "shared topic", "--full", "--json"]);
    expect(run(root, [process.execPath, cli, "context", "shared topic", "--full", "--json"])).toBe(first);
    const context = JSON.parse(first);
    expect(context).toMatchObject({
      version: 1,
      query: "shared topic",
      requestedConflict: null,
      requestedWork: null,
    });
    expect(context.pages.map((page: { id: string }) => page.id)).toEqual([
      "product/invariant",
      "product/test",
    ]);
    expect(context.conflicts.map((conflict: { id: string }) => conflict.id)).toEqual(["C-900"]);
    expect(context.nonCurrentPages.map((page: { id: string; status: string }) => [page.id, page.status])).toEqual([
      ["product/archived-topic", "archived"],
      ["product/deprecated-topic", "deprecated"],
      ["proposal/topic", "proposed"],
    ]);
    expect(context.pages[0]).toMatchObject({
      id: "product/invariant",
      status: "current",
      authority: "normative",
      path: "wiki/product/invariant.md",
      exactSources: [{ path: "source.ts" }],
      sourceGlobs: [],
      sourceFiles: ["source.ts"],
      relevantOpenConflicts: ["C-900"],
    });
    expect(context.pages[1]).toMatchObject({
      id: "product/test",
      status: "current",
      authority: "normative",
      path: "wiki/product/test.md",
      exactSources: [{ path: "source.ts" }],
      sourceGlobs: [{ glob: "src/*.ts", matchedFiles: ["src/a.ts", "src/z.ts"] }],
      sourceFiles: ["source.ts", "src/a.ts", "src/z.ts"],
      relevantOpenConflicts: ["C-900"],
    });
    expect(context.conflicts[0]).toMatchObject({
      pageId: "conflict/C-900",
      status: "conflicted",
      authority: "observed",
      path: "wiki/conflicts/open/C-900.md",
      exactSources: [{ path: "source.ts" }],
      sourceFiles: ["source.ts"],
      relevantOpenConflicts: ["C-900"],
    });
    for (const page of context.nonCurrentPages) {
      expect(page).toMatchObject({
        authority: "normative",
        exactSources: [{ path: "source.ts" }],
        sourceGlobs: [],
        sourceFiles: ["source.ts"],
        relevantOpenConflicts: [],
      });
    }
    expect(context.readOrder).toEqual([
      { kind: "invariant", id: "product/invariant", path: "wiki/product/invariant.md" },
      { kind: "conflict", id: "C-900", path: "wiki/conflicts/open/C-900.md" },
      { kind: "page", id: "product/test", path: "wiki/product/test.md" },
      { kind: "source", path: "source.ts", declaredBy: ["C-900", "product/invariant", "product/test"] },
      { kind: "source", path: "src/a.ts", declaredBy: ["product/test"] },
      { kind: "source", path: "src/z.ts", declaredBy: ["product/test"] },
    ]);
    expect(context.sources.map((source: { pageId: string }) => source.pageId)).toEqual([
      "product/invariant",
      "product/test",
      "conflict/C-900",
      "product/archived-topic",
      "product/deprecated-topic",
      "proposal/topic",
    ]);

    const text = run(root, [process.execPath, cli, "context", "shared topic", "--full"]);
    expect(text).toContain("# TOPIC CONTEXT\n\nQuery: shared topic");
    expect(text).toContain("# CURRENT INVARIANT product/invariant");
    expect(text).toContain("# OPEN CONFLICT C-900 [high, decision, decision_pending]");
    expect(text).toContain("# CURRENT PAGE product/test");
    expect(text).toContain("# NON-CURRENT RATIONALE [ARCHIVED] product/archived-topic");
    expect(text).toContain("# NON-CURRENT RATIONALE [DEPRECATED] product/deprecated-topic");
    expect(text).toContain("# NON-CURRENT RATIONALE [PROPOSED] proposal/topic");
    expect(text).toContain("Source globs and deterministic matches:\n- src/*.ts\n  - src/a.ts\n  - src/z.ts");
    expect(text).toContain("Relevant open conflicts:\n- C-900");
    expect(text.indexOf("# CURRENT INVARIANT")).toBeLessThan(text.indexOf("# OPEN CONFLICT"));
    expect(text.indexOf("# OPEN CONFLICT")).toBeLessThan(text.indexOf("# CURRENT PAGE"));
    expect(text.indexOf("# CURRENT PAGE")).toBeLessThan(text.indexOf("# SOURCE READ ORDER"));
    expect(text.indexOf("# SOURCE READ ORDER")).toBeLessThan(text.indexOf("# NON-CURRENT RATIONALE"));
  });

  test("returns compact topic metadata and focused commands for partial fallback", () => {
    const root = cliRepo([work()], false);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const compact = JSON.parse(run(root, [process.execPath, cli, "context", "test work", "--json"]));
    const full = JSON.parse(run(root, [process.execPath, cli, "context", "test work", "--full", "--json"]));
    expect(compact.mode).toBe("compact");
    expect(compact.matchMode).toBe("partial");
    expect(compact.candidates.map((candidate: { id: string; order: number; score: number }) => [candidate.id, candidate.order, candidate.score])).toEqual([
      ["product/test", 1, 1],
      ["proposal/work", 2, 1],
    ]);
    expect(compact.pages).toEqual([]);
    expect(compact.conflicts).toEqual([]);
    expect(compact.nonCurrentPages).toEqual([]);
    expect(compact.readOrder).toEqual([]);
    for (const candidate of compact.candidates) {
      expect(candidate.body).toBeUndefined();
      expect(candidate.bodyDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(candidate.focusedCommand).toContain(`--page ${candidate.id} --full`);
    }
    expect(full.nonCurrentPages[0].body).toContain("Detailed rationale stays");
    const text = run(root, [process.execPath, cli, "context", "test work"]);
    expect(text).toContain("# PARTIAL-MATCH CANDIDATES");
    expect(text).toContain("Focused context: bun run wiki:context -- --page product/test --full");
    expect(text.indexOf("# PARTIAL-MATCH CANDIDATES")).toBeGreaterThan(text.indexOf("# TOPIC CONTEXT"));
    expect(text).not.toContain("# AUTHORITATIVE READ ORDER");
    expect(text).not.toContain("# SOURCE READ ORDER");
    expect(text).not.toContain("Expanded source files:");
    expect(text).not.toContain("Detailed rationale stays");
    expect(run(root, [process.execPath, cli, "context", "test work", "--full"])).toContain("Detailed rationale stays");
  });

  test("renders candidate owners and relevant open conflicts in compact text", () => {
    const root = cliRepo([work()], true);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const compact = JSON.parse(run(root, [process.execPath, cli, "context", "test work", "--json"]));
    const current = compact.candidates.find((candidate: { id: string }) => candidate.id === "product/test");
    const nonCurrent = compact.candidates.find((candidate: { id: string }) => candidate.id === "proposal/work");
    expect(current).toMatchObject({ owners: ["@owner"], relevantOpenConflicts: ["C-900"] });
    expect(nonCurrent).toMatchObject({ owners: ["@owner"], relevantOpenConflicts: [] });

    const text = run(root, [process.execPath, cli, "context", "test work"]);
    expect(text).toContain(`Owners: ${current.owners.join(", ")}`);
    expect(text).toContain(`Relevant open conflicts: ${current.relevantOpenConflicts.join(", ")}`);
    expect(text).toContain(`Owners: ${nonCurrent.owners.join(", ")}`);
    expect(text).toContain("Relevant open conflicts: none");
  });

  test("follows a resolved conflict candidate only through an --all focused command", () => {
    const root = cliRepo([work()], false);
    put(root, "wiki/conflicts/resolved/C-901.md", resolvedConflictPage());
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "resolved conflict"]);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");

    const compact = JSON.parse(run(root, [process.execPath, cli, "context", "resolved mystery", "--json"]));
    expect(compact.matchMode).toBe("partial");
    const candidate = compact.candidates.find((item: { id: string }) => item.id === "conflict/C-901");
    expect(candidate).toMatchObject({
      status: "archived",
      authority: "observed",
      owners: ["@owner"],
      relevantOpenConflicts: [],
      focusedCommand: "bun run wiki:context -- --all --conflict C-901 --full",
    });

    const withoutAll = runResult(root, [process.execPath, cli, "context", "--conflict", "C-901", "--full", "--json"]);
    expect(withoutAll.exitCode).toBe(2);
    expect(withoutAll.stderr).toContain("unknown open conflict: C-901");

    const resolved = JSON.parse(run(root, [process.execPath, cli, "context", "--all", "--conflict", "C-901", "--full", "--json"]));
    expect(resolved.conflicts).toHaveLength(1);
    expect(resolved.conflicts[0]).toMatchObject({
      id: "C-901",
      pageId: "conflict/C-901",
      path: "wiki/conflicts/resolved/C-901.md",
      kind: "conflict",
      status: "archived",
      authority: "observed",
      state: "verified",
      acceptance: ["Record the owner decision."],
      sources: [{ path: "source.ts" }],
      resolution: {
        state: "verified",
        decision: "Owner selected the documented implementation.",
        acceptance: ["Record the owner decision."],
        evidence: ["source.ts"],
      },
      body: expect.stringContaining("# Decision"),
    });

    const text = run(root, [process.execPath, cli, "context", "--all", "--conflict", "C-901", "--full"]);
    expect(text).toContain("# RESOLVED CONFLICT C-901 [archived, high, decision, verified]");
    expect(text).toContain("Status: archived");
    expect(text).toContain("Authority: observed");
    expect(text).toContain("Lifecycle: resolved (non-current)");
    expect(text).toContain("Source file: wiki/conflicts/resolved/C-901.md");
    expect(text).toContain("Sources:\n- path: source.ts");
    expect(text).toContain("Acceptance:\n- Record the owner decision.");
    expect(text).toContain("Decision: Owner selected the documented implementation.");
    expect(text).toContain("# Decision");
  });

  test("follows a candidate page command into exact full context and rejects invalid page selectors", () => {
    const root = cliRepo([work()], true);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const compact = JSON.parse(run(root, [process.execPath, cli, "context", "test work", "--json"]));
    const currentCandidate = compact.candidates.find((candidate: { id: string }) => candidate.id === "product/test");
    expect(currentCandidate.focusedCommand).toBe("bun run wiki:context -- --page product/test --full");
    expect(currentCandidate.relevantOpenConflicts).toEqual(["C-900"]);

    const current = JSON.parse(run(root, [process.execPath, cli, "context", "--page", "product/test", "--full", "--json"]));
    expect(current.pages.map((page: { id: string }) => page.id)).toEqual(["product/invariant", "product/test"]);
    expect(current.conflicts.map((conflict: { id: string }) => conflict.id)).toEqual(["C-900"]);
    expect(current.pages.find((page: { id: string }) => page.id === "product/test").body).toContain("Current contract body.");
    expect(current.readOrder).toEqual([
      { kind: "invariant", id: "product/invariant", path: "wiki/product/invariant.md" },
      { kind: "conflict", id: "C-900", path: "wiki/conflicts/open/C-900.md" },
      { kind: "page", id: "product/test", path: "wiki/product/test.md" },
      { kind: "source", path: "source.ts", declaredBy: ["C-900", "product/invariant", "product/test"] },
      { kind: "source", path: "src/a.ts", declaredBy: ["product/test"] },
      { kind: "source", path: "src/z.ts", declaredBy: ["product/test"] },
    ]);

    const nonCurrent = JSON.parse(run(root, [process.execPath, cli, "context", "--page", "proposal/work", "--full", "--json"]));
    expect(nonCurrent.nonCurrentPages[0].id).toBe("proposal/work");
    expect(nonCurrent.nonCurrentPages[0].body).toContain("Detailed rationale stays");
    expect(nonCurrent.pages.map((page: { id: string }) => page.id)).toEqual(["product/invariant"]);

    const unknown = runResult(root, [process.execPath, cli, "context", "--page", "missing/page", "--full"]);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toContain("unknown page");
    const conflict = runResult(root, [process.execPath, cli, "context", "--page", "conflict/C-900", "--full"]);
    expect(conflict.exitCode).toBe(2);
    expect(conflict.stderr).toContain("conflict pages require --conflict C-900");
  });

  test("keeps PV-07 partial-fallback matching unchanged in generic context", () => {
    const root = cliRepo([work()], false);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const search = JSON.parse(run(root, [process.execPath, cli, "search", "test work", "--json"]));
    expect(search.matches.map((match: { id: string; score: number }) => [match.id, match.score])).toEqual([
      ["product/test", 1],
      ["proposal/work", 1],
    ]);
    const context = JSON.parse(run(root, [process.execPath, cli, "context", "test work", "--full", "--json"]));
    expect(context.pages.map((page: { id: string }) => page.id)).toEqual(["product/test"]);
    expect(context.conflicts).toEqual([]);
    expect(context.nonCurrentPages.map((page: { id: string; status: string }) => [page.id, page.status])).toEqual([
      ["proposal/work", "proposed"],
    ]);
  });

  test("keeps impact-based context byte-stable", () => {
    const root = cliRepo([work({ id: "WK-01" })], false);
    put(root, "source.ts", "export const value = false;\n");
    run(root, ["git", "add", "source.ts"]);
    run(root, ["git", "commit", "-qm", "change source"]);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const first = run(root, [process.execPath, cli, "context", "--base", "HEAD~1", "--json"]);
    const second = run(root, [process.execPath, cli, "context", "--base", "HEAD~1", "--json"]);
    expect(second).toBe(first);
    expect(JSON.parse(first).pages.map((page: { id: string }) => page.id)).toEqual(["product/invariant", "product/test"]);
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
    const help = run(root, [process.execPath, cli, "context", "--help"]);
    expect(help).toContain("--page <ID>");
    expect(help).toContain("--full");
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

