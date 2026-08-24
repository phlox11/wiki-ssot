# wiki-ssot kit

The generated, content-addressed Wiki SSOT distribution. Everything here except this README is produced from the publisher repository by `bun run wiki:kit`; edit the real source, not the generated copy.

## One command for every project state

The target must already be an initialized Git repository. From a current WikiSsot checkout, use the same command for all three installation paths and for Wiki/code synchronization:

```sh
bun /path/to/WikiSsot/scripts/wiki/apply.ts --into /path/to/project
```

It detects:

| Mode | Detection | Result |
|---|---|---|
| `new` | Git repository has no commit and no Wiki SSOT installation | Installs the toolkit and asks for the first source-backed current page and real coverage. |
| `adopt` | Existing Git history, no Wiki SSOT installation | Installs the toolkit, then reports the project-specific Wiki/code reconciliation that remains. |
| `upgrade` | Existing kit manifest, Wiki engine, or Wiki SSOT agent marker | Safely updates the toolkit and reruns synchronization checks. |

The command is deterministic and does not invoke a model. A coding agent can run it, perform the semantic work named by its findings, and rerun the exact command until it reports `ready`. `ready` means the installed Wiki tooling is internally green; it does not create or attest a PR.

The command never initializes Git, edits branches, commits, pushes, opens a PR, invents product intent, or marks every page verified. Those remain explicit project/agent actions.

Useful options:

```sh
# inspect without writing
bun /path/to/WikiSsot/scripts/wiki/apply.ts --into /path/to/project --dry-run

# stable machine-readable report
bun /path/to/WikiSsot/scripts/wiki/apply.ts --into /path/to/project --json

# use already-materialized dependencies; checks still run
bun /path/to/WikiSsot/scripts/wiki/apply.ts --into /path/to/project --skip-install

# accept a hand-resolved kit conflict
bun /path/to/WikiSsot/scripts/wiki/apply.ts --into /path/to/project --accept path/to/file
```

Dry-run is byte-preserving and never claims checks it did not run. A mechanically safe, already-bootstrapped plan returns `preview` with exit 0; missing current-page/coverage bootstrap work returns `needs-reconcile` with the same findings and exit 1; unsafe merges return `needs-merge`.

Exit codes are `0` for `preview` or fully checked `ready`, `1` for expected `needs-merge`/`needs-reconcile` work, and `2` for a fatal execution error.

## What is owned by whom

| Kit path | Downstream behavior |
|---|---|
| `files/**` | Kit-owned implementation. Created on installation and updated when the recorded local copy is pristine. A local/upstream double edit fails closed with `<path>.kit-new`. |
| `managed/**` | Only the marked Wiki SSOT block is owned. Content outside the block in `AGENTS.md`, the PR template, and hooks is preserved. Missing blocks are appended; malformed, duplicate, or ambiguous legacy blocks require a merge. |
| `seed/**` | Project-owned after first creation. Existing files and later project edits are never replaced. This includes policy, coverage, verification state, inventory adapter, `.gitignore`, and root `tsconfig.json`. |
| `package.kit.json` | Merge input, never copied. Only `wiki:*` scripts, compatible toolkit development dependencies, and the Bun minimum are managed. Host `test`, `typecheck`, `prepare`, `type`, and unrelated dependencies survive unchanged. |
| `scripts/wiki/inventories.example.ts`, `migrations/v1/**` | References read from the WikiSsot checkout, never copied. Migration references preserve exact historical version 1 workflow payloads for compatibility tests only. |
| `files/.wiki/kit-manifest.json` | Version 2 ownership map, managed-block metadata, per-item hashes, and the roll-up kit digest. |

The kit has no release-number identity. Its `digest` covers file, managed-block, and reference content, so equal digests mean equal distributions.

```sh
bun -e 'const m = await Bun.file("kit/files/.wiki/kit-manifest.json").json(); console.log(`kit ${m.digest.slice(0,12)}`); for (const [p,v] of Object.entries(m.files)) console.log(`${v.ownership.padEnd(9)} ${p}`); for (const p of Object.keys(m.managed)) console.log(`managed   ${p}`); for (const p of Object.keys(m.reference)) console.log(`reference ${p}`)'
```

## What the apply loop does

On each run, the orchestrator:

1. Classifies the target as `new`, `adopt`, or `upgrade`.
2. Three-way updates kit-owned files from the incoming kit, the recorded manifest, and the target bytes.
3. Replaces or appends only declared managed blocks.
4. Merges the package fragment without taking over host lifecycle commands.
5. Runs `bun install` and installs Husky hooks unless `--skip-install` was given.
6. Regenerates deterministic Wiki artifacts.
7. Runs doctor, lint, audit, the Wiki tooling typecheck, and Wiki tooling tests.
8. Reports missing current pages, empty coverage, stale sources, unmapped code, structural failures, or unsafe merges as explicit work.

For `new` and `adopt`, a copied toolkit with no project knowledge is intentionally not called complete. Add at least one current page backed by real project sources, configure non-empty maintained coverage, map or reason-exclude every covered file, resolve any code/Wiki disagreement as a conflict instead of guessing, run `wiki:verify`, and invoke `apply.ts` again.

## Upgrade and conflict behavior

Kit-owned files use the recorded three-way baseline:

| Target state | Incoming state | Result |
|---|---|---|
| absent | any | create |
| identical to incoming | any | unchanged |
| identical to recorded | changed | update |
| locally edited | unchanged upstream | customized and preserved |
| locally edited | also changed upstream | conflict; preserve local and write `.kit-new` |
| differs with no recorded baseline | any | conflict |
| symlinked target/ancestor escape | any | refuse the write |

After hand-merging an ordinary kit conflict, delete `.kit-new` and rerun with `--accept <path>`. Managed blocks need no acceptance flag: put exactly one valid marked block in the host file and rerun.

New installations contain no active GitHub Actions workflow. Their seeded version 2 configuration explicitly enables the reasoned `semanticVerify` selector, so canonical `semantic_change: true` plus `wiki_action: verify` metadata requires independent reconciliation even without another risk signal. An existing version 1 or customized workflow is never deleted merely because it disappeared from the incoming kit. Convert the project-owned configuration explicitly, copy every real host test/typecheck command into version 2 `localChecks`, choose `semanticVerify.enabled` true or false, include the intended workflow removal in that migration PR, and let `wiki:doctor` verify that no legacy active Wiki workflow remains. Historical workflow payloads stay byte-locked under `migrations/v1/**` so compatibility remains testable without shipping a live workflow.

## Project-owned reconciliation

The seeded files are intentionally not upgraded. Review upstream changelog/contract changes, then update them only when the project needs it:

- `.wiki/config.json` — project name, high-risk paths, local project-check argv, status context, and explicit review policy including the reasoned semantic-verify choice.
- `.wiki/coverage.json` — maintained implementation/test globs and exclusions.
- `.wiki/state.json` — source verification evidence, updated through `wiki:verify`.
- `scripts/wiki/inventories.ts` — optional project-specific generated inventories.
- `wiki/**` current/conflict/proposal content — the project's intent, never generic kit prose.

The bounded-navigation upgrade follows the same ownership split. A pristine installation receives the upgraded generator, system-file rules, regression tests, and package commands, but no active workflow. The next generation creates the complete `wiki/catalog.md`, rewrites the bounded `wiki/index.md` and cumulative `wiki/current-status.md`, and emits `.wiki/relationship-graph.json`. Those are disposable projections over existing records; no semantic record migration is required.

The bounded-source upgrade also preserves project ownership. A declaration without `context` keeps the historical `always` meaning, so installing the new engine does not change an existing repository's mandatory read order. Apply does not rewrite Wiki frontmatter; upgrade and dry-run reports summarize legacy omissions as one non-blocking scope warning with the follow-up command. Run `wiki:scope -- --base <ref>` in an explicit repository PR, keep a small set of contract-routing anchors as `always`, and change a genuinely broad declaration to reasoned `catalog` only after reviewing its source and review fan-out. Catalog changes compact reading only: source maps, coverage, hashes, drift, impact, conflicts, and `--full` expansion still use the complete set.

Apply never rewrites project-owned current/proposal/conflict records, configuration, coverage, verification state, inventory adapters, or a project changelog, and it never infers `related`, `affects`, or dependency edges. If an existing version 2 configuration omits `semanticVerify`, apply preserves its bytes and returns actionable `needs-reconcile`; the repository owner must choose enabled true or false before doctor and the canonical local gate pass. A temporary pair of reasoned application/package `changedFileRules` can protect an adopter before it installs the selector, but is broader and noisier than metadata-aware selection and should be removed after migration. A customized kit-owned file still follows the normal `.kit-new` merge/`--accept` loop. After upgrade, commit the refreshed generated artifacts only after `wiki:generated -- --check`, `wiki:lint`, `wiki:audit`, and `wiki:doctor` pass.

## Local result and status

Version 2 uses a local exact-result path. GitHub does not run the Wiki engine.
After committing a candidate, run:

```sh
bun run wiki:check -- --base origin/main --metadata pr-body.md \
  --output /tmp/wiki-result.json
# With a review report:
bun run wiki:check -- --base origin/main --metadata pr-body.md \
  --report review-report.json --output /tmp/wiki-result.json
bun run wiki:publish -- --result /tmp/wiki-result.json
# Or identify the PR explicitly:
bun run wiki:publish -- --result /tmp/wiki-result.json --repo owner/repo --pr 123
```

`wiki:check` binds the committed HEAD, resolved base/merge-base, canonical
metadata digest, check/review summaries and findings, and a deterministic
result digest. It permits only the explicitly named metadata/report/result
artifacts outside the committed tree. A changed toolkit-owned file selects the
Wiki tooling typecheck and full tooling suite; publisher mode also runs kit
freshness and growth guards. Every configured `localChecks` argv also runs;
the configuration does not accept shell command strings. `wiki:publish` revalidates the result,
requires matching clean local and remote PR SHAs, upserts one
`wiki-ssot:local-status` marker comment, and posts the configured status context afterward.
Warnings still produce success; malformed, stale, mismatched, or API-failed
operations return non-zero. Publishing uses the authenticated `gh` CLI and
introduces no daemon, GitHub App, or hosted service. A new PR HEAD has no status
until the exact local result is rerun and republished.

To make that status a merge boundary, follow the generated
[`wiki/WORKFLOW.md` branch-protection recipe](files/wiki/WORKFLOW.md#github-branch-protection-for-local-status).
It requires a pull request, the configured status context from `any source`,
and strict/up-to-date branches; it also separates those functional requirements
from optional repository hardening.

## Requirements and trust boundary

- Bun 1.1 or newer and Git.
- An authenticated `gh` CLI only when publishing the local result to GitHub; GitHub Actions are not required.
- Repository developers/admins are trusted not to weaken the local gate or required-status rule. Required workflows, CODEOWNERS, rulesets, and administrator-bypass controls are optional deployment governance outside this toolkit.
