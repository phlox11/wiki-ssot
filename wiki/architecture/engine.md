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

Provider-neutral logic lives in `scripts/wiki/core.ts`: frontmatter/schema/link checks, source→page mapping, coverage, blob-hash staleness (`.wiki/state.json`), diff impact, PR metadata and conflict lifecycle, provider-neutral integration-seam validation, deterministic risk classification, review manifests, and Fresh-context report validation. `scripts/wiki/cli.ts` is a thin command layer exposing `wiki:review-bundle`, `wiki:review-check`, and `wiki:doctor` with stable machine-readable findings. `wiki:review-check` returns `required` and deterministic `requirementReasons`; `wiki:doctor` composes the core seam checks with the selected provider adapter's checks.

The review manifest binds the repository-relative base ref, exact merge-base and HEAD SHAs, canonical semantic PR metadata/impact/diff digests, affected page/invariant/conflict IDs, and sorted bundle file hashes. Timestamp, output directory, JSON key order, and OS temporary paths never enter the digest.

The engine is provider- and framework-agnostic. Three adapters stay outside its trust-neutral contract:

- `.wiki/config.json` — display name, `highRisk` globs, and explicit Fresh-context mode/evidence/reviewer trust policy. Optional `requiredWhen` keeps legacy all-PR behavior when omitted or selects trusted changed-file, invariant, conflict, and current-page-removal risk signals.
- `scripts/wiki/inventories.ts` — an adapter that emits deterministic `wiki/_generated/**` pages from code; it returns `{}` by default. See `scripts/wiki/inventories.example.ts` for a reference implementation over API routes, shared contracts, database tables, and app routes.
- `scripts/wiki/github-attestation.ts` — the GitHub reference adapter that selects the newest marked report from authenticated PR review/comment envelopes, preserves malformed newest reports for fail-closed core validation, passes the actor identity to the core validator, and checks GitHub-specific PR-template/workflow seams.

`scripts/wiki/wiki.test.ts` and `scripts/wiki/fresh-context.test.ts` exercise the engine against synthetic in-memory and temporary git repositories, including determinism, legacy all-PR compatibility, risk classification, stale SHA/digests, trust policy, metadata bypass, integration omission, and CLI end-to-end behavior. They depend only on `bun`, `typescript`, and `yaml`; git-backed reads shell out to `git`.
