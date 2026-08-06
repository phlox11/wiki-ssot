# TE-06 publisher token and performance exit evidence

The deterministic exit report is bound to exact combined publisher revision
`76e5d97a410d8e67659835e059e7b721541113c5` and report digest
`50ee372d28282fd8388d42a62703e58da6a2fdc4ff6e24ece78c08610036b7c8`.
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
reasoning output is included in output. The after-case ran only the same fixed
five-surface task recorded at TE-00. Task identity digest
`4812fe4f0e227750fc1051dc14327c8739c327ae2358e90c97f4c10a90f9f00d`
binds the three context selectors, recursive source glob, deterministic review
bundle, and byte-identical TE-00 review-candidate recipe. Its full deterministic
record is bound to `0bca638d3a7e1fcc8ebb7ac619431bd8775c4abc67962b6ee050314dde525f72`;
default successful output is the 1,082-byte compact projection.

| Observation | TE-00 before | TE-06 after | Change |
| --- | ---: | ---: | ---: |
| Model calls | 8 | 2 | -6 (-75.0%) |
| Raw input tokens | 218,077 | 50,469 | -167,608 (-76.9%) |
| Cached input tokens | 207,872 | 44,544 | -163,328 (-78.6%) |
| Uncached input tokens | 10,205 | 5,925 | -4,280 (-41.9%) |
| Output tokens | 3,607 | 480 | -3,127 (-86.7%) |
| Tool-protocol calls | 7 | 1 | -6 (-85.7%) |
| Sanitized result bytes | 5,190 | 1,082 | -4,108 (-79.2%) |
| Coordination wait | 21,471 ms | 0 ms | -21,471 ms |
| Tool call-to-output spans | 6,081 ms | 3,489 ms | -2,592 ms (-42.6%) |
| Active wall excluding user idle | 106,071 ms | 18,386 ms | -87,685 ms (-82.7%) |

The fixed-task after-case therefore demonstrates fewer structural model and
tool round trips, lower raw/cached/uncached input and output, smaller successful
output, removal of the reproduced coordination wait, and lower observed tool
and active-wall spans. The broader exit correctness suite is executed and
reported separately by the model-free exit harness; none of its work is hidden
inside the controlled rollout.

Two deterministic task surfaces grew with the repository: recursive TypeScript
source bytes rose from 588,463 to 842,820 (+43.2%), and the same-recipe raw
review comparison rose from 60,946 to 75,912 bytes (+24.6%). They remain visible
diagnostics rather than being presented as token gains. The dedicated focused
review regression still proves exact PASS, portable correctness, reviewer
source breadth 7, and 49,937 non-diff bytes. The source-total growth alone does
not identify unrelated required-source breadth or a coherent partition, so it
does not activate deferred TE-03.

## Timing and ownership boundaries

The after-case command-to-compact-output implementation phase was 3,489 ms
across one model call and one tool-protocol call. Verbatim publication to the
parent task was 8,986 ms and one model call. Total active wall time, including
pre-command task preparation, was 18,386 ms. No external PR merge occurred,
and disposable clone cleanup happened inside the deterministic command, so
separate merge and cleanup phase timings are unavailable.

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
