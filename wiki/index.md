<!-- GENERATED FILE. DO NOT EDIT. Run the matching wiki command. -->

# wiki-ssot wiki

Pages with `status: current` are the single source of truth for current development intent and contracts.

## architecture

- [architecture/engine](./architecture/engine.md) — A single Bun/TypeScript engine (core.ts) parses page frontmatter and drives every check; the CLI is a thin command layer and inventories are a project-owned adapter.

## operations

- [operations/enforcement](./operations/enforcement.md) — Three rails enforce the wiki — the agent entrypoint on every session, local git hooks on every commit and push, and blocking CI jobs plus a weekly audit on the repository.

## product

- [product/invariants](./product/invariants.md) — Non-negotiable rules the toolkit itself enforces — deterministic gates only, current pages that trace to real sources, ambiguity recorded as a conflict, and no wiki_action none on code.
- [product/scope](./product/scope.md) — wiki-ssot is a portable, enforced single-source-of-truth wiki toolkit for repositories maintained by coding agents; it is not a documentation site generator or a hosted service.

- [Open conflicts](./conflicts.md)
- [Changelog](./changelog.md)
