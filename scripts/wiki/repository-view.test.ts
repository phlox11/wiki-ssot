import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createRepoView, expandSource, normalizeRepoPath, type RepoView } from "./repository-view";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function run(root: string, command: string[]): void {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

describe("repository view", () => {
  test("normalizes separators and dot segments", () => {
    expect(normalizeRepoPath("./docs\\nested/../readme.md")).toBe("readme.md");
  });

  test("keeps staged and working reads distinct", () => {
    const root = mkdtempSync(join(tmpdir(), "wiki-repository-view-"));
    temporary.push(root);
    run(root, ["git", "init", "-q"]);
    run(root, ["git", "config", "user.name", "Wiki View Test"]);
    run(root, ["git", "config", "user.email", "wiki-view@example.invalid"]);
    writeFileSync(join(root, "tracked.txt"), "staged\n");
    run(root, ["git", "add", "tracked.txt"]);
    writeFileSync(join(root, "tracked.txt"), "working\n");
    expect(createRepoView(root).read("tracked.txt")).toBe("working\n");
    expect(createRepoView(root, true).read("tracked.txt")).toBe("staged\n");
  });

  test("expands exact and glob sources deterministically", () => {
    const files: Record<string, string> = { "src/z.ts": "z", "src/a.ts": "a", "README.md": "readme" };
    const paths = Object.keys(files).sort();
    const view: RepoView = { root: "/memory", mode: "working", listFiles: () => paths, exists: (path) => path in files, read: (path) => files[path] };
    expect(expandSource(view, { path: "README.md" })).toEqual(["README.md"]);
    expect(expandSource(view, { path: "missing.ts" })).toEqual([]);
    expect(expandSource(view, { glob: "src/*.ts" })).toEqual(["src/a.ts", "src/z.ts"]);
  });

  test("reports missing reads using the selected snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "wiki-repository-view-missing-"));
    temporary.push(root);
    run(root, ["git", "init", "-q"]);
    expect(() => createRepoView(root).read("missing.txt")).toThrow("file not found in repository");
  });
});
