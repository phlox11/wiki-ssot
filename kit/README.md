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

# accept a hand-resolved kit conflict, or retire the customized legacy checks workflow
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
| `scripts/wiki/inventories.example.ts`, `migrations/v1/**` | References read from the WikiSsot checkout, never copied. The migration references identify the exact former combined workflow and its host-only result. |
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

The exact version 1 combined `.github/workflows/checks.yml` migrates automatically: apply rewrites that file to its host-only `code-check` and installs the Wiki jobs in `.github/workflows/wiki-ssot.yml`. The regression fixture is byte-locked to the former shipped payload, so “recognized” does not mean merely trusting a local manifest hash.

An unknown or customized legacy workflow is never deleted. Apply returns `needs-merge`; remove its Wiki jobs, retain every host job, and acknowledge that one-time split only after inspecting the result:

```sh
bun /path/to/WikiSsot/scripts/wiki/apply.ts --into /path/to/project \
  --accept .github/workflows/checks.yml
```

## Project-owned reconciliation

The seeded files are intentionally not upgraded. Review upstream changelog/contract changes, then update them only when the project needs it:

- `.wiki/config.json` — project name, high-risk paths, and Fresh-context policy.
- `.wiki/coverage.json` — maintained implementation/test globs and exclusions.
- `.wiki/state.json` — source verification evidence, updated through `wiki:verify`.
- `scripts/wiki/inventories.ts` — optional project-specific generated inventories.
- `wiki/**` current/conflict/proposal content — the project's intent, never generic kit prose.

The dedicated `.github/workflows/wiki-ssot.yml` runs only Wiki SSOT jobs. The host keeps its own build/test workflow and script names, avoiding duplicate assumptions about the project's stack.

## Requirements and trust boundary

- Bun 1.1 or newer and Git.
- GitHub Actions only for the reference CI rail.
- Repository developers/admins are trusted not to gut a required workflow while preserving its check name. Required workflows, CODEOWNERS, rulesets, and administrator-bypass controls are optional deployment governance outside this toolkit.
