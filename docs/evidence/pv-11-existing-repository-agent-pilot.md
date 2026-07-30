# PV-11 existing-repository fresh-session agent pilot

This record preserves the existing-repository pilot as executed. The pilot ran
in a context-isolated child agent created with `fork_turns: none`; it received
the prompt below and no analysis or result from the PV-11 authoring context.

## Exact task prompt

> Adopt the wiki-ssot toolkit from /private/tmp/wiki-ssot-pv11 into this
> existing TypeScript service and follow the documented existing-repository
> bootstrap path to a green committed candidate. Preserve the repository's host
> instructions and tool responsibilities. Compile current billing and delivery
> knowledge from primary sources, map every maintained `src/**/*.ts` file to
> current authority or a concrete reasoned exclusion, and treat any
> implementation/contract disagreement as a conflict instead of choosing
> behavior. Follow the installed repository agent entrypoint after sync, use
> its discovery/search/context routing as applicable, do not present non-current
> material as current authority, and do not broaden bootstrap into a product
> behavior change. Run the documented deterministic gates and commit the
> bootstrap candidate, but do not push or open a PR.

## Repository binding and isolation

- Isolated task: `/root/pv11_author/pv11_existing_pilot`
- Target repository: `/private/tmp/pv11-pilot-existing`
- Target branch: `codex/pv11-existing-bootstrap`
- Existing-service base:
  `45d4bd6fb8dccfb2c7f43546950ba66573dc6179`
- Publisher repository: `/private/tmp/wiki-ssot-pv11`
- Publisher commit verified by the pilot:
  `75dbde7770187deaea22b6ae6935dc69693206fe`
- Bootstrap candidate:
  `d5f3087e0312d85dc8e419bd1f02ae2921a06310`
- The pilot wrote only the target repository and its external receipt directory.
  The PV-11 author wrote this versioned record after recovering the exact
  ordered command list from the isolated session.

## Exact ordered command receipt

The exit codes include expected conflicts and incidental failures.

1. `git status --short --branch` — exit 0
2. `git rev-parse HEAD` — exit 0
3. `git ls-files` — exit 0
4. `git rev-parse HEAD` — exit 0
5. `sed -n '1,240p' AGENTS.md && sed -n '1,240p' package.json && sed -n '1,240p' tsconfig.json` — exit 0
6. `for f in src/billing/calculate.ts src/billing/calculate.test.ts src/delivery/contract.ts src/delivery/send.ts src/generated/client.ts; do echo "===== $f"; sed -n '1,260p' "$f"; done` — exit 0
7. `rg --files | sed -n '1,260p'` — exit 0
8. `sed -n '1,320p' docs/adopt-existing-repo.md && sed -n '1,360p' kit/README.md && sed -n '1,320p' docs/commands.md` — exit 0
9. `git switch -c codex/pv11-existing-bootstrap` — exit 0
10. `bun scripts/wiki/kit-sync.ts --into /private/tmp/pv11-pilot-existing --dry-run` — exit 1
11. `bun scripts/wiki/kit-sync.ts --into /private/tmp/pv11-pilot-existing` — exit 1
12. `diff -u AGENTS.md AGENTS.md.kit-new` — exit 1
13. `bun /private/tmp/wiki-ssot-pv11/scripts/wiki/kit-sync.ts --into . --accept AGENTS.md` — exit 0
14. Exact multiline command — exit 0:

    ```sh
    KIT=/private/tmp/wiki-ssot-pv11/kit bun -e '
    const pkg = await Bun.file("package.json").json().catch(() => ({}));
    const add = await Bun.file(`${process.env.KIT}/package.kit.json`).json();
    const scripts = { ...pkg.scripts }, kept = [], added = [];
    for (const [name, value] of Object.entries(add.scripts)) {
      if (scripts[name] != null && scripts[name] !== value) kept.push(name);
      else { scripts[name] = value; added.push(name); }
    }
    await Bun.write("package.json", JSON.stringify({
      ...pkg,
      type: pkg.type ?? add.type,
      engines: { ...add.engines, ...pkg.engines },
      scripts,
      devDependencies: { ...add.devDependencies, ...pkg.devDependencies },
    }, null, 2) + "\n");
    console.log("added:", added.join(" ") || "(none)");
    console.log("kept yours:", kept.join(" ") || "(none)");
    '
    ```

15. `sed -n '1,260p' package.json && sed -n '1,260p' /private/tmp/wiki-ssot-pv11/kit/package.kit.json && sed -n '1,320p' .github/workflows/wiki-ssot.yml` — exit 1
16. `rg --files .github .husky .wiki wiki scripts | sort` — exit 0
17. `bun install` — exit 1
18. `bun install` — exit 0
19. `bun run wiki:generated` — exit 0
20. `sed -n '1,260p' wiki/index.md && sed -n '1,260p' wiki/current-status.md && rg -n '^kind: invariant$|^status: current$' wiki --glob '*.md'` — exit 0
21. `bun run wiki:search -- "billing delivery bootstrap"` — exit 0
22. `bun run wiki:context -- "billing delivery bootstrap"` — exit 0
23. `sed -n '1,360p' wiki/SCHEMA.md && sed -n '1,360p' wiki/WORKFLOW.md && sed -n '1,260p' .wiki/config.json && sed -n '1,220p' .wiki/coverage.json && sed -n '1,240p' scripts/wiki/inventories.ts` — exit 0
24. `rg -n "conflict_type:|origin: baseline|status: conflicted" docs scripts wiki --glob '*.md' --glob '*.ts'` — exit 0
25. `sed -n '110,210p' scripts/wiki/existing-repo-bootstrap.test.ts && sed -n '20,90p' docs/evidence/pv-09-existing-repository-bootstrap.md` — exit 0
26. `sed -n '210,430p' scripts/wiki/existing-repo-bootstrap.test.ts` — exit 0
27. `bun run wiki:generated` — exit 0
28. `sed -n '1,300p' wiki/index.md && sed -n '1,320p' wiki/current-status.md` — exit 0
29. `bun run wiki:search -- "billing delivery"` — exit 0
30. `bun run wiki:context -- "billing delivery"` — exit 0
31. `bun run wiki:context -- --conflict C-501` — exit 0
32. `bun run wiki:context -- --conflict C-501 --json` — exit 0
33. `bun run wiki:context -- "billing delivery" --json` — exit 0
34. `for f in src/billing/calculate.ts src/billing/calculate.test.ts src/delivery/contract.ts src/delivery/send.ts; do echo "===== $f"; sed -n '1,260p' "$f"; done` — exit 0
35. `bun run wiki:verify` — exit 0
36. `bun run wiki:lint` — exit 0
37. `bun run wiki:doctor` — exit 0
38. `bun run wiki:audit` — exit 0
39. `bun run wiki:impact -- --base 45d4bd6fb8dccfb2c7f43546950ba66573dc6179 --enforce` — exit 0
40. `bun run typecheck` — exit 0
41. `bun run test` — exit 0
42. `bun run wiki:work` — exit 0
43. `git status --short && git diff --stat && git diff -- AGENTS.md package.json tsconfig.json .wiki/config.json .wiki/coverage.json wiki/product/billing.md wiki/product/delivery.md wiki/conflicts/open/C-501.md` — exit 0
44. `sed -n '1,360p' .github/workflows/checks.yml && sed -n '1,300p' .github/workflows/wiki-audit.yml && sed -n '1,300p' .github/pull_request_template.md && sed -n '1,220p' .husky/pre-commit && sed -n '1,220p' .husky/pre-push` — exit 0
45. `sed -n '1,320p' .wiki/source-map.json && sed -n '1,320p' .wiki/conflict-map.json && sed -n '1,320p' .wiki/state.json && sed -n '1,300p' wiki/conflicts.md` — exit 0
46. `bun run wiki:conflicts -- C-501` — exit 0
47. `bun run wiki:generated -- --check` — exit 0
48. `git diff --check` — exit 0
49. `git add -A` — exit 0
50. `git status --short && git diff --cached --name-status && git diff --cached --stat` — exit 0
51. `bun run wiki:impact -- --base 45d4bd6fb8dccfb2c7f43546950ba66573dc6179 --enforce` — exit 0
52. `git commit -m "bootstrap wiki ssot"` — exit 0
53. `mkdir -p /private/tmp/pv11-pilot-existing-receipts` — exit 0
54. `rg -n "metadata|WIKI_PR_BODY" scripts/wiki/cli.ts | sed -n '1,240p'` — exit 0
55. `bun run wiki:impact -- --base 45d4bd6fb8dccfb2c7f43546950ba66573dc6179 --metadata /private/tmp/pv11-pilot-existing-receipts/pr-body.md --enforce` — exit 0
56. `git status --short --branch && git rev-parse HEAD` — exit 0
57. `bun run wiki:generated -- --check` — exit 0
58. `bun run wiki:verify` — exit 0
59. `git status --short` — exit 0
60. `bun run wiki:lint` — exit 0
61. `bun run wiki:doctor` — exit 0
62. `bun run wiki:audit` — exit 0
63. `bun run typecheck` — exit 0
64. `bun run test` — exit 0
65. `bun run wiki:review-preflight -- --base 45d4bd6fb8dccfb2c7f43546950ba66573dc6179 --metadata /private/tmp/pv11-pilot-existing-receipts/pr-body.md --output /private/tmp/pv11-pilot-existing-receipts/review-bundle --json` — exit 0
66. `git diff --name-status 45d4bd6fb8dccfb2c7f43546950ba66573dc6179..HEAD && git status --short --branch` — exit 0

Commands 10 and 11 are the expected non-destructive kit conflict result for
the existing `AGENTS.md`; command 12 confirms the side-by-side difference.
Command 15 failed only because it guessed a non-existent workflow filename
before command 16 enumerated the installed files. The first `bun install`
failed because the sandbox denied its temporary-file write; the approved retry
succeeded.

## Surfaced authority, conflicts, and sources

Before bootstrap pages existed, entrypoint-directed search/context returned no
wiki authority. The pilot therefore compiled the initial pages from the primary
repository sources rather than from old prose:

- `product/billing` — `current`, `observed`; sources
  `src/billing/calculate.ts` (`taxBasisPoints`, `totalWithTax`) and
  `src/billing/calculate.test.ts`.
- `product/delivery` — `current`, `observed`; sources
  `src/delivery/send.ts` (`send`) and `src/delivery/contract.ts`
  (`intendedDeliveryStatus`).
- `C-501` — `conflicted`, `observed`, medium implementation conflict with
  `origin: baseline`; sources `src/delivery/send.ts` and
  `src/delivery/contract.ts`; affected page `product/delivery`; acceptance
  requires an owner to select `accepted` or `queued` and align code, contract,
  page, and tests.

The exact post-generation query `billing delivery` returned only C-501 and the
two current product pages. Because no one page contained both query terms, this
is the PV-07-applicable scored partial-fallback case: it retained every relevant
authority/conflict and returned no unrelated page. Focused conflict context
then returned the conflict's exact sources and delivery page.

## Inspected and changed files

The ordered receipt records every inspected path, including all five starting
source files, host files, adoption playbooks, schema/workflow, policy, coverage,
engine fixture/evidence, generated maps, workflows, hooks, and every new page's
declared source.

The exact bootstrap diff from the immutable base contained:

- `.github/pull_request_template.md`
- `.github/workflows/checks.yml`
- `.github/workflows/wiki-audit.yml`
- `.gitignore`
- `.husky/pre-commit`
- `.husky/pre-push`
- `.wiki/config.json`
- `.wiki/conflict-map.json`
- `.wiki/coverage.json`
- `.wiki/kit-manifest.json`
- `.wiki/source-map.json`
- `.wiki/state.json`
- `AGENTS.md`
- `CLAUDE.md`
- `bun.lock`
- `package.json`
- `scripts/wiki/cli.ts`
- `scripts/wiki/core.ts`
- `scripts/wiki/fresh-context.test.ts`
- `scripts/wiki/github-attestation.ts`
- `scripts/wiki/inventories.ts`
- `scripts/wiki/wiki.test.ts`
- `scripts/wiki/work.test.ts`
- `tsconfig.json`
- `wiki/README.md`
- `wiki/SCHEMA.md`
- `wiki/WORKFLOW.md`
- `wiki/changelog.md`
- `wiki/conflicts.md`
- `wiki/conflicts/open/C-501.md`
- `wiki/current-status.md`
- `wiki/index.md`
- `wiki/product/billing.md`
- `wiki/product/delivery.md`
- `wiki/work-queue.md`

Every maintained `src/**/*.ts` file maps to a current page. The only uncovered
area, `src/generated/**`, is excluded with the concrete reason that the external
schema recreates it and it is not maintained by hand.

## Misses and unnecessary context

- Missed controlling current authority: none after bootstrap; both current
  pages and all four maintained sources were inspected.
- Missed relevant conflict: none; C-501 was surfaced through query context,
  conflict context, work discovery, audit, impact, and generated maps.
- Unnecessary wiki context after generation: none; all three query results were
  relevant to billing, delivery, or their disagreement.
- The attempted read of `.github/workflows/wiki-ssot.yml` was unnecessary and
  failed because that filename was not installed; enumeration immediately
  corrected it.
- The pilot did not resolve the `accepted`/`queued` decision and changed no
  delivery source. That is required restraint, not a miss.
- The isolated session was not cryptographically provable. The orchestrator's
  `fork_turns: none` dispatch and disjoint target directory are the procedural
  isolation evidence, consistent with the product's stated trust boundary.

## Deterministic gate result

For exact HEAD `d5f3087e0312d85dc8e419bd1f02ae2921a06310`,
the pilot and an authoring-context replay both recorded:

- generated freshness, verification, lint, doctor, audit, and impact: pass;
- audit: no stale pages and open conflict C-501 with its full acceptance
  contract;
- impact: affected pages `product/billing` and `product/delivery`, affected
  conflict C-501, no deterministic findings, no stale page, and no unmapped
  high-risk path;
- typecheck: pass;
- tests: 114 pass, 0 fail, including the host billing test;
- review preflight: `status: review-required`, `ready: false`, which is the
  correct stopping point for a pilot that may not self-attest;
- emitted bundle digest:
  `bf7b650276af60b386417770cf932cf9b8281a179d3122d0adda47b196e6b03b`;
- final worktree: clean.

The review-required result is not represented as a local PASS. The pilot obeyed
the installed contract by stopping after bundle creation instead of fabricating
an independent report.
