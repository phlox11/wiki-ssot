import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CliIo } from "./cli-runtime";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
  process.exitCode = undefined;
});

function capture(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) } };
}

const isGeneratedKitMirror = import.meta.dir.includes("/kit/files/");

describe("direct CLI handler dispatch", () => {
  test("parses canonical local-check reviewer and PR actor flags", async () => {
    if (isGeneratedKitMirror) return;
    const { parseArgs } = await import("./cli");
    const parsed = parseArgs(["check", "--output", "result.json", "--reviewer-actor", "trusted-reviewer", "--pr-author", "author"]);
    expect(parsed.flags.get("reviewer-actor")).toEqual(["trusted-reviewer"]);
    expect(parsed.flags.get("pr-author")).toEqual(["author"]);
  });

  test("dispatches a successful JSON command through injectable IO", async () => {
    if (isGeneratedKitMirror) return;
    const { dispatch } = await import("./cli");
    const output = capture();
    const code = dispatch(["search", "KM-05", "--json"], { cwd: process.cwd(), io: output.io });
    expect(code).toBe(0);
    expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout.join(""))).toMatchObject({ query: "KM-05" });
  });

  test("returns usage errors without spawning a CLI process", async () => {
    if (isGeneratedKitMirror) return;
    const { runCli } = await import("./cli");
    const output = capture();
    const code = runCli(["search"], { cwd: process.cwd(), io: output.io });
    expect(code).toBe(2);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual(["search requires a query\n"]);
  });

  test("keeps work help ahead of malformed loaded-page errors", async () => {
    if (isGeneratedKitMirror) return;
    const { runCli } = await import("./cli");
    const root = mkdtempSync(join(tmpdir(), "wiki-cli-handlers-malformed-"));
    temporary.push(root);
    mkdirSync(join(root, "wiki"), { recursive: true });
    writeFileSync(join(root, "wiki/bad.md"), "# malformed\n");
    const initialized = Bun.spawnSync(["git", "init", "-q"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(initialized.exitCode).toBe(0);
    const output = capture();
    expect(runCli(["work", "--help", "--root", root], { cwd: process.cwd(), io: output.io })).toBe(0);
    expect(output.stdout.join("")).toContain("Usage: bun run wiki:work");
    expect(output.stderr).toEqual([]);

    const failed = capture();
    expect(runCli(["search", "x", "--root", root], { cwd: process.cwd(), io: failed.io })).toBe(1);
    expect(failed.stderr.join("")).toContain("ERROR [frontmatter-parse]");
  });

  test("sends publish to the result boundary before malformed loaded-page errors", async () => {
    if (isGeneratedKitMirror) return;
    const { dispatchCommand } = await import("./cli");
    const output = capture();
    const context = {
      command: "publish",
      parsed: { positional: [], flags: new Map<string, string[]>() },
      json: false,
      staged: false,
      root: process.cwd(),
      view: {} as never,
      loaded: {
        pages: [],
        findings: [{ code: "frontmatter-parse", message: "malformed page", severity: "error" as const }],
      },
      io: output.io,
    } as Parameters<typeof dispatchCommand>[0];
    expect(() => dispatchCommand(context)).toThrow("publish requires --result <result.json>");
    expect(output.stderr).toEqual([]);
  });

  test("keeps malformed v2 doctor on the local-status path", async () => {
    if (isGeneratedKitMirror) return;
    const { runCli } = await import("./cli");
    const root = mkdtempSync(join(tmpdir(), "wiki-cli-v2-doctor-"));
    temporary.push(root);
    mkdirSync(join(root, ".wiki"), { recursive: true });
    writeFileSync(join(root, ".wiki/config.json"), JSON.stringify({
      version: 2,
      name: "invalid-v2",
      publishesKit: false,
      enforcement: { mode: "local-status", statusContext: "wiki-ssot/local" },
      localChecks: [],
      review: { mode: "required", when: { kind: "risk-based", changedFileRules: [], changedKitOwnedFiles: false, affectedInvariants: false, affectedConflicts: false, removedCurrentPages: false } },
    }));
    expect(Bun.spawnSync(["git", "init", "-q"], { cwd: root, stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
    const output = capture();
    expect(runCli(["doctor", "--json", "--root", root], { cwd: process.cwd(), io: output.io })).toBe(1);
    const codes = (JSON.parse(output.stdout.join("")) as { findings: { code: string }[] }).findings.map((item) => item.code);
    expect(codes).toContain("local-status-config-invalid");
    expect(codes).not.toContain("fresh-context-template-missing");
    expect(codes).not.toContain("fresh-context-workflow-missing");
  });

  test("enforces staged write guards directly", async () => {
    if (isGeneratedKitMirror) return;
    const { runCli } = await import("./cli");
    const output = capture();
    expect(runCli(["inventory", "--staged", "--root", process.cwd()], { cwd: process.cwd(), io: output.io })).toBe(2);
    expect(output.stderr).toEqual(["inventory does not write in --staged mode\n"]);
  });
});
