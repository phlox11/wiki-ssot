# TE-00 token-efficiency baseline

Deterministic evidence is pinned to context/source revision `cf128d5e76cc40c0f3d48db0e3873e29d6468e00` and measured as UTF-8 bytes. It is separate from controlled model rollout usage and does not claim runtime or billed cost.

## Correctness floor and proposed targets

- PV-19 correctness floor: preserve every current-page, invariant, conflict, implementation-source, authority-label, non-current-label, expected-change, Wiki-action, coverage, and drift-gate expectation.
- Proposed context target: at most 40% of the reproduced deterministic context baseline.
- Proposed uncached-input target: at most 60% of the controlled end-to-end baseline.

## Exact comparison task

- Compare the pinned real-repository cases and review candidate named by the machine-readable report at `cf128d5e76cc40c0f3d48db0e3873e29d6468e00`.
- Deterministic bytes: entry 16940; focused 55046; broad 92758; selected work 65031; recursive TypeScript 588463; review bundle 201631.

## Controlled rollout controls

- Agent/model/effort records: 1 agent(s), 25 model calls, 1241104 raw input tokens (1158912 cached, 82192 derived uncached), 8520 output tokens (3737 reasoning subset), 1249624 total.
- Keep task label, role, model, effort, call count, and orchestration fixed; cached input is already included in raw input and reasoning output is already included in output.

## Variance and limitations

- Accepted variance options must be recorded by the owner: model/cache behavior, orchestration fan-out, or bounded sampling variance.
- The rollout is sanitized: no transcript, prompt, private path, session identifier, or thread identifier is retained.
- Local token counts are not billed cost or subscription-credit claims, and deterministic bytes do not establish model comprehension.

## Owner ratification

Decision: **unselected**

Choose one: ratify targets; request another bounded measurement cycle; or do not adopt the optimization.
