# Design

wiki-ssot exists to stop one expensive failure mode and a secondary one. Repository checks remain deterministic, and trusted base policy identifies changes where semantic reconciliation is supplied by an external reasoning reviewer whose attestation is deterministically verified before merge.

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
3. **Pull request / CI** — the full structural, generated-freshness, impact, integration-seam, and Fresh-context policy checks block the merge; risk-selected changes additionally require an attestation, and a weekly job re-audits everything.

## What blocks a merge (all deterministic)

- **Structure** (`wiki:lint`): frontmatter and required fields, duplicate IDs, broken internal links, missing source paths, orphaned/empty globs, coverage, and generated-file freshness.
- **Generated freshness** (`wiki:generated --check`): the index, current-status, conflicts index, reverse maps, and any code-derived inventories must match a clean regeneration.
- **Impact** (`wiki:impact --enforce`): from the PR diff, compute affected pages and conflicts, then block on — a changed source whose page is stale or unverified; an unmapped high-risk source; a current page silently dropped; PR metadata that omits an affected page or conflict; an invalid conflict transition; or `wiki_action: none` on a code change.
- **Integration seams** (`wiki:doctor`): provider-neutral core checks require the Fresh-context config, root `AGENTS.md` marker, and CLI commands; the GitHub adapter separately checks the PR metadata template and stable workflow job. The composed command requires every selected seam to remain installed.
- **Fresh-context policy and attestation** (`wiki:review-check`): use trusted policy and the actual impact/manifest to return `required` plus reasons. Low-risk changes pass without a report. Applicable changes recompute the bundle manifest from the current base/HEAD/metadata, then reject a missing, malformed, non-PASS, stale, empty-evidence, or untrusted report.

The distinction between *high-risk* and *low-risk* stale no longer decides pass/fail — both block. It sharpens where a human looks first.

## Verification without commit-hash churn

Pinning a commit SHA into every page would make every commit touch every page. Instead the engine stores a blob **hash of each page's sources** in `.wiki/state.json`. A source change makes the page stale; you clear it by editing the page and running `wiki:verify`, or — when meaning did not change — by recording an explicit `--unchanged "<reason>"`. Batching this per PR (not per commit) keeps the busywork on the hottest files small.

## Conflicts are first-class

A missing or ambiguous decision is not permission to invent behavior; it is a **conflict**. Each conflict is a page under `wiki/conflicts/open/**` with a type, severity, affected pages/invariants, and **acceptance criteria**. A PR whose diff touches a conflict's sources must declare `resolve`, `retain`, or `introduce` — and `resolve` is only accepted when the archived, verified record, the current pages, and the evidence all line up. This is how two parallel PRs cannot quietly re-open or bury a known disagreement.

## Why no LLM in the blocking path

CI does not need to invoke an LLM, depend on one vendor, or turn model availability into an implicit repository secret. Trusted base policy first classifies the actual changed paths, affected invariants/conflicts, and current-page removals. When review applies, `wiki:review-bundle` deterministically produces a manifest bound to the full PR HEAD, merge-base, canonical semantic PR metadata, canonical impact report, diff, affected pages/invariants/conflicts, and path-sorted bundle file hashes. A context-isolated reasoning reviewer reads that bundle and primary sources outside the blocking job, then publishes a structured `PASS` or `NEEDS_RECONCILE` report.

The blocking `wiki-fresh-context` job performs no semantic inference. Its risk selector is deterministic and executes from trusted base code/policy rather than author labels alone. For applicable changes it recomputes the manifest and validates the external attestation's schema, verdict, evidence, exact SHA/digests, authenticated actor, allowlist, and—when enabled—author-separation policy. This reliably prevents omission, reuse after a new commit or metadata change, a PASS for the wrong base, empty evidence, and an author-editable PR-body string masquerading as the authenticated report. Risk-based mode deliberately does not provide the same semantic-review coverage for non-selected changes.

That does **not** prove the reviewer really had no prior context, reasoned well, or inspected every claimed source. Context isolation and reviewer quality remain inside the selected reviewer/orchestrator trust boundary. The default GitHub reference policy is therefore accurately an **attestation presence guard**, not cryptographic proof of independent cognition.

Actor separation is a deployment choice. When review applies, a solo repository uses `requireDifferentActor: false`: a separate context-isolated session creates the report, while the PR author's authenticated GitHub account may publish it. CI can verify the publisher and bindings, but not the session separation. A team can set `requireDifferentActor: true` after provisioning a second reviewer account or bot; enabling it without that channel intentionally makes applicable solo PRs unmergeable.

LLM or reviewer failures are explicit rather than hidden: `NEEDS_RECONCILE` requires a fix, new bundle, and new review; malformed or unavailable output leaves an applicable required check failed. Draft PRs may remain open with a pending/failing Fresh-context check, but Ready/merge requires either `required: false` or PASS for the current HEAD. Projects that deliberately choose `advisory` mode receive warning findings and a zero exit status; missing config never silently becomes advisory. Existing configurations that omit `requiredWhen` retain all-PR review.

## GitHub reference trust boundary

The GitHub reference job runs on `pull_request` so GitHub associates the required check with the PR test-merge commit. It explicitly checks out the base implementation and trust policy, fetches the PR HEAD into a detached worktree, and treats every head file as data. Bun remains in the trusted base working directory and receives the detached head only through the CLI's `--root` data path, so an untrusted `bunfig.toml` or preload cannot run before validation. The job never imports scripts, installs dependencies, or runs commands from the PR head. The external report is selected from GitHub PR reviews/comments and its `reviewer` must match the authenticated envelope actor; the PR body's `fresh_context` block is only a required status mirror. After publication, mirroring the report into that block triggers the required `edited` activity and re-runs the check.

This still has a bootstrap boundary. The engine and trust policy are pinned to the base, but the `pull_request` workflow definition is part of the PR test-merge tree and can itself be edited. Removing the required job leaves branch protection waiting, but a malicious step rewrite can counterfeit success unless the repository additionally protects this workflow—for example with a ruleset-required workflow or CODEOWNERS plus required owner review. The first PR that installs this guard is likewise not protected by a check that does not yet exist on the base. Branch protection must require `wiki-fresh-context` alongside the existing checks. Without those repository settings, a green job is evidence, not a complete trust boundary.

## What it is not

- Not a docs-site generator or a hosted service.
- Not an auto-generated API reference that replaces written intent.
- Not a decision-maker: ambiguity becomes a conflict for a human to resolve.

## Credit

The `source → wiki → schema` framing is from Andrej Karpathy's [LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). wiki-ssot adds the deterministic schema, the reverse-index/staleness engine, the conflict lifecycle, and the three enforcement rails.
