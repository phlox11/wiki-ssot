---
id: architecture/engine
summary: A single Bun/TypeScript engine (core.ts) parses page frontmatter and drives every check; the CLI is a thin command layer and inventories are a project-owned adapter.
kind: architecture
status: current
authority: observed
owners: ["@phlox11"]
sources:
  - glob: scripts/wiki/*.ts
related: [operations/enforcement, product/invariants]
tags: [architecture, engine]
---

# Engine

All logic lives in `scripts/wiki/core.ts`: frontmatter parsing and schema validation, Markdown link checking, source→page mapping, coverage, blob-hash staleness (`.wiki/state.json`), diff impact, PR-metadata and conflict-lifecycle validation, and the fresh-context review bundle. `scripts/wiki/cli.ts` is a thin argument-parsing layer over those functions.

The engine is framework-agnostic. Two seams are project-owned:

- `.wiki/config.json` — the wiki display name and the `highRisk` globs that classify a changed source.
- `scripts/wiki/inventories.ts` — an adapter that emits deterministic `wiki/_generated/**` pages from code; it returns `{}` by default. See `scripts/wiki/inventories.example.ts` for a reference implementation over API routes, shared contracts, database tables, and app routes.

`scripts/wiki/wiki.test.ts` exercises the engine against synthetic in-memory and temporary git repositories, so the regression suite is independent of any host project. It depends only on `bun`, `typescript`, and `yaml`; the git-backed reads shell out to `git`.
