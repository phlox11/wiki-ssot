# wiki-ssot

**A living, enforced Single Source of Truth wiki that coding agents maintain alongside code.**

Coding agents increasingly do the work in a repository, each starting from a blank slate. Two failures follow:

1. **Primary failure:** an agent that *cannot find the code or constraint it should have accounted for*, so it edits blind — repeating a fixed mistake or breaking an intent it never saw.
2. **Secondary failure:** two individually-correct pull requests merge into a wiki that now contradicts itself.

wiki-ssot fixes both with deterministic repository gates plus pre-PR, risk-scoped Fresh-context reconciliation. Before opening a PR, the authoring code agent gives a deterministic bundle to a context-isolated reviewer or sub-agent and reconciles any concrete code/wiki mismatch. The exact committed result is checked locally and published to GitHub as a commit status; GitHub does not run the engine or an LLM.

It is derived from Andrej Karpathy's [LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) `source → wiki → schema` idea, hardened into an enforcement system.

## The idea in one screen

- **`wiki/**` pages with `status: current` are the SSOT** for intent, architecture, contracts, invariants, and operations. Code and tests are *implementation evidence*.
- Each page's frontmatter lists its **`sources`** (real paths / globs). The engine builds a reverse index and **hashes those sources**. When a source changes, its page goes *stale* and must be updated or explicitly verified — in the same PR.
- A **configured coverage** gate ensures every file matched by `.wiki/coverage.json` maps to a current page or a reasoned exclusion, so the repository can make its declared code boundary findable without pretending to cover files outside that boundary.
- When intent is unclear or code and wiki disagree, you open a **conflict** — a first-class, machine-tracked record with acceptance criteria — instead of guessing.
- Proposal frontmatter carries a validated, repository-wide **work queue**. An optional `executor: agent | human | either` classifies who can perform a task independently from its lifecycle state; omission remains backward-compatible `agent`. A fresh session can run `wiki:work` with no topic, node, or task ID, see human work without auto-selecting it, then load a selected item's current invariants, context pages, conflicts, sources, and non-current proposal owner through a compact default projection. Stable digests and focused commands route to detail, while `wiki:context -- --full` retains exhaustive body inspection.
- A bounded **`wiki/index.md` entrypoint** routes by first path group into a complete generated catalog. Current-status exposes current/proposal, outstanding/done work, open/resolved conflict, and archived/deprecated totals; a generated relationship graph exposes declared page/work links without changing authority or validation semantics.
- `wiki:review-preflight` decides whether independent reconciliation is required before a PR exists, prepares an exact content-addressed bundle with focused authority/source/test roles, and validates the separate review context's report. `wiki:check` binds that report and every deterministic check to the committed HEAD; `wiki:publish` refuses stale evidence before posting the protected status.

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

The checked-in [Schooled-equivalent](docs/evidence/wsn-01-schooled-scale.md)
and [large](docs/evidence/wsn-01-large-scale.md) scale-navigation evidence
validates two deterministic profiles. The larger profile contains 1,000 current pages, 100 proposals,
10,000 work items, 1,000 conflicts, and 10,000 source files while retaining
full-repository validation. Its enforced publisher envelope is 30 seconds per
measured engine phase, at most 1 GiB peak RSS, at most 64 KiB for the bounded
entry index, exact generated/queue/graph counts, and zero findings. Runtime and
RSS remain host-sensitive evidence rather than a universal latency guarantee.

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
- `gh` authenticated to the target repository only when publishing a local result to GitHub. GitHub Actions are not required by the v2 local-status path.

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

This repository **dogfoods itself** — its own `wiki/` describes the toolkit, its gates run locally, and the exact result is published as the required GitHub commit status. Clone it and run:

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

## Local result and status

After committing the candidate, run the canonical local gate with semantic PR
metadata and, when selected, the independently produced review report:

```sh
bun run wiki:check -- --base origin/main --metadata pr-body.md \
  --output /tmp/wiki-result.json
# With a review report:
bun run wiki:check -- --base origin/main --metadata pr-body.md \
  --report review-report.json --output /tmp/wiki-result.json
bun run wiki:publish -- --result /tmp/wiki-result.json
# Or identify the PR explicitly:
bun run wiki:publish -- --result /tmp/wiki-result.json --repo owner/repo --pr 123
```

Version 2 configuration also runs every project-owned `localChecks` argv array.
Toolkit-owned changes select the Wiki tooling typecheck and complete tooling
suite, and publisher changes additionally run kit freshness and growth guards.
The result binds the exact committed HEAD, resolved base and merge-base,
canonical metadata digest, check/review summaries and findings, and a
deterministic result digest. The check rejects other dirty or untracked files;
the explicitly supplied metadata, report, and result paths are allowed. The
publisher revalidates the schema and digest, requires the same clean local
HEAD, and compares it with the remote PR head before writing. It upserts one
`wiki-ssot:local-status` marker comment and then posts the
`wiki-ssot/local` commit status. Warnings remain a successful status and are
listed in the comment; GitHub/API failures return non-zero and are never
treated as success. The PR template carries only semantic metadata; review
evidence stays in the exact report rather than being mirrored into editable PR
text. No Draft-to-Ready choreography, daemon, GitHub App, hosted service, or
active Wiki Actions workflow is introduced.

## What's in the box

```
scripts/wiki/            # engine, CLI, provider/project adapters, kit tooling,
                         # and grouped regression/adoption/validation fixtures
wiki/                    # the SSOT pages + SCHEMA.md + WORKFLOW.md
.wiki/                   # machine config + generated maps/relationship graph + verification ledger
.husky/                  # pre-commit (lint) + pre-push (block main)
.github/                 # PR template; v2 ships no active Actions workflows
AGENTS.md / CLAUDE.md    # the agent entrypoint
kit/                     # the generated distribution other repos copy
docs/                    # design + adoption playbooks + command reference
```

That is this repository's layout. Nothing outside [`kit/`](kit/README.md) travels to another repository, and not everything inside it does either — reference files are read in place rather than copied. `kit/files/.wiki/kit-manifest.json` is the authoritative list.

## Configure it for your repo

Three project seams make it yours; everything else is generic:

- **`.wiki/config.json`** — version 2 names the repository, local-status context, argv-based project checks, and explicit reasoned review-selection signals. Version 1 Fresh-context policy remains readable for compatibility.
- **`.wiki/coverage.json`** — the implementation/test globs that must map to current pages, plus any narrowly reasoned exclusions.
- **`scripts/wiki/inventories.ts`** — optional. Teach the engine to emit deterministic `wiki/_generated/**` pages from your stack; read `kit/scripts/wiki/inventories.example.ts` in a wiki-ssot checkout for a worked adapter.

Version 2 requires an explicit risk-based selector; it never falls back to all-PR review. Every changed-file rule carries a reason, actual kit-owned changes are selected from the kit manifest, and invariant/conflict/removal signals remain available. Local status proves exact evidence, not a distinct GitHub reviewer identity. A version 1 team that requires a different authenticated actor stays on its external enforcement path until it deliberately changes that trust policy.

## Required integration seam

Adoption is complete only while the installed repository keeps the full seam:
a root `AGENTS.md` with the affirmative current-authority, no-query work,
human-work handoff, and focused/topic context routes; the semantic PR metadata
template; explicit v2 local-status configuration; and the canonical local
check/publish commands. `wiki:doctor` checks these surfaces and fails when v2
configuration still coexists with legacy active Wiki workflows. Version 1
GitHub attestation remains an isolated compatibility seam for existing adopters.

## Non-guarantees and trust boundary

- wiki-ssot does not host or run an LLM/reviewer; the invoking agent or orchestrator supplies the separate review context.
- Queue recommendations, executor classifications, and review dispositions do not authorize work or make product decisions. `either` does not expand external-write or destructive authority; ambiguity remains an owner decision or conflict.
- Exact report bindings prove which artifact was attested, not cryptographic freshness, independence, or quality of the reviewer's reasoning.
- Repository write/admin actors are trusted. The gates catch accidental drift and validate the declared process, but do not defend against a maintainer who intentionally rewrites workflows or weakens settings. Required workflows, CODEOWNERS staffing, rulesets, and administrator-bypass policy remain deployment choices.

## License

[MIT](LICENSE).
