# Design

wiki-ssot exists to stop one expensive failure mode and a secondary one, using only deterministic machinery in the blocking path.

## The problem

The real contributors to a modern repository are increasingly **context-less coding agents in fresh sessions**. That produces two failures:

- **Primary — blind edits.** An agent cannot find the code or the constraint it should have accounted for, so it edits blind: it repeats a mistake that was already fixed, or violates an intent it never saw. (An agent that is simply lazy, or misreads code it *did* find, is out of scope — that is a model problem, not a findability problem.)
- **Secondary — cross-PR drift.** Two individually-correct pull requests merge and leave the wiki contradicting itself, because neither author saw the other's change.

Documentation drift is not a one-time mess to clean up. It is *regenerated* every time an agent changes code without changing docs, or reads a stale doc and assumes wrongly. So the fix cannot be a cleanup; it has to be a standing, mechanical gate on events that always happen.

## Operating principle: no holes first, relax empirically

Start with maximum closure — every deterministic check blocks from day one — then relax whatever proves too costly in real use. Where "no holes" is impossible (a semantic contradiction, an unwritten decision), say so rather than pretend a gate covers it.

## The truth model

"Is the doc or the code the truth?" is the wrong question. Separate the *kinds* of truth:

| Layer | Meaning | Authority |
|---|---|---|
| `status: current` wiki pages | agreed intent, architecture, contracts, invariants | **SSOT for intent** |
| code, tests, schemas, migrations | what actually runs | **implementation evidence** |
| `status: proposed` pages | not yet built or approved | not current |
| conflict records | unresolved disagreements | a decision queue |
| git history | who changed what, when | history of record |

Rules that follow:

- An agent does **not** overwrite a current page just because the code is newer. A disagreement that could change behavior becomes a **conflict**, not a silent edit.
- A `status: current` page cannot rest solely on a proposal as evidence.
- Future behavior stays `proposed` until an implementation PR promotes it.

## source → wiki → schema

- **source:** version-controlled code, tests, contracts, migrations, and approved source documents.
- **wiki:** the current knowledge layer compiled from sources, each page linking back to its `sources`.
- **schema:** `wiki/SCHEMA.md` (the page contract) and `AGENTS.md` (how agents work) — the rules the tooling enforces.

## The three rails

Enforcement is only real if it fires on events that always happen:

1. **Session start** — every agent auto-reads `AGENTS.md`: the entrypoint, the workflow, the commands, the invariants. (Compliance rail.)
2. **Local commit** — a pre-commit hook runs the cheap structural lint on staged files; a pre-push hook blocks direct pushes to `main`. Bypassable feedback.
3. **Pull request / CI** — the full structural, generated-freshness, and impact checks block the merge; a weekly job re-audits everything.

## What blocks a merge (all deterministic)

- **Structure** (`wiki:lint`): frontmatter and required fields, duplicate IDs, broken internal links, missing source paths, orphaned/empty globs, coverage, and generated-file freshness.
- **Generated freshness** (`wiki:generated --check`): the index, current-status, conflicts index, reverse maps, and any code-derived inventories must match a clean regeneration.
- **Impact** (`wiki:impact --enforce`): from the PR diff, compute affected pages and conflicts, then block on — a changed source whose page is stale or unverified; an unmapped high-risk source; a current page silently dropped; PR metadata that omits an affected page or conflict; an invalid conflict transition; or `wiki_action: none` on a code change.

The distinction between *high-risk* and *low-risk* stale no longer decides pass/fail — both block. It sharpens where a human looks first.

## Verification without commit-hash churn

Pinning a commit SHA into every page would make every commit touch every page. Instead the engine stores a blob **hash of each page's sources** in `.wiki/state.json`. A source change makes the page stale; you clear it by editing the page and running `wiki:verify`, or — when meaning did not change — by recording an explicit `--unchanged "<reason>"`. Batching this per PR (not per commit) keeps the busywork on the hottest files small.

## Conflicts are first-class

A missing or ambiguous decision is not permission to invent behavior; it is a **conflict**. Each conflict is a page under `wiki/conflicts/open/**` with a type, severity, affected pages/invariants, and **acceptance criteria**. A PR whose diff touches a conflict's sources must declare `resolve`, `retain`, or `introduce` — and `resolve` is only accepted when the archived, verified record, the current pages, and the evidence all line up. This is how two parallel PRs cannot quietly re-open or bury a known disagreement.

## Why no LLM in the blocking path

A non-deterministic gate that is sometimes wrong trains people to ignore it, and then it protects nothing. Every blocking check here is a pure function of tracked files. The one thing only a reasoning model can do — read a diff and judge whether the wiki still *reads* coherently across pages — is provided as a **fresh-context reconcile pass** (`wiki:review-bundle` → a `PASS` / `NEEDS_RECONCILE` verdict) and is **advisory**: attach it to the PR, do not auto-block on it. Escalating it to a required, LLM-in-CI gate is left as a deliberate per-project choice, because an LLM-as-gate is itself a new source of flakiness.

## What it is not

- Not a docs-site generator or a hosted service.
- Not an auto-generated API reference that replaces written intent.
- Not a decision-maker: ambiguity becomes a conflict for a human to resolve.

## Credit

The `source → wiki → schema` framing is from Andrej Karpathy's [LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). wiki-ssot adds the deterministic schema, the reverse-index/staleness engine, the conflict lifecycle, and the three enforcement rails.
