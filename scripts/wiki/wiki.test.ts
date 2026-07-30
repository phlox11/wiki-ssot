import { afterEach, describe, expect, test } from "bun:test";
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
} from "./core";

const temporary: string[] = [];
const cli = join(process.cwd(), "scripts/wiki/cli.ts");

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

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

describe("frontmatter schema", () => {
  test("accepts a valid current page", () => {
    const view = memoryView({ "source.ts": "export const value = 1", "wiki/product/test.md": frontmatter() });
    const loaded = loadWikiPages(view);
    expect(loaded.findings).toEqual([]);
    expect(validatePages(view, loaded.pages).filter((item) => item.severity === "error")).toEqual([]);
  });

  test("detects missing fields and invalid enums", () => {
    const raw = `---\nid: product/bad\nsummary: Bad\nkind: product\nstatus: live\nauthority: magic\nowners: []\nsources: []\n---\n`;
    const view = memoryView({ "wiki/product/bad.md": raw });
    const findings = validatePages(view, loadWikiPages(view).pages);
    expect(findings.map((item) => item.code)).toContain("frontmatter-status");
    expect(findings.map((item) => item.code)).toContain("frontmatter-authority");
    expect(findings.map((item) => item.code)).toContain("frontmatter-owners");
  });

  test("detects duplicate and dangling page IDs", () => {
    const first = frontmatter({ related: ["missing/page"] });
    const second = frontmatter({ summary: "Duplicate" });
    const view = memoryView({ "source.ts": "", "wiki/product/a.md": first, "wiki/product/b.md": second });
    const findings = validatePages(view, loadWikiPages(view).pages);
    expect(findings.map((item) => item.code)).toContain("duplicate-id");
    expect(findings.map((item) => item.code)).toContain("dangling-page-id");
  });

  test("rejects proposal-only evidence on a current page", () => {
    const view = memoryView({ "wiki/proposals/x.md": "proposal", "wiki/product/test.md": frontmatter({ sources: [{ path: "wiki/proposals/x.md" }] }) });
    expect(validatePages(view, loadWikiPages(view).pages).map((item) => item.code)).toContain("proposal-only-current");
  });

  test("validates open and resolved conflict lifecycle fields", () => {
    const validOpen = conflictFrontmatter();
    const openView = memoryView({
      "source.ts": "export const value = 1",
      "wiki/product/test.md": frontmatter(),
      "wiki/conflicts/open/C-900.md": validOpen,
    });
    expect(validatePages(openView, loadWikiPages(openView).pages).filter((item) => item.severity === "error")).toEqual([]);

    const invalid = conflictFrontmatter({ opened_at: "2026-02-30", sources: [], affected_pages: [], resolution: { state: "verified", acceptance: [] } });
    const invalidView = memoryView({ "source.ts": "", "wiki/product/test.md": frontmatter(), "wiki/conflicts/open/C-900.md": invalid });
    expect(validatePages(invalidView, loadWikiPages(invalidView).pages).map((item) => item.code)).toEqual(expect.arrayContaining([
      "conflict-opened-at",
      "conflict-without-source",
      "conflict-affected-pages",
      "conflict-acceptance",
    ]));

    const resolved = conflictFrontmatter({ status: "archived", resolution: { state: "verified", decision: "The implementation contract was adopted.", acceptance: ["Implemented."], evidence: ["source.ts and its test prove the behavior."] } });
    const resolvedView = memoryView({ "source.ts": "", "wiki/product/test.md": frontmatter(), "wiki/conflicts/resolved/C-900.md": resolved });
    expect(validatePages(resolvedView, loadWikiPages(resolvedView).pages).filter((item) => item.severity === "error")).toEqual([]);
  });
});

describe("Markdown links", () => {
  test("checks relative files but ignores URLs and code", () => {
    const view = memoryView({
      "docs/a.md": "[ok](./b.md) [bad](./missing.md) [web](https://example.com) `x[](missing-inline)`\n```md\n[x](missing-code)\n```",
      "docs/b.md": "# B",
    });
    const findings = validateMarkdownLinks(view);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("missing.md");
  });

  test("honors a non-expired legacy allowlist", () => {
    const view = memoryView({
      "a.md": "[old](missing.md)",
      ".wiki/legacy-link-allowlist.json": jsonStable([{ source: "a.md", target: "missing.md", reason: "Temporary legacy drift with an explicit replacement plan.", expires: "2099-01-01" }]),
    });
    expect(validateMarkdownLinks(view)).toEqual([]);
  });
});

describe("staged snapshot", () => {
  test("ignores an unstaged error after a valid page is staged", () => {
    const root = tempRepo();
    put(root, "source.ts", "export const value = 1;\n");
    put(root, "wiki/product/test.md", frontmatter());
    run(root, ["git", "add", "."]);
    put(root, "wiki/product/test.md", "not frontmatter\n");
    const staged = createRepoView(root, true);
    expect(staged.read("wiki/product/test.md")).toContain("id: \"product/test\"");
    expect(loadWikiPages(staged).findings).toEqual([]);
  });

  test("reads a newly staged file from the index", () => {
    const root = tempRepo();
    put(root, "new.md", "staged content\n");
    run(root, ["git", "add", "new.md"]);
    expect(createRepoView(root, true).read("new.md")).toBe("staged content\n");
  });
});

describe("baseline-proven query relevance", () => {
  test("prefers pages matching the complete PV-05 task over partial-term noise", () => {
    const root = tempRepo();
    const task = "Add support for partial refunds while preserving the checkout total and currency rules.";
    put(root, "src/checkout/refunds.ts", "export const refunds = true;\n");
    put(root, "src/orders/service.ts", "export const orders = true;\n");
    put(root, "wiki/features/checkout.md", `${frontmatter({
      id: "features/checkout",
      summary: "Checkout refund contract.",
      kind: "feature",
      sources: [{ path: "src/checkout/refunds.ts" }],
    })}\n${task}\n`);
    put(root, "wiki/features/orders.md", `${frontmatter({
      id: "features/orders",
      summary: "Order export contract.",
      kind: "feature",
      sources: [{ path: "src/orders/service.ts" }],
    })}\nSupport order exports without changing their behavior.\n`);

    const search = run(root, [process.execPath, cli, "search", task, "--root", root]);
    expect(search.split("\n").filter(Boolean).map((line) => line.split("\t")[0])).toEqual(["features/checkout"]);

    const context = run(root, [process.execPath, cli, "context", task, "--root", root]);
    expect(context).toContain("# features/checkout");
    expect(context).not.toContain("# features/orders");
  });

  test("keeps deterministic partial matches when no page contains every query term", () => {
    const pages = [
      parseWikiPage("wiki/features/checkout.md", `${frontmatter({
        id: "features/checkout",
        summary: "Refund checkout behavior.",
        kind: "feature",
      })}\nPartial refunds are supported.\n`),
      parseWikiPage("wiki/features/orders.md", `${frontmatter({
        id: "features/orders",
        summary: "Order export behavior.",
        kind: "feature",
      })}\nOrder exports are supported.\n`),
    ];
    expect(searchWikiPages(pages, "refund order").map((item) => item.page.data.id)).toEqual([
      "features/checkout",
      "features/orders",
    ]);
  });
});

describe("deterministic generated data", () => {
  const page = parseWikiPage("wiki/product/test.md", frontmatter()) as WikiPage;
  const conflict = parseWikiPage("wiki/conflicts/open/C-900.md", conflictFrontmatter()) as WikiPage;

  test("index, status, and source map are byte stable", () => {
    expect(generateIndex([page, conflict])).toBe(generateIndex([page, conflict]));
    expect(generateCurrentStatus([page, conflict])).toContain("Open conflicts (1)");
    expect(generateConflictsIndex([page, conflict])).toContain("C-900");
    expect(jsonStable(buildSourceMap([page, conflict]))).toBe(jsonStable(buildSourceMap([page, conflict])));
    expect(mappedConflicts(buildConflictMap([page, conflict]), "source.ts")).toEqual(["C-900"]);
  });

  test("detects manual generated edits", () => {
    const expected = generatedCoreFiles([page]);
    const files = { "source.ts": "", "wiki/product/test.md": frontmatter(), ...expected, "wiki/index.md": `${expected["wiki/index.md"]}manual\n` };
    expect(compareGenerated(memoryView(files), expected).map((item) => item.code)).toContain("generated-stale");
  });

  test("hashes identical content identically", () => {
    expect(hashContent("same")).toBe(hashContent("same"));
    expect(hashContent("same")).not.toBe(hashContent("different"));
  });
});

describe("inventory and impact primitives", () => {
  test("maps exact paths and globs", () => {
    const map = { version: 1 as const, exact: { "a.ts": ["exact"] }, globs: [{ glob: "src/**/*.ts", pages: ["glob"] }] };
    expect(mappedPages(map, "a.ts")).toEqual(["exact"]);
    expect(mappedPages(map, "src/x/y.ts")).toEqual(["glob"]);
    const config = { version: 1 as const, name: "x", highRisk: ["src/api/**"], publishesKit: false };
    expect(isHighRisk(config, "src/api/routes.ts")).toBe(true);
    expect(isHighRisk(config, "src/ui/button.ts")).toBe(false);
  });

  test("parses the PR YAML contract", () => {
    const metadata = parsePrMetadata("before\n```yaml\nchange_type: feature\nsemantic_change: true\nwiki_action: update\naffected_pages: []\naffected_invariants: []\ntouched_conflicts: []\n```\nafter");
    expect(metadata?.change_type).toBe("feature");
    expect(metadata?.semantic_change).toBe(true);
    expect(metadata?.touched_conflicts).toEqual([]);
  });

  test("rejects missing and malformed PR metadata fields", () => {
    expect(validatePrMetadata(undefined, true).findings.map((item) => item.code)).toContain("metadata-missing");
    const invalid = validatePrMetadata("```yaml\nchange_type: magic\nsemantic_change: yes\nwiki_action: potato\naffected_pages: nope\naffected_invariants: []\ntouched_conflicts: nope\n```");
    expect(invalid.metadata).toBeUndefined();
    expect(invalid.findings.map((item) => item.code)).toEqual(expect.arrayContaining(["metadata-change-type", "metadata-semantic-change", "metadata-wiki-action", "metadata-affected-pages", "metadata-touched-conflicts"]));
    const shortRetain = validatePrMetadata("```yaml\nchange_type: refactor\nsemantic_change: false\nwiki_action: verify\naffected_pages: []\naffected_invariants: []\ntouched_conflicts:\n  - id: C-008\n    action: retain\n    reason: too short\n```");
    expect(shortRetain.findings.map((item) => item.code)).toContain("metadata-conflict-retain-reason");
    expect(isConflictGuardFinding({ code: "metadata-conflict-retain-reason", message: "x", severity: "error" })).toBe(true);
    expect(isConflictGuardFinding({ code: "stale-verification", message: "x", severity: "error" })).toBe(false);
  });

  test("requires major source coverage and accepts reasoned exclusions", () => {
    const config = { version: 1, include: ["src/**/*.ts"], exclusions: [{ glob: "src/generated.ts", reason: "Generated test evidence is excluded from maintained behavior." }] };
    const raw = frontmatter({ sources: [{ path: "src/mapped.ts" }] });
    const view = memoryView({
      ".wiki/coverage.json": jsonStable(config),
      "src/mapped.ts": "export const mapped = true;",
      "src/unmapped.ts": "export const unmapped = true;",
      "src/generated.ts": "generated",
      "wiki/product/test.md": raw,
    });
    const findings = validateCoverage(view, loadWikiPages(view).pages);
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe("src/unmapped.ts");
    expect(findings[0].message).toContain("add this path to a current page's sources");
  });

  test("reports empty and invalid coverage patterns without crashing", () => {
    const view = memoryView({
      ".wiki/coverage.json": jsonStable({ version: 1, include: ["typo/**/*.ts"], exclusions: [{ glob: 42, reason: "This malformed exclusion has a sufficiently long reason." }] }),
    });
    const codes = validateCoverage(view, []).map((item) => item.code);
    expect(codes).toContain("coverage-include-empty");
    expect(codes).toContain("coverage-exclusion-invalid");
  });
});

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
