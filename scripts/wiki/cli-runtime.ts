import { isAbsolute, relative, resolve } from "node:path";
import { createRepoView, type RepoView } from "./repository-view";
import { loadWikiPages } from "./page-validation";
import type { Finding, WikiPage } from "./model";
import { UsageError } from "./verification";
import { jsonStable } from "./serialization";

export { jsonStable };

/** Parsed command-line state shared by every portable CLI handler. */
export type ParsedArgs = { positional: string[]; flags: Map<string, string[]> };

/** The public command order is part of the portable CLI contract. */
export const CLI_COMMANDS = [
  "lint", "inventory", "index", "generated", "kit", "work", "search", "conflicts", "context",
  "impact", "verify", "review-preflight", "review-bundle", "review-check", "doctor", "check", "audit",
] as const;
export type CliCommand = typeof CLI_COMMANDS[number];

export function has(parsed: ParsedArgs, key: string): boolean {
  return parsed.flags.has(key);
}

export function one(parsed: ParsedArgs, key: string): string | undefined {
  return parsed.flags.get(key)?.at(-1);
}

export function many(parsed: ParsedArgs, key: string): string[] {
  return parsed.flags.get(key) ?? [];
}

export type CliIo = {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
};

export const processIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

export function emit(io: CliIo, value: unknown, json: boolean): void {
  if (json) io.stdout(jsonStable(value));
  else if (typeof value === "string") io.stdout(value.endsWith("\n") ? value : `${value}\n`);
  else io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

export function printFindings(io: CliIo, findings: Finding[]): void {
  for (const finding of findings) {
    const location = finding.path ? `${finding.path}: ` : "";
    io.stderr(`${finding.severity.toUpperCase()} [${finding.code}] ${location}${finding.message}\n`);
  }
}

export function usage(): never {
  throw new UsageError(`usage: bun scripts/wiki/cli.ts <${CLI_COMMANDS.join("|")}> [options]`);
}

export type CliLoaded = { pages: WikiPage[]; findings: Finding[] };

export type CliContext = {
  command: string;
  parsed: ParsedArgs;
  json: boolean;
  staged: boolean;
  root: string;
  view: RepoView;
  loaded: CliLoaded;
  io: CliIo;
};

export type CliContextOptions = {
  cwd?: string;
  io?: CliIo;
};

/** Build all state needed by handlers. Page parsing is intentionally eager and findings are short-circuited by dispatch. */
export function createCliContext(parsed: ParsedArgs, command: string, options: CliContextOptions = {}): CliContext {
  const json = has(parsed, "json");
  const staged = has(parsed, "staged");
  const cwd = options.cwd ?? process.cwd();
  const root = resolve(cwd, one(parsed, "root") ?? cwd);
  const view = createRepoView(root, staged);
  const loaded = loadWikiPages(view);
  return { command, parsed, json, staged, root, view, loaded, io: options.io ?? processIo };
}

export function isAllowedLocalArtifact(root: string, allowedFiles: Set<string>, allowedOutput: string | undefined, path: string): boolean {
  const absolute = resolve(root, path);
  if (allowedFiles.has(absolute)) return true;
  if (!allowedOutput) return false;
  const nested = relative(allowedOutput, absolute);
  return nested === "" || (!nested.startsWith("..") && !isAbsolute(nested));
}
