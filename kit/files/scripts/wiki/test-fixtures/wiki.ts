import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildConflictMap,
  buildSourceMap,
  changedFiles,
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
  type RepoView,
  type WikiPage,
} from "../core";

export const temporary: string[] = [];

export function cleanupTemporary(): void {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
}

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-test-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Test"]);
  run(root, ["git", "config", "user.email", "wiki@example.invalid"]);
  return root;
}

function run(root: string, command: string[]) {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

function put(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function frontmatter(overrides: Record<string, unknown> = {}): string {
  const data = {
    id: "product/test",
    summary: "Test contract.",
    kind: "product",
    status: "current",
    authority: "observed",
    owners: ["@owner"],
    sources: [{ path: "source.ts" }],
    ...overrides,
  };
  return `---\n${Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n\n# Test\n`;
}

function conflictFrontmatter(overrides: Record<string, unknown> = {}): string {
  const data = {
    id: "conflict/C-900",
    conflict_id: "C-900",
    summary: "Test conflict contract.",
    kind: "conflict",
    status: "conflicted",
    authority: "observed",
    owners: ["@owner"],
    conflict_type: "implementation",
    severity: "high",
    origin: "baseline",
    opened_at: "2026-07-22",
    sources: [{ path: "source.ts" }],
    affected_pages: ["product/test"],
    affected_invariants: [],
    resolution: { state: "open", decision: null, acceptance: ["Implement and test the missing contract."] },
    ...overrides,
  };
  return `---\n${Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n\n# Test conflict\n`;
}

function memoryView(files: Record<string, string>): RepoView {
  const paths = Object.keys(files).sort();
  return { root: "/memory", mode: "working", listFiles: () => paths, exists: (path) => path in files, read: (path) => files[path] };
}



export { tempRepo, run, put, frontmatter, conflictFrontmatter, memoryView };
export {
  buildConflictMap,
  buildSourceMap,
  changedFiles,
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
};
export type { RepoView, WikiPage };
