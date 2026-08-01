#!/usr/bin/env bun
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function testFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".test.ts")) files.push(relative(root, path));
    }
  };
  visit(join(root, "scripts/wiki"));
  const priority = new Map([
    ["scripts/wiki/primary-current.test.ts", 0],
    ["scripts/wiki/primary-baseline.test.ts", 1],
    ["scripts/wiki/fresh-context.test.ts", 2],
  ]);
  return files.sort((left, right) => (priority.get(left) ?? 3) - (priority.get(right) ?? 3) || left.localeCompare(right));
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const forwarded = Bun.argv.slice(2);
const files = testFiles(root);
if (files.length === 0) {
  console.error("no Wiki tooling tests found under scripts/wiki");
  process.exit(2);
}

let cursor = 0;
let failed = 0;
const worker = async (): Promise<void> => {
  while (failed === 0 && cursor < files.length) {
    const file = files[cursor++];
    const child = Bun.spawn(
      [globalThis.process.execPath, "test", join(root, file), "--max-concurrency=1", ...forwarded],
      { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
    );
    const exitCode = await child.exited;
    if (exitCode !== 0) failed = exitCode;
  }
};

await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => worker()));
if (failed !== 0) globalThis.process.exit(failed);
