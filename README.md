# wiki-ssot

**A living, enforced Single Source of Truth wiki that coding agents maintain alongside code.**

Coding agents increasingly do the work in a repository, each starting from a blank slate. Two failures follow:

1. **Primary failure:** an agent that *cannot find the code or constraint it should have accounted for*, so it edits blind — repeating a fixed mistake or breaking an intent it never saw.
2. **Secondary failure:** two individually-correct pull requests merge into a wiki that now contradicts itself.

wiki-ssot fixes both with deterministic repository gates plus pre-PR, risk-scoped Fresh-context reconciliation. Before opening a PR, the authoring code agent gives a deterministic bundle to a context-isolated reviewer or sub-agent and reconciles any concrete code/wiki mismatch. CI does not run an LLM; it only validates the already-produced verdict's target SHA, bundle digest, evidence, and authenticated actor when the PR becomes Ready.

It is derived from Andrej Karpathy's [LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) `source → wiki → schema` idea, hardened into an enforcement system.

## The idea in one screen

- **`wiki/**` pages with `status: current` are the SSOT** for intent, architecture, contracts, invariants, and operations. Code and tests are *implementation evidence*.
- Each page's frontmatter lists its **`sources`** (real paths / globs). The engine builds a reverse index and **hashes those sources**. When a source changes, its page goes *stale* and must be updated or explicitly verified — in the same PR.
- A **coverage** gate ensures every major code file maps to some page, so there is no "unfindable" code.
- When intent is unclear or code and wiki disagree, you open a **conflict** — a first-class, machine-tracked record with acceptance criteria — instead of guessing.
- Proposal frontmatter carries a validated, repository-wide **work queue**. A fresh session can run `wiki:work` with no topic, node, or task ID, then load a selected item's current invariants, context pages, conflicts, sources, and non-current proposal owner.
- `wiki:review-preflight` decides whether independent reconciliation is required before a PR exists, prepares the exact bundle, and validates the separate review context's report. Draft PRs do not emit an expected Fresh-context failure; applicable Ready PRs reject missing, non-PASS, stale, malformed, empty-evidence, or untrusted reports.

Full rationale: [docs/design.md](docs/design.md).

## Requirements

- [Bun](https://bun.sh) ≥ 1.1 (the engine uses `Bun.Glob`, `Bun.CryptoHasher`, and shells out to `git`).
- Git.
- GitHub Actions for the CI rail (optional but recommended); the local hooks and CLI work anywhere.

## Get started

The distribution is [`kit/`](kit/README.md) — a generated tree containing the toolkit and nothing about this repository. Copy it into another repository, and take later upgrades, with:

```sh
bun scripts/wiki/kit-sync.ts --into /path/to/your-repo
```

It splits kit-owned files (replaced on upgrade) from seed files (yours after the first copy), and refuses to overwrite a file you edited. [`kit/README.md`](kit/README.md) has the full procedure.

Two paths, each a step-by-step playbook with copy-paste commands:

- **Existing repository** → [docs/adopt-existing-repo.md](docs/adopt-existing-repo.md). Drop the kit in, bootstrap pages from the code you already have, then maintain.
- **New repository** → [docs/adopt-new-repo.md](docs/adopt-new-repo.md). Start from the kit and grow the wiki as you build.

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
bun run wiki:work        # repository-wide outstanding work, no query or ID required
bun run wiki:context -- "enforcement"   # what an agent reads before touching enforcement
```

## What's in the box

```
scripts/wiki/
  core.ts                # the whole engine (framework-agnostic)
  cli.ts                 # thin CLI over core
  github-attestation.ts  # authenticated GitHub review/comment adapter
  inventories.ts         # project-owned adapter for code-derived pages (default: none)
  inventories.example.ts # a real inventory adapter to read and adapt (not delivered)
  kit-sync.ts            # adopt the kit into another repo, or upgrade it
  wiki.test.ts / fresh-context.test.ts / work.test.ts / kit.test.ts  # engine regression suites
wiki/                    # the SSOT pages + SCHEMA.md + WORKFLOW.md
.wiki/                   # machine config + generated indexes + verification ledger
.husky/                  # pre-commit (lint) + pre-push (block main)
.github/workflows/       # checks.yml (PR gates) + kit.yml + wiki-audit.yml (weekly)
AGENTS.md / CLAUDE.md    # the agent entrypoint
kit/                     # the generated distribution other repos copy
docs/                    # design + adoption playbooks + command reference
```

That is this repository's layout. Nothing outside [`kit/`](kit/README.md) travels to another repository, and not everything inside it does either — reference files are read in place rather than copied. `kit/files/.wiki/kit-manifest.json` is the authoritative list.

## Configure it for your repo

Two seams make it yours; everything else is generic:

- **`.wiki/config.json`** — your wiki's `name`, stale-page `highRisk` globs, and explicit Fresh-context mode/scope/evidence/reviewer trust policy.
- **`scripts/wiki/inventories.ts`** — optional. Teach the engine to emit deterministic `wiki/_generated/**` pages from your stack; read `kit/scripts/wiki/inventories.example.ts` in a wiki-ssot checkout for a worked adapter.

Omit `freshContext.requiredWhen` to require review for every PR. A `risk-based` selector can instead require it for trusted changed-file globs, affected invariants/conflicts, and current-page removals. For a solo-maintainer repository, set `trust.requireDifferentActor` to `false`: before opening the PR, the authoring agent must still use a separate context-isolated reviewer or sub-agent, but the authenticated publisher may be the PR author. Teams with a provisioned reviewer account or bot can set it to `true` to make distinct GitHub identities a CI-validated requirement.

## Trust boundary

wiki-ssot assumes that people with repository write or administration access are trusted. Its deterministic gates catch accidental drift and validate the declared review process; they do not defend against a maintainer who intentionally rewrites GitHub Actions or weakens repository settings. Organization-level controls such as required workflows, CODEOWNERS staffing, and administrator-bypass policy are deployment choices outside the product contract.

## License

[MIT](LICENSE).
