---
id: proposal/token-efficiency
summary: Reduce Wiki SSOT model calls, context and review input, and active execution time using the schooled diagnosis, a controlled publisher before/after comparison, and portable correctness evidence.
kind: proposal
status: proposed
authority: normative
owners: ["@phlox11"]
sources:
  - path: AGENTS.md
  - path: .wiki/config.json
  - path: .wiki/coverage.json
  - path: scripts/wiki/core.ts
  - path: scripts/wiki/cli.ts
  - path: scripts/wiki/work.test.ts
  - path: scripts/wiki/kit.test.ts
  - path: scripts/wiki/fresh-context.test.ts
  - path: scripts/wiki/primary-scenarios.ts
  - path: scripts/wiki/primary-current.ts
  - path: scripts/wiki/token-efficiency-baseline.ts
  - path: scripts/wiki/token-efficiency-baseline.test.ts
  - path: scripts/wiki/te04-focused-review.ts
  - path: scripts/wiki/te04-focused-review.test.ts
  - path: scripts/wiki/te06-controlled-comparison.ts
  - path: scripts/wiki/te06-controlled-comparison.test.ts
  - path: scripts/wiki/te06-exit-validation.ts
  - path: scripts/wiki/te06-exit-validation.test.ts
  - path: docs/commands.md
  - path: docs/evidence/pv-19-primary-current.json
  - path: docs/evidence/pv-19-primary-current.md
  - path: docs/evidence/te-00-schooled-diagnosis.json
  - path: docs/evidence/te-00-controlled-publisher.json
  - path: docs/evidence/te-00-token-efficiency-baseline.json
  - path: docs/evidence/te-00-token-efficiency-baseline.md
  - path: docs/evidence/te-01-02-context-projection.json
  - path: docs/evidence/te-01-02-context-projection.md
  - path: docs/evidence/te-04-focused-review.json
  - path: docs/evidence/te-04-focused-review.md
  - path: docs/evidence/te-06-controlled-comparison-compact.json
  - path: docs/evidence/te-06-controlled-comparison.json
  - path: docs/evidence/te-06-controlled-publisher.json
  - path: docs/evidence/te-06-token-performance.json
  - path: docs/evidence/te-06-token-performance.md
affects: [product/scope, product/invariants, architecture/engine, operations/enforcement]
related: [proposal/primary-findability-validation, product/scope, product/invariants, architecture/engine, operations/enforcement]
tags: [roadmap, token, performance, latency, context, efficiency, search, sources, review, orchestration]
work_items:
  - id: TE-00
    title: Freeze the schooled diagnosis and publisher-only comparison contract
    state: done
    executor: agent
    priority: high
    depends_on: []
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - A durable diagnosis summary records the supplied schooled session 019fd1e6-816a-7742-b356-f28c945d6110, including roles, models and effort, call counts, raw, cached and uncached input, output, input distribution, compaction, tool calls, artifact bytes, phase timing, successful outcome, and limitations without exposing prompt or source bodies.
      - The schooled diagnosis is sufficient to select the shared optimization surfaces; TE-00 performs no adopter inventory, requests no additional adopter rollout, and does not treat more consumer-repository measurement as an implementation prerequisite.
      - Versioned deterministic fixtures reproduce representative focused topic, broad discovery, selected-work, source-expansion, and review-bundle measurements against one exact pre-optimization revision of this publisher repository.
      - A controlled publisher case records per-agent role, model and effort, model-call count, raw input, cached input, derived uncached input, output, total tokens, input distribution, compaction, tool calls, artifact bytes, and successful outcome without presenting them as billed cost or subscription credits.
      - Performance evidence reports model request, first-token and completion latency when available, tool duration, approval wait, coordination wait, active wall time excluding user idle, and phase-level implementation, publication, merge, and cleanup measurements.
      - Any reversible comparison candidate runs only in this repository or a disposable worktree derived from its exact revision; TE-00 creates no standalone synthetic or test repository and pushes no comparison worktree.
      - The baseline separates the external schooled diagnosis, deterministic publisher bytes, engine-owned behavior, model- and orchestrator-dependent publisher rollout metrics, cache effects, approval-system behavior, and measurement limitations.
      - Evidence presents the correctness floor, structural optimization objectives, comparison tasks, model and effort controls, measurement interpretation, and every limitation needed for owner ratification before implementation begins.
    evidence:
      - docs/evidence/te-00-schooled-diagnosis.json
      - docs/evidence/te-00-controlled-publisher.json
      - docs/evidence/te-00-token-efficiency-baseline.json
      - docs/evidence/te-00-token-efficiency-baseline.md
  - id: TE-00-OWNER
    title: Ratify the publisher-only efficiency and performance contract
    state: done
    executor: human
    priority: high
    depends_on: [TE-00]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - The owner explicitly ratifies the schooled diagnosis, publisher before/after case, correctness floor, structural optimization objectives, model and effort controls, latency instrumentation, and measurement interpretation before implementation begins.
      - "Fixed percentage reduction gates are rejected: token, byte, call, tool, and elapsed-time values remain before/after diagnostic evidence, while acceptance requires removing reproduced structural waste without weakening correctness."
      - Engine-owned pass criteria remain separate from Guardian, provider cache, model routing, and other external-orchestrator observations that the repository cannot enforce.
      - The decision does not authorize weakening current authority, conflicts, source traceability, coverage, impact, exact-HEAD binding, or independent-review invariants.
    evidence:
      - wiki/proposals/token-efficiency.md
      - docs/evidence/te-00-token-efficiency-baseline.json
      - docs/evidence/te-00-token-efficiency-baseline.md
  - id: TE-01
    title: Add compact context projections with explicit full expansion
    state: done
    executor: agent
    priority: high
    depends_on: [TE-00-OWNER, TE-05]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Default topic and selected-work context retain every controlling current page, invariant, conflict, status, authority, wiki path, declared source, expanded source path, and authoritative read-order entry required by the current contract.
      - The default projection avoids embedding complete current and non-current page bodies and repeated source lists when stable paths, summaries, hashes, and focused follow-up commands carry the same routing information.
      - An explicit full-output mode remains available for exhaustive inspection and is documented for callers that need the complete historical text representation.
      - Text and JSON compact projections carry the same semantic fields, deterministic ordering, and clear current versus non-current separation.
      - Focused publisher regressions prove that compact output removes reproduced full-body duplication and broad rereading, while recording before/after bytes, calls, and time without reducing PV-19 authority, conflict, source, status, or expected-action recall; existing kit and adoption tests preserve portable correctness.
      - Any change to the current context-completeness contract updates current Wiki pages, code, tests, and downstream kit documentation in the same implementation PR.
      - TE-01 and TE-02 ship as one inseparable implementation PR because they change the same search, semantic context, text, JSON, test, and adoption surfaces; each stable work ID retains its own acceptance evidence.
    evidence:
      - scripts/wiki/core.ts
      - scripts/wiki/cli.ts
      - scripts/wiki/work.test.ts
      - docs/commands.md
      - docs/evidence/te-01-02-context-projection.json
      - docs/evidence/te-01-02-context-projection.md
      - wiki/architecture/engine.md
      - wiki/operations/enforcement.md
      - wiki/product/invariants.md
      - wiki/product/scope.md
  - id: TE-02
    title: Bound partial-match discovery before full context expansion
    state: done
    executor: agent
    priority: high
    depends_on: [TE-00-OWNER, TE-05]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Complete all-term matches preserve the current deterministic selection behavior and every focused PV-07 regression.
      - When no complete match exists, discovery returns a compact deterministic candidate projection instead of expanding every partial match into full page bodies.
      - Every candidate remains reachable through an explicit focused page, work, or conflict context command, with deterministic pagination or continuation when a bounded candidate view is used.
      - Stop-word, score, field-weighting, or result-limit choices are justified by reproduced real-repository misses and do not silently hide a controlling current page or open conflict.
      - The publisher token-efficiency diagnostic query no longer produces an unbounded multi-page body expansion, while JSON and text results remain semantically aligned and portable fixture tests preserve the same semantics downstream.
      - TE-01 and TE-02 ship as one inseparable implementation PR, and the combined candidate satisfies both work contracts before either item is marked done.
    evidence:
      - scripts/wiki/core.ts
      - scripts/wiki/cli.ts
      - scripts/wiki/work.test.ts
      - docs/commands.md
      - docs/evidence/te-01-02-context-projection.json
      - docs/evidence/te-01-02-context-projection.md
      - wiki/architecture/engine.md
      - wiki/operations/enforcement.md
      - wiki/product/invariants.md
      - wiki/product/scope.md
  - id: TE-03
    title: Partition the recursive engine source authority boundary
    state: deferred
    executor: agent
    priority: high
    depends_on: [TE-00-OWNER, TE-04]
    deferred_reason: Activate only when controlled publisher evidence shows that a broad source declaration structurally adds unrelated required-source breadth and a coherent partition removes that waste without weakening coverage, impact, or review completeness.
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Before activation, exact publisher baseline or shadow evidence identifies the task, unrelated source families, required-source count and bytes, and a coherent partition that removes the unrelated breadth.
      - Once activated, the monolithic scripts/wiki TypeScript source declaration is replaced or complemented by coherent current authority pages and bounded exact or glob declarations for engine core, install and kit, review integration, and publishing-only validation evidence.
      - Every file covered by .wiki/coverage.json remains mapped to at least one current page or a reasoned exclusion, and independent code-only probes continue to fail enforced impact when Wiki reconciliation is absent.
      - A context-renderer change no longer directs the reader through unrelated adoption, historical-baseline, and publishing-only test sources merely because all TypeScript files share one recursive page declaration.
      - Cross-cutting core files remain mapped to every current contract they genuinely implement; the optimization cannot obtain smaller context by weakening source traceability.
      - Recursive scripts/wiki high-risk and Fresh-context selection remain intact unless a separately approved current contract changes them.
      - Generated source maps, current status, architecture pages, verification state, focused tests, and downstream kit behavior are reconciled together.
    evidence: []
  - id: TE-04
    title: Focus exact-HEAD review inputs and reduce reviewer round trips
    state: done
    executor: agent
    priority: high
    depends_on: [TE-00-OWNER, TE-01, TE-02]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - A Wiki page that is both affected authority and an invariant is stored once in the bundle, with manifest roles referencing the same content digest instead of duplicating its body.
      - The bundle deterministically distinguishes changed sources, directly affected authority sources, relevant tests, conflicts, and supporting sources through one focused manifest without treating a broad declaration as permission to omit a necessary primary source.
      - Diff, metadata, current pages, invariants, conflicts, source declarations, exact HEAD, merge base, and bundle digest remain bound and independently checkable.
      - The context-isolated reviewer requirement and classification-to-disposition contract remain unchanged; no optimization permits author self-PASS or stale attestation reuse.
      - Adversarial tests fail when a required page, invariant, conflict, changed source, relevant test, or digest binding is absent or misclassified.
      - The reproduced publisher review candidate reduces non-diff bundle bytes, reviewer source breadth, model-call count, and reviewer active time against TE-00 while retaining exact PASS and portable review-fixture correctness.
    evidence:
      - scripts/wiki/core.ts
      - scripts/wiki/fresh-context.test.ts
      - scripts/wiki/te04-focused-review.ts
      - scripts/wiki/te04-focused-review.test.ts
      - docs/evidence/te-04-focused-review.json
      - docs/evidence/te-04-focused-review.md
  - id: TE-05
    title: Bound orchestration round trips and reusable context boundaries
    state: done
    executor: agent
    priority: high
    depends_on: [TE-00-OWNER]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Repository guidance distinguishes mandatory Wiki SSOT roles and gates from optional provider-specific explorer, worker, guardian, or multi-lens orchestration.
      - A bounded machine-readable context artifact bound to controlling page, source, conflict, metadata, base, and HEAD digests can be reused by authoring and implementation roles without requiring each role to repeat broad topic discovery against the same Wiki revision.
      - Reuse is invalidated by changed controlling page, source, conflict, metadata, base, or HEAD digests and never substitutes stale context for required direct source inspection.
      - The authoring context and required independent reviewer remain separate, while optional role fan-out is measured and justified by task risk rather than presented as an engine requirement.
      - Provider-neutral adoption and agent-entrypoint guidance directs callers to batch independent reads and deterministic checks, avoid repeated queue or context discovery at one exact revision, use bounded waits instead of status polling, summarize successful output with digest-addressable full evidence, and create a bounded phase handoff before publication when the authoring context has grown materially.
      - Focused deterministic runs prove that one body-free selected-work artifact can serve authoring and implementation at an exact revision, eliminating repeated queue discovery and broad-context output serialization; command count, output bytes, and elapsed time remain before/after diagnostics rather than numeric gates, and validation, approval, exact-HEAD review, and failure diagnostics remain intact.
      - Adoption guidance makes no claim that the repository can control Guardian cache continuity, approval policy, external model routing, provider latency, subscription accounting, or other orchestrator behavior.
    evidence:
      - scripts/wiki/core.ts
      - scripts/wiki/cli.ts
      - scripts/wiki/work.test.ts
      - scripts/wiki/kit.test.ts
      - AGENTS.md
      - docs/commands.md
      - wiki/architecture/engine.md
      - wiki/product/invariants.md
      - wiki/operations/enforcement.md
  - id: TE-06
    title: Validate publisher-repository token and performance gains
    state: done
    executor: agent
    priority: high
    depends_on: [TE-01, TE-02, TE-04, TE-05]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - The current Primary scenario suite, existing kit and adoption regression suites, and the controlled publisher scenario run against exact combined revisions with no authority, invariant, conflict, source, status, expected-action, coverage, impact, review, or portable-correctness regression.
      - Default context output removes the reproduced unnecessary full-body expansion and broad rereading for every controlled topic and selected-work case, records before/after bytes, and retains full mode for exhaustive inspection.
      - Controlled end-to-end pilots report per-agent calls, raw, cached and uncached usage, input distribution, model latency, tool time, approval time, active wall time, and phase timing, and demonstrate the removal of reproduced structural round trips and duplication under the same comparison task, model, effort, and orchestration policy.
      - Evidence separately evaluates engine-owned gains, repository guidance and optional orchestration gains, cache-accounting effects, Guardian and approval behavior, and provider limitations.
      - Remaining misses are classified as a concrete defect, owner decision, orchestrator limitation, or explicitly accepted limitation.
      - The evidence presents token efficiency validated, another bounded cycle, and not adopted as explicit owner-decision options without selecting one on the owner's behalf.
    evidence:
      - scripts/wiki/te06-controlled-comparison.ts
      - scripts/wiki/te06-controlled-comparison.test.ts
      - scripts/wiki/te06-exit-validation.ts
      - scripts/wiki/te06-exit-validation.test.ts
      - docs/evidence/te-06-controlled-comparison-compact.json
      - docs/evidence/te-06-controlled-comparison.json
      - docs/evidence/te-06-controlled-publisher.json
      - docs/evidence/te-06-token-performance.json
      - docs/evidence/te-06-token-performance.md
      - wiki/architecture/engine.md
  - id: TE-06-OWNER
    title: Record the publisher-repository efficiency owner exit decision
    state: not-started
    executor: human
    priority: high
    depends_on: [TE-06]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - The owner records publisher token and performance efficiency validated with portable correctness preserved, another bounded efficiency cycle, or the optimization not adopted against the exact TE-06 evidence.
      - The decision names any accepted limitations and does not silently weaken a current Wiki SSOT invariant.
      - The durable decision evidence closes the proposal cycle or names the exact bounded follow-up work.
    evidence: []
---

# Token- and time-efficient Wiki SSOT

This proposal turns observed context, rollout, and elapsed-time problems into
bounded repository work. It is a `status: proposed` plan, not a statement of
current behavior. The supplied schooled rollout is the diagnosis of shared
orchestration and context costs. `TE-00` records that diagnosis durably and
freezes one controlled pre-optimization case in this publisher repository.
`TE-00-OWNER` records the owner's ratification of structural waste removal
without fixed percentage gates, so implementation items can become ready.
Queue readiness does not authorize implementation beyond a separately
requested task.

The goal is not to make the Wiki smaller or faster by hiding authority. The
goal is to preserve the same current pages, invariants, conflicts, source
traceability, coverage, exact-HEAD review, and deterministic gates while
reducing unnecessary model calls, repeated full-body expansion, broad
re-reading, oversized successful output, approval churn, and active wall time.

## Existing diagnosis and local comparison boundary

Earlier publisher byte samples exposed broad context expansion and review input
duplication. They remain preliminary local measurements that `TE-00` must turn
into an exact pre-optimization publisher fixture; they are not a reason to
measure every repository using Wiki SSOT.

The owner-supplied rollout for adopter repository `true-dragonsnest/schooled`,
session `019fd1e6-816a-7742-b356-f28c945d6110`, adds a different real-world
signal. Against a successful 13-file `+368/-74` change, six execution contexts
made 305 model calls. The primary context made 169 model calls and 160 tool
calls; its implementation phase used 101 model calls, while PR creation plus
merge and cleanup used another 50 calls and about 10.23 million input tokens.
Overall input was 96.44% cached. Four Guardian cache misses accounted for most
of that Guardian's uncached input, while exact duplicate cross-role payloads
were negligible. Classified artifact output was led by tests and validation,
then work context, diff, and review material.

This evidence is sufficient to select the shared optimization surfaces. No
additional adopter inventory, rollout collection, or consumer-repository
performance census is required. The before/after comparison is intentionally
limited to the same controlled case in this publisher repository. Portable
applicability is protected by generated kit and adoption regression suites,
not by repeating performance pilots in every consumer repository.

The comparison has four explicitly separate layers:

1. the fixed schooled diagnosis — real end-to-end role, token, call, artifact,
   cache, and timing observations that motivated the work;
2. deterministic publisher metrics — text and JSON bytes, selected pages,
   source count and bytes, bundle component bytes, and correctness recall;
3. controlled publisher rollout metrics — per-role model and effort, calls, raw input,
   cached input, derived uncached input, output, compaction, tool calls, and
   artifact bytes;
4. publisher performance metrics — request, first-token and completion latency when
   observable, tool duration, approval and coordination wait, phase timing, and
   active wall time excluding user idle.

TE-00 freezes those layers at publisher revision
`6fd3a85414e00892930557cb8335e2d88ec90d66`. The deterministic fixture
reproduces the focused `recursive source mapping` topic, the broad
`token context runtime cost efficiency` discovery query, selected work
`TE-00`, recursive `scripts/wiki/**/*.ts` expansion, and a disposable review
candidate derived from that exact revision. The checked-in report records
55,043 focused-context bytes, 114,294 broad-context bytes, 66,479
selected-work bytes, 588,463 recursive TypeScript bytes, and a 60,946-byte
review comparison made of 3,602 diff bytes and 57,344 non-diff bytes.

The fresh publisher control completed successfully with one
`gpt-5.6-sol / high` default agent: eight model calls, 218,077 raw input
tokens including 207,872 cached tokens, 10,205 derived uncached tokens, 3,607
output tokens, zero compactions, seven tool calls, and 5,190 serialized
sanitized tool-output bytes. Its 106,071 ms task span includes 21,471 ms of
explicit coordination wait. Request-start, first-token, and model-completion
latencies were not observable and remain `null` with limitations instead of
being reported as zero. The measurement-only control publishes its result to
the parent task but does not create or merge a PR; those external phases remain
unobserved rather than simulated.

The schooled evidence is bound to its recorded audit cutoff. It preserves the
six-role, 305-call diagnosis and exposes the difference between active spans
and the longer event span, while explicitly recording that the sanitized
tables cannot reproduce separate implementation, publication, merge, and
cleanup time boundaries. No adopter inventory or additional consumer rollout
is needed to proceed to owner ratification.

The same publisher case is recorded before and after optimization. A disposable
worktree may isolate that repository revision, but no standalone synthetic or
test repository is created and no consumer repository is modified. Existing
small fixtures remain unit-test evidence only and cannot satisfy the performance
baseline. Cached input remains part of raw input and is never added twice.
Reasoning output remains part of output. Raw rollout usage is not billed API
cost or exact subscription-credit consumption. Prompt and source bodies are
not copied into measurement evidence.

## Ratified structural optimization contract

`TE-00` records exact comparison tasks and their observed costs.
`TE-00-OWNER` ratifies structural correction rather than a numeric reduction
contest. Token, byte, call, tool, and elapsed-time values remain before/after
diagnostic evidence. They help verify that a change addressed the reproduced
waste, but no fixed percentage is a standalone pass condition.

- preserve 100% of the PV-19 current-page, invariant, conflict, implementation
  source, status-plus-authority, non-current-label, expected-change, and Wiki
  action expectations, with zero new coverage or drift escapes;
- remove repeated full-body expansion and broad rereading while retaining
  explicit full mode;
- remove duplicate review input and oversized successful output that add no
  authority, source, conflict, or diagnostic information;
- remove repeated discovery, avoidable polling, and unnecessary role or phase
  round trips caused by repository guidance or artifact boundaries;
- report before/after values under the same task, model, effort, and
  orchestration policy, attributing external cache, approval, routing, and
  provider-latency effects instead of hiding them.

Engine-owned criteria and end-to-end observations remain separate. A Guardian
cache miss or provider latency event cannot be hidden to make the engine pass,
but it also cannot be presented as something repository code controls. If the
correctness floor and a smaller or faster representation conflict, correctness
wins and the structural defect remains open for another bounded solution rather
than being hidden behind a percentage.

## Planned design

### Bound round trips before expanding implementation scope

The first implementation work is `TE-05`. Exact-revision context artifacts
should be reusable across authoring and implementation roles, independent reads
and deterministic checks should be batchable, successful output should default
to bounded summaries with digest-addressable full evidence, and callers should
avoid repeated discovery and polling. A material phase boundary may use a
bounded handoff before publication. None of these rules bypasses approval,
validation, failure diagnostics, or independent review.

### Compact context and bounded discovery as one semantic change

`TE-01` and `TE-02` keep stable IDs but ship in one PR. Default projections
answer what controls the task, which conflicts apply, which source paths must
be read, and which command opens the next layer. Full bodies remain available
through an explicit mode. When no complete search match exists, deterministic
candidate metadata appears before body expansion. Text and JSON remain two
renderings of one semantic model.

### Focus exact review inputs

`TE-04` stores each exact Wiki body once, uses manifest roles for affected and
invariant relationships, and distinguishes changed, directly affected, test,
and supporting sources. It measures reviewer model calls and active time in
addition to bytes. Diff, metadata, current authority, conflicts, exact HEAD,
merge base, digest binding, and reviewer independence remain mandatory.

### Partition source authority only when evidence activates it

`TE-03` is deferred. It activates only when the controlled publisher case proves
that a broad declaration structurally adds unrelated required-source breadth
and a coherent shadow partition removes that waste without a coverage, impact,
or review-completeness escape. If that condition never appears, no
source-authority restructuring is performed.

### Keep engine and orchestrator claims separate

Wiki SSOT requires the authoring context and, when selected by policy, a
separate context-isolated reviewer. Explorer, worker, Guardian, approval cache,
phase compaction, and multi-lens fan-out belong to the orchestrator boundary.
Repository guidance may provide bounded artifacts and safer procedures, but it
cannot promise external model routing, cache continuity, provider latency,
approval policy, billing, or subscription behavior.

## Delivery order

1. Revise this proposal contract before measuring or implementing anything.
2. `TE-00` records the schooled diagnosis and freezes the exact publisher byte,
   rollout, and performance before baseline without measuring other adopters.
3. `TE-00-OWNER` records the owner's rejection of fixed percentage gates and
   ratification of structural waste removal, correctness, controls, measurement
   interpretation, and limitations.
4. `TE-05` reduces orchestration round trips and defines reusable bounded
   context boundaries first.
5. `TE-01` and `TE-02` ship as one PR for compact context and bounded
   discovery, with separate acceptance evidence for both stable IDs.
6. `TE-04` focuses exact review inputs and measures reviewer calls and time.
7. `TE-03` runs only if its recorded activation threshold is met.
8. `TE-06` reruns the same controlled publisher scenario on the exact combined
   revision, while existing kit and adoption suites prove portable correctness,
   and prepares token plus performance exit evidence.
9. `TE-06-OWNER` records the final owner decision.

Every behavior change updates current Wiki, code, tests, generated artifacts,
verification state, kit output, and adoption documentation together. A new
commit or semantic metadata change still invalidates exact-HEAD review. The
combined `TE-01` and `TE-02` delivery is the one explicitly recorded exception
to the normal one-work-item-per-PR split.

## Non-goals and limits

- This proposal does not change current context, search, source mapping, review,
  agent-entrypoint, or CI behavior.
- It does not put an LLM, tokenizer, model call, or provider API in the
  deterministic engine or CI.
- It does not equate UTF-8 bytes, raw rollout tokens, cached tokens, billed API
  cost, or subscription credits.
- It does not weaken current authority labels, conflict closure, source
  traceability, coverage, staleness, impact, or exact-HEAD attestation.
- It does not permit the authoring context to self-attest when independent
  review is required.
- It does not claim that a repository can enforce external model routing,
  optional subagent policy, Guardian or approval caching, provider latency, or
  billing.
- It does not inventory or remeasure consumer repositories, create a standalone
  synthetic or test repository for performance evidence, or modify or publish
  comparison changes to an adopter repository.
- It does not activate the parked Primary interpretation expansion or the
  deferred `PV-13` through `PV-27` work.

## Exit gate

TE-06 completed against exact combined publisher revision
`76e5d97a410d8e67659835e059e7b721541113c5`. All eight Primary scenarios,
portable kit and adoption suites, selected-work/context checks, and focused
exact-review checks passed. The three controlled default text outputs fell from
55,043, 114,294, and 66,479 bytes at TE-00 to 13,617, 3,893, and 16,253 bytes,
respectively, while explicit full output remained available and compact/full
semantic digests matched.

The same one-agent `gpt-5.6-sol / high` control ran the same fixed five-surface
TE-00 task: task digest
`4812fe4f0e227750fc1051dc14327c8739c327ae2358e90c97f4c10a90f9f00d`
binds all selectors and the byte-identical review-candidate recipe. Model calls
fell from eight to two, tool-protocol calls from seven to one, raw input from
218,077 to 50,469 tokens, uncached input from 10,205 to 5,925 tokens, output
from 3,607 to 480 tokens, sanitized result bytes from 5,190 to 1,082, and
active wall time from 106,071 ms to 18,386 ms. Coordination wait fell from
21,471 ms to zero. The broader correctness suite remained separate from this
controlled rollout. Request-start, first-token, and completion latency remain
unavailable, and no Guardian, external merge, or separate cleanup phase was
observed.

Recursive TypeScript source bytes grew from 588,463 to 842,820 and the
same-recipe raw review comparison grew from 60,946 to 75,912. Those repository
growth diagnostics are not presented as efficiency gains. Exact focused review
still passes with portable correctness, source breadth 7, and 49,937 non-diff
bytes, so the growth alone does not activate deferred TE-03.

The machine report digest is
`50ee372d28282fd8388d42a62703e58da6a2fdc4ff6e24ece78c08610036b7c8`.
It records no remaining correctness miss and leaves all three owner outcomes
unselected. TE-03 remains deferred because this evidence does not show its
recursive-source partition activation condition.

`TE-06` may pass only when the exact combined publisher revision satisfies the
current Primary correctness contract, portable kit and adoption regressions,
and removes the reproduced structural waste on the same controlled case while
reporting before/after token and performance observations. The
final evidence keeps the schooled diagnosis, deterministic engine
measurements, controlled publisher rollout, latency, cache effects, approval
behavior, and orchestration choices visibly separate. `TE-06-OWNER` then
records one of three outcomes: publisher efficiency validated with portable
correctness preserved, another bounded efficiency cycle, or the optimization
not adopted.
