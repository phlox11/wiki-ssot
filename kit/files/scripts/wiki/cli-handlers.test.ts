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

  test("enforces staged write guards directly", async () => {
    if (isGeneratedKitMirror) return;
    const { runCli } = await import("./cli");
    const output = capture();
    expect(runCli(["inventory", "--staged", "--root", process.cwd()], { cwd: process.cwd(), io: output.io })).toBe(2);
    expect(output.stderr).toEqual(["inventory does not write in --staged mode\n"]);
  });
});
