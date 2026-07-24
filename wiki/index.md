<!-- GENERATED FILE. DO NOT EDIT. Run the matching wiki command. -->

# wiki-ssot wiki

Pages with `status: current` are the single source of truth for current development intent and contracts.

## architecture

- [architecture/engine](./architecture/engine.md) — A provider-neutral Bun/TypeScript engine drives deterministic wiki and Fresh-context attestation checks; thin CLI, GitHub adapter, and inventory seams connect it to repositories.

## operations

- [operations/enforcement](./operations/enforcement.md) — Three rails enforce the wiki — agent workflow, local hooks, and blocking CI including the trusted wiki-review-attestation check, with branch protection as the durable merge boundary.

## product

- [product/invariants](./product/invariants.md) — Non-negotiable rules — deterministic attestation enforcement, source-traced current pages, ambiguity as conflicts, no wiki_action none on code, and no authoring-session self-PASS.
- [product/scope](./product/scope.md) — wiki-ssot is a portable enforced SSOT toolkit with provider-neutral Fresh-context attestation validation; it is not a documentation site, hosted reviewer, or decision-maker.

- [Open conflicts](./conflicts.md)
- [Changelog](./changelog.md)
