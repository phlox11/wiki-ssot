---
id: product/invariants
summary: Non-negotiable rules — deterministic attestation enforcement, source-traced current pages, ambiguity as conflicts, no wiki_action none on code, and no author self-PASS.
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

- **Deterministic enforcement, external semantic review.** CI never has to invoke an LLM. An external reasoning reviewer supplies the semantic verdict; the blocking path deterministically validates report schema, evidence, exact HEAD/merge-base/bundle bindings, and authenticated reviewer policy. Missing, non-PASS, stale, or untrusted attestations fail required mode.
- **Current pages trace to real sources.** A `status: current` page requires at least one existing `sources` entry, and its source hashes must be verified. A missing source path or a stale hash fails the build.
- **Ambiguity is a conflict, not an invention.** When intent is unclear, or code and wiki disagree in a way that could change behavior, the change opens a `wiki/conflicts/open/**` record instead of guessing.
- **Implementation changes cannot claim `wiki_action: none`.** Any change to a non-doc, non-generated source must update or explicitly verify its pages.
- **The author cannot self-attest.** A separate context-isolated session or reviewer creates the report. The author-editable PR body is only a status mirror, and actual context isolation remains inside the chosen reviewer/orchestrator trust boundary.
