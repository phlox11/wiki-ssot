---
id: operations/enforcement
summary: Three rails enforce the wiki within a trusted-maintainer boundary — zero-knowledge agent entry, local hooks, and an exact local gate published as a GitHub commit status.
kind: operation
status: current
authority: normative
owners: ["@phlox11"]
sources:
  - path: .wiki/config.json
  - path: AGENTS.md
  - path: package.json
  - path: .github/pull_request_template.md
  - path: .husky/pre-commit
  - path: .husky/pre-push
  - path: scripts/wiki/core.ts
  - path: scripts/wiki/model.ts
  - path: scripts/wiki/serialization.ts
  - path: scripts/wiki/repository-view.ts
  - path: scripts/wiki/page-validation.ts
  - path: scripts/wiki/work-validation.ts
  - path: scripts/wiki/discovery.ts
  - path: scripts/wiki/context.ts
  - path: scripts/wiki/generated-views.ts
  - path: scripts/wiki/kit-packaging.ts
  - path: scripts/wiki/kit-growth-guard.ts
  - path: scripts/wiki/verification.ts
  - path: scripts/wiki/impact.ts
  - path: scripts/wiki/review-bundle.ts
  - path: scripts/wiki/review-attestation.ts
  - path: scripts/wiki/local-check.ts
  - path: scripts/wiki/github-local-status.ts
  - path: scripts/wiki/cli-runtime.ts
  - path: scripts/wiki/cli-render.ts
  - path: scripts/wiki/cli-discovery-handlers.ts
  - path: scripts/wiki/cli-generation-handlers.ts
  - path: scripts/wiki/cli-validation-handlers.ts
  - path: scripts/wiki/cli-review-handlers.ts
  - path: scripts/wiki/cli.ts
  - path: scripts/wiki/github-attestation.ts
  - path: scripts/wiki/apply.ts
related: [architecture/engine, product/invariants]
tags: [enforcement, local-status, hooks]
---

# Enforcement

Enforcement is attached to events that always happen. Semantic review is external; its exact report and the deterministic repository checks are bound into one local result and published for the PR HEAD.

- **Session start and bounded handoff.** Every agent reads `AGENTS.md`. A generic remaining, unfinished, or next-work request runs `wiki:work` without asking for a search term or internal ID; only recommended active or ready `agent`/`either` work may be selected automatically. Human work remains visible and queryable but must be reported with its procedure and handed to a human without assumed credentials or authority. The printed `wiki:context -- --work <ID>` command supplies a compact projection of the exact work contract plus an invariant → conflict → current-page → expanded-source read order. Selected-work and complete-match topic context retain every page/conflict identity, status, authority, Wiki path, source declaration and expansion, page-local conflict, body digest, and focused command without embedding complete bodies or a duplicate aggregate source list; `--full` restores the exhaustive body-complete representation. Selected-work keeps its proposal owner separate, and only current authority/conflicts enter the authoritative read order. Topic-specific `wiki:search` and query-based `wiki:context` share deterministic matching: complete all-term matches keep their selection behavior, while a partial-only default context returns ordered candidate metadata and focused commands instead of expanding every partial body. Once selection and prospective PR metadata are fixed at a clean committed HEAD, one body-free selected-work artifact may be shared across authoring and implementation roles; every consumer validates its selector, metadata, base, merge-base, HEAD, page, conflict, source, context, read-order, and artifact digests before reuse and still reads the required authority and sources directly. At one exact revision, roles batch independent reads and deterministic checks, avoid repeated queue or broad-context reconstruction, use bounded waits instead of polling, and keep success summaries bounded with digest-addressable full evidence. A materially grown authoring context creates one bounded phase handoff before publication rather than replaying the session.
- **Local commit.** `.husky/pre-commit` runs `wiki:lint --staged`; `.husky/pre-push` blocks direct pushes to `main`. Hooks are bypassable feedback, not a security boundary.
- **Pre-PR semantic reconciliation.** After deterministic checks and prospective PR metadata are complete, `wiki:review-preflight` evaluates trusted risk policy before any PR exists. Low-risk candidates are ready immediately. For selected changes it emits an exact bundle for a context-isolated reviewer. The bundle stores authority/conflict bodies once by content digest and carries a focused manifest whose overlapping roles distinguish changed sources, directly affected authority sources, relevant tests, and supporting sources with declaration and glob provenance. Preflight validates every required role, object, source, and digest binding before the reviewer receives it; this removes duplicate bodies and broad-source rereading without dropping current invariants, conflicts, changed primary sources, or relevant tests. The authoring agent dispositions every returned finding — fixing what this candidate broke or declared, tracking a pre-existing mismatch or undecided intent in an open conflict, recording a named follow-up for an out-of-scope defect — and reruns preflight on the new HEAD until the candidate passes or requires an explicit owner decision. Preflight rejects a disposition the finding's classification does not admit, and a conflict pointer that does not resolve to a matching open conflict, so a deferral that only looks like tracking fails before the PR exists.
- **Canonical local gate.** `wiki:check --base <ref> --metadata <file> [--report <file>] --output <result.json>` requires a committed candidate, allows only the declared metadata, report, and output artifacts outside that candidate, and combines structural, generated, inventory, state, impact, conflict, and configured review checks in one result. Version 2 also executes every `localChecks` argv array. A changed publisher `KIT_ENTRIES` or adopter manifest-owned file selects the Wiki tooling typecheck and complete tooling suite; publisher mode also selects kit freshness and module growth guards. The result binds only each command's stable ID, argv array, exit code, and outcome—not logs, timing, memory, or temporary paths—and cannot pass a risk-selected change without a valid independent report. Calls that omit `--output` preserve the established check output and enforcement flags.
- **Local GitHub publication.** `wiki:publish -- --result <result.json> [--repo <owner/repo>] [--pr <number>]` uses the caller's authenticated `gh` session without reading or printing a token. Before any write it validates the result schema and digest, clean local HEAD, and exact remote PR head. It then creates or updates one `<!-- wiki-ssot:local-status -->` diagnostic comment and writes the configured commit-status context last. Warnings keep a successful result successful and are counted in the comment; API failure is a command failure and cannot be reported by that invocation as a success status. No daemon, pending status, GitHub App, database, or hosted reviewer is added.
- **Pull request merge boundary.** The publisher and new kit ship no active GitHub Actions workflow. GitHub receives only the exact local status/comment, and a repository may require that status in branch protection. A new SHA has no matching status, so it must be checked and published again. The PR template carries semantic metadata and the result summary; version 2 has no report mirror or Draft→Ready choreography.
- **Portable growth guard.** Publisher mode runs `wiki:tooling:guard` locally over installed Kit-owned TypeScript boundaries: 1,000 lines/64 KiB generally, 250 lines for `cli.ts`, and a reported 1,000-line/68-KiB `review-bundle.ts` exception. Unclassified or oversized paths fail with split, bounded-exception, or owner-revision guidance; aggregate repository size is ignored.
- **Version 2 review trust path.** Risk selection uses reasoned changed-file rules, actual kit-owned file membership, merge-base/HEAD affected invariants and conflicts, and current-page removals. It does not select the whole `scripts/wiki/**` tree merely because publisher-only measurements or historical fixtures live there. Selected changes require the same exact bundle, independent report, disposition contract, evidence, HEAD, merge-base, and bundle-digest bindings. Local-status mode claims procedural context isolation only; it does not claim an authenticated separate GitHub actor.
- **Recursive publishing boundary.** In this publishing repository,
  `.wiki/coverage.json` and the current engine page cover
  `scripts/wiki/**/*.ts`, while high-risk staleness retains the broader
  `scripts/wiki/**` tree. A nested implementation or test file is consequently
  source-mapped, coverage-checked, and high-risk. Independent review is selected
  separately from publisher `KIT_ENTRIES` or an adopter's installed manifest so
  publisher-only measurements and historical fixtures do not widen review by
  directory accident. The generated downstream seed intentionally keeps its
  adopter-owned coverage and domain-specific `highRisk` policy separate.
- **Unified install/upgrade.** `scripts/wiki/apply.ts` is the sole public lifecycle entrypoint. It detects a no-commit `new` repository, an existing-code `adopt` repository, or an installed `upgrade`; applies kit-owned files, managed integration blocks, and the compatible package fragment; installs hooks; regenerates; and runs doctor, lint, audit, Wiki tooling typecheck, and Wiki tooling tests. It returns `needs-merge` for unsafe mechanical integration and `needs-reconcile` for missing or stale project meaning, then the invoking coding agent reruns the same command. A byte-preserving dry-run returns `preview` only for a mechanically safe plan with no bootstrap findings; it reports bootstrap findings as `needs-reconcile` otherwise and never reports the fully checked `ready` state. It never invokes a model or performs Git branch/commit/PR operations.
- **Scale-navigation upgrade.** The ordinary apply path upgrades pristine kit-owned engine, schema, and Wiki entrypoint files and then regenerates the local catalog, cumulative status, relationship graph, and reverse maps. Project-owned current pages, proposals, conflicts, config, coverage, verification state, inventories, changelog, and existing workflows are not rewritten or deleted by inference. Customized double edits retain the existing `.kit-new`/explicit-accept path, and repeated apply remains idempotent.
- **Publisher-only checks.** The canonical local gate retains the repository-wide project typecheck (including the publisher scale harness), runs the Wiki tooling typecheck and complete tooling suite once, and adds kit freshness and module-growth guards when `publishesKit` is true. The same final gate already contains the structural, generated, inventory, state, and staleness checks formerly split across pull-request and weekly workflows.

This publishing repository's reasoned changed-file rules explicitly require independent reconciliation for its normative engine, enforcement, invariant, and scope pages plus `README.md` and `docs/design.md`. Those instance-specific paths do not belong to the generated downstream seed policy: an adopter's `.wiki/config.json` remains project-owned and names the contract paths for that repository.

`wiki:doctor` treats the root agent entrypoint as a provider-neutral installation seam. In addition to the integration markers and canonical package scripts, the entrypoint must contain affirmative line-level clause shapes from session start to the wiki index, current status, and invariants; from generic remaining-work intent to no-query `wiki:work`; from human-exclusive work to non-selection, reporting, human handoff, and no assumed authority; from a returned selection to `wiki:context -- --work <ID>`; and from topic work to search/context, while explicitly keeping proposed, conflicted, deprecated, and archived pages non-current. Marker-only, marker-plus-command placeholders, command-name-only lists, and clauses using common directive words to explicitly negate a required action fail deterministically. This validates only the installed syntax contract; it does not classify arbitrary natural language, detect every possible contradiction, or prove that an agent followed it.

Only the authoring role and, when risk policy requires it, the context-isolated reviewer are mandatory orchestration boundaries. Explorer, implementation-worker, guardian, multi-lens, and similar fan-out are provider-specific options whose added calls and coordination must be justified by task risk. Repository guidance can remove repeated discovery, serialize bounded handoffs, batch work, and avoid polling; it cannot guarantee provider cache continuity, approval policy, external model routing, provider latency, subscription accounting, or other orchestrator behavior.

When review is required, preflight makes context isolation an authoring-agent responsibility and the local gate proves report presence and exact target/freshness—not that the reviewer truly reasoned correctly. Version 2 does not claim authenticated actor separation and requires explicit risk selection. A version 1 adopter that requires a different actor is not silently converted; it must retain that external trust path or choose another one. Version 1 omission of `requiredWhen` preserves its legacy all-PR behavior.

The reference integration assumes that repository developers and administrators are trusted. An actor allowed to rewrite the local engine, result, or required-status rule can weaken validation. Defending against that actor through required workflows, CODEOWNERS, rulesets, administrator-bypass restrictions, force-push policy, or deletion policy is organization-level governance outside the product contract. Deployments may add those controls, but wiki-ssot neither requires nor audits them. A successful status is therefore evidence—and, where deployment policy makes it required, a merge guardrail—within the trusted-maintainer model, not a security guarantee against a hostile or compromised maintainer.
