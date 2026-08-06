---
id: proposal/token-efficiency
summary: Reduce cross-repository Wiki SSOT model calls, context and review input, and active execution time with measured bounded artifacts and controlled end-to-end evidence.
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
  - path: scripts/wiki/fresh-context.test.ts
  - path: scripts/wiki/primary-scenarios.ts
  - path: scripts/wiki/primary-current.ts
  - path: docs/evidence/pv-19-primary-current.json
  - path: docs/evidence/pv-19-primary-current.md
affects: [product/scope, product/invariants, architecture/engine, operations/enforcement]
related: [proposal/primary-findability-validation, product/scope, product/invariants, architecture/engine, operations/enforcement]
tags: [roadmap, token, performance, latency, context, efficiency, search, sources, review, orchestration]
work_items:
  - id: TE-00
    title: Capture the cross-repository token and performance baseline
    state: not-started
    executor: agent
    priority: high
    depends_on: []
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - A frozen inventory identifies every owner-visible repository carrying the installed Wiki SSOT markers, records exact repository HEAD and toolkit version where available, and explicitly records excluded or unavailable repositories instead of silently treating the publisher as the whole population.
      - Versioned deterministic fixtures reproduce representative focused topic, broad discovery, selected-work, source-expansion, and review-bundle measurements against every inventoried repository revision, with one common controlled scenario and repository-specific real cases kept distinct.
      - Controlled rollout records report per-agent role, model and effort, model-call count, raw input, cached input, derived uncached input, output, total tokens, input distribution, compaction, tool calls, artifact bytes, and successful outcome without presenting them as billed cost or subscription credits.
      - Performance evidence reports model request, first-token and completion latency when available, tool duration, approval wait, coordination wait, active wall time excluding user idle, and phase-level implementation, publication, merge, and cleanup measurements.
      - The baseline separates deterministic repository bytes, engine-owned behavior, model- and orchestrator-dependent rollout metrics, cache effects, approval-system behavior, and measurement limitations; it incorporates the existing schooled session 019fd1e6-816a-7742-b356-f28c945d6110 as a real adopter case without exposing prompt or source bodies.
      - Evidence presents the correctness floor, proposed optimization targets, comparison tasks, model and effort controls, accepted variance options, and every limitation needed for owner ratification before implementation begins.
    evidence: []
  - id: TE-00-OWNER
    title: Ratify the cross-repository efficiency and performance contract
    state: not-started
    executor: human
    priority: high
    depends_on: [TE-00]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - The owner explicitly ratifies the adopter inventory, correctness floor, optimization targets, comparison tasks, model and effort controls, latency instrumentation, and accepted variance before implementation begins.
      - Any changed threshold or accepted measurement limitation is recorded with its rationale in durable proposal or evidence content.
      - Engine-owned pass criteria remain separate from Guardian, provider cache, model routing, and other external-orchestrator observations that the repository cannot enforce.
      - The decision does not authorize weakening current authority, conflicts, source traceability, coverage, impact, exact-HEAD binding, or independent-review invariants.
    evidence: []
  - id: TE-01
    title: Add compact context projections with explicit full expansion
    state: not-started
    executor: agent
    priority: high
    depends_on: [TE-00-OWNER, TE-05]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Default topic and selected-work context retain every controlling current page, invariant, conflict, status, authority, wiki path, declared source, expanded source path, and authoritative read-order entry required by the current contract.
      - The default projection avoids embedding complete current and non-current page bodies and repeated source lists when stable paths, summaries, hashes, and focused follow-up commands carry the same routing information.
      - An explicit full-output mode remains available for exhaustive inspection and is documented for callers that need the complete historical text representation.
      - Text and JSON compact projections carry the same semantic fields, deterministic ordering, and clear current versus non-current separation.
      - Focused regressions across the frozen adopter inventory prove that compact output meets the ratified byte and performance targets without reducing PV-19 authority, conflict, source, status, or expected-action recall.
      - Any change to the current context-completeness contract updates current Wiki pages, code, tests, and downstream kit documentation in the same implementation PR.
      - TE-01 and TE-02 ship as one inseparable implementation PR because they change the same search, semantic context, text, JSON, test, and adoption surfaces; each stable work ID retains its own acceptance evidence.
    evidence: []
  - id: TE-02
    title: Bound partial-match discovery before full context expansion
    state: not-started
    executor: agent
    priority: high
    depends_on: [TE-00-OWNER, TE-01, TE-05]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Complete all-term matches preserve the current deterministic selection behavior and every focused PV-07 regression.
      - When no complete match exists, discovery returns a compact deterministic candidate projection instead of expanding every partial match into full page bodies.
      - Every candidate remains reachable through an explicit focused page, work, or conflict context command, with deterministic pagination or continuation when a bounded candidate view is used.
      - Stop-word, score, field-weighting, or result-limit choices are justified by reproduced real-repository misses and do not silently hide a controlling current page or open conflict.
      - The broad token-efficiency diagnostic query and every frozen adopter equivalent no longer produce an unbounded multi-page body expansion, while JSON and text results remain semantically aligned.
      - TE-01 and TE-02 ship as one inseparable implementation PR, and the combined candidate satisfies both work contracts before either item is marked done.
    evidence: []
  - id: TE-03
    title: Partition the recursive engine source authority boundary
    state: deferred
    executor: agent
    priority: high
    depends_on: [TE-00-OWNER]
    deferred_reason: Activate only when measured adopter evidence shows that a broad source declaration adds unrelated required-source breadth and a shadow partition reduces required-source count or bytes by at least 20% without weakening coverage, impact, or review completeness.
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Before activation, exact baseline or shadow evidence identifies the affected adopter, task, unrelated source families, required-source count and bytes, and a partition that reduces that measured breadth by at least 20%.
      - Once activated, the monolithic scripts/wiki TypeScript source declaration is replaced or complemented by coherent current authority pages and bounded exact or glob declarations for engine core, install and kit, review integration, and publishing-only validation evidence.
      - Every file covered by .wiki/coverage.json remains mapped to at least one current page or a reasoned exclusion, and independent code-only probes continue to fail enforced impact when Wiki reconciliation is absent.
      - A context-renderer change no longer directs the reader through unrelated adoption, historical-baseline, and publishing-only test sources merely because all TypeScript files share one recursive page declaration.
      - Cross-cutting core files remain mapped to every current contract they genuinely implement; the optimization cannot obtain smaller context by weakening source traceability.
      - Recursive scripts/wiki high-risk and Fresh-context selection remain intact unless a separately approved current contract changes them.
      - Generated source maps, current status, architecture pages, verification state, focused tests, and downstream kit behavior are reconciled together.
    evidence: []
  - id: TE-04
    title: Focus exact-HEAD review inputs and reduce reviewer round trips
    state: not-started
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
      - Reproduced review candidates across the frozen adopter inventory reduce non-diff bundle bytes, reviewer source breadth, model-call count, and reviewer active time against TE-00 while retaining exact PASS on unchanged semantic fixtures.
    evidence: []
  - id: TE-05
    title: Bound orchestration round trips and reusable context boundaries
    state: not-started
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
      - Focused controlled runs reduce primary model calls, publication-phase calls, and active wall time against TE-00 without bypassing validation, approval, exact-HEAD review, or failure diagnostics.
      - Adoption guidance makes no claim that the repository can control Guardian cache continuity, approval policy, external model routing, provider latency, subscription accounting, or other orchestrator behavior.
    evidence: []
  - id: TE-06
    title: Validate cross-repository token and performance gains
    state: not-started
    executor: agent
    priority: high
    depends_on: [TE-01, TE-02, TE-04, TE-05]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - The current Primary scenario suite, common controlled scenario, and every frozen adopter efficiency scenario run against exact combined revisions with no authority, invariant, conflict, source, status, expected-action, coverage, impact, or review regression.
      - Default context output satisfies the ratified deterministic byte budget for every reproduced topic and selected-work case, and full mode remains available for exhaustive inspection.
      - Controlled end-to-end pilots report per-agent calls, raw, cached and uncached usage, input distribution, model latency, tool time, approval time, active wall time, and phase timing, and satisfy ratified targets under the same comparison task, model, effort, and orchestration policy.
      - Evidence separately evaluates engine-owned gains, repository guidance and optional orchestration gains, cache-accounting effects, Guardian and approval behavior, and provider limitations.
      - If TE-03 remains deferred, evidence proves its activation threshold is still unmet; if it was activated, the exact combined revisions include its completed evidence before exit evaluation.
      - Remaining misses are classified as a concrete defect, owner decision, orchestrator limitation, or explicitly accepted limitation.
      - The evidence presents token efficiency validated, another bounded cycle, and not adopted as explicit owner-decision options without selecting one on the owner's behalf.
    evidence: []
  - id: TE-06-OWNER
    title: Record the cross-repository efficiency owner exit decision
    state: not-started
    executor: human
    priority: high
    depends_on: [TE-06]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - The owner records cross-repository token and performance efficiency validated, another bounded efficiency cycle, or the optimization not adopted against the exact TE-06 evidence.
      - The decision names any accepted limitations and does not silently weaken a current Wiki SSOT invariant.
      - The durable decision evidence closes the proposal cycle or names the exact bounded follow-up work.
    evidence: []
---

# Token- and time-efficient Wiki SSOT

This proposal turns observed context, rollout, and elapsed-time problems into
bounded cross-repository work. It is a `status: proposed` plan, not a statement
of current behavior. `TE-00` first freezes every owner-visible adopter and
records a durable baseline. `TE-00-OWNER` then requires explicit human
ratification before implementation items become ready. Queue readiness does not
authorize implementation beyond a separately requested task.

The goal is not to make the Wiki smaller or faster by hiding authority. The
goal is to preserve the same current pages, invariants, conflicts, source
traceability, coverage, exact-HEAD review, and deterministic gates while
reducing unnecessary model calls, repeated full-body expansion, broad
re-reading, oversized successful output, approval churn, and active wall time.

## Preliminary observations, not the baseline

Earlier publisher-only byte samples exposed broad context expansion and review
input duplication, but they do not represent every repository using Wiki SSOT.
They remain diagnostic history only; `TE-00` must replace them with a frozen
adopter inventory and exact per-repository evidence.

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

This evidence shows that token volume and elapsed time cannot be assigned to
one engine surface. The durable baseline must measure sequential model/tool
round trips, context and review breadth, successful test output, approval
behavior, cache misses, and phase timing separately. It also confirms that
external Guardian cache continuity is an orchestrator observation, not an
engine guarantee.

## Cross-repository measurement contract

`TE-00` freezes the population before measuring it. The inventory includes
every owner-visible repository carrying the installed Wiki SSOT configuration,
managed entrypoint, and canonical command seams. It records exact HEAD and
toolkit version where available, and names exclusions or unavailable
repositories. The publisher is one member of that inventory, never a proxy for
all adopters.

The baseline has three explicitly separate layers:

1. deterministic repository metrics — text and JSON bytes, selected pages,
   source count and bytes, bundle component bytes, and correctness recall;
2. controlled rollout metrics — per-role model and effort, calls, raw input,
   cached input, derived uncached input, output, compaction, tool calls, and
   artifact bytes;
3. performance metrics — request, first-token and completion latency when
   observable, tool duration, approval and coordination wait, phase timing, and
   active wall time excluding user idle.

Each repository gets the same common controlled scenario plus its own real
cases. Cached input remains part of raw input and is never added twice.
Reasoning output remains part of output. Raw rollout usage is not billed API
cost or exact subscription-credit consumption. Prompt and source bodies are
not copied into measurement evidence.

## Proposed optimization targets

`TE-00` records exact comparison tasks and prepares numeric refinements.
`TE-00-OWNER` freezes the contract before implementation. The initial targets
presented for ratification are:

- preserve 100% of the PV-19 current-page, invariant, conflict, implementation
  source, status-plus-authority, non-current-label, expected-change, and Wiki
  action expectations, with zero new coverage or drift escapes;
- reduce default text and JSON context bytes to at most 40% of baseline for
  every controlled topic and selected-work case while retaining full mode;
- reduce primary model calls and primary active wall time to at most 70% of the
  comparable baseline;
- reduce publication-phase model calls to at most 50% of baseline;
- reduce controlled uncached input and review non-diff bytes to at most 60% of
  baseline under the same task, model, effort, and orchestration policy;
- allow no inventoried repository's comparable active wall time to regress by
  more than 10% without an explicit accepted limitation.

Engine-owned criteria and end-to-end observations remain separate. A Guardian
cache miss or provider latency event cannot be hidden to make the engine pass,
but it also cannot be presented as something repository code controls. If the
correctness floor and a numeric target conflict, correctness wins and the owner
records another bounded cycle or an accepted limitation.

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

`TE-03` is deferred. It activates only when a measured adopter case proves
that a broad declaration adds unrelated required-source breadth and a shadow
partition reduces required-source count or bytes by at least 20% without a
coverage, impact, or review-completeness escape. If that condition never
appears, no source-authority restructuring is performed.

### Keep engine and orchestrator claims separate

Wiki SSOT requires the authoring context and, when selected by policy, a
separate context-isolated reviewer. Explorer, worker, Guardian, approval cache,
phase compaction, and multi-lens fan-out belong to the orchestrator boundary.
Repository guidance may provide bounded artifacts and safer procedures, but it
cannot promise external model routing, cache continuity, provider latency,
approval policy, billing, or subscription behavior.

## Delivery order

1. Revise this proposal contract before measuring or implementing anything.
2. `TE-00` freezes the adopter inventory and records cross-repository byte,
   rollout, and performance baselines.
3. `TE-00-OWNER` requires explicit owner ratification of the inventory,
   correctness floor, budgets, controls, variance, and limitations.
4. `TE-05` reduces orchestration round trips and defines reusable bounded
   context boundaries first.
5. `TE-01` and `TE-02` ship as one PR for compact context and bounded
   discovery, with separate acceptance evidence for both stable IDs.
6. `TE-04` focuses exact review inputs and measures reviewer calls and time.
7. `TE-03` runs only if its recorded activation threshold is met.
8. `TE-06` reruns every frozen adopter and controlled scenario on exact
   combined revisions and prepares token plus performance exit evidence.
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
- It does not activate the parked Primary interpretation expansion or the
  deferred `PV-13` through `PV-27` work.

## Exit gate

`TE-06` may pass only when every exact combined adopter revision satisfies the
current Primary correctness contract and ratified token and performance
budgets. The final evidence keeps deterministic engine measurements,
controlled rollout measurements, latency, cache effects, approval behavior,
and orchestration choices visibly separate. It must also prove that `TE-03`'s
activation threshold remains unmet or include completed `TE-03` evidence.
`TE-06-OWNER` then records one of three outcomes: cross-repository efficiency
validated, another bounded efficiency cycle, or the optimization not adopted.
