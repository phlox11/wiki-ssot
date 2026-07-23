# wiki-ssot

**A living, enforced Single Source of Truth wiki that coding agents maintain alongside code.**

Coding agents increasingly do the work in a repository, each starting from a blank slate. Two failures follow:

1. **Primary failure:** an agent that *cannot find the code or constraint it should have accounted for*, so it edits blind — repeating a fixed mistake or breaking an intent it never saw.
2. **Secondary failure:** two individually-correct pull requests merge into a wiki that now contradicts itself.

wiki-ssot fixes both with deterministic repository gates plus a Fresh-context attestation guard, wired onto the events that always happen: session start, commit, and pull request. CI does not have to run an LLM: an external reasoning reviewer produces the semantic verdict, while the blocking job deterministically validates its target SHA, bundle digest, evidence, and authenticated actor.

It is derived from Andrej Karpathy's [LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) `source → wiki → schema` idea, hardened into an enforcement system.

## The idea in one screen

- **`wiki/**` pages with `status: current` are the SSOT** for intent, architecture, contracts, invariants, and operations. Code and tests are *implementation evidence*.
- Each page's frontmatter lists its **`sources`** (real paths / globs). The engine builds a reverse index and **hashes those sources**. When a source changes, its page goes *stale* and must be updated or explicitly verified — in the same PR.
- A **coverage** gate ensures every major code file maps to some page, so there is no "unfindable" code.
- When intent is unclear or code and wiki disagree, you open a **conflict** — a first-class, machine-tracked record with acceptance criteria — instead of guessing.
- The semantic Fresh-context verdict comes from a separate reviewer. The required `wiki-fresh-context` job validates the attestation deterministically and rejects missing, non-PASS, stale, malformed, empty-evidence, or untrusted reports.

Full rationale: [docs/design.md](docs/design.md).

## Requirements

- [Bun](https://bun.sh) ≥ 1.1 (the engine uses `Bun.Glob`, `Bun.CryptoHasher`, and shells out to `git`).
- Git.
- GitHub Actions for the CI rail (optional but recommended); the local hooks and CLI work anywhere.

## Get started

Two paths, each a step-by-step playbook with copy-paste commands:

- **Existing repository** → [docs/adopt-existing-repo.md](docs/adopt-existing-repo.md). Drop the kit in, bootstrap pages from the code you already have, then maintain.
- **New repository** → [docs/adopt-new-repo.md](docs/adopt-new-repo.md). Start from this template and grow the wiki as you build.

Full command reference: [docs/commands.md](docs/commands.md).

## Try it here

This repository **dogfoods itself** — its own `wiki/` describes the toolkit, and its own gates run in CI. Clone it and run:

```sh
bun install
bun run wiki:lint        # structure, links, sources, coverage, generated freshness
bun run test             # engine regression suite
bun run typecheck
bun run wiki:audit       # full repo audit: structure + generated + every page's source hashes
bun run wiki:doctor      # required downstream integration seams
bun run wiki:context -- "enforcement"   # what an agent reads before touching enforcement
```

## What's in the box

```
scripts/wiki/
  core.ts                # the whole engine (framework-agnostic)
  cli.ts                 # thin CLI over core
  github-attestation.ts  # authenticated GitHub review/comment adapter
  inventories.ts         # project-owned adapter for code-derived pages (default: none)
  inventories.example.ts # a real inventory adapter you can copy
  wiki.test.ts / fresh-context.test.ts  # engine regression suites (synthetic repos)
wiki/                    # the SSOT pages + SCHEMA.md + WORKFLOW.md
.wiki/                   # machine config + generated indexes + verification ledger
.husky/                  # pre-commit (lint) + pre-push (block main)
.github/workflows/       # checks.yml (PR gates) + wiki-audit.yml (weekly)
AGENTS.md / CLAUDE.md    # the agent entrypoint
docs/                    # design + adoption playbooks + command reference
```

## Configure it for your repo

Two seams make it yours; everything else is generic:

- **`.wiki/config.json`** — your wiki's `name`, `highRisk` globs, and explicit Fresh-context mode/evidence/reviewer trust policy.
- **`scripts/wiki/inventories.ts`** — optional. Teach the engine to emit deterministic `wiki/_generated/**` pages from your stack (see `inventories.example.ts`).

## License

[MIT](LICENSE).
