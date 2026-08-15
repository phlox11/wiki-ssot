# Wiki development workflow

## Before editing

1. Read the bounded `wiki/index.md` and `wiki/current-status.md`; follow `wiki/catalog.md` when their group or lifecycle summary points to the complete catalog.
2. For a generic "what remains?", "what is unfinished?", or "what should happen next?" request, run `bun run wiki:work` without asking for an ID or search term. Select only recommended `agent` or `either` work in `active` or `ready`, then run the item's printed `bun run wiki:context -- --work <ID>` command. Never auto-select `executor: human`, waiting, blocked, deferred, or conflict work. Human work remains visible; use `bun run wiki:work -- --executor human` to report its procedure and hand it off without assuming human credentials or authority. The default output gives deferred/done counts only; use `--all` when their detailed rows are relevant.
3. For a topic-specific task, start with `bun run wiki:context -- "<terms>"`. It performs the same deterministic matching as `wiki:search` and returns current authority, conflicts, and bounded source routing in one step. Keep `wiki:search` for optional manual catalog exploration.
4. Inspect every returned open conflict and acceptance list. If a partial-match candidate list is returned, follow the candidate's focused command instead of expanding every body.
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
bun run wiki:impact -- --base origin/main --enforce
bun run typecheck
bun run test  # or the relevant project tests while implementing
bun run wiki:review-preflight -- --base origin/main \
  --metadata /path/to/pr-body.md --output /path/to/review-bundle --json
```

<!-- kit:exclude:start -->
This publishing repository additionally owns the generated `kit/**`
distribution. Run `bun run wiki:kit` immediately after `wiki:generated`, then
run `bun run wiki:kit -- --check` after the tests. These commands are
publisher-only: the downstream package fragment intentionally omits
`wiki:kit`, and an adopting repository does not set `publishesKit`.
<!-- kit:exclude:end -->

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
- local gate: one shared repository-validation result feeds lint/doctor/audit/legacy projections and the canonical structural/generated/inventory/state checks; impact/review, configured project argv checks, toolkit tests when owned files change, and publisher kit guards complete one exact result.
- remote policy: branch protection requires the configured local commit-status context using the exact recipe below. Deployments may add other rules, but wiki-ssot assumes repository write/admin actors are trusted and does not make organization-security policy part of its product contract.
<!-- kit:exclude:start -->
- trust decision for this repository: [proposal/protected-main](./proposals/protected-main.md); enforcement detail in [operations/enforcement](./operations/enforcement.md).
<!-- kit:exclude:end -->

### GitHub branch protection for local status

To make the version 2 local result a real merge boundary, configure one active branch ruleset for the repository's default branch after the first exact PR-HEAD status has been published. In GitHub, open **Settings → Rules → Rulesets** and use this baseline:

| Setting | Required value | Why |
|---|---|---|
| Enforcement status | `Active` | A disabled ruleset does not protect the branch. |
| Target branches | The repository's default branch, normally `main` | The merge destination must be covered. |
| Require a pull request before merging | Enabled | `wiki:publish` binds its result to a PR head, and direct updates must not bypass that PR boundary. |
| Require status checks to pass before merging | Enabled | This turns the published local result into a merge requirement. |
| Required status check | The exact `.wiki/config.json` `enforcement.statusContext`; default `wiki-ssot/local` | The configured context, not an old Actions job name, is the protected result. |
| Status source | `any source` | `wiki:publish` posts through the authenticated maintainer's `gh` session, not a GitHub App. |
| Require branches to be up to date before merging | Enabled (strict) | Advancing the base requires a new exact result instead of merging evidence produced against an older base. |

Cut over in this order: run the exact local gate, open or update the PR, publish its status, confirm the status is visible, add the requirement above, and only then remove obsolete Wiki Actions checks from the rule. Do not add a Wiki GitHub Actions workflow as a required check; version 2 runs those checks locally. Every new PR commit, rebase, or advanced base requires a new local result and publication.

Approval counts, review-thread resolution, CODEOWNERS, required workflows unrelated to Wiki SSOT, bypass actors, deletion protection, and force-push/non-fast-forward protection are separate deployment choices. An empty bypass list and deletion/force-push protection make the repository boundary harder to circumvent, but Wiki SSOT does not configure or audit them. If a bypass actor is configured, that actor can bypass the local-status merge requirement. See GitHub's [ruleset rule reference](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) and [commit-status documentation](https://docs.github.com/en/rest/commits/statuses).
