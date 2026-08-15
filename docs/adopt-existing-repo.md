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

For an unbootstrapped repository, the dry-run is still byte-preserving but intentionally exits 1 with `needs-reconcile` plus the missing current-page/coverage findings. `preview` with exit 0 means only that an already-bootstrapped mechanical plan is safe; only the non-dry run can report fully checked `ready`.

The command detects `adopt`, installs the kit, merges only Wiki-owned package entries, runs install/generation/checks, and reports the semantic reconciliation still required. It preserves host `test`, `typecheck`, `prepare`, `type`, dependencies, CI, and content outside the managed blocks in `AGENTS.md`, the PR template, and hooks.

Unsafe double edits and ambiguous legacy integrations return `needs-merge` without overwriting the project. Merge ordinary `.kit-new` files and use the printed `--accept` flag; repair managed files to contain one marked block. Then rerun the same command.

The new kit installs no active GitHub Actions workflow. Apply also never deletes a workflow merely because a newer kit stopped shipping it: version 1 and customized adopters keep their existing files until a human verifies that every host test/typecheck command has moved to version 2 `localChecks`. `wiki:doctor` then reports the remaining active Wiki workflow with the exact reconciliation order instead of overwriting it.

The kit ships only the toolkit. This repository's own wiki pages, conflicts, and proposals are instance content and are never part of it, so there is nothing to delete afterwards. [`kit/README.md`](../kit/README.md) documents the full file list, the kit-owned/seed split, and how to take a later upgrade without losing your configuration.

## 2. Configure the policy and project seams

`.wiki/config.json` — your wiki's name, high-risk files, exact project checks, local-status context, and explicit review policy:

```json
{
  "version": 2,
  "name": "your-repo",
  "publishesKit": false,
  "highRisk": ["src/contracts/**", "src/db/**", "migrations/**"],
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
      "changedFileRules": [
        {
          "glob": ".wiki/config.json",
          "reason": "Wiki enforcement policy itself is changing."
        },
        {
          "glob": "src/contracts/**",
          "reason": "Shared runtime contracts require independent reconciliation."
        },
        {
          "glob": "migrations/**",
          "reason": "Persistent data shape changes require independent reconciliation."
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

Copy the repository's actual workflow test/typecheck commands into `localChecks` as argv arrays; do not translate shell pipelines into one string. IDs must be unique and argv arrays non-empty. Add only review globs whose risk can be explained; every rule requires a concrete reason. `changedKitOwnedFiles` uses the installed kit manifest, so publisher-only measurements and historical fixtures are not selected merely because they live below `scripts/wiki/`. Version 2 requires the selector explicitly and has no implicit all-PR fallback.

Version 1 remains supported with its old meaning, including all-PR review when `requiredWhen` is omitted. If it requires an authenticated different reviewer actor, keep that policy or provide another external enforcement path: local-status mode proves exact report bindings and procedural context isolation, not GitHub actor separation.

`.wiki/coverage.json` — the code areas that must always map to a page (start narrow, widen later):

```json
{ "version": 1, "include": ["src/**/*.ts"], "exclusions": [] }
```

## 3. Bootstrap the initial pages from the code you have

Do **not** paste old prose docs in. Recompile current knowledge from primary sources — ideally with a coding agent, one area at a time:

1. Inventory the real surface: entry points, routes, schema/migrations, shared contracts, and the invariants your tests pin.
2. For each major area, write one small `wiki/<group>/<name>.md` page (see `wiki/SCHEMA.md`) whose `sources` point at the real files, describing **current** behavior only. Mark the few contract-routing anchors `context: always`; use `context: catalog` plus a concrete reason for broad implementation/test sets that must stay tracked without entering every compact read order.
3. Anything you cannot confirm, or where docs and code disagree in a way that could change behavior, becomes a `wiki/conflicts/open/**` page — not a guess.
4. Keep pages atomic and link-first; let code stay the detail and have the page link to it.

Map every file matched by `coverage.json` `include` to some page's `sources`, or add a reasoned exclusion. `wiki:lint` names every unmapped file, so you can drive this to zero.

Run `bun run wiki:scope -- --base <ref>` before finalizing broad declarations. It shows mandatory/catalog counts and bytes, reverse page/invariant/conflict fan-out, review-selection causes, and the delta from the merge base. The command does not impose a global size budget; it fails only when declaration intent or a cause is structurally invalid.

## 4. Optional: code-derived inventories

For always-current generated pages (route tables, schema lists), implement `scripts/wiki/inventories.ts` for your stack. Copy patterns from `kit/scripts/wiki/inventories.example.ts` in this repository — it is reference-only, is never delivered into yours, and so is nothing you have to clean up. Keep every manifest-owned `scripts/wiki/*.test.ts` regression suite and `scripts/wiki/test-fixtures/*.ts` helper delivered by the kit together: the dedicated Wiki tooling test discovers the suites deterministically, while the helpers are test-only dependencies and none depends on the host project.

## 5. Verify and go green

```sh
bun run wiki:generated                 # write bounded index, catalog/status, graph, queues, maps, inventories
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
- Keep the root `AGENTS.md` markers and affirmative provider-neutral routing clauses: index/current-status/invariant reading, no-query generic work discovery, human-work non-selection/reporting/handoff without assumed authority, selected-work context, topic search/context, and non-current authority labels. Also preserve canonical `wiki:work`, check, publish, review, and doctor scripts plus structured semantic PR metadata. `wiki:doctor` rejects marker-only, placeholder, command-name-only, or commonly negated route clauses when adoption rewrites these files; it does not interpret arbitrary prose.
- GitHub Actions is not required. Run the Wiki gate and configured project checks locally; GitHub receives only the exact result status/comment. A deployment may require `wiki-ssot/local` in branch protection.
- Trust boundary: wiki-ssot assumes repository write/admin actors are trusted. Branch protection, required workflows, CODEOWNERS, and administrator-bypass rules are optional deployment governance; the toolkit neither configures nor audits them.

## 7. Establish the reviewer channel

1. Before opening a PR, create the prospective structured semantic metadata block. Version 2 does not require a `fresh_context` mirror.
2. Run `wiki:review-preflight --json` for the exact base and metadata. `not-required` needs no report; `review-required` emits the exact bundle.
3. Give a required bundle plus primary-source access to a context-isolated reviewer or context-free sub-agent. Disposition every returned finding locally — fix what this candidate broke or declared, track a pre-existing mismatch or undecidable intent in an open conflict, record a named follow-up for an out-of-scope defect — and rerun preflight until `pass`. Adoption is where this matters most: a first wiki PR touches everything, so treat "already tracked" as a normal outcome instead of trying to make the whole repository correct in one change.
4. Run `wiki:check --base <ref> --metadata <file> [--report <file>] --output <result.json>` on the committed candidate. It executes the canonical deterministic gate and every configured `localChecks` argv.
5. Open or update the PR, then run `wiki:publish -- --result <result.json> --pr <number>`. It rejects a stale local or remote SHA and publishes the configured commit status plus one diagnostic comment.

## 8. Maintain

Every change follows `wiki/WORKFLOW.md`. A generic remaining-work request starts with no-query `wiki:work`; human-exclusive work is reported and handed off, while a selected recommended agent/either item proceeds through its printed `wiki:context -- --work <ID>` command. Topic-specific work still starts with search/context. From there: read sources → change code + page + tests together → regenerate → prospective PR metadata → preflight bundle and independent reconciliation when required → exact local check → PR publication → exact commit status. `NEEDS_RECONCILE` or a new commit stays local and requires a new bundle, report, result, and status.

For an existing version 1 installation, run `apply.ts --dry-run`, then `apply.ts`; neither command rewrites project-owned `.wiki/config.json`, Wiki pages, or an existing workflow. Existing source declarations without `context` retain their historical `always` meaning, and apply summarizes them in one non-blocking warning rather than generating per-page migration work. In the explicit migration PR, copy each actual host check argv from the old workflow into version 2 config, run the warning's `wiki:scope -- --base <ref>` command, and classify only the broad declarations you have actually reviewed; do not mechanically turn every glob into catalog. Include the intended workflow deletion only after its host checks are represented locally. The candidate's doctor and local gate must pass with no active legacy Wiki workflow. Publish that exact PR HEAD status, then replace branch protection before merging. A first upgrade PR whose base engine still requires the legacy PR-body mirror may include it once; the version 2 candidate ignores it, and subsequent PRs omit it.

After upgrade, verify that `wiki:generated -- --check`, `wiki:lint`, `wiki:audit`, and `wiki:doctor` pass and commit the new generated catalog/graph with the upgraded toolkit. No record-conversion command is required: the catalog and graph are projections over the existing Wiki records, while Git remains the ordinary history of record.

See the [command reference](commands.md) and the [design](design.md).
