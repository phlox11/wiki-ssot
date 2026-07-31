---
id: generated/work-queue
summary: Deterministic repository-wide projection of outstanding proposal work.
kind: generated
status: archived
authority: derived
owners: ["@repository-maintainers"]
sources: []
tags: [generated, work, queue]
---

<!-- GENERATED FILE. DO NOT EDIT. Run the matching wiki command. -->

# Repository work queue

This is a deterministic view of structured `work_items` on proposal pages. It is not current product authority; open the owning proposal and then the returned current context.

**Recommended next:** none. Do not invent work; inspect blockers and open decisions below.

Outstanding work: 11. Completed work hidden: 17; run `bun run wiki:work -- --all` to inspect it.

## Active

| ID | Priority | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|
| — | — | — | — | None | — |

## Ready

| ID | Priority | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|
| — | — | — | — | None | — |

## Waiting

| ID | Priority | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|
| — | — | — | — | None | — |

## Blocked

| ID | Priority | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|
| — | — | — | — | None | — |

## Open decision conflicts

No open conflicts.

## Deferred

| ID | Priority | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|
| PV-20 | high | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-12 | Ratify the Primary interpretation-gate activation contract — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-20` |
| PV-21 | high | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-20 | Define versioned interpretation failure scenarios and capture a baseline — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-21` |
| PV-22 | high | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-21 | Add the Interpretation Contract and intent preflight — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-22` |
| PV-23 | high | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-22 | Enforce final scope conformance and generate the Decision Brief — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-23` |
| PV-24 | high | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-23 | Add authenticated owner decision and GitHub Ready validation — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-24` |
| PV-25 | high | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-24 | Preserve kit and config-v2 compatibility and adoption — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-25` |
| PV-26 | high | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-25 | Run isolated new- and existing-repository pilots — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-26` |
| PV-27 | high | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-26 | Evaluate the final current engine and record the owner exit decision — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-27` |
| PV-13 | low | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | — | Define and validate a meaningful followup_ref contract — Deferred: Keep deferred after Primary validation unless a reproduced disposition escape justifies the contract work. | `bun run wiki:context -- --work PV-13` |
| PV-14 | low | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | — | Decide whether a reviewer claim-audit artifact is needed — Deferred: Keep deferred after Primary validation unless a reproduced false-claim incident identifies a checkable claim. | `bun run wiki:context -- --work PV-14` |
| PV-15 | low | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-05 | Reconsider source-map and bootstrap review breadth — Deferred: Reconsider only when Primary baseline evidence demonstrates harmful over-bundling. | `bun run wiki:context -- --work PV-15` |
