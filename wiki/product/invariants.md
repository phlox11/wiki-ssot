---
id: product/invariants
summary: Non-negotiable rules the toolkit itself enforces — deterministic gates only, current pages that trace to real sources, ambiguity recorded as a conflict, and no wiki_action none on code.
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

- **Deterministic gates only.** Every blocking check is a pure function of tracked files — hashes, frontmatter, globs. No network or LLM call may block a merge. The fresh-context reconcile pass is advisory.
- **Current pages trace to real sources.** A `status: current` page requires at least one existing `sources` entry, and its source hashes must be verified. A missing source path or a stale hash fails the build.
- **Ambiguity is a conflict, not an invention.** When intent is unclear, or code and wiki disagree in a way that could change behavior, the change opens a `wiki/conflicts/open/**` record instead of guessing.
- **Implementation changes cannot claim `wiki_action: none`.** Any change to a non-doc, non-generated source must update or explicitly verify its pages.
