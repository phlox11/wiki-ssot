# Wiki development workflow

## Before editing

1. Read `wiki/index.md` and `wiki/current-status.md`.
2. Run `bun run wiki:search -- "<terms>"`.
3. Run `bun run wiki:context -- "<terms>"`; inspect every returned open conflict and acceptance list.
4. Read the matched pages, conflicts, and their primary `sources`.

## While editing

- Behavior/intent change: update sources, affected current pages, and tests together.
- No semantic change: verify affected pages with a reason of at least 20 characters.
- Future idea: create a `status: proposed` page under `wiki/proposals/**`; do not edit current behavior as if already shipped.
- Unclear disagreement: create a structured page under `wiki/conflicts/open/**` and stop treating the disputed fact as current.
- Conflict source changed: declare `resolve`, `retain`, or `introduce` in PR metadata. Use `bun run wiki:conflicts -- C-NNN` for the resolution contract.

## Before a PR

```sh
bun run wiki:generated
bun run wiki:lint
bun run wiki:impact -- --base origin/main --enforce
bun run typecheck
bun run test
bun run wiki:review-bundle -- --base origin/main --metadata /path/to/pr-body.md
```

Fill the PR metadata block before creating the bundle. `WIKI_PR_BODY` may provide the same block when a file is inconvenient. A separate fresh-context agent session reads the review bundle and returns `PASS` or `NEEDS_RECONCILE`; attach its evidence to the PR.

## Enforcement layers

- pre-commit: staged wiki structure/link/source/generated validation only.
- pre-push: direct `main` push prevention.
- CI: code tests, wiki structure, generated freshness, and blocking impact enforcement, plus a weekly full audit.
- protected `main`: the durable remote boundary; see [proposal/protected-main](./proposals/protected-main.md) until it is active. Local hooks and CI can be bypassed and are not a security boundary. Details in [operations/enforcement](./operations/enforcement.md).
