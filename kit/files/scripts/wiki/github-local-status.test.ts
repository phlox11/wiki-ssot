import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { localCheckDigest, type LocalCheckResult } from "./local-check";
import { publishLocalStatus, type GhResult, type GhRunner } from "./github-local-status";
import type { Finding } from "./model";

const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function run(root: string, command: string[]): string {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

function baseRepo(): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), "wiki-local-status-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Status Test"]);
  run(root, ["git", "config", "user.email", "wiki-status@example.invalid"]);
  writeFileSync(join(root, "README.md"), "status\n");
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "status fixture"]);
  return { root, head: run(root, ["git", "rev-parse", "HEAD"]).trim() };
}

function result(head: string, ok = true, warnings: Finding[] = []): LocalCheckResult {
  const core: Omit<LocalCheckResult, "result_digest"> = {
    version: 1,
    status: ok ? "pass" : "failure",
    ok,
    head_sha: head,
    base_ref: "HEAD",
    base_sha: head,
    merge_base_sha: head,
    metadata_digest: "a".repeat(64),
    checks: {
      structural: { ok, findings: [] },
      state: { ok, findings: [] },
      impact: {
        base: "HEAD", merge_base: head, changed_files: ["src/app.ts"], affected_pages: ["product/app"],
        affected_invariants: [], affected_conflicts: [], removed_current_pages: [], stale_pages: [],
        high_risk_stale_pages: [], advisory_stale_pages: [], unmapped_high_risk: [], findings: [],
      },
      review: {
        ok, required: false, status: "not-required", mode: "required", requirement_reasons: [], findings: [],
        affected_invariants: [], affected_conflicts: [],
      },
      tooling: { selected: false, changed_files: [], commands: [], findings: [], ok: true },
    },
    findings: [...warnings], warnings: [...warnings],
  };
  return { ...core, result_digest: localCheckDigest(core) };
}

function fakeGh(head: string, comments: unknown[] = []): { gh: GhRunner; calls: string[][]; failOn?: string } {
  const calls: string[][] = [];
  const state: { failOn?: string } = {};
  const gh: GhRunner = (args): GhResult => {
    calls.push([...args]);
    const joined = args.join(" ");
    if (state.failOn && joined.includes(state.failOn)) return { exitCode: 1, stdout: "", stderr: "api unavailable" };
    if (joined.includes("pulls/17")) return { exitCode: 0, stdout: `${head}\n`, stderr: "" };
    if (joined.includes("comments?per_page=100")) return { exitCode: 0, stdout: JSON.stringify([comments]), stderr: "" };
    return { exitCode: 0, stdout: "{}\n", stderr: "" };
  };
  Object.defineProperty(gh, "failOn", { get: () => state.failOn, set: (value: string) => { state.failOn = value; } });
  return { gh, calls, failOn: undefined };
}

function writeResult(root: string, value: LocalCheckResult): string {
  const path = join(root, "result.json");
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

describe("GitHub local status publishing", () => {
  test("creates a marker and posts success last, including warnings as success", () => {
    const fixture = baseRepo();
    const fake = fakeGh(fixture.head);
    const resultPath = writeResult(fixture.root, result(fixture.head, true, [{ code: "example-warning", message: "non-blocking warning", severity: "warning" }]));
    const published = publishLocalStatus({ root: fixture.root, resultPath, repo: "owner/repo", pr: 17, gh: fake.gh });
    expect(published).toMatchObject({ state: "success", comment: "created", status_context: "wiki-ssot/local" });
    const statusIndex = fake.calls.findIndex((args) => args.some((arg) => arg.includes("/statuses/")));
    const commentIndex = fake.calls.findIndex((args) => args.some((arg) => arg.includes("/comments")) && args.includes("POST"));
    expect(statusIndex).toBeGreaterThan(commentIndex);
    expect(fake.calls.some((args) => args.includes("state=success"))).toBe(true);
    expect(fake.calls.some((args) => args.some((arg) => arg.includes("Warnings: 1")))).toBe(true);
    const marker = fake.calls.find((args) => args.some((arg) => arg.includes("wiki-ssot:local-status")));
    expect(marker?.some((arg) => arg.includes("<result.json>"))).toBe(true);
    expect(marker?.some((arg) => arg.includes(".wiki/local-check.json"))).toBe(false);
  });

  test("updates the existing marker and deletes only duplicate marker comments", () => {
    const fixture = baseRepo();
    const fake = fakeGh(fixture.head, [
      { id: 11, body: "<!-- wiki-ssot:local-status --> old" },
      { id: 12, body: "unrelated" },
      { id: 13, body: "<!-- wiki-ssot:local-status --> duplicate" },
    ]);
    const resultPath = writeResult(fixture.root, result(fixture.head, false));
    const published = publishLocalStatus({ root: fixture.root, resultPath, repo: "owner/repo", pr: 17, gh: fake.gh });
    expect(published).toMatchObject({ state: "failure", comment: "updated", deleted_duplicate_comments: 1 });
    expect(fake.calls.some((args) => args.some((arg) => arg.includes("comments/11")))).toBe(true);
    expect(fake.calls.some((args) => args.some((arg) => arg.includes("comments/13")) && args.includes("DELETE"))).toBe(true);
    expect(fake.calls.some((args) => args.some((arg) => arg.includes("comments/12")))).toBe(false);
    expect(fake.calls.some((args) => args.includes("state=failure"))).toBe(true);
  });

  test("rejects tampered, stale, wrong-remote, and dirty results before writes", () => {
    const fixture = baseRepo();
    const fake = fakeGh(fixture.head);
    const tamperedPath = writeResult(fixture.root, { ...result(fixture.head), result_digest: "0".repeat(64) });
    expect(() => publishLocalStatus({ root: fixture.root, resultPath: tamperedPath, repo: "owner/repo", pr: 17, gh: fake.gh })).toThrow();
    expect(fake.calls).toEqual([]);

    const staleRoot = baseRepo();
    const stale = result("1".repeat(40));
    const stalePath = writeResult(staleRoot.root, stale);
    expect(() => publishLocalStatus({ root: staleRoot.root, resultPath: stalePath, repo: "owner/repo", pr: 17, gh: fake.gh })).toThrow();

    const dirtyRoot = baseRepo();
    const dirtyPath = writeResult(dirtyRoot.root, result(dirtyRoot.head));
    writeFileSync(join(dirtyRoot.root, "README.md"), "dirty\n");
    expect(() => publishLocalStatus({ root: dirtyRoot.root, resultPath: dirtyPath, repo: "owner/repo", pr: 17, gh: fake.gh })).toThrow(/clean worktree/);
  });

  test("refuses a remote SHA mismatch and never posts a status", () => {
    const fixture = baseRepo();
    const calls: string[][] = [];
    const gh: GhRunner = (args) => {
      calls.push([...args]);
      if (args.join(" ").includes("pulls/17")) return { exitCode: 0, stdout: `${"2".repeat(40)}\n`, stderr: "" };
      return { exitCode: 0, stdout: "[]", stderr: "" };
    };
    const resultPath = writeResult(fixture.root, result(fixture.head));
    expect(() => publishLocalStatus({ root: fixture.root, resultPath, repo: "owner/repo", pr: 17, gh })).toThrow(/does not match/);
    expect(calls.some((args) => args.some((arg) => arg.includes("/statuses/")))).toBe(false);
  });

  test("propagates API failures after comment but before success status", () => {
    const fixture = baseRepo();
    const calls: string[][] = [];
    const gh: GhRunner = (args) => {
      calls.push([...args]);
      const joined = args.join(" ");
      if (joined.includes("pulls/17")) return { exitCode: 0, stdout: `${fixture.head}\n`, stderr: "" };
      if (joined.includes("statuses/")) return { exitCode: 1, stdout: "", stderr: "status failed" };
      if (joined.includes("comments?per_page=100")) return { exitCode: 0, stdout: "[[]]", stderr: "" };
      return { exitCode: 0, stdout: "{}", stderr: "" };
    };
    const resultPath = writeResult(fixture.root, result(fixture.head));
    expect(() => publishLocalStatus({ root: fixture.root, resultPath, repo: "owner/repo", pr: 17, gh })).toThrow(/GitHub API request failed/);
    const statusIndex = calls.findIndex((args) => args.some((arg) => arg.includes("/statuses/")));
    const commentIndex = calls.findIndex((args) => args.some((arg) => arg.includes("/comments")) && args.includes("POST"));
    expect(statusIndex).toBeGreaterThan(commentIndex);
  });

  test("uses the configured v2 status context while retaining the status-last order", () => {
    const fixture = baseRepo();
    mkdirSync(join(fixture.root, ".wiki"), { recursive: true });
    writeFileSync(join(fixture.root, ".wiki/config.json"), JSON.stringify({
      version: 2,
      name: "status-context",
      publishesKit: false,
      enforcement: { mode: "local-status", statusContext: "project/wiki-local" },
      localChecks: [{ id: "test", argv: ["bun", "run", "test"] }],
      review: { mode: "required", when: { kind: "risk-based", changedFileRules: [{ glob: ".wiki/config.json", reason: "The local enforcement policy is changing here." }], changedKitOwnedFiles: false, affectedInvariants: true, affectedConflicts: true, removedCurrentPages: true } },
    }, null, 2));
    run(fixture.root, ["git", "add", "."]);
    run(fixture.root, ["git", "commit", "-qm", "v2 status context"]);
    const head = run(fixture.root, ["git", "rev-parse", "HEAD"]).trim();
    const fake = fakeGh(head);
    const resultPath = writeResult(fixture.root, result(head));
    publishLocalStatus({ root: fixture.root, resultPath, repo: "owner/repo", pr: 17, gh: fake.gh });
    const status = fake.calls.find((args) => args.some((arg) => arg.includes("/statuses/")));
    expect(status).toContain("context=project/wiki-local");
  });
});
