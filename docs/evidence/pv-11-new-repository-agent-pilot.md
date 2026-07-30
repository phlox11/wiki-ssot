# PV-11 new-repository fresh-session agent pilot

This record preserves the new-repository pilot as executed. The pilot ran in a
context-isolated child agent created with `fork_turns: none`; it received the
prompt below and no analysis or result from the PV-11 authoring context.

## Exact task prompt

> Adopt the wiki-ssot toolkit from /private/tmp/wiki-ssot-pv11 into this empty
> Git repository and follow the documented new-repository path to a green
> committed adoption baseline. Then, as a separate candidate based on that
> adoption commit, implement a deterministic greeting feature whose public
> behavior is `greet(name) -> Hello, <name>!`. Keep production code, executable
> test, current wiki contract, coverage, generated artifacts, and verification
> evidence together. Follow the installed repository agent entrypoint after
> sync, use its discovery/search/context routing as applicable, do not present
> non-current material as current authority, and do not invent through
> ambiguity. Run the documented deterministic gates and commit the feature
> candidate, but do not push or open a PR.

## Repository binding and isolation

- Isolated task: `/root/pv11_author/pv11_new_pilot`
- Target repository: `/private/tmp/pv11-pilot-new`
- Target branch: `codex/pv11-new-pilot`
- Empty starting base: `12a437f7e1ea4c968fa60fdd957321e4fb5414e5`
- Publisher repository: `/private/tmp/wiki-ssot-pv11`
- Publisher commit verified by the pilot:
  `75dbde7770187deaea22b6ae6935dc69693206fe`
- Green adoption commit:
  `9806c8fcc1f90f290cd0ac0d17c31f2feac7f041`
- Feature candidate:
  `71a27472a513addac51293b2ac0046818130fc18`
- The pilot wrote only the target repository and its external receipt directory.
  The PV-11 author wrote this versioned record after recovering the exact
  ordered command list from the isolated session.

## Exact ordered command receipt

The exit codes include failures; none are removed from the record.

1. `git rev-parse HEAD` — exit 0
2. `git status --short --branch` — exit 0
3. `git rev-parse HEAD` — exit 0
4. `git ls-files` — exit 0
5. `rg --files -g 'AGENTS.md' -g 'README*' -g '*adopt*' -g 'docs/**' -g 'scripts/**' -g 'templates/**' | sort` — exit 0
6. `sed -n '1,260p' docs/adopt-new-repo.md` — exit 0
7. `sed -n '1,320p' kit/README.md` — exit 0
8. `bun scripts/wiki/kit-sync.ts --into /private/tmp/pv11-pilot-new --dry-run` — exit 0
9. `bun scripts/wiki/kit-sync.ts --into /private/tmp/pv11-pilot-new` — exit 0
10. `sed -n '1,280p' AGENTS.md` — exit 0
11. `rg --files wiki | sort` — exit 0
12. `sed -n '1,240p' kit/package.kit.json` — exit 0
13. `sed -n '1,240p' .wiki/config.json && sed -n '1,160p' .wiki/coverage.json && sed -n '1,160p' tsconfig.json` — exit 0
14. `bun install` — exit 1
15. `bun install` — exit 0
16. `bun run wiki:generated` — exit 0
17. `sed -n '1,240p' wiki/index.md && sed -n '1,240p' wiki/current-status.md` — exit 0
18. `bun run wiki:verify` — exit 0
19. `bun run wiki:lint` — exit 0
20. `bun run wiki:doctor` — exit 0
21. `bun run wiki:work` — exit 0
22. `bun run typecheck` — exit 0
23. `bun run test` — exit 0
24. `bun run wiki:audit` — exit 0
25. `git status --short && git diff --stat && git diff -- .wiki/config.json package.json` — exit 0
26. `git switch -c codex/pv11-new-pilot` — exit 0
27. `git add .github .gitignore .husky .wiki AGENTS.md CLAUDE.md bun.lock package.json scripts tsconfig.json wiki` — exit 0
28. `git diff --cached --name-status && git status --short --branch` — exit 0
29. `git commit -m "chore: adopt wiki-ssot toolkit"` — exit 0
30. `git rev-parse HEAD && git status --short --branch` — exit 0
31. `bun run wiki:search -- "deterministic greeting greet Hello name"` — exit 0
32. `bun run wiki:context -- "deterministic greeting greet Hello name"` — exit 0
33. `sed -n '1,320p' wiki/SCHEMA.md` — exit 0
34. `sed -n '1,160p' wiki/features/greeting.md && sed -n '1,120p' src/greeting.ts && sed -n '1,160p' test/greeting.test.ts && sed -n '1,120p' .wiki/coverage.json && sed -n '1,160p' package.json && sed -n '1,160p' tsconfig.json` — exit 0
35. `bun run wiki:generated` — exit 0
36. `sed -n '1,240p' wiki/index.md && sed -n '1,240p' wiki/current-status.md && sed -n '1,220p' wiki/conflicts.md && sed -n '1,240p' .wiki/source-map.json` — exit 0
37. `bun run wiki:search -- "deterministic greeting greet Hello name"` — exit 0
38. `bun run wiki:context -- "deterministic greeting greet Hello name"` — exit 0
39. `bun run wiki:verify` — exit 0
40. `bun run wiki:audit` — exit 0
41. `bun run wiki:lint` — exit 0
42. `bun run wiki:doctor` — exit 0
43. `bun run wiki:impact -- --base 9806c8fcc1f90f290cd0ac0d17c31f2feac7f041 --enforce` — exit 0
44. `bun run typecheck` — exit 0
45. `bun run test` — exit 0
46. `sed -n '1,280p' .github/pull_request_template.md` — exit 0
47. `git status --short && git diff --name-status && git diff --stat` — exit 0
48. `git add .wiki/coverage.json .wiki/source-map.json .wiki/state.json package.json tsconfig.json wiki/current-status.md wiki/index.md src/greeting.ts test/greeting.test.ts wiki/features/greeting.md` — exit 0
49. `git commit -m "feat: add deterministic greeting"` — exit 0
50. `bun run wiki:impact -- --base 9806c8fcc1f90f290cd0ac0d17c31f2feac7f041 --enforce` — exit 0
51. `bun run wiki:generated` — exit 0
52. `bun run wiki:verify` — exit 0
53. `bun run wiki:audit` — exit 0
54. `bun run wiki:lint` — exit 0
55. `bun run wiki:doctor` — exit 0
56. `bun run typecheck` — exit 0
57. `bun run test` — exit 0
58. `git status --short --branch && git rev-parse HEAD && git diff --name-status 9806c8fcc1f90f290cd0ac0d17c31f2feac7f041..HEAD` — exit 0
59. `bun run wiki:review-preflight -- --base 9806c8fcc1f90f290cd0ac0d17c31f2feac7f041 --metadata /private/tmp/pv11-pilot-new-receipts/pr-body.md --output /private/tmp/pv11-pilot-new-receipts/review-bundle --json` — exit 0
60. `rg --files /private/tmp/pv11-pilot-new-receipts/review-bundle | sort && sed -n '1,280p' /private/tmp/pv11-pilot-new-receipts/review-bundle/sources.json && sed -n '1,280p' /private/tmp/pv11-pilot-new-receipts/review-bundle/manifest.json` — exit 1
61. `find /private/tmp/pv11-pilot-new-receipts -maxdepth 3 -type f -print | sort` — exit 0
62. `git log --oneline --decorate --max-count=3 && git status --short --branch && git diff --check 9806c8fcc1f90f290cd0ac0d17c31f2feac7f041..HEAD` — exit 0

The first `bun install` failed because the sandbox denied its temporary-file
write; the approved retry succeeded without dependency drift. Command 60 failed
because the risk selector returned `not-required`, so preflight correctly did
not materialize the requested review-bundle directory.

## Surfaced authority, conflicts, and sources

Before the first feature existed, the installed entrypoint led the pilot through
`wiki/index.md`, `wiki/current-status.md`, the no-query `wiki:work` command, and
topic search/context. There were no current pages, invariants, proposals, work
items, or conflicts to surface.

After the feature was written and generated:

- `wiki:search` returned only `features/greeting`, labelled `current`, for the
  exact query `deterministic greeting greet Hello name`.
- `wiki:context` returned that page and no non-current page or conflict.
- Direct inspection of `wiki/features/greeting.md` exposed both declared
  sources: `src/greeting.ts` (`greet`) and `test/greeting.test.ts`.
- Both declared sources were inspected. There was no controlling invariant or
  open conflict in the target repository.

This is the PV-07-applicable search evidence for this pilot: the all-term query
had one complete current-page match, retained that authority, and surfaced zero
irrelevant pages.

## Inspected and changed files

The ordered receipt records every inspected path. The controlling inspected
inputs were the publisher's `docs/adopt-new-repo.md`, `kit/README.md`, and
`kit/package.kit.json`; then the installed `AGENTS.md`, wiki entrypoints,
`wiki/SCHEMA.md`, policy, coverage, generated maps, and the feature page's two
sources.

The exact feature-candidate change from the adoption commit was:

- `.wiki/coverage.json`
- `.wiki/source-map.json`
- `.wiki/state.json`
- `package.json`
- `src/greeting.ts`
- `test/greeting.test.ts`
- `tsconfig.json`
- `wiki/current-status.md`
- `wiki/features/greeting.md`
- `wiki/index.md`

## Misses and unnecessary context

- Missed controlling current authority: none. The repository had no authority
  for the not-yet-created feature; after creation the only current feature page
  and both of its sources were found and inspected.
- Missed relevant conflict: none existed.
- Unnecessary wiki context after creation: none. Search/context returned only
  the feature page.
- The failed bundle-directory inspection was a receipt-handling assumption,
  not a product or gate failure; the exact failed command remains above.
- The isolated session was not cryptographically provable. The orchestrator's
  `fork_turns: none` dispatch and disjoint target directory are the procedural
  isolation evidence, consistent with the product's stated trust boundary.

## Deterministic gate result

The adoption baseline passed generation, verification, lint, doctor, no-query
work discovery, typecheck, the shipped tests, and audit before it was committed.

For the exact feature HEAD, the pilot and an authoring-context replay both
recorded:

- generated freshness, lint, doctor, audit, and impact: pass;
- impact: one affected page (`features/greeting`), no conflict, no stale page,
  no unmapped high-risk path, and the ten changed files listed above;
- typecheck: pass;
- tests: 114 pass, 0 fail, including the greeting test;
- review preflight: `status: not-required`, `ready: true`;
- independently replayed bundle digest:
  `8f8597f98fbb30698192dd2148bf4a0a60e0fed0bddab38b16a497561cd544f5`;
- final worktree: clean.
