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

**Recommended next:** `PV-04` — run `bun run wiki:context -- --work PV-04`.

Outstanding work: 12. Completed work hidden: 4; run `bun run wiki:work -- --all` to inspect it.

## Active

| ID | Priority | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|
| — | — | — | — | None | — |

## Ready

| ID | Priority | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|
| PV-04 | high | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-03 | Define deterministic Primary scenarios, expected context, and metrics | `bun run wiki:context -- --work PV-04` |

## Waiting

| ID | Priority | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|
| PV-05 | high | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-04 | Capture the unmodified Primary baseline — Waiting on: PV-04 | `bun run wiki:context -- --work PV-05` |
| PV-06 | high | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-05 | Make selected-work context authority- and source-complete — Waiting on: PV-05 | `bun run wiki:context -- --work PV-06` |
| PV-08 | high | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-04 | Validate new-repository adoption and coverage growth — Waiting on: PV-04 | `bun run wiki:context -- --work PV-08` |
| PV-09 | high | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-04 | Validate existing-repository bootstrap and coverage closure — Waiting on: PV-04 | `bun run wiki:context -- --work PV-09` |
| PV-10 | high | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-03, PV-05 | Strengthen the agent-entrypoint integration contract — Waiting on: PV-05 | `bun run wiki:context -- --work PV-10` |
| PV-11 | high | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-06, PV-08, PV-09, PV-10 | Run fresh-session agent pilots over both adoption paths — Waiting on: PV-06, PV-08, PV-09, PV-10 | `bun run wiki:context -- --work PV-11` |
| PV-12 | high | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-11 | Evaluate the Primary exit gate and decide the next investment — Waiting on: PV-11 | `bun run wiki:context -- --work PV-12` |
| PV-07 | normal | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-05 | Improve wiki:search only for baseline-proven misses — Waiting on: PV-05 | `bun run wiki:context -- --work PV-07` |

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
