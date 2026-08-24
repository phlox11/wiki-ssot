---
id: product/scope
summary: wiki-ssot's Primary findability and adoption path is validated within configured coverage and trusted-maintainer bounds; it remains a portable toolkit, not a hosted reviewer or decision-maker.
kind: product
status: current
authority: normative
owners: ["@phlox11"]
sources:
  - path: README.md
  - path: docs/design.md
  - path: scripts/wiki-scale-benchmark.ts
  - path: docs/evidence/wsn-01-schooled-scale.json
  - path: docs/evidence/wsn-01-large-scale.json
related: [architecture/engine, product/invariants, operations/enforcement]
tags: [scope, product]
---

# Scope

wiki-ssot turns a repository's development knowledge into a small set of `status: current` wiki pages that are the single source of truth for intent, architecture, contracts, invariants, and operations, and it ships deterministic tooling that keeps those pages honest against the code on every commit and pull request.

## In scope

- A page schema and frontmatter contract (`wiki/SCHEMA.md`).
- A repository-wide, offline work graph stored with proposal rationale, including executor classification independent from state, plus a no-query command and generated queue that let a fresh session discover agent-capable work and hand human work off without knowing a wiki node or task ID. Selected-work and topic context default to compact routing through mandatory anchors and digest-bound catalog sets, while tracking remains source-complete and explicit `--full` expansion remains available; partial-only discovery returns focused candidates before any full-body expansion.
- Bounded generated entrypoints backed by a complete catalog, cumulative lifecycle counts, and a deterministic page/work/conflict relationship graph. These projections expose accumulated records and directed navigation without becoming current authority or changing source, conflict, work, impact, or review semantics.
- Deterministic CLI checks: structure lint, generated-file and inventory freshness, code→page impact, source staleness, configured coverage, conflict lifecycle, and an exact committed-HEAD result envelope. Coverage applies to files matched by `.wiki/coverage.json`, each of which must map to current authority or a reasoned exclusion.
- An auditable source/read/review scope projection that explains broad-set size, reverse authority/conflict fan-out, file-to-review cause paths, potential selection, and merge-base deltas without imposing repository-global count, percentage, or byte budgets.
- A pre-PR command that deterministically classifies risk from canonical semantic metadata and explicit repository signals, prepares a content-addressed independent-review bundle with focused, role-classified source inputs, and validates both the bundle and returned structured report before publication. Version 2 repositories choose a reasoned semantic-verify selector: enabled selects semantic `verify` metadata without a path match, while explicit false retains the other configured signals.
- A procedural independent-review boundary in version 2 local-status mode; authenticated actor separation remains a version 1 or external-enforcement concern and is never silently weakened during migration.
- Enforcement rails within a trusted repository-developer boundary: a provider-neutral agent entrypoint (`AGENTS.md`) rendered from a typed, versioned managed rule list whose stable IDs are structurally checked without prose interpretation; local git hooks; one shared repository-validation result projected by the public diagnostics and exact-result gate; a narrow GitHub commit-status/comment publisher; and downstream integration seams.
- One idempotent apply loop across every lifecycle state: install while beginning a Git project, adopt into an existing codebase, or upgrade an installed Wiki SSOT. Every path performs the same deterministic Wiki/code checks and returns project-specific semantic reconciliation to the invoking coding agent. New installations enable semantic verify; upgrade preserves project-owned policy and requires an explicit migration choice when the selector is absent.
- A generated `kit/` distribution with separate kit-owned, managed-block, seeded project-owned, and reference content. New installations receive no active GitHub workflow. Upgrades replace only what the toolkit owns, preserve host scripts/workflows and project policy, retain version 1 compatibility inputs, and fail closed instead of deleting or overwriting ambiguous customizations. This repository's own wiki pages, conflicts, and proposals are instance content and are not part of it.

## Validated boundary

The Primary exit gate is validated by the checked-in PV-18 and PV-19 evidence.
Against the exact PV-19 current-engine revision, all eight versioned scenarios
passed: current pages, invariants, conflicts, implementation sources, authority
labels, non-current separation, expected wiki actions, configured coverage,
candidate gates, and code-only drift probes met their declared expectations.
PV-18 and the adoption fixtures preserve both documented starting paths to
green, including an existing-repository review defect that was reconciled
before exact PASS.

The publishing-only portable-scale evidence additionally validates the exact
Schooled-equivalent profile and a supported-large profile of 1,000 current
pages, 100 proposals, 10,000 work items, 1,000 conflicts, and 10,000 declared
source files. Its 30-second engine-phase, 1-GiB RSS, and 64-KiB root-index
limits are absolute diagnostics on the recorded environment, not CI timing
assertions or claims above that profile. Global validation remains complete.

The validated user expectation is that a fresh session can discover
repository-wide work without an internal ID, keep human-exclusive work visible
without agent auto-selection or assumed authority, start topic work with one
query-based context command, load a selected item's controlling current
authority and sources, trace every configured covered file to a current
page or exclusion, and complete the installed review path when deterministic
risk policy selects it. The required installation seam is the versioned root
`AGENTS.md` managed rule-ID contract, structured semantic PR metadata, canonical package
commands, valid local-status configuration, and the exact result publication
path; `wiki:doctor` validates those surfaces.

This validation does not extend beyond the explicit limits below. In
particular, it does not claim coverage of arbitrary files outside
`.wiki/coverage.json`, model comprehension, cryptographically fresh reasoning,
automatic authorization, or protection against a hostile maintainer.

## Not in scope

- Rendering or hosting a documentation website.
- Replacing the wiki with an auto-generated API reference.
- Deciding product questions on the agent's behalf: an ambiguous decision is a conflict, not an invention.
- Automatically executing recommended work. Queue recommendation and executor classification are deterministic discovery metadata, not authorization; `either` grants no additional permission.
- Running or hosting a particular LLM/reviewer in core or GitHub. The invoking code agent supplies a context-isolated reviewer or sub-agent; core prepares and validates its artifact.
- Claiming cryptographic proof that a reviewer had a genuinely fresh context. The selected reviewer/orchestrator defines that trust boundary.
- Treating repository developers or administrators as hostile actors. wiki-ssot trusts them not to rewrite validation or weaken repository settings; required workflows, CODEOWNERS staffing, rulesets, and administrator-bypass policy are deployment governance outside the product contract.
