# PV-12 Primary exit-gate decision

## Outcome

The owner selected **Primary needs another focused cycle**.

This record is a decision contract, not evidence that Primary is validated.
`PV-12` remains open and waiting while the bounded follow-up graph closes the
failed criteria below. The current product scope is unchanged, and `PV-13`
through `PV-15` remain deferred.

## Evidence-backed criteria

### Passed

- A generic remaining-work request reaches the no-query queue through the
  repository agent entrypoint, and `wiki:work` enumerates ready, active,
  waiting, blocked, deferred, and evidenced done work without requiring a known
  proposal or work ID. PV-10's entrypoint regressions and PV-11's isolated
  pilots exercise that route.
- Both documented adoption paths reached committed candidates with passing
  deterministic gates. The new-repository feature correctly returned
  `not-required`; the existing-repository bootstrap correctly stopped at
  `review-required` rather than self-attesting.

### Failed or incomplete

1. **Generic topic context is not authority- and source-complete.**
   `bun run wiki:context -- "Primary exit gate"` renders a proposed page under
   an ordinary page heading with only its source file path. It does not render
   the page's `status` or `authority`, declared and expanded implementation
   sources, page-local conflicts, an authoritative read order, or an explicit
   current/non-current section boundary. Its JSON form carries declared
   `sources`, but still omits status, authority, expansion, and the
   selected-work separation model. PV-06 explicitly fixed only selected-work
   context, while PV-07 explicitly left current/non-current grouping outside
   its search remedy. The immutable PV-05 baseline measured 0/14 exact
   status-plus-authority labels and 0/18 implementation sources on the default
   text path.

2. **Nested wiki-engine files can escape aligned coverage and risk
   enforcement.** The publishing repository uses `scripts/wiki/*.ts` in
   `.wiki/coverage.json`, the `architecture/engine` source declaration,
   `.wiki/config.json` `highRisk`, and Fresh-context `changedFileGlobs`.
   Those one-level globs do not include a maintained path such as
   `scripts/wiki/parsers/edge.ts`. PV-05 recorded two unmapped nested files and
   a code-only coverage-edge probe that passed both `wiki:lint` and enforced
   `wiki:impact`.

3. **There is no post-fix current-engine eight-scenario report.** PV-05 is
   intentionally pinned to immutable engine revision
   `58869b75dc23374b918a79d9731c601764018ead`. PV-06 and PV-07 preserve that
   historical evidence rather than rewriting it, so it cannot demonstrate that
   the current engine satisfies all eight exit-gate scenarios after the focused
   fixes.

4. **The existing-repository fresh-session pilot has not reached independent
   PASS.** Its exact candidate
   `d5f3087e0312d85dc8e419bd1f02ae2921a06310` passed generated freshness,
   verification, lint, doctor, audit, impact, typecheck, and 114 tests. Its
   preflight correctly emitted `review-required` with bundle digest
   `bf7b650276af60b386417770cf932cf9b8281a179d3122d0adda47b196e6b03b`,
   and the isolated author stopped. The stricter exit-gate evidence contract
   requires a context-isolated reviewer report that validates as PASS.

## Bounded follow-up graph

Three lanes can start from completed `PV-11`:

- `PV-16` closes recursive `scripts/wiki` coverage, current-page source
  mapping, high-risk staleness, Fresh-context selection, and the demonstrated
  nested-file drift escape.
- `PV-17` gives generic topic context the status, authority, source expansion,
  conflict, ordering, and current/non-current separation contract already
  established for selected-work context.
- `PV-18` extends the existing-repository fresh-session pilot through
  context-isolated review and a locally validated exact PASS report.

`PV-19` depends on `PV-16` and `PV-17` and records a byte-reproducible
current-engine evaluation of all eight Primary scenarios. `PV-12` depends on
`PV-18` and `PV-19`; it reevaluates the original exit-gate acceptance contract
only after both are done.

## Non-goals

- Do not mark `PV-12` done or claim Primary validated in this decision PR.
- Do not change the current product scope.
- Do not implement `PV-16` through `PV-19` in this decision PR.
- Do not activate `PV-13`, `PV-14`, or `PV-15` without their existing evidence
  triggers.
