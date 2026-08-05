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
related: [architecture/engine, product/invariants, operations/enforcement]
tags: [scope, product]
---

# Scope

wiki-ssot turns a repository's development knowledge into a small set of `status: current` wiki pages that are the single source of truth for intent, architecture, contracts, invariants, and operations, and it ships deterministic tooling that keeps those pages honest against the code on every commit and pull request.

## In scope

- A page schema and frontmatter contract (`wiki/SCHEMA.md`).
- A repository-wide, offline work graph stored with proposal rationale, including executor classification independent from state, plus a no-query command and generated queue that let a fresh session discover agent-capable work and hand human work off without knowing a wiki node or task ID.
- Deterministic CLI checks: structure lint, generated-file freshness, code→page impact, source staleness, configured coverage, and a conflict lifecycle. Coverage applies to files matched by `.wiki/coverage.json`, each of which must map to current authority or a reasoned exclusion.
- A pre-PR command that deterministically classifies risk, prepares an independent-review bundle, and validates the returned structured Fresh-context report before publication.
- Explicit solo and team trust policies: separate review context is always procedural, while distinct GitHub actors are optional and machine-enforced only when configured.
- Enforcement rails within a trusted repository-developer boundary: a provider-neutral agent entrypoint (`AGENTS.md`) with machine-checked affirmative authority, work-discovery, and focused-context clause shapes; local git hooks; CI jobs; and downstream integration seams.
- One idempotent apply loop across every lifecycle state: install while beginning a Git project, adopt into an existing codebase, or upgrade an installed Wiki SSOT. Every path performs the same deterministic Wiki/code checks and returns project-specific semantic reconciliation to the invoking coding agent.
- A generated `kit/` distribution with separate kit-owned, managed-block, seeded project-owned, and reference content. Upgrades replace only what the toolkit owns, preserve host scripts/workflows and project policy, split the recognized version 1 combined CI into retained host code checks plus dedicated Wiki checks, and fail closed instead of overwriting ambiguous customizations. This repository's own wiki pages, conflicts, and proposals are instance content and are not part of it.

## Validated boundary

The Primary exit gate is validated by the checked-in PV-18 and PV-19 evidence.
Against the exact PV-19 current-engine revision, all eight versioned scenarios
passed: current pages, invariants, conflicts, implementation sources, authority
labels, non-current separation, expected wiki actions, configured coverage,
candidate gates, and code-only drift probes met their declared expectations.
PV-18 and the adoption fixtures preserve both documented starting paths to
green, including an existing-repository review defect that was reconciled
before exact PASS.

The validated user expectation is that a fresh session can discover
repository-wide work without an internal ID, keep human-exclusive work visible
without agent auto-selection or assumed authority, load a selected item's controlling
current authority and sources, trace every configured covered file to a current
page or exclusion, and complete the installed review path when deterministic
risk policy selects it. The required installation seam is the affirmative root
`AGENTS.md` routing contract, structured PR metadata, canonical package
commands, and the Ready-only CI attestation job; `wiki:doctor` validates those
surfaces.

This validation does not extend beyond the explicit limits below. In
particular, it does not claim coverage of arbitrary files outside
`.wiki/coverage.json`, model comprehension, cryptographically fresh reasoning,
automatic authorization, or protection against a hostile maintainer.

## Not in scope

- Rendering or hosting a documentation website.
- Replacing the wiki with an auto-generated API reference.
- Deciding product questions on the agent's behalf: an ambiguous decision is a conflict, not an invention.
- Automatically executing recommended work. Queue recommendation and executor classification are deterministic discovery metadata, not authorization; `either` grants no additional permission.
- Running or hosting a particular LLM/reviewer in core or CI. The invoking code agent supplies a context-isolated reviewer or sub-agent; core prepares and validates its artifact.
- Claiming cryptographic proof that a reviewer had a genuinely fresh context. The selected reviewer/orchestrator defines that trust boundary.
- Treating repository developers or administrators as hostile actors. wiki-ssot trusts them not to rewrite validation or weaken repository settings; required workflows, CODEOWNERS staffing, rulesets, and administrator-bypass policy are deployment governance outside the product contract.
