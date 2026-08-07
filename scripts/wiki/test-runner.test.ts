import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverWikiTestFiles } from "./test-runner";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("portable test discovery", () => {
  test("finds nested tests once in deterministic order without following a loop", () => {
    const root = mkdtempSync(join(tmpdir(), "wiki-test-runner-"));
    temporary.push(root);
    mkdirSync(join(root, "scripts/wiki/nested/deeper"), { recursive: true });
    writeFileSync(join(root, "scripts/wiki/z.test.ts"), "");
    writeFileSync(join(root, "scripts/wiki/nested/a.test.ts"), "");
    writeFileSync(join(root, "scripts/wiki/nested/deeper/b.test.ts"), "");
    symlinkSync("..", join(root, "scripts/wiki/nested/deeper/loop"));
    const expected = [
      "scripts/wiki/nested/a.test.ts",
      "scripts/wiki/nested/deeper/b.test.ts",
      "scripts/wiki/z.test.ts",
    ];
    expect(discoverWikiTestFiles(root)).toEqual(expected);
    expect(new Set(discoverWikiTestFiles(root)).size).toBe(expected.length);
  });
});
