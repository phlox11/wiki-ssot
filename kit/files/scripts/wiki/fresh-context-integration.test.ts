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
  type AgentEntrypointClauses,
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
