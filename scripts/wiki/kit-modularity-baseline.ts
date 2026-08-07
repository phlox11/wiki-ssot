#!/usr/bin/env bun

/**
 * KM-00 is a publisher-only, deterministic inventory.  It freezes the
 * portable kit before any modules are moved.  It intentionally performs no
 * model/provider work and keeps command samples in a disposable checkout.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import type { KitEntry, RepoView } from "./core";

export const KIT_MODULARITY_BASELINE_REVISION =
  "2f8629fdd37bbd4001ffc07e65964fcead1d16d4" as const;
export const KM00_BASELINE_REVISION = KIT_MODULARITY_BASELINE_REVISION;
export const KIT_MODULARITY_COUPLING_REVISION =
  "6f6298cf9174338d71fee66e6a20ce8db7ed2c84" as const;
export const KM00_COUPLING_REVISION = KIT_MODULARITY_COUPLING_REVISION;

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const DEFAULT_JSON_PATH = join(PROJECT_ROOT, "docs/evidence/km-00-portable-kit-baseline.json");
const DEFAULT_MARKDOWN_PATH = join(PROJECT_ROOT, "docs/evidence/km-00-portable-kit-baseline.md");
const MANIFEST_PATH = "kit/files/.wiki/kit-manifest.json";

const KIT_TYPE_SCRIPT_PATHS = [
  "scripts/wiki/core.ts",
  "scripts/wiki/cli.ts",
  "scripts/wiki/github-attestation.ts",
  "scripts/wiki/wiki.test.ts",
  "scripts/wiki/work.test.ts",
  "scripts/wiki/fresh-context.test.ts",
  "scripts/wiki/test-runner.ts",
] as const;
const SPLIT_TARGETS = [
  "scripts/wiki/core.ts",
  "scripts/wiki/fresh-context.test.ts",
  "scripts/wiki/cli.ts",
  "scripts/wiki/work.test.ts",
  "scripts/wiki/wiki.test.ts",
] as const;
const FALLBACK_PUBLIC_COMMANDS = [
  "lint", "inventory", "index", "generated", "kit", "work", "search", "conflicts", "context",
  "impact", "verify", "review-preflight", "review-bundle", "review-check", "doctor", "check", "audit",
] as const;

export const KIT_MODULARITY_EXPECTED = {
  copiedTooling: { lines: 9852, bytes: 521482 },
  typeScript: { lines: 9834, bytes: 521052 },
  splitTargets: { lines: 9598, bytes: 509272, share: 0.9765859607810049 },
  modules: {
    "scripts/wiki/core.ts": { lines: 4144, bytes: 230066 },
    "scripts/wiki/fresh-context.test.ts": { lines: 2400, bytes: 126643 },
    "scripts/wiki/cli.ts": { lines: 1277, bytes: 58274 },
    "scripts/wiki/work.test.ts": { lines: 1032, bytes: 52621 },
    "scripts/wiki/wiki.test.ts": { lines: 745, bytes: 41668 },
  },
} as const;

type Metric = { lines: number; bytes: number };
export type ImportEdge = {
  from: string;
  specifier: string;
  resolved: string | null;
  kind: "import" | "export";
  typeOnly: boolean;
  names: string[];
};
export type ExportSymbol = {
  name: string;
  kind: "value" | "type" | "both";
  declarationKinds: string[];
  typeOnly: boolean;
};
export type ModuleSurface = {
  path: string;
  metric: Metric;
  exports: ExportSymbol[];
  imports: ImportEdge[];
};
export type CliFixture = {
  id: string;
  command: string[];
  format: "json" | "text" | "usage";
  writes: boolean;
  disposableClone: boolean;
  exitCode: number;
  stdout: { bytes: number; sha256: string; headings: string[]; fields: string[] };
  stderr: { bytes: number; sha256: string; headings: string[]; fields: string[] };
};

export type KitModularityBaselineReport = {
  reportVersion: 1;
  contractVersion: 1;
  kind: "km-00-portable-kit-baseline";
  exactRevision: typeof KIT_MODULARITY_BASELINE_REVISION;
  method: {
    modelCalls: 0;
    providerCalls: 0;
    sourceEncoding: "UTF-8";
    lineDefinition: string;
    importExportMethod: string;
    changeCouplingMethod: string;
    revisionCheckout: string;
    writeGuard: string;
  };
  kit: {
    entries: Array<Record<string, unknown>>;
    entriesDigest: string;
    ownedEntries: string[];
    manifest: Record<string, unknown>;
    manifestDigest: string;
    generatedPaths: string[];
    fileHashes: Record<string, string>;
  };
  modules: {
    paths: string[];
    files: Record<string, ModuleSurface>;
    importEdges: ImportEdge[];
    callerBindings: Array<ImportEdge & { callerKind: "shipped" | "publishing-only" }>;
    totals: Metric;
    typeScriptTotals: Metric;
  };
  cli: {
    commands: string[];
    commandCount: number;
    globalFlags: string[];
    selectors: Record<string, string[]>;
    writeCommands: string[];
    contract: Record<string, unknown>;
    fixtures: CliFixture[];
    fixtureDigest: string;
  };
  tests: {
    suites: Record<string, { testCount: number; describeCount: number; shipped: boolean }>;
    discovered: string[];
    discoveredExactlyOnce: boolean;
    boundaries: Record<string, string[]>;
  };
  lifecycle: Record<string, unknown>;
  screen: Record<string, unknown>;
  sequencing: Record<string, unknown>;
  summary: {
    copiedToolingLines: number;
    copiedToolingBytes: number;
    typeScriptLines: number;
    typeScriptBytes: number;
    splitTargetLines: number;
    splitTargetBytes: number;
    splitTargetShare: number;
    manifestDigest: string;
  };
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function metric(value: string | Uint8Array): Metric {
  const source = typeof value === "string" ? value : Buffer.from(value).toString("utf8");
  return { lines: (source.match(/\n/g) ?? []).length, bytes: Buffer.byteLength(source, "utf8") };
}
function jsonStable(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input != null && typeof input === "object") {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sort(item)]));
    }
    return input;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}
function sorted<T>(values: Iterable<T>, compare = (a: T, b: T) => String(a).localeCompare(String(b))): T[] {
  return [...values].sort(compare);
}
function git(root: string, args: string[], allowFailure = false): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    if (allowFailure) return "";
    throw new Error(result.stderr.toString().trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.toString();
}
function rawBlob(root: string, revision: string, path: string): string {
  return git(root, ["show", `${revision}:${path}`]);
}
function normalize(root: string, path: string): string {
  const rel = relative(root, path).replaceAll("\\", "/");
  return rel.startsWith("../") || rel === ".." ? path.replaceAll("\\", "/") : rel;
}

type PinnedCore = Pick<
  typeof import("./core"),
  | "KIT_ENTRIES"
  | "createRepoView"
  | "generatedCoreFiles"
  | "jsonStable"
  | "kitFiles"
  | "loadWikiPages"
  | "readConfig"
>;

type PinnedInventories = Pick<typeof import("./inventories"), "generateInventories">;

function loadPinnedModules(root: string): { core: PinnedCore; inventories: PinnedInventories } {
  // The harness itself is deliberately current, but every engine function used
  // to measure KM-00 must be loaded from the detached baseline checkout. The
  // unique temporary path also prevents an ESM module cache entry from being
  // shared with a different revision in the same process.
  const core = require(join(root, "scripts/wiki/core.ts")) as PinnedCore;
  const inventories = require(join(root, "scripts/wiki/inventories.ts")) as PinnedInventories;
  return { core, inventories };
}

export function compilerSurface(root: string, paths: string[]): { files: Record<string, ModuleSurface>; edges: ImportEdge[] } {
  const absolute = paths.map((path) => join(root, path));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
  };
  const program = ts.createProgram(absolute, options);
  const checker = program.getTypeChecker();
  const files: Record<string, ModuleSurface> = {};
  const edges: ImportEdge[] = [];
  const resolveSpecifier = (from: string, specifier: string): string | null => {
    const resolved = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule?.resolvedFileName;
    if (!resolved) return null;
    const relativeResolved = relative(root, resolved).replaceAll("\\", "/");
    if (relativeResolved.startsWith("../") || relativeResolved === ".." || relativeResolved.startsWith("/")) return null;
    return normalize(root, resolved);
  };
  const namesFrom = (node: ts.ImportDeclaration | ts.ExportDeclaration): { typeOnly: boolean; names: string[] } => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (!clause) return { typeOnly: false, names: ["*"] };
      const names: string[] = [];
      if (clause.name) names.push("default");
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.push("*");
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) names.push(element.propertyName?.text ?? element.name.text);
        const allTypeOnly = clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly);
        return { typeOnly: clause.isTypeOnly || allTypeOnly, names };
      }
      return { typeOnly: clause.isTypeOnly, names };
    }
    const names: string[] = [];
    if (!node.exportClause) return { typeOnly: node.isTypeOnly, names: ["*"] };
    if (ts.isNamespaceExport(node.exportClause)) names.push("*");
    else {
      for (const element of node.exportClause.elements) names.push(element.propertyName?.text ?? element.name.text);
      const allTypeOnly = node.exportClause.elements.length > 0 && node.exportClause.elements.every((element) => element.isTypeOnly);
      return { typeOnly: node.isTypeOnly || allTypeOnly, names };
    }
    return { typeOnly: node.isTypeOnly, names };
  };
  const exportTypeOnly = new Set<string>();
  for (const sourcePath of absolute) {
    const source = program.getSourceFile(sourcePath);
    if (!source) continue;
    const relativePath = normalize(root, sourcePath);
    const symbol = checker.getSymbolAtLocation(source);
    const exports: ExportSymbol[] = [];
    for (const item of symbol ? checker.getExportsOfModule(symbol) : []) {
      const declarations = item.getDeclarations() ?? [];
      const declarationKinds = sorted(new Set(declarations.map((declaration) => ts.SyntaxKind[declaration.kind])));
      // Re-exported aliases carry the `Alias` flag even when their target is a
      // runtime value. Resolve the alias before classifying value/type surfaces;
      // otherwise `export { value } from ...` is incorrectly reported as a
      // type-only export.
      let target = item;
      if ((item.flags & ts.SymbolFlags.Alias) !== 0) {
        try { target = checker.getAliasedSymbol(item); } catch { /* unresolved alias remains classified from its own flags */ }
      }
      const flags = target.flags;
      const isValue = (flags & (ts.SymbolFlags.Value | ts.SymbolFlags.Namespace)) !== 0;
      const isType = (flags & ts.SymbolFlags.Type) !== 0;
      exports.push({
        name: item.name,
        kind: isValue && isType ? "both" : isValue ? "value" : "type",
        declarationKinds,
        typeOnly: !isValue,
      });
    }
    const imports: ImportEdge[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const info = namesFrom(node);
        const edge = { from: relativePath, specifier: node.moduleSpecifier.text, resolved: resolveSpecifier(sourcePath, node.moduleSpecifier.text), kind: "import" as const, typeOnly: info.typeOnly, names: sorted(info.names) };
        imports.push(edge); edges.push(edge);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const info = namesFrom(node);
        const edge = { from: relativePath, specifier: node.moduleSpecifier.text, resolved: resolveSpecifier(sourcePath, node.moduleSpecifier.text), kind: "export" as const, typeOnly: info.typeOnly, names: sorted(info.names) };
        imports.push(edge); edges.push(edge);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    files[relativePath] = { path: relativePath, metric: metric(readFileSync(sourcePath)), exports: sorted(exports, (a, b) => a.name.localeCompare(b.name)), imports: sorted(imports, (a, b) => `${a.specifier}:${a.kind}`.localeCompare(`${b.specifier}:${b.kind}`)) };
  }
  return { files, edges: sorted(edges, (a, b) => `${a.from}:${a.specifier}:${a.kind}:${a.names.join(",")}`.localeCompare(`${b.from}:${b.specifier}:${b.kind}:${b.names.join(",")}`)) };
}

function fields(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    const result: string[] = [];
    const visit = (node: unknown, path: string): void => {
      if (Array.isArray(node)) { result.push(`${path}[]`); if (node[0] !== undefined) visit(node[0], `${path}[]`); return; }
      if (!node || typeof node !== "object") return;
      for (const [key, child] of Object.entries(node)) { const next = path ? `${path}.${key}` : key; result.push(next); visit(child, next); }
    };
    visit(parsed, "");
    return sorted(new Set(result));
  } catch { return []; }
}
function headings(value: string): string[] {
  return value.split(/\r?\n/).filter((line) => /^#{1,6} |^[A-Z][A-Z _-]+(?: \(|$)/.test(line)).map((line) => line.trim()).slice(0, 32);
}
function fixture(id: string, command: string[], format: CliFixture["format"], writes: boolean, result: { exitCode: number; stdout: string; stderr: string }): CliFixture {
  return {
    id, command, format, writes, disposableClone: true, exitCode: result.exitCode,
    stdout: { bytes: Buffer.byteLength(result.stdout), sha256: sha256(result.stdout), headings: headings(result.stdout), fields: fields(result.stdout) },
    stderr: { bytes: Buffer.byteLength(result.stderr), sha256: sha256(result.stderr), headings: headings(result.stderr), fields: fields(result.stderr) },
  };
}
function cleanEnv(): Record<string, string> {
  const blocked = /^(?:CI|GITHUB_|WIKI_PR_|WIKI_REVIEWER_|BUILDKITE_|JENKINS_)/;
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !blocked.test(key))) as Record<string, string>;
}
function run(root: string, command: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(command, { cwd: root, env: cleanEnv(), stdout: "pipe", stderr: "pipe" });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
function disposableCheckout(root: string, revision: string): { root: string; cleanup: () => void } {
  const temporary = mkdtempSync(join(tmpdir(), "wiki-ssot-km00-"));
  const checkout = join(temporary, "repo");
  const cloned = run(root, ["git", "clone", "--quiet", "--shared", "--no-checkout", root, checkout]);
  if (cloned.exitCode !== 0) throw new Error(cloned.stderr || cloned.stdout);
  const checked = run(checkout, ["git", "checkout", "--quiet", "--detach", revision]);
  if (checked.exitCode !== 0) throw new Error(checked.stderr || checked.stdout);
  const modules = join(PROJECT_ROOT, "node_modules");
  if (existsSync(modules)) symlinkSync(modules, join(checkout, "node_modules"), "dir");
  return { root: checkout, cleanup: () => rmSync(temporary, { recursive: true, force: true }) };
}

type CliCatalog = {
  commands: string[];
  packageScripts: string[];
  packageOnlyScripts: string[];
};

function cliCatalog(root: string): CliCatalog {
  const source = readFileSync(join(root, "scripts/wiki/cli.ts"), "utf8");
  const match = source.match(/usage:\s+bun scripts\/wiki\/cli\.ts <([^>]+)>/);
  // Preserve the command order in the pinned usage string: it is the public
  // help/catalog order, while paths and fields elsewhere remain sorted.
  const commands = [...new Set((match?.[1] ?? FALLBACK_PUBLIC_COMMANDS.join("|"))
    .split("|")
    .map((command) => command.trim())
    .filter(Boolean))];
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts?: Record<string, unknown> };
  const packageScripts = sorted(Object.keys(packageJson.scripts ?? {}).filter((name) => name.startsWith("wiki:")));
  const packageOnlyScripts = packageScripts.filter((name) => !commands.includes(name.slice("wiki:".length)));
  return { commands, packageScripts, packageOnlyScripts };
}

function commandFixtures(root: string, revision: string): CliFixture[] {
  const clone = disposableCheckout(root, revision);
  const temporary = dirname(clone.root);
  const metadata = join(temporary, "km00-pr-body.md");
  writeFileSync(metadata, readFileSync(join(clone.root, ".github/pull_request_template.md"), "utf8"), "utf8");
  const specs: Array<[string, string[], CliFixture["format"], boolean]> = [
    ["lint-json", ["scripts/wiki/cli.ts", "lint", "--json"], "json", false],
    ["work-json", ["scripts/wiki/cli.ts", "work", "--json"], "json", false],
    ["context-work-json", ["scripts/wiki/cli.ts", "context", "--work", "KM-00", "--json"], "json", false],
    ["generated-write-json", ["scripts/wiki/cli.ts", "generated", "--json"], "json", true],
    ["generated-check-json", ["scripts/wiki/cli.ts", "generated", "--check", "--json"], "json", false],
    ["kit-write-json", ["scripts/wiki/cli.ts", "kit", "--json"], "json", true],
    ["kit-check-json", ["scripts/wiki/cli.ts", "kit", "--check", "--json"], "json", false],
    ["review-check-json", ["scripts/wiki/cli.ts", "review-check", "--base", revision, "--metadata", metadata, "--json"], "json", false],
    ["work-help", ["scripts/wiki/cli.ts", "work", "--help"], "text", false],
    ["usage-error", ["scripts/wiki/cli.ts", "unknown-command"], "usage", false],
  ];
  try {
    return specs.map(([id, args, format, writes]) => {
      const stableArgs = args.map((arg) => arg === metadata ? "<temporary>/km00-pr-body.md" : arg);
      return fixture(id, stableArgs, format, writes, run(clone.root, [process.execPath, ...args]));
    });
  }
  finally { clone.cleanup(); }
}

function suiteInventory(root: string, files: Record<string, ModuleSurface>): KitModularityBaselineReport["tests"] {
  const discovered = readdirSync(join(root, "scripts/wiki"), { withFileTypes: true }).filter((item) => item.isFile() && item.name.endsWith(".test.ts")).map((item) => `scripts/wiki/${item.name}`).sort();
  const suites: Record<string, { testCount: number; describeCount: number; shipped: boolean }> = {};
  for (const path of discovered) {
    const source = ts.createSourceFile(path, readFileSync(join(root, path), "utf8"), ts.ScriptTarget.Latest, true);
    let testCount = 0; let describeCount = 0;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["test", "it"].includes(node.expression.text)) testCount += 1;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "describe") describeCount += 1;
      ts.forEachChild(node, visit);
    }; visit(source);
    suites[path] = { testCount, describeCount, shipped: KIT_TYPE_SCRIPT_PATHS.includes(path as typeof KIT_TYPE_SCRIPT_PATHS[number]) };
  }
  const shipped = discovered.filter((path) => suites[path].shipped);
  return {
    suites,
    discovered,
    discoveredExactlyOnce: new Set(discovered).size === discovered.length && shipped.every((path) => path in files),
    boundaries: {
      "fresh-context.test.ts": ["review manifest and report", "exact HEAD and stale evidence", "GitHub and integration seams"],
      "wiki.test.ts": ["page schema and links", "generated and coverage", "impact and conflicts"],
      "work.test.ts": ["work graph", "queue projection", "selected/topic context"],
    },
  };
}

function coupling(root: string, path: string): Record<string, unknown> {
  const commits = git(root, ["log", "--no-merges", "--format=%H", `${KIT_MODULARITY_COUPLING_REVISION}..${KIT_MODULARITY_BASELINE_REVISION}`, "--", path], true).trim().split(/\s+/).filter(Boolean);
  const numstat = git(root, ["diff", "--numstat", `${KIT_MODULARITY_COUPLING_REVISION}..${KIT_MODULARITY_BASELINE_REVISION}`, "--", path], true).trim().split("\n").filter(Boolean).reduce((sum, line) => { const [added, deleted] = line.split(/\s+/); return { added: sum.added + Number(added || 0), deleted: sum.deleted + Number(deleted || 0) }; }, { added: 0, deleted: 0 });
  return { sinceRevision: KIT_MODULARITY_COUPLING_REVISION, commitCount: commits.length, commits: sorted(commits), linesAdded: numstat.added, linesDeleted: numstat.deleted };
}

function buildReport(root = PROJECT_ROOT): KitModularityBaselineReport {
  // Always measure the pinned revision in a disposable checkout. The caller's
  // worktree may contain the candidate commit (or uncommitted harness edits),
  // and those bytes must never alter a historical KM-00 report.
  const clone = disposableCheckout(root, KIT_MODULARITY_BASELINE_REVISION);
  try {
    const pinnedRoot = clone.root;
    if (git(pinnedRoot, ["cat-file", "-t", `${KIT_MODULARITY_COUPLING_REVISION}^{commit}`], true).trim() !== "commit") throw new Error("KM-00 coupling revision is missing");
    const { core, inventories } = loadPinnedModules(pinnedRoot);
    const view = core.createRepoView(pinnedRoot);
    const kit = core.kitFiles(view);
    if (kit.findings.length > 0) throw new Error(`cannot render kit baseline: ${kit.findings.map((finding) => finding.message).join("; ")}`);
    const generatedManifest = JSON.parse(kit.files[MANIFEST_PATH]) as Record<string, unknown>;
    const entries = core.KIT_ENTRIES.map((entry: KitEntry) => ({ target: entry.target, placement: entry.placement, source: entry.source as unknown as Record<string, unknown> }));
    const ownedEntries = entries.filter((entry) => entry.placement === "files").map((entry) => entry.target);
    const fileHashes: Record<string, string> = {};
    for (const entry of core.KIT_ENTRIES) {
      const source = entry.source as unknown as Record<string, unknown>;
      const from = typeof source.from === "string" ? source.from : undefined;
      if (from && view.exists(from)) fileHashes[entry.target] = sha256(readFileSync(join(pinnedRoot, from)));
    }
    const kitPaths = sorted(new Set(core.KIT_ENTRIES
      .filter((entry) => entry.placement === "files" && entry.target.startsWith("scripts/wiki/") && entry.target.endsWith(".ts"))
      .map((entry) => entry.target)
      .filter((path) => view.exists(path))));
    const surfaces = compilerSurface(pinnedRoot, kitPaths);
    const allScriptPaths = readdirSync(join(pinnedRoot, "scripts/wiki"), { withFileTypes: true })
      .filter((item) => item.isFile() && item.name.endsWith(".ts"))
      .map((item) => `scripts/wiki/${item.name}`).sort();
    const allSurfaces = compilerSurface(pinnedRoot, allScriptPaths);
    const shippedSet = new Set(kitPaths);
    const callerBindings = allSurfaces.edges
      .filter((edge) => edge.resolved != null && shippedSet.has(edge.resolved))
      .map((edge) => ({ ...edge, callerKind: shippedSet.has(edge.from) ? "shipped" as const : "publishing-only" as const }));
    const toolingMetrics = core.KIT_ENTRIES
      .filter((entry) => entry.placement === "files" && entry.target.startsWith("scripts/wiki/"))
      .map((entry) => {
        const source = entry.source as unknown as Record<string, unknown>;
        const from = typeof source.from === "string" ? source.from : undefined;
        return from && view.exists(from) ? metric(readFileSync(join(pinnedRoot, from))) : { lines: 0, bytes: 0 };
      });
    const tsMetrics = kitPaths.map((path) => metric(readFileSync(join(pinnedRoot, path))));
    const splitMetrics = SPLIT_TARGETS.map((path) => metric(readFileSync(join(pinnedRoot, path))));
    const totals = (items: Metric[]): Metric => items.reduce((sum, item) => ({ lines: sum.lines + item.lines, bytes: sum.bytes + item.bytes }), { lines: 0, bytes: 0 });
    const tooling = totals(toolingMetrics); const typeScript = totals(tsMetrics); const split = totals(splitMetrics);
    const loaded = core.loadWikiPages(view);
    const generated = { ...core.generatedCoreFiles(loaded.pages, core.readConfig(view).name), ...inventories.generateInventories(view) };
    const generatedPaths = sorted([...Object.keys(generated), ...Object.keys(kit.files)]);
    const selectors: Record<string, string[]> = {
      global: ["--json", "--root <path>", "--staged", "--check", "--enforce", "--enforce-conflicts", "--all", "--full", "--help"],
      work: ["--executor agent|human|all", "--all", "--json", "--help"],
      context: ["--work <ID>", "--page <ID>", "--conflict C-NNN", "--artifact <path>", "--reuse <path>", "--metadata <path>", "--base <ref>", "--full", "--json"],
      impact: ["--base <ref>", "--metadata <path>", "--enforce", "--enforce-conflicts", "--json"],
      verify: ["--page <id>", "--unchanged <20+ chars>", "--json"],
      review: ["--base <ref>", "--metadata <path>", "--output <dir>", "--report <path>", "--policy-file <path>", "--reviewer-actor <actor>", "--pr-author <actor>", "--json"],
      conflicts: ["C-NNN", "--all", "--json"],
      search: ["<terms>", "--query <terms>", "--json"],
    };
    const catalog = cliCatalog(pinnedRoot);
    const fixtures = commandFixtures(pinnedRoot, KIT_MODULARITY_BASELINE_REVISION);
    const manifestDigest = String(generatedManifest.digest);
    const lifecyclePaths = ["scripts/wiki/apply.ts", "scripts/wiki/kit-sync.ts", "scripts/wiki/apply.test.ts", "scripts/wiki/new-repository-adoption.test.ts", "scripts/wiki/existing-repo-bootstrap.test.ts"];
    const report: KitModularityBaselineReport = {
      reportVersion: 1, contractVersion: 1, kind: "km-00-portable-kit-baseline", exactRevision: KIT_MODULARITY_BASELINE_REVISION,
      method: { modelCalls: 0, providerCalls: 0, sourceEncoding: "UTF-8", lineDefinition: "LF byte count; a final newline contributes one line", importExportMethod: "TypeScript compiler API createProgram/checker AST; import/export declarations, including type-only clauses", changeCouplingMethod: "git log --no-merges and git diff --numstat over the pinned coupling-to-baseline range", revisionCheckout: "detached git checkout of exact revision in a disposable clone", writeGuard: "write-producing CLI fixtures run only in disposable clones with CI/GitHub/PR variables removed" },
      kit: { entries, entriesDigest: sha256(core.jsonStable(entries)), ownedEntries, manifest: generatedManifest, manifestDigest, generatedPaths, fileHashes },
      modules: { paths: kitPaths, files: surfaces.files, importEdges: surfaces.edges, callerBindings, totals: tooling, typeScriptTotals: typeScript },
      cli: {
        commands: catalog.commands, commandCount: catalog.commands.length, globalFlags: selectors.global, selectors,
        writeCommands: ["inventory", "index", "generated", "kit", "verify", "review-preflight", "review-bundle"],
        contract: { usage: "bun scripts/wiki/cli.ts <command> [options]", commandSource: "scripts/wiki/cli.ts usage()", packageScripts: catalog.packageScripts, packageOnlyScripts: catalog.packageOnlyScripts, exitCodes: { success: 0, finding: 1, usage: 2, unexpected: 1 }, stdout: "JSON is jsonStable with sorted object keys; text has stable headings", stderr: "findings and usage errors are separate from stdout", ordering: "paths, IDs, fields, and command lists are deterministic" },
        fixtures, fixtureDigest: sha256(core.jsonStable(fixtures)),
      },
      tests: suiteInventory(pinnedRoot, surfaces.files),
      lifecycle: { implementation: ["scripts/wiki/apply.ts", "scripts/wiki/kit-sync.ts"], behavior: ["new", "adopt", "upgrade", "dry-run"], statuses: ["ready", "preview", "needs-reconcile", "needs-merge"], semantics: ["kit files replace on upgrade", "seed files write only when absent", "managed blocks replace one declared block and preserve host bytes", "reference files are never copied", "manifest v2 is content-addressed and records host integrations"], sourceHashes: Object.fromEntries(lifecyclePaths.map((path) => [path, sha256(readFileSync(join(pinnedRoot, path)))])) },
      screen: { rule: { lineThreshold: 1000, byteThreshold: 65536, materialByteThreshold: 30720, materialShareThreshold: 0.1, dispatcherLineThreshold: 250, decision: "line count is supporting evidence; ownership, payload share/bytes, responsibility count, and change coupling decide", candidateRule: "lines > 1000 OR bytes > 65536 OR ((bytes > 30720 OR payload share > 0.1) AND responsibility count > 1) OR dispatcher lines > 250 OR repeated non-merge coupling" }, targets: Object.fromEntries(SPLIT_TARGETS.map((path) => {
        const m = metric(readFileSync(join(pinnedRoot, path)));
        const responsibilityCount = path === "scripts/wiki/core.ts" ? 10 : 5;
        const payloadShare = m.bytes / tooling.bytes;
        const changeCoupling = coupling(pinnedRoot, path);
        const repeatedCoupling = Number(changeCoupling.commitCount ?? 0) > 1;
        const candidate = m.lines > 1000 || m.bytes > 65536 || ((m.bytes > 30720 || payloadShare > 0.1) && responsibilityCount > 1) || (path === "scripts/wiki/cli.ts" && m.lines > 250) || repeatedCoupling;
        return [path, { metric: m, payloadShare, responsibilityCount, changeCoupling, candidate }];
      })), deferred: ["scripts/wiki/apply.ts", "scripts/wiki/primary-baseline.ts"] },
      sequencing: { prerequisite: "TE-06-OWNER", te03: "TE-03 is currently deferred; if activated before KM ratification, finish TE-03 and regenerate KM-00", order: ["KM-00 baseline", "KM-00-OWNER ratification", "KM-01", "KM-02", "KM-03", "KM-04", "KM-05", "KM-06", "KM-07", "TE-03 after KM-07 when not activated earlier"], noProductionModuleMoved: true },
      summary: { copiedToolingLines: tooling.lines, copiedToolingBytes: tooling.bytes, typeScriptLines: typeScript.lines, typeScriptBytes: typeScript.bytes, splitTargetLines: split.lines, splitTargetBytes: split.bytes, splitTargetShare: split.bytes / tooling.bytes, manifestDigest },
    };
    if (tooling.lines !== KIT_MODULARITY_EXPECTED.copiedTooling.lines || tooling.bytes !== KIT_MODULARITY_EXPECTED.copiedTooling.bytes || split.lines !== KIT_MODULARITY_EXPECTED.splitTargets.lines || split.bytes !== KIT_MODULARITY_EXPECTED.splitTargets.bytes) throw new Error("KM-00 pinned metrics do not match expected baseline");
    return report;
  } finally {
    clone.cleanup();
  }
}

export const buildKitModularityBaselineReport = buildReport;
export const buildKM00BaselineReport = buildReport;
export function renderKitModularityBaselineJson(report: KitModularityBaselineReport): string { return jsonStable(report); }
export const renderKM00BaselineJson = renderKitModularityBaselineJson;
export function renderKitModularityBaselineMarkdown(report: KitModularityBaselineReport): string {
  const rows = SPLIT_TARGETS.map((path) => { const target = (report.screen.targets as Record<string, { metric: Metric; payloadShare: number; responsibilityCount: number }>)[path]; return `| \`${path}\` | ${target.metric.lines.toLocaleString()} | ${target.metric.bytes.toLocaleString()} | ${(target.payloadShare * 100).toFixed(1)}% | ${target.responsibilityCount} |`; });
  return [
    "# KM-00 portable kit modularity baseline", "", `Exact revision: \`${report.exactRevision}\``, "",
    "## Portable payload", "",
    `Copied kit tooling: ${report.summary.copiedToolingLines.toLocaleString()} lines / ${report.summary.copiedToolingBytes.toLocaleString()} UTF-8 bytes. Five split targets: ${report.summary.splitTargetLines.toLocaleString()} lines / ${report.summary.splitTargetBytes.toLocaleString()} bytes (${(report.summary.splitTargetShare * 100).toFixed(1)}%).`, "",
    "| Target | Lines | Bytes | Payload share | Responsibilities |", "|---|---:|---:|---:|---:|", ...rows, "",
    "## Compatibility contract", "", `- Public command count: ${report.cli.commandCount}; exit codes are success 0, findings 1, usage 2.`,
    "- JSON uses stable sorted keys; text headings, field shapes, stdout/stderr separation, and deterministic ordering are fixture-bound.",
    "- KIT_ENTRIES and manifest v2 ownership, managed-block, seed, reference, upgrade, adoption, and dry-run semantics are frozen before code motion.", "",
    "## Safe sequence", "", `TE-03: ${String(report.sequencing.te03)}.`, `No production module moved or renamed: ${report.sequencing.noProductionModuleMoved}.`,
    "", "## Manifest", "", `Manifest v2 digest: \`${report.summary.manifestDigest}\`.`, "",
  ].join("\n");
}
export const renderKM00BaselineMarkdown = renderKitModularityBaselineMarkdown;

export type KitModularityBaselineEvidenceResult = {
  mode: "write" | "check";
  messages: string[];
};

/** Write or verify rendered evidence without spawning a second Bun process. */
export function writeKitModularityBaselineEvidence(
  report: KitModularityBaselineReport,
  jsonPath: string,
  markdownPath: string,
  check = false,
): KitModularityBaselineEvidenceResult {
  const json = renderKitModularityBaselineJson(report);
  const markdown = renderKitModularityBaselineMarkdown(report);
  if (check) {
    if (!existsSync(jsonPath) || readFileSync(jsonPath, "utf8") !== json || !existsSync(markdownPath) || readFileSync(markdownPath, "utf8") !== markdown) {
      throw new Error(`KM-00 evidence is stale: ${jsonPath}, ${markdownPath}`);
    }
    return { mode: "check", messages: ["KM-00 portable kit baseline is current"] };
  }
  mkdirSync(dirname(jsonPath), { recursive: true });
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(jsonPath, json, "utf8");
  writeFileSync(markdownPath, markdown, "utf8");
  return { mode: "write", messages: [`wrote ${jsonPath}`, `wrote ${markdownPath}`] };
}

function flagValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name); const value = index === -1 ? fallback : process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`); return resolve(PROJECT_ROOT, value);
}
if (import.meta.main) {
  try {
    const report = buildReport(PROJECT_ROOT);
    const jsonPath = flagValue("--output", DEFAULT_JSON_PATH);
    const markdownPath = flagValue("--markdown", DEFAULT_MARKDOWN_PATH);
    for (const message of writeKitModularityBaselineEvidence(report, jsonPath, markdownPath, process.argv.includes("--check")).messages) console.log(message);
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
