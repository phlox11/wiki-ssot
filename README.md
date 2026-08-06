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
- A **configured coverage** gate ensures every file matched by `.wiki/coverage.json` maps to a current page or a reasoned exclusion, so the repository can make its declared code boundary findable without pretending to cover files outside that boundary.
- When intent is unclear or code and wiki disagree, you open a **conflict** — a first-class, machine-tracked record with acceptance criteria — instead of guessing.
- Proposal frontmatter carries a validated, repository-wide **work queue**. An optional `executor: agent | human | either` classifies who can perform a task independently from its lifecycle state; omission remains backward-compatible `agent`. A fresh session can run `wiki:work` with no topic, node, or task ID, see human work without auto-selecting it, then load a selected item's current invariants, context pages, conflicts, sources, and non-current proposal owner through a compact default projection. Stable digests and focused commands route to detail, while `wiki:context -- --full` retains exhaustive body inspection.
- `wiki:review-preflight` decides whether independent reconciliation is required before a PR exists, prepares an exact content-addressed bundle with focused authority/source/test roles, and validates the separate review context's report. Draft PRs do not emit an expected Fresh-context failure; applicable Ready PRs reject missing, non-PASS, stale, malformed, empty-evidence, or untrusted reports.

Full rationale: [docs/design.md](docs/design.md).

## What is validated

The Primary findability and adoption exit gate is validated within the
configured product boundary. The checked-in
[PV-19 current-engine evaluation](docs/evidence/pv-19-primary-current.md)
passes all 8 versioned scenarios: 9/9 current pages, 4/4 invariants, 2/2
conflicts, and 18/18 implementation sources were recalled; all 14/14 authority
labels were correct; all 17 configured implementation/test paths mapped to
current authority; all 8 reconciled candidates passed lint and enforced impact;
and all 17 code-only drift probes were caught. The
[new-repository pilot](docs/evidence/pv-11-new-repository-agent-pilot.md)
reached green and correctly returned `not-required`, while the
[PV-18 current-kit review](docs/evidence/pv-18-existing-repository-current-kit-review-pass.json)
binds the existing-repository path after it exposed a real downstream workflow
defect, fixed it, and reached exact context-isolated `PASS`.

A user should expect a fresh coding-agent session to begin with an ordinary
question such as “what work remains?”, receive the repository-wide queue,
select recommended agent-capable active or ready work while preserving human work for handoff, and then receive its controlling current pages,
invariants, conflicts, and sources. They should also expect every file inside
their configured coverage to be mapped or explicitly excluded, and every
risk-selected candidate to complete independent reconciliation before
publication.

## Requirements

- [Bun](https://bun.sh) ≥ 1.1 (the engine uses `Bun.Glob`, `Bun.CryptoHasher`, and shells out to `git`).
- Git.
- GitHub Actions for the CI rail (optional but recommended); the local hooks and CLI work anywhere.

## Get started

The distribution is [`kit/`](kit/README.md) — a generated tree containing the toolkit and nothing about this repository. One idempotent command handles a Git-initialized project with no commits, an existing project adopting Wiki SSOT, and any later upgrade:

```sh
bun /path/to/WikiSsot/scripts/wiki/apply.ts --into /path/to/your-repo
```

The command detects `new`, `adopt`, or `upgrade`; installs and updates the toolkit; merges only `wiki:*` package scripts and compatible toolkit dependencies; preserves host lifecycle scripts; refreshes generated files; and runs the Wiki checks. It never creates commits, branches, or PRs. If project-specific Wiki meaning is missing or a merge is unsafe, it returns structured `needs-reconcile` or `needs-merge` work; the coding agent resolves that work and reruns the same command. [`kit/README.md`](kit/README.md) has the full contract.

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
bun run wiki:work -- --executor human  # human/either work to report and hand off
bun run wiki:context -- "enforcement"   # compact authority/source routing before a change
bun run wiki:context -- "enforcement" --full  # exhaustive page bodies when needed
```

## What's in the box

```
scripts/wiki/            # engine, CLI, provider/project adapters, kit tooling,
                         # and grouped regression/adoption/validation fixtures
wiki/                    # the SSOT pages + SCHEMA.md + WORKFLOW.md
.wiki/                   # machine config + generated indexes + verification ledger
.husky/                  # pre-commit (lint) + pre-push (block main)
.github/workflows/       # host checks + wiki-ssot.yml gates + kit.yml + weekly audit
AGENTS.md / CLAUDE.md    # the agent entrypoint
kit/                     # the generated distribution other repos copy
docs/                    # design + adoption playbooks + command reference
```

That is this repository's layout. Nothing outside [`kit/`](kit/README.md) travels to another repository, and not everything inside it does either — reference files are read in place rather than copied. `kit/files/.wiki/kit-manifest.json` is the authoritative list.

## Configure it for your repo

Three project seams make it yours; everything else is generic:

- **`.wiki/config.json`** — your wiki's `name`, stale-page `highRisk` globs, and explicit Fresh-context mode/scope/evidence/reviewer trust policy.
- **`.wiki/coverage.json`** — the implementation/test globs that must map to current pages, plus any narrowly reasoned exclusions.
- **`scripts/wiki/inventories.ts`** — optional. Teach the engine to emit deterministic `wiki/_generated/**` pages from your stack; read `kit/scripts/wiki/inventories.example.ts` in a wiki-ssot checkout for a worked adapter.

Omit `freshContext.requiredWhen` to require review for every PR. A `risk-based` selector can instead require it for trusted changed-file globs, affected invariants/conflicts, and current-page removals. For a solo-maintainer repository, set `trust.requireDifferentActor` to `false`: before opening the PR, the authoring agent must still use a separate context-isolated reviewer or sub-agent, but the authenticated publisher may be the PR author. Teams with a provisioned reviewer account or bot can set it to `true` to make distinct GitHub identities a CI-validated requirement.

## Required integration seam

Adoption is complete only while the installed repository keeps the full seam:
a root `AGENTS.md` with the affirmative current-authority, no-query work,
human-work handoff, and focused/topic context routes; the structured PR metadata template; the
Ready-only `wiki-review-attestation` CI job and required events; and the
canonical package commands. `wiki:doctor` checks these provider-neutral and
GitHub reference surfaces together and fails when one is missing or reduced to
a marker, placeholder, command list, or explicitly negated route.

## Non-guarantees and trust boundary

- wiki-ssot does not host or run an LLM/reviewer; the invoking agent or orchestrator supplies the separate review context.
- Queue recommendations, executor classifications, and review dispositions do not authorize work or make product decisions. `either` does not expand external-write or destructive authority; ambiguity remains an owner decision or conflict.
- Exact report bindings prove which artifact was attested, not cryptographic freshness, independence, or quality of the reviewer's reasoning.
- Repository write/admin actors are trusted. The gates catch accidental drift and validate the declared process, but do not defend against a maintainer who intentionally rewrites workflows or weakens settings. Required workflows, CODEOWNERS staffing, rulesets, and administrator-bypass policy remain deployment choices.

## License

[MIT](LICENSE).
