import { describe, expect, test } from "bun:test";
import {
  parseFreshContextReport,
  validateFreshContextAttestation,
  validateFreshContextFindings,
} from "./review-attestation";
import type { ReviewManifest } from "./review-bundle";
import type { FreshContextPolicy } from "./verification";

const manifest: ReviewManifest = {
  version: 1,
  base_ref: "origin/main",
  merge_base_sha: "0".repeat(40),
  head_sha: "1".repeat(40),
  pr_metadata_digest: "2".repeat(64),
  impact_report_digest: "3".repeat(64),
  diff_digest: "4".repeat(64),
  affected_page_ids: ["product/contracts"],
  affected_invariant_ids: [],
  affected_conflict_ids: [],
  file_digests: {},
  bundle_digest: "5".repeat(64),
};

const policy: FreshContextPolicy = {
  mode: "required",
  requiredVerdict: "PASS",
  evidenceRequired: true,
  trust: { allowedReviewers: ["reviewer"], requireDifferentActor: true, requireAuthenticatedActor: true },
};

function report(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    verdict: "PASS",
    reviewed_head_sha: manifest.head_sha,
    merge_base_sha: manifest.merge_base_sha,
    bundle_digest: manifest.bundle_digest,
    reviewer: "reviewer",
    evidence: ["Read the bound page and source plus focused tests."],
    summary: "The reviewed tree matches the controlling contract.",
    ...overrides,
  };
}

describe("review-attestation boundaries", () => {
  test("parses reports and keeps malformed YAML fail-closed", () => {
    expect(parseFreshContextReport(JSON.stringify(report())).findings).toEqual([]);
    expect(parseFreshContextReport("::: malformed: [").findings[0].code).toBe("fresh-context-malformed");
  });

  test("adjudicates candidate regressions and unresolved PASS findings", () => {
    const finding = {
      id: "FC-001",
      classification: "candidate_regression",
      disposition: "followup_created",
      scope_refs: ["page:product/contracts", "source:src/contracts.ts"],
      discrepancy: "The candidate breaks the current contract.",
      authority: { kind: "normative", ref: "product/invariants" },
      acceptance_criteria: ["The contract test passes against the reviewed HEAD."],
      evidence: ["src/contracts.ts"],
      followup_ref: "KM-99",
    };
    expect(validateFreshContextFindings([finding], "error").map((item) => item.code)).toContain("fresh-context-disposition-not-allowed");
    const checked = validateFreshContextAttestation({
      policy,
      manifest,
      report: report({ findings: [{ ...finding, disposition: "unresolved", followup_ref: undefined }] }),
      reviewerActor: "reviewer",
      prAuthor: "author",
    });
    expect(checked.ok).toBe(false);
    expect(checked.findings.map((item) => item.code)).toContain("fresh-context-finding-unresolved");
  });

  test("requires exact reviewer identity, evidence, and HEAD bindings", () => {
    const checked = validateFreshContextAttestation({
      policy,
      manifest,
      report: report(),
      reviewerActor: "reviewer",
      prAuthor: "author",
    });
    expect(checked.ok).toBe(true);

    const stale = validateFreshContextAttestation({
      policy,
      manifest,
      report: report({ reviewed_head_sha: "9".repeat(40), reviewer: "author" }),
      reviewerActor: "author",
      prAuthor: "author",
    });
    expect(stale.ok).toBe(false);
    expect(stale.findings.map((item) => item.code)).toEqual(expect.arrayContaining([
      "fresh-context-head-stale",
      "fresh-context-reviewer-untrusted",
    ]));
  });

  test("missing reports fail required mode and pass advisory mode", () => {
    expect(validateFreshContextAttestation({ policy, manifest }).ok).toBe(false);
    expect(validateFreshContextAttestation({ policy: { ...policy, mode: "advisory" }, manifest }).ok).toBe(true);
  });
});
