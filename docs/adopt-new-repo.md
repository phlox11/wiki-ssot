# Adopt in a new repository

Goal: start a repository with the wiki already in place, and grow it as the code grows.

## 1. Copy the kit in

Create your empty repository, then sync the kit into it from a checkout of this one:

```sh
bun scripts/wiki/kit-sync.ts --into /path/to/your-repo
```

Then merge the scripts and dev dependencies into your `package.json` with the command in [`kit/README.md`](../kit/README.md#adopt-it-in-a-new-repository), and run `bun install`.

You arrive with an empty verification ledger and no pages to delete: the kit contains only the toolkit, never this repository's own wiki pages, conflicts, or proposals. Within `scripts/wiki/`, `wiki.test.ts` and `fresh-context.test.ts` are kit-owned — they are the engine's regression suites and run in CI. `inventories.example.ts` is never copied into your repository at all; read its patterns from `kit/scripts/wiki/inventories.example.ts` in this checkout when you write your own `inventories.ts`.

[`kit/README.md`](../kit/README.md) documents the full file list, the kit-owned/seed split, and how to take a later upgrade.

## 2. Point config at your project

`.wiki/config.json`:

```json
{
  "version": 1,
  "name": "your-project",
  "highRisk": [],
  "freshContext": {
    "mode": "required",
    "requiredVerdict": "PASS",
    "evidenceRequired": true,
    "requiredWhen": {
      "kind": "risk-based",
      "changedFileGlobs": [".github/workflows/**", ".wiki/config.json", "AGENTS.md", "scripts/wiki/**"],
      "affectedInvariants": true,
      "affectedConflicts": true,
      "removedCurrentPages": true
    },
    "trust": {
      "allowedReviewers": ["*"],
      "requireDifferentActor": false,
      "requireAuthenticatedActor": true
    }
  }
}
```

Start top-level `highRisk` empty and add stale-page globs as you introduce contracts, schema, and routes. Extend `requiredWhen.changedFileGlobs` with project security, schema, and migration paths; omit `requiredWhen` if every candidate should receive Fresh-context review. Start `.wiki/coverage.json` with an empty `include`; the coverage gate is a no-op until you add patterns. The default is solo-maintainer compatible: the authoring code agent runs applicable review through a separate context before opening a PR, while its authenticated publisher may be the PR author. Set `requireDifferentActor: true` only when another reviewer account or bot is ready. Narrow `allowedReviewers` to explicit reviewer/service logins when available. Missing Fresh-context policy is an integration error, never an implicit advisory mode.

## 3. Write the first pages as you write the first code

An empty wiki is valid and passes every gate. Then, with each feature:

1. Create the code and its `wiki/<group>/<name>.md` page in the **same PR**, with `sources` pointing at the new files.
2. Add the new code area to `coverage.json` `include`, and mark high-risk paths in `config.json`.
3. Run `bun run wiki:generated && bun run wiki:verify && bun run wiki:lint && bun run wiki:doctor`.
4. Record real product invariants as `kind: invariant` pages early — they are what conflicts and reviews check against.

Because the wiki grows *with* the code, each page is verified by the same PR that creates the behavior — no big-bang backfill, and no drift to catch up on later.

## 4. Turn on the rails and maintain

Same as an existing repo — preserve the `wiki-ssot:fresh-context-guardrail` AGENTS marker and structured PR metadata, run `wiki:review-preflight` before publication, reconcile required bundles through a separate review context, then attach the locally-passed report to a Draft before marking it Ready. Keep the trusted Ready-only `wiki-review-attestation` job installed. Every Ready/merge candidate needs either `required: false` or PASS for its exact current HEAD and bundle digest.

As a final human step, enable branch protection/rulesets on `main` and require `code-check`, `wiki-structure`, `wiki-generated`, `wiki-impact`, and `wiki-review-attestation`, with branches up to date before merge. Protect `.github/workflows/checks.yml` with a ruleset-required workflow or CODEOWNERS plus required owner review. The repository cannot make these settings true through tracked files alone; without them, CI is not a complete merge guardrail.

If an installed required check is renamed later, migrate it without a protection gap: let the new context succeed while the old remains required, add the new context, verify strict mode and all unrelated contexts, then remove the old context and verify the final protection/merge state.

See the [command reference](commands.md) and the [design](design.md). For a code-first bootstrap of an established codebase instead, see [adopt-existing-repo.md](adopt-existing-repo.md).
