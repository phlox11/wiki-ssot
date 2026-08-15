---
id: operations/enforcement
summary: Three rails enforce the wiki within a trusted-maintainer boundary — zero-knowledge agent entry, local hooks, and an exact local gate published as a GitHub commit status.
kind: operation
status: current
authority: normative
owners: ["@phlox11"]
sources:
  - path: .wiki/config.json
    context: always
  - path: AGENTS.md
    context: always
  - path: package.json
    context: always
  - path: .github/pull_request_template.md
    context: always
  - path: .husky/pre-commit
    context: always
  - path: .husky/pre-push
    context: always
  - path: scripts/wiki/verification.ts
    context: always
  - path: scripts/wiki/impact.ts
    context: always
  - path: scripts/wiki/review-attestation.ts
    context: always
  - path: scripts/wiki/local-check.ts
    context: always
  - path: scripts/wiki/repository-validation.ts
    context: always
  - path: scripts/wiki/agent-rules.ts
    context: always
  - path: scripts/wiki/github-local-status.ts
    context: always
  - path: scripts/wiki/cli-validation-handlers.ts
    context: always
  - path: scripts/wiki/cli.ts
    context: always
  - path: scripts/wiki/apply.ts
    context: always
  - glob: scripts/wiki/{core,model,serialization,repository-view,page-validation,work-validation,discovery,context,scope,generated-views,kit-packaging,kit-growth-guard,review-bundle,cli-runtime,cli-render,cli-scope-handler,cli-discovery-handlers,cli-generation-handlers,cli-review-handlers,github-attestation}.ts
    context: catalog
    reason: Retain the complete enforcement implementation boundary while compact contexts read only the live policy and execution anchors.
related: [architecture/engine, product/invariants]
tags: [enforcement, local-status, hooks]
---

# Enforcement

Enforcement is attached to events that always happen. Semantic review is external; its exact report and the deterministic repository checks are bound into one local result and published for the PR HEAD.

- **Session start and bounded handoff.** Every agent reads the versioned managed rules in `AGENTS.md`. A generic remaining, unfinished, or next-work request runs `wiki:work` without asking for a search term or internal ID; only recommended active or ready `agent`/`either` work may be selected automatically. Human work remains visible and queryable but must be reported with its procedure and handed to a human without assumed credentials or authority. The default queue keeps active/ready/waiting/blocked rows and reports deferred/done counts; `--all` exposes those details on demand. The printed `wiki:context -- --work <ID>` command supplies a compact projection of the exact work contract plus an invariant → conflict → current-page → mandatory-source read order. `always` declarations expand into that order; reasoned `catalog` declarations remain completely tracked but compact to declaration/count/bytes/digest plus an expansion command. `--full` restores all paths and bodies. Selected-work keeps its proposal owner separate, and only current authority/conflicts enter the authoritative read order. Topic work starts directly with query-based `wiki:context`; optional `wiki:search` shares the same deterministic matcher for manual catalog exploration. Complete all-term matches keep their selection behavior, while a partial-only default context returns ordered candidate metadata and focused commands instead of expanding every partial body. Once selection and prospective PR metadata are fixed at a clean committed HEAD, one body-free selected-work artifact may be shared across authoring and implementation roles; every consumer validates its selector, metadata, base, merge-base, HEAD, page, conflict, mandatory source digests, catalog set digest/count/bytes, read order, and artifact digest before reuse and still reads the required authority and implementation detail directly. At one exact revision, roles batch independent reads and deterministic checks, avoid repeated queue or broad-context reconstruction, use bounded waits instead of polling, and keep success summaries bounded with digest-addressable full evidence. A materially grown authoring context creates one bounded phase handoff before publication rather than replaying the session.
- **Local commit.** `.husky/pre-commit` runs `wiki:lint --staged`; `.husky/pre-push` blocks direct pushes to `main`. Hooks are bypassable feedback, not a security boundary.
- **Pre-PR semantic reconciliation.** After deterministic checks and prospective PR metadata are complete, `wiki:review-preflight` evaluates trusted risk policy before any PR exists. Low-risk candidates are ready immediately. For selected changes it emits an exact bundle for a context-isolated reviewer. The bundle stores authority/conflict bodies once by content digest and keeps every current invariant body. Its focused source roles retain changed inputs, affected authority/invariant or conflict-derived implementation, relevant tests, and lifecycle provenance, but do not attach unchanged implementation sources merely because an otherwise unaffected invariant body is universal authority. Preflight validates every required role, object, source, and digest binding before the reviewer receives it; this removes duplicate bodies and broad-source rereading without dropping current invariants, conflicts, changed primary sources, or relevant tests. The authoring agent dispositions every returned finding — fixing what this candidate broke or declared, tracking a pre-existing mismatch or undecided intent in an open conflict, recording a named follow-up for an out-of-scope defect — and reruns preflight on the new HEAD until the candidate passes or requires an explicit owner decision. Preflight rejects a disposition the finding's classification does not admit, and a conflict pointer that does not resolve to a matching open conflict, so a deferral that only looks like tracking fails before the PR exists.
- **Canonical local gate.** `wiki:check --base <ref> --metadata <file> [--report <file>] --output <result.json>` requires a committed candidate, allows only the declared metadata, report, and output artifacts outside that candidate, and consumes one shared repository-validation result for page loading, structural/link/coverage/integration, generated/inventory, and state checks. Lint, doctor, audit, and legacy check are compatible projections of that same result rather than separate compositions. Scope, impact, conflict, configured review, and selected tooling complete the exact result. Scope enforcement is base-aware: existing unclassified declarations remain legacy `always`, while a declaration introduced or changed by the candidate must state its read intent and any catalog choice must be reasoned and anchored. The standalone `wiki:scope -- --base <ref>` explains mandatory/catalog breadth, reverse fan-out, review cause paths, potential selection, and base deltas without a numeric budget. Version 2 also executes every `localChecks` argv array. A changed publisher `KIT_ENTRIES` or adopter manifest-owned file selects the Wiki tooling typecheck and complete tooling suite; publisher mode also selects kit freshness and module growth guards. The result binds only each command's stable ID, argv array, exit code, and outcome—not logs, timing, memory, or temporary paths—and cannot pass a risk-selected change without a valid independent report. Calls that omit `--output` preserve the established check output and enforcement flags.
- **Local GitHub publication.** `wiki:publish -- --result <result.json> [--repo <owner/repo>] [--pr <number>]` uses the caller's authenticated `gh` session without reading or printing a token. Before any write it validates the result schema and digest, clean local HEAD, and exact remote PR head. It then creates or updates one `<!-- wiki-ssot:local-status -->` diagnostic comment and writes the configured commit-status context last. Warnings keep a successful result successful and are counted in the comment; API failure is a command failure and cannot be reported by that invocation as a success status. No daemon, pending status, GitHub App, database, or hosted reviewer is added.
- **Pull request merge boundary.** The publisher and new kit ship no active GitHub Actions workflow. To use local status as the protected merge boundary, a repository targets its default branch with an active rule that requires a pull request, requires the configured `enforcement.statusContext` commit status from any source, and requires the branch to be up to date before merging. `any source` is deliberate because `wiki:publish` writes a commit status through the authenticated maintainer's `gh` session rather than a GitHub App; this remains inside the trusted-maintainer boundary. Publish one exact PR-HEAD status before selecting the requirement, then remove obsolete Wiki Actions checks only after the new requirement is visible. A new SHA or newly advanced base invalidates the merge boundary until the exact local gate is rerun and republished. Approval counts, review-thread resolution, CODEOWNERS, required workflows, bypass policy, deletion protection, and force-push/non-fast-forward protection remain explicit deployment hardening rather than hidden Wiki SSOT requirements. The PR template carries semantic metadata and the result summary; version 2 has no report mirror or Draft→Ready choreography.
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
- **Unified install/upgrade.** `scripts/wiki/apply.ts` is the sole public lifecycle entrypoint. It detects a no-commit `new` repository, an existing-code `adopt` repository, or an installed `upgrade`; applies kit-owned files, managed integration blocks, and the compatible package fragment; installs hooks; regenerates; and runs doctor, lint, audit, Wiki tooling typecheck, and Wiki tooling tests. It returns `needs-merge` for unsafe mechanical integration and `needs-reconcile` for missing or stale project meaning, then the invoking coding agent reruns the same command. Existing source declarations without context stay `always`; upgrade and dry-run summarize their count/page breadth in one non-blocking warning and point to `wiki:scope` rather than rewriting Wiki frontmatter or generating a page-by-page migration. A byte-preserving dry-run returns `preview` only for a mechanically safe plan with no bootstrap findings; it reports bootstrap findings as `needs-reconcile` otherwise and never reports the fully checked `ready` state. It never invokes a model or performs Git branch/commit/PR operations.
- **Scale-navigation upgrade.** The ordinary apply path upgrades pristine kit-owned engine, schema, and Wiki entrypoint files and then regenerates the local catalog, cumulative status, relationship graph, and reverse maps. Project-owned current pages, proposals, conflicts, config, coverage, verification state, inventories, changelog, and existing workflows are not rewritten or deleted by inference. Customized double edits retain the existing `.kit-new`/explicit-accept path, and repeated apply remains idempotent.
- **Publisher-only checks.** The canonical local gate retains the repository-wide project typecheck (including the publisher scale harness), runs the Wiki tooling typecheck and complete tooling suite once, and adds kit freshness and module-growth guards when `publishesKit` is true. The same final gate already contains the structural, generated, inventory, state, and staleness checks formerly split across pull-request and weekly workflows.

This publishing repository's reasoned changed-file rules explicitly require independent reconciliation for its normative engine, enforcement, invariant, and scope pages plus `README.md` and `docs/design.md`. Those instance-specific paths do not belong to the generated downstream seed policy: an adopter's `.wiki/config.json` remains project-owned and names the contract paths for that repository.

`wiki:doctor` treats the root agent entrypoint as a provider-neutral installation seam. The managed block is rendered from a typed, versioned rule list whose stable IDs cover session authority, no-query work, human handoff without assumed authority, selected-work context, direct topic context, and the non-current boundary. Doctor validates the outer markers, declared rule-set version, and exact required IDs, including duplicates or unknown IDs; it deliberately does not classify natural language, detect prose contradictions, or prove that an agent followed the rules. Apply replaces only this managed block, so an adopter receives structural upgrades while host instructions outside the markers remain project-owned.

Only the authoring role and, when risk policy requires it, the context-isolated reviewer are mandatory orchestration boundaries. Explorer, implementation-worker, guardian, multi-lens, and similar fan-out are provider-specific options whose added calls and coordination must be justified by task risk. Repository guidance can remove repeated discovery, serialize bounded handoffs, batch work, and avoid polling; it cannot guarantee provider cache continuity, approval policy, external model routing, provider latency, subscription accounting, or other orchestrator behavior.

When review is required, preflight makes context isolation an authoring-agent responsibility and the local gate proves report presence and exact target/freshness—not that the reviewer truly reasoned correctly. Version 2 does not claim authenticated actor separation and requires explicit risk selection. A version 1 adopter that requires a different actor is not silently converted; it must retain that external trust path or choose another one. Version 1 omission of `requiredWhen` preserves its legacy all-PR behavior.

The reference integration assumes that repository developers and administrators are trusted. An actor allowed to rewrite the local engine, result, or required-status rule can weaken validation. Defending against that actor through required workflows, CODEOWNERS, rulesets, administrator-bypass restrictions, force-push policy, or deletion policy is organization-level governance outside the product contract. Deployments may add those controls, but wiki-ssot neither requires nor audits them. A successful status is therefore evidence—and, where deployment policy makes it required, a merge guardrail—within the trusted-maintainer model, not a security guarantee against a hostile or compromised maintainer.
