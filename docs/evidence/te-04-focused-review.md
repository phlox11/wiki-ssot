# TE-04 focused exact-HEAD review evidence

The focused-review implementation is bound to `b86ad76f13c475942d09f0b977c3dda133dcd6f7`. The paired historical control remains the TE-00 publisher case at `6fd3a85414e00892930557cb8335e2d88ec90d66`; both controlled rollouts used one `gpt-5.6-sol / high` default agent.

| Measure | TE-00 before | TE-04 after | Change |
|---|---:|---:|---:|
| Non-diff review-bundle bytes | 57,344 | 49,937 | -7,407 |
| Reviewer source breadth | 33 | 7 | -26 |
| Model calls | 8 | 3 | -5 |
| Reviewer active time | 84,600 ms | 35,861 ms | -48,739 ms |
| Exact PASS | yes | yes | retained |
| Portable review-fixture correctness | yes | yes | retained |

The candidate stores each Wiki body once in a content-addressed object and assigns affected-page, invariant, changed-source, authority-source, relevant-test, conflict, and supporting-source relationships through one focused manifest. Diff, metadata, source declarations, exact HEAD, merge base, object hashes, file hashes, and bundle digest remain independently checkable. Merge-base glob expansion preserves deleted-source provenance, and empty source blobs receive their normal SHA-256 digest and lifecycle instead of being mistaken for missing files.

The controlled after-case used three model calls, 77,964 raw input tokens including 42,240 cached and 35,724 derived uncached tokens, 957 output tokens including 479 reasoning tokens, one tool call, zero compactions, 35,861 ms of active task time, and 48,170 ms wall time. A 12,309 ms coordination interval and a digest-label correction remain included rather than being hidden.

The deterministic harness itself makes zero model or provider calls. Provider request-start, first-token, and completion latency are unavailable and remain `null`; local rollout usage is not billed API cost or exact subscription-credit consumption. The mandatory final exact-HEAD publication review remains separate from this paired performance pilot.
