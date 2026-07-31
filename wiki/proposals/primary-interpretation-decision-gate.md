---
id: proposal/primary-interpretation-decision-gate
summary: Parked Primary expansion requiring a pre-implementation Interpretation Contract, independent interpretation review, actual-diff Decision Brief, and owner approval only for risky or ambiguous semantic changes.
kind: proposal
status: proposed
authority: normative
owners: ["@phlox11"]
sources:
  - path: wiki/proposals/primary-findability-validation.md
  - path: docs/evidence/pv-12-primary-exit-gate.md
affects: [product/scope, product/invariants, architecture/engine, operations/enforcement]
related: [proposal/primary-findability-validation, product/scope, product/invariants, architecture/engine, operations/enforcement]
tags: [roadmap, primary, interpretation, decision-gate, human-approval, risk]
work_items:
  - id: PV-20
    title: Ratify the Primary interpretation-gate activation contract
    state: deferred
    priority: high
    depends_on: [PV-12]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - The owner explicitly reactivates the parked Primary expansion before implementation begins.
      - The approved scope, defaults, storage boundary, risk categories, non-goals, and staged dependency order remain decision-complete or are changed by an explicit owner decision.
      - Activation identifies the exact current pages and implementation surfaces that later work may change without treating this proposal as current behavior.
    evidence: []
    deferred_reason: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now.
  - id: PV-21
    title: Define versioned interpretation failure scenarios and capture a baseline
    state: deferred
    priority: high
    depends_on: [PV-20]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Versioned scenarios cover omitted authority, misread authority, scope drift, prohibited-behavior drift, ambiguous intent, reviewer risk escalation, low-risk changes, risky changes, stale approval, and attempted enforcement weakening.
      - Each scenario declares expected Interpretation Contract fields, deterministic facts, risk outcome, reviewer outcome, Decision Brief content, owner-decision requirement, and final gate result.
      - A baseline against the then-current engine distinguishes measured failures from hypotheses without rewriting the completed PV-05 or PV-19 evidence.
    evidence: []
    deferred_reason: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now.
  - id: PV-22
    title: Add the Interpretation Contract and intent preflight
    state: deferred
    priority: high
    depends_on: [PV-21]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Every PR declaring semantic_change true carries a structured Interpretation Contract with the required goal, context, authority, behavior, path, acceptance, risk, rollback, unknown, and owner-decision fields.
      - A future wiki:intent-preflight command deterministically validates the contract, prepares a bundle bound to the relevant base, metadata, context, authority sources, and contract digest, and emits no implementation authorization by itself.
      - A context-isolated reviewer can publish an Interpretation PASS or actionable reconciliation findings before implementation.
      - The engine and CI remain deterministic and invoke no LLM.
    evidence: []
    deferred_reason: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now.
  - id: PV-23
    title: Enforce final scope conformance and generate the Decision Brief
    state: deferred
    priority: high
    depends_on: [PV-22]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Final review compares the actual diff and evidence with the approved Interpretation Contract and reports intended, preserved, prohibited, path, and acceptance-case conformance.
      - The Decision Brief is derived from the actual candidate and distinctly presents computed facts, author claims, and reviewer escalations.
      - The final review and Decision Brief are bound to the exact candidate HEAD and Interpretation Contract digest.
      - Low-risk unambiguous changes can proceed without owner approval after required interpretation and final reviews pass.
    evidence: []
    deferred_reason: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now.
  - id: PV-24
    title: Add authenticated owner decision and GitHub Ready validation
    state: deferred
    priority: high
    depends_on: [PV-23]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Risky or ambiguous changes require an explicit authenticated owner decision; low-risk unambiguous changes deterministically record that owner approval is not required.
      - The owner-decision attestation binds the exact HEAD, Interpretation Contract, final review, and Decision Brief digests.
      - The PR body mirrors the selected authenticated PR-comment state without becoming the trusted evidence channel.
      - Ready-only validation rejects missing, malformed, untrusted, or stale required interpretation, final-review, brief, or owner-decision evidence while running no LLM.
    evidence: []
    deferred_reason: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now.
  - id: PV-25
    title: Preserve kit and config-v2 compatibility and adoption
    state: deferred
    priority: high
    depends_on: [PV-24]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - A versioned configuration contract introduces the new policy without silently changing existing adopters.
      - Kit generation, sync, upgrade, doctor, templates, documentation, and GitHub reference integration carry the same interpretation and decision-gate semantics.
      - Solo procedural separation and optional team distinct-actor policy remain explicit and testable.
      - Existing adopter-owned policy and repository-specific authority remain preserved through upgrade.
    evidence: []
    deferred_reason: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now.
  - id: PV-26
    title: Run isolated new- and existing-repository pilots
    state: deferred
    priority: high
    depends_on: [PV-25]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Isolated pilots exercise semantic changes in both new- and existing-repository adoption paths from documented starting states.
      - Pilot evidence includes at least one low-risk unambiguous path and one risky or ambiguous path requiring an exact owner decision.
      - The pilots preserve the exact prompts, contracts, bundles, reviews, briefs, decisions, candidate bindings, misses, and deterministic gate outcomes without adding per-change wiki process artifacts.
      - Any ambiguity about current product behavior becomes a conflict or explicit owner decision rather than an inferred implementation.
    evidence: []
    deferred_reason: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now.
  - id: PV-27
    title: Evaluate the final current engine and record the owner exit decision
    state: deferred
    priority: high
    depends_on: [PV-26]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - A deterministic current-engine report evaluates every versioned interpretation scenario and both pilots against one exact revision.
      - The report separates enforced guarantees from procedural, reviewer-judgement, provider, and trusted-maintainer limits.
      - Remaining misses are classified as concrete defects, owner decisions, or explicitly accepted limitations.
      - The owner records whether the Primary interpretation expansion is validated, needs another bounded cycle, or is not adopted.
    evidence: []
    deferred_reason: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now.
---

# Primary interpretation and decision gate

This page records an owner-approved expansion of Primary, but it is deliberately
parked. It is a `status: proposed` plan, not a claim about current behavior and
not authorization to implement anything. The completed
[Primary findability proposal](./primary-findability-validation.md) established
that a fresh agent can find controlling authority and sources. This proposal
asks the next product question: can the workflow force the agent to state how it
interpreted that authority, have the interpretation independently challenged,
and put a concise decision over the actual diff in front of a human when the
change is risky or ambiguous?

All `PV-20` through `PV-27` work remains deferred. `wiki:work` must recommend
none of it until the owner explicitly reactivates the expansion and changes the
relevant work state in a future PR.

## Approved product contract

For every future PR with `semantic_change: true`, the author would prepare an
Interpretation Contract before implementation. A context-isolated reviewer
would reconcile that interpretation against the controlling current wiki,
invariants, conflicts, and implementation sources. After implementation, a
final review would compare the actual diff with the contract and produce an
actual-diff Decision Brief.

Human approval would be selective:

- risky or ambiguous changes require an explicit owner decision;
- low-risk, unambiguous changes still require the interpretation and final
  review path, but do not require an owner approval;
- deterministic rules establish the minimum risk categories;
- the reviewer may escalate risk or ambiguity, but may never remove or
  downgrade a deterministically selected category.

This is an interpretation and decision gate, not a second source of product
truth. Durable product-contract changes still update the affected
`status: current` wiki pages in their own future implementation PR. Missing or
undecidable intent still becomes a conflict. Neither an Interpretation PASS nor
an owner approval permits a candidate to leave current wiki, code, and tests
semantically inconsistent.

## Artifact and storage boundary

Per-change process artifacts do not become wiki pages. The following live only
in the PR body and authenticated PR reviews or comments:

- the Interpretation Contract;
- the interpretation report;
- the final review;
- the Decision Brief;
- any required owner-decision attestation.

The PR body is the structured status mirror used by the ordinary workflow.
Authenticated PR comments or reviews are the trusted publication channel for
reviewer and owner attestations. Deterministic preflight bundles may be
transient inputs to isolated review, but the repository must not accumulate a
new wiki file for each change.

The durable wiki continues to store product intent, architecture, contracts,
invariants, operations, conflicts, and proposal work. When a future change
alters a durable product contract, that same PR updates the appropriate current
pages. When intent cannot be resolved, that PR opens or retains a conflict
instead of encoding the uncertainty only in the PR discussion.

## Interpretation Contract

The planned structured PR block includes:

- **Goal:** the user or product outcome being pursued.
- **Work and topic context:** selected work ID when applicable, query terms,
  current context pages, invariants, conflicts, and source read order.
- **Authority claims:** the controlling statements and sources, with current
  authority kept separate from proposal rationale and implementation evidence.
- **Intended behavior:** externally or internally observable semantics that
  should change.
- **Preserved behavior:** semantics that must remain unchanged.
- **Prohibited behavior:** outcomes the implementation must not introduce,
  including bypasses and unsupported scope expansion.
- **Planned paths:** files or path groups expected to change, plus any expected
  generated or verification artifacts.
- **Acceptance cases:** concrete Given/When/Then cases covering the intended,
  preserved, prohibited, and failure behavior.
- **Risk:** selected categories, justification, affected surface, and whether
  the author believes owner approval will be required.
- **Reversibility and rollback:** whether the change can be reversed, any
  migration or cleanup needed, and the operational rollback path.
- **Unknowns and owner decisions:** unresolved interpretation, assumptions, and
  exact choices that cannot be supplied by the author or reviewer.

The contract is required for every `semantic_change: true`, including a change
the author expects to be low risk. A future `wiki:intent-preflight` command
would validate its structure and create deterministic bindings before code is
changed. It must not be introduced by this proposal PR.

## Two interpretation reviews

The pre-implementation review answers whether the proposed interpretation is
supported by current authority and whether the planned acceptance cases and
scope are complete enough to implement. The authoring context cannot issue its
own Interpretation PASS. Actionable discrepancies are reconciled before
implementation; ambiguous product intent is escalated to an owner decision or
recorded conflict.

The post-implementation review answers whether the actual diff conforms to the
same Interpretation Contract. It checks:

- intended behavior is implemented and covered;
- preserved behavior has not drifted;
- prohibited behavior is absent;
- changed paths are within the declared scope or explicitly reconciled;
- Given/When/Then acceptance cases have corresponding evidence;
- risk, reversibility, rollback, unknowns, and owner decisions still reflect
  the actual candidate.

A new commit or semantic metadata change invalidates the prior final bindings.
The final review is not a style review and is not replaced by ordinary tests.

## Risk and ambiguity

Deterministic policy would classify at least these categories:

1. data loss;
2. security or permissions;
3. public contract or compatibility;
4. migration or irreversibility;
5. cost or external side effects;
6. enforcement, coverage, or CI weakening;
7. product intent change.

The deterministic selection is a floor. An isolated reviewer may add a
category, raise the overall decision to owner-required, or declare ambiguity
from exact authority and evidence. The reviewer may not clear a computed
category or make a risky candidate low risk. Any unresolved contradiction,
missing product decision, or materially competing interpretation is ambiguous
and requires an owner decision or a conflict before implementation proceeds.

Risk classification does not authorize the change. It only decides whether the
otherwise-passing interpretation and final review also need explicit human
approval.

## Actual-diff Decision Brief

The Decision Brief is generated only after there is an actual candidate diff.
It must keep three kinds of statement visibly separate:

- **Computed facts:** exact HEAD and merge base, changed paths, affected current
  pages, invariants and conflicts, coverage and impact results, selected risk
  categories, test evidence, and artifact digests.
- **Author claims:** intended and preserved behavior, why the implementation
  satisfies the acceptance cases, remaining limitations, reversibility, and
  rollback.
- **Reviewer escalation:** categories or ambiguity added by the reviewer,
  reasons and controlling authority, unresolved owner questions, and whether
  explicit approval is required.

The brief is a decision surface, not a replacement for the underlying contract,
diff, or review evidence. It must not present author claims as computed facts.

## Owner decision and Ready validation

When risk or ambiguity requires approval, the owner publishes an exact
authenticated decision bound to:

- the candidate HEAD;
- the Interpretation Contract digest;
- the final-review digest;
- the Decision Brief digest.

The authenticated comment or review is trusted evidence; the PR body contains
the required mirror. Any change to a bound input makes the old decision stale.
The future GitHub Ready-only path would extend the existing deterministic
validation to reject stale or missing evidence and to recognize a deterministic
`approval-not-required` result for low-risk, unambiguous changes.

Solo repositories retain procedural actor separation: the author must use a
separate context-isolated review session, while the same authenticated account
may publish the result. Team deployments may require distinct authenticated
actors for author, reviewer, or owner roles. CI can validate identities,
bindings, and policy; it cannot cryptographically prove that a person rather
than an agent acted behind one solo account.

## Deterministic core boundary

The engine, local gates, and CI remain deterministic. They may validate:

- required structure and allowed values;
- changed paths, impact, coverage, and source mappings;
- exact base, HEAD, metadata, contract, report, review, brief, and decision
  digests;
- authenticated actor and configured separation policy;
- risk categories selected from deterministic rules;
- the presence and freshness of required attestations.

They do not invoke an LLM. Interpretation and final semantic review are supplied
before Ready validation by the invoking agent or orchestrator, just as the
current Fresh-context review is supplied outside CI.

## Planned delivery sequence

The dependency chain is intentionally linear:

1. `PV-20` confirms reactivation and freezes the implementation contract.
2. `PV-21` defines versioned failure scenarios and captures the unmodified
   interpretation baseline.
3. `PV-22` adds the Interpretation Contract and future
   `wiki:intent-preflight`.
4. `PV-23` adds actual-diff scope conformance and the Decision Brief.
5. `PV-24` adds authenticated owner decisions and extends GitHub Ready
   validation.
6. `PV-25` carries the contract through config versioning, kit distribution,
   upgrade, and adoption documentation.
7. `PV-26` runs isolated new- and existing-repository pilots.
8. `PV-27` evaluates the final current engine and records the owner's exit
   decision.

Dependencies and acceptance criteria are preserved while parked. Reactivation
is an owner decision, not an inference from the queue, a new session, or the
fact that the prior Primary work is complete.

## Non-goals and limits

- This proposal does not state or change current behavior.
- It does not implement `wiki:intent-preflight`, artifact schemas, config
  changes, runtime behavior, CI, or GitHub integration.
- It does not place an LLM in the engine, local deterministic gates, or CI.
- It does not provide cryptographic proof of human-versus-agent action or
  context isolation in solo mode.
- It does not defend against hostile or compromised repository maintainers who
  can rewrite workflows or policy.
- It does not persist per-PR process artifacts as wiki pages.
- It does not let proposals, author claims, code, tests, or reviewer reports
  silently override current wiki authority.
- It does not activate `PV-13`, `PV-14`, or `PV-15`.
- It does not activate `PV-20` through `PV-27`; every item remains deferred
  until explicit owner reactivation.
