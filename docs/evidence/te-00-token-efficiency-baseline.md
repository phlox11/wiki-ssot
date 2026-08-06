# TE-00 token-efficiency baseline

The deterministic publisher evidence is pinned to `6fd3a85414e00892930557cb8335e2d88ec90d66` and measured as UTF-8 bytes. External schooled diagnosis and controlled publisher rollout metrics remain separate layers; neither claims billed cost or subscription credits.

## Correctness floor and proposed targets

- PV-19 correctness floor: preserve 100% of current-page, invariant, conflict, implementation-source, authority/status, non-current-label, expected-change, Wiki-action, coverage, impact, review, and drift expectations.
- Do not trade source traceability, exact-HEAD binding, or independent review for smaller context or bundles.
- At most 40% of the reproduced deterministic context baseline for each topic and selected-work case.
- At most 60% of the controlled end-to-end baseline for uncached input and review non-diff bytes under unchanged controls.
- At most 70% of primary calls and active wall time, and at most 50% of publication-phase calls.

## Reproduced deterministic publisher bytes

- Entry 16915; focused 55043; broad 114294; selected work 66479; recursive TypeScript 588441; review 60946 (3602 diff, 57344 non-diff).
- Review candidate `d70befec1ac13e173ea3cc5b004d789b58a98368` is derived from exact base `6fd3a85414e00892930557cb8335e2d88ec90d66`, with no push and no retained worktree.

## Controlled publisher rollout and performance

- 1 agent(s), 8 model calls, 218077 raw input tokens (207872 cached; 10205 derived uncached), 3607 output tokens (1372 reasoning subset), 221684 total.
- Request, first-token, completion, tool, approval, coordination, and active-wall metrics distinguish available values from unavailable values with explicit limitations.
- Implementation, publication, merge, and cleanup phases are reported independently; a supplied merge/cleanup combined observation is retained separately when applicable.

## Layer separation, variance, and limitations

- Cached input is included in raw input and is never added twice; reasoning output is a subset of output.
- External cache continuity, approval behavior, provider latency, model routing, and optional orchestration are observations, not repository guarantees.
- UTF-8 bytes and supplied token counts are evidence, not billed API cost, subscription credits, runtime latency, or proof of comprehension.
- Schooled diagnosis is external and sanitized; it is not a publisher-engine measurement.
- Sanitized evidence retains no transcript, prompt, private path, session body, or source/tool body.
- No model/provider calls are made by this harness.
- No comparison candidate is pushed; the disposable candidate is removed after bundle measurement.
- Owner decision remains pending until TE-00-OWNER ratification.

## Owner ratification

Decision: **unselected**

Choose one: ratify the publisher contract; request another bounded measurement cycle; or do not adopt the optimization.
