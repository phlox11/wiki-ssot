# Agent instructions

These rules apply to every coding agent and every task in this repository. They exist so an agent starting a fresh session with no memory of past work can still find the code and constraints it must account for, and cannot silently drift the wiki out of sync with the code.

<!-- wiki-ssot:fresh-context-guardrail -->

## Wiki SSOT

- Pages with `status: current` linked from `wiki/index.md` are the single source of truth for product intent, architecture, feature contracts, invariants, and operations.
- Code, tests, schemas, and migrations are implementation evidence. When evidence and the wiki disagree, do not silently pick a side: record or resolve the conflict.
- `status: proposed | conflicted | deprecated | archived` pages are not current behavior.
- Never infer current behavior from old plans, roadmaps, or handoffs without following their current wiki entrypoint.

## Required workflow

1. Start at `wiki/index.md`, then read `wiki/current-status.md` and any `kind: invariant` pages.
<!-- wiki-ssot:work-discovery -->
2. If the user asks what remains, what is unfinished, or what should happen next without naming a task — including “할 일 남은 거 뭐야?” — run `bun run wiki:work` before topic search. Do not require a proposal ID, work ID, or search term. After selecting a returned item, run its printed `wiki:context -- --work <ID>` command.
3. Search before editing: `bun run wiki:search -- "<task terms>"` and `bun run wiki:context -- "<task terms>"`. Context automatically includes related open conflicts.
4. Read each affected page's `sources` directly. Do not rely on the wiki summary alone for implementation details.
5. Change wiki, code, and tests in the same PR when behavior or intent changes. If semantics do not change, run `bun run wiki:verify -- --page <id> --unchanged "<20+ character reason>"`.
6. Regenerate deterministic artifacts with `bun run wiki:generated`, then run `bun run wiki:lint`, `bun run wiki:impact -- --base origin/main --enforce`, `bun run typecheck`, and the relevant tests.
7. Fill the parseable YAML metadata block in the PR template, including `touched_conflicts`. Implementation-source changes may not use `wiki_action: none`.
8. Commit the candidate so the review can bind an exact HEAD, then—before opening a PR—run `bun run wiki:review-preflight -- --base origin/main --metadata <pr-body.md> --output <bundle-dir> --json`. Keep metadata, report, and bundle files outside the repository or pass their paths explicitly; other uncommitted/untracked files make preflight fail.
   - `status: not-required` means the candidate is ready for the ordinary PR flow.
   - `status: review-required` means the authoring agent must give the emitted bundle to a context-isolated reviewer or a context-free review sub-agent. The authoring session must never mark its own work `PASS`.
   - The reviewer performs independent SSOT reconciliation, not a general style review: code, tests, current wiki, metadata, invariants, and conflicts must make the same semantic claims.
   - Validate the returned report locally with `bun run wiki:review-preflight -- --base origin/main --metadata <pr-body.md> --report <report.json> --reviewer-actor <publisher> --pr-author <author> --json`.
   - `NEEDS_RECONCILE` is not permission for an unknown or speculative edit. Every finding must identify the exact discrepancy, controlling authority, required code/wiki/test change, and acceptance criteria.
   - Disposition each finding rather than assuming it must be fixed here. Fix what this candidate broke or what the PR itself declares; track a pre-existing mismatch, an undecidable product intent, or a documentation disagreement in an open conflict with acceptance criteria; record a named follow-up for a real defect outside this change's semantic scope. A disposition that points elsewhere must name the conflict or follow-up it points at. The engine enforces that split: a `candidate_regression` or `declared_contract_violation` accepts no deferring disposition, a `decision_ambiguity` may be fixed or tracked in a conflict but never dismissed or deferred, `recorded` is confined to a `suggestion`, and a conflict pointer must resolve to an open conflict whose affected pages agree with the finding, whose type matches where the classification implies one, and whose `origin` is `baseline` where the classification says the problem predates the change — so a finding declaring no `page:` scope ref cannot be tracked by a conflict. Then rerun deterministic checks and generate a new bundle for the new HEAD.
   - Do not open the PR until preflight returns `status: pass` or `status: not-required`. If intent is ambiguous, open a conflict or request the owner decision instead of repeating speculative fix/review loops.
   - A change to `scripts/wiki/**` that alters bundle content must generate its own bundle with the base engine — `bun <base-checkout>/scripts/wiki/cli.ts review-preflight --root <candidate> --base origin/main ...` — because Ready CI recomputes the digest with the merge-base engine. New bundle guidance governs the PRs that follow it, not the PR that introduces it.
9. For a required report, open the PR as Draft only after local PASS, publish that exact report through the trusted PR review/comment channel, mirror it into `fresh_context`, then mark the PR Ready. Draft PRs skip the blocking `wiki-review-attestation` check; Ready PRs must validate the current exact HEAD and bundle digest.
   - Any new commit or semantic PR metadata change invalidates the old PASS and requires preflight again.
   - If the code-agent environment cannot create an isolated reviewer and no external reviewer is available, stop before opening the PR and ask for the missing review capability.

## Editing rules

- Follow `wiki/SCHEMA.md`; IDs are stable and path-independent.
- Only `status: current` pages state the current contract. Put future intent under `wiki/proposals/**`.
- Do not edit `wiki/index.md`, `wiki/current-status.md`, `wiki/conflicts.md`, `wiki/work-queue.md`, `wiki/_generated/**`, `.wiki/source-map.json`, or `.wiki/conflict-map.json` by hand — they are generated.
- Do not add timestamps to generated files.
- A missing or ambiguous product decision is a conflict, not permission to invent behavior.
- Open conflicts under `wiki/conflicts/open/**` are resolution contracts. Inspect them with `bun run wiki:conflicts` or `bun run wiki:context -- --conflict C-NNN`.
- If a task or diff touches a conflict source, declare `resolve`, `retain`, or `introduce` in PR metadata. `retain` requires a concrete 20+ character reason.
- Never resolve a decision conflict without an explicit owner decision.

## Git and safety

- Work on a feature branch and use PRs. Do not push directly to `main`.
- Hooks and CI are feedback. Deployment-configured branch protection may provide a remote merge boundary, but this toolkit assumes repository write/admin actors are trusted and does not prescribe organization-security policy.
- Branch protection matches on check name rather than workflow meaning: a `pull_request` that keeps a required job's name while emptying its steps can report success. Required workflows, CODEOWNERS, and administrator-bypass controls are optional deployment hardening outside the product contract.
<!-- kit:exclude:start -->
- The accepted workflow-bootstrap trust decision for this repository is recorded in `wiki/proposals/protected-main.md`.
<!-- kit:exclude:end -->
- Keep unrelated changes intact and do not bypass checks to make a change appear valid.
