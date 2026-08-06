# TE-04 focused exact-HEAD review evidence

The focused-review implementation is bound to `4b50c638b7b8b38c07f8741f9bc137ae17adb145`. The paired historical control remains the TE-00 publisher case at `6fd3a85414e00892930557cb8335e2d88ec90d66`; both controlled rollouts used one `gpt-5.6-sol / high` default agent.

| Measure | TE-00 before | TE-04 after | Change |
|---|---:|---:|---:|
| Non-diff review-bundle bytes | 57,344 | 49,937 | -7,407 |
| Reviewer source breadth | 33 | 7 | -26 |
| Model calls | 8 | 2 | -6 |
| Reviewer active time | 84,600 ms | 14,483 ms | -70,117 ms |
| Exact PASS | yes | yes | retained |
| Portable review-fixture correctness | yes | yes | retained |

The candidate stores each Wiki body once in a content-addressed object and assigns affected-page, invariant, changed-source, authority-source, relevant-test, conflict, and supporting-source relationships through one focused manifest. Diff, metadata, source declarations, exact HEAD, merge base, object hashes, file hashes, and bundle digest remain independently checkable. Merge-base glob expansion preserves deleted-source provenance, and empty source blobs receive their normal SHA-256 digest and lifecycle instead of being mistaken for missing files.

The controlled after-case used two model calls, 50,970 raw input tokens including 48,640 cached and 2,330 derived uncached tokens, 380 output tokens including 135 reasoning tokens, one tool call, zero compactions, 14,483 ms of active task time, and 14,483 ms wall time. The earlier superseded pilots are disclosed in the JSON limitations but are not substituted for the final exact-revision measurement.

The deterministic harness itself makes zero model or provider calls. Provider request-start, first-token, and completion latency are unavailable and remain `null`; local rollout usage is not billed API cost or exact subscription-credit consumption. The mandatory final exact-HEAD publication review remains separate from this paired performance pilot.
