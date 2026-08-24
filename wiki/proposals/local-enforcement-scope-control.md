---
id: proposal/local-enforcement-scope-control
summary: Move Wiki SSOT enforcement to an exact local gate and commit status while bounding source context, review selection, and workflow overhead without weakening traceability or independent review.
kind: proposal
status: proposed
authority: normative
owners: ["@phlox11"]
sources:
  - path: .wiki/config.json
  - path: package.json
  - path: scripts/wiki/cli.ts
  - path: scripts/wiki/cli-validation-handlers.ts
  - path: scripts/wiki/context.ts
  - path: scripts/wiki/verification.ts
  - path: scripts/wiki/impact.ts
  - path: scripts/wiki/review-bundle.ts
  - path: scripts/wiki/review-attestation.ts
  - path: scripts/wiki/kit-packaging.ts
  - path: scripts/wiki/apply.ts
  - path: scripts/wiki/github-attestation.ts
  - path: scripts/wiki/local-check.ts
  - path: scripts/wiki/github-local-status.ts
  - path: .github/pull_request_template.md
  - path: scripts/wiki/repository-validation.ts
    context: always
  - path: scripts/wiki/agent-rules.ts
    context: always
  - path: scripts/wiki/cli-discovery-handlers.ts
    context: always
  - path: scripts/wiki/cli-render.ts
    context: always
affects: [architecture/engine, operations/enforcement, product/invariants, product/scope]
related: [proposal/token-efficiency, proposal/portable-scale-navigation, architecture/engine, operations/enforcement]
tags: [local, enforcement, github, scope, context, review, adoption, simplification, semantic-verify, metadata-review, drift]
work_items:
  - id: LS-00
    title: Add the exact local gate and GitHub commit-status publisher
    state: done
    executor: agent
    priority: critical
    depends_on: []
    context_pages: [product/invariants, architecture/engine, operations/enforcement, product/scope]
    acceptance:
      - The existing wiki:check entrypoint can emit a deterministic result bound to a clean committed HEAD, merge base, semantic metadata, validation findings, and current independent-review evidence without changing legacy invocations.
      - wiki:publish refuses malformed, dirty, stale, or remote-head-mismatched results before any write, then publishes the wiki-ssot/local commit status and upserts one marked PR comment through gh.
      - Existing Actions, version 1 configuration, Fresh-context attestation, and review-bundle contracts remain active and compatible during bootstrap.
      - Focused tests cover result binding, legacy compatibility, status and comment publication, warning success, and fail-closed GitHub API behavior.
    evidence:
      - scripts/wiki/local-check.ts
      - scripts/wiki/local-check.test.ts
      - scripts/wiki/github-local-status.ts
      - scripts/wiki/github-local-status.test.ts
      - scripts/wiki/cli-validation-handlers.ts
      - docs/commands.md
      - wiki/architecture/engine.md
      - wiki/operations/enforcement.md
      - wiki/product/invariants.md
  - id: LS-01
    title: Cut the publisher over to version 2 local-status enforcement
    state: done
    executor: agent
    priority: critical
    depends_on: [LS-00]
    context_pages: [product/invariants, architecture/engine, operations/enforcement, product/scope]
    acceptance:
      - Version 2 config explicitly declares local-status enforcement, argv-based project checks, and risk-based review selection while version 1 behavior remains compatible.
      - The publisher no longer requires the PR-body report mirror, Draft-to-Ready choreography, or active Wiki Actions workflows after the local status becomes the protected merge boundary.
      - Legacy version 1 GitHub attestation remains isolated for one compatibility release and is not imported by the version 2 core path.
      - Doctor reports actionable needs-reconcile guidance when local-status configuration and legacy active workflows coexist.
    evidence:
      - .wiki/config.json
      - scripts/wiki/verification.ts
      - scripts/wiki/impact.ts
      - scripts/wiki/review-attestation.ts
      - scripts/wiki/local-check.ts
      - scripts/wiki/github-local-status.ts
      - scripts/wiki/apply.ts
      - scripts/wiki/verification.test.ts
      - scripts/wiki/local-check.test.ts
      - scripts/wiki/github-local-status.test.ts
      - scripts/wiki/apply.test.ts
      - .github/pull_request_template.md
      - AGENTS.md
  - id: LS-02
    title: Bound source context and independent-review selection with auditable causes
    state: done
    executor: agent
    priority: high
    depends_on: [LS-01]
    context_pages: [product/invariants, architecture/engine, operations/enforcement, product/scope]
    acceptance:
      - Source declarations distinguish always from reasoned catalog context without changing source mapping, coverage, hashes, drift detection, or impact semantics, and legacy declarations still mean always.
      - Compact context and reusable artifacts bind catalog sets by digest, count, and bytes while full context expands the same complete set.
      - Version 2 review selection uses reasoned changed-file rules, actual kit-owned files, affected invariants and conflicts, and removed current pages with no implicit all-PR fallback.
      - wiki:scope explains page and glob breadth, reverse fan-out, review-selection causes, and base deltas without imposing arbitrary numeric budgets.
      - A 10,000-file fixture proves broad tracking remains complete without forcing every catalog file into the mandatory read list.
    evidence:
      - scripts/wiki/context.ts
      - scripts/wiki/core.ts
      - scripts/wiki/scope.ts
      - scripts/wiki/scope.test.ts
      - scripts/wiki/review-bundle.ts
      - scripts/wiki/review-bundle.test.ts
      - scripts/wiki/local-check.ts
      - scripts/wiki/github-local-status.ts
      - scripts/wiki/apply.ts
      - scripts/wiki/apply.test.ts
      - docs/adopt-existing-repo.md
      - kit/README.md
  - id: LS-03
    title: Remove validation, agent-rule, context, work-output, and publication choreography duplication
    state: done
    executor: agent
    priority: high
    depends_on: [LS-02]
    context_pages: [product/invariants, architecture/engine, operations/enforcement, product/scope]
    acceptance:
      - Lint, doctor, audit, and legacy check project one shared repository validation result while retaining their public command compatibility.
      - Managed AGENTS guidance is rendered from stable typed rule IDs and doctor validates markers, version, and required IDs without general natural-language interpretation.
      - Topic work begins with wiki:context, default work output summarizes deferred records, and --all preserves complete deferred and done access.
      - Review bundles retain all invariant bodies but include implementation sources only when changed, affected, or otherwise required by the focused manifest.
      - Final command, module, test, and execution-path evidence shows that the new capabilities did not merely move the previous complexity sideways.
    evidence:
      - scripts/wiki/repository-validation.ts
      - scripts/wiki/repository-validation.test.ts
      - scripts/wiki/agent-rules.ts
      - scripts/wiki/agent-rules.test.ts
      - scripts/wiki/cli-validation-handlers.ts
      - scripts/wiki/cli-discovery-handlers.ts
      - scripts/wiki/review-bundle.ts
      - scripts/wiki/review-bundle.test.ts
      - docs/commands.md
      - docs/design.md
  - id: LS-04
    title: Validate safe version 1 upgrades and hand migration to each adopter
    state: done
    executor: either
    priority: high
    depends_on: [LS-03]
    context_pages: [product/invariants, architecture/engine, operations/enforcement, product/scope]
    acceptance:
      - Pristine and customized version 1 fixtures preserve project configuration, Wiki pages, host workflows, and removed-upstream files through dry-run and idempotent apply reruns.
      - Portable new/adopt/upgrade guidance tells each repository to copy its own host checks into argv-based localChecks, classify only reviewed broad sources, remove Wiki Actions only after reconciliation, and publish an exact local status before changing branch protection.
      - The portable branch-protection recipe requires a PR, the configured commit-status context from any source, and strict/up-to-date branches while separating optional repository hardening.
      - The publisher does not centrally migrate known adopters; each adopter owns its repository-specific migration and validation.
      - New installations ship no active Wiki Actions workflow, and upgrade keeps project-owned configuration and workflows fail-closed until that repository reconciles them.
    evidence:
      - scripts/wiki/existing-repo-bootstrap.test.ts
      - scripts/wiki/apply.test.ts
      - scripts/wiki/kit-packaging.test.ts
      - docs/adopt-existing-repo.md
      - docs/adopt-new-repo.md
      - wiki/WORKFLOW.md
      - kit/README.md
  - id: LS-05
    title: Define the semantic-verify configuration and migration contract
    state: not-started
    executor: agent
    priority: critical
    depends_on: [LS-04]
    context_pages: [product/invariants, architecture/engine, operations/enforcement, product/scope]
    acceptance:
      - Version 2 review configuration defines an explicit reasoned semanticVerify selector with enabled and reason fields; enabled true requires a reason of at least 20 characters, while enabled false preserves the existing path-, kit-, invariant-, conflict-, and current-page-based review behavior.
      - A version 2 adopter whose project-owned configuration omits semanticVerify remains parseable only for migration diagnostics but cannot pass wiki:doctor or the canonical local gate until it explicitly chooses enabled true or false.
      - Missing, malformed, disabled, and enabled semanticVerify states produce deterministic configuration findings without silently falling back to version 1 behavior or changing version 1 compatibility.
      - The publisher and new-install seed explicitly enable semanticVerify, while upgrade never rewrites an existing adopter's project-owned .wiki/config.json.
      - Focused configuration, doctor, apply, publisher, and kit tests bind the schema, migration finding, and default policy.
    evidence: []
  - id: LS-06
    title: Select independent review from canonical semantic metadata
    state: not-started
    executor: agent
    priority: critical
    depends_on: [LS-05]
    context_pages: [product/invariants, architecture/engine, operations/enforcement, product/scope]
    acceptance:
      - Version 2 review requirement evaluation consumes the already-canonicalized PR metadata and selects independent review when semantic_change is true and wiki_action is verify, even when no changed path or other configured risk signal applies.
      - The selected result carries the configured reason, review-preflight returns review-required without a report, and wiki:check cannot produce a passing publishable result until a valid independent PASS report is supplied.
      - Semantic false plus verify, semantic true plus update, and an explicitly disabled selector remain not-required unless another configured signal independently selects them.
      - The existing exact HEAD, merge-base, metadata digest, bundle digest, report, and local-result bindings make any metadata or candidate revision change invalidate prior evidence.
      - Focused requirement, preflight, local-check, and stale-evidence tests cover every selection and invalidation branch.
    evidence: []
  - id: LS-07
    title: Reconcile observable behavior against actual current authority
    state: not-started
    executor: agent
    priority: high
    depends_on: [LS-06]
    context_pages: [product/invariants, architecture/engine, operations/enforcement, product/scope]
    acceptance:
      - The focused reviewer prompt requires the reviewer to identify each user- or operator-observable behavior changed by a semantic verify candidate and locate the actual current-authority text that already states that behavior.
      - Page relevance, refreshed source hashes, verification-ledger freshness, and the author's unchanged reason are explicitly insufficient evidence that current authority is semantically complete.
      - A clear changed behavior missing from current authority is reported as a declared contract violation that must be fixed by updating the Wiki and metadata before PASS; genuinely undecided intent is reported as decision ambiguity and requires an open conflict rather than an invented decision.
      - Generated prompt and report-contract tests preserve the classification, disposition, evidence, and acceptance-criteria rules for both PASS and NEEDS_RECONCILE.
    evidence: []
  - id: LS-08
    title: Ship portable defaults, migration guidance, and SSOT documentation
    state: not-started
    executor: agent
    priority: high
    depends_on: [LS-07]
    context_pages: [product/invariants, architecture/engine, operations/enforcement, product/scope]
    acceptance:
      - Publisher configuration and the new-repository kit seed enable semanticVerify with a concrete reason, while an existing adopter receives an actionable needs-reconcile migration result and no automatic edit to project-owned policy.
      - Schema, command/configuration, design, workflow, new-adoption, existing-adoption, and kit-upgrade guidance explain the explicit true or false choice, the independent-review trust boundary, and why semantic verify differs from source-hash verification.
      - Current engine, enforcement, invariant, and product-scope authority describe metadata-aware review selection without claiming that deterministic tooling can infer missing product intent.
      - A temporary downstream workaround using reasoned application and package changed-file rules is documented as broader and noisier than the semantic selector.
      - Generated Wiki and kit artifacts are regenerated from their owning sources and pass freshness checks.
    evidence: []
  - id: LS-09
    title: Validate the WorldSweeper-equivalent regression and exact combined delivery
    state: not-started
    executor: agent
    priority: high
    depends_on: [LS-08]
    context_pages: [product/invariants, architecture/engine, operations/enforcement, product/scope]
    acceptance:
      - A network-free synthetic candidate equivalent to WorldSweeper PR 49 declares semantic_change true, wiki_action verify, relevant affected pages, and otherwise low-risk implementation paths, and deterministically returns review-required.
      - The same fixture proves that an explicitly disabled selector preserves not-required behavior and that ordinary non-semantic verification is not selected without another risk signal.
      - Missing reports fail, valid independent PASS reports succeed, and metadata or HEAD changes make prior reports and local results stale.
      - One exact combined revision passes generated, kit, lint, audit, impact, typecheck, full Wiki tooling tests, review-preflight, independent SSOT reconciliation, canonical wiki:check, and local-status publication.
      - LS-05 through LS-09 are marked done only with durable code, test, Wiki, documentation, bundle, report, result, and pull-request evidence from that combined delivery.
    evidence: []
---

# Local enforcement and bounded scope

The approved direction is complete local operation with GitHub used only as a merge-boundary display. Deterministic checks, project commands, and independent semantic reconciliation run in the invoking development environment. GitHub stores neither the validation engine nor a hosted reviewer; it receives an exact-HEAD commit status and one bounded diagnostic comment.

This change also addresses the two general failure modes exposed by broad Wiki SSOT adoption. A recursive source declaration must keep coverage, impact, drift, and reverse mapping complete without forcing every matched file into every agent read. Review selection must follow explainable risk signals rather than treating all toolkit-history and publisher-measurement files as equally semantic. Both controls are explicit declarations with audit output, not hidden percentage caps or automatic inference.

The delivery sequence is deliberately additive before destructive cleanup. Bootstrap introduces the local result and publisher while the existing remote path remains available. Cutover changes the publisher policy only after the new status exists. Scope control then changes source and review selection semantics with before-and-after evidence. Simplification removes the old choreography and duplicate validators only after their replacements are exercised. Existing adopters retain version 1 behavior and are migrated sequentially rather than being rewritten by kit sync.

No phase adds a daemon, database, GitHub App, generic provider registry, automatic test-selection graph, or global numeric budget. Independent review and exact-HEAD binding remain mandatory wherever configured risk selects them.

## Semantic unchanged-Wiki follow-up

[GitHub issue #60](https://github.com/phlox11/wiki-ssot/issues/60) records a
false-negative in the version 2 review boundary. The downstream
[WorldSweeper PR #49](https://github.com/true-dragonsnest/world-sweeper/pull/49)
correctly declared `semantic_change: true` and `wiki_action: verify`, refreshed
the verification ledger for relevant current pages, passed the exact local
gate, and published `wiki-ssot/local: success`. Its changed web-game paths did
not match another configured risk signal, so Fresh-context review was
`not-required` even though the implementation and regression test established
a user-observable camera-preservation contract that the named current Wiki
pages did not state.

The accepted correction is metadata-aware but remains explicit policy. A
version 2 repository chooses a reasoned `semanticVerify` selector. When enabled,
the canonical `semantic_change: true` plus `wiki_action: verify` combination
requires independent reconciliation regardless of changed-file globs. The
reviewer identifies the changed user- or operator-observable behavior and
locates the actual current-authority text that already states it. If the
contract is absent, the candidate updates current authority; if intended
behavior is undecided, it opens a conflict. Source-hash freshness, page
relevance, and an author-supplied unchanged reason do not substitute for that
semantic comparison.

Existing version 2 adopters must make the choice explicitly after receiving the
upgraded engine. Omission remains readable only so doctor and apply can return a
targeted migration action; it is not a passing disabled default. Explicit
`enabled: false` preserves the existing risk-based behavior, while new
installations and this publisher enable the guardrail. Upgrade does not rewrite
the adopter-owned `.wiki/config.json`.

LS-05 through LS-09 deliver this follow-up as one atomic implementation PR
after this planning record is merged. The sequence fixes configuration and
migration first, then exact selection, reviewer guidance, portable distribution
and current documentation, and finally a network-free regression equivalent to
the incident. Partial stages do not merge independently because a shipped
selector schema without enforcement, or enforcement without migration and
reviewer guidance, would recreate an incomplete trust boundary.

This follow-up does not forbid every semantic `verify`, force meaningless Wiki
edits when current authority already states the behavior, introduce a generic
metadata-expression language, restore an implicit all-PR fallback, weaken
exact-HEAD evidence, or claim that deterministic tooling can discover missing
product intent by itself.

## LS-03 complexity reconciliation

The simplification compares the `91465685ddde78b935aff244ce992dfaaac21a93` base with the final LS-03 candidate using the same repository-local counting commands. It adds two narrowly owned internal modules because they replace duplicated composition and natural-language interpretation rather than hiding either behind another registry.

| Surface | Base | LS-03 candidate | Reconciliation |
|---|---:|---:|---|
| CLI commands | 19 | 19 | no public command added |
| `wiki:*` package scripts | 25 | 25 | no second execution path added |
| non-test TypeScript modules | 44 | 46 | `repository-validation` and `agent-rules` each own one explicit contract; the count includes existing test-fixture helpers consistently on both revisions |
| test modules | 46 | 48 | one focused suite per new contract |
| test cases | 372 | 369 | hostile-prose permutations were removed instead of preserved beside the ID contract; focused regressions cover adapter isolation, single generated-view computation, and mixed/all-done count projections |
| repository-validation composition implementations | 5 | 1 | lint, doctor, audit, legacy check, and canonical check project the shared result |
| natural-language AGENTS parser symbols | present | 0 | marker/version/required-ID validation replaces sentence and negation interpretation |
| TE-04 structural non-diff bytes | 29,974 | 16,189 | unchanged invariant bodies remain, while unaffected invariant implementation sources leave the bundle |
| TE-04 reviewer source breadth | 28 | 5 | changed, affected, conflict-derived, test, and lifecycle-required sources remain exact |

Every command still has its previous public flags and output contract. `wiki:work` and review-bundle changes are projections over the existing complete queue and invariant body set, so the internal truth was not truncated to obtain smaller output. Version 1 GitHub attestation remains one config-gated compatibility module; version 2 doctor and canonical check do not resolve it. No daemon, adapter registry, hosted service, numeric budget, command, or package script was introduced.
