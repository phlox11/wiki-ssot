# PV-05 Primary baseline interpretation

This report measures Primary scenario contract v1 against the unmodified engine at `fa21d350935d7d16c21734e0a25f84ff29f3e41e`.
The machine-readable observations and per-scenario metrics are in `pv-05-primary-baseline.json`.

## Measured passes

- The default query context recalled 9/9 controlling current pages, 4/4 invariants, and 2/2 required conflicts.
- Synthetic candidate diffs contained 32/32 declared expected changes.

## Measured failures

- Exact status+authority labelling was present for 0/14 required authorities; the default text context omits both labels and search omits authority.
- The default text context surfaced 0/18 required implementation sources.
- Substring query matching returned 91 irrelevant page occurrences across 8 scenarios.
- 2 expected implementation/test files lacked a baseline current-page mapping, and 1 code-only probe passed both deterministic drift gates.
- The default discovery path stated the required update/verify wiki action in 0/8 scenarios.

## Hypotheses not established

- This deterministic fixture does not measure whether an LLM reads or understands surfaced context.
- It does not establish runtime or model-token cost, nor whether new- and existing-repository adoption defaults diverge; those require PV-08, PV-09, and PV-11 evidence.
- It identifies search over-return but does not establish that ranking is the correct remedy; PV-07 remains evidence-driven.
