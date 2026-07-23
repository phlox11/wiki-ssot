---
id: product/scope
summary: wiki-ssot is a portable, enforced single-source-of-truth wiki toolkit for repositories maintained by coding agents; it is not a documentation site generator or a hosted service.
kind: product
status: current
authority: normative
owners: ["@phlox11"]
sources:
  - path: README.md
  - path: docs/design.md
related: [architecture/engine, product/invariants, operations/enforcement]
tags: [scope, product]
---

# Scope

wiki-ssot turns a repository's development knowledge into a small set of `status: current` wiki pages that are the single source of truth for intent, architecture, contracts, invariants, and operations, and it ships deterministic tooling that keeps those pages honest against the code on every commit and pull request.

## In scope

- A page schema and frontmatter contract (`wiki/SCHEMA.md`).
- Deterministic CLI checks: structure lint, generated-file freshness, code→page impact, source staleness, coverage, and a conflict lifecycle.
- Enforcement rails: an agent entrypoint (`AGENTS.md`), local git hooks, and CI jobs.
- Two adoption paths: bootstrap a wiki into an existing repository, or grow one from an empty repository.

## Not in scope

- Rendering or hosting a documentation website.
- Replacing the wiki with an auto-generated API reference.
- Deciding product questions on the agent's behalf: an ambiguous decision is a conflict, not an invention.
- Any non-deterministic (LLM) judgement as a blocking gate; the fresh-context reconcile pass is advisory.
