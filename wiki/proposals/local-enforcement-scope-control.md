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
  - path: scripts/wiki/impact.ts
  - path: scripts/wiki/review-bundle.ts
  - path: scripts/wiki/apply.ts
  - path: scripts/wiki/github-attestation.ts
  - path: scripts/wiki/local-check.ts
  - path: scripts/wiki/github-local-status.ts
  - path: .github/workflows/wiki-ssot.yml
  - path: .github/pull_request_template.md
affects: [architecture/engine, operations/enforcement, product/invariants, product/scope]
related: [proposal/token-efficiency, proposal/portable-scale-navigation, architecture/engine, operations/enforcement]
tags: [local, enforcement, github, scope, context, review, adoption, simplification]
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
    state: not-started
    executor: agent
    priority: critical
    depends_on: [LS-00]
    context_pages: [product/invariants, architecture/engine, operations/enforcement, product/scope]
    acceptance:
      - Version 2 config explicitly declares local-status enforcement, argv-based project checks, and risk-based review selection while version 1 behavior remains compatible.
      - The publisher no longer requires the PR-body report mirror, Draft-to-Ready choreography, or active Wiki Actions workflows after the local status becomes the protected merge boundary.
      - Legacy version 1 GitHub attestation remains isolated for one compatibility release and is not imported by the version 2 core path.
      - Doctor reports actionable needs-reconcile guidance when local-status configuration and legacy active workflows coexist.
    evidence: []
  - id: LS-02
    title: Bound source context and independent-review selection with auditable causes
    state: not-started
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
    evidence: []
  - id: LS-03
    title: Remove validation, agent-rule, context, work-output, and publication choreography duplication
    state: not-started
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
    evidence: []
  - id: LS-04
    title: Validate safe version 1 upgrades and migrate known adopters sequentially
    state: not-started
    executor: either
    priority: high
    depends_on: [LS-03]
    context_pages: [product/invariants, architecture/engine, operations/enforcement, product/scope]
    acceptance:
      - Pristine and customized version 1 fixtures preserve project configuration, Wiki pages, host workflows, and removed-upstream files through dry-run and idempotent apply reruns.
      - Each known adopter copies its actual host checks into argv-based localChecks, classifies broad sources, removes Wiki Actions only after reconciliation, publishes an exact local status, and changes its branch requirement only after that status exists.
      - Adopters are migrated one repository and one PR at a time, and each later migration uses the previous result only as a mechanical template while reading its own workflow and configuration directly.
      - The post-merge apply rerun is ready and the next adopter PR creates no Wiki Actions run.
    evidence: []
---

# Local enforcement and bounded scope

The approved direction is complete local operation with GitHub used only as a merge-boundary display. Deterministic checks, project commands, and independent semantic reconciliation run in the invoking development environment. GitHub stores neither the validation engine nor a hosted reviewer; it receives an exact-HEAD commit status and one bounded diagnostic comment.

This change also addresses the two general failure modes exposed by broad Wiki SSOT adoption. A recursive source declaration must keep coverage, impact, drift, and reverse mapping complete without forcing every matched file into every agent read. Review selection must follow explainable risk signals rather than treating all toolkit-history and publisher-measurement files as equally semantic. Both controls are explicit declarations with audit output, not hidden percentage caps or automatic inference.

The delivery sequence is deliberately additive before destructive cleanup. Bootstrap introduces the local result and publisher while the existing remote path remains available. Cutover changes the publisher policy only after the new status exists. Scope control then changes source and review selection semantics with before-and-after evidence. Simplification removes the old choreography and duplicate validators only after their replacements are exercised. Existing adopters retain version 1 behavior and are migrated sequentially rather than being rewritten by kit sync.

No phase adds a daemon, database, GitHub App, generic provider registry, automatic test-selection graph, or global numeric budget. Independent review and exact-HEAD binding remain mandatory wherever configured risk selects them.
