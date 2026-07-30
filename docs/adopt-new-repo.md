# Adopt in a new repository

Goal: start a repository with the wiki already in place, and grow it as the code grows.

## 1. Copy the kit in

Create your empty repository, then sync the kit into it from a checkout of this one:

```sh
bun scripts/wiki/kit-sync.ts --into /path/to/your-repo
```

Then merge the scripts and dev dependencies into your `package.json` with the command in [`kit/README.md`](../kit/README.md#adopt-it-in-a-new-repository), and run `bun install`.

You arrive with an empty verification ledger, an empty coverage `include`, an adopter-owned `.gitignore` that keeps installed dependencies out of the first candidate, and no pages to delete: the kit contains only the toolkit, never this repository's own wiki pages, conflicts, or proposals. Within `scripts/wiki/`, `wiki.test.ts`, `work.test.ts`, and `fresh-context.test.ts` are kit-owned — they are the engine's regression suites and run in CI. `inventories.example.ts` is never copied into your repository at all; read its patterns from `kit/scripts/wiki/inventories.example.ts` in this checkout when you write your own `inventories.ts`.

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

Start top-level `highRisk` empty and add stale-page globs as you introduce contracts, schema, and routes. Extend `requiredWhen.changedFileGlobs` with project security, schema, and migration paths; omit `requiredWhen` if every candidate should receive Fresh-context review. The shipped `.wiki/coverage.json` has an empty `include`, so coverage is a no-op until you deliberately add a real code pattern. The default is solo-maintainer compatible: the authoring code agent runs applicable review through a separate context before opening a PR, while its authenticated publisher may be the PR author. Set `requireDifferentActor: true` only when another reviewer account or bot is ready. Narrow `allowedReviewers` to explicit reviewer/service logins when available. Missing Fresh-context policy is an integration error, never an implicit advisory mode.

## 3. Write the first pages as you write the first code

The initially empty repository becomes green after kit sync, package/dependency merge, `wiki:generated`, and `wiki:verify`; at that point `wiki:lint`, `wiki:doctor`, `typecheck`, and the shipped engine tests pass while coverage is intentionally inactive. Commit that adoption baseline before adding product code so the first feature has a real merge base.

Then add the first feature as one candidate:

1. Create production code and its test.
2. Create `wiki/<group>/<name>.md` in the **same candidate**, with `sources` pointing at both files.
3. Add the code area to `.wiki/coverage.json` `include`; extend `tsconfig.json` and the repository's `test` script so the new code and test are actually checked, and mark high-risk paths in `.wiki/config.json` where appropriate.
4. Run `wiki:generated`, then `wiki:verify`. The candidate is not green before verification records the new current page's source hash.
5. Run `wiki:lint`, `wiki:doctor`, `wiki:impact -- --base <adoption-baseline> --enforce`, `typecheck`, `test`, and `wiki:review-preflight` with prospective PR metadata. `not-required` is a passing preflight result when the configured risk selector does not select the feature; otherwise reconcile the emitted bundle to PASS in a separate context.
6. Commit code, test, current page, coverage, generated maps/indexes, and the verification ledger together. Record real product invariants as `kind: invariant` pages early — they are what conflicts and reviews check against.

Because the wiki grows *with* the code, each page is verified by the same PR that creates the behavior — no big-bang backfill, and no drift to catch up on later.

## 4. Turn on the rails and maintain

Same as an existing repo — preserve the `wiki-ssot:fresh-context-guardrail` and `wiki-ssot:work-discovery` AGENTS markers, canonical `wiki:work` script, and structured PR metadata. A plain question about remaining work now starts with `bun run wiki:work`; after selecting active or ready work, use its printed selected-context command. Run `wiki:review-preflight` before publication, reconcile required bundles through a separate review context, then attach the locally-passed report to a Draft before marking it Ready. Keep the trusted Ready-only `wiki-review-attestation` job installed. For every Ready candidate that job succeeds only with either `required: false` or PASS for the exact current HEAD and bundle digest; deployment policy decides whether it is required for merge.

wiki-ssot assumes repository write/admin actors are trusted. A deployment may add branch protection, required workflows, CODEOWNERS, or administrator-bypass restrictions, but organization-security policy is outside the toolkit's product contract and is not configured or audited by these files.

See the [command reference](commands.md) and the [design](design.md). For a code-first bootstrap of an established codebase instead, see [adopt-existing-repo.md](adopt-existing-repo.md).
