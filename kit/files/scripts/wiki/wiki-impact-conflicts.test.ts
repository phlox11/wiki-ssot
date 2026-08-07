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

describe("verification state", () => {
  test("requires a 20-character unchanged reason", () => {
    const raw = frontmatter();
    const view = memoryView({ "source.ts": "export const value = 1;", "wiki/product/test.md": raw });
    const page = parseWikiPage("wiki/product/test.md", raw);
    expect(() => verifyState(view, [page], ["product/test"], "too short")).toThrow();
    const state = verifyState(view, [page], ["product/test"], "No semantic behavior changed in this refactor.");
    expect(state.pages["product/test"].verification.kind).toBe("unchanged");
  });

  test("detects stale mapped high-risk changes and validates PR metadata", () => {
    const root = tempRepo();
    const source = "packages/shared/src/contracts.ts";
    const pagePath = "wiki/architecture/contracts.md";
    const page = frontmatter({ id: "architecture/contracts", kind: "architecture", sources: [{ path: source }] });
    put(root, source, "export const contract = 'v1';\n");
    put(root, pagePath, page);
    put(root, ".wiki/state.json", jsonStable({ version: 1, pages: { "architecture/contracts": { sources: { [source]: hashContent("export const contract = 'v1';\n") }, verification: { kind: "updated" } } } }));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "baseline"]);
    put(root, source, "export const contract = 'v2';\n");
    run(root, ["git", "add", source]);
    run(root, ["git", "commit", "-qm", "change contract"]);

    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const omitted = impactReport(view, pages, { base: "HEAD~1", metadata: { change_type: "feature", semantic_change: true, wiki_action: "update", affected_pages: [], affected_invariants: [], touched_conflicts: [] } });
    expect(omitted.affectedPages).toEqual(["architecture/contracts"]);
    expect(omitted.stalePages).toEqual(["architecture/contracts"]);
    expect(omitted.findings.map((item) => item.code)).toContain("metadata-page-omitted");

    const declared = impactReport(view, pages, { base: "HEAD~1", metadata: { change_type: "feature", semantic_change: true, wiki_action: "update", affected_pages: ["architecture/contracts"], affected_invariants: [], touched_conflicts: [] } });
    expect(declared.findings.map((item) => item.code)).not.toContain("metadata-page-omitted");

    const metadata = { change_type: "feature", semantic_change: true, wiki_action: "update" as const, affected_pages: ["architecture/contracts"], affected_invariants: [], touched_conflicts: [] };
    const bundle = makeReviewBundle(view, pages, declared, undefined, metadata);
    temporary.push(bundle);
    expect(existsSync(join(bundle, "sources.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(bundle, "pr-metadata.json"), "utf8"))).toEqual(metadata);
    expect(readFileSync(join(bundle, "diff.patch"), "utf8")).toContain("contract = 'v2'");

    put(root, "pr-body.md", `\`\`\`yaml\nchange_type: feature\nsemantic_change: true\nwiki_action: update\naffected_pages: [architecture/contracts]\naffected_invariants: []\ntouched_conflicts: []\nfresh_context:\n  verdict: PENDING\n  reviewed_head_sha: ""\n  bundle_digest: ""\n  reviewer: ""\n  evidence: []\n\`\`\`\n`);
    const cliPath = join(process.cwd(), "scripts/wiki/cli.ts");
    run(root, [process.execPath, cliPath, "review-bundle", "--base", "HEAD~1", "--metadata", "pr-body.md", "--output", "review-cli", "--json"]);
    expect(JSON.parse(readFileSync(join(root, "review-cli/pr-metadata.json"), "utf8"))).toEqual(metadata);
    const missingMetadata = Bun.spawnSync([process.execPath, cliPath, "review-bundle", "--base", "HEAD~1", "--json"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(missingMetadata.exitCode).toBe(1);
    expect(JSON.parse(missingMetadata.stdout.toString()).findings[0].code).toBe("metadata-missing");

    const none = impactReport(view, pages, { base: "HEAD~1", metadata: { ...metadata, wiki_action: "none" } });
    expect(none.findings.map((item) => item.code)).toContain("semantic-wiki-none");
    expect(none.findings.map((item) => item.code)).toContain("implementation-wiki-none");
  });

  test("discovers affected conflicts and requires an explicit PR action", () => {
    const root = tempRepo();
    const source = "src/feature.ts";
    const page = frontmatter({ id: "features/example", kind: "feature", sources: [{ path: source }] });
    const conflict = conflictFrontmatter({ sources: [{ path: source }], affected_pages: ["features/example"] });
    put(root, source, "export const route = 'v1';\n");
    put(root, "wiki/features/example.md", page);
    put(root, "wiki/conflicts/open/C-900.md", conflict);
    put(root, ".wiki/state.json", jsonStable({ version: 1, pages: { "features/example": { sources: { [source]: hashContent("export const route = 'v1';\n") }, verification: { kind: "updated" } } } }));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "baseline"]);
    put(root, source, "export const route = 'v2';\n");
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "change conflict source"]);

    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const baseMetadata = { change_type: "refactor", semantic_change: false, wiki_action: "verify" as const, affected_pages: ["features/example"], affected_invariants: [] };
    const omitted = impactReport(view, pages, { base: "HEAD~1", metadata: { ...baseMetadata, touched_conflicts: [] } });
    expect(omitted.affectedConflicts.map((item) => item.id)).toEqual(["C-900"]);
    expect(omitted.findings.map((item) => item.code)).toContain("conflict-not-declared");

    const retained = impactReport(view, pages, { base: "HEAD~1", metadata: { ...baseMetadata, touched_conflicts: [{ id: "C-900", action: "retain", reason: "The parser changed but the unresolved policy is unchanged." }] } });
    expect(retained.findings.map((item) => item.code)).not.toContain("conflict-not-declared");
    const incomplete = impactReport(view, pages, { base: "HEAD~1", metadata: { ...baseMetadata, touched_conflicts: [{ id: "C-900", action: "resolve" }] } });
    expect(incomplete.findings.map((item) => item.code)).toContain("conflict-resolution-incomplete");

    const cliPath = join(process.cwd(), "scripts/wiki/cli.ts");
    put(root, "missing-conflict.md", "```yaml\nchange_type: refactor\nsemantic_change: false\nwiki_action: verify\naffected_pages: [features/example]\naffected_invariants: []\ntouched_conflicts: []\nfresh_context:\n  verdict: PENDING\n  reviewed_head_sha: \"\"\n  bundle_digest: \"\"\n  reviewer: \"\"\n  evidence: []\n```\n");
    const blocked = Bun.spawnSync([process.execPath, cliPath, "impact", "--base", "HEAD~1", "--metadata", "missing-conflict.md", "--enforce-conflicts", "--json"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(blocked.exitCode).toBe(1);
    put(root, "retained-conflict.md", "```yaml\nchange_type: refactor\nsemantic_change: false\nwiki_action: verify\naffected_pages: [features/example]\naffected_invariants: []\ntouched_conflicts:\n  - id: C-900\n    action: retain\n    reason: The parser changed but the unresolved policy is unchanged.\nfresh_context:\n  verdict: PENDING\n  reviewed_head_sha: \"\"\n  bundle_digest: \"\"\n  reviewer: \"\"\n  evidence: []\n```\n");
    const allowed = Bun.spawnSync([process.execPath, cliPath, "impact", "--base", "HEAD~1", "--metadata", "retained-conflict.md", "--enforce-conflicts", "--json"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(allowed.exitCode).toBe(0);

    const allAfterBooleanFlag = Bun.spawnSync([process.execPath, cliPath, "conflicts", "--all", "C-900", "--json"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(allAfterBooleanFlag.exitCode).toBe(0);
    expect(JSON.parse(allAfterBooleanFlag.stdout.toString()).conflicts[0].id).toBe("C-900");
  });

  test("accepts a verified conflict resolution with source, current page, and evidence updates", () => {
    const root = tempRepo();
    const source = "src/feature.ts";
    const pagePath = "wiki/features/example.md";
    put(root, source, "export const allowed = false;\n");
    put(root, pagePath, frontmatter({ id: "features/example", kind: "feature", sources: [{ path: source }] }));
    put(root, "wiki/conflicts/open/C-900.md", conflictFrontmatter({ sources: [{ path: source }], affected_pages: ["features/example"] }));
    let view = createRepoView(root);
    put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "baseline"]);

    put(root, source, "export const allowed = true;\n");
    put(root, pagePath, `${frontmatter({ id: "features/example", kind: "feature", sources: [{ path: source }] })}\nThe example contract is enforced.\n`);
    rmSync(join(root, "wiki/conflicts/open/C-900.md"));
    put(root, "wiki/conflicts/resolved/C-900.md", conflictFrontmatter({
      status: "archived",
      sources: [{ path: source }],
      affected_pages: ["features/example"],
      resolution: {
        state: "verified",
        decision: "Adopt the example contract as the current behavior.",
        acceptance: ["Implement and test the missing contract."],
        evidence: ["src/feature.ts and its tests enforce the contract."],
      },
    }));
    run(root, ["git", "add", "."]);
    view = createRepoView(root);
    put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "resolve conflict"]);

    view = createRepoView(root);
    const report = impactReport(view, loadWikiPages(view).pages, { base: "HEAD~1", metadata: {
      change_type: "fix",
      semantic_change: true,
      wiki_action: "update",
      affected_pages: ["features/example"],
      affected_invariants: [],
      touched_conflicts: [{ id: "C-900", action: "resolve" }],
    } });
    expect(report.affectedConflicts.map((item) => item.id)).toEqual(["C-900"]);
    const conflictErrors = new Set([
      "conflict-not-declared",
      "conflict-resolution-incomplete",
      "conflict-resolution-evidence",
      "conflict-resolution-page-update",
      "conflict-resolution-source",
    ]);
    expect(report.findings.map((item) => item.code).filter((code) => conflictErrors.has(code))).toEqual([]);
  });

  test("blocks a newly introduced high-severity implementation conflict", () => {
    const root = tempRepo();
    const source = "src/policy.ts";
    put(root, source, "export const safe = true;\n");
    put(root, "wiki/product/test.md", frontmatter({ sources: [{ path: source }] }));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "baseline"]);
    put(root, source, "export const safe = false;\n");
    put(root, "wiki/conflicts/open/C-900.md", conflictFrontmatter({ origin: "introduced_by_change", sources: [{ path: source }] }));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "introduce unsafe behavior"]);
    const view = createRepoView(root);
    const report = impactReport(view, loadWikiPages(view).pages, { base: "HEAD~1", metadata: {
      change_type: "feature",
      semantic_change: true,
      wiki_action: "update",
      affected_pages: ["product/test"],
      affected_invariants: [],
      touched_conflicts: [{ id: "C-900", action: "introduce" }],
    } });
    expect(report.findings.map((item) => item.code)).toContain("conflict-introduced-high-risk");
  });

  test("does not let a new conflict masquerade as retained or resolved", () => {
    const root = tempRepo();
    const source = "src/policy.ts";
    put(root, source, "export const safe = true;\n");
    put(root, "wiki/product/test.md", frontmatter({ sources: [{ path: source }] }));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "baseline"]);
    put(root, source, "export const safe = false;\n");
    put(root, "wiki/conflicts/open/C-900.md", conflictFrontmatter({ origin: "introduced_by_change", sources: [{ path: source }] }));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "introduce unsafe behavior"]);
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const metadata = {
      change_type: "feature",
      semantic_change: true,
      wiki_action: "update" as const,
      affected_pages: ["product/test"],
      affected_invariants: [],
    };

    const retained = impactReport(view, pages, { base: "HEAD~1", metadata: {
      ...metadata,
      touched_conflicts: [{ id: "C-900", action: "retain", reason: "The new unsafe behavior remains intentionally unresolved for later work." }],
    } });
    expect(retained.findings.map((item) => item.code)).toContain("conflict-retain-missing-base");

    const resolved = impactReport(view, pages, { base: "HEAD~1", metadata: {
      ...metadata,
      touched_conflicts: [{ id: "C-900", action: "resolve" }],
    } });
    expect(resolved.findings.map((item) => item.code)).toContain("conflict-resolve-missing-base");
  });

  test("blocks low-risk stale verification", () => {
    const root = tempRepo();
    put(root, "docs/source.txt", "v1\n");
    put(root, "wiki/product/test.md", frontmatter({ sources: [{ path: "docs/source.txt" }] }));
    put(root, ".wiki/state.json", jsonStable({ version: 1, pages: { "product/test": { sources: { "docs/source.txt": hashContent("v1\n") }, verification: { kind: "updated" } } } }));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "baseline"]);
    put(root, "docs/source.txt", "v2\n");
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "low risk change"]);
    const report = impactReport(createRepoView(root), loadWikiPages(createRepoView(root)).pages, { base: "HEAD~1" });
    expect(report.advisoryStalePages).toEqual(["product/test"]);
    expect(report.highRiskStalePages).toEqual([]);
    expect(report.findings.find((item) => item.code === "stale-verification-low-risk")?.severity).toBe("error");
  });

  test("audits every current page state", () => {
    const lowPage = frontmatter({ sources: [{ path: "docs/source.txt" }] });
    const highPage = frontmatter({ id: "architecture/contracts", kind: "architecture", sources: [{ path: "packages/shared/src/contracts.ts" }] });
    const files = {
      ".wiki/config.json": jsonStable({ version: 1, name: "x", highRisk: ["packages/shared/**"] }),
      "docs/source.txt": "new low\n",
      "packages/shared/src/contracts.ts": "new high\n",
      "wiki/product/test.md": lowPage,
      "wiki/architecture/contracts.md": highPage,
      ".wiki/state.json": jsonStable({ version: 1, pages: {
        "product/test": { sources: { "docs/source.txt": hashContent("old low\n") }, verification: { kind: "updated" } },
        "architecture/contracts": { sources: { "packages/shared/src/contracts.ts": hashContent("old high\n") }, verification: { kind: "updated" } },
      } }),
    };
    const state = validateState(memoryView(files), loadWikiPages(memoryView(files)).pages);
    expect(state.highRiskStalePages).toEqual(["architecture/contracts"]);
    expect(state.advisoryStalePages).toEqual(["product/test"]);
    expect(state.findings.find((item) => item.code === "state-stale-high-risk")?.severity).toBe("error");
    expect(state.findings.find((item) => item.code === "state-stale-low-risk")?.severity).toBe("error");
  });

  test("passes a high-risk refactor after reasoned unchanged verification", () => {
    const root = tempRepo();
    const source = "packages/shared/src/contracts.ts";
    put(root, source, "export const contract = 'v1';\n");
    put(root, "wiki/architecture/contracts.md", frontmatter({ id: "architecture/contracts", kind: "architecture", sources: [{ path: source }] }));
    let view = createRepoView(root);
    put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "baseline"]);
    put(root, source, "// Internal organization only; exported behavior is unchanged.\nexport const contract = 'v1';\n");
    run(root, ["git", "add", source]);
    run(root, ["git", "commit", "-qm", "refactor contract"]);
    view = createRepoView(root);
    put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, ["architecture/contracts"], "Only internal organization changed; exported behavior remains identical.")));
    view = createRepoView(root);
    const report = impactReport(view, loadWikiPages(view).pages, { base: "HEAD~1", metadata: { change_type: "refactor", semantic_change: false, wiki_action: "verify", affected_pages: ["architecture/contracts"], affected_invariants: [], touched_conflicts: [] } });
    expect(report.stalePages).toEqual([]);
    expect(report.findings.filter((item) => item.severity === "error")).toEqual([]);
  });

  test("detects a new source through its glob mapping", () => {
    const root = tempRepo();
    put(root, ".wiki/config.json", jsonStable({ version: 1, name: "x", highRisk: ["db/migrations/**"] }));
    put(root, "db/migrations/0000_base.sql", "create table one (id text);\n");
    put(root, "wiki/architecture/data.md", frontmatter({ id: "architecture/data", kind: "architecture", sources: [{ glob: "db/migrations/*.sql" }] }));
    let view = createRepoView(root);
    put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "baseline"]);
    put(root, "db/migrations/0001_more.sql", "create table two (id text);\n");
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "add migration"]);
    view = createRepoView(root);
    const report = impactReport(view, loadWikiPages(view).pages, { base: "HEAD~1" });
    expect(report.affectedPages).toEqual(["architecture/data"]);
    expect(report.highRiskStalePages).toEqual(["architecture/data"]);
  });

  test("distinguishes invalid bases from valid empty origin/main diffs", () => {
    const root = tempRepo();
    put(root, "a.txt", "one\n");
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "one"]);
    put(root, "a.txt", "two\n");
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "two"]);
    run(root, ["git", "update-ref", "refs/remotes/origin/main", "HEAD"]);
    expect(changedFiles(root)).toEqual([]);
    expect(() => changedFiles(root, "does-not-exist")).toThrow("invalid --base");
  });

  test("includes a directly changed current page in impact", () => {
    const root = tempRepo();
    put(root, "source.ts", "export const value = 1;\n");
    put(root, "wiki/product/test.md", frontmatter());
    put(root, ".wiki/state.json", jsonStable({ version: 1, pages: { "product/test": { sources: { "source.ts": hashContent("export const value = 1;\n") }, verification: { kind: "updated" } } } }));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "baseline"]);
    put(root, "wiki/product/test.md", `${frontmatter()}\nChanged current explanation.\n`);
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "edit current page"]);
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    expect(impactReport(view, pages, { base: "HEAD~1" }).affectedPages).toEqual(["product/test"]);
    for (const changeType of ["proposal", "editorial", "reconcile"]) {
      const report = impactReport(view, pages, { base: "HEAD~1", metadata: { change_type: changeType, semantic_change: true, wiki_action: "update", affected_pages: ["product/test"], affected_invariants: [], touched_conflicts: [] } });
      expect(report.findings.map((item) => item.code)).not.toContain("current-doc-only-policy");
    }
    const invalid = impactReport(view, pages, { base: "HEAD~1", metadata: { change_type: "fix", semantic_change: true, wiki_action: "update", affected_pages: ["product/test"], affected_invariants: [], touched_conflicts: [] } });
    expect(invalid.findings.map((item) => item.code)).toContain("current-doc-only-policy");
  });

  test("allows a proposal-only semantic PR without current affected pages", () => {
    const root = tempRepo();
    put(root, "source.ts", "export const value = 1;\n");
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "baseline"]);
    put(root, "wiki/proposals/future.md", frontmatter({ id: "proposal/future", status: "proposed", authority: "normative" }));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "add proposal"]);
    const view = createRepoView(root);
    const report = impactReport(view, loadWikiPages(view).pages, { base: "HEAD~1", metadata: { change_type: "proposal", semantic_change: true, wiki_action: "update", affected_pages: [], affected_invariants: [], touched_conflicts: [] } });
    expect(report.affectedPages).toEqual([]);
    expect(report.findings.filter((item) => item.severity === "error")).toEqual([]);
  });

  test("detects an unmapped high-risk file", () => {
    const root = tempRepo();
    put(root, ".wiki/config.json", jsonStable({ version: 1, name: "x", highRisk: ["api/routes/**"] }));
    put(root, "README.md", "baseline\n");
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "baseline"]);
    put(root, "api/routes/new.ts", "export const newRoute = true;\n");
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "add route"]);
    const report = impactReport(createRepoView(root), [], { base: "HEAD~1" });
    expect(report.unmappedHighRisk).toEqual(["api/routes/new.ts"]);
    expect(report.findings.map((item) => item.code)).toContain("unmapped-high-risk");
  });

  test("detects a deleted current page and bundles its merge-base copy", () => {
    const root = tempRepo();
    put(root, "source.ts", "export const value = 1;\n");
    put(root, "wiki/product/test.md", frontmatter());
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "baseline"]);
    rmSync(join(root, "wiki/product/test.md"));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "delete current page"]);
    const view = createRepoView(root);
    const metadata = { change_type: "reconcile", semantic_change: true, wiki_action: "update" as const, affected_pages: ["product/test"], affected_invariants: [], touched_conflicts: [] };
    const report = impactReport(view, [], { base: "HEAD~1", metadata });
    expect(report.affectedPages).toEqual(["product/test"]);
    expect(report.removedCurrentPages).toEqual([{ id: "product/test", path: "wiki/product/test.md" }]);
    expect(report.findings.map((item) => item.code)).toContain("current-page-removed");
    expect(report.findings.map((item) => item.code)).not.toContain("metadata-page-unknown");
    const bundle = makeReviewBundle(view, [], report, undefined, metadata);
    temporary.push(bundle);
    expect(readFileSync(join(bundle, "pages/removed_product_test.md"), "utf8")).toContain("id: \"product/test\"");
  });

  test("detects a current page demoted in place", () => {
    const root = tempRepo();
    put(root, "source.ts", "export const value = 1;\n");
    put(root, "wiki/product/test.md", frontmatter());
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "baseline"]);
    put(root, "wiki/product/test.md", frontmatter({ status: "proposed", authority: "normative" }));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "demote current page"]);
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: { change_type: "reconcile", semantic_change: true, wiki_action: "update", affected_pages: ["product/test"], affected_invariants: [], touched_conflicts: [] } });
    expect(report.affectedPages).toEqual(["product/test"]);
    expect(report.removedCurrentPages).toEqual([{ id: "product/test", path: "wiki/product/test.md", headStatus: "proposed" }]);
    expect(report.findings.map((item) => item.code)).toContain("current-page-removed");
  });

  test("uses the true merge base when the base branch also advances", () => {
    const root = tempRepo();
    put(root, "source.ts", "export const value = 1;\n");
    put(root, "wiki/product/test.md", `${frontmatter()}\nMerge-base contract.\n`);
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "shared baseline"]);
    const baseline = run(root, ["git", "rev-parse", "HEAD"]).trim();
    run(root, ["git", "branch", "base"]);
    run(root, ["git", "checkout", "-qb", "feature"]);
    rmSync(join(root, "wiki/product/test.md"));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "remove page on feature"]);
    run(root, ["git", "checkout", "-q", "base"]);
    rmSync(join(root, "wiki/product/test.md"));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "base branch advances independently"]);
    run(root, ["git", "checkout", "-q", "feature"]);

    const view = createRepoView(root);
    const metadata = { change_type: "reconcile", semantic_change: true, wiki_action: "update" as const, affected_pages: ["product/test"], affected_invariants: [], touched_conflicts: [] };
    const report = impactReport(view, [], { base: "base", metadata });
    expect(report.mergeBase).toBe(baseline);
    expect(report.removedCurrentPages).toEqual([{ id: "product/test", path: "wiki/product/test.md" }]);
    const bundle = makeReviewBundle(view, [], report, undefined, metadata);
    temporary.push(bundle);
    expect(readFileSync(join(bundle, "pages/removed_product_test.md"), "utf8")).toContain("Merge-base contract.");
  });

  test("treats operations/config files as implementation evidence", () => {
    expect(isImplementationSourceChange(".github/workflows/checks.yml")).toBe(true);
    expect(isImplementationSourceChange("package.json")).toBe(true);
    expect(isImplementationSourceChange(".husky/pre-push")).toBe(true);
    expect(isImplementationSourceChange("wiki/operations/release.md")).toBe(false);
    expect(isImplementationSourceChange(".wiki/state.json")).toBe(false);
  });
});

