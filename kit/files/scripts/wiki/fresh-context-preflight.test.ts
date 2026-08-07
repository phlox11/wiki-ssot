import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildFocusedReviewManifest,
  buildReviewManifest,
  cleanupTemporary,
  createRepoView,
  evaluateFreshContextRequirement,
  hashContent,
  impactReport,
  jsonStable,
  loadWikiPages,
  makeReviewBundle,
  parseFreshContextPolicy,
  reviewCheck,
  selectGitHubAttestation,
  validateFreshContextAttestation,
  validateFreshContextFindings,
  validateFocusedReviewManifest,
  validateGitHubIntegrationSeams,
  validateIntegrationSeams,
  validatePrMetadata,
  verifyState,
  GITHUB_ATTESTATION_MARKER,
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
  type ConflictSummary,
  type FreshContextFinding,
  type FreshContextPolicy,
  type FreshContextReportV1,
  type FreshContextReportV2,
  type PrMetadata,
  type ReviewManifest,
  type FocusedReviewManifest,
} from "./test-fixtures/fresh-context";

afterEach(cleanupTemporary);

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

