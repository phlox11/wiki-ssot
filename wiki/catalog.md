---
id: generated/catalog
summary: Deterministic catalog of every Wiki content page.
kind: generated
status: archived
authority: derived
owners: ["@repository-maintainers"]
sources: []
tags: [generated, catalog]
---

<!-- GENERATED FILE. DO NOT EDIT. Run the matching wiki command. -->

# Wiki catalog

Complete generated catalog of every Wiki content page. Current pages are authority; other lifecycle records remain explicitly non-current.

## current / architecture

| ID | Kind | Authority | Summary | Related | Affects |
|---|---|---|---|---|---|
| [architecture/engine](./architecture/engine.md) | architecture | observed | Provider-neutral Bun/TypeScript engine for deterministic Wiki, work discovery, portable growth, and exact-HEAD attestation. | [operations/enforcement](./operations/enforcement.md), [product/invariants](./product/invariants.md) | — |

## current / operations

| ID | Kind | Authority | Summary | Related | Affects |
|---|---|---|---|---|---|
| [operations/enforcement](./operations/enforcement.md) | operation | normative | Three rails enforce the wiki within a trusted-maintainer boundary — zero-knowledge agent entry, local hooks, and deterministic CI including portable growth and wiki-review-attestation checks. | [architecture/engine](./architecture/engine.md), [product/invariants](./product/invariants.md) | — |

## current / product

| ID | Kind | Authority | Summary | Related | Affects |
|---|---|---|---|---|---|
| [product/invariants](./product/invariants.md) | invariant | normative | Non-negotiable rules for discoverable work, source traceability, portable bounds, conflicts, deterministic attestation, and separated review. | [architecture/engine](./architecture/engine.md), [operations/enforcement](./operations/enforcement.md) | — |
| [product/scope](./product/scope.md) | product | normative | wiki-ssot's Primary findability and adoption path is validated within configured coverage and trusted-maintainer bounds; it remains a portable toolkit, not a hosted reviewer or decision-maker. | [architecture/engine](./architecture/engine.md), [operations/enforcement](./operations/enforcement.md), [product/invariants](./product/invariants.md) | — |

## proposed / proposals

| ID | Kind | Authority | Summary | Related | Affects |
|---|---|---|---|---|---|
| [proposal/kit-code-splitting](./proposals/kit-code-splitting.md) | proposal | normative | Split the portable Wiki SSOT kit's oversized core, CLI, and test modules into stable domain seams without changing commands, output contracts, adoption, upgrade, or review guarantees. | [architecture/engine](./architecture/engine.md), [operations/enforcement](./operations/enforcement.md), [product/invariants](./product/invariants.md), [proposal/token-efficiency](./proposals/token-efficiency.md) | [architecture/engine](./architecture/engine.md), [operations/enforcement](./operations/enforcement.md), [product/invariants](./product/invariants.md) |
| [proposal/portable-scale-navigation](./proposals/portable-scale-navigation.md) | proposal | normative | Bound Wiki entrypoints, expose cumulative records and explicit relationships, validate a large portable scale profile, and reduce unnecessary CI history fetches without weakening global validation. | [architecture/engine](./architecture/engine.md), [operations/enforcement](./operations/enforcement.md), [proposal/primary-findability-validation](./proposals/primary-findability-validation.md), [proposal/token-efficiency](./proposals/token-efficiency.md) | [architecture/engine](./architecture/engine.md), [operations/enforcement](./operations/enforcement.md), [product/invariants](./product/invariants.md), [product/scope](./product/scope.md) |
| [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | proposal | normative | Validate and improve wiki-ssot's primary promise that a fresh coding-agent session can discover the controlling current wiki, constraints, conflicts, and implementation sources before editing. | [architecture/engine](./architecture/engine.md), [operations/enforcement](./operations/enforcement.md), [product/invariants](./product/invariants.md), [product/scope](./product/scope.md), [proposal/protected-main](./proposals/protected-main.md) | — |
| [proposal/primary-interpretation-decision-gate](./proposals/primary-interpretation-decision-gate.md) | proposal | normative | Parked Primary expansion requiring a pre-implementation Interpretation Contract, independent interpretation review, actual-diff Decision Brief, and owner approval only for risky or ambiguous semantic changes. | [architecture/engine](./architecture/engine.md), [operations/enforcement](./operations/enforcement.md), [product/invariants](./product/invariants.md), [product/scope](./product/scope.md), [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | [architecture/engine](./architecture/engine.md), [operations/enforcement](./operations/enforcement.md), [product/invariants](./product/invariants.md), [product/scope](./product/scope.md) |
| [proposal/token-efficiency](./proposals/token-efficiency.md) | proposal | normative | Reduce Wiki SSOT model calls, context and review input, and active execution time using the schooled diagnosis, a controlled publisher before/after comparison, and portable correctness evidence. | [architecture/engine](./architecture/engine.md), [operations/enforcement](./operations/enforcement.md), [product/invariants](./product/invariants.md), [product/scope](./product/scope.md), [proposal/primary-findability-validation](./proposals/primary-findability-validation.md) | [architecture/engine](./architecture/engine.md), [operations/enforcement](./operations/enforcement.md), [product/invariants](./product/invariants.md), [product/scope](./product/scope.md) |

## archived / proposals

| ID | Kind | Authority | Summary | Related | Affects |
|---|---|---|---|---|---|
| [proposal/protected-main](./proposals/protected-main.md) | proposal | normative | Archived workflow-protection proposal superseded by the owner decision to trust repository developers and leave organization security to deployments. | [operations/enforcement](./operations/enforcement.md) | — |
