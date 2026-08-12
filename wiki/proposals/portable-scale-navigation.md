---
id: proposal/portable-scale-navigation
summary: Bound Wiki entrypoints, expose cumulative records and explicit relationships, validate a large portable scale profile, and reduce unnecessary CI history fetches without weakening global validation.
kind: proposal
status: proposed
authority: normative
owners: ["@phlox11"]
sources:
  - path: scripts/wiki/generated-views.ts
  - path: scripts/wiki/generated-views.test.ts
  - path: scripts/wiki/core.ts
  - path: scripts/wiki/page-validation.ts
  - path: scripts/wiki/page-validation.test.ts
  - path: scripts/wiki-scale-benchmark.ts
  - path: scripts/wiki/publisher-boundary.test.ts
  - path: scripts/wiki/cli-discovery-handlers.ts
  - path: scripts/wiki/work-selected-context.test.ts
  - path: scripts/wiki/kit-packaging.ts
  - path: scripts/wiki/kit-packaging.test.ts
  - path: scripts/wiki/apply.test.ts
  - path: .github/workflows/wiki-ssot.yml
  - path: .github/workflows/kit.yml
  - path: package.json
  - path: README.md
  - path: docs/design.md
  - path: docs/commands.md
  - path: docs/adopt-existing-repo.md
  - path: docs/adopt-new-repo.md
  - path: kit/README.md
  - path: wiki/README.md
  - path: wiki/SCHEMA.md
  - path: wiki/WORKFLOW.md
  - path: wiki/changelog.md
  - path: docs/evidence/wsn-01-schooled-scale.json
  - path: docs/evidence/wsn-01-large-scale.json
affects: [product/scope, product/invariants, architecture/engine, operations/enforcement]
related: [proposal/primary-findability-validation, proposal/token-efficiency, architecture/engine, operations/enforcement]
tags: [scale, navigation, catalog, graph, history, performance, ci, migration]
work_items:
  - id: WSN-00
    title: Ratify the portable scale and generated-navigation contract
    state: done
    executor: human
    priority: high
    depends_on: []
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Current pages remain the mutable current-contract snapshot; done work, resolved conflicts, selected changelog entries, and Git retain their distinct history roles.
      - The root index is bounded by first-segment group count, while a complete generated catalog and deterministic relationship graph preserve drill-down reachability.
      - Related and affects edges are navigational declarations; work, conflict, source, coverage, impact, and review relations retain their existing enforcement semantics.
      - Global page, work, conflict, generated, audit, and impact validation remains complete; no scale optimization may hide authority or make a derived cache authoritative.
      - The supported large diagnostic profile is 1,000 current pages, 100 proposals, 10,000 work items, 1,000 conflicts, and 10,000 declared source files, with an absolute 30-second engine-phase and 1-GiB RSS diagnostic boundary on the recorded environment.
      - Existing repositories migrate through the ordinary safe apply loop; project-owned current, proposal, conflict, config, coverage, verification, and changelog content is not rewritten or guessed.
    evidence:
      - wiki/proposals/portable-scale-navigation.md
  - id: WSN-01
    title: Deliver bounded navigation, cumulative visibility, scale evidence, and safe downstream upgrade
    state: done
    executor: agent
    priority: high
    depends_on: [WSN-00]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Repository work views call the complete set Open conflicts and regression coverage includes decision, implementation, and documentation types.
      - Generated index size depends on group count rather than page count, the complete catalog remains reachable, current invariants remain directly discoverable, and current status reports deterministic cumulative page, proposal, work, conflict, and archived or deprecated counts.
      - A versioned generated relationship graph contains every Wiki page and work item plus declared related, affects, conflict-affects, work-context, and work-dependency edges in deterministic order; source relations remain in the existing reverse map.
      - A publishing-only reproducible harness validates the Schooled-equivalent and supported-large profiles, records counts, bytes, phase durations, peak RSS, input digest, and correctness, and never becomes a downstream command or authority source.
      - Structure, generated, and kit-freshness jobs avoid full-history checkout, while history-sensitive impact, attestation, and publisher historical-regression jobs retain it.
      - The existing apply path updates pristine kit-owned files, fails closed on customized double edits, converges idempotently, and requires no rewrite of project-owned Wiki records.
      - Current Wiki pages, documentation, generated artifacts, kit output, focused tests, full tests, typechecks, impact enforcement, and exact-HEAD independent reconciliation agree at delivery.
    evidence:
      - scripts/wiki/generated-views.test.ts
      - scripts/wiki/page-validation.test.ts
      - scripts/wiki/publisher-boundary.test.ts
      - scripts/wiki/kit-packaging.test.ts
      - scripts/wiki/apply.test.ts
      - docs/evidence/wsn-01-schooled-scale.json
      - docs/evidence/wsn-01-large-scale.json
      - wiki/catalog.md
      - .wiki/relationship-graph.json
---

# Portable scale and generated navigation

This proposal records the owner-approved response to the Schooled repository's
flat-index, cumulative-history, relationship-navigation, full-load, and CI
history-fetch diagnosis. It does not replace Wiki SSOT with a search service,
split archived records into a second authority, or weaken repository-wide
validation. It makes the existing accumulation model visible, adds a bounded
human entrypoint and a complete derived drill-down plane, and establishes the
first reproducible portable scale boundary before considering incremental
validation.

## Ratified truth and history model

- `status: current` pages are mutable snapshots of the current contract.
- Proposal work items retain future-work contracts and durable done evidence.
- Resolved conflict pages retain decisions, acceptance, and resolution evidence.
- `wiki/changelog.md` records selected contract-level milestones.
- Git is the history of record for ordinary changes.

No append-only activity log is added. A second manually maintained history
would create another drift surface. Generated counts, catalog entries, and graph
edges are projections of repository records and can always be rebuilt.

## Navigation contract

`wiki/index.md` remains the first read but contains one deterministic entry per
first path segment rather than every current page. `wiki/catalog.md` is the
complete generated catalog. `wiki/current-status.md` keeps every current
invariant directly reachable and summarizes current pages, proposal pages,
total/outstanding/done work, total/open/resolved conflicts, and archived or
deprecated pages.

`.wiki/relationship-graph.json` is a versioned derived machine view. Page and
work nodes retain their stable IDs. Edges reproduce declared `related`,
`affects`, conflict affected-page/invariant, work context-page, and work
dependency relations exactly and directionally. It does not promote a related
page into authority, propagate impact through a navigational edge, or duplicate
source-map nodes.

## Scale contract

The publishing-only harness uses deterministic disposable repositories. The
Schooled-equivalent profile fixes 26 current pages, 5 proposals, 29 work items,
and 12 conflicts split into 3 open and 9 resolved. The supported-large profile
fixes 1,000 current pages, 100 proposals, 10,000 work items, 1,000 conflicts
split into 250 open and 750 resolved, and 10,000 declared source files.

The large profile passes only with zero page/work/conflict validation findings,
exact catalog/node/edge counts, a root index no larger than 64 KiB, measured
engine phases completing within 30 seconds, and peak RSS no larger than 1 GiB
on the recorded environment. Runtime and memory are reproducible diagnostics,
not per-commit CI timing assertions or claims about every host. The documented
profile is the official validated boundary; larger repositories remain
unclaimed until another exact evidence cycle extends it.

Full parsing and repository-wide graph validation remain the correctness path
for this cycle. A later incremental design requires its own proof that cache
invalidation, malformed records, duplicate IDs, unknown relations, cycles, and
stale generated data cannot escape the full checks.

## CI and downstream migration

Only jobs proven not to inspect history drop `fetch-depth: 0`: Wiki structure,
generated freshness, and publisher kit freshness. Impact and attestation retain
the base/merge-base history they consume; publisher tests retain the history
needed by exact-revision evidence.

Existing repositories run the same `apply.ts --into <repo>` loop. Kit-owned
engine, workflow, schema, and Wiki entrypoint files update through the recorded
three-way baseline; generated catalog/status/graph artifacts rebuild from local
content. Project-owned config, coverage, verification state, inventories,
current pages, proposals, conflicts, and changelog remain untouched. A local
and upstream double edit still produces `.kit-new` and requires explicit
reconciliation. No relationship is invented during upgrade.

## Non-goals

- No hosted graph UI, vector database, embedding service, or LLM in validation.
- No deletion, compaction, or relocation of done work or resolved conflicts.
- No automatic relationship inference.
- No incremental-validation claim in this cycle.
- No change to exact-HEAD review, source traceability, coverage, or conflict
  lifecycle guarantees.
