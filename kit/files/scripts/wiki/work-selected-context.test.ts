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

describe("work queue and selected context", () => {
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


});

