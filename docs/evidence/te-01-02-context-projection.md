# TE-01 and TE-02 compact-context evidence

The implementation candidate is bound to `f43e4b4edf63e3e314cfff255b726ffdb06627c2`. The frozen TE-00 baseline remains bound separately to `6fd3a85414e00892930557cb8335e2d88ec90d66`; its focused, broad, and selected-work text outputs were 55,043, 114,294, and 66,479 bytes. Repository content and matching evolved after that baseline, so the same-revision full/compact pairs below isolate representation cost without pretending the longitudinal values are identical inputs.

| Surface | Full bytes | Compact bytes | Removed output bytes | Full median | Compact median | CLI calls |
|---|---:|---:|---:|---:|---:|---:|
| Focused `recursive source mapping` | 74,014 | 12,471 | 61,543 | 136.955 ms | 136.330 ms | 1 / projection |
| Broad `token context runtime cost efficiency` | 15,711 | 3,080 | 12,631 | 136.077 ms | 136.879 ms | 1 / projection |
| Selected work `TE-01` | 74,962 | 14,299 | 60,663 | 135.137 ms | 136.488 ms | 1 / projection |

Each timing is the median of seven synchronous CLI processes after one warm-up on Bun 1.3.10/macOS arm64 and includes Bun startup. The samples show no measurable local latency gain because process startup dominates. They are diagnostic observations, not a fixed percentage or time gate, and make no provider or model-latency claim. The measurement harness made zero model or provider calls.

The structural result is independently regression-tested:

- compact selected-work and complete-match topic output keeps page/conflict identity, status, authority, path, source declaration and expansion, relevant conflict IDs, authoritative read order, body digest, and focused commands while omitting bodies and the aggregate source duplicate;
- `--full` retains exhaustive bodies and the previous semantic fields;
- a partial-only default query constructs ordered candidates directly from search results and Wiki frontmatter, with no repository view, source-glob expansion, source read order, or page-body context assembly;
- candidate `--page <ID> --full` and `--conflict` commands restore exact focused authority, conflicts, sources, and bodies;
- exact-revision reusable selected-work artifacts still bind the exhaustive semantic model;
- root and generated-kit context regressions, the frozen PV-05/PV-19 suites, adoption fixtures, full repository tests, typecheck, Wiki lint/audit, and kit drift checks pass.

No stop-word, field-weighting, score, or result-limit policy was introduced, so the change cannot hide a candidate through a new ranking or pagination rule. A focused follow-up is an explicit caller choice after candidate discovery, not an automatic repeated broad-context round trip.
