# Command reference

All commands are `bun run wiki:<name>`; each maps to `bun scripts/wiki/cli.ts <name>`. Pass CLI flags after `--`.

| Command | What it does | Blocks? |
|---|---|---|
| `wiki:lint` | Frontmatter, links, source paths, coverage, generated freshness. | pre-commit + CI |
| `wiki:generated` | Regenerate index, current-status, conflicts, reverse maps, inventories. Add `-- --check` to verify without writing. | CI (`--check`) |
| `wiki:kit` | Regenerate the `kit/` copy-paste distribution from the files it ships. Add `-- --check` to fail on drift instead of writing. Only this repository publishes a kit. | CI (`--check`) |
| `wiki:impact -- --base <ref>` | From the diff since `<ref>`, print affected pages/conflicts, staleness, and metadata findings. Add `--enforce` to exit non-zero on any error. | CI (`--enforce`) |
| `wiki:verify -- --page <id>` | Record current source hashes for a page you updated. Add `--unchanged "<20+ char reason>"` when meaning did not change. With no `--page`, re-verifies every current page. | — |
| `wiki:search -- "<terms>"` | Keyword search across pages. | — |
| `wiki:context -- "<terms>"` | The pages + open conflicts + sources an agent should read for a task. Also `-- --conflict C-NNN` or `-- --base <ref>`. | — |
| `wiki:conflicts` | List open conflicts. `-- C-NNN` prints one resolution contract; `-- --all` includes resolved. | — |
| `wiki:review-preflight -- --base <ref> --metadata <file> [--output <dir>] [--report <file>]` | Before opening a PR, classify risk, prepare the exact independent-review bundle, or validate the returned report while the PR mirror is still pending. | pre-PR |
| `wiki:review-bundle -- --base <ref> --metadata <file>` | Write a deterministic bundle with `manifest.json`, reviewer instructions, and a report example. | review input |
| `wiki:review-check -- --base <ref> --metadata <file> [--report <file>]` | Evaluate trusted risk policy and return `required`/reasons. When required, recompute the current manifest and validate report schema, PASS, evidence, SHA/digests, and reviewer trust. | CI (`required` mode) |
| `wiki:doctor` | Validate required downstream seams: explicit config, AGENTS marker, PR template, commands, and GitHub job/events. | pre-commit + CI |
| `wiki:check -- --base <ref>` | Everything at once: lint + generated + impact. | local convenience |
| `wiki:audit` | Repo-wide: structure + generated + every current page's source hashes. | weekly CI |
| `wiki:index` / `wiki:inventory` | Write just the core generated files / just the inventories. | — |

## Common flows

Before a PR:

```sh
bun run wiki:generated
bun run wiki:lint
bun run wiki:doctor
bun run wiki:impact -- --base origin/main --enforce
bun run typecheck && bun run test
```

You changed a source and its page's meaning:

```sh
# edit the page, then:
bun run wiki:verify -- --page architecture/api
```

You changed a source but the page's meaning is unchanged:

```sh
bun run wiki:verify -- --page architecture/api --unchanged "internal refactor only, exported behavior identical"
```

Fresh-context review:

```sh
# Commit the complete candidate first. Before a PR exists, classify and prepare
# the exact bundle when required; uncommitted candidate files are rejected.
bun run wiki:review-preflight -- --base origin/main --metadata pr-body.md \
  --output review-bundle --json
# Give the bundle to a context-isolated reviewer/sub-agent, then validate its report.
bun run wiki:review-preflight -- --base origin/main --metadata pr-body.md \
  --report report.json --reviewer-actor reviewer-login --pr-author author-login --json
```

Preflight returns `not-required`, `review-required`, `needs-reconcile`, or `pass`. A required `NEEDS_RECONCILE` report must identify the exact discrepancy, controlling authority, required code/wiki/test change, and acceptance criteria. The authoring agent dispositions each finding before opening the PR — fixing what this candidate broke or declared, tracking a pre-existing mismatch or undecidable intent in an open conflict, or recording a named follow-up — and reruns preflight on the new HEAD.

The report is JSON/YAML with exact bindings, reviewer, evidence, and summary or findings. `version: 1` carries free-text findings and stays accepted. `version: 2` carries structured findings: `id`, `classification`, `disposition`, `scope_refs`, `discrepancy`, `authority`, `evidence`, and `acceptance_criteria`, where `conflict_introduced`/`existing_conflict_linked` require `conflict_id`, `followup_created` requires `followup_ref`, and `dismissed_with_reason` requires a 20+ character `dismissal_reason`. A `PASS` may not carry an `unresolved` finding; `recorded` retires nothing and is confined to a `suggestion`. A fixed table decides which dispositions retire which classification — `candidate_regression` and `declared_contract_violation` accept only `fixed` or `unresolved`, and `decision_ambiguity` accepts those plus a conflict disposition but never a dismissal or follow-up — and a `conflict_id` must resolve to a conflict open at the reviewed HEAD whose conflict type matches where the classification implies one, whose `origin` is `baseline` when the classification says the problem predates the candidate, and whose affected pages overlap the finding's `page:` scope refs, which a finding declaring none cannot satisfy. `unrelated_defect` implies no type, and `decision_ambiguity` is exempt from the `origin` rule.

After local PASS, open a Draft PR, publish the report, mirror its verdict/HEAD/bundle/reviewer/evidence into PR metadata, and mark the PR Ready. Drafts skip `wiki-review-attestation`; Ready PRs validate the authenticated envelope and mirror. A valid low-risk result needs no report. Omitting `requiredWhen` preserves all-PR review.

`trust.requireDifferentActor` controls GitHub identity separation, not context isolation. Set it to `false` for a solo maintainer: when review is required, the authoring session still cannot create its own PASS, but the PR author's authenticated account may publish a report created by a separate review session. Set it to `true` only when a distinct reviewer account or bot is operational.

`fresh_context` in the PR body is required and parsed even when an author bypasses the template, but it is only a status mirror. GitHub enforcement reads the authoritative report and actor from a PR review/comment envelope. Add `--json` to read/check commands for machine-readable output.

CI passes the PR body through the `WIKI_PR_BODY` environment variable, so the impact job validates the metadata block from the pull-request description. Locally, pass `--metadata <file>` instead.

See [WORKFLOW](../wiki/WORKFLOW.md) for the change process and [design](design.md) for why each gate exists.
