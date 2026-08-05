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

**Recommended next:** `TE-00` — run `bun run wiki:context -- --work TE-00`.

Outstanding work: 29. Completed work hidden: 17; run `bun run wiki:work -- --all` to inspect it.

## Active

| ID | Priority | Executor | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|---|
| — | — | — | — | — | None | — |

## Ready

| ID | Priority | Executor | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|---|
| TE-00 | high | agent | [proposal/token-efficiency](./proposals/token-efficiency.md) | — | Capture the token-efficiency measurement baseline | `bun run wiki:context -- --work TE-00` |

## Waiting

| ID | Priority | Executor | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|---|
| TE-00-OWNER | high | human | [proposal/token-efficiency](./proposals/token-efficiency.md) | TE-00 | Ratify the token-efficiency comparison contract and budgets — Waiting on: TE-00 | `bun run wiki:context -- --work TE-00-OWNER` |
| TE-01 | high | agent | [proposal/token-efficiency](./proposals/token-efficiency.md) | TE-00-OWNER | Add compact context projections with explicit full expansion — Waiting on: TE-00-OWNER | `bun run wiki:context -- --work TE-01` |
| TE-02 | high | agent | [proposal/token-efficiency](./proposals/token-efficiency.md) | TE-00-OWNER | Bound partial-match discovery before full context expansion — Waiting on: TE-00-OWNER | `bun run wiki:context -- --work TE-02` |
| TE-03 | high | agent | [proposal/token-efficiency](./proposals/token-efficiency.md) | TE-00-OWNER | Partition the recursive engine source authority boundary — Waiting on: TE-00-OWNER | `bun run wiki:context -- --work TE-03` |
| TE-04 | high | agent | [proposal/token-efficiency](./proposals/token-efficiency.md) | TE-00-OWNER, TE-03 | Deduplicate and focus exact-HEAD review bundles — Waiting on: TE-00-OWNER, TE-03 | `bun run wiki:context -- --work TE-04` |
| TE-06 | high | agent | [proposal/token-efficiency](./proposals/token-efficiency.md) | TE-01, TE-02, TE-03, TE-04, TE-05 | Validate token-efficiency gains and prepare exit evidence — Waiting on: TE-01, TE-02, TE-03, TE-04, TE-05 | `bun run wiki:context -- --work TE-06` |
| TE-06-OWNER | high | human | [proposal/token-efficiency](./proposals/token-efficiency.md) | TE-06 | Record the token-efficiency owner exit decision — Waiting on: TE-06 | `bun run wiki:context -- --work TE-06-OWNER` |
| KM-00 | normal | agent | [proposal/kit-code-splitting](./proposals/kit-code-splitting.md) | TE-06-OWNER | Freeze the portable-kit modularity baseline and compatibility contract — Waiting on: TE-06-OWNER | `bun run wiki:context -- --work KM-00` |
| KM-00-OWNER | normal | human | [proposal/kit-code-splitting](./proposals/kit-code-splitting.md) | KM-00 | Ratify the portable-kit module budget and split contract — Waiting on: KM-00 | `bun run wiki:context -- --work KM-00-OWNER` |
| KM-01 | normal | agent | [proposal/kit-code-splitting](./proposals/kit-code-splitting.md) | KM-00-OWNER | Extract shared model, repository-view, and page-validation primitives — Waiting on: KM-00-OWNER | `bun run wiki:context -- --work KM-01` |
| KM-02 | normal | agent | [proposal/kit-code-splitting](./proposals/kit-code-splitting.md) | KM-01 | Extract work discovery, search, context, and generated-view modules — Waiting on: KM-01 | `bun run wiki:context -- --work KM-02` |
| KM-03 | normal | agent | [proposal/kit-code-splitting](./proposals/kit-code-splitting.md) | KM-02 | Extract portable-kit packaging and generation from the engine core — Waiting on: KM-02 | `bun run wiki:context -- --work KM-03` |
| KM-04 | normal | agent | [proposal/kit-code-splitting](./proposals/kit-code-splitting.md) | KM-03 | Extract verification, impact, and exact-HEAD review modules — Waiting on: KM-03 | `bun run wiki:context -- --work KM-04` |
| KM-05 | normal | agent | [proposal/kit-code-splitting](./proposals/kit-code-splitting.md) | KM-04 | Replace the monolithic CLI dispatcher with bounded command handlers — Waiting on: KM-04 | `bun run wiki:context -- --work KM-05` |
| KM-06 | normal | agent | [proposal/kit-code-splitting](./proposals/kit-code-splitting.md) | KM-05 | Split portable regression suites and consolidate shared fixtures — Waiting on: KM-05 | `bun run wiki:context -- --work KM-06` |
| KM-07 | normal | agent | [proposal/kit-code-splitting](./proposals/kit-code-splitting.md) | KM-06 | Validate the modular kit and install a bounded growth guard — Waiting on: KM-06 | `bun run wiki:context -- --work KM-07` |
| TE-05 | normal | agent | [proposal/token-efficiency](./proposals/token-efficiency.md) | TE-01, TE-02, TE-03, TE-04 | Make orchestration cost and reusable context boundaries explicit — Waiting on: TE-01, TE-02, TE-03, TE-04 | `bun run wiki:context -- --work TE-05` |

## Blocked

| ID | Priority | Executor | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|---|
| — | — | — | — | — | None | — |

## Open decision conflicts

No open conflicts.

## Deferred

| ID | Priority | Executor | Owner page | Dependencies | Summary | Context |
|---|---|---|---|---|---|---|
| PV-20 | high | agent | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-12 | Ratify the Primary interpretation-gate activation contract — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-20` |
| PV-21 | high | agent | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-20 | Define versioned interpretation failure scenarios and capture a baseline — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-21` |
| PV-22 | high | agent | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-21 | Add the Interpretation Contract and intent preflight — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-22` |
| PV-23 | high | agent | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-22 | Enforce final scope conformance and generate the Decision Brief — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-23` |
| PV-24 | high | agent | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-23 | Add authenticated owner decision and GitHub Ready validation — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-24` |
| PV-25 | high | agent | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-24 | Preserve kit and config-v2 compatibility and adoption — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-25` |
| PV-26 | high | agent | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-25 | Run isolated new- and existing-repository pilots — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-26` |
| PV-27 | high | agent | [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | PV-26 | Evaluate the final current engine and record the owner exit decision — Deferred: The approved Primary expansion remains parked until the owner explicitly reactivates it; do not implement it now. | `bun run wiki:context -- --work PV-27` |
| PV-13 | low | agent | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | — | Define and validate a meaningful followup_ref contract — Deferred: Keep deferred after Primary validation unless a reproduced disposition escape justifies the contract work. | `bun run wiki:context -- --work PV-13` |
| PV-14 | low | agent | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | — | Decide whether a reviewer claim-audit artifact is needed — Deferred: Keep deferred after Primary validation unless a reproduced false-claim incident identifies a checkable claim. | `bun run wiki:context -- --work PV-14` |
| PV-15 | low | agent | [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | PV-05 | Reconsider source-map and bootstrap review breadth — Deferred: Reconsider only when Primary baseline evidence demonstrates harmful over-bundling. | `bun run wiki:context -- --work PV-15` |
