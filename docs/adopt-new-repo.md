# Adopt in a new repository

Goal: start a repository with the wiki already in place, and grow it as the code grows.

## 1. Start from this template

Use this repository as a GitHub template (or copy its files), then remove the self-describing example pages and reset the verification ledger to your project:

```sh
# after copying the kit into your new repo:
rm wiki/product/scope.md wiki/product/invariants.md wiki/architecture/engine.md \
   wiki/operations/enforcement.md wiki/proposals/protected-main.md
echo '{"pages":{},"version":1}' > .wiki/state.json
bun install
```

Keep `scripts/wiki/`, `.wiki/config.json`, `.wiki/coverage.json`, `.husky/`, `.github/`, `AGENTS.md`, `CLAUDE.md`, and `wiki/SCHEMA.md` / `wiki/WORKFLOW.md` / `wiki/README.md` / `wiki/changelog.md`. Within `scripts/wiki/`, keep `wiki.test.ts` (the engine's regression suite, run in CI); `inventories.example.ts` is reference-only — delete it once you write your own `inventories.ts`, or right away if you will not use inventories.

## 2. Point config at your project

`.wiki/config.json`:

```json
{ "version": 1, "name": "your-project", "highRisk": [] }
```

Start `highRisk` empty and add globs as you introduce contracts, schema, and routes. Start `.wiki/coverage.json` with an empty `include`; the coverage gate is a no-op until you add patterns.

## 3. Write the first pages as you write the first code

An empty wiki is valid and passes every gate. Then, with each feature:

1. Create the code and its `wiki/<group>/<name>.md` page in the **same PR**, with `sources` pointing at the new files.
2. Add the new code area to `coverage.json` `include`, and mark high-risk paths in `config.json`.
3. Run `bun run wiki:generated && bun run wiki:verify && bun run wiki:lint`.
4. Record real product invariants as `kind: invariant` pages early — they are what conflicts and reviews check against.

Because the wiki grows *with* the code, each page is verified by the same PR that creates the behavior — no big-bang backfill, and no drift to catch up on later.

## 4. Turn on the rails and maintain

Same as an existing repo — hooks on install, CI on PRs, branch protection on `main` (`wiki/proposals/protected-main.md`), and the loop in `wiki/WORKFLOW.md`.

See the [command reference](commands.md) and the [design](design.md). For a code-first bootstrap of an established codebase instead, see [adopt-existing-repo.md](adopt-existing-repo.md).
