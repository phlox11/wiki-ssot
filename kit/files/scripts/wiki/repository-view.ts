import { readFileSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import type { WikiSource } from "./model";

/** A small read-only view over either the working tree or the Git index. */
export interface RepoView {
  root: string;
  mode: "working" | "staged";
  listFiles(): string[];
  exists(path: string): boolean;
  read(path: string): string;
}

/** Run a Git command rooted at a repository. */
export function git(root: string, args: string[], allowFailure = false): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    if (allowFailure) return "";
    throw new Error(result.stderr.toString().trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.toString();
}

function gitFileList(root: string, staged: boolean): string[] {
  const args = staged
    ? ["ls-files", "--cached", "-z"]
    : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"];
  return git(root, args)
    .split("\0")
    .filter(Boolean)
    .sort();
}

export function normalizeRepoPath(path: string): string {
  return normalize(path).replaceAll("\\", "/").replace(/^\.\//, "");
}

export function createRepoView(root = process.cwd(), staged = false): RepoView {
  const normalizedRoot = resolve(root);
  const files = gitFileList(normalizedRoot, staged);
  const fileSet = new Set(files);
  return {
    root: normalizedRoot,
    mode: staged ? "staged" : "working",
    listFiles: () => [...files],
    exists: (path) => fileSet.has(normalizeRepoPath(path)),
    read: (path) => {
      const repoPath = normalizeRepoPath(path);
      if (!fileSet.has(repoPath)) throw new Error(`file not found in ${staged ? "Git index" : "repository"}: ${repoPath}`);
      return staged ? git(normalizedRoot, ["show", `:${repoPath}`]) : readFileSync(join(normalizedRoot, repoPath), "utf8");
    },
  };
}

/** Expand an exact source path or glob against a repository view. */
export function expandSource(view: RepoView, source: WikiSource): string[] {
  if ("path" in source) return view.exists(source.path) ? [source.path] : [];
  const glob = new Bun.Glob(source.glob);
  return view.listFiles().filter((path) => glob.match(path)).sort();
}
