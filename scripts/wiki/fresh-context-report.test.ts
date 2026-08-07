import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildFocusedReviewManifest,
  buildReviewManifest,
  cleanupTemporary,
  temporary,
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
