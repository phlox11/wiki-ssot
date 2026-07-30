# PV-19 Primary current-engine interpretation

This report evaluates Primary scenario contract v1 against exact combined current revision `8b93a6f6e8026963b5cdd49cbb7a8b737e71b9ec`, after PV-16, PV-17, and PV-18.
The machine-readable observations, coverage dispositions, candidate gates, and per-source drift probes are in `pv-19-primary-current.json`.
The immutable PV-05 baseline remains a separate historical measurement and is not rewritten by this report.

## Measured passes

- All 8 scenarios passed the versioned expectations and the added coverage, separation, candidate-gate, and drift-probe checks.
- Topic context recalled 9/9 current pages, 4/4 invariants, 2/2 conflicts, and 18/18 declared sources.
- Exact status-plus-authority labels were present for 14/14 authorities; non-current labels were correct for 1/1.
- All 17 implementation/test source paths mapped to current authority, all 8 reconciled candidates passed both gates, and all 17 code-only probes were caught.

## Remaining miss classifications

- None. The current-engine evaluation has no remaining measured miss to classify.

## Explicitly accepted limitations

- The deterministic fixture proves surfaced repository context and gate behavior, not that a model read or understood that context.
- It does not claim protection against a trusted maintainer who intentionally weakens repository policy.
- Context byte counts are exact UTF-8 output size, not runtime or model-token cost.
