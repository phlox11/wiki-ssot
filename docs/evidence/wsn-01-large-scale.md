# Wiki scale benchmark: large

Profile digest: `65e3e7f16997fbdf6ce0a0c5aab171dfde5311a17429be8ceb5e57033ce45a0f`
Input digest: `8d41dcfd8527f138ab5b927c1e074737c98b02e9139f81fa6f68a0b2d3a1f55d`
Output digest: `418ba48df824cc4159c9a77426433fea7f4ac4aba2a14364e71b9784d08ab697`

## Environment

- Bun: 1.3.10
- Platform: darwin
- Architecture: arm64
- CPU: Apple M4 Max
- Logical CPUs: 14

| Metric | Value |
|---|---:|
| Engine phase total (ms) | 579.837 |
| Engine phase limit (ms) | 30000 |
| Peak RSS (bytes) | 619462656 |
| Current pages | 1000 |
| Proposal pages | 100 |
| Work items | 10000 |
| Total conflicts | 1000 |
| Open conflicts | 250 |
| Resolved conflicts | 750 |
| Catalog pages | 2100 |
| Graph nodes | 12100 |
| Graph edges | 23056 |
| Declared source files | 10000 |

## Correctness

- validation_findings: 0
- validation_finding_codes
- profile_counts_exact: true
- queue_work_items: 10000
- graph_has_no_source_nodes: true
- catalog_complete: true
- graph_counts_exact: true
- root_index_bounded: true
- generated_deterministic: true
- search_exercised: true

Enforcement requested: true; passed: true.
