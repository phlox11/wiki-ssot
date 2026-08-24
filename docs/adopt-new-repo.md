# Adopt in a new repository

Goal: start a repository with the wiki already in place, and grow it as the code grows.

## 1. Run the unified apply loop

Create a project directory and initialize Git, then run the same command used for adoption and every future upgrade:

```sh
git -C /path/to/your-repo init
bun /path/to/WikiSsot/scripts/wiki/apply.ts --into /path/to/your-repo
```

An initial `--dry-run` writes nothing and intentionally exits 1 with `needs-reconcile`, because the project does not yet have its first source-backed current page or maintained coverage. A dry-run never reports `ready`; that status is reserved for the installed checks passing after reconciliation.

The first report identifies mode `new` and intentionally returns `needs-reconcile` until the project has real source-backed current intent and non-empty maintained coverage. The command installs dependencies and hooks, preserves host package lifecycle commands, and can be rerun unchanged after each finding is resolved.

You arrive with an empty verification ledger, an empty coverage `include`, an adopter-owned `.gitignore` that keeps installed dependencies out of the first candidate, and no pages to delete: the kit contains only the toolkit, never this repository's own wiki pages, conflicts, or proposals. Within `scripts/wiki/`, every manifest-owned `*.test.ts` regression suite and `test-fixtures/*.ts` helper delivered by the kit is kit-owned and runs through the dedicated Wiki tooling test; keep those files together rather than selecting suites individually. `inventories.example.ts` is never copied into your repository at all; read its patterns from `kit/scripts/wiki/inventories.example.ts` in this checkout when you write your own `inventories.ts`.

[`kit/README.md`](../kit/README.md) documents the full file list, the kit-owned/seed split, and how to take a later upgrade.

## 2. Point config at your project

`.wiki/config.json`:

```json
{
  "version": 2,
  "name": "your-project",
  "publishesKit": false,
  "highRisk": [],
  "enforcement": {
    "mode": "local-status",
    "statusContext": "wiki-ssot/local"
  },
  "localChecks": [
    { "id": "project-typecheck", "argv": ["bun", "run", "typecheck"] },
    { "id": "project-test", "argv": ["bun", "run", "test"] }
  ],
  "review": {
    "mode": "required",
    "when": {
      "kind": "risk-based",
      "semanticVerify": {
        "enabled": true,
        "reason": "Semantic verification requires independent comparison with current authority."
      },
      "changedFileRules": [
        {
          "glob": ".wiki/config.json",
          "reason": "Wiki enforcement policy itself is changing."
        },
        {
          "glob": "AGENTS.md",
          "reason": "Agent workflow changes can bypass required Wiki procedure."
        }
      ],
      "changedKitOwnedFiles": true,
      "affectedInvariants": true,
      "affectedConflicts": true,
      "removedCurrentPages": true
    }
  }
}
```

Start top-level `highRisk` empty and add stale-page globs as you introduce contracts, schema, and routes. Replace or extend `localChecks` with the repository's actual test and typecheck argv arrays; shell command strings are intentionally unsupported. `semanticVerify.enabled: true` makes canonical `semantic_change: true` plus `wiki_action: verify` metadata require independent reconciliation even when no path rule matches. Its reason is included in the review requirement and must contain at least 20 characters. Explicit `false` preserves the other risk signals, but omission is a migration error rather than an implicit disabled default. Add narrowly scoped `changedFileRules` for project security, schema, and migration paths, with a concrete reason for each rule. `changedKitOwnedFiles` uses the installed kit manifest rather than selecting every file under `scripts/wiki/**`. Version 2 never falls back silently to all-PR review. The shipped `.wiki/coverage.json` has an empty `include`, so coverage is a no-op until you deliberately add a real code pattern.

## 3. Write the first pages as you write the first code

The apply loop does not call a copied toolkit with no project knowledge complete. Add the first feature and its Wiki contract as one candidate:

1. Create production code and its test.
2. Create `wiki/<group>/<name>.md` in the **same candidate**, with `sources` pointing at both files. Classify new declarations explicitly: use `context: always` for the few anchors a compact task must read, and a reasoned `context: catalog` for a broad set that stays fully tracked but is expanded only on demand.
3. Add the code area to `.wiki/coverage.json` `include`; extend `tsconfig.json` and the repository's `test` script so the new code and test are actually checked, and mark high-risk paths in `.wiki/config.json` where appropriate.
4. Run `wiki:generated`, then `wiki:verify`. Generation maintains the bounded index, complete catalog, cumulative status, queues, reverse maps, and relationship graph; do not edit those projections by hand. The candidate is not green before verification records the new current page's source hash.
5. Rerun `apply.ts` until it reports `ready`, then run `wiki:scope -- --base <base>`, `wiki:impact -- --base <base> --enforce`, and `wiki:review-preflight` with prospective PR metadata. Scope explains source/read/review breadth without enforcing a numeric quota. `not-required` is a passing preflight result when the configured risk selector does not select the feature; an enabled semantic selector always selects semantic `verify` metadata. Otherwise reconcile the emitted bundle to PASS in a separate context.
6. Commit code, test, current page, coverage, generated maps/indexes, and the verification ledger together. Record real product invariants as `kind: invariant` pages early — they are what conflicts and reviews check against.

Because the wiki grows *with* the code, each page is verified by the same PR that creates the behavior — no big-bang backfill, and no drift to catch up on later.

## 4. Turn on the rails and maintain

If the project later accumulates drift and nobody knows which page is affected,
start one repository-wide coding-agent pass with:

```sh
bun run wiki:reconcile
```

It deterministically lists every current page and its bounded source/conflict
context. The agent completes all returned pages, reflects clear observed code
behavior into current Wiki, records ambiguity as conflicts, and verifies pages
only after semantic reconciliation. The command itself never rewrites Wiki or
state.

Same as an existing repo — preserve the versioned managed AGENTS block and its stable required rule IDs, together with the canonical `wiki:work` script and structured semantic PR metadata. The typed rules route session authority, no-query work, human handoff, selected work, direct topic context, and the non-current boundary without asking doctor to interpret arbitrary prose. A plain question about remaining work starts with `bun run wiki:work`; human-exclusive work stays visible for handoff, while selected recommended agent/either work uses its printed selected-context command. Run `wiki:review-preflight` before publication and reconcile required bundles through a separate review context. Then run the exact local gate, open or update the PR, and publish the result:

```sh
bun run wiki:check -- --base origin/main --metadata /tmp/pr-body.md --report /tmp/review-report.json --output /tmp/wiki-result.json
bun run wiki:publish -- --result /tmp/wiki-result.json --pr <number>
```

The new kit installs no active GitHub Actions workflow. GitHub only displays the configured local commit status and the marked diagnostic comment. After publishing the first exact PR-HEAD status, configure the default branch to require a pull request, the exact `.wiki/config.json` `enforcement.statusContext` status from `any source`, and strict/up-to-date branches. Follow the portable [branch-protection recipe](../wiki/WORKFLOW.md#github-branch-protection-for-local-status). Each new PR HEAD or advanced base needs a new exact local result; do not add a Wiki Actions job as a required check.

wiki-ssot assumes repository write/admin actors are trusted. A deployment may add branch protection, required workflows, CODEOWNERS, or administrator-bypass restrictions, but organization-security policy is outside the toolkit's product contract and is not configured or audited by these files.

See the [command reference](commands.md) and the [design](design.md). For a code-first bootstrap of an established codebase instead, see [adopt-existing-repo.md](adopt-existing-repo.md).
