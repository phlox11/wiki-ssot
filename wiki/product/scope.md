---
id: product/scope
summary: wiki-ssot is a portable enforced SSOT toolkit with provider-neutral Fresh-context attestation validation; it is not a documentation site, hosted reviewer, or decision-maker.
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
- Deterministic review manifests and a provider-neutral structured Fresh-context report/trust contract.
- Explicit solo and team trust policies: separate review context is always procedural, while distinct GitHub actors are optional and machine-enforced only when configured.
- Enforcement rails: an agent entrypoint (`AGENTS.md`), local git hooks, CI jobs, and machine-checked downstream integration seams.
- Two adoption paths: bootstrap a wiki into an existing repository, or grow one from an empty repository.

## Not in scope

- Rendering or hosting a documentation website.
- Replacing the wiki with an auto-generated API reference.
- Deciding product questions on the agent's behalf: an ambiguous decision is a conflict, not an invention.
- Running or hosting a particular LLM/reviewer in core or CI. Semantic verdict generation is external; core only verifies the attestation.
- Claiming cryptographic proof that a reviewer had a genuinely fresh context. The selected reviewer/orchestrator defines that trust boundary.
