#!/usr/bin/env bun
/**
 * One idempotent entrypoint for installing, upgrading, and reconciling the
 * wiki-ssot kit in an initialized Git repository.
 *
 * The command deliberately performs only deterministic work. Semantic wiki
 * reconciliation is returned as structured `needs-reconcile` findings for the
 * invoking coding agent to disposition before rerunning the same command.
 */
import {
  existsSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANIFEST_TARGET,
  applySync,
  planSync,
  readManifest,
  sha256,
  type KitManifest,
  type SyncPlan,
} from "./kit-sync";

export { sha256 } from "./kit-sync";

export const MANAGED_HTML_START = "<!-- wiki-ssot:managed:start -->";
export const MANAGED_HTML_END = "<!-- wiki-ssot:managed:end -->";
export const MANAGED_SHELL_START = "# wiki-ssot:managed:start";
export const MANAGED_SHELL_END = "# wiki-ssot:managed:end";

export type ApplyMode = "new" | "adopt" | "upgrade";
export type ApplyStatus = "ready" | "needs-merge" | "needs-reconcile" | "failed";
export type ApplyFinding = { code: string; path?: string; page?: string; action: string };
export type ApplyReport = {
  version: 1;
  mode: ApplyMode;
  status: ApplyStatus;
  dryRun: boolean;
  kitDigest: string;
  applied: string[];
  /** Compatibility alias kept intentionally terse for orchestration clients. */
  changes: string[];
  conflicts: { path: string; reason: string }[];
  findings: ApplyFinding[];
  checks: Record<string, "pass" | "fail" | "skipped">;
  nextCommand: string;
};

export type ManagedBlockResult = {
  status: "ready" | "needs-merge";
  content: string;
  action: "append" | "replace" | "unchanged" | "conflict";
  reason?: string;
};

export type PackageMergeResult = {
  status: "ready" | "needs-merge";
  packageJson: Record<string, unknown>;
  conflicts: string[];
  changed: boolean;
};

type ManagedManifestEntry = {
  sha256: string;
  start: string;
  end: string;
  legacyMarkers?: string[];
};

type ApplyKitManifest = KitManifest & {
  managed?: Record<string, ManagedManifestEntry>;
  reference?: Record<string, string>;
};

type ApplyOptions = {
  into: string;
  kit?: string;
  dryRun?: boolean;
  json?: boolean;
  skipInstall?: boolean;
  accept?: string[];
};

function occurrences(content: string, needle: string): number[] {
  const result: number[] = [];
  let cursor = 0;
  while (true) {
    const index = content.indexOf(needle, cursor);
    if (index < 0) return result;
    result.push(index);
    cursor = index + needle.length;
  }
}

function managedMarkers(content: string): { start: string; end: string } {
  if (content.includes(MANAGED_SHELL_START) || content.includes(MANAGED_SHELL_END)) {
    return { start: MANAGED_SHELL_START, end: MANAGED_SHELL_END };
  }
  return { start: MANAGED_HTML_START, end: MANAGED_HTML_END };
}

function normalizeManagedBlock(content: string, start: string, end: string): string {
  const trimmed = content.trim();
  if (trimmed.includes(start) && trimmed.includes(end)) return trimmed;
  return `${start}\n${trimmed}\n${end}`;
}

/**
 * Replace only a declared wiki-ssot managed region. Content outside the block
 * is never rewritten. Missing blocks are appended; malformed or duplicate
 * blocks fail closed for an agent to merge.
 */
export function mergeManagedBlock(
  existing: string,
  managed: string,
  options: { start?: string; end?: string; legacyMarkers?: string[] } = {},
): ManagedBlockResult {
  const inferred = managedMarkers(managed);
  const start = options.start ?? inferred.start;
  const end = options.end ?? inferred.end;
  const block = normalizeManagedBlock(managed, start, end);
  const starts = occurrences(existing, start);
  const ends = occurrences(existing, end);

  if (starts.length === 0 && ends.length === 0) {
    const legacy = options.legacyMarkers?.find((marker) => existing.includes(marker));
    if (legacy) {
      return {
        status: "needs-merge",
        content: existing,
        action: "conflict",
        reason: `legacy wiki-ssot content contains ${legacy}; reconcile it into the managed block once`,
      };
    }
    const separator = existing.length === 0 || existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
    return { status: "ready", content: `${existing}${separator}${block}\n`, action: "append" };
  }
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
    return {
      status: "needs-merge",
      content: existing,
      action: "conflict",
      reason: "managed block markers are missing, duplicated, or out of order",
    };
  }
  const afterEnd = ends[0] + end.length;
  const replacement = `${existing.slice(0, starts[0])}${block}${existing.slice(afterEnd)}`;
  return {
    status: "ready",
    content: replacement,
    action: replacement === existing ? "unchanged" : "replace",
  };
}

function firstVersion(range: string): { major: number; minor: number; patch: number } | undefined {
  const match = range.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function dependencyRangesCompatible(local: string, incoming: string): boolean {
  if (local === incoming) return true;
  const left = firstVersion(local);
  const right = firstVersion(incoming);
  if (!left || !right || left.major !== right.major) return false;
  // The kit dependencies use caret-compatible ranges. Preserve a host range
  // whose minimum is at least the toolkit minimum within the same major.
  return left.minor > right.minor || (left.minor === right.minor && left.patch >= right.patch);
}

/** Merge the package fragment without taking ownership of host lifecycle scripts. */
export function mergePackageJson(host: unknown, toolkit: unknown): PackageMergeResult {
  const local = host != null && typeof host === "object" && !Array.isArray(host)
    ? structuredClone(host as Record<string, unknown>)
    : {};
  const incoming = toolkit != null && typeof toolkit === "object" && !Array.isArray(toolkit)
    ? toolkit as Record<string, unknown>
    : {};
  const localScripts = local.scripts != null && typeof local.scripts === "object" && !Array.isArray(local.scripts)
    ? { ...(local.scripts as Record<string, string>) }
    : {};
  const incomingScripts = incoming.scripts != null && typeof incoming.scripts === "object" && !Array.isArray(incoming.scripts)
    ? incoming.scripts as Record<string, string>
    : {};
  for (const [name, value] of Object.entries(incomingScripts)) {
    if (name.startsWith("wiki:")) localScripts[name] = value;
  }
  local.scripts = localScripts;

  const localDependencies = local.devDependencies != null && typeof local.devDependencies === "object" && !Array.isArray(local.devDependencies)
    ? { ...(local.devDependencies as Record<string, string>) }
    : {};
  const incomingDependencies = incoming.devDependencies != null && typeof incoming.devDependencies === "object" && !Array.isArray(incoming.devDependencies)
    ? incoming.devDependencies as Record<string, string>
    : {};
  const conflicts: string[] = [];
  for (const [name, value] of Object.entries(incomingDependencies)) {
    const current = localDependencies[name];
    if (current == null) localDependencies[name] = value;
    else if (!dependencyRangesCompatible(current, value)) conflicts.push(`devDependencies.${name}`);
  }
  local.devDependencies = localDependencies;

  const incomingEngines = incoming.engines != null && typeof incoming.engines === "object" && !Array.isArray(incoming.engines)
    ? incoming.engines as Record<string, string>
    : {};
  const localEngines = local.engines != null && typeof local.engines === "object" && !Array.isArray(local.engines)
    ? { ...(local.engines as Record<string, string>) }
    : {};
  if (localEngines.bun == null && incomingEngines.bun != null) localEngines.bun = incomingEngines.bun;
  else if (localEngines.bun != null && incomingEngines.bun != null
    && !dependencyRangesCompatible(localEngines.bun, incomingEngines.bun)) conflicts.push("engines.bun");
  if (Object.keys(localEngines).length > 0) local.engines = localEngines;
  const changed = JSON.stringify(local) !== JSON.stringify(host ?? {});
  return { status: conflicts.length === 0 ? "ready" : "needs-merge", packageJson: local, conflicts, changed };
}

function git(repo: string, args: string[], allowFailure = false): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    if (allowFailure) return "";
    throw new Error(result.stderr.toString().trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.toString();
}

function hasHead(repo: string): boolean {
  return git(repo, ["rev-parse", "--verify", "HEAD^{commit}"], true).trim().length > 0;
}

export function detectApplyMode(repo: string): ApplyMode {
  if (existsSync(join(repo, MANIFEST_TARGET))
    || existsSync(join(repo, "scripts/wiki/cli.ts"))
    || (existsSync(join(repo, "AGENTS.md")) && readFileSync(join(repo, "AGENTS.md"), "utf8").includes("wiki-ssot:"))) {
    return "upgrade";
  }
  return hasHead(repo) ? "adopt" : "new";
}

function defaultKitRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "kit");
}

function ensureInside(repo: string, path: string): string {
  const root = realpathSync(repo);
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`managed target escapes repository: ${path}`);
  let ancestor = dirname(target);
  while (!existsSync(ancestor) && ancestor !== dirname(ancestor)) ancestor = dirname(ancestor);
  const ancestorRel = relative(root, realpathSync(ancestor));
  if (ancestorRel.startsWith("..") || isAbsolute(ancestorRel)) throw new Error(`managed target resolves outside repository: ${path}`);
  return target;
}

function write(path: string, content: string): void {
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`refusing to write through symlink: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function readJson(path: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (!existsSync(path)) return fallback;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${path} must contain a JSON object`);
  return parsed as Record<string, unknown>;
}

export function commandEnvironment(
  base: Record<string, string | undefined>,
  disableHusky: boolean,
): Record<string, string | undefined> {
  const env = { ...base };
  if (disableHusky) env.HUSKY = "0";
  else delete env.HUSKY;
  return env;
}

function command(
  repo: string,
  args: string[],
  options: { disableHusky?: boolean } = {},
): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(args, {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
    env: commandEnvironment(process.env, options.disableHusky ?? true),
  });
  return { ok: result.exitCode === 0, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

/**
 * The generated source map contains only parsed `status: current` pages and
 * only their declared source evidence. A non-empty result therefore proves
 * that bootstrap has crossed the minimum semantic boundary; lint separately
 * proves that the declared sources resolve.
 */
export function currentPageIdsFromSourceMap(value: unknown): string[] {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return [];
  const map = value as { exact?: unknown; globs?: unknown };
  const ids = new Set<string>();
  if (map.exact != null && typeof map.exact === "object" && !Array.isArray(map.exact)) {
    for (const pages of Object.values(map.exact as Record<string, unknown>)) {
      if (Array.isArray(pages)) for (const id of pages) if (typeof id === "string" && id.length > 0) ids.add(id);
    }
  }
  if (Array.isArray(map.globs)) {
    for (const item of map.globs) {
      if (item == null || typeof item !== "object" || Array.isArray(item)) continue;
      const pages = (item as { pages?: unknown }).pages;
      if (Array.isArray(pages)) for (const id of pages) if (typeof id === "string" && id.length > 0) ids.add(id);
    }
  }
  return [...ids].sort();
}

function findingObjects(raw: string): { code?: string; path?: string; message?: string }[] {
  try {
    const parsed = JSON.parse(raw) as { findings?: { code?: string; path?: string; message?: string }[] };
    return parsed.findings ?? [];
  } catch {
    return [];
  }
}

function managedEntries(manifest: ApplyKitManifest): [string, ManagedManifestEntry][] {
  return Object.entries(manifest.managed ?? {}).sort(([a], [b]) => a.localeCompare(b));
}

function kitReference(kitRoot: string, manifest: ApplyKitManifest, target: string): string {
  const path = join(kitRoot, target);
  if (!existsSync(path)) throw new Error(`kit reference entry is missing: ${target}`);
  const content = readFileSync(path, "utf8");
  if (manifest.reference?.[target] !== sha256(content)) throw new Error(`kit reference entry hash does not match manifest: ${target}`);
  return content;
}

function containsLegacyWikiJobs(content: string): boolean {
  return /^ {2}wiki-[A-Za-z0-9_-]+:\s*(?:#.*)?$/m.test(content);
}

export function planApply(options: ApplyOptions): { mode: ApplyMode; sync: SyncPlan; manifest: ApplyKitManifest } {
  const repo = resolve(options.into);
  const kitRoot = resolve(options.kit ?? defaultKitRoot());
  const manifest = readJson(join(kitRoot, "files", MANIFEST_TARGET)) as ApplyKitManifest;
  return { mode: detectApplyMode(repo), sync: planSync(kitRoot, repo, options.accept ?? []), manifest };
}

export async function applyProject(options: ApplyOptions): Promise<ApplyReport> {
  const repo = resolve(options.into);
  const kitRoot = resolve(options.kit ?? defaultKitRoot());
  if (!existsSync(repo) || !statSync(repo).isDirectory()) throw new Error(`target is not a directory: ${repo}`);
  if (git(repo, ["rev-parse", "--git-dir"], true).trim().length === 0) throw new Error(`target must be an initialized Git repository: ${repo}`);

  const mode = detectApplyMode(repo);
  const previousManifest = readManifest(join(repo, MANIFEST_TARGET));
  const plan = planSync(kitRoot, repo, options.accept ?? []);
  const incomingManifest = readJson(join(kitRoot, "files", MANIFEST_TARGET)) as ApplyKitManifest;
  const nextCommand = `bun ${resolve(dirname(fileURLToPath(import.meta.url)), "apply.ts")} --into ${repo}`;
  const conflicts: { path: string; reason: string }[] = plan.conflicts.map((path) => ({ path, reason: "kit-owned file changed locally and upstream" }));
  const addConflict = (path: string, reason: string): void => {
    if (!conflicts.some((item) => item.path === path && item.reason === reason)) conflicts.push({ path, reason });
  };
  const applied: string[] = [];
  const checks: Record<string, "pass" | "fail" | "skipped"> = {};
  const findings: ApplyFinding[] = [];

  const legacyWorkflow = ".github/workflows/checks.yml";
  const legacyEntry = previousManifest?.files?.[legacyWorkflow];
  const legacyPath = join(repo, legacyWorkflow);
  const removedLegacy = plan.entries.some((entry) => entry.target === legacyWorkflow && entry.action === "removed-upstream");
  const acceptedLegacy = options.accept?.includes(legacyWorkflow) ?? false;
  const legacyContent = removedLegacy && legacyEntry != null && existsSync(legacyPath)
    ? readFileSync(legacyPath, "utf8")
    : undefined;
  const customizedLegacy = removedLegacy && legacyEntry != null && existsSync(legacyPath)
    && sha256(legacyContent!) !== legacyEntry.sha256;
  const knownV1CombinedWorkflow = removedLegacy
    ? kitReference(kitRoot, incomingManifest, "migrations/v1/checks.yml")
    : undefined;
  const knownV1Pristine = legacyContent != null && legacyContent === knownV1CombinedWorkflow;
  const manualLegacyMerge = legacyContent != null && !knownV1Pristine
    && (containsLegacyWikiJobs(legacyContent) || (customizedLegacy && !acceptedLegacy));
  if (manualLegacyMerge) {
    addConflict(legacyWorkflow, containsLegacyWikiJobs(legacyContent!)
      ? "legacy workflow must retain host jobs and remove duplicate Wiki jobs before it can be accepted"
      : "customized legacy workflow must be explicitly accepted after preserving its host jobs");
    plan.nextManifest.files[legacyWorkflow] = legacyEntry!;
  }

  const previewChanges = plan.entries
    .filter((entry) => !["unchanged", "seed-present", "customized"].includes(entry.action))
    .map((entry) => entry.target);
  for (const [target, meta] of managedEntries(incomingManifest)) {
    const source = join(kitRoot, "managed", target);
    if (!existsSync(source)) throw new Error(`kit managed entry is missing: ${target}`);
    const incoming = readFileSync(source, "utf8");
    if (sha256(incoming) !== meta.sha256) throw new Error(`kit managed entry hash does not match manifest: ${target}`);
    const local = ensureInside(repo, target);
    const localStat = lstatSync(local, { throwIfNoEntry: false });
    const exists = localStat != null;
    if (localStat?.isSymbolicLink()) {
      addConflict(target, "managed integration target is a symlink");
      continue;
    }
    const existing = exists ? readFileSync(local, "utf8") : target.startsWith(".husky/") ? "#!/usr/bin/env sh\n" : "";
    const recorded = previousManifest?.files?.[target];
    const pristineLegacy = recorded != null && sha256(existing) === recorded.sha256;
    const merged = pristineLegacy
      ? { status: "ready" as const, content: target.startsWith(".husky/") ? `#!/usr/bin/env sh\n${incoming}` : incoming, action: existing === incoming ? "unchanged" as const : "replace" as const }
      : mergeManagedBlock(existing, incoming, { start: meta.start, end: meta.end, legacyMarkers: meta.legacyMarkers });
    if (merged.status === "needs-merge") addConflict(target, merged.reason ?? "managed integration block requires reconciliation");
    else if (merged.action !== "unchanged" || (target.startsWith(".husky/") && exists && (statSync(local).mode & 0o111) === 0)) previewChanges.push(target);
  }
  const packagePath = join(repo, "package.json");
  const packageFragmentPath = join(kitRoot, "package.kit.json");
  const packageMerge = mergePackageJson(readJson(packagePath), readJson(packageFragmentPath));
  if (packageMerge.changed) previewChanges.push("package.json");
  for (const path of packageMerge.conflicts) addConflict(`package.json#${path}`, "host value is incompatible with the toolkit minimum");

  if (options.dryRun) {
    return {
      version: 1,
      mode,
      status: conflicts.length === 0 ? "ready" : "needs-merge",
      dryRun: true,
      kitDigest: plan.digest,
      applied,
      changes: [...new Set(previewChanges)].sort(),
      conflicts,
      findings,
      checks,
      nextCommand,
    };
  }

  applied.push(...applySync(kitRoot, repo, plan));

  // The exact version 1 workflow bundled host code checks and Wiki jobs. Split
  // that known payload automatically: retain the host-only workflow in place
  // and let the new dedicated workflow own Wiki checks. Unknown/custom legacy
  // workflows are never deleted; their host form must be reconciled explicitly.
  if (knownV1Pristine && existsSync(legacyPath)) {
    const hostWorkflow = kitReference(kitRoot, incomingManifest, "migrations/v1/host-checks.yml");
    if (readFileSync(legacyPath, "utf8") !== hostWorkflow) write(legacyPath, hostWorkflow);
    applied.push(legacyWorkflow);
  }

  for (const [target, meta] of managedEntries(incomingManifest)) {
    const source = join(kitRoot, "managed", target);
    if (!existsSync(source)) throw new Error(`kit managed entry is missing: ${target}`);
    const incoming = readFileSync(source, "utf8");
    const local = ensureInside(repo, target);
    const localStat = lstatSync(local, { throwIfNoEntry: false });
    const exists = localStat != null;
    if (localStat?.isSymbolicLink()) {
      addConflict(target, "managed integration target is a symlink");
      continue;
    }
    const existing = exists ? readFileSync(local, "utf8") : target.startsWith(".husky/") ? "#!/usr/bin/env sh\n" : "";
    const recorded = previousManifest?.files?.[target];
    const pristineLegacy = recorded != null && sha256(existing) === recorded.sha256;
    const legacyReplacement = target.startsWith(".husky/") ? `#!/usr/bin/env sh\n${incoming}` : incoming;
    const merged = pristineLegacy
      ? { status: "ready" as const, content: legacyReplacement, action: existing === legacyReplacement ? "unchanged" as const : "replace" as const }
      : mergeManagedBlock(existing, incoming, { start: meta.start, end: meta.end, legacyMarkers: meta.legacyMarkers });
    if (merged.status === "needs-merge") {
      addConflict(target, merged.reason ?? "managed integration block requires reconciliation");
      continue;
    }
    const needsExecutableMode = target.startsWith(".husky/") && exists && (statSync(local).mode & 0o111) === 0;
    if (merged.action !== "unchanged" || needsExecutableMode) {
      if (merged.action !== "unchanged") write(local, merged.content);
      if (target.startsWith(".husky/")) chmodSync(local, 0o755);
      applied.push(target);
    }
  }

  if (packageMerge.changed) {
    write(packagePath, `${JSON.stringify(packageMerge.packageJson, null, 2)}\n`);
    applied.push("package.json");
  }
  if (conflicts.length > 0) {
    for (const name of ["install", "hooks", "generated", "doctor", "lint", "audit", "tooling-typecheck", "tooling-test"]) checks[name] = "skipped";
    return {
      version: 1,
      mode,
      status: "needs-merge",
      dryRun: false,
      kitDigest: plan.digest,
      applied: [...new Set(applied)].sort(),
      changes: [...new Set(applied)].sort(),
      conflicts,
      findings,
      checks,
      nextCommand,
    };
  }

  if (!options.skipInstall) {
    const install = command(repo, ["bun", "install"]);
    checks.install = install.ok ? "pass" : "fail";
    if (!install.ok) {
      findings.push({ code: "dependency-install-failed", path: "package.json", action: install.stderr.trim() || "rerun bun install" });
      return {
        version: 1, mode, status: "failed", dryRun: false, kitDigest: plan.digest,
        applied: [...new Set(applied)].sort(), changes: [...new Set(applied)].sort(), conflicts, findings, checks, nextCommand,
      };
    }
    const hooks = command(repo, ["bun", "run", "wiki:hooks:install"], { disableHusky: false });
    checks.hooks = hooks.ok ? "pass" : "fail";
    if (!hooks.ok) findings.push({ code: "hook-install-failed", path: ".husky/", action: hooks.stderr.trim() || hooks.stdout.trim() || "rerun bun run wiki:hooks:install" });
  } else {
    checks.install = "skipped";
    checks.hooks = "skipped";
  }

  const generated = command(repo, ["bun", "scripts/wiki/cli.ts", "generated"]);
  checks.generated = generated.ok ? "pass" : "fail";
  const checkCommands: [string, string[]][] = [
    ["doctor", ["bun", "scripts/wiki/cli.ts", "doctor", "--json"]],
    ["lint", ["bun", "scripts/wiki/cli.ts", "lint", "--json"]],
    ["audit", ["bun", "scripts/wiki/cli.ts", "audit", "--json"]],
    ["tooling-typecheck", ["bun", "run", "wiki:tooling:typecheck"]],
    ["tooling-test", ["bun", "run", "wiki:tooling:test"]],
  ];
  for (const [name, args] of checkCommands) {
    const result = command(repo, args);
    checks[name] = result.ok ? "pass" : "fail";
    if (!result.ok) {
      const structured = findingObjects(result.stdout);
      if (structured.length > 0) {
        for (const item of structured) findings.push({
          code: item.code ?? `${name}-failed`,
          path: item.path,
          action: item.message ?? `reconcile ${name} failure`,
        });
      } else findings.push({ code: `${name}-failed`, action: result.stderr.trim() || result.stdout.trim() || `rerun ${args.join(" ")}` });
    }
  }

  const coverage = readJson(join(repo, ".wiki/coverage.json"), { version: 1, include: [], exclusions: [] });
  const include = Array.isArray(coverage.include) ? coverage.include : [];
  const sourceMap = readJson(join(repo, ".wiki/source-map.json"), { version: 1, exact: {}, globs: [] });
  if (currentPageIdsFromSourceMap(sourceMap).length === 0) {
    findings.push({ code: "bootstrap-current-page-required", path: "wiki/", action: "inspect the project and create at least one source-backed status: current page" });
  }
  if (include.length === 0) {
    findings.push({ code: "bootstrap-coverage-required", path: ".wiki/coverage.json", action: "select the maintained implementation globs and map or reason-exclude every matched file" });
  }
  if (!generated.ok) findings.push({ code: "generated-failed", action: generated.stderr.trim() || generated.stdout.trim() || "rerun wiki:generated" });

  const status: ApplyStatus = findings.length === 0 && Object.values(checks).every((value) => value !== "fail") ? "ready" : "needs-reconcile";
  return {
    version: 1,
    mode,
    status,
    dryRun: false,
    kitDigest: plan.digest,
    applied: [...new Set(applied)].sort(),
    changes: [...new Set(applied)].sort(),
    conflicts,
    findings,
    checks,
    nextCommand,
  };
}

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function flags(argv: string[], name: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) if (argv[index] === `--${name}` && argv[index + 1]) result.push(argv[index + 1]);
  return result;
}

function printReport(report: ApplyReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`wiki-ssot ${report.mode}: ${report.status} (kit ${report.kitDigest.slice(0, 12)})`);
  if (report.applied.length > 0) console.log(`applied: ${report.applied.join(", ")}`);
  for (const conflict of report.conflicts) console.log(`merge: ${conflict.path} — ${conflict.reason}`);
  for (const finding of report.findings) console.log(`reconcile: ${finding.code}${finding.path ? ` (${finding.path})` : ""} — ${finding.action}`);
  if (report.status !== "ready") console.log(`rerun: ${report.nextCommand}`);
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  const into = flag(argv, "into");
  if (!into) throw new Error("usage: bun scripts/wiki/apply.ts --into <git-repo> [--kit <dir>] [--dry-run] [--json] [--skip-install] [--accept <path>]...");
  const report = await applyProject({
    into,
    kit: flag(argv, "kit"),
    dryRun: argv.includes("--dry-run"),
    json: argv.includes("--json"),
    skipInstall: argv.includes("--skip-install"),
    accept: flags(argv, "accept"),
  });
  printReport(report, argv.includes("--json"));
  process.exitCode = report.status === "ready" ? 0 : report.status === "failed" ? 2 : 1;
}

if (import.meta.main) {
  try { await main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
