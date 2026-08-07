import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  jsonStable,
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

function runResult(root: string, command: string[]) {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function metadataBody(changeType = "feature"): string {
  return [
    "```yaml",
    `change_type: ${changeType}`,
    "semantic_change: true",
    "wiki_action: update",
    "affected_pages: [product/test]",
    "affected_invariants: [product/invariant]",
    "touched_conflicts: []",
    "fresh_context:",
    "  verdict: PENDING",
    "  reviewed_head_sha: pending",
    "  bundle_digest: pending",
    "  reviewer: pending",
    "  evidence: []",
    "```",
    "",
  ].join("\n");
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

function currentPage(id: string, kind = "product", sources = "  - path: source.ts"): string {
  return `---
id: ${id}
summary: Current ${id}.
kind: ${kind}
status: current
authority: normative
owners: ["@owner"]
sources:
${sources}
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

function resolvedConflictPage(): string {
  return conflictPage()
    .replace("id: conflict/C-900", "id: conflict/C-901")
    .replace("conflict_id: C-900", "conflict_id: C-901")
    .replace("summary: Owner decision is required.", "summary: Resolved owner decision.")
    .replace("status: conflicted", "status: archived")
    .replace("state: decision_pending", "state: verified")
    .replace("decision: null", "decision: Owner selected the documented implementation.")
    .replace('acceptance: ["Record the owner decision."]', 'acceptance: ["Record the owner decision."]\n  evidence: ["source.ts"]');
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

describe("work CLI and selected context", () => {
  function cliRepo(items: WorkItem[], includeConflict = true): string {
    const root = tempRepo();
    put(root, "source.ts", "export const value = true;\n");
    put(root, "src/a.ts", "export const a = true;\n");
    put(root, "src/z.ts", "export const z = true;\n");
    put(root, "wiki/product/test.md", currentPage("product/test", "product", "  - path: source.ts\n  - glob: src/*.ts"));
    put(root, "wiki/product/invariant.md", currentPage("product/invariant", "invariant"));
    put(root, "wiki/proposals/work.md", proposalPage(items));
    if (includeConflict) put(root, "wiki/conflicts/open/C-900.md", conflictPage());
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "fixture"]);
    return root;
  }

  function topicCliRepo(): string {
    const root = tempRepo();
    put(root, "source.ts", "export const value = true;\n");
    put(root, "src/a.ts", "export const a = true;\n");
    put(root, "src/z.ts", "export const z = true;\n");
    put(root, "wiki/product/test.md", currentPage("product/test", "product", "  - path: source.ts\n  - glob: src/*.ts")
      .replace("summary: Current product/test.", "summary: Shared topic current contract.")
      .replace("Current contract body.", "Shared topic current behavior."));
    put(root, "wiki/product/invariant.md", currentPage("product/invariant", "invariant"));
    put(root, "wiki/conflicts/open/C-900.md", conflictPage()
      .replace("summary: Owner decision is required.", "summary: Shared topic owner decision is required."));
    put(root, "wiki/proposals/topic.md", proposalPage([], "proposal/topic")
      .replace("summary: Work proposal.", "summary: Shared topic proposed rationale."));
    put(root, "wiki/product/deprecated-topic.md", currentPage("product/deprecated-topic")
      .replace("summary: Current product/deprecated-topic.", "summary: Shared topic deprecated rationale.")
      .replace("status: current", "status: deprecated"));
    put(root, "wiki/product/archived-topic.md", currentPage("product/archived-topic")
      .replace("summary: Current product/archived-topic.", "summary: Shared topic archived rationale.")
      .replace("status: current", "status: archived"));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "topic fixture"]);
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

  test("supports executor filter matrices, --all combinations, and work-specific help", () => {
    const root = cliRepo([
      work({ id: "WK-AGENT", executor: "agent", state: "done", evidence: ["source.ts"] }),
      work({ id: "WK-HUMAN-DONE", executor: "human", state: "done", evidence: ["source.ts"] }),
      work({ id: "WK-HUMAN", executor: "human" }),
      work({ id: "WK-EITHER", executor: "either" }),
    ]);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const all = JSON.parse(run(root, [process.execPath, cli, "work", "--executor", "all", "--json"]));
    expect(all.groups.ready.map((item: { id: string; executor: string }) => [item.id, item.executor])).toEqual([
      ["WK-EITHER", "either"],
      ["WK-HUMAN", "human"],
    ]);
    expect(all.recommended_next).toEqual({ kind: "work", id: "WK-EITHER" });

    const agent = JSON.parse(run(root, [process.execPath, cli, "work", "--executor", "agent", "--json"]));
    expect(agent.groups.ready.map((item: { id: string }) => item.id)).toEqual(["WK-EITHER"]);
    expect(agent.groups.done).toBeUndefined();

    const human = JSON.parse(run(root, [process.execPath, cli, "work", "--executor", "human", "--all", "--json"]));
    expect(human.groups.ready.map((item: { id: string }) => item.id)).toEqual(["WK-EITHER", "WK-HUMAN"]);
    expect(human.groups.done.map((item: { id: string; executor: string }) => [item.id, item.executor])).toEqual([["WK-HUMAN-DONE", "human"]]);
    expect(run(root, [process.execPath, cli, "work", "--help"])).toContain("--executor agent|human|all");
    expect(run(root, [process.execPath, cli, "work", "--help"])).toContain("--all includes completed rows");

    for (const argv of [["--executor", "robot"], ["--executor"]]) {
      const invalid = Bun.spawnSync([process.execPath, cli, "work", ...argv], { cwd: root, stdout: "pipe", stderr: "pipe" });
      expect(invalid.exitCode).toBe(2);
      expect(invalid.stderr.toString()).toContain("work --executor");
    }
  });

  test("assembles authoritative current context and labels the proposal non-current", () => {
    const root = cliRepo([work({ id: "WK-01", context_pages: ["product/test"] })]);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const json = JSON.parse(run(root, [process.execPath, cli, "context", "--work", "WK-01", "--full", "--json"]));
    expect(json.version).toBe(1);
    expect(json.requestedWork).toBe("WK-01");
    expect(json.pages.map((page: { id: string }) => page.id)).toEqual(["product/invariant", "product/test"]);
    expect(json.ownerPage).toMatchObject({ id: "proposal/work", status: "proposed", authority: "normative" });
    expect(json.conflicts[0].id).toBe("C-900");
    expect(json.conflicts[0]).toMatchObject({
      pageId: "conflict/C-900",
      status: "conflicted",
      authority: "observed",
      sourceFiles: ["source.ts"],
      relevantOpenConflicts: ["C-900"],
    });
    expect(json.pages[0].relevantOpenConflicts).toEqual(["C-900"]);
    expect(json.pages[1]).toMatchObject({
      id: "product/test",
      kind: "product",
      status: "current",
      authority: "normative",
      exactSources: [{ path: "source.ts" }],
      sourceGlobs: [{ glob: "src/*.ts", matchedFiles: ["src/a.ts", "src/z.ts"] }],
      sourceFiles: ["source.ts", "src/a.ts", "src/z.ts"],
      relevantOpenConflicts: ["C-900"],
    });
    expect(json.readOrder.slice(0, 3).map((entry: { kind: string }) => entry.kind)).toEqual(["invariant", "conflict", "page"]);
    expect(json.readOrder.slice(3)).toEqual([
      { kind: "source", path: "source.ts", declaredBy: ["C-900", "product/invariant", "product/test"] },
      { kind: "source", path: "src/a.ts", declaredBy: ["product/test"] },
      { kind: "source", path: "src/z.ts", declaredBy: ["product/test"] },
    ]);
    expect(json.sources.find((item: { pageId: string }) => item.pageId === "proposal/work").declared).toEqual([{ path: "source.ts" }]);
    const text = run(root, [process.execPath, cli, "context", "--work", "WK-01", "--full"]);
    expect(text).toContain("# CURRENT INVARIANT product/invariant");
    expect(text).toContain("# CURRENT PAGE product/test");
    expect(text).toContain("# NON-CURRENT WORK OWNER proposal/work");
    expect(text).toContain("# AUTHORITATIVE READ ORDER");
    expect(text).toContain("Source globs and deterministic matches:");
    expect(text).toContain("- src/*.ts\n  - src/a.ts\n  - src/z.ts");
    expect(text).toContain("Relevant open conflicts:\n- C-900");
    expect(text.indexOf("# CURRENT INVARIANT")).toBeLessThan(text.indexOf("# OPEN CONFLICT"));
    expect(text.indexOf("# OPEN CONFLICT")).toBeLessThan(text.indexOf("# CURRENT PAGE"));
    expect(text.indexOf("# CURRENT PAGE")).toBeLessThan(text.indexOf("# SOURCE READ ORDER"));
    expect(text.indexOf("# SOURCE READ ORDER")).toBeLessThan(text.indexOf("# NON-CURRENT WORK OWNER"));
    expect(text).toContain("Declared sources:");
    expect(text).not.toContain("# CURRENT PAGE proposal/work");
  });

  test("projects selected-work context compactly by default and preserves exhaustive --full", () => {
    const root = cliRepo([work({ id: "WK-01", context_pages: ["product/test"] })]);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const compact = JSON.parse(run(root, [process.execPath, cli, "context", "--work", "WK-01", "--json"]));
    const full = JSON.parse(run(root, [process.execPath, cli, "context", "--work", "WK-01", "--full", "--json"]));
    expect(compact.mode).toBe("compact");
    expect(compact.pages.map((page: { id: string }) => page.id)).toEqual(full.pages.map((page: { id: string }) => page.id));
    expect(compact.conflicts.map((conflict: { id: string }) => conflict.id)).toEqual(full.conflicts.map((conflict: { id: string }) => conflict.id));
    expect(compact.readOrder).toEqual(full.readOrder);
    expect(compact.ownerPage.id).toBe(full.ownerPage.id);
    for (const page of [...compact.pages, compact.ownerPage]) {
      expect(page.body).toBeUndefined();
      expect(page.bodyDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(page.focusedCommand).toContain(`--page ${page.id}`);
      expect(page.sources).toBeDefined();
      expect(page.sourceFiles).toEqual(full.pages.find((item: { id: string }) => item.id === page.id)?.sourceFiles
        ?? full.ownerPage.sourceFiles);
    }
    expect(compact.sources).toBeUndefined();
    expect(full.sources.find((source: { pageId: string }) => source.pageId === "proposal/work").declared).toEqual([{ path: "source.ts" }]);
    expect(full.pages[1].body).toContain("Current contract body.");
    expect(compact.pages[1].body).toBeUndefined();
    const text = run(root, [process.execPath, cli, "context", "--work", "WK-01"]);
    expect(text).toContain("Projection: compact");
    expect(text).toContain("Body digest:");
    expect(text).toContain("Body omitted in compact mode");
    expect(text).toContain("SOURCE source.ts");
    expect((text.match(/# SOURCE READ ORDER/g) ?? []).length).toBe(0);
    expect(text).not.toContain("Current contract body.");
    expect(run(root, [process.execPath, cli, "context", "--work", "WK-01", "--full"])).toContain("Current contract body.");
  });

  test("exposes executor in generated/context projections and hands human work off", () => {
    const root = cliRepo([work({ id: "WK-HUMAN", executor: "human" })], false);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const queueText = run(root, [process.execPath, cli, "work"]);
    expect(queueText).toContain("Executor: human");
    const contextJson = JSON.parse(run(root, [process.execPath, cli, "context", "--work", "WK-HUMAN", "--json"]));
    expect(contextJson.work.executor).toBe("human");
    const contextText = run(root, [process.execPath, cli, "context", "--work", "WK-HUMAN"]);
    expect(contextText).toContain("Executor: human");
    expect(contextText).toContain("requires human execution");
    expect(contextText).toContain("report the procedure and hand off to a human");
    expect(contextText).toContain("assume credentials or authority");
  });

  test("generates a deterministic body-free reusable context and validates exact reuse", () => {
    const root = cliRepo([work({ id: "WK-01" }), work({ id: "WK-02", title: "Second task" })]);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const handoffDir = mkdtempSync(join(tmpdir(), "wiki-context-artifact-test-"));
    temporary.push(handoffDir);
    const metadata = join(handoffDir, "pr-body.md");
    const artifactPath = join(handoffDir, "context.json");
    writeFileSync(metadata, metadataBody());

    const first = runResult(root, [process.execPath, cli, "context", "--work", "WK-01", "--artifact", artifactPath, "--metadata", metadata, "--base", "HEAD", "--json"]);
    expect(first.exitCode).toBe(0);
    const summary = JSON.parse(first.stdout);
    expect(summary).toMatchObject({ ok: true, path: artifactPath, required_sources: 3 });
    const rendered = readFileSync(artifactPath, "utf8");
    expect(rendered).not.toContain("body");
    expect(rendered).not.toContain("Current contract body");
    const artifact = JSON.parse(rendered);
    const artifactDigest = artifact.artifact_digest;
    expect(artifact).toMatchObject({
      version: 1,
      selector: { kind: "work", id: "WK-01" },
      repository: {
        base_ref: "HEAD",
        base_sha: expect.stringMatching(/^[0-9a-f]{40}$/),
        merge_base_sha: expect.stringMatching(/^[0-9a-f]{40}$/),
        head_sha: expect.stringMatching(/^[0-9a-f]{40}$/),
        metadata_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      bindings: {
        context_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        pages: expect.arrayContaining([
          expect.objectContaining({ id: "product/invariant", path: "wiki/product/invariant.md", digest: expect.stringMatching(/^[0-9a-f]{64}$/) }),
          expect.objectContaining({ id: "product/test", path: "wiki/product/test.md", digest: expect.stringMatching(/^[0-9a-f]{64}$/) }),
          expect.objectContaining({ id: "proposal/work", path: "wiki/proposals/work.md", digest: expect.stringMatching(/^[0-9a-f]{64}$/) }),
        ]),
        sources: expect.arrayContaining([
          expect.objectContaining({
            path: "source.ts",
            declared_by: expect.arrayContaining(["proposal/work"]),
            digest: expect.stringMatching(/^[0-9a-f]{64}$/),
          }),
          expect.objectContaining({ path: "src/a.ts", digest: expect.stringMatching(/^[0-9a-f]{64}$/) }),
          expect.objectContaining({ path: "src/z.ts", digest: expect.stringMatching(/^[0-9a-f]{64}$/) }),
        ]),
      },
      artifact_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(summary.artifact_digest).toBe(artifactDigest);

    const second = runResult(root, [process.execPath, cli, "context", "--work", "WK-01", "--artifact", artifactPath, "--metadata", metadata, "--base", "HEAD", "--json"]);
    expect(second.exitCode).toBe(0);
    expect(readFileSync(artifactPath, "utf8")).toBe(rendered);
    writeFileSync(artifactPath, `${rendered}different\n`);
    const overwrite = runResult(root, [process.execPath, cli, "context", "--work", "WK-01", "--artifact", artifactPath, "--metadata", metadata, "--base", "HEAD", "--json"]);
    expect(overwrite.exitCode).toBe(2);
    expect(overwrite.stderr).toContain("refusing to overwrite different context artifact");
    writeFileSync(artifactPath, rendered);
    const reuse = runResult(root, [process.execPath, cli, "context", "--work", "WK-01", "--reuse", artifactPath, "--metadata", metadata, "--base", "HEAD", "--json"]);
    expect(reuse.exitCode).toBe(0);
    expect(JSON.parse(reuse.stdout)).toMatchObject({ ok: true, artifact_digest: artifactDigest, findings: [] });
    expect(reuse.stdout.length).toBeLessThan(rendered.length);

    const wrongSelector = runResult(root, [process.execPath, cli, "context", "--work", "WK-02", "--reuse", artifactPath, "--metadata", metadata, "--base", "HEAD", "--json"]);
    expect(wrongSelector.exitCode).toBe(1);
    expect(JSON.parse(wrongSelector.stdout).findings.map((finding: { code: string }) => finding.code)).toEqual(expect.arrayContaining([
      "context-artifact-selector-stale",
      "context-artifact-context-stale",
    ]));
  });

  test("invalidates reusable context all-or-nothing for metadata, repository, page, source, conflict, and tampering changes", () => {
    const root = cliRepo([work({ id: "WK-01" })]);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const handoffDir = mkdtempSync(join(tmpdir(), "wiki-context-stale-test-"));
    temporary.push(handoffDir);
    const metadata = join(handoffDir, "pr-body.md");
    const artifactPath = join(handoffDir, "context.json");
    writeFileSync(metadata, metadataBody());
    expect(runResult(root, [process.execPath, cli, "context", "--work", "WK-01", "--artifact", artifactPath, "--metadata", metadata, "--base", "HEAD", "--json"]).exitCode).toBe(0);

    writeFileSync(metadata, metadataBody("fix"));
    let result = runResult(root, [process.execPath, cli, "context", "--work", "WK-01", "--reuse", artifactPath, "--metadata", metadata, "--base", "HEAD", "--json"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).findings.map((finding: { code: string }) => finding.code)).toContain("context-artifact-metadata-stale");

    put(root, "source.ts", "export const value = false;\n");
    put(root, "wiki/product/test.md", currentPage("product/test", "product", "  - path: source.ts\n  - glob: src/*.ts").replace("Current contract body.", "Changed contract body."));
    put(root, "wiki/conflicts/open/C-900.md", conflictPage().replace("Owner decision is required.", "Changed owner decision is required."));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "change controlled inputs"]);
    result = runResult(root, [process.execPath, cli, "context", "--work", "WK-01", "--reuse", artifactPath, "--metadata", metadata, "--base", "HEAD~1", "--json"]);
    expect(result.exitCode).toBe(1);
    const staleCodes = JSON.parse(result.stdout).findings.map((finding: { code: string }) => finding.code);
    expect(staleCodes).toEqual(expect.arrayContaining([
      "context-artifact-base-stale",
      "context-artifact-head-stale",
      "context-artifact-pages-stale",
      "context-artifact-sources-stale",
      "context-artifact-conflicts-stale",
      "context-artifact-context-stale",
    ]));

    const tampered = JSON.parse(readFileSync(artifactPath, "utf8"));
    tampered.artifact_digest = "0".repeat(64);
    writeFileSync(artifactPath, jsonStable(tampered));
    result = runResult(root, [process.execPath, cli, "context", "--work", "WK-01", "--reuse", artifactPath, "--metadata", metadata, "--base", "HEAD", "--json"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).findings.map((finding: { code: string }) => finding.code)).toContain("context-artifact-digest-invalid");
  });

  test("refuses dirty candidates and validates artifact option usage", () => {
    const root = cliRepo([work({ id: "WK-01" })], false);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const handoffDir = mkdtempSync(join(tmpdir(), "wiki-context-usage-test-"));
    temporary.push(handoffDir);
    const metadata = join(handoffDir, "pr-body.md");
    const artifactPath = join(handoffDir, "context.json");
    writeFileSync(metadata, metadataBody());
    expect(runResult(root, [process.execPath, cli, "context", "--work", "WK-01", "--artifact", artifactPath, "--metadata", metadata, "--base", "HEAD", "--json"]).exitCode).toBe(0);

    put(root, "source.ts", "export const value = dirty;\n");
    const dirty = runResult(root, [process.execPath, cli, "context", "--work", "WK-01", "--reuse", artifactPath, "--metadata", metadata, "--base", "HEAD", "--json"]);
    expect(dirty.exitCode).toBe(1);
    expect(JSON.parse(dirty.stdout).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "context-artifact-dirty", path: "source.ts" }),
    ]));

    const invalidCases: [string[], string][] = [
      [["--artifact", artifactPath, "--reuse", artifactPath, "--metadata", metadata, "--base", "HEAD"], "mutually exclusive"],
      [["--artifact", artifactPath, "--base", "HEAD"], "context --artifact/--reuse"],
      [["--reuse", artifactPath, "--metadata", metadata], "context --artifact/--reuse"],
    ];
    for (const [argv, message] of invalidCases) {
      const invalid = runResult(root, [process.execPath, cli, "context", "--work", "WK-01", ...argv]);
      expect(invalid.exitCode).toBe(2);
      expect(invalid.stderr).toContain(message);
    }
  });

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
