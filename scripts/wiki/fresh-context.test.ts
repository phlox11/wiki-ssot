import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
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
  validateIntegrationSeams,
  validatePrMetadata,
  verifyState,
  type FreshContextFinding,
  type FreshContextPolicy,
  type FreshContextReportV1,
  type FreshContextReportV2,
  type PrMetadata,
  type ReviewManifest,
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
    expect(hashContent(readFileSync(join(one, "PROMPT.md"), "utf8"))).toBe("f4c502a36140ea842c53a0bb7e63cbdeac233d149bb8e0d39c982f149a130207");
    expect(hashContent(readFileSync(join(one, "REPORT.md"), "utf8"))).toBe("48ec42ffbc0a8fd4eff969bf994f55fd0140afdeb40b9aa26ed036aaa70acde7");
    expect(JSON.parse(readFileSync(join(one, "impact.json"), "utf8")).affectedInvariants).toBeUndefined();
    expect(existsSync(join(one, "REPORT.example.json"))).toBe(true);
    expect(existsSync(join(one, "REPORT.md"))).toBe(true);
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
    // The contract must state the boundary it enforces and the one it does not.
    expect(contract).toContain("refuses a `PASS` that carries an `unresolved` finding");
    expect(contract).toContain("does not decide which disposition a given classification deserves");

    const example = JSON.parse(readFileSync(join(directory, "REPORT.findings.example.json"), "utf8")) as FreshContextReportV2;
    expect(example.version).toBe(2);
    expect(validateFreshContextFindings(example.findings, "error")).toEqual([]);
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
      "fresh-context-template-missing",
      "fresh-context-command-missing",
      "fresh-context-workflow-missing",
    ]));
  });

  test("core seam validation rejects inert package script placeholders", () => {
    const view = {
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
        "AGENTS.md": "wiki-ssot:fresh-context-guardrail",
        "package.json": jsonStable({ scripts: { "wiki:review-check": "true", "wiki:doctor": "true" } }),
      })[path] ?? "",
    };
    expect(validateIntegrationSeams(view).map((finding) => finding.code)).toContain("fresh-context-command-missing");
  });

  test("GitHub reference workflow skips Drafts and validates Ready PRs", () => {
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/checks.yml"), "utf8");
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
      listFiles: () => [".github/pull_request_template.md", ".github/workflows/checks.yml"],
      exists: (path: string) => [".github/pull_request_template.md", ".github/workflows/checks.yml"].includes(path),
      read: (path: string) => path.endsWith("pull_request_template.md")
        ? "fresh_context: verdict: reviewed_head_sha: bundle_digest: reviewer: evidence:"
        : fakeWorkflow,
    };
    expect(validateGitHubIntegrationSeams(view).map((finding) => finding.code)).toContain("fresh-context-workflow-missing");
  });
});
