# Adopt in an existing repository

Goal: stand up an enforced SSOT wiki over a codebase that already exists, then keep it in sync. This is the "bootstrap from the code you already have" path.

## 0. Prerequisites

- Bun ≥ 1.1 and git.
- A clean working tree and a known base commit.

## 1. Copy the kit in

From this repository, copy into the root of yours:

```
scripts/wiki/          → scripts/wiki/
.wiki/config.json      → .wiki/config.json
.wiki/coverage.json    → .wiki/coverage.json
.wiki/state.json       → .wiki/state.json      (start it as {"pages":{},"version":1})
.husky/                → .husky/
.github/workflows/     → .github/workflows/     (merge into your CI if you already have one)
.github/pull_request_template.md
AGENTS.md, CLAUDE.md
wiki/SCHEMA.md, wiki/WORKFLOW.md, wiki/README.md, wiki/changelog.md
```

Add the `wiki:*`, `typecheck`, `test`, and `prepare` scripts and the `devDependencies` from this repo's `package.json` to yours, then:

```sh
bun install
```

## 2. Configure the two seams

`.wiki/config.json` — your wiki's name and the files whose changes deserve the sharpest review:

```json
{ "version": 1, "name": "your-repo", "highRisk": ["src/contracts/**", "src/db/**", "migrations/**"] }
```

`.wiki/coverage.json` — the code areas that must always map to a page (start narrow, widen later):

```json
{ "version": 1, "include": ["src/**/*.ts"], "exclusions": [] }
```

## 3. Bootstrap the initial pages from the code you have

Do **not** paste old prose docs in. Recompile current knowledge from primary sources — ideally with a coding agent, one area at a time:

1. Inventory the real surface: entry points, routes, schema/migrations, shared contracts, and the invariants your tests pin.
2. For each major area, write one small `wiki/<group>/<name>.md` page (see `wiki/SCHEMA.md`) whose `sources` point at the real files, describing **current** behavior only.
3. Anything you cannot confirm, or where docs and code disagree in a way that could change behavior, becomes a `wiki/conflicts/open/**` page — not a guess.
4. Keep pages atomic and link-first; let code stay the detail and have the page link to it.

Map every file matched by `coverage.json` `include` to some page's `sources`, or add a reasoned exclusion. `wiki:lint` names every unmapped file, so you can drive this to zero.

## 4. Optional: code-derived inventories

For always-current generated pages (route tables, schema lists), implement `scripts/wiki/inventories.ts` for your stack. Copy patterns from `scripts/wiki/inventories.example.ts`, then delete the example — it is reference-only and imported by nothing. Keep `scripts/wiki/wiki.test.ts`: it is the engine's own regression suite (run by the `code-check` CI job) and depends on no host project.

## 5. Verify and go green

```sh
bun run wiki:generated                 # write index, maps, inventories
bun run wiki:verify                    # record source hashes for all current pages
bun run wiki:lint                      # must pass
bun run wiki:audit                     # must pass (no stale pages)
bun run typecheck && bun run test
```

Commit the wiki, `.wiki/`, and generated files together.

## 6. Turn on the rails

- Hooks activate on `bun install` (via the `prepare` script). Confirm a bad staged page blocks a commit.
- CI: the workflows in `.github/workflows/` run the four blocking jobs on every PR.
- Remote boundary: configure GitHub branch protection on `main` (see `wiki/proposals/protected-main.md`). This is what actually stops direct pushes and the cross-PR merge race.

## 7. Maintain

Every change follows `wiki/WORKFLOW.md`: search → read sources → change code + page + tests together → regenerate → `wiki:impact --enforce` → PR with the metadata block → attach a fresh-context `PASS`/`NEEDS_RECONCILE`.

See the [command reference](commands.md) and the [design](design.md).
