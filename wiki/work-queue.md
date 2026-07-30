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

**Recommended next:** `PV-17` — run `bun run wiki:context -- --work PV-17`.

Outstanding work: 7. Completed work hidden: 13; run `bun run wiki:work -- --all` to inspect it.

## Active

| ID | Priority | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|
| — | — | — | — | None | — |

## Ready

| ID | Priority | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|
| PV-17 | high | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-11 | Make generic topic context authority- and source-complete | `bun run wiki:context -- --work PV-17` |
| PV-18 | high | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-11 | Complete independent PASS for the existing-repository fresh-session pilot | `bun run wiki:context -- --work PV-18` |

## Waiting

| ID | Priority | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|
| PV-12 | high | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-18, PV-19 | Evaluate the Primary exit gate and decide the next investment — Waiting on: PV-18, PV-19 | `bun run wiki:context -- --work PV-12` |
| PV-19 | high | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-16, PV-17 | Re-evaluate all eight Primary scenarios against the fixed current engine — Waiting on: PV-17 | `bun run wiki:context -- --work PV-19` |

## Blocked

| ID | Priority | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|
| — | — | — | — | None | — |

## Open decision conflicts

No open conflicts.

## Deferred

| ID | Priority | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|
| PV-13 | low | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | — | Define and validate a meaningful followup_ref contract — Deferred: Reconsider after the Primary exit gate or a reproduced disposition escape. | `bun run wiki:context -- --work PV-13` |
| PV-14 | low | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | — | Decide whether a reviewer claim-audit artifact is needed — Deferred: Reconsider after a reproduced false-claim incident or the Primary exit gate. | `bun run wiki:context -- --work PV-14` |
| PV-15 | low | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-05 | Reconsider source-map and bootstrap review breadth — Deferred: Reconsider only when Primary baseline evidence demonstrates harmful over-bundling. | `bun run wiki:context -- --work PV-15` |
