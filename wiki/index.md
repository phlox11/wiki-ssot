<!-- GENERATED FILE. DO NOT EDIT. Run the matching wiki command. -->

# wiki-ssot wiki

Pages with `status: current` are the single source of truth for current development intent and contracts.

## architecture

- [architecture/engine](./architecture/engine.md) — A provider-neutral Bun/TypeScript engine drives deterministic wiki, work discovery, and Fresh-context attestation checks; thin CLI, GitHub adapter, and inventory seams connect it to repositories.

## operations

- [operations/enforcement](./operations/enforcement.md) — Three rails enforce the wiki within a trusted-maintainer boundary — zero-knowledge agent entry, local hooks, and deterministic CI including the wiki-review-attestation check.

## product

- [product/invariants](./product/invariants.md) — Non-negotiable rules — discoverable validated work, deterministic attestation enforcement, source-traced current pages, ambiguity as conflicts, no wiki_action none on code, and no authoring-session self-PASS.
- [product/scope](./product/scope.md) — wiki-ssot is a portable enforced SSOT toolkit with zero-knowledge work discovery and provider-neutral Fresh-context attestation validation; it is not a documentation site, hosted reviewer, or decision-maker.

- [Outstanding work](./work-queue.md)
- [Open conflicts](./conflicts.md)
- [Changelog](./changelog.md)
