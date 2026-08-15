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

describe("fresh-context integration seams", () => {
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
      "work-command-missing",
      "fresh-context-workflow-missing",
    ]));
  });

  test("core seam validation rejects inert package script placeholders", () => {
    const view = coreIntegrationView("<!-- wiki-ssot:fresh-context-guardrail -->\nlegacy v1 prose remains compatible.\n", {
      "wiki:work": "bun scripts/wiki/cli.ts work",
      "wiki:review-check": "true",
      "wiki:doctor": "true",
    });
    const codes = validateIntegrationSeams(view).map((finding) => finding.code);
    expect(codes).toContain("fresh-context-command-missing");
  });

  test("typed managed rules replace hostile-prose interpretation", async () => {
    const { renderManagedAgentBlock, validateManagedAgentRules, MANAGED_AGENT_RULES } = await import("./agent-rules");
    const valid = renderManagedAgentBlock();
    expect(validateManagedAgentRules(valid)).toEqual([]);
    const missing = valid.replace(`<!-- wiki-ssot:rule id=${MANAGED_AGENT_RULES[0].id} -->`, "");
    expect(validateManagedAgentRules(missing).map((finding) => finding.code)).toContain("agent-managed-rule-missing");
    const duplicate = valid.replace("<!-- wiki-ssot:managed:end -->", `<!-- wiki-ssot:rule id=${MANAGED_AGENT_RULES[0].id} -->\n<!-- wiki-ssot:managed:end -->`);
    expect(validateManagedAgentRules(duplicate).map((finding) => finding.code)).toContain("agent-managed-rule-duplicate");
    const unknown = valid.replace("<!-- wiki-ssot:managed:end -->", "<!-- wiki-ssot:rule id=unknown-rule -->\n<!-- wiki-ssot:managed:end -->");
    expect(validateManagedAgentRules(unknown).map((finding) => finding.code)).toContain("agent-managed-rule-unknown");
  });

  test("v1 prose remains compatible while an upgraded block is structural", async () => {
    const { renderManagedAgentBlock } = await import("./agent-rules");
    expect(validateIntegrationSeams(coreIntegrationView("<!-- wiki-ssot:fresh-context-guardrail -->\nHost prose may be customized.\n"))).toEqual([]);
    const typed = renderManagedAgentBlock();
    expect(validateIntegrationSeams(coreIntegrationView(typed))).toEqual([]);
  });

  test("v2 local-status kit ships no active GitHub workflow", () => {
    for (const workflow of ["checks.yml", "kit.yml", "wiki-audit.yml", "wiki-ssot.yml"]) {
      expect(existsSync(join(process.cwd(), ".github/workflows", workflow))).toBe(false);
    }
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
