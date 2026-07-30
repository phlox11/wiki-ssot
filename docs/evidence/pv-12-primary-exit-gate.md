# PV-12 Primary exit-gate decision

## Outcome

The owner selected **Primary needs another focused cycle**.

This record is a decision contract, not evidence that Primary is validated.
`PV-12` remains open but becomes ready for a new owner evaluation now that
PV-16 through PV-19 have closed every bounded focused criterion. This evidence
update does not choose that owner outcome. The current product scope is
unchanged, and `PV-13` through `PV-15` remain deferred.

## Evidence-backed criteria

### Passed

- A generic remaining-work request reaches the no-query queue through the
  repository agent entrypoint, and `wiki:work` enumerates ready, active,
  waiting, blocked, deferred, and evidenced done work without requiring a known
  proposal or work ID. PV-10's entrypoint regressions and PV-11's isolated
  pilots exercise that route.
- Both documented adoption paths reached committed candidates with passing
  deterministic gates. The new-repository feature correctly returned
  `not-required`. The existing-repository author correctly stopped at
  `review-required`, and PV-18 subsequently completed context-isolated review
  and locally validated both the corrected exact candidate and its
  post-PV-16/PV-17 current-kit upgrade as `PASS`.
- PV-16 aligned recursive `scripts/wiki` architecture sources, coverage,
  high-risk staleness, and Fresh-context selection, with focused regressions
  proving nested implementation and test changes cannot repeat the PV-05 drift
  escape.
- PV-17 made generic topic context authority-, source-, and conflict-complete
  in text and JSON while explicitly separating non-current rationale. The
  current-kit existing-repository pilot also exercised that output over
  billing, delivery, and C-501.
- PV-19 reran all eight scenarios against exact combined revision
  `8b93a6f6e8026963b5cdd49cbb7a8b737e71b9ec`. Its report records complete
  current-page, invariant, conflict, implementation-source,
  status-plus-authority, non-current separation, expected-action, coverage, and
  drift-gate results with no remaining measured miss.

### Failed or incomplete

None within the bounded focused cycle. PV-12 still requires a separate owner
evaluation of its unchanged acceptance contract before the repository may
claim Primary validated, select another focused cycle, or change product
priority.

### Closed during the focused cycle

- **Generic topic context became authority- and source-complete.** PV-17 added
  the shared semantic text/JSON model, explicit current/conflict/non-current
  separation, deterministic source expansion, and stable read order that the
  initial decision record found missing.
- **Nested wiki-engine drift is covered recursively.** PV-16 aligned
  `scripts/wiki/**/*.ts` source/coverage mapping with recursive
  `scripts/wiki/**` risk selection and locked both implementation and test
  edges with failing-drift regressions.
- **The existing-repository fresh-session pilot reached independent PASS.**
   The first context-isolated review of predecessor candidate
   `d5f3087e0312d85dc8e419bd1f02ae2921a06310` returned
   `NEEDS_RECONCILE` because the generated adopter workflow required an
   unsupported publishing-only `wiki:kit` command. The publisher fixed that
   contract with focused regression coverage, the corrected pilot changed only
   its workflow and content-addressed manifest, and a second isolated review
   returned `PASS` for exact pilot HEAD
   `914f56804ff034b10f3019fdbb8b27afc5b7bbd5`, immutable base
   `45d4bd6fb8dccfb2c7f43546950ba66573dc6179`, and bundle digest
   `5c72fbc66812bfb75196c5c84c1894ea079dc40d7549b3d1e308bada0ba0007f`.
   The exact failed and passing reports, fixed disposition, command results,
   and context-isolation boundary are preserved in the
   [PV-11 existing-repository record](./pv-11-existing-repository-agent-pilot.md).
   After PV-16 and PV-17 merged, the current publisher kit was applied again;
   a new context-isolated review returned `PASS` for exact pilot HEAD
   `29d91ed4414f44280042d68eec6f0dee9f63c988` and bundle digest
   `80196617fd51ab62d19727e1126562816d0019f083696ef6b77c2b4aecebd2ad`.
- **The combined current engine passes all eight Primary scenarios.** PV-19
  binds its byte-reproducible report to exact revision
  `8b93a6f6e8026963b5cdd49cbb7a8b737e71b9ec`, preserves the immutable PV-05
  baseline, maps every implementation/test path to current authority, and
  records zero drift escape.

## Bounded follow-up graph

The complete bounded focused cycle is now done:

- PV-16 closed recursive publishing boundaries.
- PV-17 closed generic topic-context completeness.
- PV-18 closed the existing-repository independent-review criterion and
  revalidated it against the combined current kit.
- PV-19 closed the byte-reproducible current-engine scenario criterion.

PV-12 is therefore ready to reevaluate the original exit-gate acceptance
contract. This evidence update deliberately leaves its owner outcome open.

## Non-goals

- Do not mark `PV-12` done or claim Primary validated in this decision PR.
- Do not change the current product scope.
- Do not rewrite completed PV-16 through PV-19 evidence or choose the PV-12
  owner outcome in this evidence update.
- Do not activate `PV-13`, `PV-14`, or `PV-15` without their existing evidence
  triggers.
