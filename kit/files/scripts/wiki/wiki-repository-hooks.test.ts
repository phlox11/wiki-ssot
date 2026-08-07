import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildConflictMap,
  buildSourceMap,
  changedFiles,
  cleanupTemporary,
  compareGenerated,
  createRepoView,
  generateConflictsIndex,
  generateCurrentStatus,
  generateIndex,
  generatedCoreFiles,
  hashContent,
  impactReport,
  isConflictGuardFinding,
  isHighRisk,
  isImplementationSourceChange,
  jsonStable,
  loadWikiPages,
  mappedPages,
  mappedConflicts,
  makeReviewBundle,
  parsePrMetadata,
  parseWikiPage,
  searchWikiPages,
  validateMarkdownLinks,
  validatePages,
  validateCoverage,
  validatePrMetadata,
  validateState,
  verifyState,
  tempRepo,
  run,
  put,
  frontmatter,
  conflictFrontmatter,
  memoryView,
  temporary,
  type RepoView,
  type WikiPage,
} from "./test-fixtures/wiki";

afterEach(cleanupTemporary);

describe("repository hooks", () => {
  test("blocks a bad staged commit and a direct main push", () => {
    const root = tempRepo();
    put(root, "package.json", jsonStable({ scripts: { "wiki:lint": `${process.execPath} ${join(process.cwd(), "scripts/wiki/cli.ts")} lint` } }));
    put(root, "wiki/product/bad.md", "missing frontmatter\n");
    mkdirSync(join(root, ".husky"), { recursive: true });
    copyFileSync(join(process.cwd(), ".husky/pre-commit"), join(root, ".husky/pre-commit"));
    copyFileSync(join(process.cwd(), ".husky/pre-push"), join(root, ".husky/pre-push"));
    chmodSync(join(root, ".husky/pre-commit"), 0o755);
    chmodSync(join(root, ".husky/pre-push"), 0o755);
    run(root, ["git", "config", "core.hooksPath", ".husky"]);
    run(root, ["git", "add", "."]);
    const commit = Bun.spawnSync(["git", "commit", "-m", "bad wiki"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(commit.exitCode).not.toBe(0);

    const mainPush = Bun.spawnSync(["sh", ".husky/pre-push"], {
      cwd: root,
      stdin: new Blob(["refs/heads/topic abc refs/heads/main def\n"]),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(mainPush.exitCode).toBe(1);
    expect(mainPush.stderr.toString()).toContain("Direct pushes to main are blocked");
    const featurePush = Bun.spawnSync(["sh", ".husky/pre-push"], {
      cwd: root,
      stdin: new Blob(["refs/heads/topic abc refs/heads/topic def\n"]),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(featurePush.exitCode).toBe(0);
  });
});

