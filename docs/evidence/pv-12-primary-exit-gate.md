# PV-12 Primary exit-gate decision

## Outcome

The owner selected the final outcome **Primary validated**.

The earlier owner decision—**Primary needs another focused cycle**—remains part
of the historical record. It bounded the follow-up to PV-16 through PV-19.
After those dependencies closed every focused criterion, the owner reevaluated
the unchanged PV-12 acceptance contract and made this final decision. `PV-12`
is done, and balanced product work may resume within the current product scope.
This outcome does not automatically authorize a next task: `PV-13` through
`PV-15` remain deferred, and no new work item is introduced.

## Satisfied criteria

- **Zero-knowledge work discovery and queue lifecycle.** The root agent
  entrypoint routes generic remaining/unfinished/next-work intent to no-query
  `wiki:work`, then routes a selected active or ready result to
  `wiki:context -- --work <ID>`. The work graph and CLI tests cover ready,
  active, waiting, blocked, deferred, evidenced done, recommendation ordering,
  and proposal-owner separation without requiring an internal ID in the user
  prompt.
- **Complete scenario authority and source context.** PV-19 reran all eight
  version 1 scenarios against exact combined revision
  `8b93a6f6e8026963b5cdd49cbb7a8b737e71b9ec`. All 8 passed. The report records
  9/9 current pages, 4/4 invariants, 2/2 conflicts, 18/18 implementation
  sources, 14/14 exact authority labels, 1/1 non-current label, and correct
  current/non-current separation in all 8 scenarios.
- **Configured coverage and deterministic drift rejection.** PV-16 aligned the
  recursive publishing boundary, and PV-19 records all 17 configured
  implementation/test paths mapped to current authority, all 8 reconciled
  candidates passing lint plus enforced impact, and all 17 independent
  code-only drift probes caught with zero escape. This criterion is explicitly
  about paths inside configured coverage, not every arbitrary repository file.
- **Reproducible adoption paths.** The new-repository fixture and isolated pilot
  start from an empty Git repository, reach a green adoption baseline, add the
  first covered/verified/tested feature as one candidate, and correctly return
  `not-required` under its risk policy. The existing-repository fixture and
  pilot preserve host customization, map maintained sources, reason-exclude
  generated code, record baseline ambiguity as C-501, and run the documented
  gates.
- **Independent existing-repository reconciliation.** The first isolated
  review of exact pilot HEAD
  `d5f3087e0312d85dc8e419bd1f02ae2921a06310` returned
  `NEEDS_RECONCILE` for an unsupported downstream `wiki:kit` workflow command.
  The focused publisher fix reached exact pilot `PASS` at HEAD
  `914f56804ff034b10f3019fdbb8b27afc5b7bbd5`, merge base
  `45d4bd6fb8dccfb2c7f43546950ba66573dc6179`, and bundle digest
  `5c72fbc66812bfb75196c5c84c1894ea079dc40d7549b3d1e308bada0ba0007f`.
  The post-PV-16/PV-17 current-kit replay reached a new exact `PASS` at HEAD
  `29d91ed4414f44280042d68eec6f0dee9f63c988` with bundle digest
  `80196617fd51ab62d19727e1126562816d0019f083696ef6b77c2b4aecebd2ad`.
- **Miss classification and owner outcome.** PV-19 records no remaining
  measured miss. Its explicit limitations are carried below, and this record
  supplies the final owner choice required by the last PV-12 criterion:
  **Primary validated**.

## Exact evidence boundary

- PV-05 remains the immutable historical baseline at
  `58869b75dc23374b918a79d9731c601764018ead`; this decision does not rewrite its
  original misses.
- PV-19's quantitative claim is bound to
  `8b93a6f6e8026963b5cdd49cbb7a8b737e71b9ec` and the byte-reproduced checked-in
  JSON/Markdown reports. It measures the versioned synthetic scenarios and
  their deterministic gates, not every possible task.
- Adoption claims are bound to the checked-in deterministic fixtures and PV-11
  pilot records. Context isolation is an orchestrator/process claim, while
  exact report HEAD, merge base, bundle digest, evidence, and publisher
  identity are machine-checkable.
- Coverage claims apply only to `.wiki/coverage.json` includes and declared
  reasoned exclusions. The required agent/PR/CI/package integration seam is
  checked by `wiki:doctor`; organization-level enforcement remains deployment
  policy.

## Non-goals

- Do not claim that a model read or understood surfaced context.
- Do not claim runtime or model-token guarantees from exact context byte counts.
- Do not claim cryptographic proof of fresh or independent reviewer reasoning.
- Do not claim protection against a trusted maintainer who intentionally
  weakens repository workflows or settings.
- Do not treat a deterministic queue recommendation as authorization or make an
  unresolved product decision automatically.
- Do not activate `PV-13`, `PV-14`, or `PV-15` without their existing evidence
  triggers, and do not invent replacement work merely because balanced product
  work may resume.
