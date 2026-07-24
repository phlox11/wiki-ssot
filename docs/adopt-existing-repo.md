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

## 2. Configure the policy and project seams

`.wiki/config.json` — your wiki's name, high-risk files, and explicit Fresh-context policy. Missing or malformed `freshContext` does not silently fall back to advisory:

```json
{
  "version": 1,
  "name": "your-repo",
  "highRisk": ["src/contracts/**", "src/db/**", "migrations/**"],
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

The `risk-based` selector requires review for matching trust-boundary files, affected invariants/conflicts, and current-page removals. Add project security, schema, and migration globs; omit `requiredWhen` to retain all-PR review. `["*"]` means any authenticated GitHub actor allowed by the remaining trust policy. The solo-maintainer default above permits the PR author to publish a required report created by a separate context-isolated session; it does not let the authoring session review itself. Set `requireDifferentActor: true` only after a second reviewer account or bot can publish the report, otherwise every applicable solo-authored PR will be intentionally unmergeable. Replace `["*"]` with explicit reviewer/service logins when your organization has a narrower trust boundary. Use `advisory` only as a deliberate migration state, and record when it will become `required`.

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
bun run wiki:doctor                    # integration seams must be present
bun run wiki:audit                     # must pass (no stale pages)
bun run typecheck && bun run test
```

Commit the wiki, `.wiki/`, and generated files together.

## 6. Turn on the rails

- Hooks activate on `bun install` (via the `prepare` script). Confirm a bad staged page blocks a commit.
- Keep the root `AGENTS.md` marker `wiki-ssot:fresh-context-guardrail`, structured PR `fresh_context` block, `wiki:review-preflight`/`wiki:review-check`/`wiki:doctor` scripts, and stable `wiki-review-attestation` workflow job. `wiki:doctor` detects accidental omission when adoption rewrites these files.
- CI: the workflows in `.github/workflows/` run code, structure/doctor, generated, impact, and Ready-only review-attestation checks. The attestation check skips Drafts, uses trusted base code/policy, and never executes PR-head code. Because the `pull_request` workflow definition is still part of the PR test-merge tree, protect `.github/workflows/checks.yml` with a ruleset-required workflow or CODEOWNERS plus required owner review.
- Remote boundary (required human step): configure GitHub branch protection/rulesets on `main`, require `code-check`, `wiki-structure`, `wiki-generated`, `wiki-impact`, and `wiki-review-attestation`, require the branch to be current, and disallow direct pushes. Branch protection cannot be guaranteed by local files or the CLI; without it, the jobs are not a merge guardrail.
- When renaming an already-required check, keep the old context required until the new context has succeeded on the candidate HEAD. Add the new context first, verify strict mode and every unrelated required context, then remove the old context and re-read protection. A temporarily blocked PR is acceptable; a temporarily weaker protection set is not.

## 7. Establish the reviewer channel

1. Before opening a PR, create the prospective structured metadata block with `fresh_context.verdict: PENDING`.
2. Run `wiki:review-preflight --json` for the exact base and metadata. `not-required` needs no report; `review-required` emits the exact bundle.
3. Give a required bundle plus primary-source access to a context-isolated reviewer or context-free sub-agent. Reconcile actionable findings locally and rerun preflight until `pass`.
4. After local PASS, open a Draft and publish its JSON report in a GitHub PR review (preferred) or comment after this marker:

   ```html
   <!-- wiki-ssot:fresh-context-attestation -->
   ```

   Follow it with a fenced `json` or `yaml` report. The report's `reviewer` must match the authenticated GitHub actor. With `requireDifferentActor: false`, that publisher may be the PR author, but the report must still come from the separate review session. The author-editable PR body cannot substitute for this envelope.
5. Mirror the required attested verdict, HEAD, bundle digest, reviewer, and evidence into the PR body's `fresh_context` block, then mark the Draft Ready. This author-editable mirror is checked against—but never substitutes for—the authenticated envelope. Drafts skip the expected attestation failure; Ready/merge requires either `required: false` or a current PASS.

## 8. Maintain

Every change follows `wiki/WORKFLOW.md`: search → read sources → change code + page + tests together → regenerate → `wiki:impact --enforce` → prospective PR metadata → preflight bundle and independent reconciliation when required → PR publication. `NEEDS_RECONCILE` or a new commit stays local and requires a new bundle/report before the PR is opened or updated.

See the [command reference](commands.md) and the [design](design.md).
