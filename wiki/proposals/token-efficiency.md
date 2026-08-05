---
id: proposal/token-efficiency
summary: Reduce Wiki SSOT context and review token usage with measured compact projections, bounded discovery, narrower source authority, deduplicated review bundles, and controlled end-to-end evidence.
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
  - path: scripts/wiki/token-efficiency-baseline.ts
  - path: scripts/wiki/token-efficiency-baseline.test.ts
  - path: docs/evidence/pv-19-primary-current.json
  - path: docs/evidence/pv-19-primary-current.md
  - path: docs/evidence/te-00-controlled-rollout.json
  - path: docs/evidence/te-00-token-efficiency-baseline.json
  - path: docs/evidence/te-00-token-efficiency-baseline.md
affects: [product/scope, product/invariants, architecture/engine, operations/enforcement]
related: [proposal/primary-findability-validation, product/scope, product/invariants, architecture/engine, operations/enforcement]
tags: [roadmap, token, context, efficiency, search, sources, review, orchestration]
work_items:
  - id: TE-00
    title: Capture the token-efficiency measurement baseline
    state: done
    executor: agent
    priority: high
    depends_on: []
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - A versioned deterministic fixture reproduces representative topic context, selected-work context, source-expansion, and review-bundle byte measurements against an exact repository revision.
      - A controlled rollout record reports per-agent model and effort, model-call count, raw input, cached input, derived uncached input, output, and total tokens without presenting them as billed cost or subscription credits.
      - The baseline separates deterministic repository byte metrics from model- and orchestrator-dependent rollout metrics.
      - The evidence presents the correctness floor, proposed optimization targets, comparison task, model and effort controls, accepted variance options, and any measurement limitations for owner ratification.
      - Baseline evidence includes the current real-repository queries and selected-work case recorded on this page rather than relying only on small synthetic fixtures.
    evidence:
      - scripts/wiki/token-efficiency-baseline.test.ts
      - docs/evidence/te-00-controlled-rollout.json
      - docs/evidence/te-00-token-efficiency-baseline.json
      - docs/evidence/te-00-token-efficiency-baseline.md
  - id: TE-00-OWNER
    title: Ratify the token-efficiency comparison contract and budgets
    state: not-started
    executor: human
    priority: high
    depends_on: [TE-00]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - The owner explicitly ratifies the correctness floor, optimization targets, comparison task, model and effort controls, and accepted variance before implementation begins.
      - Any changed threshold or accepted measurement limitation is recorded with its rationale in durable proposal or evidence content.
      - The decision does not authorize weakening current authority, conflicts, source traceability, coverage, impact, or independent-review invariants.
    evidence: []
  - id: TE-01
    title: Add compact context projections with explicit full expansion
    state: not-started
    executor: agent
    priority: high
    depends_on: [TE-00-OWNER]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Default topic and selected-work context retain every controlling current page, invariant, conflict, status, authority, wiki path, declared source, expanded source path, and authoritative read-order entry required by the current contract.
      - The default projection avoids embedding complete current and non-current page bodies and repeated source lists when stable paths, summaries, hashes, and focused follow-up commands carry the same routing information.
      - An explicit full-output mode remains available for exhaustive inspection and is documented for callers that need the complete historical text representation.
      - Text and JSON compact projections carry the same semantic fields, deterministic ordering, and clear current versus non-current separation.
      - Focused regressions prove that compact output meets the ratified byte target without reducing PV-19 authority, conflict, source, status, or expected-action recall.
      - Any change to the current context-completeness contract updates current Wiki pages, code, tests, and downstream kit documentation in the same implementation PR.
    evidence: []
  - id: TE-02
    title: Bound partial-match discovery before full context expansion
    state: not-started
    executor: agent
    priority: high
    depends_on: [TE-00-OWNER]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Complete all-term matches preserve the current deterministic selection behavior and every focused PV-07 regression.
      - When no complete match exists, discovery returns a compact deterministic candidate projection instead of expanding every partial match into full page bodies.
      - Every candidate remains reachable through an explicit focused page, work, or conflict context command, with deterministic pagination or continuation when a bounded candidate view is used.
      - Stop-word, score, field-weighting, or result-limit choices are justified by reproduced real-repository misses and do not silently hide a controlling current page or open conflict.
      - The broad token-efficiency diagnostic query no longer produces an unbounded multi-page body expansion, while JSON and text results remain semantically aligned.
    evidence: []
  - id: TE-03
    title: Partition the recursive engine source authority boundary
    state: not-started
    executor: agent
    priority: high
    depends_on: [TE-00-OWNER]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - The monolithic scripts/wiki TypeScript source declaration is replaced or complemented by coherent current authority pages and bounded exact or glob declarations for engine core, install and kit, review integration, and publishing-only validation evidence.
      - Every file covered by .wiki/coverage.json remains mapped to at least one current page or a reasoned exclusion, and independent code-only probes continue to fail enforced impact when Wiki reconciliation is absent.
      - A context-renderer change no longer directs the reader through unrelated adoption, historical-baseline, and publishing-only test sources merely because all TypeScript files share one recursive page declaration.
      - Cross-cutting core files remain mapped to every current contract they genuinely implement; the optimization cannot obtain smaller context by weakening source traceability.
      - Recursive scripts/wiki high-risk and Fresh-context selection remain intact unless a separately approved current contract changes them.
      - Generated source maps, current status, architecture pages, verification state, focused tests, and downstream kit behavior are reconciled together.
    evidence: []
  - id: TE-04
    title: Deduplicate and focus exact-HEAD review bundles
    state: not-started
    executor: agent
    priority: high
    depends_on: [TE-00-OWNER, TE-03]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - A Wiki page that is both affected authority and an invariant is stored once in the bundle, with manifest roles referencing the same content digest instead of duplicating its body.
      - The bundle deterministically distinguishes changed sources, directly affected authority sources, relevant tests, conflicts, and supporting sources without treating a broad declaration as permission to omit a necessary primary source.
      - Diff, metadata, current pages, invariants, conflicts, source declarations, exact HEAD, merge base, and bundle digest remain bound and independently checkable.
      - The context-isolated reviewer requirement and classification-to-disposition contract remain unchanged; no optimization permits author self-PASS or stale attestation reuse.
      - Adversarial tests fail when a required page, invariant, conflict, changed source, relevant test, or digest binding is absent or misclassified.
      - The reproduced review candidate reduces non-diff bundle bytes and reviewer source breadth against TE-00 while retaining an exact PASS on the unchanged semantic fixture.
    evidence: []
  - id: TE-05
    title: Make orchestration cost and reusable context boundaries explicit
    state: not-started
    executor: agent
    priority: normal
    depends_on: [TE-01, TE-02, TE-03, TE-04]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Repository guidance distinguishes mandatory Wiki SSOT roles and gates from optional provider-specific explorer, worker, guardian, or multi-lens orchestration.
      - A bounded machine-readable context artifact can be handed to an implementation or review context without requiring each role to repeat broad topic discovery against the same Wiki revision.
      - Reuse is invalidated by changed controlling page, source, conflict, metadata, base, or HEAD digests and never substitutes stale context for required direct source inspection.
      - The authoring context and required independent reviewer remain separate, while optional role fan-out is measured and justified by task risk rather than presented as an engine requirement.
      - Adoption and agent-entrypoint guidance remain provider-neutral and make no claim that the repository can control external orchestration policy or billing.
    evidence: []
  - id: TE-06
    title: Validate token-efficiency gains and prepare exit evidence
    state: not-started
    executor: agent
    priority: high
    depends_on: [TE-01, TE-02, TE-03, TE-04, TE-05]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - The current Primary scenario suite and new real-repository efficiency scenarios run against one exact combined revision with no authority, invariant, conflict, source, status, expected-action, coverage, impact, or review regression.
      - Default context output satisfies the ratified deterministic byte budget for every reproduced topic and selected-work case, and full mode remains available for exhaustive inspection.
      - A controlled end-to-end pilot reports per-agent raw, cached, and uncached usage and satisfies the ratified uncached-input target under the same comparison task, model, effort, and orchestration policy.
      - Evidence separates engine-owned gains from optional orchestration gains and from cache-accounting effects.
      - Remaining misses are classified as a concrete defect, owner decision, orchestrator limitation, or explicitly accepted limitation.
      - The evidence presents token efficiency validated, another bounded cycle, and not adopted as explicit owner-decision options without selecting one on the owner's behalf.
    evidence: []
  - id: TE-06-OWNER
    title: Record the token-efficiency owner exit decision
    state: not-started
    executor: human
    priority: high
    depends_on: [TE-06]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - The owner records token efficiency validated, another bounded efficiency cycle, or the optimization not adopted against the exact TE-06 evidence.
      - The decision names any accepted limitations and does not silently weaken a current Wiki SSOT invariant.
      - The durable decision evidence closes the proposal cycle or names the exact bounded follow-up work.
    evidence: []
---

# Token-efficient Wiki SSOT

This proposal turns the observed context and rollout cost problem into bounded,
measurable repository work. It is a `status: proposed` plan, not a statement of
current behavior. `TE-00` has recorded the durable deterministic and controlled
rollout baseline. `TE-00-OWNER` now requires explicit human ratification before
implementation items become ready. Later items remain waiting on their declared
dependencies. Queue readiness does not authorize implementation beyond a
separately requested task.

The goal is not to make the Wiki smaller by hiding authority. The goal is to
preserve the same current pages, invariants, conflicts, source traceability,
coverage, exact-HEAD review, and deterministic gates while avoiding repeated
full-body expansion and unnecessary re-reading across agent contexts.

## Reproduced repository baseline

The initial diagnosis was reproduced at exact repository revision
`cf128d5e76cc40c0f3d48db0e3873e29d6468e00`. These are deterministic UTF-8
byte measurements, not model-token or billing claims:

| Surface | Reproduction | Lines | Words | Bytes |
|---|---|---:|---:|---:|
| Mandatory entry documents | `wc AGENTS.md wiki/index.md wiki/current-status.md wiki/product/invariants.md` | 135 | 2,367 | 16,940 |
| Focused diagnostic topic | `wiki:context "token context bundle review"` | 706 | 6,676 | 55,046 |
| Broad partial-match topic | `wiki:context "token context runtime cost efficiency"` | 1,223 | 11,599 | 92,758 |
| Selected proposed work | `wiki:context --work PV-20` | 738 | 8,191 | 65,031 |
| Recursive TypeScript source boundary | all `scripts/wiki/**/*.ts` files | 12,647 | 55,073 | 588,463 |

The broad topic query returns four current pages and two proposed rationale
pages because no all-term match exists and every positive partial match is
expanded. The renderer then embeds each selected page body and repeats source
declarations, glob matches, expanded paths, and read-order paths. The selected
work path always adds all current invariants and includes the complete owning
proposal after current authority.

A reconstruction of the latest merged executor candidate against first parent
`ba84625e189f7ec59838ca8eead355b49791c879` produced a 201,631-byte review
bundle: 138,661 bytes of diff and 62,970 bytes of non-diff review material. The
same `product/invariants` body appeared under both affected pages and
invariants. This is a diagnostic sample that `TE-00` must turn into a checked-in
reproduction contract before review-bundle optimization begins.

TE-00 now reproduces these values with the checked-in version 1 fixture and
machine-readable evidence. The review directory contains 201,701 raw bytes;
the recorded comparison excludes the 70-byte serialized `bundle_digest`
binding and therefore retains the original 201,631-byte comparison contract.
The evidence preserves both values instead of rewriting raw file sizes.

The controlled read-only comparison used one `gpt-5.6-sol` agent at `high`
effort with no child or guardian agents. The sanitized local-rollout record
contains 25 positive usage increments, 1,241,104 raw input tokens including
1,158,912 cached input tokens, 82,192 derived uncached input tokens, 8,520
output tokens including 3,737 reasoning-output tokens, and 1,249,624 total
tokens. These are raw local rollout measurements, not billed API cost or
subscription-credit consumption. The owner brief leaves the ratification
decision unselected.

PV-19 deliberately states that context byte counts are not runtime or
model-token guarantees. The new baseline therefore has two distinct layers:

1. deterministic repository metrics such as output bytes, selected page and
   source counts, bundle component bytes, and recall;
2. controlled rollout metrics such as model calls, per-agent raw input, cached
   input, derived uncached input, output, and total usage.

Cached input remains part of raw input and must never be added a second time.
Reasoning output remains part of output. Rollout counts are local execution
evidence, not billed API cost or exact subscription-credit consumption.

## Proposed optimization targets

`TE-00` records the exact comparison tasks and prepares any proposed numeric
refinement. `TE-00-OWNER` freezes the contract before implementation. The
initial targets are:

- preserve 100% of the PV-19 current-page, invariant, conflict, implementation
  source, status-plus-authority, non-current-label, expected-change, and Wiki
  action expectations, with zero new coverage or drift escapes;
- reduce default text and JSON context bytes to at most 40% of the reproduced
  baseline for every selected real-repository topic and work case, while
  retaining an explicit exhaustive mode;
- prevent broad partial-match discovery from expanding full page bodies before
  the caller selects focused authority;
- remove duplicate Wiki bodies from review bundles and reduce both non-diff
  bundle bytes and the number of primary sources a reviewer must inspect for
  the controlled candidate;
- reduce uncached input to at most 60% of the controlled end-to-end baseline
  under the same task, model, effort, and orchestration policy.

If the deterministic correctness floor and a numeric target conflict, the
correctness floor wins and the owner records another bounded cycle or an
explicitly accepted limitation. A target may not be met by dropping authority,
sources, conflicts, tests, coverage, or review evidence.

## Planned design

### Compact context before exhaustive content

The default projection should answer what controls the task, why it is current,
which conflicts apply, which source paths must be read, and what focused
command opens the next layer. Full Wiki bodies and exhaustive rationale remain
available through an explicit mode. Compact text and JSON are two renderings of
one semantic model rather than separate contracts.

### Candidate discovery before page expansion

Search remains a discovery surface. When no complete match exists, the engine
should return deterministic candidate metadata and focused follow-up commands
before it emits complete bodies for every partial match. Bounded presentation
must not make lower-ranked authority unreachable or silently discard a related
open conflict.

### Narrow authority without coverage gaps

The recursive engine coverage and high-risk boundaries remain safety rails.
The optimization is to divide current observed architecture into coherent
source ownership so a context-renderer task does not inherit adoption,
historical-baseline, and publishing-only sources. Cross-cutting sources may
still map to several pages when they genuinely implement several contracts.

### One copy of each exact review input

The bundle should store each Wiki body once and express its affected-page,
invariant, or conflict roles in the manifest. A focused source manifest should
make changed, directly affected, test, and supporting sources explicit while
retaining fail-closed tests for omissions. Exact HEAD, merge base, metadata,
diff, current authority, conflicts, and reviewer independence remain mandatory.

### Separate engine requirements from orchestration choices

Wiki SSOT requires the authoring context and, when selected by policy, a
separate context-isolated reviewer. Explorer, implementation worker, guardian,
and multi-lens fan-out are orchestrator choices. Repository guidance should
state that boundary and provide bounded reusable context artifacts, but it
cannot promise how an external orchestrator routes models, caches prompts, or
charges usage.

## Delivery order

1. `TE-00` records the exact byte and controlled rollout baseline.
2. `TE-00-OWNER` requires the owner to ratify budgets before optimization code
   is written.
3. `TE-01`, `TE-02`, and `TE-03` can proceed independently after ratification:
   compact projection, bounded discovery, and narrower source authority.
4. `TE-04` follows the source-boundary work and optimizes exact review inputs.
5. `TE-05` reconciles repository and adoption guidance with the new bounded
   artifacts and clarifies optional orchestration fan-out.
6. `TE-06` runs the combined deterministic and controlled-agent evaluation and
   prepares the exit evidence.
7. `TE-06-OWNER` requires the owner to record the final exit decision.

Each implementation item is one coherent PR unless the exact work contract
records an inseparable dependency. Every behavior change updates current Wiki,
code, tests, generated artifacts, verification state, kit output, and adoption
documentation together. A new commit or semantic metadata change still
invalidates an exact-HEAD review.

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
  optional subagent policy, cache behavior, or billing.
- It does not activate the parked Primary interpretation expansion or the
  deferred `PV-13` through `PV-27` work.

## Exit gate

`TE-06` may pass only when the exact combined revision satisfies the current
Primary correctness contract and the ratified efficiency budgets. The final
evidence must keep deterministic engine measurements, controlled rollout
measurements, cache effects, and orchestration choices visibly separate.
`TE-06-OWNER` then records one of three outcomes: token efficiency validated,
another bounded efficiency cycle, or the optimization not adopted.
