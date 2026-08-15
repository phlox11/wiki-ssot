import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSelectedWorkContext, projectSelectedWorkContext } from "./context";
import { buildWorkQueue } from "./discovery";
import { compactWorkText } from "./cli-render";
import { loadWikiPages, parseWikiPage } from "./page-validation";
import { scopeReport } from "./scope";
import { createRepoView, type RepoView } from "./repository-view";
import { buildSourceMap } from "./generated-views";
import { mappedPages, sourceHashes } from "./verification";
import { buildReusableWorkContextArtifact, validateReusableWorkContextArtifact, type ReusableWorkContextArtifactV2 } from "./core";
import { impactReport, type PrMetadata } from "./impact";
import type { WikiPage, WorkItem } from "./model";

const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function memoryView(files: Record<string, string>): RepoView {
  const paths = Object.keys(files).sort();
  return { root: "/memory", mode: "working", listFiles: () => paths, exists: (path) => path in files, read: (path) => files[path] };
}

function rawPage(path: string, sources: unknown[], overrides: Record<string, unknown> = {}): WikiPage {
  const data = {
    id: path.replace(/^wiki\//, "").replace(/\.md$/, ""),
    summary: "Scope fixture.",
    kind: "product",
    status: "current",
    authority: "normative",
    owners: ["@owner"],
    sources,
    ...overrides,
  };
  return parseWikiPage(path, `---\n${Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n\nBody\n`);
}

test("compact catalog context retains aggregate evidence without serializing matched paths", () => {
  const files: Record<string, string> = { "src/anchor.ts": "anchor\n" };
  for (let index = 0; index < 10_000; index += 1) files[`src/catalog-${String(index).padStart(5, "0")}.ts`] = `file ${index}\n`;
  const view = memoryView(files);
  const item: WorkItem = {
    id: "WK-SCOPE",
    title: "Catalog fixture",
    state: "not-started",
    priority: "normal",
    depends_on: [],
    context_pages: ["product/catalog"],
    acceptance: ["The compact projection remains bounded."],
    evidence: [],
  };
  const page = rawPage("wiki/product/catalog.md", [
    { path: "src/anchor.ts", context: "always" },
    { glob: "src/catalog-*.ts", context: "catalog", reason: "The catalog is intentionally expanded only on focused requests." },
  ], { work_items: [item] });
  const queued = buildWorkQueue([page]).groups.ready[0];
  const context = buildSelectedWorkContext(view, [page], queued);
  const full = JSON.stringify(projectSelectedWorkContext(context, "full"));
  const compact = JSON.stringify(projectSelectedWorkContext(context, "compact"));
  const projection = projectSelectedWorkContext(context, "compact") as ReturnType<typeof projectSelectedWorkContext> & { pages: Array<Record<string, unknown>> };
  expect(context.pages[0]?.sourceFiles).toHaveLength(10_001);
  expect(full).toContain("catalog-09999.ts");
  expect(compact).not.toContain("catalog-09999.ts");
  const pageProjection = (projection.pages as Array<Record<string, unknown>>)[0];
  expect(pageProjection.sourceFiles).toEqual(["src/anchor.ts"]);
  expect((pageProjection.sourceGlobs as Array<Record<string, unknown>>)[0]?.matchedFiles).toBeUndefined();
  expect((pageProjection.catalogSources as Array<Record<string, unknown>>)[0]?.count).toBe(10_000);
  expect(compact).toContain("catalog-*.ts");
  const text = compactWorkText(projectSelectedWorkContext(context, "compact") as never);
  expect(text).toContain("Mandatory source files:");
  expect(text).not.toContain("catalog-09999.ts");
  const sourceMap = buildSourceMap([page]);
  expect(mappedPages(sourceMap, "src/catalog-09999.ts")).toContain("product/catalog");
  expect(Object.keys(sourceHashes(view, page))).toContain("src/catalog-09999.ts");
  const flipped = rawPage("wiki/product/catalog.md", [
    { path: "src/anchor.ts", context: "always" },
    { glob: "src/catalog-*.ts", context: "always" },
  ], { work_items: [item] });
  expect(Object.keys(sourceHashes(view, flipped))).toEqual(Object.keys(sourceHashes(view, page)));
});

function gitRun(root: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

function fixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-scope-report-"));
  temporary.push(root);
  mkdirSync(join(root, "wiki/product",), { recursive: true });
  mkdirSync(join(root, "wiki/conflicts/open"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, ".wiki"), { recursive: true });
  gitRun(root, ["init", "-q"]);
  gitRun(root, ["config", "user.name", "Wiki Scope Test"]);
  gitRun(root, ["config", "user.email", "scope@example.invalid"]);
  writeFileSync(join(root, ".wiki/config.json"), JSON.stringify({
    version: 2,
    name: "scope-fixture",
    publishesKit: false,
    enforcement: { mode: "local-status", statusContext: "wiki-ssot/local" },
    localChecks: [{ id: "project-test", argv: ["bun", "run", "test"] }],
    review: { mode: "required", when: { kind: "risk-based", changedFileRules: [{ glob: "src/**", reason: "Source implementation changes require focused independent review." }], changedKitOwnedFiles: false, affectedInvariants: true, affectedConflicts: true, removedCurrentPages: true } },
  }, null, 2));
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "src/catalog.ts"), "export const catalog = 1;\n");
  writeFileSync(join(root, "wiki/product/invariant.md"), `---\nid: product/invariant\nsummary: Invariant\nkind: invariant\nstatus: current\nauthority: normative\nowners: ["@owner"]\nsources: [{path: "src/a.ts", context: always}, {glob: "src/**", context: catalog, reason: "The implementation breadth is catalogued for focused reads only."}]\n---\n\nInvariant\n`);
  writeFileSync(join(root, "wiki/product/removed.md"), `---\nid: product/removed\nsummary: Removed page\nkind: product\nstatus: current\nauthority: normative\nowners: ["@owner"]\nsources: [{path: "src/a.ts", context: always}]\n---\n\nRemoved\n`);
  writeFileSync(join(root, "wiki/conflicts/open/C-901.md"), `---\nid: conflict/C-901\nsummary: Conflict\nkind: conflict\nstatus: conflicted\nauthority: observed\nowners: ["@owner"]\nconflict_id: C-901\nconflict_type: decision\nseverity: high\norigin: baseline\nopened_at: 2026-01-01\naffected_pages: [product/invariant]\naffected_invariants: [product/invariant]\nsources: [{glob: "src/**", context: catalog, reason: "The conflict source breadth is catalogued for bounded review."}]\nresolution: {state: open, acceptance: ["Record evidence."]}\n---\n\nConflict\n`);
  gitRun(root, ["add", "."]);
  gitRun(root, ["commit", "-qm", "scope base"]);
  return root;
}

test("scope report exposes reverse glob fanout, selector union, and deleted-page causal paths", () => {
  const root = fixtureRepo();
  rmSync(join(root, "wiki/product/removed.md"));
  writeFileSync(join(root, "src/catalog.ts"), "export const catalog = 2;\n");
  gitRun(root, ["add", "-A"]);
  gitRun(root, ["commit", "-qm", "scope change"]);
  const view = createRepoView(root);
  const pages = loadWikiPages(view).pages;
  const report = scopeReport(view, pages, { base: "HEAD~1" });
  const impact = impactReport(view, pages, { base: "HEAD~1" });
  expect(impact.changedFiles).toContain("src/catalog.ts");
  expect(impact.affectedPages).toContain("product/invariant");
  const broadInvariant = report.glob_breadth.find((item) => item.page_id === "product/invariant");
  expect(broadInvariant?.reverse_invariants).toContain("product/invariant");
  expect(broadInvariant?.reverse_conflicts).toContain("C-901");
  expect(report.potential_review.selected_file_count).toBeLessThanOrEqual(report.potential_review.tracked_file_count);
  expect(report.potential_review.selected_ratio).toBeGreaterThan(0);
  const removed = report.causal_paths.find((item) => item.path === "wiki/product/removed.md");
  expect(removed?.pages).toContain("product/removed");
  expect(removed?.review_reasons).toContain("removedCurrentPages selects removed current pages");
  expect(report.base_delta.removed_pages).toContain("product/removed");
});

test("reusable v2 artifacts aggregate catalog sets and invalidate on exact content changes", () => {
  const root = mkdtempSync(join(tmpdir(), "wiki-scope-artifact-"));
  temporary.push(root);
  mkdirSync(join(root, "wiki/product"), { recursive: true });
  mkdirSync(join(root, "wiki/proposals"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  gitRun(root, ["init", "-q"]);
  gitRun(root, ["config", "user.name", "Wiki Scope Test"]);
  gitRun(root, ["config", "user.email", "scope@example.invalid"]);
  writeFileSync(join(root, "src/anchor.ts"), "export const anchor = 1;\n");
  for (let index = 0; index < 50; index += 1) writeFileSync(join(root, `src/catalog-${index}.ts`), `${index}\n`);
  writeFileSync(join(root, "wiki/product/invariant.md"), `---\nid: product/invariant\nsummary: Invariant\nkind: invariant\nstatus: current\nauthority: normative\nowners: ["@owner"]\nsources: [{path: "src/anchor.ts", context: always}, {glob: "src/catalog-*.ts", context: catalog, reason: "The catalog set is expanded only by focused context requests."}]\n---\n\nInvariant\n`);
  writeFileSync(join(root, "wiki/proposals/work.md"), `---\nid: proposal/work\nsummary: Work\nkind: proposal\nstatus: proposed\nauthority: normative\nowners: ["@owner"]\nsources: [{path: "src/anchor.ts", context: always}, {glob: "src/catalog-*.ts", context: catalog, reason: "The proposal catalog remains aggregate until a focused read."}]\nwork_items: [{id: WK-ARTIFACT, title: Artifact, state: not-started, priority: normal, depends_on: [], context_pages: [product/invariant], acceptance: ["Keep the exact catalog binding."], evidence: []}]\n---\n\nWork\n`);
  gitRun(root, ["add", "."]);
  gitRun(root, ["commit", "-qm", "artifact base"]);
  const view = createRepoView(root);
  const pages = loadWikiPages(view).pages;
  const work = buildWorkQueue(pages).groups.ready[0];
  const metadata: PrMetadata = { change_type: "fix", semantic_change: true, wiki_action: "update", affected_pages: [], affected_invariants: [], touched_conflicts: [] };
  const artifact = buildReusableWorkContextArtifact(view, pages, work, { base: "HEAD", metadata }) as ReusableWorkContextArtifactV2;
  const rendered = JSON.stringify(artifact);
  expect(artifact.version).toBe(2);
  expect(artifact.bindings.catalog_sets).toHaveLength(2);
  expect(artifact.bindings.catalog_sets[0]?.count).toBe(50);
  expect(rendered).not.toContain("catalog-49.ts");
  expect(artifact.read_order.filter((entry) => entry.kind === "source").map((entry) => entry.path)).not.toContain("src/catalog-49.ts");
  writeFileSync(join(root, "src/catalog-49.ts"), "changed\n");
  gitRun(root, ["add", "."]);
  gitRun(root, ["commit", "-qm", "catalog changed"]);
  const changedView = createRepoView(root);
  const changedPages = loadWikiPages(changedView).pages;
  const changedWork = buildWorkQueue(changedPages).groups.ready[0];
  const expected = buildReusableWorkContextArtifact(changedView, changedPages, changedWork, { base: "HEAD", metadata }) as ReusableWorkContextArtifactV2;
  const findings = validateReusableWorkContextArtifact(artifact, expected);
  expect(findings.map((item) => item.code)).toContain("context-artifact-catalog-stale");
});
