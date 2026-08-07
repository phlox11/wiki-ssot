---
id: operations/enforcement
summary: Three rails enforce the wiki within a trusted-maintainer boundary — zero-knowledge agent entry, local hooks, and deterministic CI including portable growth and wiki-review-attestation checks.
kind: operation
status: current
authority: normative
owners: ["@phlox11"]
sources:
  - path: .wiki/config.json
  - path: AGENTS.md
  - path: package.json
  - path: .github/pull_request_template.md
  - path: .github/workflows/checks.yml
  - path: .github/workflows/wiki-ssot.yml
  - path: .github/workflows/kit.yml
  - path: .github/workflows/wiki-audit.yml
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
tags: [enforcement, ci, hooks]
---

# Enforcement

Enforcement is attached to events that always happen. Semantic review is external; the Ready-only validation of its attestation is deterministic.

- **Session start and bounded handoff.** Every agent reads `AGENTS.md`. A generic remaining, unfinished, or next-work request runs `wiki:work` without asking for a search term or internal ID; only recommended active or ready `agent`/`either` work may be selected automatically. Human work remains visible and queryable but must be reported with its procedure and handed to a human without assumed credentials or authority. The printed `wiki:context -- --work <ID>` command supplies a compact projection of the exact work contract plus an invariant → conflict → current-page → expanded-source read order. Selected-work and complete-match topic context retain every page/conflict identity, status, authority, Wiki path, source declaration and expansion, page-local conflict, body digest, and focused command without embedding complete bodies or a duplicate aggregate source list; `--full` restores the exhaustive body-complete representation. Selected-work keeps its proposal owner separate, and only current authority/conflicts enter the authoritative read order. Topic-specific `wiki:search` and query-based `wiki:context` share deterministic matching: complete all-term matches keep their selection behavior, while a partial-only default context returns ordered candidate metadata and focused commands instead of expanding every partial body. Once selection and prospective PR metadata are fixed at a clean committed HEAD, one body-free selected-work artifact may be shared across authoring and implementation roles; every consumer validates its selector, metadata, base, merge-base, HEAD, page, conflict, source, context, read-order, and artifact digests before reuse and still reads the required authority and sources directly. At one exact revision, roles batch independent reads and deterministic checks, avoid repeated queue or broad-context reconstruction, use bounded waits instead of polling, and keep success summaries bounded with digest-addressable full evidence. A materially grown authoring context creates one bounded phase handoff before publication rather than replaying the session.
- **Local commit.** `.husky/pre-commit` runs `wiki:lint --staged`; `.husky/pre-push` blocks direct pushes to `main`. Hooks are bypassable feedback, not a security boundary.
- **Pre-PR semantic reconciliation.** After deterministic checks and prospective PR metadata are complete, `wiki:review-preflight` evaluates trusted risk policy before any PR exists. Low-risk candidates are ready immediately. For selected changes it emits an exact bundle for a context-isolated reviewer. The bundle stores authority/conflict bodies once by content digest and carries a focused manifest whose overlapping roles distinguish changed sources, directly affected authority sources, relevant tests, and supporting sources with declaration and glob provenance. Preflight validates every required role, object, source, and digest binding before the reviewer receives it; this removes duplicate bodies and broad-source rereading without dropping current invariants, conflicts, changed primary sources, or relevant tests. The authoring agent dispositions every returned finding — fixing what this candidate broke or declared, tracking a pre-existing mismatch or undecided intent in an open conflict, recording a named follow-up for an out-of-scope defect — and reruns preflight on the new HEAD until the candidate passes or requires an explicit owner decision. Preflight rejects a disposition the finding's classification does not admit, and a conflict pointer that does not resolve to a matching open conflict, so a deferral that only looks like tracking fails before the PR exists.
- **Pull request (CI).** `.github/workflows/wiki-ssot.yml` runs only the structural Wiki jobs on pull requests and runs `wiki-review-attestation` only for non-Draft PRs; host build/test jobs stay in host workflows such as this publisher's `checks.yml`. Upgrading the exact version 1 combined workflow preserves its `code-check` in that host file and moves only Wiki jobs; unknown or customized legacy workflows fail closed until their host-only form is accepted. Required reports are attached to a Draft after local PASS, mirrored into the PR body, and then validated when the PR becomes Ready. The check name deliberately describes validation of an existing attestation; it does not perform semantic Fresh-context review in CI.
- **Portable growth guard.** The structural Wiki job runs `wiki:tooling:guard` over installed Kit-owned TypeScript boundaries: 1,000 lines/64 KiB generally, 250 lines for `cli.ts`, and a reported 1,000-line/68-KiB `review-bundle.ts` exception. Unclassified or oversized paths fail with split, bounded-exception, or owner-revision guidance; aggregate repository size is ignored.
- **Fresh-context trust path.** The GitHub reference job is triggered for opened, synchronize, reopened, edited, ready-for-review, and converted-to-draft activity, but skips Drafts instead of emitting an expected failure while an attestation is being attached. For a Ready PR it runs on `pull_request` so the check attaches to the PR test-merge commit, but explicitly executes the trusted base engine/policy while treating the detached PR HEAD as data. Bun stays in the trusted working directory and receives the head only through `--root`, preventing an untrusted `bunfig.toml` preload; the job never installs or executes head code. The trusted engine classifies the actual diff using configured changed-file globs plus merge-base/HEAD affected invariants, conflicts, and current-page removals. A low-risk change records `required: false` and passes without a report. A required change reads the newest marked report from authenticated PR review/comment envelopes and rejects missing, malformed, non-PASS, stale, empty-evidence, or untrusted attestations.
- **Recursive publishing boundary.** In this publishing repository,
  `.wiki/coverage.json` and the current engine page cover
  `scripts/wiki/**/*.ts`, while high-risk staleness and Fresh-context changed-file
  selection cover the broader `scripts/wiki/**` tree. A nested implementation or
  test file is consequently source-mapped, coverage-checked, high-risk, and
  review-selected. The generated downstream seed intentionally keeps its
  adopter-owned coverage empty and its domain-specific `highRisk` list, but it
  retains the recursive `scripts/wiki/**` Fresh-context trigger for toolkit
  changes.
- **Unified install/upgrade.** `scripts/wiki/apply.ts` is the sole public lifecycle entrypoint. It detects a no-commit `new` repository, an existing-code `adopt` repository, or an installed `upgrade`; applies kit-owned files, managed integration blocks, and the compatible package fragment; installs hooks; regenerates; and runs doctor, lint, audit, Wiki tooling typecheck, and Wiki tooling tests. It returns `needs-merge` for unsafe mechanical integration and `needs-reconcile` for missing or stale project meaning, then the invoking coding agent reruns the same command. A byte-preserving dry-run returns `preview` only for a mechanically safe plan with no bootstrap findings; it reports bootstrap findings as `needs-reconcile` otherwise and never reports the fully checked `ready` state. It never invokes a model or performs Git branch/commit/PR operations.
- **Kit freshness.** `.github/workflows/kit.yml` runs `wiki:kit --check` and fails when the published `kit/**` distribution drifts from the files it is generated from. It is separate from the downstream `.github/workflows/wiki-ssot.yml`, because adopting repositories have no publisher `kit/` tree.
- **Weekly.** `.github/workflows/wiki-audit.yml` re-runs the full audit and fails on any stale page.

This publishing repository's changed-file selector explicitly requires Fresh-context reconciliation for `wiki/product/scope.md` and its declared sources, `README.md` and `docs/design.md`. Those instance-specific paths do not belong to the generated downstream seed policy: an adopter's `.wiki/config.json` remains project-owned and names the contract paths for that repository.

`wiki:doctor` treats the root agent entrypoint as a provider-neutral installation seam. In addition to the integration markers and canonical package scripts, the entrypoint must contain affirmative line-level clause shapes from session start to the wiki index, current status, and invariants; from generic remaining-work intent to no-query `wiki:work`; from human-exclusive work to non-selection, reporting, human handoff, and no assumed authority; from a returned selection to `wiki:context -- --work <ID>`; and from topic work to search/context, while explicitly keeping proposed, conflicted, deprecated, and archived pages non-current. Marker-only, marker-plus-command placeholders, command-name-only lists, and clauses using common directive words to explicitly negate a required action fail deterministically. This validates only the installed syntax contract; it does not classify arbitrary natural language, detect every possible contradiction, or prove that an agent followed it.

Only the authoring role and, when risk policy requires it, the context-isolated reviewer are mandatory orchestration boundaries. Explorer, implementation-worker, guardian, multi-lens, and similar fan-out are provider-specific options whose added calls and coordination must be justified by task risk. Repository guidance can remove repeated discovery, serialize bounded handoffs, batch work, and avoid polling; it cannot guarantee provider cache continuity, approval policy, external model routing, provider latency, subscription accounting, or other orchestrator behavior.

When review is required, preflight makes context isolation an authoring-agent responsibility and the GitHub job proves attestation presence, authenticated actor, and exact target/freshness—not that the reviewer truly reasoned correctly. This repository uses the solo-maintainer policy `requireDifferentActor: false`, so the PR author's authenticated account may publish a report produced by a separate review context. Teams may enable actor separation only after provisioning another reviewer account or bot. Applicable required mode fails closed for Ready PRs during reviewer/API/output failures; advisory mode is an explicit configuration, never a silent fallback. Omitting `requiredWhen` preserves the legacy policy that every PR is applicable.

The reference integration assumes that repository developers and administrators are trusted. Base code/policy pinning prevents an ordinary PR head from substituting its engine or configuration during validation, but `.github/workflows/wiki-ssot.yml` remains an editable bootstrap seam: an actor allowed to rewrite the workflow can preserve a required job name while removing its validation. Defending against that actor through required workflows, CODEOWNERS, rulesets, administrator-bypass restrictions, force-push policy, or deletion policy is organization-level governance outside the product contract. Deployments may add those controls, but wiki-ssot neither requires nor audits them. Successful CI is therefore evidence—and, where deployment policy makes it blocking, a merge guardrail—within the trusted-maintainer model, not a security guarantee against a hostile or compromised maintainer.
