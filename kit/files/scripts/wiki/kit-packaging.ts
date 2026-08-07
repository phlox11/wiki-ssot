import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Finding } from "./model";
import type { RepoView } from "./repository-view";
import { hashContent, jsonStable } from "./serialization";

// ---------------------------------------------------------------------------
// Portable kit
//
// `kit/` is this toolkit's copy-paste distribution for other repositories. It is
// generated from the files below, never hand-edited: `wiki:kit` writes it and
// `wiki:kit --check` fails when it drifts from its sources.
//
// The payload is split by ownership because adoption and upgrade need opposite rules:
//   kit/files/**  stays kit-owned. Adoption copies it wholesale and an upgrade
//                 replaces it, so engine and rail improvements actually reach an
//                 adopting repository.
//   kit/managed/** owns only a marked block inside a shared host file. Content
//                 outside the block remains project-owned.
//   kit/seed/**   becomes the adopter's on first copy. Adoption writes each file
//                 only when it is absent and an upgrade never touches it, so
//                 project policy, recorded source hashes, and a project-specific
//                 inventory implementation survive.
//   kit/reference read from the kit checkout, never copied — so nothing an adopter
//                 merges and deletes gets re-dropped by the next upgrade
// `.wiki/kit-manifest.json` ships that split plus a sha256 per file, which is
// what lets an upgrade tell an untouched file from a locally edited one instead
// of overwriting both alike.
// ---------------------------------------------------------------------------

export const KIT_ROOT = "kit";
export const KIT_MANIFEST_TARGET = ".wiki/kit-manifest.json";
export const KIT_EXCLUDE_START = "<!-- kit:exclude:start -->";
export const KIT_EXCLUDE_END = "<!-- kit:exclude:end -->";

/** Scripts that drive this repository's own distribution and mean nothing downstream. */
const KIT_OMITTED_SCRIPTS = new Set(["wiki:kit"]);

export type KitOwnership = "kit" | "seed";

/**
 * Where a generated file sits under `kit/`, which decides what happens to it in
 * an adopting repository:
 *   files     copied on adoption and replaced on upgrade
 *   seed      copied only when absent and never updated
 *   managed   one marked block is replaced while surrounding host content stays
 *   reference read from the kit checkout, never copied — so nothing an adopter
 *             merges and deletes gets re-dropped by the next upgrade
 */
export type KitPlacement = "files" | "seed" | "managed" | "reference";

type KitSource =
  | { kind: "copy"; from: string }
  | { kind: "strip"; from: string }
  | { kind: "managed-block"; from: string; start: string; end: string; legacyMarkers?: string[] }
  | { kind: "legacy-v1-workflow"; host: string; wiki: string }
  | { kind: "literal"; content: string }
  | { kind: "package-fragment"; from: string };

export type KitEntry = { target: string; placement: KitPlacement; source: KitSource };

const KIT_CONFIG_TEMPLATE = jsonStable({
  version: 1,
  name: "your-repo",
  highRisk: ["src/contracts/**", "src/db/**", "migrations/**"],
  freshContext: {
    mode: "required",
    requiredVerdict: "PASS",
    evidenceRequired: true,
    requiredWhen: {
      kind: "risk-based",
      changedFileGlobs: [".github/workflows/**", ".wiki/config.json", "AGENTS.md", "scripts/wiki/**", "wiki/SCHEMA.md", "wiki/WORKFLOW.md"],
      affectedInvariants: true,
      affectedConflicts: true,
      removedCurrentPages: true,
    },
    trust: { allowedReviewers: ["*"], requireDifferentActor: false, requireAuthenticatedActor: true },
  },
});

const KIT_COVERAGE_TEMPLATE = jsonStable({ version: 1, include: [], exclusions: [] });

const KIT_STATE_TEMPLATE = jsonStable({ version: 1, pages: {} });

const KIT_CHANGELOG_TEMPLATE = `# Changelog

Record only current-contract changes here: product-contract changes, significant architecture decisions, invariant changes, large reconciles, and schema or process changes. Git remains the source of truth for ordinary change history.

- Wiki established from the wiki-ssot kit.
`;

/**
 * Every file the kit ships, with how it is produced and who owns it afterwards.
 * Adding a file here is the only way it reaches an adopting repository.
 */
export const KIT_ENTRIES: KitEntry[] = [
  { target: "scripts/wiki/core.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/core.ts" } },
  { target: "scripts/wiki/kit-packaging.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/kit-packaging.ts" } },
  { target: "scripts/wiki/discovery.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/discovery.ts" } },
  { target: "scripts/wiki/context.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/context.ts" } },
  { target: "scripts/wiki/generated-views.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/generated-views.ts" } },
  { target: "scripts/wiki/model.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/model.ts" } },
  { target: "scripts/wiki/serialization.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/serialization.ts" } },
  { target: "scripts/wiki/repository-view.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/repository-view.ts" } },
  { target: "scripts/wiki/page-validation.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/page-validation.ts" } },
  { target: "scripts/wiki/work-validation.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/work-validation.ts" } },
  { target: "scripts/wiki/cli.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/cli.ts" } },
  { target: "scripts/wiki/github-attestation.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/github-attestation.ts" } },
  // Reference, not copied at all: it is documentation of the inventory patterns,
  // read from the kit checkout when someone writes their own `inventories.ts`.
  // Delivering it would mean an adopter carrying a file they never run, and seed
  // placement could not even let them delete it — "seed" means "written when
  // absent", so the next sync would put it straight back.
  { target: "scripts/wiki/inventories.example.ts", placement: "reference", source: { kind: "copy", from: "scripts/wiki/inventories.example.ts" } },
  { target: "scripts/wiki/wiki.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/wiki.test.ts" } },
  { target: "scripts/wiki/kit-packaging.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/kit-packaging.test.ts" } },
  { target: "scripts/wiki/work.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/work.test.ts" } },
  { target: "scripts/wiki/discovery.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/discovery.test.ts" } },
  { target: "scripts/wiki/context.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/context.test.ts" } },
  { target: "scripts/wiki/generated-views.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/generated-views.test.ts" } },
  { target: "scripts/wiki/serialization.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/serialization.test.ts" } },
  { target: "scripts/wiki/repository-view.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/repository-view.test.ts" } },
  { target: "scripts/wiki/page-validation.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/page-validation.test.ts" } },
  { target: "scripts/wiki/work-validation.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/work-validation.test.ts" } },
  { target: "scripts/wiki/core-facade.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/core-facade.test.ts" } },
  { target: "scripts/wiki/test-runner.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/test-runner.test.ts" } },
  { target: "scripts/wiki/fresh-context.test.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/fresh-context.test.ts" } },
  { target: "scripts/wiki/test-runner.ts", placement: "files", source: { kind: "copy", from: "scripts/wiki/test-runner.ts" } },
  { target: "scripts/wiki/tsconfig.json", placement: "files", source: { kind: "copy", from: "scripts/wiki/tsconfig.json" } },
  { target: ".github/workflows/wiki-ssot.yml", placement: "files", source: { kind: "copy", from: ".github/workflows/wiki-ssot.yml" } },
  { target: ".github/workflows/wiki-audit.yml", placement: "files", source: { kind: "copy", from: ".github/workflows/wiki-audit.yml" } },
  {
    target: "migrations/v1/checks.yml",
    placement: "reference",
    source: { kind: "legacy-v1-workflow", host: ".github/workflows/checks.yml", wiki: ".github/workflows/wiki-ssot.yml" },
  },
  {
    target: "migrations/v1/host-checks.yml",
    placement: "reference",
    source: { kind: "copy", from: ".github/workflows/checks.yml" },
  },
  {
    target: ".github/pull_request_template.md",
    placement: "managed",
    source: {
      kind: "managed-block", from: ".github/pull_request_template.md",
      start: "<!-- wiki-ssot:managed:start -->", end: "<!-- wiki-ssot:managed:end -->",
      legacyMarkers: ["fresh_context:"],
    },
  },
  {
    target: ".husky/pre-commit",
    placement: "managed",
    source: {
      kind: "managed-block", from: ".husky/pre-commit",
      start: "# wiki-ssot:managed:start", end: "# wiki-ssot:managed:end",
      legacyMarkers: ["bun run wiki:lint --staged"],
    },
  },
  {
    target: ".husky/pre-push",
    placement: "managed",
    source: {
      kind: "managed-block", from: ".husky/pre-push",
      start: "# wiki-ssot:managed:start", end: "# wiki-ssot:managed:end",
      legacyMarkers: ["refs/heads/main"],
    },
  },
  {
    target: "AGENTS.md",
    placement: "managed",
    source: {
      kind: "managed-block", from: "AGENTS.md",
      start: "<!-- wiki-ssot:managed:start -->", end: "<!-- wiki-ssot:managed:end -->",
      legacyMarkers: ["<!-- wiki-ssot:fresh-context-guardrail -->"],
    },
  },
  { target: "wiki/README.md", placement: "files", source: { kind: "strip", from: "wiki/README.md" } },
  { target: "wiki/SCHEMA.md", placement: "files", source: { kind: "strip", from: "wiki/SCHEMA.md" } },
  { target: "wiki/WORKFLOW.md", placement: "files", source: { kind: "strip", from: "wiki/WORKFLOW.md" } },
  { target: "CLAUDE.md", placement: "seed", source: { kind: "strip", from: "CLAUDE.md" } },
  { target: ".gitignore", placement: "seed", source: { kind: "copy", from: ".gitignore" } },
  { target: "tsconfig.json", placement: "seed", source: { kind: "copy", from: "tsconfig.json" } },
  { target: "scripts/wiki/inventories.ts", placement: "seed", source: { kind: "copy", from: "scripts/wiki/inventories.ts" } },
  { target: ".wiki/config.json", placement: "seed", source: { kind: "literal", content: KIT_CONFIG_TEMPLATE } },
  { target: ".wiki/coverage.json", placement: "seed", source: { kind: "literal", content: KIT_COVERAGE_TEMPLATE } },
  { target: ".wiki/state.json", placement: "seed", source: { kind: "literal", content: KIT_STATE_TEMPLATE } },
  { target: "wiki/changelog.md", placement: "seed", source: { kind: "literal", content: KIT_CHANGELOG_TEMPLATE } },
  // Merged into an existing package.json and then discarded, so it must not be a
  // payload file: an upgrade would keep re-creating what the adopter deleted.
  { target: "package.kit.json", placement: "reference", source: { kind: "package-fragment", from: "package.json" } },
];

export function kitPath(entry: Pick<KitEntry, "target" | "placement">): string {
  return entry.placement === "reference" ? `${KIT_ROOT}/${entry.target}` : `${KIT_ROOT}/${entry.placement}/${entry.target}`;
}

/** Everything under `kit/` the generator owns. `kit/README.md` is hand-written. */
export function isKitManagedPath(path: string): boolean {
  return path.startsWith(`${KIT_ROOT}/`) && path !== `${KIT_ROOT}/README.md`;
}

/**
 * Drop `kit:exclude` regions so instance-only guidance — rules about developing
 * this engine, links to pages only this repository has — never ships downstream.
 */
export function stripKitExclusions(raw: string): { content: string; error?: string } {
  const kept: string[] = [];
  let depth = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === KIT_EXCLUDE_START) { depth += 1; continue; }
    if (trimmed === KIT_EXCLUDE_END) {
      if (depth === 0) return { content: raw, error: `unbalanced ${KIT_EXCLUDE_END}` };
      depth -= 1;
      continue;
    }
    if (depth === 0) kept.push(line);
  }
  if (depth !== 0) return { content: raw, error: `unclosed ${KIT_EXCLUDE_START}` };
  return { content: kept.join("\n") };
}

function kitPackageFragment(raw: string): { content: string; error?: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { content: "", error: "package.json is not valid JSON" }; }
  const pkg = parsed as { engines?: unknown; scripts?: Record<string, string>; devDependencies?: unknown };
  const scripts = Object.fromEntries(Object.entries(pkg.scripts ?? {})
    .filter(([name]) => name.startsWith("wiki:") && !KIT_OMITTED_SCRIPTS.has(name)));
  return { content: jsonStable({ engines: pkg.engines, scripts, devDependencies: pkg.devDependencies }) };
}

function extractManagedBlock(raw: string, source: Extract<KitSource, { kind: "managed-block" }>): { content: string; error?: string } {
  const starts = raw.split(source.start).length - 1;
  const ends = raw.split(source.end).length - 1;
  const startIndex = raw.indexOf(source.start);
  const endIndex = raw.indexOf(source.end, startIndex + source.start.length);
  if (starts !== 1 || ends !== 1 || startIndex < 0 || endIndex < startIndex) {
    return { content: "", error: `managed source must contain exactly one ordered ${source.start}/${source.end} block` };
  }
  const block = raw.slice(startIndex, endIndex + source.end.length);
  const stripped = stripKitExclusions(block);
  return stripped.error ? stripped : { content: `${stripped.content.trim()}\n` };
}

function pushFinding(findings: Finding[], path: string, code: string, message: string, severity: Finding["severity"] = "error") {
  findings.push({ code, message, path, severity });
}

function renderKitEntry(view: RepoView, entry: KitEntry, findings: Finding[]): string | null {
  const source = entry.source;
  if (source.kind === "literal") return source.content;
  if (source.kind === "legacy-v1-workflow") {
    const missing = [source.host, source.wiki].filter((path) => !view.exists(path));
    if (missing.length > 0) {
      for (const path of missing) pushFinding(findings, path, "kit-source-missing", `kit entry ${entry.target} has no source file`);
      return null;
    }
    const host = view.read(source.host);
    const wiki = view.read(source.wiki);
    const delimiter = "jobs:\n";
    const hostJobsAt = host.indexOf(delimiter);
    const wikiJobsAt = wiki.indexOf(delimiter);
    if (hostJobsAt < 0 || wikiJobsAt < 0) {
      pushFinding(findings, source.wiki, "kit-source-invalid", `kit entry ${entry.target} cannot reconstruct the version 1 combined workflow`);
      return null;
    }
    const combinedHeader = wiki.slice(0, wikiJobsAt).replace(/^name: wiki-ssot$/m, "name: checks");
    const hostJobs = host.slice(hostJobsAt + delimiter.length).trimEnd();
    const wikiJobs = wiki.slice(wikiJobsAt + delimiter.length);
    return `${combinedHeader}${delimiter}${hostJobs}\n\n${wikiJobs}`;
  }
  if (!view.exists(source.from)) {
    pushFinding(findings, source.from, "kit-source-missing", `kit entry ${entry.target} has no source file`);
    return null;
  }
  const raw = view.read(source.from);
  if (source.kind === "copy") return raw;
  if (source.kind === "package-fragment") {
    const fragment = kitPackageFragment(raw);
    if (fragment.error) {
      pushFinding(findings, source.from, "kit-source-invalid", `kit entry ${entry.target}: ${fragment.error}`);
      return null;
    }
    return fragment.content;
  }
  if (source.kind === "managed-block") {
    const block = extractManagedBlock(raw, source);
    if (block.error) {
      pushFinding(findings, source.from, "kit-managed-block-invalid", `kit entry ${entry.target}: ${block.error}`);
      return null;
    }
    return block.content;
  }
  const stripped = stripKitExclusions(raw);
  if (stripped.error) {
    pushFinding(findings, source.from, "kit-exclude-unbalanced", `kit entry ${entry.target}: ${stripped.error}`);
    return null;
  }
  return stripped.content;
}

export function kitFiles(view: RepoView): { files: Record<string, string>; findings: Finding[] } {
  const findings: Finding[] = [];
  const rendered: { entry: KitEntry; content: string }[] = [];
  for (const entry of KIT_ENTRIES) {
    const content = renderKitEntry(view, entry, findings);
    if (content != null) rendered.push({ entry, content });
  }

  // Reference files are read from the kit checkout, never copied, so they stay
  // out of the file map a sync walks. They are still part of the kit, so they
  // are hashed separately and folded into the digest — otherwise changing the
  // dependencies an adopter must merge would leave the digest, and every
  // "are you up to date" check built on it, claiming nothing moved.
  const manifestFiles: Record<string, { sha256: string; ownership: KitOwnership }> = {};
  const manifestReference: Record<string, string> = {};
  const manifestManaged: Record<string, { sha256: string; start: string; end: string; legacyMarkers?: string[] }> = {};
  for (const { entry, content } of rendered) {
    if (entry.placement === "reference") manifestReference[entry.target] = hashContent(content);
    else if (entry.placement === "managed") {
      const source = entry.source as Extract<KitSource, { kind: "managed-block" }>;
      manifestManaged[entry.target] = {
        sha256: hashContent(content), start: source.start, end: source.end,
        ...(source.legacyMarkers == null ? {} : { legacyMarkers: source.legacyMarkers }),
      };
    }
    else manifestFiles[entry.target] = { sha256: hashContent(content), ownership: entry.placement === "files" ? "kit" : "seed" };
  }
  const manifest = {
    version: 2,
    kit: "wiki-ssot",
    // Content-addressed rather than tagged: the digest identifies exactly which
    // kit an adopter holds without a version string or a timestamp to drift.
    digest: hashContent(jsonStable({ files: manifestFiles, managed: manifestManaged, reference: manifestReference })),
    files: manifestFiles,
    managed: manifestManaged,
    reference: manifestReference,
  };

  const files: Record<string, string> = {};
  for (const { entry, content } of rendered) files[kitPath(entry)] = content;
  files[kitPath({ target: KIT_MANIFEST_TARGET, placement: "files" })] = jsonStable(manifest);
  return { files, findings };
}

/**
 * Byte comparison only. `compareGenerated` additionally demands the do-not-edit
 * header on every generated Markdown file, which must never appear in a kit file
 * that becomes an adopter's own `AGENTS.md` or `wiki/SCHEMA.md`.
 */
export function compareKit(view: RepoView, expected: Record<string, string>): Finding[] {
  const findings: Finding[] = [];
  for (const [path, content] of Object.entries(expected)) {
    if (!view.exists(path)) pushFinding(findings, path, "kit-missing", `kit file is missing; run bun run wiki:kit`);
    else if (view.read(path) !== content) pushFinding(findings, path, "kit-stale", `kit file differs from its source; run bun run wiki:kit`);
  }
  for (const path of view.listFiles()) {
    // Test on disk, not through the view: `git ls-files --cached` still lists a
    // file `wiki:kit` just deleted until the deletion is staged, which would
    // make a freshly regenerated kit report its own removals as orphans.
    if (isKitManagedPath(path) && !(path in expected) && existsSync(join(view.root, path))) {
      pushFinding(findings, path, "kit-orphan", `kit file is no longer produced by the generator; run bun run wiki:kit`);
    }
  }
  return findings;
}

function writeKitFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

export function writeKit(view: RepoView, files: Record<string, string>): { written: string[]; removed: string[] } {
  const removed: string[] = [];
  for (const path of view.listFiles()) {
    if (!isKitManagedPath(path) || path in files) continue;
    rmSync(join(view.root, path), { force: true });
    removed.push(path);
  }
  writeKitFiles(view.root, files);
  return { written: Object.keys(files).sort(), removed: removed.sort() };
}
