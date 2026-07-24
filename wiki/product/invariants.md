---
id: product/invariants
summary: Non-negotiable rules — deterministic attestation enforcement, source-traced current pages, ambiguity as conflicts, no wiki_action none on code, and no authoring-session self-PASS.
kind: invariant
status: current
authority: normative
owners: ["@phlox11"]
sources:
  - path: scripts/wiki/core.ts
related: [architecture/engine, operations/enforcement]
tags: [invariant, safety]
---

# Invariants

These hold for every change to this repository.

- **Deterministic enforcement, pre-PR risk-scoped semantic reconciliation.** CI never has to invoke an LLM. Before opening a PR, trusted policy deterministically decides whether a change requires independent semantic reconciliation from actual changed paths, merge-base/HEAD affected invariants, affected conflicts, and current-page removals. When required, the authoring agent gives the exact bundle to a context-isolated reviewer, reconciles actionable findings, and reaches local PASS before publication. The Ready-only blocking path then validates report schema, evidence, exact HEAD/merge-base/bundle bindings, and authenticated reviewer policy.
- **Current pages trace to real sources.** A `status: current` page requires at least one existing `sources` entry, and its source hashes must be verified. A missing source path or a stale hash fails the build.
- **Ambiguity is a conflict, not an invention.** When intent is unclear, or code and wiki disagree in a way that could change behavior, the change opens a `wiki/conflicts/open/**` record instead of guessing.
- **Implementation changes cannot claim `wiki_action: none`.** Any change to a non-doc, non-generated source must update or explicitly verify its pages.
- **The authoring context cannot self-attest when review is required.** It owns reconciliation and may modify code/wiki/tests, but a separate context-isolated reviewer creates the report and never modifies the reviewed HEAD. `NEEDS_RECONCILE` must identify the discrepancy, controlling authority, required change, and acceptance criteria. A version 2 finding states this as structure: scope binding it to the reviewed change, controlling authority, evidence, closable acceptance criteria, and a disposition, where a disposition pointing elsewhere names the conflict or follow-up it points at. A finding is retired by fixing it, tracking it, or dismissing it with a recorded reason — never by gesture — and ambiguity becomes a conflict or owner decision rather than a speculative loop. In solo mode the PR author's authenticated GitHub account may publish the separate context's report; team mode may require a distinct actor.
