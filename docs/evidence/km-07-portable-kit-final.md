# KM-07 portable kit final exit evidence

Status: **PASS**.

Pinned KM-00 baseline: `2f8629fdd37bbd4001ffc07e65964fcead1d16d4`.
Measured source-tree digest: `af03f8bab47bba727710c5cf0a88f6c0ac419e1e00abdf315613d56cefd5b69c`; rendered manifest digest: `dff1e635a8f6abd054c063c4211d58113f0e77442f111ff3526b501bfed48c08`.

## Baseline versus current

Portable TypeScript tooling is 9834 lines/521052 bytes at KM-00 and 13169 lines/649448 bytes now; exact generated kit payload has 30 versus 78 paths.

| Module | KM-00 lines | Current lines | KM-00 bytes | Current bytes | Contract area |
|---|---:|---:|---:|---:|---|
| `scripts/wiki/cli-discovery-handlers.ts` | 0 | 391 | 0 | 20637 | production |
| `scripts/wiki/cli-generation-handlers.ts` | 0 | 63 | 0 | 3216 | production |
| `scripts/wiki/cli-handlers.test.ts` | 0 | 68 | 0 | 3034 | regression |
| `scripts/wiki/cli-render.ts` | 0 | 349 | 0 | 15291 | production |
| `scripts/wiki/cli-review-handlers.ts` | 0 | 200 | 0 | 10896 | production |
| `scripts/wiki/cli-runtime.ts` | 0 | 94 | 0 | 3399 | production |
| `scripts/wiki/cli-validation-handlers.ts` | 0 | 95 | 0 | 5020 | production |
| `scripts/wiki/cli.ts` | 1277 | 139 | 58274 | 5279 | production |
| `scripts/wiki/context.test.ts` | 0 | 124 | 0 | 5489 | regression |
| `scripts/wiki/context.ts` | 0 | 534 | 0 | 20875 | production |
| `scripts/wiki/core-facade.test.ts` | 0 | 98 | 0 | 5209 | regression |
| `scripts/wiki/core.ts` | 4144 | 561 | 230066 | 17345 | production |
| `scripts/wiki/discovery.test.ts` | 0 | 126 | 0 | 5415 | regression |
| `scripts/wiki/discovery.ts` | 0 | 178 | 0 | 6624 | production |
| `scripts/wiki/fresh-context-github.test.ts` | 0 | 181 | 0 | 5868 | regression |
| `scripts/wiki/fresh-context-integration.test.ts` | 0 | 407 | 0 | 20029 | regression |
| `scripts/wiki/fresh-context-manifest.test.ts` | 0 | 705 | 0 | 46386 | regression |
| `scripts/wiki/fresh-context-preflight.test.ts` | 0 | 509 | 0 | 18742 | regression |
| `scripts/wiki/fresh-context-report.test.ts` | 0 | 378 | 0 | 18789 | regression |
| `scripts/wiki/fresh-context.test.ts` | 2400 | 0 | 126643 | 0 | regression |
| `scripts/wiki/generated-views.test.ts` | 0 | 78 | 0 | 2737 | regression |
| `scripts/wiki/generated-views.ts` | 0 | 190 | 0 | 9897 | production |
| `scripts/wiki/github-attestation.ts` | 189 | 189 | 10013 | 10013 | production |
| `scripts/wiki/impact.test.ts` | 0 | 155 | 0 | 5972 | regression |
| `scripts/wiki/impact.ts` | 0 | 370 | 0 | 24018 | production |
| `scripts/wiki/kit-growth-guard.test.ts` | 0 | 92 | 0 | 4363 | regression |
| `scripts/wiki/kit-growth-guard.ts` | 0 | 388 | 0 | 16494 | production |
| `scripts/wiki/kit-packaging.test.ts` | 0 | 415 | 0 | 18169 | regression |
| `scripts/wiki/kit-packaging.ts` | 0 | 418 | 0 | 25603 | production |
| `scripts/wiki/model.ts` | 0 | 78 | 0 | 2397 | production |
| `scripts/wiki/page-validation.test.ts` | 0 | 67 | 0 | 3152 | regression |
| `scripts/wiki/page-validation.ts` | 0 | 253 | 0 | 16927 | production |
| `scripts/wiki/repository-view.test.ts` | 0 | 50 | 0 | 2437 | regression |
| `scripts/wiki/repository-view.ts` | 0 | 60 | 0 | 2256 | production |
| `scripts/wiki/review-attestation.test.ts` | 0 | 104 | 0 | 3793 | regression |
| `scripts/wiki/review-attestation.ts` | 0 | 485 | 0 | 24463 | production |
| `scripts/wiki/review-bundle.test.ts` | 0 | 130 | 0 | 5774 | regression |
| `scripts/wiki/review-bundle.ts` | 0 | 976 | 0 | 67471 | production |
| `scripts/wiki/serialization.test.ts` | 0 | 15 | 0 | 649 | regression |
| `scripts/wiki/serialization.ts` | 0 | 22 | 0 | 751 | production |
| `scripts/wiki/test-fixtures/fresh-context.ts` | 0 | 609 | 0 | 26401 | test-fixture |
| `scripts/wiki/test-fixtures/wiki.ts` | 0 | 137 | 0 | 3804 | test-fixture |
| `scripts/wiki/test-fixtures/work.ts` | 0 | 191 | 0 | 6364 | test-fixture |
| `scripts/wiki/test-runner.test.ts` | 0 | 83 | 0 | 3396 | regression |
| `scripts/wiki/test-runner.ts` | 47 | 57 | 1767 | 2348 | test-infrastructure |
| `scripts/wiki/verification.test.ts` | 0 | 116 | 0 | 5178 | regression |
| `scripts/wiki/verification.ts` | 0 | 426 | 0 | 22802 | production |
| `scripts/wiki/wiki-coverage.test.ts` | 0 | 101 | 0 | 4599 | regression |
| `scripts/wiki/wiki-generated-data.test.ts` | 0 | 71 | 0 | 2329 | regression |
| `scripts/wiki/wiki-impact-conflicts.test.ts` | 0 | 462 | 0 | 27371 | regression |
| `scripts/wiki/wiki-pages.test.ts` | 0 | 163 | 0 | 6742 | regression |
| `scripts/wiki/wiki-repository-hooks.test.ts` | 0 | 80 | 0 | 2561 | regression |
| `scripts/wiki/wiki.test.ts` | 745 | 0 | 41668 | 0 | regression |
| `scripts/wiki/work-selected-context.test.ts` | 0 | 316 | 0 | 18503 | regression |
| `scripts/wiki/work-topic-context.test.ts` | 0 | 337 | 0 | 17350 | regression |
| `scripts/wiki/work-validation.test.ts` | 0 | 127 | 0 | 5124 | regression |
| `scripts/wiki/work-validation.ts` | 0 | 158 | 0 | 9697 | production |
| `scripts/wiki/work.test.ts` | 1032 | 0 | 52621 | 0 | regression |

## CLI and bounded exception

- CLI entrypoint: 139 LF lines (thin/pass; bound 250).
- review-bundle exception: 976 lines / 67471 bytes; within the 1,000-line/68 KiB cap.
- Disposition: Retain the sole bounded exception for the fail-closed exact-revision bundle contract; do not split speculatively. Growth past 1,000 LF lines or 68 KiB requires a proven seam or explicit owner approval.

## Payload and test ownership

- Exact generated kit payload: 30 paths/10856 lines/575225 bytes → 78 paths/14386 lines/711464 bytes.
- Manifest-addressed entries: 29 at KM-00 → 77 now.
- Portable TypeScript tooling: 9834 lines/521052 bytes → 13169 lines/649448 bytes.
- Portable payload bytes grew because KM-06 preserves split regression coverage and KM-07 ships the guard plus its regression test; this is measured rather than hidden.
- Generated kit payload path count grew with preserved/split test fixtures and the shipped growth guard; adoption and upgrade assertions cover the added files.
- review-bundle.ts retains the single fail-closed exact-revision bundle exception; it remains bounded by 1,000 LF lines and 68 KiB (69,632 UTF-8 bytes).

| Test suite | Named owner | Tests | Contract area |
|---|---|---:|---|
| `scripts/wiki/cli-handlers.test.ts` | CLI contract | 4 | regression |
| `scripts/wiki/context.test.ts` | context contract | 3 | regression |
| `scripts/wiki/core-facade.test.ts` | core-facade contract | 4 | regression |
| `scripts/wiki/discovery.test.ts` | discovery contract | 4 | regression |
| `scripts/wiki/fresh-context-github.test.ts` | fresh-context review contract | 5 | regression |
| `scripts/wiki/fresh-context-integration.test.ts` | fresh-context review contract | 21 | regression |
| `scripts/wiki/fresh-context-manifest.test.ts` | fresh-context review contract | 18 | regression |
| `scripts/wiki/fresh-context-preflight.test.ts` | fresh-context review contract | 17 | regression |
| `scripts/wiki/fresh-context-report.test.ts` | fresh-context review contract | 20 | regression |
| `scripts/wiki/generated-views.test.ts` | generated-views contract | 3 | regression |
| `scripts/wiki/impact.test.ts` | impact contract | 4 | regression |
| `scripts/wiki/kit-growth-guard.test.ts` | portable module growth guard contract | 7 | regression |
| `scripts/wiki/kit-packaging.test.ts` | portable kit packaging contract | 33 | regression |
| `scripts/wiki/page-validation.test.ts` | page-validation contract | 5 | regression |
| `scripts/wiki/repository-view.test.ts` | repository-view contract | 4 | regression |
| `scripts/wiki/review-attestation.test.ts` | review-attestation contract | 4 | regression |
| `scripts/wiki/review-bundle.test.ts` | review-bundle contract | 3 | regression |
| `scripts/wiki/serialization.test.ts` | serialization contract | 2 | regression |
| `scripts/wiki/test-runner.test.ts` | portable test discovery contract | 6 | regression |
| `scripts/wiki/verification.test.ts` | verification contract | 5 | regression |
| `scripts/wiki/wiki-coverage.test.ts` | Wiki engine contract | 5 | regression |
| `scripts/wiki/wiki-generated-data.test.ts` | Wiki engine contract | 3 | regression |
| `scripts/wiki/wiki-impact-conflicts.test.ts` | Wiki engine contract | 18 | regression |
| `scripts/wiki/wiki-pages.test.ts` | Wiki engine contract | 10 | regression |
| `scripts/wiki/wiki-repository-hooks.test.ts` | Wiki engine contract | 1 | regression |
| `scripts/wiki/work-selected-context.test.ts` | work/context contract | 8 | regression |
| `scripts/wiki/work-topic-context.test.ts` | work/context contract | 10 | regression |
| `scripts/wiki/work-validation.test.ts` | work/context contract | 5 | regression |

## Changed-file breadth

- Since `2f8629fdd37bbd4001ffc07e65964fcead1d16d4`: 143 files; +31042/-16595 LF lines; digest `474a66b5a7da92fb6374053e8e68ba1d0ee48c0c6a34327ec0b150b177d277dd`.
| Path | Status | Δ lines | Δ bytes |
|---|---|---:|---:|
| `.github/workflows/wiki-ssot.yml` | M | +1 | +40 |
| `.wiki/source-map.json` | M | +80 | +2120 |
| `.wiki/state.json` | M | +90 | +10131 |
| `docs/adopt-existing-repo.md` | M | +0 | +78 |
| `docs/adopt-new-repo.md` | M | +0 | +102 |
| `docs/evidence/km-00-portable-kit-baseline.json` | A | +4153 | +119420 |
| `docs/evidence/km-00-portable-kit-baseline.md` | A | +30 | +1282 |
| `kit/files/.github/workflows/wiki-ssot.yml` | M | +1 | +40 |
| `kit/files/.wiki/kit-manifest.json` | M | +192 | +7697 |
| `kit/files/scripts/wiki/cli-discovery-handlers.ts` | A | +391 | +20637 |
| `kit/files/scripts/wiki/cli-generation-handlers.ts` | A | +63 | +3216 |
| `kit/files/scripts/wiki/cli-handlers.test.ts` | A | +68 | +3034 |
| `kit/files/scripts/wiki/cli-render.ts` | A | +349 | +15291 |
| `kit/files/scripts/wiki/cli-review-handlers.ts` | A | +200 | +10896 |
| `kit/files/scripts/wiki/cli-runtime.ts` | A | +94 | +3399 |
| `kit/files/scripts/wiki/cli-validation-handlers.ts` | A | +95 | +5020 |
| `kit/files/scripts/wiki/cli.ts` | M | -1138 | -52995 |
| `kit/files/scripts/wiki/context.test.ts` | A | +124 | +5489 |
| `kit/files/scripts/wiki/context.ts` | A | +534 | +20875 |
| `kit/files/scripts/wiki/core-facade.test.ts` | A | +98 | +5209 |
| `kit/files/scripts/wiki/core.ts` | M | -3583 | -212721 |
| `kit/files/scripts/wiki/discovery.test.ts` | A | +126 | +5415 |
| `kit/files/scripts/wiki/discovery.ts` | A | +178 | +6624 |
| `kit/files/scripts/wiki/fresh-context-github.test.ts` | A | +181 | +5868 |
| `kit/files/scripts/wiki/fresh-context-integration.test.ts` | A | +407 | +20029 |
| `kit/files/scripts/wiki/fresh-context-manifest.test.ts` | A | +705 | +46386 |
| `kit/files/scripts/wiki/fresh-context-preflight.test.ts` | A | +509 | +18742 |
| `kit/files/scripts/wiki/fresh-context-report.test.ts` | A | +378 | +18789 |
| `kit/files/scripts/wiki/fresh-context.test.ts` | D | -2400 | -126643 |
| `kit/files/scripts/wiki/generated-views.test.ts` | A | +78 | +2737 |
| `kit/files/scripts/wiki/generated-views.ts` | A | +190 | +9897 |
| `kit/files/scripts/wiki/impact.test.ts` | A | +155 | +5972 |
| `kit/files/scripts/wiki/impact.ts` | A | +370 | +24018 |
| `kit/files/scripts/wiki/kit-growth-guard.test.ts` | A | +92 | +4363 |
| `kit/files/scripts/wiki/kit-growth-guard.ts` | A | +388 | +16494 |
| `kit/files/scripts/wiki/kit-packaging.test.ts` | A | +415 | +18169 |
| `kit/files/scripts/wiki/kit-packaging.ts` | A | +418 | +25603 |
| `kit/files/scripts/wiki/model.ts` | A | +78 | +2397 |
| `kit/files/scripts/wiki/page-validation.test.ts` | A | +67 | +3152 |
| `kit/files/scripts/wiki/page-validation.ts` | A | +253 | +16927 |
| `kit/files/scripts/wiki/repository-view.test.ts` | A | +50 | +2437 |
| `kit/files/scripts/wiki/repository-view.ts` | A | +60 | +2256 |
| `kit/files/scripts/wiki/review-attestation.test.ts` | A | +104 | +3793 |
| `kit/files/scripts/wiki/review-attestation.ts` | A | +485 | +24463 |
| `kit/files/scripts/wiki/review-bundle.test.ts` | A | +130 | +5774 |
| `kit/files/scripts/wiki/review-bundle.ts` | A | +976 | +67471 |
| `kit/files/scripts/wiki/serialization.test.ts` | A | +15 | +649 |
| `kit/files/scripts/wiki/serialization.ts` | A | +22 | +751 |
| `kit/files/scripts/wiki/test-fixtures/fresh-context.ts` | A | +609 | +26401 |
| `kit/files/scripts/wiki/test-fixtures/wiki.ts` | A | +137 | +3804 |
| `kit/files/scripts/wiki/test-fixtures/work.ts` | A | +191 | +6364 |
| `kit/files/scripts/wiki/test-runner.test.ts` | A | +83 | +3396 |
| `kit/files/scripts/wiki/test-runner.ts` | M | +10 | +581 |
| `kit/files/scripts/wiki/verification.test.ts` | A | +116 | +5178 |
| `kit/files/scripts/wiki/verification.ts` | A | +426 | +22802 |
| `kit/files/scripts/wiki/wiki-coverage.test.ts` | A | +101 | +4599 |
| `kit/files/scripts/wiki/wiki-generated-data.test.ts` | A | +71 | +2329 |
| `kit/files/scripts/wiki/wiki-impact-conflicts.test.ts` | R065 | +462 | +27371 |
| `kit/files/scripts/wiki/wiki-pages.test.ts` | A | +163 | +6742 |
| `kit/files/scripts/wiki/wiki-repository-hooks.test.ts` | A | +80 | +2561 |
| `kit/files/scripts/wiki/work-selected-context.test.ts` | A | +316 | +18503 |
| `kit/files/scripts/wiki/work-topic-context.test.ts` | A | +337 | +17350 |
| `kit/files/scripts/wiki/work-validation.test.ts` | A | +127 | +5124 |
| `kit/files/scripts/wiki/work-validation.ts` | A | +158 | +9697 |
| `kit/files/scripts/wiki/work.test.ts` | D | -1032 | -52621 |
| `kit/migrations/v1/checks.yml` | M | +1 | +40 |
| `kit/package.kit.json` | M | +1 | +66 |
| `package.json` | M | +2 | +134 |
| `scripts/wiki/apply.test.ts` | M | +0 | +6 |
| `scripts/wiki/cli-discovery-handlers.ts` | A | +391 | +20637 |
| `scripts/wiki/cli-generation-handlers.ts` | A | +63 | +3216 |
| `scripts/wiki/cli-handlers.test.ts` | A | +68 | +3034 |
| `scripts/wiki/cli-render.ts` | A | +349 | +15291 |
| `scripts/wiki/cli-review-handlers.ts` | A | +200 | +10896 |
| `scripts/wiki/cli-runtime.ts` | A | +94 | +3399 |
| `scripts/wiki/cli-validation-handlers.ts` | A | +95 | +5020 |
| `scripts/wiki/cli.ts` | M | -1138 | -52995 |
| `scripts/wiki/context.test.ts` | A | +124 | +5489 |
| `scripts/wiki/context.ts` | A | +534 | +20875 |
| `scripts/wiki/core-facade.test.ts` | A | +98 | +5209 |

## Determinism

- Source and manifest digests are content-addressed; report files are excluded from changed-file breadth to avoid recursion.
- Model/provider calls: 0/0; output uses sorted JSON keys and a trailing LF.
