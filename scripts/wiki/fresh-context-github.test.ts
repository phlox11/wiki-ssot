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

describe("fresh-context GitHub attestation", () => {
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


});

