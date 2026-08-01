# Adopt in an existing repository

Goal: stand up an enforced SSOT wiki over a codebase that already exists, then keep it in sync. This is the "bootstrap from the code you already have" path.

The repository carries a deterministic end-to-end reproduction of this path,
including multiple code areas, ambiguity handling, initial review disposition,
and a later upgrade: [PV-09 existing-repository bootstrap evidence](./evidence/pv-09-existing-repository-bootstrap.md).

## 0. Prerequisites

- Bun ≥ 1.1 and git.
- A clean working tree and a known base commit.

## 1. Run the unified apply loop

The distribution lives in [`kit/`](../kit/README.md). From a checkout of this repository:

```sh
bun /path/to/WikiSsot/scripts/wiki/apply.ts --into /path/to/your-repo --dry-run
bun /path/to/WikiSsot/scripts/wiki/apply.ts --into /path/to/your-repo
```

The command detects `adopt`, installs the kit, merges only Wiki-owned package entries, runs install/generation/checks, and reports the semantic reconciliation still required. It preserves host `test`, `typecheck`, `prepare`, `type`, dependencies, CI, and content outside the managed blocks in `AGENTS.md`, the PR template, and hooks.

Unsafe double edits and ambiguous legacy integrations return `needs-merge` without overwriting the project. Merge ordinary `.kit-new` files and use the printed `--accept` flag; repair managed files to contain one marked block. Then rerun the same command.

Wiki jobs live in the dedicated `.github/workflows/wiki-ssot.yml`; existing build/test workflows remain independent.

The kit ships only the toolkit. This repository's own wiki pages, conflicts, and proposals are instance content and are never part of it, so there is nothing to delete afterwards. [`kit/README.md`](../kit/README.md) documents the full file list, the kit-owned/seed split, and how to take a later upgrade without losing your configuration.

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

The `risk-based` selector requires review for matching trust-boundary files, affected invariants/conflicts, and current-page removals. Add project security, schema, and migration globs; omit `requiredWhen` to retain all-PR review. `["*"]` means any authenticated GitHub actor allowed by the remaining trust policy. The solo-maintainer default above permits the PR author to publish a required report created by a separate context-isolated session; it does not let the authoring session review itself. Set `requireDifferentActor: true` only after a second reviewer account or bot can publish the report; without that channel, applicable solo-authored PRs fail the attestation job and are blocked from merge only when deployment policy makes that job required. Replace `["*"]` with explicit reviewer/service logins when your organization has a narrower trust boundary. Use `advisory` only as a deliberate migration state, and record when it will become `required`.

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

For always-current generated pages (route tables, schema lists), implement `scripts/wiki/inventories.ts` for your stack. Copy patterns from `kit/scripts/wiki/inventories.example.ts` in this repository — it is reference-only, is never delivered into yours, and so is nothing you have to clean up. Keep `scripts/wiki/wiki.test.ts`, `scripts/wiki/work.test.ts`, and `scripts/wiki/fresh-context.test.ts`: they are the engine's own regression suites (run by the dedicated Wiki tooling test) and depend on no host project.

## 5. Verify and go green

```sh
bun run wiki:generated                 # write index, work queue, maps, inventories
bun run wiki:verify                    # record source hashes for all current pages
bun run wiki:lint                      # must pass
bun run wiki:doctor                    # integration seams must be present
bun run wiki:audit                     # must pass (no stale pages)
bun run wiki:tooling:typecheck && bun run wiki:tooling:test
bun /path/to/WikiSsot/scripts/wiki/apply.ts --into .  # must report ready
```

Commit the wiki, `.wiki/`, and generated files together.

## 6. Turn on the rails

- The apply command installs Husky explicitly without replacing the host `prepare` script. Confirm a bad staged page blocks a commit.
- Keep the root `AGENTS.md` markers and affirmative provider-neutral routing clauses: index/current-status/invariant reading, no-query generic work discovery, selected-work context, topic search/context, and non-current authority labels. Also preserve canonical `wiki:work` and review/doctor scripts, the structured PR `fresh_context` block, and the stable `wiki-review-attestation` workflow job. `wiki:doctor` rejects marker-only, placeholder, command-name-only, or commonly negated route clauses when adoption rewrites these files; it does not interpret arbitrary prose.
- CI: the workflows in `.github/workflows/` run code, structure/doctor, generated, impact, and Ready-only review-attestation checks. The attestation check skips Drafts, uses trusted base code/policy, and never executes PR-head code.
- Trust boundary: wiki-ssot assumes repository write/admin actors are trusted. Branch protection, required workflows, CODEOWNERS, and administrator-bypass rules are optional deployment governance; the toolkit neither configures nor audits them.

## 7. Establish the reviewer channel

1. Before opening a PR, create the prospective structured metadata block with `fresh_context.verdict: PENDING`.
2. Run `wiki:review-preflight --json` for the exact base and metadata. `not-required` needs no report; `review-required` emits the exact bundle.
3. Give a required bundle plus primary-source access to a context-isolated reviewer or context-free sub-agent. Disposition every returned finding locally — fix what this candidate broke or declared, track a pre-existing mismatch or undecidable intent in an open conflict, record a named follow-up for an out-of-scope defect — and rerun preflight until `pass`. Adoption is where this matters most: a first wiki PR touches everything, so treat "already tracked" as a normal outcome instead of trying to make the whole repository correct in one change.
4. After local PASS, open a Draft and publish its JSON report in a GitHub PR review (preferred) or comment after this marker:

   ```html
   <!-- wiki-ssot:fresh-context-attestation -->
   ```

   Follow it with a fenced `json` or `yaml` report. The report's `reviewer` must match the authenticated GitHub actor. With `requireDifferentActor: false`, that publisher may be the PR author, but the report must still come from the separate review session. The author-editable PR body cannot substitute for this envelope.
5. Mirror the required attested verdict, HEAD, bundle digest, reviewer, and evidence into the PR body's `fresh_context` block, then mark the Draft Ready. This author-editable mirror is checked against—but never substitutes for—the authenticated envelope. Drafts skip the expected attestation failure; the Ready-PR job succeeds only with either `required: false` or a current PASS. Deployment policy decides whether that job is required for merge.

## 8. Maintain

Every change follows `wiki/WORKFLOW.md`. A generic remaining-work request starts with no-query `wiki:work`, then the selected item's printed `wiki:context -- --work <ID>` command; topic-specific work still starts with search/context. From there: read sources → change code + page + tests together → regenerate → `wiki:impact --enforce` → prospective PR metadata → preflight bundle and independent reconciliation when required → PR publication. `NEEDS_RECONCILE` or a new commit stays local and requires a new bundle/report before the PR is opened or updated.

See the [command reference](commands.md) and the [design](design.md).
