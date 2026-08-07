
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
} from "../core";
import { GITHUB_ATTESTATION_MARKER, selectGitHubAttestation, validateGitHubIntegrationSeams } from "../github-attestation";

export const temporary: string[] = [];

export function cleanupTemporary(): void {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
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

/** A current page moves paths while retaining its stable page ID. */
function tempRenamedCurrentPageReviewRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-review-renamed-current-page-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Test"]);
  run(root, ["git", "config", "user.email", "wiki@example.invalid"]);
  put(root, ".wiki/config.json", jsonStable({ version: 1, name: "renamed-current-page", highRisk: [], freshContext: policy() }));
  put(root, "source.ts", "export const value = 1;\n");
  put(root, "wiki/product/original.md", page("source.ts", "The current page is at its original path."));
  let view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "renamed page baseline"]);

  rmSync(join(root, "wiki/product/original.md"));
  put(root, "wiki/product/renamed.md", page("source.ts", "The current page moved without changing its stable ID."));
  run(root, ["git", "add", "-A"]);
  view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "rename current page"]);
  return root;
}

/** A conflict moves from open to resolved, so its ID remains present at HEAD. */
function tempResolvedConflictMoveReviewRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-review-resolved-conflict-move-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Test"]);
  run(root, ["git", "config", "user.email", "wiki@example.invalid"]);
  put(root, ".wiki/config.json", jsonStable({ version: 1, name: "resolved-conflict-move", highRisk: [], freshContext: policy() }));
  put(root, "source.ts", "export const value = 1;\n");
  put(root, "wiki/product/test.md", page("source.ts", "The current page remains stable."));
  put(root, "wiki/conflicts/open/C-001.md", conflictPage());
  let view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "open conflict baseline"]);

  rmSync(join(root, "wiki/conflicts/open/C-001.md"));
  const resolved = conflictPage()
    .replace("status: conflicted", "status: archived")
    .replace("resolution:\n  state: open\n  decision: null\n  acceptance:", "resolution:\n  state: verified\n  decision: The implementation contract is reconciled.\n  acceptance:")
    .replace("    - The current page and the implementation disagree about the exported contract.\n", "    - The current page and the implementation disagree about the exported contract.\n  evidence:\n    - source.ts\n");
  put(root, "wiki/conflicts/resolved/C-001.md", resolved);
  run(root, ["git", "add", "-A"]);
  view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "resolve conflict and move path"]);
  return root;
}

function rebindFocusedBundle(candidate: FocusedReviewManifest, files: Record<string, string>, manifest: ReviewManifest, additionalFiles: Record<string, string> = {}): { files: Record<string, string>; manifest: ReviewManifest } {
  const focusedRaw = jsonStable(candidate);
  const rebound = {
    ...manifest,
    file_digests: {
      ...manifest.file_digests,
      ...Object.fromEntries(Object.entries(additionalFiles).map(([path, content]) => [path, hashContent(content)])),
      "focused-manifest.json": hashContent(focusedRaw),
    },
    focused_manifest_digest: hashContent(focusedRaw),
  } as ReviewManifest;
  const core = { ...rebound } as Record<string, unknown>;
  delete core.bundle_digest;
  rebound.bundle_digest = hashContent(jsonStable(core));
  return { files: { ...files, ...additionalFiles, "focused-manifest.json": focusedRaw }, manifest: rebound };
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



export {
  run,
  put,
  policy,
  providerNeutralAgentEntrypoint,
  coreIntegrationView,
  page,
  metadata,
  tempReviewRepo,
  tempFocusedReviewRepo,
  tempMergeBaseGlobReviewRepo,
  tempAuthoritySourceReviewRepo,
  tempNonInvariantMergeBaseGlobReviewRepo,
  tempConflictInvariantAuthorityReviewRepo,
  tempAffectedPageBaseExactReviewRepo,
  tempAffectedPageBaseGlobReviewRepo,
  tempRenamedCurrentPageReviewRepo,
  tempResolvedConflictMoveReviewRepo,
  rebindFocusedBundle,
  manifestFor,
  reportFor,
  reportV2For,
  findingFor,
  codes,
  conflictFor,
  conflictPage,
  adjudicate,
};
export type { AgentEntrypointClauses };

export {
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
  GITHUB_ATTESTATION_MARKER,
  selectGitHubAttestation,
  validateGitHubIntegrationSeams,
};
export type {
  ConflictSummary,
  FreshContextFinding,
  FreshContextPolicy,
  FreshContextReportV1,
  FreshContextReportV2,
  PrMetadata,
  ReviewManifest,
  FocusedReviewManifest,
};
