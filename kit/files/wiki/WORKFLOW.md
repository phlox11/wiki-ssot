# Wiki development workflow

## Before editing

1. Read the bounded `wiki/index.md` and `wiki/current-status.md`; follow `wiki/catalog.md` when their group or lifecycle summary points to the complete catalog.
2. For a generic "what remains?", "what is unfinished?", or "what should happen next?" request, run `bun run wiki:work` without asking for an ID or search term. Select only recommended `agent` or `either` work in `active` or `ready`, then run the item's printed `bun run wiki:context -- --work <ID>` command. Never auto-select `executor: human`, waiting, blocked, deferred, or conflict work. Human work remains visible; use `bun run wiki:work -- --executor human` to report its procedure and hand it off without assuming human credentials or authority.
3. For a topic-specific task, run `bun run wiki:search -- "<terms>"`.
4. Run `bun run wiki:context -- "<terms>"`; use its compact authority/source routing and inspect every returned open conflict and acceptance list. If a partial-match candidate list is returned, follow the candidate's focused command instead of expanding every body.
5. Read the matched pages, conflicts, and every `context: always` source in the mandatory read order. A `catalog` descriptor remains fully tracked: inspect its declaration/reason/count/bytes/digest and expand it with the printed command when the changed file, task, or review evidence needs that implementation detail. Add `--full` when exhaustive bodies and all catalog paths are needed.

## While editing

- Behavior/intent change: update sources, affected current pages, and tests together.
- No semantic change: verify affected pages with a reason of at least 20 characters.
- Future idea: create a `status: proposed` page under `wiki/proposals/**`; do not edit current behavior as if already shipped.
- Proposed backlog: store structured `work_items` in proposal frontmatter. Classify the optional executor independently from state, update state and durable evidence in the same PR as the work, and keep the generated `wiki/work-queue.md` read-only. `either` selects who can execute; it does not expand permissions.
- Unclear disagreement: create a structured page under `wiki/conflicts/open/**` and stop treating the disputed fact as current.
- Conflict source changed: declare `resolve`, `retain`, or `introduce` in PR metadata. Use `bun run wiki:conflicts -- C-NNN` for the resolution contract.

## Before a PR

```sh
bun run wiki:generated
bun run wiki:lint
bun run wiki:doctor
bun run wiki:impact -- --base origin/main --enforce
bun run typecheck
bun run test
bun run wiki:audit
bun run wiki:review-preflight -- --base origin/main \
  --metadata /path/to/pr-body.md --output /path/to/review-bundle --json
```


Commit the complete candidate first so the review binds an exact HEAD. Fill the prospective semantic PR metadata block before preflight; keep metadata, report, bundle, and result artifacts outside the repository or pass them explicitly. Any other uncommitted or untracked candidate file makes preflight fail instead of silently reviewing an incomplete HEAD. No PR needs to exist yet. `status: not-required` means the explicit risk policy selected no independent semantic review.

`status: review-required` includes a deterministic bundle. `focused-manifest.json` references content-addressed page/conflict objects and distinguishes changed sources, directly affected authority sources, relevant tests, and supporting sources with non-exclusive roles and declaration provenance; a required input cannot disappear behind a broad glob. The authoring agent gives the bundle to a context-isolated reviewer or context-free review sub-agent—not to its own authoring context. The reviewer follows the focused manifest, reads the named primary sources, and performs narrow SSOT reconciliation: code, tests, current wiki, metadata, invariants, and conflicts must make the same semantic claims. It returns the report described by `REPORT.md`: version 2 structured findings are preferred, and version 1 free-text findings remain accepted so a report prepared before an engine upgrade is not invalidated.

```sh
bun run wiki:review-preflight -- --base origin/main --metadata /path/to/pr-body.md \
  --report /path/to/report.json
```

Do not open the PR until preflight returns `status: pass` or `status: not-required`. `NEEDS_RECONCILE` must provide an exact discrepancy, controlling authority, required change, and objective acceptance criteria. The authoring agent dispositions every finding — fixing what this candidate broke or declared, tracking a pre-existing mismatch or undecidable intent in an open conflict, recording a named follow-up for an out-of-scope defect — then reruns the deterministic checks and generates a new bundle for the new HEAD. A disposition that points elsewhere names the conflict or follow-up it points at. If intent is ambiguous, create a conflict or obtain an owner decision rather than making speculative edits.

A change to `scripts/wiki/**` that alters bundle content also generates its own bundle with the base engine (`bun <base-checkout>/scripts/wiki/cli.ts review-preflight --root <candidate> --base origin/main ...`) when the merge-base installation still uses that compatibility contract. New bundle guidance governs the PRs after it, not the PR that introduces it.

After preflight PASS, run canonical `wiki:check --output` with the same metadata and report. Open or update the PR, then run `wiki:publish` for that result. Publication verifies the clean local HEAD and remote PR head before it writes the configured commit status. Any new commit or semantic metadata change invalidates the report and result; the new SHA has no protected status until both steps are repeated. Version 2 needs no Draft-to-Ready transition, attestation comment, authenticated reviewer actor, or PR-body report mirror. The authoring context still may not create its own required PASS.

Version 1 retains its authenticated actor and mirror semantics for compatibility. A first migration PR may carry one last mirror for a merge-base v1 workflow; version 2 ignores it. A v1 policy with `requireDifferentActor: true` is not automatically converted because local status proves exact evidence, not distinct GitHub identities. If the code-agent environment cannot create an isolated reviewer and no external reviewer is available, stop before opening the PR and ask for that capability.

Generated catalog, cumulative status, relationship graph, and reverse maps are projections of the same repository records. Never hand-edit them or treat them as a replacement for current pages and primary sources. Toolkit upgrades rebuild those projections through the ordinary `apply.ts` loop without rewriting project-owned current pages, proposals, conflicts, configuration, coverage, verification state, or changelog.

## Enforcement layers

- pre-commit: staged wiki structure/link/source/generated validation only.
- pre-push: direct `main` push prevention.
- local gate: structural/generated/inventory/state/impact/review checks, configured project argv checks, toolkit tests when owned files change, and publisher kit guards produce one exact result.
- remote policy: branch protection requires the configured local commit-status context. Deployments may add other rules, but wiki-ssot assumes repository write/admin actors are trusted and does not make organization-security policy part of its product contract.
