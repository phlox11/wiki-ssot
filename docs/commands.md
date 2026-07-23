# Command reference

All commands are `bun run wiki:<name>`; each maps to `bun scripts/wiki/cli.ts <name>`. Pass CLI flags after `--`.

| Command | What it does | Blocks? |
|---|---|---|
| `wiki:lint` | Frontmatter, links, source paths, coverage, generated freshness. | pre-commit + CI |
| `wiki:generated` | Regenerate index, current-status, conflicts, reverse maps, inventories. Add `-- --check` to verify without writing. | CI (`--check`) |
| `wiki:impact -- --base <ref>` | From the diff since `<ref>`, print affected pages/conflicts, staleness, and metadata findings. Add `--enforce` to exit non-zero on any error. | CI (`--enforce`) |
| `wiki:verify -- --page <id>` | Record current source hashes for a page you updated. Add `--unchanged "<20+ char reason>"` when meaning did not change. With no `--page`, re-verifies every current page. | — |
| `wiki:search -- "<terms>"` | Keyword search across pages. | — |
| `wiki:context -- "<terms>"` | The pages + open conflicts + sources an agent should read for a task. Also `-- --conflict C-NNN` or `-- --base <ref>`. | — |
| `wiki:conflicts` | List open conflicts. `-- C-NNN` prints one resolution contract; `-- --all` includes resolved. | — |
| `wiki:review-bundle -- --base <ref> --metadata <file>` | Write a deterministic bundle with `manifest.json`, reviewer instructions, and a report example. | review input |
| `wiki:review-check -- --base <ref> --metadata <file> --report <file>` | Recompute the current manifest and validate report schema, PASS, evidence, SHA/digests, and reviewer trust. Add `--reviewer-actor` and `--pr-author` when the policy requires authenticated/different actors. | CI (`required` mode) |
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
bun run wiki:review-bundle -- --base origin/main --metadata pr-body.md --output review-bundle
# A separate context-isolated reviewer creates report.json from the bundle.
bun run wiki:review-check -- --base origin/main --metadata pr-body.md \
  --report report.json --reviewer-actor reviewer-login --pr-author author-login --json
```

The report contract is JSON/YAML version 1 with `verdict`, `reviewed_head_sha`, `merge_base_sha`, `bundle_digest`, `reviewer`, non-empty `evidence`, and `summary` or `findings`. Mirror its verdict/HEAD/bundle/reviewer/evidence into PR metadata after publication; the check compares the mirror with the authenticated report but never treats the mirror as proof. Required mode uses stable errors including `fresh-context-missing`, `fresh-context-malformed`, `fresh-context-not-pass`, `fresh-context-head-stale`, `fresh-context-base-stale`, `fresh-context-bundle-stale`, `fresh-context-evidence-missing`, and `fresh-context-reviewer-untrusted`.

`trust.requireDifferentActor` controls GitHub identity separation, not context isolation. Set it to `false` for a solo maintainer: the authoring session still cannot create its own PASS, but the PR author's authenticated account may publish a report created by a separate review session. Set it to `true` only when a distinct reviewer account or bot is operational.

`fresh_context` in the PR body is required and parsed even when an author bypasses the template, but it is only a status mirror. GitHub enforcement reads the authoritative report and actor from a PR review/comment envelope. Add `--json` to read/check commands for machine-readable output.

CI passes the PR body through the `WIKI_PR_BODY` environment variable, so the impact job validates the metadata block from the pull-request description. Locally, pass `--metadata <file>` instead.

See [WORKFLOW](../wiki/WORKFLOW.md) for the change process and [design](design.md) for why each gate exists.
