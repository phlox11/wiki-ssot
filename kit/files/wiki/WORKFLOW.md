# Wiki development workflow

## Before editing

1. Read `wiki/index.md` and `wiki/current-status.md`.
2. For a generic "what remains?", "what is unfinished?", or "what should happen next?" request, run `bun run wiki:work` without asking for an ID or search term. Select only `active` or `ready` work, then run the item's printed `bun run wiki:context -- --work <ID>` command. Never auto-select waiting, blocked, deferred, or conflict work.
3. For a topic-specific task, run `bun run wiki:search -- "<terms>"`.
4. Run `bun run wiki:context -- "<terms>"`; inspect every returned open conflict and acceptance list.
5. Read the matched pages, conflicts, and their primary `sources`.

## While editing

- Behavior/intent change: update sources, affected current pages, and tests together.
- No semantic change: verify affected pages with a reason of at least 20 characters.
- Future idea: create a `status: proposed` page under `wiki/proposals/**`; do not edit current behavior as if already shipped.
- Proposed backlog: store structured `work_items` in proposal frontmatter. Update state and durable evidence in the same PR as the work; the generated `wiki/work-queue.md` is read-only.
- Unclear disagreement: create a structured page under `wiki/conflicts/open/**` and stop treating the disputed fact as current.
- Conflict source changed: declare `resolve`, `retain`, or `introduce` in PR metadata. Use `bun run wiki:conflicts -- C-NNN` for the resolution contract.

## Before a PR

```sh
bun run wiki:generated
bun run wiki:kit
bun run wiki:lint
bun run wiki:doctor
bun run wiki:impact -- --base origin/main --enforce
bun run typecheck
bun run test
bun run wiki:kit -- --check
bun run wiki:audit
bun run wiki:review-preflight -- --base origin/main \
  --metadata /path/to/pr-body.md --output /path/to/review-bundle --json
```

Commit the complete candidate first so the review binds an exact HEAD. Fill a prospective PR metadata block, including the structured `fresh_context` status mirror, before preflight; keep metadata and bundle artifacts outside the repository or pass them explicitly. Any other uncommitted or untracked candidate file makes preflight fail instead of silently reviewing an incomplete HEAD. No PR needs to exist yet. `WIKI_PR_BODY` may provide the same block when a file is inconvenient. `status: not-required` means the trusted policy selected no independent semantic review.

`status: review-required` includes a deterministic bundle. The authoring agent gives it to a context-isolated reviewer or context-free review sub-agent—not to its own authoring context. The reviewer reads the bundle and primary sources and performs narrow SSOT reconciliation: code, tests, current wiki, metadata, invariants, and conflicts must make the same semantic claims. It returns the report described by `REPORT.md`: version 2 structured findings are preferred, and version 1 free-text findings remain accepted so a report prepared before an engine upgrade is not invalidated.

```sh
bun run wiki:review-preflight -- --base origin/main --metadata /path/to/pr-body.md \
  --report /path/to/report.json --reviewer-actor <authenticated-actor> --pr-author <author>
```

Do not open the PR until preflight returns `status: pass` or `status: not-required`. `NEEDS_RECONCILE` must provide an exact discrepancy, controlling authority, required change, and objective acceptance criteria. The authoring agent dispositions every finding — fixing what this candidate broke or declared, tracking a pre-existing mismatch or undecidable intent in an open conflict, recording a named follow-up for an out-of-scope defect — then reruns the deterministic checks and generates a new bundle for the new HEAD. A disposition that points elsewhere names the conflict or follow-up it points at. If intent is ambiguous, create a conflict or obtain an owner decision rather than making speculative edits.

A change to `scripts/wiki/**` that alters bundle content generates its own bundle with the base engine (`bun <base-checkout>/scripts/wiki/cli.ts review-preflight --root <candidate> --base origin/main ...`), because Ready CI recomputes the digest with the merge-base engine. New bundle guidance governs the PRs after it, not the PR that introduces it.

After a local required PASS, open a Draft PR, publish that exact report through the trusted review/comment channel, mirror its verdict/HEAD/bundle/reviewer/evidence into the PR body, and then mark it Ready. The blocking `wiki-review-attestation` job skips Drafts and runs when the PR becomes Ready; this avoids an expected failing check while the attestation is being attached. Its name reflects its narrow role: it validates the precomputed proof and does not perform Fresh-context review in CI. Any new commit or semantic metadata change invalidates the report and sends the candidate back through preflight.

`requireDifferentActor: false` permits a solo maintainer's authenticated GitHub account to publish a separate review context's report; it does not permit the authoring context to invent its own PASS. `true` additionally requires the publisher to differ from the PR author and must only be enabled after a second account or bot is available. If the code-agent environment cannot create an isolated reviewer and no external reviewer is available, stop before opening the PR and ask for that capability.

## Enforcement layers

- pre-commit: staged wiki structure/link/source/generated validation only.
- pre-push: direct `main` push prevention.
- CI: code tests, wiki structure/doctor, generated freshness, blocking impact enforcement, and the Ready-only `wiki-review-attestation` policy/attestation check, plus a weekly full audit. Drafts do not emit an expected Fresh-context failure; Ready/merge requires a trusted non-required classification or a current PASS.
- remote policy: deployments may add branch protection, required workflows, or CODEOWNERS, but wiki-ssot assumes repository write/admin actors are trusted and does not make organization-security policy part of its product contract.
