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
| `wiki:review-bundle -- --base <ref> --metadata <file>` | Write a self-contained bundle for a fresh-context reconcile review. | — |
| `wiki:check -- --base <ref>` | Everything at once: lint + generated + impact. | local convenience |
| `wiki:audit` | Repo-wide: structure + generated + every current page's source hashes. | weekly CI |
| `wiki:index` / `wiki:inventory` | Write just the core generated files / just the inventories. | — |

## Common flows

Before a PR:

```sh
bun run wiki:generated
bun run wiki:lint
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

Add `--json` to any read command for machine-readable output.

CI passes the PR body through the `WIKI_PR_BODY` environment variable, so the impact job validates the metadata block from the pull-request description. Locally, pass `--metadata <file>` instead.

See [WORKFLOW](../wiki/WORKFLOW.md) for the change process and [design](design.md) for why each gate exists.
