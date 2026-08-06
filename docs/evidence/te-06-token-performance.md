# TE-06 publisher token and performance exit evidence

The deterministic exit report is bound to exact combined publisher revision
`76e5d97a410d8e67659835e059e7b721541113c5` and report digest
`048520ca2bb066102eb41d007c047433429180750c8842a36e3a58072627412f`.
The harness itself made zero model or provider calls; the separately audited
controlled publisher used one `gpt-5.6-sol / high` default agent with no child
agent or Guardian.

## Correctness floor

- All eight Primary scenarios passed with complete authority, invariant,
  conflict, source, status, non-current separation, expected-action, coverage,
  impact, and drift checks.
- Kit (51 checks), new-adoption (1), existing-bootstrap (1), and work/context
  (60) suites passed.
- The exact-revision focused review passed, its portable fixture remained
  correct, and the current kit manifest is content-addressed.
- No measured correctness miss remains. Any future miss must use one of the
  report's four bounded classifications: `concrete-defect`, `owner-decision`,
  `orchestrator-limitation`, or `explicitly-accepted-limitation`.

## Default context bytes

The TE-00 values are the fixed pre-optimization default outputs. TE-06 measures
the exact combined revision's default compact output while retaining explicit
full output. Every compact/full JSON pair has the same canonical semantic
digest.

| Controlled case | TE-00 default | TE-06 compact | Change | TE-06 full retained |
| --- | ---: | ---: | ---: | ---: |
| `recursive source mapping` | 55,043 | 13,617 | -41,426 (-75.3%) | 76,416 |
| `token context runtime cost efficiency` | 114,294 | 3,893 | -110,401 (-96.6%) | 16,524 |
| selected work `TE-00` | 66,479 | 16,253 | -50,226 (-75.6%) | 79,217 |

These are UTF-8 text bytes, not model tokens. The current full values may be
larger than the historical values because the repository contract and evidence
grew; their role is to prove exhaustive compatibility remains available.

## Controlled publisher before and after

Both controls used one default `gpt-5.6-sol / high` agent. Cached input is
included in raw input, uncached input is derived as raw minus cached, and
reasoning output is included in output.

| Observation | TE-00 before | TE-06 after | Change |
| --- | ---: | ---: | ---: |
| Model calls | 8 | 5 | -3 (-37.5%) |
| Raw input tokens | 218,077 | 129,274 | -88,803 (-40.7%) |
| Cached input tokens | 207,872 | 122,624 | -85,248 (-41.0%) |
| Uncached input tokens | 10,205 | 6,650 | -3,555 (-34.8%) |
| Output tokens | 3,607 | 7,339 | +3,732 (+103.5%) |
| Tool-protocol calls | 7 | 4 | -3 (-42.9%) |
| Sanitized result bytes | 5,190 | 6,929 | +1,739 (+33.5%) |
| Coordination wait | 21,471 ms | 0 ms | -21,471 ms |
| Tool call-to-output spans | 6,081 ms | 22,109 ms | +16,028 ms |
| Active wall excluding user idle | 106,071 ms | 189,535 ms | +83,464 ms |

The controlled after-case therefore demonstrates fewer structural model and
tool round trips, lower raw/cached/uncached input, and removal of the reproduced
coordination wait. It does **not** demonstrate a lower total output, tool span,
or active wall time: the exit command runs the full deterministic Primary,
portable, adoption, context, and review suite, and final result preparation
dominated the after-case publication phase. The ratified contract rejects fixed
percentage gates, so these regressions remain visible diagnostic evidence
rather than being hidden or converted into a correctness waiver.

## Timing and ownership boundaries

The after-case implementation phase was 45,999 ms across four model calls and
four asynchronous tool-protocol calls. Publication to the parent task was
135,501 ms and one model call. No external PR merge occurred, and disposable
clone cleanup happened inside the deterministic command, so separate merge and
cleanup phase timings are unavailable.

Model request-start, first-token, and completion latency are not exposed by the
local rollout and remain `null`. Cache continuity, model routing, Guardian
routing, and approval policy belong to the provider or orchestrator boundary;
the read-only after-case observed no Guardian, approval wait, or coordination
wait, but that is not a repository guarantee. Raw rollout usage is not billed
API cost or exact subscription-credit consumption.

## Owner handoff

TE-06 is ready to close on the correctness and structural-waste contract. No
owner outcome is selected here. TE-06-OWNER must explicitly record one of:

1. publisher token and performance efficiency validated with portable
   correctness preserved;
2. another bounded efficiency cycle; or
3. optimization not adopted.

If another bounded cycle is selected, the owner decision must name its exact
work ID, scope, and acceptance criteria. No option authorizes weakening a
current Wiki SSOT invariant.
