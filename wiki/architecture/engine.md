---
id: architecture/engine
summary: A provider-neutral Bun/TypeScript engine drives deterministic wiki and Fresh-context attestation checks; thin CLI, GitHub adapter, and inventory seams connect it to repositories.
kind: architecture
status: current
authority: observed
owners: ["@phlox11"]
sources:
  - glob: scripts/wiki/*.ts
related: [operations/enforcement, product/invariants]
tags: [architecture, engine]
---

# Engine

Provider-neutral logic lives in `scripts/wiki/core.ts`: frontmatter/schema/link checks, source→page mapping, coverage, blob-hash staleness (`.wiki/state.json`), diff impact, PR metadata and conflict lifecycle, provider-neutral integration-seam validation, deterministic risk classification, review manifests, and Fresh-context report validation over version 1 free-text findings or version 2 structured findings. `scripts/wiki/cli.ts` is a thin command layer exposing pre-PR `wiki:review-preflight`, lower-level `wiki:review-bundle` / `wiki:review-check`, and `wiki:doctor` with stable machine-readable findings. Preflight returns `not-required`, `review-required`, `needs-reconcile`, or `pass`, prepares the exact bundle before a PR exists, and validates a separate review context's report without treating the still-pending PR-body mirror as evidence.

The review manifest binds the repository-relative base ref, exact merge-base and HEAD SHAs, canonical semantic PR metadata/impact/diff digests, affected page/invariant/conflict IDs, and sorted bundle file hashes. Timestamp, output directory, JSON key order, and OS temporary paths never enter the digest.

Version 2 findings are adjudicated, not merely shape-checked. A fixed table decides which dispositions retire which classification, so `candidate_regression` and `declared_contract_violation` accept only `fixed` or `unresolved`, `decision_ambiguity` accepts `fixed`, `unresolved`, or a conflict disposition but never a dismissal or follow-up, and `recorded` is confined to a `suggestion`. A disposition naming a conflict is resolved against the open conflicts at the reviewed HEAD and must match on the conflict type its classification implies where one is implied, on `origin: baseline` for a classification asserting the problem predates the candidate, and on at least one page shared with the finding's `page:` scope refs — a finding naming no page cannot be tracked by a conflict at all, since every conflict declares an affected page. `unrelated_defect` implies no conflict type, and `decision_ambiguity` is exempt from the `origin` rule because a change may legitimately raise a new question about its own behaviour.

Because `origin` is authored and `classification` is reviewed independently, the `origin` rule stops a finding from being filed as pre-existing while the conflict it names admits the change introduced it. It does not audit `origin` against the diff, so a conflict mislabelled `baseline` still passes it; what blocks a candidate-caused break is the table, which admits no deferring disposition at all once the reviewer classifies it as one. The table applies whether or not a conflict list is supplied; only conflict-pointer resolution requires one, and `reviewCheck` always supplies it, so an empty repository conflict set makes every pointer dangling.

Ready CI validates with the merge-base engine and policy, so the bundle a candidate is measured against is the one the *base* engine emits. Bundle content is therefore version-bound rather than frozen: a change to the prompt, report contract, or impact JSON shape governs the PRs that follow it, and the PR introducing that change must generate its own bundle with the base engine (`bun <base-checkout>/scripts/wiki/cli.ts review-preflight --root <candidate>`) so the digest CI recomputes matches. Report validation accepts version 1 and version 2, so a report prepared before an engine upgrade is never invalidated by the upgrade itself.

The engine is provider- and framework-agnostic. Three adapters stay outside its trust-neutral contract:

- `.wiki/config.json` — display name, `highRisk` globs, and explicit Fresh-context mode/evidence/reviewer trust policy. Optional `requiredWhen` keeps legacy all-PR behavior when omitted or selects trusted changed-file, invariant, conflict, and current-page-removal risk signals. Affected invariants are preserved from both the merge base and HEAD, so changing an invariant's kind cannot remove the risk signal.
- `scripts/wiki/inventories.ts` — an adapter that emits deterministic `wiki/_generated/**` pages from code; it returns `{}` by default. See `scripts/wiki/inventories.example.ts` for a reference implementation over API routes, shared contracts, database tables, and app routes.
- `scripts/wiki/github-attestation.ts` — the GitHub reference adapter that selects the newest marked report from authenticated PR review/comment envelopes, preserves malformed newest reports for fail-closed core validation, passes the actor identity to the core validator, and checks GitHub-specific PR-template/workflow seams.

`scripts/wiki/wiki.test.ts` and `scripts/wiki/fresh-context.test.ts` exercise the engine against synthetic in-memory and temporary git repositories, including determinism, legacy all-PR compatibility, merge-base invariant preservation, pre-PR bundle/report validation, risk classification, stale SHA/digests, trust policy, metadata bypass, integration omission, and CLI end-to-end behavior. They depend only on `bun`, `typescript`, and `yaml`; git-backed reads shell out to `git`.
