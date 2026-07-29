---
id: product/invariants
summary: Non-negotiable rules — discoverable validated work, deterministic attestation enforcement, source-traced current pages, ambiguity as conflicts, no wiki_action none on code, and no authoring-session self-PASS.
kind: invariant
status: current
authority: normative
owners: ["@phlox11"]
sources:
  - path: scripts/wiki/core.ts
  - path: scripts/wiki/cli.ts
  - path: AGENTS.md
related: [architecture/engine, operations/enforcement]
tags: [invariant, safety]
---

# Invariants

These hold for every change to this repository.

- **Remaining work is discoverable without prior node knowledge.** Proposal work records form one validated repository-wide graph with unique IDs, current-page context targets, legal lifecycle fields, acyclic known dependencies, blockers/reasons, and durable done evidence. `wiki:work` requires no query, derives ready/waiting state, includes open conflicts, and recommends only active or ready work by explicit priority and ID. A selected item exposes its work contract, all current invariants, current context pages, related conflicts, sources, and a clearly non-current proposal owner.
- **Deterministic enforcement, pre-PR risk-scoped semantic reconciliation.** CI never has to invoke an LLM. Before opening a PR, trusted policy deterministically decides whether a change requires independent semantic reconciliation from actual changed paths, merge-base/HEAD affected invariants, affected conflicts, and current-page removals. When required, the authoring agent gives the exact bundle to a context-isolated reviewer, reconciles actionable findings, and reaches local PASS before publication. The Ready-only blocking path then validates report schema, evidence, exact HEAD/merge-base/bundle bindings, and authenticated reviewer policy.
- **Current pages trace to real sources.** A `status: current` page requires at least one existing `sources` entry, and its source hashes must be verified. A missing source path or a stale hash fails the build.
- **Ambiguity is a conflict, not an invention.** When intent is unclear, or code and wiki disagree in a way that could change behavior, the change opens a `wiki/conflicts/open/**` record instead of guessing.
- **Implementation changes cannot claim `wiki_action: none`.** Any change to a non-doc, non-generated source must update or explicitly verify its pages.
- **The authoring context cannot self-attest when review is required.** It owns reconciliation and may modify code/wiki/tests, but a separate context-isolated reviewer creates the report and never modifies the reviewed HEAD. `NEEDS_RECONCILE` must identify the discrepancy, controlling authority, required change, and acceptance criteria. A version 2 finding states this as structure: scope binding it to the reviewed change, controlling authority, evidence, closable acceptance criteria, and a disposition, where a disposition pointing elsewhere names the conflict or follow-up it points at. A `PASS` may not carry an `unresolved` finding, and a disposition pointing elsewhere must name its target, so a finding that states a contract is retired only by fixing it, tracking it, or dismissing it with a recorded reason. Which dispositions retire which classification is fixed rather than discretionary: a break this candidate caused, or a contract the PR itself declares, admits no deferring disposition and is closed only by fixing it; an undecided product question may be fixed or tracked in a conflict but never dismissed or deferred to a follow-up; and `recorded`, which retires nothing, is limited to a `suggestion`. A disposition naming a conflict must name one open at the reviewed HEAD carrying the conflict type its classification implies where one is implied, declaring `origin: baseline` whenever the classification says the problem predates the candidate, and sharing a page with the finding's scope — which a finding naming no page cannot do. The author writes that `origin` and the reviewer writes the classification independently, so a finding cannot be filed as pre-existing while the conflict it names admits the change introduced it. Whether the reviewer classified honestly in the first place remains reviewer judgement. Ambiguity becomes a conflict or owner decision rather than a speculative loop. In solo mode the PR author's authenticated GitHub account may publish the separate context's report; team mode may require a distinct actor.
