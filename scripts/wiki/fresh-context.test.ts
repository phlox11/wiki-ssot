import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildFocusedReviewManifest,
  buildReviewManifest,
  createRepoView,
  evaluateFreshContextRequirement,
  hashContent,
  impactReport,
  jsonStable,
  loadWikiPages,
  makeReviewBundle,
  parseFreshContextPolicy,
  reviewCheck,
  validateFreshContextAttestation,
  validateFreshContextFindings,
  validateFocusedReviewManifest,
  validateIntegrationSeams,
  validatePrMetadata,
  verifyState,
  type ConflictSummary,
  type FreshContextFinding,
  type FreshContextPolicy,
  type FreshContextReportV1,
  type FreshContextReportV2,
  type PrMetadata,
  type ReviewManifest,
  type FocusedReviewManifest,
} from "./core";
import { GITHUB_ATTESTATION_MARKER, selectGitHubAttestation, validateGitHubIntegrationSeams } from "./github-attestation";

const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function run(root: string, command: string[]) {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

function put(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function policy(overrides: Partial<FreshContextPolicy> = {}): FreshContextPolicy {
  return {
    mode: "required",
    requiredVerdict: "PASS",
    evidenceRequired: true,
    trust: {
      allowedReviewers: ["trusted-reviewer"],
      requireDifferentActor: true,
      requireAuthenticatedActor: true,
    },
    ...overrides,
  };
}

type AgentEntrypointClauses = {
  authority: string;
  work: string;
  selected: string;
  topic: string;
  nonCurrent: string;
  humanWork: string;
};

function providerNeutralAgentEntrypoint(overrides: Partial<AgentEntrypointClauses> = {}): string {
  const clauses: AgentEntrypointClauses = {
    authority: "Start at wiki/index.md, then read wiki/current-status.md and every kind: invariant page.",
    work: "If the user asks what remains or what is unfinished without naming a task, run bun run wiki:work before topic search; do not require a known node, work ID, or search term.",
    selected: "After selecting a returned item, run the printed wiki:context -- --work <ID> command.",
    topic: `Search before editing with wiki:search -- "<task terms>" and wiki:context -- "<task terms>".`,
    nonCurrent: "Pages with status proposed, conflicted, deprecated, or archived must be labelled non-current.",
    humanWork: "Do not automatically select executor: human work. Keep it visible, report the required work and procedure, and hand it off to a human without assuming their credentials or authority. executor: either does not expand external-write, destructive-action, or other permissions.",
    ...overrides,
  };
  return `<!-- wiki-ssot:fresh-context-guardrail -->
# Agent instructions

${clauses.authority}
<!-- wiki-ssot:work-discovery -->
${clauses.work}
${clauses.selected}
${clauses.topic}
${clauses.nonCurrent}
${clauses.humanWork}
`;
}

function coreIntegrationView(agents: string, scripts: Record<string, string> = {
  "wiki:review-preflight": "bun scripts/wiki/cli.ts review-preflight",
  "wiki:review-check": "bun scripts/wiki/cli.ts review-check",
  "wiki:doctor": "bun scripts/wiki/cli.ts doctor",
  "wiki:work": "bun scripts/wiki/cli.ts work",
}) {
  return {
    root: "/memory",
    mode: "working" as const,
    listFiles: () => [".wiki/config.json", "AGENTS.md", "package.json"],
    exists: (path: string) => [".wiki/config.json", "AGENTS.md", "package.json"].includes(path),
    read: (path: string) => ({
      ".wiki/config.json": jsonStable({
        version: 1,
        name: "x",
        highRisk: [],
        freshContext: policy(),
      }),
      "AGENTS.md": agents,
      "package.json": jsonStable({ scripts }),
    })[path] ?? "",
  };
}

function page(source = "source.ts", body = "The current contract is version two.", kind = "product"): string {
  return `---
id: product/test
summary: Test contract.
kind: ${kind}
status: current
authority: observed
owners: ["@owner"]
sources:
  - path: ${source}
---

# Test

${body}
`;
}

function metadata(overrides: Partial<PrMetadata> = {}): PrMetadata {
  return {
    change_type: "feature",
    semantic_change: true,
    wiki_action: "update",
    affected_pages: ["product/test"],
    affected_invariants: [],
    touched_conflicts: [],
    ...overrides,
  };
}

function tempReviewRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-review-attestation-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Test"]);
  run(root, ["git", "config", "user.email", "wiki@example.invalid"]);
  put(root, ".wiki/config.json", jsonStable({
    version: 1,
    name: "test",
    highRisk: ["source.ts"],
    freshContext: policy(),
  }));
  put(root, "source.ts", "export const contract = 'v1';\n");
  put(root, "wiki/product/test.md", page("source.ts", "The current contract is version one."));
  let view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "baseline"]);

  put(root, "source.ts", "export const contract = 'v2';\n");
  put(root, "wiki/product/test.md", page());
  view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "feature"]);
  return root;
}

/** A small in-repository fixture exercising every TE-04 focused role. */
function tempFocusedReviewRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-review-focused-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Test"]);
  run(root, ["git", "config", "user.email", "wiki@example.invalid"]);
  put(root, ".wiki/config.json", jsonStable({ version: 1, name: "focused", highRisk: ["source.ts", "scripts/wiki/**/*.ts"], freshContext: policy() }));
  put(root, "source.ts", "export const contract = 'v1';\n");
  put(root, "scripts/wiki/te04.test.ts", "test('contract', () => expect(true).toBe(true));\n");
  put(root, "wiki/product/invariants.md", page("source.ts", "The invariant contract is version one.", "invariant").replace("id: product/test", "id: product/invariants"));
  put(root, "wiki/product/test.md", page("source.ts", "The current contract is version one."));
  put(root, "wiki/conflicts/open/C-001.md", conflictPage());
  let view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "focused baseline"]);

  put(root, "source.ts", "export const contract = 'v2';\n");
  put(root, "scripts/wiki/te04.test.ts", "test('contract', () => expect('v2').toBe('v2'));\n");
  put(root, "wiki/product/invariants.md", page("source.ts", "The invariant contract is version two.", "invariant").replace("id: product/test", "id: product/invariants"));
  put(root, "wiki/product/test.md", page("source.ts", "The current contract is version two."));
  view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "focused change"]);
  return root;
}

/** A merge-base glob fixture with empty blobs on both lifecycle edges. */
function tempMergeBaseGlobReviewRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-review-merge-base-glob-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Test"]);
  run(root, ["git", "config", "user.email", "wiki@example.invalid"]);
  put(root, ".wiki/config.json", jsonStable({ version: 1, name: "merge-base-glob", highRisk: ["src/**/*.ts"], freshContext: policy() }));
  put(root, "src/removed.ts", "");
  put(root, "src/empty-head.ts", "seed");
  put(root, "wiki/product/invariants.md", page("src/**/*.ts", "The invariant contract is version one.", "invariant")
    .replace("id: product/test", "id: product/invariants")
    .replace("  - path: src/**/*.ts", "  - glob: \"src/**/*.ts\""));
  let view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "merge-base glob baseline"]);

  rmSync(join(root, "src/removed.ts"));
  put(root, "src/empty-head.ts", "");
  put(root, "wiki/product/invariants.md", page("src/**/*.ts", "The invariant contract is version two.", "invariant")
    .replace("id: product/test", "id: product/invariants")
    .replace("  - path: src/**/*.ts", "  - glob: \"src/**/*.ts\""));
  // Refresh the index before constructing the working-tree view so a deleted
  // tracked path is not reported as readable by createRepoView.
  run(root, ["git", "add", "-A"]);
  view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "merge-base glob change"]);
  return root;
}

/** A fixture with one unchanged exact authority source and one changed exact authority source. */
function tempAuthoritySourceReviewRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-review-authority-source-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Test"]);
  run(root, ["git", "config", "user.email", "wiki@example.invalid"]);
  put(root, ".wiki/config.json", jsonStable({ version: 1, name: "authority-source", highRisk: ["README.md"], freshContext: policy() }));
  put(root, "README.md", "authority source baseline\n");
  put(root, "wiki/product/invariants.md", page("README.md", "The authority contract is version one.", "invariant")
    .replace("id: product/test", "id: product/invariants")
    .replace("  - path: README.md", "  - path: .wiki/config.json\n  - path: README.md"));
  let view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "authority source baseline"]);

  put(root, "README.md", "authority source changed\n");
  put(root, "wiki/product/invariants.md", page("README.md", "The authority contract is version two.", "invariant")
    .replace("id: product/test", "id: product/invariants")
    .replace("  - path: README.md", "  - path: .wiki/config.json\n  - path: README.md"));
  view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "authority source change"]);
  return root;
}

/** A non-invariant current page whose merge-base glob explains a deleted empty source. */
function tempNonInvariantMergeBaseGlobReviewRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-review-product-merge-base-glob-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Test"]);
  run(root, ["git", "config", "user.email", "wiki@example.invalid"]);
  put(root, ".wiki/config.json", jsonStable({ version: 1, name: "product-merge-base-glob", highRisk: ["src/**/*.ts"], freshContext: policy() }));
  put(root, "src/removed.ts", "");
  put(root, "wiki/product/test.md", page("src/**/*.ts", "The product contract is version one.")
    .replace("  - path: src/**/*.ts", "  - glob: \"src/**/*.ts\""));
  let view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "product merge-base glob baseline"]);

  rmSync(join(root, "src/removed.ts"));
  put(root, "wiki/product/test.md", page("src/**/*.ts", "The product contract is version two.")
    .replace("  - path: src/**/*.ts", "  - glob: \"src/**/*.ts\""));
  run(root, ["git", "add", "-A"]);
  view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "product merge-base glob change"]);
  return root;
}

/** A conflict-only change whose affected invariant is not otherwise impacted. */
function tempConflictInvariantAuthorityReviewRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-review-conflict-invariant-authority-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Test"]);
  run(root, ["git", "config", "user.email", "wiki@example.invalid"]);
  put(root, ".wiki/config.json", jsonStable({ version: 1, name: "conflict-invariant-authority", highRisk: [], freshContext: policy() }));
  put(root, "invariant.ts", "export const invariant = true;\n");
  put(root, "conflict.ts", "export const conflict = false;\n");
  put(root, "wiki/product/invariants.md", page("invariant.ts", "The invariant contract remains stable.", "invariant").replace("id: product/test", "id: product/invariants"));
  const conflict = conflictPage()
    .replace("  - path: source.ts", "  - path: conflict.ts")
    .replace("affected_pages: [product/test]", "affected_pages: []")
    .replace("affected_invariants: []", "affected_invariants: [product/invariants]");
  put(root, "wiki/conflicts/open/C-001.md", conflict);
  let view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "conflict invariant authority baseline"]);

  put(root, "wiki/conflicts/open/C-001.md", `${conflict}\nCandidate evidence was refreshed.\n`);
  view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "conflict-only change"]);
  return root;
}

/** Affected page removes an exact source declaration that still exists at HEAD. */
function tempAffectedPageBaseExactReviewRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-review-affected-base-exact-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Test"]);
  run(root, ["git", "config", "user.email", "wiki@example.invalid"]);
  put(root, ".wiki/config.json", jsonStable({ version: 1, name: "affected-base-exact", highRisk: [], freshContext: policy() }));
  put(root, "old.ts", "export const oldSource = true;\n");
  put(root, "new.ts", "export const newSource = true;\n");
  put(root, "wiki/product/test.md", page("old.ts", "The affected page is version one."));
  let view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "affected base exact baseline"]);

  put(root, "wiki/product/test.md", page("new.ts", "The affected page is version two."));
  view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "affected base exact change"]);
  return root;
}

/** Affected page removes a glob while deleting its empty merge-base match. */
function tempAffectedPageBaseGlobReviewRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-review-affected-base-glob-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Test"]);
  run(root, ["git", "config", "user.email", "wiki@example.invalid"]);
  put(root, ".wiki/config.json", jsonStable({ version: 1, name: "affected-base-glob", highRisk: ["src/**/*.ts"], freshContext: policy() }));
  put(root, "src/removed.ts", "");
  put(root, "new.ts", "export const replacement = true;\n");
  put(root, "wiki/product/test.md", page("src/**/*.ts", "The affected glob page is version one.")
    .replace("  - path: src/**/*.ts", "  - glob: \"src/**/*.ts\""));
  let view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "affected base glob baseline"]);

  rmSync(join(root, "src/removed.ts"));
  put(root, "wiki/product/test.md", page("new.ts", "The affected glob page is version two."));
  run(root, ["git", "add", "-A"]);
  view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "affected base glob change"]);
  return root;
}

function rebindFocusedBundle(candidate: FocusedReviewManifest, files: Record<string, string>, manifest: ReviewManifest): { files: Record<string, string>; manifest: ReviewManifest } {
  const focusedRaw = jsonStable(candidate);
  const rebound = {
    ...manifest,
    file_digests: { ...manifest.file_digests, "focused-manifest.json": hashContent(focusedRaw) },
    focused_manifest_digest: hashContent(focusedRaw),
  } as ReviewManifest;
  const core = { ...rebound } as Record<string, unknown>;
  delete core.bundle_digest;
  rebound.bundle_digest = hashContent(jsonStable(core));
  return { files: { ...files, "focused-manifest.json": focusedRaw }, manifest: rebound };
}

function manifestFor(root: string, prMetadata = metadata()): ReviewManifest {
  const view = createRepoView(root);
  const pages = loadWikiPages(view).pages;
  const impact = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
  return buildReviewManifest(view, pages, impact, prMetadata);
}

function reportFor(manifest: ReviewManifest, overrides: Partial<FreshContextReportV1> = {}): FreshContextReportV1 {
  return {
    version: 1,
    verdict: "PASS",
    reviewed_head_sha: manifest.head_sha,
    merge_base_sha: manifest.merge_base_sha,
    bundle_digest: manifest.bundle_digest,
    reviewer: "trusted-reviewer",
    evidence: ["Reviewed the diff, affected page, source, invariant set, and metadata independently."],
    summary: "The implementation evidence and current wiki contract agree.",
    ...overrides,
  };
}

function reportV2For(manifest: ReviewManifest, overrides: Partial<FreshContextReportV2> = {}): FreshContextReportV2 {
  const { version: _version, findings: _findings, ...base } = reportFor(manifest);
  return { ...base, version: 2, ...overrides };
}

function findingFor(overrides: Partial<FreshContextFinding> = {}): FreshContextFinding {
  return {
    id: "FC-001",
    classification: "preexisting_implementation_mismatch",
    disposition: "existing_conflict_linked",
    conflict_id: "C-001",
    scope_refs: ["page:product/test", "source:source.ts"],
    discrepancy: "The current page states version two while the implementation still exports version one.",
    authority: { kind: "normative", ref: "wiki/product/test.md" },
    acceptance_criteria: ["The exported contract constant matches the current page."],
    evidence: ["source.ts"],
    ...overrides,
  };
}

function codes(result: ReturnType<typeof validateFreshContextAttestation>): string[] {
  return result.findings.map((finding) => finding.code);
}

function conflictFor(overrides: Partial<ConflictSummary> = {}): ConflictSummary {
  return {
    id: "C-001",
    pageId: "conflict/C-001",
    path: "wiki/conflicts/open/C-001.md",
    summary: "The current page and the implementation disagree about the exported contract.",
    type: "implementation",
    severity: "medium",
    origin: "baseline",
    openedAt: "2026-07-24",
    state: "open",
    owner: ["@owner"],
    affectedPages: ["product/test"],
    affectedInvariants: [],
    acceptance: ["The exported contract constant matches the current page."],
    sources: [{ path: "source.ts" }],
    ...overrides,
  };
}

function conflictPage(overrides: { type?: string; origin?: string } = {}): string {
  return `---
id: conflict/C-001
conflict_id: C-001
summary: The current page and the implementation disagree about the exported contract.
kind: conflict
status: conflicted
authority: observed
owners: ["@owner"]
conflict_type: ${overrides.type ?? "implementation"}
severity: medium
origin: ${overrides.origin ?? "baseline"}
opened_at: 2026-07-24
sources:
  - path: source.ts
affected_pages: [product/test]
affected_invariants: []
resolution:
  state: open
  decision: null
  acceptance:
    - The exported contract constant matches the current page.
---

# Contract version disagreement
`;
}

/** Adjudicates one finding against a repository that holds `conflicts`. */
function adjudicate(finding: FreshContextFinding, conflicts: ConflictSummary[] = [conflictFor()]): string[] {
  return validateFreshContextFindings([finding], "error", conflicts).map((item) => item.code);
}

describe("fresh-context review manifest", () => {
  test("is byte-identical and digest-identical for the same repository state", () => {
    const root = tempReviewRepo();
    const first = manifestFor(root);
    const second = manifestFor(root);
    expect(jsonStable(first)).toBe(jsonStable(second));
    expect(first.bundle_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.head_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(first.merge_base_sha).toMatch(/^[0-9a-f]{40}$/);

    const one = makeReviewBundle(createRepoView(root), loadWikiPages(createRepoView(root)).pages, impactReport(createRepoView(root), loadWikiPages(createRepoView(root)).pages, { base: "HEAD~1", metadata: metadata() }), "bundle-one", metadata());
    const two = makeReviewBundle(createRepoView(root), loadWikiPages(createRepoView(root)).pages, impactReport(createRepoView(root), loadWikiPages(createRepoView(root)).pages, { base: "HEAD~1", metadata: metadata() }), "bundle-two", metadata());
    expect(readFileSync(join(one, "manifest.json"), "utf8")).toBe(readFileSync(join(two, "manifest.json"), "utf8"));
    expect(hashContent(readFileSync(join(one, "PROMPT.md"), "utf8"))).toBe("62172d6a4e012dafb52e5172c4b98c90e7ace311f0bb9dfcaf82f0ca6a3c795f");
    expect(hashContent(readFileSync(join(one, "REPORT.md"), "utf8"))).toBe("67e53b0950c120a27d7c6ae2bb9312094216f04eaf7df7f42f983e214dd7767e");
    expect(JSON.parse(readFileSync(join(one, "impact.json"), "utf8")).affectedInvariants).toBeUndefined();
    expect(existsSync(join(one, "REPORT.example.json"))).toBe(true);
    expect(existsSync(join(one, "REPORT.md"))).toBe(true);
  });

  test("stores overlapping page and invariant bodies once and rejects focused-input tampering", () => {
    const root = tempFocusedReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({
      affected_pages: ["product/invariants", "product/test"],
      affected_invariants: ["product/invariants"],
      touched_conflicts: [{ id: "C-001", action: "retain", reason: "The baseline conflict remains relevant to this focused review." }],
    });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    expect(report.affectedPages).toContain("product/invariants");
    expect(report.affectedConflicts.map((conflict) => conflict.id)).toContain("C-001");
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const bundle = makeReviewBundle(view, pages, report, "focused-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    const invariantRoles = focused.body_roles.filter((role) => role.id === "product/invariants");
    expect(invariantRoles.map((role) => role.role)).toEqual(["affected_page", "invariant"]);
    expect(invariantRoles[0].digest).toBe(invariantRoles[1].digest);
    expect(focused.objects.filter((object) => object.digest === invariantRoles[0].digest)).toHaveLength(1);
    const conflictAlias = join(bundle, "conflicts/C-001.md");
    expect(lstatSync(conflictAlias).isSymbolicLink()).toBe(true);
    expect(readlinkSync(conflictAlias)).toContain("../objects/");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const clone = (): FocusedReviewManifest => JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const missing = (role: string, id: string) => {
      const candidate = clone();
      candidate.body_roles = candidate.body_roles.filter((item) => !(item.role === role && item.id === id));
      return validateFocusedReviewManifest(candidate, files, reviewManifest).map((finding) => finding.code);
    };
    expect(missing("affected_page", "product/invariants")).toContain("focused-manifest-affected_page-missing");
    expect(missing("invariant", "product/invariants")).toContain("focused-manifest-invariant-missing");
    expect(missing("conflict", "C-001")).toContain("focused-manifest-conflict-missing");

    const changedSource = clone();
    const source = changedSource.source_roles.find((item) => item.path === "source.ts");
    if (!source) throw new Error("focused source fixture did not classify source.ts");
    source.roles = source.roles.filter((role) => role !== "changed_source");
    expect(validateFocusedReviewManifest(changedSource, files, reviewManifest).map((finding) => finding.code)).toContain("focused-manifest-changed-source-required");

    const changedTest = clone();
    const testSource = changedTest.source_roles.find((item) => item.path === "scripts/wiki/te04.test.ts");
    if (!testSource) throw new Error("focused source fixture did not classify the changed test");
    testSource.roles = testSource.roles.filter((role) => role !== "relevant_test");
    expect(validateFocusedReviewManifest(changedTest, files, reviewManifest).map((finding) => finding.code)).toContain("focused-manifest-relevant-test-required");

    const tampered = clone();
    const objectPath = tampered.objects[0].object_path;
    const tamperedFiles = { ...files, [objectPath]: `${files[objectPath]}tampered` };
    expect(validateFocusedReviewManifest(tampered, tamperedFiles, reviewManifest).map((finding) => finding.code)).toContain("focused-manifest-object-digest");

    // An attacker cannot hide a changed path by editing the focused index and
    // recomputing every focused/enclosing digest: impact.json remains the
    // digest-bound canonical changed-file set.
    const omitted = clone();
    const omittedSource = omitted.source_roles.find((item) => item.path === "source.ts");
    if (!omittedSource) throw new Error("focused source fixture did not classify source.ts for omission test");
    const omittedDeclarationIds = new Set(omittedSource.declaration_ids);
    omitted.changed_files = omitted.changed_files.filter((path) => path !== "source.ts");
    omitted.source_roles = omitted.source_roles.filter((item) => item.path !== "source.ts");
    omitted.source_declarations = omitted.source_declarations.filter((declaration) => !omittedDeclarationIds.has(declaration.id));
    const omittedFocusedRaw = jsonStable(omitted);
    const omittedManifest = {
      ...reviewManifest,
      file_digests: { ...reviewManifest.file_digests, "focused-manifest.json": hashContent(omittedFocusedRaw) },
      focused_manifest_digest: hashContent(omittedFocusedRaw),
    } as ReviewManifest;
    const omittedManifestCore = { ...omittedManifest } as Record<string, unknown>;
    delete omittedManifestCore.bundle_digest;
    omittedManifest.bundle_digest = hashContent(jsonStable(omittedManifestCore));
    const omittedFiles = { ...files, "focused-manifest.json": omittedFocusedRaw };
    const omittedCodes = validateFocusedReviewManifest(omitted, omittedFiles, omittedManifest).map((finding) => finding.code);
    expect(omittedCodes).toContain("focused-manifest-changed-files-binding");
    expect(omittedCodes).toContain("focused-manifest-changed-source-binding");
  });

  test("expands merge-base glob provenance for removed sources and hashes empty blobs", () => {
    const root = tempMergeBaseGlobReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/invariants"], affected_invariants: ["product/invariants"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const removed = focused.source_roles.find((source) => source.path === "src/removed.ts");
    const emptyHead = focused.source_roles.find((source) => source.path === "src/empty-head.ts");
    if (!removed || !emptyHead) throw new Error("merge-base glob fixture did not bind both changed source paths");

    expect(removed.lifecycle).toBe("removed");
    expect(removed.head_digest).toBeUndefined();
    expect(removed.merge_base_digest).toBe(hashContent(""));
    expect(removed.roles).toEqual(expect.arrayContaining(["changed_source", "affected_authority_source"]));
    expect(removed.declared_by).toContain("product/invariants");
    expect(removed.declaration_ids).toHaveLength(1);
    const removedDeclaration = focused.source_declarations.find((declaration) => declaration.id === removed.declaration_ids[0]);
    expect(removedDeclaration).toMatchObject({
      page_id: "product/invariants",
      matched_via: "glob",
      expanded_glob: "src/**/*.ts",
      declaration: { glob: "src/**/*.ts" },
    });

    expect(emptyHead.lifecycle).toBe("changed");
    expect(emptyHead.head_digest).toBe(hashContent(""));
    expect(emptyHead.merge_base_digest).toBe(hashContent("seed"));

    const bundle = makeReviewBundle(view, pages, report, "merge-base-glob-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const missingProvenance = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const missingSource = missingProvenance.source_roles.find((source) => source.path === "src/removed.ts");
    if (!missingSource) throw new Error("removed source provenance disappeared");
    missingSource.declaration_ids = [];
    expect(validateFocusedReviewManifest(missingProvenance, files, reviewManifest).map((finding) => finding.code)).toContain("focused-manifest-authority-provenance");

    const misclassified = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const misclassifiedSource = misclassified.source_roles.find((source) => source.path === "src/removed.ts");
    if (!misclassifiedSource) throw new Error("removed source role disappeared");
    misclassifiedSource.roles = misclassifiedSource.roles.filter((role) => role !== "affected_authority_source");
    expect(validateFocusedReviewManifest(misclassified, files, reviewManifest).map((finding) => finding.code)).toContain("focused-manifest-authority-role-required");

    const invalidLifecycle = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const invalidSource = invalidLifecycle.source_roles.find((source) => source.path === "src/empty-head.ts");
    if (!invalidSource) throw new Error("empty-head source lifecycle disappeared");
    invalidSource.lifecycle = "unchanged";
    expect(validateFocusedReviewManifest(invalidLifecycle, files, reviewManifest).map((finding) => finding.code)).toContain("focused-manifest-lifecycle-binding");
  });

  test("preserves a removed empty merge-base glob source for an affected product page", () => {
    const root = tempNonInvariantMergeBaseGlobReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/test"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    expect(report.affectedPages).toContain("product/test");
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const removed = focused.source_roles.find((source) => source.path === "src/removed.ts");
    if (!removed) throw new Error("product authority fixture did not bind the removed source");
    expect(removed.lifecycle).toBe("removed");
    expect(removed.head_digest).toBeUndefined();
    expect(removed.merge_base_digest).toBe(hashContent(""));
    expect(removed.roles).toEqual(expect.arrayContaining(["changed_source", "affected_authority_source"]));
    expect(removed.declared_by).toEqual(["product/test"]);
    expect(removed.declaration_ids).toHaveLength(1);
    const declaration = focused.source_declarations.find((item) => item.id === removed.declaration_ids[0]);
    expect(declaration).toMatchObject({
      page_id: "product/test",
      matched_via: "glob",
      expanded_glob: "src/**/*.ts",
      declaration: { glob: "src/**/*.ts" },
    });

    const bundle = makeReviewBundle(view, pages, report, "product-merge-base-glob-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const omitted = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const omittedSource = omitted.source_roles.find((source) => source.path === "src/removed.ts");
    if (!omittedSource) throw new Error("product removed-source provenance disappeared");
    const omittedDeclarationIds = new Set(omittedSource.declaration_ids);
    omitted.source_roles = omitted.source_roles.filter((source) => source.path !== "src/removed.ts");
    omitted.source_declarations = omitted.source_declarations.filter((item) => !omittedDeclarationIds.has(item.id));
    const omittedRebound = rebindFocusedBundle(omitted, files, reviewManifest);
    const omittedCodes = validateFocusedReviewManifest(omitted, omittedRebound.files, omittedRebound.manifest).map((finding) => finding.code);
    expect(omittedCodes).toContain("focused-manifest-authority-source-required");

    const relabeled = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const relabeledSource = relabeled.source_roles.find((source) => source.path === "src/removed.ts");
    if (!relabeledSource) throw new Error("product removed-source role disappeared");
    const relabeledDeclarationIds = new Set(relabeledSource.declaration_ids);
    relabeledSource.roles = ["changed_source", "supporting_source"];
    relabeledSource.declared_by = [];
    relabeledSource.declaration_ids = [];
    relabeled.source_declarations = relabeled.source_declarations.filter((item) => !relabeledDeclarationIds.has(item.id));
    const relabeledRebound = rebindFocusedBundle(relabeled, files, reviewManifest);
    const relabeledCodes = validateFocusedReviewManifest(relabeled, relabeledRebound.files, relabeledRebound.manifest).map((finding) => finding.code);
    expect(relabeledCodes).toContain("focused-manifest-authority-role-required");
    expect(relabeledCodes).toContain("focused-manifest-authority-provenance");
    expect(relabeledCodes).toContain("focused-manifest-authority-declaration-required");
  });

  test("binds conflict-derived invariant authority sources even when the invariant is otherwise unaffected", () => {
    const root = tempConflictInvariantAuthorityReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({
      affected_pages: [],
      affected_invariants: [],
      semantic_change: false,
      touched_conflicts: [{ id: "C-001", action: "retain", reason: "The conflict remains open while its evidence is refreshed." }],
    });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    expect(report.affectedPages).not.toContain("product/invariants");
    expect(report.affectedConflicts.map((conflict) => conflict.id)).toContain("C-001");
    expect(prMetadata.affected_invariants).toEqual([]);
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const invariantSource = focused.source_roles.find((source) => source.path === "invariant.ts");
    if (!invariantSource) throw new Error("conflict-derived invariant source was not focused");
    expect(invariantSource.lifecycle).toBe("unchanged");
    expect(invariantSource.roles).toContain("affected_authority_source");
    expect(invariantSource.declared_by).toEqual(["product/invariants"]);
    expect(invariantSource.declaration_ids).toHaveLength(1);
    expect(focused.source_declarations.find((item) => item.id === invariantSource.declaration_ids[0])).toMatchObject({
      page_id: "product/invariants",
      matched_via: "path",
      declaration: { path: "invariant.ts" },
    });

    const bundle = makeReviewBundle(view, pages, report, "conflict-invariant-authority-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(reviewManifest.affected_invariant_ids).toContain("product/invariants");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const omitted = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const omittedSource = omitted.source_roles.find((source) => source.path === "invariant.ts");
    if (!omittedSource) throw new Error("conflict-derived invariant source disappeared");
    const omittedDeclarationIds = new Set(omittedSource.declaration_ids);
    omitted.source_roles = omitted.source_roles.filter((source) => source.path !== "invariant.ts");
    omitted.source_declarations = omitted.source_declarations.filter((item) => !omittedDeclarationIds.has(item.id));
    const omittedRebound = rebindFocusedBundle(omitted, files, reviewManifest);
    expect(validateFocusedReviewManifest(omitted, omittedRebound.files, omittedRebound.manifest).map((finding) => finding.code)).toContain("focused-manifest-authority-source-required");

    const relabeled = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const relabeledSource = relabeled.source_roles.find((source) => source.path === "invariant.ts");
    if (!relabeledSource) throw new Error("conflict-derived invariant role disappeared");
    const relabeledDeclarationIds = new Set(relabeledSource.declaration_ids);
    relabeledSource.roles = ["supporting_source"];
    relabeledSource.declared_by = [];
    relabeledSource.declaration_ids = [];
    relabeled.source_declarations = relabeled.source_declarations.filter((item) => !relabeledDeclarationIds.has(item.id));
    const relabeledRebound = rebindFocusedBundle(relabeled, files, reviewManifest);
    const relabeledCodes = validateFocusedReviewManifest(relabeled, relabeledRebound.files, relabeledRebound.manifest).map((finding) => finding.code);
    expect(relabeledCodes).toContain("focused-manifest-authority-role-required");
    expect(relabeledCodes).toContain("focused-manifest-authority-provenance");
    expect(relabeledCodes).toContain("focused-manifest-authority-declaration-required");
  });

  test("retains a base-only exact authority declaration when an affected page replaces it", () => {
    const root = tempAffectedPageBaseExactReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/test"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    expect(focused.body_roles).toContainEqual(expect.objectContaining({ role: "affected_page", id: "product/test", lifecycle: "merge-base" }));
    const oldSource = focused.source_roles.find((source) => source.path === "old.ts");
    if (!oldSource) throw new Error("base-only exact source was not focused");
    expect(oldSource.lifecycle).toBe("unchanged");
    expect(oldSource.roles).toContain("affected_authority_source");
    expect(oldSource.declared_by).toEqual(["product/test"]);
    expect(oldSource.declaration_ids).toHaveLength(1);
    expect(focused.source_declarations.find((item) => item.id === oldSource.declaration_ids[0])).toMatchObject({
      page_id: "product/test",
      matched_via: "path",
      declaration: { path: "old.ts" },
    });

    const bundle = makeReviewBundle(view, pages, report, "affected-base-exact-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const omitted = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const omittedSource = omitted.source_roles.find((source) => source.path === "old.ts");
    if (!omittedSource) throw new Error("base-only exact source disappeared");
    const omittedDeclarationIds = new Set(omittedSource.declaration_ids);
    omitted.source_roles = omitted.source_roles.filter((source) => source.path !== "old.ts");
    omitted.source_declarations = omitted.source_declarations.filter((item) => !omittedDeclarationIds.has(item.id));
    const rebound = rebindFocusedBundle(omitted, files, reviewManifest);
    expect(validateFocusedReviewManifest(omitted, rebound.files, rebound.manifest).map((finding) => finding.code)).toContain("focused-manifest-authority-source-required");
  });

  test("retains a deleted empty glob match from an affected page's merge-base body", () => {
    const root = tempAffectedPageBaseGlobReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/test"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    expect(focused.body_roles).toContainEqual(expect.objectContaining({ role: "affected_page", id: "product/test", lifecycle: "merge-base" }));
    const removed = focused.source_roles.find((source) => source.path === "src/removed.ts");
    if (!removed) throw new Error("base-only glob source was not focused");
    expect(removed.lifecycle).toBe("removed");
    expect(removed.head_digest).toBeUndefined();
    expect(removed.merge_base_digest).toBe(hashContent(""));
    expect(removed.roles).toEqual(expect.arrayContaining(["changed_source", "affected_authority_source"]));
    expect(removed.declared_by).toEqual(["product/test"]);
    expect(removed.declaration_ids).toHaveLength(1);
    expect(focused.source_declarations.find((item) => item.id === removed.declaration_ids[0])).toMatchObject({
      page_id: "product/test",
      matched_via: "glob",
      expanded_glob: "src/**/*.ts",
      declaration: { glob: "src/**/*.ts" },
    });

    const bundle = makeReviewBundle(view, pages, report, "affected-base-glob-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const relabeled = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const relabeledSource = relabeled.source_roles.find((source) => source.path === "src/removed.ts");
    if (!relabeledSource) throw new Error("base-only glob source disappeared");
    const relabeledDeclarationIds = new Set(relabeledSource.declaration_ids);
    relabeledSource.roles = ["changed_source", "supporting_source"];
    relabeledSource.declared_by = [];
    relabeledSource.declaration_ids = [];
    relabeled.source_declarations = relabeled.source_declarations.filter((item) => !relabeledDeclarationIds.has(item.id));
    const rebound = rebindFocusedBundle(relabeled, files, reviewManifest);
    const codes = validateFocusedReviewManifest(relabeled, rebound.files, rebound.manifest).map((finding) => finding.code);
    expect(codes).toContain("focused-manifest-authority-role-required");
    expect(codes).toContain("focused-manifest-authority-provenance");
    expect(codes).toContain("focused-manifest-authority-declaration-required");
  });

  test("rejects digest-rebound omission of an unchanged exact authority source", () => {
    const root = tempAuthoritySourceReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/invariants"], affected_invariants: ["product/invariants"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const bundle = makeReviewBundle(view, pages, report, "authority-source-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const omitted = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const configSource = omitted.source_roles.find((source) => source.path === ".wiki/config.json");
    if (!configSource) throw new Error("authority fixture did not bind .wiki/config.json");
    const omittedDeclarationIds = new Set(configSource.declaration_ids);
    omitted.source_roles = omitted.source_roles.filter((source) => source.path !== ".wiki/config.json");
    omitted.source_declarations = omitted.source_declarations.filter((declaration) => !omittedDeclarationIds.has(declaration.id));
    const rebound = rebindFocusedBundle(omitted, files, reviewManifest);
    const codes = validateFocusedReviewManifest(omitted, rebound.files, rebound.manifest).map((finding) => finding.code);
    expect(codes).toContain("focused-manifest-authority-source-required");
  });

  test("rejects digest-rebound relabeling of a changed exact authority source", () => {
    const root = tempAuthoritySourceReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/invariants"], affected_invariants: ["product/invariants"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const bundle = makeReviewBundle(view, pages, report, "authority-source-changed-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const relabeled = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const readmeSource = relabeled.source_roles.find((source) => source.path === "README.md");
    if (!readmeSource) throw new Error("authority fixture did not bind changed README.md");
    const removedDeclarationIds = new Set(readmeSource.declaration_ids);
    readmeSource.roles = ["changed_source", "supporting_source"];
    readmeSource.declared_by = [];
    readmeSource.declaration_ids = [];
    relabeled.source_declarations = relabeled.source_declarations.filter((declaration) => !removedDeclarationIds.has(declaration.id));
    const rebound = rebindFocusedBundle(relabeled, files, reviewManifest);
    const codes = validateFocusedReviewManifest(relabeled, rebound.files, rebound.manifest).map((finding) => finding.code);
    expect(codes).toContain("focused-manifest-authority-role-required");
    expect(codes).toContain("focused-manifest-authority-provenance");
    expect(codes).toContain("focused-manifest-authority-declaration-required");
  });

  test("changes when canonical PR metadata changes without changing HEAD", () => {
    const root = tempReviewRepo();
    const first = manifestFor(root);
    const changed = manifestFor(root, metadata({ change_type: "fix" }));
    expect(first.pr_metadata_digest).not.toBe(changed.pr_metadata_digest);
    expect(first.bundle_digest).not.toBe(changed.bundle_digest);
    expect(codes(validateFreshContextAttestation({
      policy: policy(),
      manifest: changed,
      report: reportFor(first),
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    }))).toContain("fresh-context-bundle-stale");
  });

  test("changes after an affected page or conflict changes", () => {
    const root = tempReviewRepo();
    const first = manifestFor(root);
    put(root, "wiki/product/test.md", page("source.ts", "The version two contract now includes more evidence."));
    put(root, "wiki/conflicts/open/C-900.md", `---
id: conflict/C-900
conflict_id: C-900
summary: Review test conflict.
kind: conflict
status: conflicted
authority: observed
owners: ["@owner"]
conflict_type: documentation
severity: low
origin: introduced_by_change
opened_at: 2026-07-24
sources:
  - path: source.ts
affected_pages: [product/test]
affected_invariants: []
resolution:
  state: open
  decision: null
  acceptance:
    - Reconcile the added evidence.
---

# Review test conflict
`);
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "change affected review inputs"]);
    const second = manifestFor(root, metadata({
      touched_conflicts: [{ id: "C-900", action: "introduce" }],
    }));
    expect(first.bundle_digest).not.toBe(second.bundle_digest);
    expect(second.affected_conflict_ids).toEqual(["C-900"]);
    expect(codes(validateFreshContextAttestation({
      policy: policy(),
      manifest: second,
      report: reportFor(first),
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    }))).toContain("fresh-context-bundle-stale");
  });
});

describe("fresh-context report validation", () => {
  test("keeps existing policies all-PR by default and rejects inert risk selectors", () => {
    const existing = parseFreshContextPolicy(policy());
    expect(existing?.requiredWhen).toBeUndefined();

    const inert = parseFreshContextPolicy(policy({
      requiredWhen: {
        kind: "risk-based",
        changedFileGlobs: [],
        affectedInvariants: false,
        affectedConflicts: false,
        removedCurrentPages: false,
      },
    }));
    expect(inert).toBeUndefined();

    const whitespaceOnly = parseFreshContextPolicy(policy({
      requiredWhen: {
        kind: "risk-based",
        changedFileGlobs: [" "],
        affectedInvariants: false,
        affectedConflicts: false,
        removedCurrentPages: false,
      },
    }));
    expect(whitespaceOnly).toBeUndefined();
  });

  test("requires reports only when the trusted risk selector matches", () => {
    const root = tempReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const lowRiskPolicy = policy({
      requiredWhen: {
        kind: "risk-based",
        changedFileGlobs: ["scripts/wiki/**"],
        affectedInvariants: true,
        affectedConflicts: true,
        removedCurrentPages: true,
      },
    });
    const lowRisk = reviewCheck(view, pages, {
      base: "HEAD~1",
      metadata: metadata(),
      policy: lowRiskPolicy,
    });
    expect(lowRisk).toMatchObject({ ok: true, required: false, requirementReasons: [], findings: [] });

    const highRiskPolicy = policy({
      requiredWhen: {
        kind: "risk-based",
        changedFileGlobs: ["source.ts"],
        affectedInvariants: true,
        affectedConflicts: true,
        removedCurrentPages: true,
      },
    });
    const highRisk = reviewCheck(view, pages, {
      base: "HEAD~1",
      metadata: metadata(),
      policy: highRiskPolicy,
    });
    expect(highRisk.ok).toBe(false);
    expect(highRisk.required).toBe(true);
    expect(highRisk.requirementReasons).toContain("changed file matches source.ts: source.ts");
    expect(highRisk.findings.map((finding) => finding.code)).toContain("fresh-context-missing");
  });

  test("risk classification uses affected invariants from the manifest", () => {
    const root = tempReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const impact = impactReport(view, pages, { base: "HEAD~1", metadata: metadata({ affected_invariants: ["product/invariants"] }) });
    const manifest = buildReviewManifest(view, pages, impact, metadata({ affected_invariants: ["product/invariants"] }));
    const invariant = evaluateFreshContextRequirement(policy({
      requiredWhen: {
        kind: "risk-based",
        changedFileGlobs: [],
        affectedInvariants: true,
        affectedConflicts: false,
        removedCurrentPages: false,
      },
    }), manifest, impact);
    expect(invariant).toEqual({ applies: true, reasons: ["affected invariants: product/invariants"] });
  });

  test("preserves a merge-base invariant when its kind is demoted in the head", () => {
    const root = tempReviewRepo();
    put(root, "wiki/product/test.md", page("source.ts", "The current contract remains version two.", "invariant"));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "make page an invariant"]);
    put(root, "wiki/product/test.md", page("source.ts", "The current contract remains version two.", "product"));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "demote invariant kind"]);

    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const result = reviewCheck(view, pages, {
      base: "HEAD~1",
      metadata: metadata({ change_type: "editorial", affected_invariants: [] }),
      policy: policy({
        requiredWhen: {
          kind: "risk-based",
          changedFileGlobs: [],
          affectedInvariants: true,
          affectedConflicts: false,
          removedCurrentPages: false,
        },
      }),
    });
    expect(result.manifest.affected_invariant_ids).toEqual(["product/test"]);
    expect(result).toMatchObject({
      ok: false,
      required: true,
      requirementReasons: ["affected invariants: product/test"],
    });
    const focused = buildFocusedReviewManifest(view, pages, result.impact, metadata({ change_type: "editorial", affected_invariants: [] }));
    expect(focused.body_roles).toContainEqual(expect.objectContaining({ role: "invariant", id: "product/test", lifecycle: "merge-base" }));
  });

  test("risk classification covers conflicts and removed current pages", () => {
    const root = tempReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const impact = impactReport(view, pages, { base: "HEAD~1", metadata: metadata() });
    const manifest = buildReviewManifest(view, pages, impact, metadata());
    const selector = policy({
      requiredWhen: {
        kind: "risk-based",
        changedFileGlobs: [],
        affectedInvariants: false,
        affectedConflicts: true,
        removedCurrentPages: true,
      },
    });
    const conflict = evaluateFreshContextRequirement(selector, {
      ...manifest,
      affected_conflict_ids: ["C-900"],
    }, impact);
    expect(conflict.reasons).toEqual(["affected conflicts: C-900"]);

    const removal = evaluateFreshContextRequirement(selector, manifest, {
      ...impact,
      removedCurrentPages: [{ id: "product/removed", path: "wiki/product/removed.md" }],
    });
    expect(removal.reasons).toEqual(["removed or demoted current pages: product/removed"]);
  });

  test("fails required mode when the report is missing or malformed", () => {
    const manifest = manifestFor(tempReviewRepo());
    expect(codes(validateFreshContextAttestation({ policy: policy(), manifest }))).toContain("fresh-context-missing");
    expect(codes(validateFreshContextAttestation({
      policy: policy(),
      manifest,
      report: { version: 1, verdict: "PASS" },
    }))).toContain("fresh-context-malformed");
  });

  test("rejects PENDING and NEEDS_RECONCILE", () => {
    const manifest = manifestFor(tempReviewRepo());
    for (const verdict of ["PENDING", "NEEDS_RECONCILE"]) {
      expect(codes(validateFreshContextAttestation({
        policy: policy(),
        manifest,
        report: { ...reportFor(manifest), verdict },
        reviewerActor: "trusted-reviewer",
        prAuthor: "author",
      }))).toContain("fresh-context-not-pass");
    }
  });

  test("accepts PASS bound to the exact head, merge-base, bundle, evidence, and actor", () => {
    const manifest = manifestFor(tempReviewRepo());
    const result = validateFreshContextAttestation({
      policy: policy(),
      manifest,
      report: reportFor(manifest),
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test("rejects stale head, merge-base, and bundle digests with stable codes", () => {
    const manifest = manifestFor(tempReviewRepo());
    const mutate = (value: string) => `${value[0] === "0" ? "1" : "0"}${value.slice(1)}`;
    const mutations: [Partial<FreshContextReportV1>, string][] = [
      [{ reviewed_head_sha: mutate(manifest.head_sha) }, "fresh-context-head-stale"],
      [{ merge_base_sha: mutate(manifest.merge_base_sha) }, "fresh-context-base-stale"],
      [{ bundle_digest: mutate(manifest.bundle_digest) }, "fresh-context-bundle-stale"],
    ];
    for (const [override, code] of mutations) {
      expect(codes(validateFreshContextAttestation({
        policy: policy(),
        manifest,
        report: reportFor(manifest, override),
        reviewerActor: "trusted-reviewer",
        prAuthor: "author",
      }))).toContain(code);
    }
  });

  test("rejects empty evidence and untrusted or author-identical reviewers", () => {
    const manifest = manifestFor(tempReviewRepo());
    expect(codes(validateFreshContextAttestation({
      policy: policy(),
      manifest,
      report: reportFor(manifest, { evidence: [] }),
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    }))).toContain("fresh-context-evidence-missing");
    expect(codes(validateFreshContextAttestation({
      policy: policy(),
      manifest,
      report: reportFor(manifest, { reviewer: "intruder" }),
      reviewerActor: "intruder",
      prAuthor: "author",
    }))).toContain("fresh-context-reviewer-untrusted");
    expect(codes(validateFreshContextAttestation({
      policy: policy({ trust: { allowedReviewers: ["*"], requireDifferentActor: true, requireAuthenticatedActor: true } }),
      manifest,
      report: reportFor(manifest, { reviewer: "author" }),
      reviewerActor: "author",
      prAuthor: "author",
    }))).toContain("fresh-context-reviewer-untrusted");
  });

  test("allows an authenticated PR author when actor separation is explicitly disabled", () => {
    const manifest = manifestFor(tempReviewRepo());
    const result = validateFreshContextAttestation({
      policy: policy({ trust: { allowedReviewers: ["*"], requireDifferentActor: false, requireAuthenticatedActor: true } }),
      manifest,
      report: reportFor(manifest, { reviewer: "solo-author" }),
      reviewerActor: "solo-author",
      prAuthor: "solo-author",
    });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test("reports stale PASS after a new commit", () => {
    const root = tempReviewRepo();
    const previous = manifestFor(root);
    const oldPass = reportFor(previous);
    put(root, "source.ts", "export const contract = 'v3';\n");
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "new head"]);
    const current = manifestFor(root);
    const result = validateFreshContextAttestation({
      policy: policy(),
      manifest: current,
      report: oldPass,
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    });
    expect(codes(result)).toEqual(expect.arrayContaining(["fresh-context-head-stale", "fresh-context-bundle-stale"]));
  });

  test("advisory mode emits non-blocking findings", () => {
    const manifest = manifestFor(tempReviewRepo());
    const result = validateFreshContextAttestation({
      policy: policy({ mode: "advisory" }),
      manifest,
    });
    expect(result.ok).toBe(true);
    expect(result.findings[0]).toMatchObject({ code: "fresh-context-missing", severity: "warning" });
  });

  test("review-check CLI returns stable JSON and invalidates an old PASS after a commit", () => {
    const root = tempReviewRepo();
    const manifest = manifestFor(root);
    const attestation = reportFor(manifest);
    put(root, "pr-body.md", `\`\`\`yaml
change_type: feature
semantic_change: true
wiki_action: update
affected_pages: [product/test]
affected_invariants: []
touched_conflicts: []
fresh_context:
  verdict: PASS
  reviewed_head_sha: "${attestation.reviewed_head_sha}"
  bundle_digest: "${attestation.bundle_digest}"
  reviewer: "${attestation.reviewer}"
  evidence: ${JSON.stringify(attestation.evidence)}
\`\`\`
`);
    put(root, "report.json", jsonStable(attestation));
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const good = Bun.spawnSync([
      process.execPath, cli, "review-check",
      "--base", "HEAD~1",
      "--metadata", "pr-body.md",
      "--report", "report.json",
      "--reviewer-actor", "trusted-reviewer",
      "--pr-author", "author",
      "--json",
    ], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(good.exitCode).toBe(0);
    expect(JSON.parse(good.stdout.toString())).toMatchObject({ ok: true, mode: "required" });

    const missing = Bun.spawnSync([
      process.execPath, cli, "review-check",
      "--base", "HEAD~1",
      "--metadata", "pr-body.md",
      "--report", "missing.json",
      "--reviewer-actor", "trusted-reviewer",
      "--pr-author", "author",
      "--json",
    ], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(missing.stdout.toString()).findings[0].code).toBe("fresh-context-missing");

    put(root, "source.ts", "export const contract = 'v3';\n");
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "invalidate review"]);
    const stale = Bun.spawnSync([
      process.execPath, cli, "review-check",
      "--base", "HEAD~1",
      "--metadata", "pr-body.md",
      "--report", "report.json",
      "--reviewer-actor", "trusted-reviewer",
      "--pr-author", "author",
      "--json",
    ], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(stale.exitCode).toBe(1);
    expect(JSON.parse(stale.stdout.toString()).findings.map((finding: { code: string }) => finding.code)).toContain("fresh-context-head-stale");
  });

  test("review-preflight prepares a bundle before PR creation and validates PASS without a populated mirror", () => {
    const root = tempReviewRepo();
    put(root, "pr-body.md", `\`\`\`yaml
change_type: feature
semantic_change: true
wiki_action: update
affected_pages: [product/test]
affected_invariants: []
touched_conflicts: []
fresh_context:
  verdict: PENDING
  reviewed_head_sha: ""
  bundle_digest: ""
  reviewer: ""
  evidence: []
\`\`\`
`);
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const prepared = Bun.spawnSync([
      process.execPath, cli, "review-preflight",
      "--base", "HEAD~1",
      "--metadata", "pr-body.md",
      "--output", "preflight-bundle",
      "--json",
    ], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(prepared.exitCode).toBe(0);
    const preparation = JSON.parse(prepared.stdout.toString());
    expect(preparation).toMatchObject({ ok: true, ready: false, status: "review-required" });
    expect(existsSync(join(root, "preflight-bundle", "manifest.json"))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(root, "preflight-bundle", "manifest.json"), "utf8")) as ReviewManifest;
    put(root, "preflight-report.json", jsonStable(reportFor(manifest)));
    const validated = Bun.spawnSync([
      process.execPath, cli, "review-preflight",
      "--base", "HEAD~1",
      "--metadata", "pr-body.md",
      "--report", "preflight-report.json",
      "--output", "preflight-bundle",
      "--reviewer-actor", "trusted-reviewer",
      "--pr-author", "author",
      "--json",
    ], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(validated.exitCode).toBe(0);
    expect(JSON.parse(validated.stdout.toString())).toMatchObject({ ok: true, ready: true, status: "pass" });
  });

  test("review-preflight rejects an uncommitted candidate", () => {
    const root = tempReviewRepo();
    put(root, "pr-body.md", jsonStable({
      ...metadata(),
      fresh_context: {
        verdict: "PENDING",
        reviewed_head_sha: "",
        bundle_digest: "",
        reviewer: "",
        evidence: [],
      },
    }));
    put(root, "source.ts", "export const contract = 'uncommitted';\n");
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const result = Bun.spawnSync([
      process.execPath, cli, "review-preflight",
      "--base", "HEAD~1",
      "--metadata", "pr-body.md",
      "--output", "preflight-bundle",
      "--json",
    ], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      ok: false,
      ready: false,
      status: "invalid-candidate",
      findings: [{ code: "fresh-context-preflight-dirty", path: "source.ts" }],
    });
  });

  test("review-check reads an untrusted root without loading its Bun preloads", () => {
    const root = tempReviewRepo();
    const preloadMarker = join(root, "preload-ran");
    put(root, "bunfig.toml", 'preload = ["./malicious-preload.ts"]\n');
    put(root, "malicious-preload.ts", `await Bun.write(${JSON.stringify(preloadMarker)}, "executed");\n`);
    const manifest = manifestFor(root);
    const attestation = reportFor(manifest);
    put(root, "pr-body.md", `\`\`\`yaml
change_type: feature
semantic_change: true
wiki_action: update
affected_pages: [product/test]
affected_invariants: []
touched_conflicts: []
fresh_context:
  verdict: PASS
  reviewed_head_sha: "${attestation.reviewed_head_sha}"
  bundle_digest: "${attestation.bundle_digest}"
  reviewer: "${attestation.reviewer}"
  evidence: ${JSON.stringify(attestation.evidence)}
\`\`\`
`);
    put(root, "report.json", jsonStable(attestation));
    const cli = join(process.cwd(), "scripts/wiki/cli.ts");
    const result = Bun.spawnSync([
      process.execPath, cli, "review-check",
      "--root", root,
      "--base", "HEAD~1",
      "--metadata", join(root, "pr-body.md"),
      "--report", join(root, "report.json"),
      "--reviewer-actor", "trusted-reviewer",
      "--pr-author", "author",
      "--json",
    ], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(0);
    expect(existsSync(preloadMarker)).toBe(false);
  });
});

describe("fresh-context structured findings", () => {
  test("accepts a version 2 report whose findings are bound, attributed, and closable", () => {
    const manifest = manifestFor(tempReviewRepo());
    const result = validateFreshContextAttestation({
      policy: policy(),
      manifest,
      report: reportV2For(manifest, { findings: [findingFor()] }),
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    });
    expect(result).toMatchObject({ ok: true, findings: [] });
  });

  test("keeps accepting an in-flight version 1 report with free-text findings", () => {
    const manifest = manifestFor(tempReviewRepo());
    const result = validateFreshContextAttestation({
      policy: policy(),
      manifest,
      report: reportFor(manifest, { summary: undefined, findings: ["The affected page and its source agree."] }),
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    });
    expect(result).toMatchObject({ ok: true, findings: [] });
  });

  test("rejects a finding that is not bound to the reviewed change", () => {
    const manifest = manifestFor(tempReviewRepo());
    const check = (finding: FreshContextFinding) => codes(validateFreshContextAttestation({
      policy: policy(),
      manifest,
      report: reportV2For(manifest, { findings: [finding] }),
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    }));
    expect(check(findingFor({ scope_refs: [] }))).toContain("fresh-context-finding-scope-missing");
    expect(check(findingFor({ scope_refs: ["source.ts"] }))).toContain("fresh-context-finding-scope-missing");
    expect(check(findingFor({ scope_refs: ["page:"] }))).toContain("fresh-context-finding-scope-missing");
    expect(check(findingFor({ scope_refs: ["everything:source.ts"] }))).toContain("fresh-context-finding-scope-missing");
  });

  test("requires a controlling authority and objective acceptance criteria", () => {
    const manifest = manifestFor(tempReviewRepo());
    const check = (finding: FreshContextFinding) => codes(validateFreshContextAttestation({
      policy: policy(),
      manifest,
      report: reportV2For(manifest, { findings: [finding] }),
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    }));
    expect(check(findingFor({ authority: undefined as never }))).toContain("fresh-context-finding-authority-missing");
    expect(check(findingFor({ authority: { kind: "hunch" as never, ref: "wiki/product/test.md" } }))).toContain("fresh-context-finding-authority-missing");
    expect(check(findingFor({ authority: { kind: "normative", ref: "  " } }))).toContain("fresh-context-finding-authority-missing");
    expect(check(findingFor({ acceptance_criteria: [] }))).toContain("fresh-context-finding-acceptance-missing");

    // A quality suggestion states no contract, so it closes without criteria.
    expect(check(findingFor({
      classification: "suggestion",
      disposition: "recorded",
      conflict_id: undefined,
      acceptance_criteria: [],
    }))).toEqual([]);
  });

  test("requires every pointing disposition to name where the finding is tracked", () => {
    const manifest = manifestFor(tempReviewRepo());
    const check = (finding: FreshContextFinding) => codes(validateFreshContextAttestation({
      policy: policy(),
      manifest,
      report: reportV2For(manifest, { findings: [finding] }),
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    }));
    expect(check(findingFor({ conflict_id: undefined }))).toContain("fresh-context-disposition-incomplete");
    expect(check(findingFor({ disposition: "conflict_introduced", conflict_id: "  " }))).toContain("fresh-context-disposition-incomplete");
    expect(check(findingFor({ disposition: "followup_created", conflict_id: undefined }))).toContain("fresh-context-disposition-incomplete");
    expect(check(findingFor({ disposition: "dismissed_with_reason", conflict_id: undefined, dismissal_reason: "too small" }))).toContain("fresh-context-disposition-incomplete");

    expect(check(findingFor({ disposition: "followup_created", conflict_id: undefined, followup_ref: "issue #17" }))).toEqual([]);
    expect(check(findingFor({
      classification: "suggestion",
      disposition: "dismissed_with_reason",
      conflict_id: undefined,
      acceptance_criteria: [],
      dismissal_reason: "The suggested rename conflicts with the published CLI contract.",
    }))).toEqual([]);
  });

  test("refuses a PASS that still carries an unresolved finding", () => {
    const manifest = manifestFor(tempReviewRepo());
    const check = (report: FreshContextReportV2) => codes(validateFreshContextAttestation({
      policy: policy(),
      manifest,
      report,
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    }));
    const unresolved = findingFor({ classification: "candidate_regression", disposition: "unresolved", conflict_id: undefined });
    expect(check(reportV2For(manifest, { findings: [unresolved] }))).toEqual(["fresh-context-finding-unresolved"]);

    // A non-array `findings` reaches this rule too; it must be rejected, not thrown on.
    for (const malformed of ["everything agrees", 7, { id: "FC-001" }]) {
      const result = validateFreshContextAttestation({
        policy: policy(),
        manifest,
        report: reportV2For(manifest, { findings: malformed as never }),
        reviewerActor: "trusted-reviewer",
        prAuthor: "author",
      });
      expect(result.ok).toBe(false);
      expect(codes(result)).toContain("fresh-context-finding-malformed");
    }

    // The same finding is exactly what NEEDS_RECONCILE exists to carry.
    expect(check(reportV2For(manifest, { verdict: "NEEDS_RECONCILE", findings: [unresolved] })))
      .not.toContain("fresh-context-finding-unresolved");
  });

  test("rejects unknown vocabulary, incomplete prose, and duplicate finding ids", () => {
    const manifest = manifestFor(tempReviewRepo());
    const check = (findings: FreshContextFinding[]) => codes(validateFreshContextAttestation({
      policy: policy(),
      manifest,
      report: reportV2For(manifest, { findings }),
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    }));
    expect(check([findingFor({ classification: "nitpick" as never })])).toContain("fresh-context-finding-malformed");
    expect(check([findingFor({ disposition: "waived" as never })])).toContain("fresh-context-finding-malformed");
    expect(check([findingFor({ id: " " })])).toContain("fresh-context-finding-malformed");
    expect(check([findingFor({ discrepancy: "" })])).toContain("fresh-context-finding-malformed");
    expect(check([findingFor({ evidence: [] })])).toContain("fresh-context-finding-malformed");
    expect(check([findingFor(), findingFor({ discrepancy: "A second, different discrepancy reported under a reused id." })])).toContain("fresh-context-finding-malformed");
    expect(check(["FC-001" as never])).toContain("fresh-context-finding-malformed");
  });

  test("reports every structural defect of a finding in one pass", () => {
    const manifest = manifestFor(tempReviewRepo());
    const result = validateFreshContextAttestation({
      policy: policy(),
      manifest,
      report: reportV2For(manifest, {
        findings: [findingFor({ scope_refs: [], acceptance_criteria: [], authority: undefined as never, conflict_id: undefined })],
      }),
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    });
    expect(result.ok).toBe(false);
    expect(codes(result).sort()).toEqual([
      "fresh-context-disposition-incomplete",
      "fresh-context-finding-acceptance-missing",
      "fresh-context-finding-authority-missing",
      "fresh-context-finding-scope-missing",
    ]);
  });

  test("teaches the reviewer to disposition findings rather than fix everything", () => {
    const root = tempReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const directory = makeReviewBundle(view, pages, impactReport(view, pages, { base: "HEAD~1", metadata: metadata() }), undefined, metadata());
    temporary.push(directory);

    const prompt = readFileSync(join(directory, "PROMPT.md"), "utf8");
    expect(prompt).toContain("disposition");
    expect(prompt).toContain("follow-up");
    expect(prompt).not.toContain("Fix every");

    const contract = readFileSync(join(directory, "REPORT.md"), "utf8");
    for (const term of ["candidate_regression", "existing_conflict_linked", "scope_refs", "acceptance_criteria", "recorded"]) {
      expect(contract).toContain(term);
    }
    // The contract must state the boundaries it enforces, including the table
    // the reviewer's classification/disposition pair is now measured against.
    expect(contract).toContain("refuses a `PASS` that carries an `unresolved` finding");
    expect(contract).toContain("adjudicates which disposition may retire which classification");
    expect(contract).toContain("`origin: baseline`");

    const example = JSON.parse(readFileSync(join(directory, "REPORT.findings.example.json"), "utf8")) as FreshContextReportV2;
    expect(example.version).toBe(2);
    expect(validateFreshContextFindings(example.findings, "error")).toEqual([]);
  });
});

describe("fresh-context disposition adjudication", () => {
  test("closes a break this candidate caused only by fixing it", () => {
    for (const classification of ["candidate_regression", "declared_contract_violation"] as const) {
      for (const disposition of ["conflict_introduced", "existing_conflict_linked", "followup_created", "dismissed_with_reason", "recorded"] as const) {
        expect(adjudicate(findingFor({
          classification,
          disposition,
          conflict_id: "C-001",
          followup_ref: "issue #17",
          dismissal_reason: "The author explained this behaviour is intentional.",
        }))).toContain("fresh-context-disposition-not-allowed");
      }
      // Fixing always closes it; leaving it unresolved stays legal but blocks PASS.
      expect(adjudicate(findingFor({ classification, disposition: "fixed", conflict_id: undefined }))).toEqual([]);
      expect(adjudicate(findingFor({ classification, disposition: "unresolved", conflict_id: undefined }))).toEqual([]);
    }
  });

  test("keeps `recorded` for the suggestion that asserts no contract", () => {
    expect(adjudicate(findingFor({ classification: "preexisting_implementation_mismatch", disposition: "recorded", conflict_id: undefined })))
      .toContain("fresh-context-disposition-not-allowed");
    expect(adjudicate(findingFor({ classification: "unrelated_defect", disposition: "recorded", conflict_id: undefined })))
      .toContain("fresh-context-disposition-not-allowed");
    expect(adjudicate(findingFor({ classification: "suggestion", disposition: "recorded", conflict_id: undefined, acceptance_criteria: [] }))).toEqual([]);
  });

  test("refuses to retire an undecided product question without a conflict", () => {
    const decision = { classification: "decision_ambiguity" } as const;
    expect(adjudicate(findingFor({
      ...decision,
      disposition: "dismissed_with_reason",
      conflict_id: undefined,
      dismissal_reason: "The reviewer judged the ambiguity harmless.",
    }))).toContain("fresh-context-disposition-not-allowed");
    expect(adjudicate(findingFor({ ...decision, disposition: "followup_created", conflict_id: undefined, followup_ref: "issue #17" })))
      .toContain("fresh-context-disposition-not-allowed");
    expect(adjudicate(findingFor({ ...decision, disposition: "existing_conflict_linked" }), [conflictFor({ type: "decision" })])).toEqual([]);
  });

  test("rejects a conflict pointer that resolves to nothing", () => {
    expect(adjudicate(findingFor({ conflict_id: "C-404" }))).toEqual(["fresh-context-conflict-unknown"]);
    expect(adjudicate(findingFor(), [])).toEqual(["fresh-context-conflict-unknown"]);

    // Without a repository view the pointer cannot be resolved, so it is not judged.
    expect(validateFreshContextFindings([findingFor({ conflict_id: "C-404" })], "error")).toEqual([]);
  });

  test("adjudicates the table with or without a repository view", () => {
    // The table needs nothing but the finding, so a caller holding no conflict
    // list still cannot defer a break this candidate caused.
    const deferred = findingFor({
      classification: "candidate_regression",
      disposition: "dismissed_with_reason",
      conflict_id: undefined,
      dismissal_reason: "The author explained this behaviour is intentional.",
    });
    expect(validateFreshContextFindings([deferred], "error").map((item) => item.code)).toEqual(["fresh-context-disposition-not-allowed"]);
    expect(adjudicate(deferred)).toEqual(["fresh-context-disposition-not-allowed"]);
  });

  test("requires the named conflict to make the same claim the finding makes", () => {
    expect(adjudicate(findingFor(), [conflictFor({ type: "documentation" })])).toContain("fresh-context-conflict-mismatch");
    expect(adjudicate(findingFor(), [conflictFor({ affectedPages: ["product/other"] })])).toContain("fresh-context-conflict-mismatch");
    expect(adjudicate(findingFor())).toEqual([]);
  });

  test("will not let a finding that names no page be tracked by a conflict", () => {
    // Every conflict declares an affected page, so a `source:`-only finding
    // would otherwise be retired by any open conflict of the implied type.
    expect(adjudicate(findingFor({ scope_refs: ["source:source.ts"] }))).toEqual(["fresh-context-conflict-mismatch"]);
    expect(adjudicate(findingFor({ scope_refs: ["source:source.ts", "test:scripts/wiki/wiki.test.ts"] })))
      .toEqual(["fresh-context-conflict-mismatch"]);

    // A page-scoped finding that overlaps the conflict is still fine, and a
    // non-pointing disposition never needed a page ref at all.
    expect(adjudicate(findingFor({ scope_refs: ["page:product/test", "source:source.ts"] }))).toEqual([]);
    expect(adjudicate(findingFor({ scope_refs: ["source:source.ts"], disposition: "followup_created", conflict_id: undefined, followup_ref: "issue #17" }))).toEqual([]);
  });

  test("lets this candidate open a conflict for a question it raised itself", () => {
    // A decision ambiguity reports undecided intent, not a break, and its only
    // deferrals are the conflict dispositions. Holding it to `origin: baseline`
    // would leave it no legal exit at all, since inventing the decision to
    // close it is forbidden and `unresolved` blocks PASS.
    const ambiguity = findingFor({ classification: "decision_ambiguity", disposition: "conflict_introduced" });
    for (const origin of ["baseline", "introduced_by_change"] as const) {
      expect(adjudicate(ambiguity, [conflictFor({ type: "decision", origin })])).toEqual([]);
    }
  });

  test("does not impose a conflict type on a defect outside this change's scope", () => {
    // `unrelated_defect` implies no type, so any open baseline conflict whose
    // pages match may track it.
    for (const type of ["implementation", "documentation", "decision"] as const) {
      expect(adjudicate(findingFor({ classification: "unrelated_defect", disposition: "existing_conflict_linked" }), [conflictFor({ type })])).toEqual([]);
    }
  });

  test("will not let a reviewer call a problem pre-existing while the conflict says the change caused it", () => {
    // `origin` is the author's self-report and `classification` is the
    // reviewer's; `conflict-introduced-high-risk` only bites while they agree.
    expect(adjudicate(findingFor(), [conflictFor({ origin: "introduced_by_change" })]))
      .toEqual(["fresh-context-conflict-mismatch"]);
    expect(adjudicate(findingFor({ classification: "unrelated_defect" }), [conflictFor({ origin: "introduced_by_change" })]))
      .toContain("fresh-context-conflict-mismatch");
    expect(adjudicate(findingFor(), [conflictFor({ origin: "baseline" })])).toEqual([]);
  });

  test("resolves conflict pointers against the open conflicts at the reviewed HEAD", () => {
    const root = tempReviewRepo();
    put(root, "wiki/conflicts/open/C-001.md", conflictPage());
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "record a baseline mismatch"]);

    const prMetadata = metadata({ touched_conflicts: [{ id: "C-001", action: "introduce" }] });
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const manifest = buildReviewManifest(view, pages, impactReport(view, pages, { base: "HEAD~2", metadata: prMetadata }), prMetadata);
    const check = (finding: FreshContextFinding) => codes(reviewCheck(view, pages, {
      base: "HEAD~2",
      metadata: prMetadata,
      report: reportV2For(manifest, { findings: [finding] }),
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    }));

    expect(check(findingFor())).toEqual([]);
    expect(check(findingFor({ conflict_id: "C-900" }))).toEqual(["fresh-context-conflict-unknown"]);
    expect(check(findingFor({ classification: "decision_ambiguity" }))).toEqual(["fresh-context-conflict-mismatch"]);
  });
});

describe("fresh-context integration contracts", () => {
  test("takes reviewer identity from the latest authenticated GitHub envelope", () => {
    const selected = selectGitHubAttestation([{
      id: 1,
      body: `${GITHUB_ATTESTATION_MARKER}\n\`\`\`json\n{"version":1,"verdict":"PASS"}\n\`\`\``,
      user: { login: "older-reviewer" },
      updated_at: "2026-07-23T00:00:00Z",
    }], [[{
      id: 2,
      body: `${GITHUB_ATTESTATION_MARKER}\n\`\`\`yaml\nversion: 1\nverdict: PASS\n\`\`\``,
      user: { login: "trusted-reviewer" },
      submitted_at: "2026-07-24T00:00:00Z",
      state: "APPROVED",
    }]]);
    expect(selected).toMatchObject({
      actor: "trusted-reviewer",
      source: "pull_request_review",
      report: { version: 1, verdict: "PASS" },
    });
  });

  test("does not fall back to an older PASS when the latest marked envelope is malformed", () => {
    const selected = selectGitHubAttestation([{
      id: 1,
      body: `${GITHUB_ATTESTATION_MARKER}\n\`\`\`json\n{"version":1,"verdict":"PASS"}\n\`\`\``,
      user: { login: "older-reviewer" },
      updated_at: "2026-07-23T00:00:00Z",
    }, {
      id: 2,
      body: `${GITHUB_ATTESTATION_MARKER}\n\`\`\`json\n{not valid json\n\`\`\``,
      user: { login: "latest-reviewer" },
      updated_at: "2026-07-24T00:00:00Z",
    }], []);
    expect(selected).toMatchObject({
      actor: "latest-reviewer",
      sourceId: "2",
      report: "marked attestation contains malformed JSON or YAML",
    });
    const manifest = manifestFor(tempReviewRepo());
    const checked = validateFreshContextAttestation({
      policy: policy(),
      manifest,
      report: selected?.report,
      reviewerActor: selected?.actor,
      prAuthor: "author",
    });
    expect(codes(checked)).toContain("fresh-context-malformed");
  });

  test("orders an edited review by its update time when GitHub supplies one", () => {
    const selected = selectGitHubAttestation([], [[{
      id: 3,
      body: `${GITHUB_ATTESTATION_MARKER}\n\`\`\`json\n{not valid json\n\`\`\``,
      user: { login: "edited-reviewer" },
      submitted_at: "2026-07-22T00:00:00Z",
      updated_at: "2026-07-24T00:00:00Z",
      state: "COMMENTED",
    }, {
      id: 4,
      body: `${GITHUB_ATTESTATION_MARKER}\n\`\`\`json\n{"version":1,"verdict":"PASS"}\n\`\`\``,
      user: { login: "newer-submission" },
      submitted_at: "2026-07-23T00:00:00Z",
      state: "APPROVED",
    }]]);
    expect(selected).toMatchObject({
      actor: "edited-reviewer",
      sourceId: "3",
      report: "marked attestation contains malformed JSON or YAML",
    });
  });

  test("preserves the latest marked envelope when its authenticated actor is missing", () => {
    const selected = selectGitHubAttestation([{
      id: 5,
      body: `${GITHUB_ATTESTATION_MARKER}\n\`\`\`json\n{"version":1,"verdict":"PASS"}\n\`\`\``,
      user: { login: "older-reviewer" },
      updated_at: "2026-07-23T00:00:00Z",
    }, {
      id: 6,
      body: `${GITHUB_ATTESTATION_MARKER}\n\`\`\`json\n{"version":1,"verdict":"PASS"}\n\`\`\``,
      user: null,
      updated_at: "2026-07-24T00:00:00Z",
    }], []);
    expect(selected).toMatchObject({ actor: "", sourceId: "6" });
    const manifest = manifestFor(tempReviewRepo());
    const checked = validateFreshContextAttestation({
      policy: policy(),
      manifest,
      report: reportFor(manifest),
      reviewerActor: selected?.actor,
      prAuthor: "author",
    });
    expect(codes(checked)).toContain("fresh-context-reviewer-untrusted");
  });

  test("orders equal-second GitHub envelopes by numeric ID", () => {
    const selected = selectGitHubAttestation([{
      id: 9,
      body: `${GITHUB_ATTESTATION_MARKER}\n\`\`\`json\n{"version":1,"verdict":"PASS"}\n\`\`\``,
      user: { login: "older-reviewer" },
      updated_at: "2026-07-24T00:00:00Z",
    }, {
      id: 10,
      body: `${GITHUB_ATTESTATION_MARKER}\n\`\`\`json\n{not valid json\n\`\`\``,
      user: { login: "latest-reviewer" },
      updated_at: "2026-07-24T00:00:00Z",
    }], []);
    expect(selected).toMatchObject({
      actor: "latest-reviewer",
      sourceId: "10",
      report: "marked attestation contains malformed JSON or YAML",
    });
  });

  test("requires the structured PR-body block even when the template is bypassed", () => {
    const body = `\`\`\`yaml
change_type: feature
semantic_change: true
wiki_action: update
affected_pages: [product/test]
affected_invariants: []
touched_conflicts: []
\`\`\``;
    expect(validatePrMetadata(body, true).findings.map((finding) => finding.code)).toContain("metadata-fresh-context-missing");
  });

  test("detects missing config, AGENTS marker, template, command, and workflow seams", () => {
    const view = {
      root: "/memory",
      mode: "working" as const,
      listFiles: () => [".wiki/config.json", "AGENTS.md", "package.json"].sort(),
      exists: (path: string) => [".wiki/config.json", "AGENTS.md", "package.json"].includes(path),
      read: (path: string) => ({
        ".wiki/config.json": jsonStable({ version: 1, name: "x", highRisk: [] }),
        "AGENTS.md": "# Agent instructions\n",
        "package.json": jsonStable({ scripts: {} }),
      })[path] ?? "",
    };
    const found = [
      ...validateIntegrationSeams(view),
      ...validateGitHubIntegrationSeams(view),
    ].map((finding) => finding.code);
    expect(found).toEqual(expect.arrayContaining([
      "fresh-context-config-missing",
      "fresh-context-agents-marker-missing",
      "work-discovery-entrypoint-missing",
      "fresh-context-template-missing",
      "fresh-context-command-missing",
      "work-command-missing",
      "fresh-context-workflow-missing",
    ]));
  });

  test("core seam validation rejects inert package script placeholders", () => {
    const view = coreIntegrationView(providerNeutralAgentEntrypoint(), {
      "wiki:work": "bun scripts/wiki/cli.ts work",
      "wiki:review-check": "true",
      "wiki:doctor": "true",
    });
    const codes = validateIntegrationSeams(view).map((finding) => finding.code);
    expect(codes).toContain("fresh-context-command-missing");
    expect(codes).not.toContain("work-command-missing");
    expect(codes).not.toContain("work-discovery-entrypoint-missing");
    expect(codes).not.toContain("agent-entrypoint-contract-incomplete");
  });

  test("core seam validation rejects a missing work command token and noncanonical package script", () => {
    const agents = providerNeutralAgentEntrypoint().replace("bun run wiki:work", "bun run wiki:works");
    const view = coreIntegrationView(agents, {
      "wiki:review-preflight": "bun scripts/wiki/cli.ts review-preflight",
      "wiki:review-check": "bun scripts/wiki/cli.ts review-check",
      "wiki:doctor": "bun scripts/wiki/cli.ts doctor",
      "wiki:work": "true",
    });
    const codes = validateIntegrationSeams(view).map((finding) => finding.code);
    expect(codes).toContain("work-discovery-entrypoint-missing");
    expect(codes).toContain("work-command-missing");
    expect(codes).not.toContain("fresh-context-command-missing");
  });

  test("core seam validation rejects a marker-only agent entrypoint", () => {
    const view = coreIntegrationView(`<!-- wiki-ssot:fresh-context-guardrail -->
<!-- wiki-ssot:work-discovery -->
`);
    const codes = validateIntegrationSeams(view).map((finding) => finding.code);
    expect(codes).toContain("work-discovery-entrypoint-missing");
    expect(codes).toContain("agent-entrypoint-contract-incomplete");
  });

  test("core seam validation rejects a marker-plus-command placeholder", () => {
    const view = coreIntegrationView(`<!-- wiki-ssot:fresh-context-guardrail -->
<!-- wiki-ssot:work-discovery -->
TODO: document the wiki workflow.
bun run wiki:work
`);
    const codes = validateIntegrationSeams(view).map((finding) => finding.code);
    expect(codes).toContain("work-discovery-entrypoint-missing");
    expect(codes).toContain("agent-entrypoint-contract-incomplete");
  });

  test("core seam validation rejects command-name-only agent entrypoints", () => {
    const view = coreIntegrationView(`<!-- wiki-ssot:fresh-context-guardrail -->
<!-- wiki-ssot:work-discovery -->
wiki/index.md
wiki/current-status.md
kind: invariant
bun run wiki:work
wiki:context -- --work <ID>
wiki:search -- "<task terms>"
wiki:context -- "<task terms>"
proposed conflicted deprecated archived non-current
`);
    const codes = validateIntegrationSeams(view).map((finding) => finding.code);
    expect(codes).toContain("work-discovery-entrypoint-missing");
    expect(codes).toContain("agent-entrypoint-contract-incomplete");
  });

  test("core seam validation rejects route-shaped clauses that negate every required action", () => {
    const view = coreIntegrationView(`<!-- wiki-ssot:fresh-context-guardrail -->
<!-- wiki-ssot:work-discovery -->
Do not start at wiki/index.md, and never read wiki/current-status.md or any kind: invariant page.
If the user asks what remains without naming a task, never run bun run wiki:work before topic search; do not require a known node, work ID, or search term.
After selecting a returned item, ignore the printed wiki:context -- --work <ID> command.
Avoid search before editing with wiki:search -- "<task terms>" and wiki:context -- "<task terms>".
Do not label pages with status proposed, conflicted, deprecated, or archived as non-current; treat them as current.
`);
    const findings = validateIntegrationSeams(view);
    const codes = findings.map((finding) => finding.code);
    const contract = findings.find((finding) => finding.code === "agent-entrypoint-contract-incomplete");
    expect(codes).toContain("work-discovery-entrypoint-missing");
    expect(codes).toContain("agent-entrypoint-contract-incomplete");
    expect(contract?.message).toContain("the wiki index/current-status/invariant read route");
    expect(contract?.message).toContain("the no-query generic remaining-work route");
    expect(contract?.message).toContain("the selected-work context route");
    expect(contract?.message).toContain("the topic search/context route");
    expect(contract?.message).toContain("the non-current authority boundary");
  });

  function expectScopedNegationRejected(
    overrides: Partial<AgentEntrypointClauses>,
    gap: string,
    workRoute = false,
  ): void {
    const findings = validateIntegrationSeams(coreIntegrationView(providerNeutralAgentEntrypoint(overrides)));
    const codes = findings.map((finding) => finding.code);
    const contract = findings.find((finding) => finding.code === "agent-entrypoint-contract-incomplete");
    expect(codes).toContain("agent-entrypoint-contract-incomplete");
    expect(contract?.message).toContain(gap);
    if (workRoute) expect(codes).toContain("work-discovery-entrypoint-missing");
  }

  test("core seam validation canonicalizes ASCII and typographic contraction negations for every route", () => {
    for (const contraction of ["don't", "don’t", "can't", "can’t"]) {
      expectScopedNegationRejected({
        authority: `Agents ${contraction} start at wiki/index.md, then read wiki/current-status.md and every kind: invariant page.`,
      }, "the wiki index/current-status/invariant read route");
      expectScopedNegationRejected({
        work: `If the user asks what remains, agents ${contraction} run bun run wiki:work; no known node, work ID, or search term is necessary.`,
      }, "the no-query generic remaining-work route", true);
      expectScopedNegationRejected({
        selected: `After selecting a returned item, agents ${contraction} run the printed wiki:context -- --work <ID> command.`,
      }, "the selected-work context route");
      expectScopedNegationRejected({
        topic: `Agents ${contraction} search before editing with wiki:search -- "<task terms>" and wiki:context -- "<task terms>".`,
      }, "the topic search/context route");
      expectScopedNegationRejected({
        nonCurrent: `Agents ${contraction} label pages with status proposed, conflicted, deprecated, or archived as non-current.`,
      }, "the non-current authority boundary");
    }
  });

  test("core seam validation rejects the full work-route negation vocabulary across supported action shapes", () => {
    for (const directive of [
      "avoid bun run wiki:work",
      "ignore bun run wiki:work",
      "skip bun run wiki:work",
      "do not run bun run wiki:work",
      "the agent does not run bun run wiki:work",
      "don't run bun run wiki:work",
      "never run bun run wiki:work",
      "agents must not run bun run wiki:work",
      "agents should not run bun run wiki:work",
      "agents cannot run bun run wiki:work",
      "agents can't run bun run wiki:work",
      "agents refuse to run bun run wiki:work",
      "tell agents not to run bun run wiki:work",
      "avoid running bun run wiki:work",
      "ignore running bun run wiki:work",
      "skip running bun run wiki:work",
      "never invoke bun run wiki:work",
      "agents refuse to invoke bun run wiki:work",
      "avoid executing bun run wiki:work",
      "never use bun run wiki:work",
    ]) {
      expectScopedNegationRejected({
        work: `If the user asks what remains, ${directive}; no known node, work ID, or search term is necessary.`,
      }, "the no-query generic remaining-work route", true);
    }
  });

  test("core seam validation scopes do-not-require/need negation to each required action", () => {
    expectScopedNegationRejected({
      authority: "Do not require agents to start at wiki/index.md, then read wiki/current-status.md and every kind: invariant page.",
    }, "the wiki index/current-status/invariant read route");
    expectScopedNegationRejected({
      authority: "Agents do not need to start at wiki/index.md, then read wiki/current-status.md and every kind: invariant page.",
    }, "the wiki index/current-status/invariant read route");
    expectScopedNegationRejected({
      work: "If the user asks what remains, agents do not need to run bun run wiki:work; do not require a known node, work ID, or search term.",
    }, "the no-query generic remaining-work route", true);
    expectScopedNegationRejected({
      work: "If the user asks what remains, do not require agents to run bun run wiki:work; do not need a known node, work ID, or search term.",
    }, "the no-query generic remaining-work route", true);
    expectScopedNegationRejected({
      selected: "After selecting a returned item, do not require agents to run the printed wiki:context -- --work <ID> command.",
    }, "the selected-work context route");
    expectScopedNegationRejected({
      selected: "After selecting a returned item, agents do not need to run the printed wiki:context -- --work <ID> command.",
    }, "the selected-work context route");
    expectScopedNegationRejected({
      topic: `Agents do not need to search before editing with wiki:search -- "<task terms>" and wiki:context -- "<task terms>".`,
    }, "the topic search/context route");
    expectScopedNegationRejected({
      topic: `Do not require agents to search before editing with wiki:search -- "<task terms>" and wiki:context -- "<task terms>".`,
    }, "the topic search/context route");
    expectScopedNegationRejected({
      nonCurrent: "Do not require agents to label pages with status proposed, conflicted, deprecated, or archived as non-current.",
    }, "the non-current authority boundary");
    expectScopedNegationRejected({
      nonCurrent: "Agents do not need to label pages with status proposed, conflicted, deprecated, or archived as non-current.",
    }, "the non-current authority boundary");
  });

  test("core seam validation accepts standalone do-not-require and do-not-need no-query prerequisites", () => {
    for (const qualifier of [
      "do not require a known node, work ID, or search term",
      "do not need a known node, work ID, or search term",
    ]) {
      const agents = providerNeutralAgentEntrypoint({
        work: `If the user asks what remains, run bun run wiki:work; ${qualifier}.`,
      });
      expect(validateIntegrationSeams(coreIntegrationView(agents))).toEqual([]);
    }
  });

  test("core seam validation accepts typographic apostrophes in affirmative work clauses", () => {
    for (const work of [
      "If the user asks what remains, follow the project’s work rule and run bun run wiki:work; no known node, work ID, or search term is necessary.",
      "If the user asks what remains, use the ‘provider-neutral’ route to invoke bun run wiki:work; no known node, work ID, or search term is necessary.",
    ]) {
      expect(validateIntegrationSeams(coreIntegrationView(providerNeutralAgentEntrypoint({ work })))).toEqual([]);
    }
  });

  test("core seam validation keeps negation bounded by documented clause punctuation", () => {
    for (const boundary of [".", ";", "—", "–"]) {
      const agents = providerNeutralAgentEntrypoint({
        work: `If the user asks what remains, never skip the optional explanatory note${boundary} run bun run wiki:work; do not require a known node, work ID, or search term.`,
      });
      expect(validateIntegrationSeams(coreIntegrationView(agents))).toEqual([]);
    }
  });

  test("core seam validation rejects long same-clause work-action negations without a length escape", () => {
    for (const work of [
      "If the user asks what remains, do not require agents to execute the canonical provider-neutral repository-wide work-discovery command using bun run wiki:work; no known node, work ID, or search term is necessary.",
      "If the user asks what remains, agents do not need to execute the canonical provider-neutral repository-wide work-discovery command using bun run wiki:work; no known node, work ID, or search term is necessary.",
      "If the user asks what remains, do not require agents to execute the canonical deterministic offline provider-neutral repository-wide generic remaining-work discovery command selected by this integration contract using bun run wiki:work; no known node, work ID, or search term is necessary.",
    ]) {
      const findings = validateIntegrationSeams(coreIntegrationView(providerNeutralAgentEntrypoint({ work })));
      const codes = findings.map((finding) => finding.code);
      const contract = findings.find((finding) => finding.code === "agent-entrypoint-contract-incomplete");
      expect(codes).toContain("work-discovery-entrypoint-missing");
      expect(codes).toContain("agent-entrypoint-contract-incomplete");
      expect(contract?.message).toContain("the no-query generic remaining-work route");
    }
  });

  test("core seam validation accepts a complete provider-neutral agent entrypoint", () => {
    expect(validateIntegrationSeams(coreIntegrationView(providerNeutralAgentEntrypoint()))).toEqual([]);
  });

  test("core seam validation requires the affirmative human-work executor guardrail", () => {
    const missing = validateIntegrationSeams(coreIntegrationView(providerNeutralAgentEntrypoint({
      humanWork: "Executor metadata is documented for work items.",
    })));
    const missingContract = missing.find((finding) => finding.code === "agent-entrypoint-contract-incomplete");
    expect(missingContract?.message).toContain("human-work executor guardrail");

    const accepted = validateIntegrationSeams(coreIntegrationView(providerNeutralAgentEntrypoint({
      humanWork: "Human-only work is never auto-selected; report the procedure and hand off to a human; do not assume authority or credentials.",
    })));
    expect(accepted).toEqual([]);
  });

  test("human guardrail's intentional authority negation is not treated as a generic route negation", () => {
    const findings = validateIntegrationSeams(coreIntegrationView(providerNeutralAgentEntrypoint({
      humanWork: "Do not automatically select executor: human work. Report the required work and procedure, and hand it off to a human without assuming their credentials or authority.",
    })));
    expect(findings).toEqual([]);
  });

  test("human guardrail rejects negated procedure reporting or handoff clauses", () => {
    const findings = validateIntegrationSeams(coreIntegrationView(providerNeutralAgentEntrypoint({
      humanWork: "Do not automatically select executor: human work; do not report the procedure or hand it off to a human; do not assume authority.",
    })));
    expect(findings.find((finding) => finding.code === "agent-entrypoint-contract-incomplete")?.message)
      .toContain("human-work executor guardrail");
  });

  test("GitHub reference workflow skips Drafts and validates Ready PRs", () => {
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/wiki-ssot.yml"), "utf8");
    expect(workflow).toContain("wiki-review-attestation:");
    expect(workflow).toContain("name: wiki-review-attestation");
    expect(workflow).toContain("edited");
    expect(workflow).toContain("synchronize");
    expect(workflow).toContain("converted_to_draft");
    expect(workflow).toContain("github.event.pull_request.draft == false");
    expect(workflow).toContain("ref: ${{ github.event.pull_request.base.sha }}");
    expect(workflow).toContain("--policy-file");
    expect(workflow).toContain("working-directory: trusted");
    expect(workflow).toContain('--root "${REVIEW_ROOT}"');
    expect(workflow).not.toContain('cd "${REVIEW_ROOT}"');
    expect(workflow).not.toContain("pull_request_target:");
  });

  test("GitHub seam validation rejects token-shaped text outside the required job", () => {
    const fakeWorkflow = `name: fake
on:
  pull_request:
    types: [opened, synchronize, reopened, edited, ready_for_review]
jobs:
  wiki-review-attestation:
    name: wiki-review-attestation
    runs-on: ubuntu-latest
    env:
      bait: github-attestation.ts review-check policy-file --root
    steps:
      - name: no-op
        working-directory: trusted
        run: "true"
`;
    const view = {
      root: "/memory",
      mode: "working" as const,
      listFiles: () => [".github/pull_request_template.md", ".github/workflows/wiki-ssot.yml"],
      exists: (path: string) => [".github/pull_request_template.md", ".github/workflows/wiki-ssot.yml"].includes(path),
      read: (path: string) => path.endsWith("pull_request_template.md")
        ? "fresh_context: verdict: reviewed_head_sha: bundle_digest: reviewer: evidence:"
        : fakeWorkflow,
    };
    expect(validateGitHubIntegrationSeams(view).map((finding) => finding.code)).toContain("fresh-context-workflow-missing");
  });
});
