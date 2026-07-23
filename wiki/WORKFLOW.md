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
bun run wiki:doctor
bun run wiki:impact -- --base origin/main --enforce
bun run typecheck
bun run test
bun run wiki:review-bundle -- --base origin/main --metadata /path/to/pr-body.md
```

Fill the PR metadata block, including the structured `fresh_context` status mirror, before creating the bundle. `WIKI_PR_BODY` may provide the same block when a file is inconvenient.

A separate context-isolated session or reviewer—not the authoring session—reads the bundle and primary sources, then creates the version 1 report described by `REPORT.md`. Publish it through the trusted PR review/comment channel, mirror its verdict/HEAD/bundle/reviewer/evidence into the PR body's `fresh_context` block, and validate it:

```sh
bun run wiki:review-check -- --base origin/main --metadata /path/to/pr-body.md \
  --report /path/to/report.json --reviewer-actor <authenticated-actor> --pr-author <author>
```

The report must be PASS with evidence and must bind the current full HEAD, merge-base, and bundle digest. `NEEDS_RECONCILE` means fix → new bundle → new review. Any new commit or semantic PR metadata change makes the old PASS stale. If a separate reviewer/report is unavailable, leave the PR Draft and ask the user for the reviewer or permission; do not report completion or mark it Ready.

`requireDifferentActor: false` permits a solo maintainer's authenticated GitHub account to publish the separate session's report; it does not permit the authoring session to invent its own PASS. `true` additionally requires the publisher to differ from the PR author and must only be enabled after a second account or bot is available.

## Enforcement layers

- pre-commit: staged wiki structure/link/source/generated validation only.
- pre-push: direct `main` push prevention.
- CI: code tests, wiki structure/doctor, generated freshness, blocking impact enforcement, and the `wiki-fresh-context` attestation check, plus a weekly full audit. Drafts may carry a failing/pending Fresh-context check; Ready/merge must not.
- protected `main`: the durable remote boundary; see [proposal/protected-main](./proposals/protected-main.md) until it is active. Local hooks and CI can be bypassed and are not a security boundary. Details in [operations/enforcement](./operations/enforcement.md).
