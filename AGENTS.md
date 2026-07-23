# Agent instructions

These rules apply to every coding agent and every task in this repository. They exist so an agent starting a fresh session with no memory of past work can still find the code and constraints it must account for, and cannot silently drift the wiki out of sync with the code.

## Wiki SSOT

- Pages with `status: current` linked from `wiki/index.md` are the single source of truth for product intent, architecture, feature contracts, invariants, and operations.
- Code, tests, schemas, and migrations are implementation evidence. When evidence and the wiki disagree, do not silently pick a side: record or resolve the conflict.
- `status: proposed | conflicted | deprecated | archived` pages are not current behavior.
- Never infer current behavior from old plans, roadmaps, or handoffs without following their current wiki entrypoint.

## Required workflow

1. Start at `wiki/index.md`, then read `wiki/current-status.md` and any `kind: invariant` pages.
2. Search before editing: `bun run wiki:search -- "<task terms>"` and `bun run wiki:context -- "<task terms>"`. Context automatically includes related open conflicts.
3. Read each affected page's `sources` directly. Do not rely on the wiki summary alone for implementation details.
4. Change wiki, code, and tests in the same PR when behavior or intent changes. If semantics do not change, run `bun run wiki:verify -- --page <id> --unchanged "<20+ character reason>"`.
5. Regenerate deterministic artifacts with `bun run wiki:generated`, then run `bun run wiki:lint`, `bun run wiki:impact -- --base origin/main --enforce`, `bun run typecheck`, and the relevant tests.
6. Fill the parseable YAML metadata block in the PR template, including `touched_conflicts`. Implementation-source changes may not use `wiki_action: none`.
7. Create a fresh-context review bundle with `bun run wiki:review-bundle -- --base origin/main --metadata <pr-body.md>` and attach a `PASS` or `NEEDS_RECONCILE` verdict.

## Editing rules

- Follow `wiki/SCHEMA.md`; IDs are stable and path-independent.
- Only `status: current` pages state the current contract. Put future intent under `wiki/proposals/**`.
- Do not edit `wiki/index.md`, `wiki/current-status.md`, `wiki/conflicts.md`, `wiki/_generated/**`, `.wiki/source-map.json`, or `.wiki/conflict-map.json` by hand — they are generated.
- Do not add timestamps to generated files.
- A missing or ambiguous product decision is a conflict, not permission to invent behavior.
- Open conflicts under `wiki/conflicts/open/**` are resolution contracts. Inspect them with `bun run wiki:conflicts` or `bun run wiki:context -- --conflict C-NNN`.
- If a task or diff touches a conflict source, declare `resolve`, `retain`, or `introduce` in PR metadata. `retain` requires a concrete 20+ character reason.
- Never resolve a decision conflict without an explicit owner decision.

## Git and safety

- Work on a feature branch and use PRs. Do not push directly to `main`.
- Hooks and CI are feedback. The real remote boundary is branch protection on `main`; see `wiki/proposals/protected-main.md`.
- Keep unrelated changes intact and do not bypass checks to make a change appear valid.
