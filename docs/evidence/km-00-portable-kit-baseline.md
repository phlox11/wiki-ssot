# KM-00 portable kit modularity baseline

Exact revision: `2f8629fdd37bbd4001ffc07e65964fcead1d16d4`

## Portable payload

Copied kit tooling: 9,852 lines / 521,482 UTF-8 bytes. Five split targets: 9,598 lines / 509,272 bytes (97.7%).

| Target | Lines | Bytes | Payload share | Responsibilities |
|---|---:|---:|---:|---:|
| `scripts/wiki/core.ts` | 4,144 | 230,066 | 44.1% | 10 |
| `scripts/wiki/fresh-context.test.ts` | 2,400 | 126,643 | 24.3% | 5 |
| `scripts/wiki/cli.ts` | 1,277 | 58,274 | 11.2% | 5 |
| `scripts/wiki/work.test.ts` | 1,032 | 52,621 | 10.1% | 5 |
| `scripts/wiki/wiki.test.ts` | 745 | 41,668 | 8.0% | 5 |

## Compatibility contract

- Public command count: 17; exit codes are success 0, findings 1, usage 2.
- JSON uses stable sorted keys; text headings, field shapes, stdout/stderr separation, and deterministic ordering are fixture-bound.
- KIT_ENTRIES and manifest v2 ownership, managed-block, seed, reference, upgrade, adoption, and dry-run semantics are frozen before code motion.

## Safe sequence

TE-03: TE-03 is currently deferred; if activated before KM ratification, finish TE-03 and regenerate KM-00.
No production module moved or renamed: true.

## Manifest

Manifest v2 digest: `4963245ac4504cb8c6062dea1816a748af88f63deb669411ab6e242a4cd7b52e`.
