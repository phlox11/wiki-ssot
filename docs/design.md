# Design

wiki-ssot exists to stop one expensive failure mode and a secondary one. Repository checks remain deterministic, while the authoring code agent performs risk-selected independent semantic reconciliation before opening a PR and CI verifies the resulting attestation for applicable Ready PRs.

## The problem

The real contributors to a modern repository are increasingly **context-less coding agents in fresh sessions**. That produces two failures:

- **Primary — blind edits.** An agent cannot find the code or the constraint it should have accounted for, so it edits blind: it repeats a mistake that was already fixed, or violates an intent it never saw. (An agent that is simply lazy, or misreads code it *did* find, is out of scope — that is a model problem, not a findability problem.)
- **Secondary — cross-PR drift.** Two individually-correct pull requests merge and leave the wiki contradicting itself, because neither author saw the other's change.

Documentation drift is not a one-time mess to clean up. It is *regenerated* every time an agent changes code without changing docs, or reads a stale doc and assumes wrongly. So the fix cannot be a cleanup; it has to be a standing, mechanical gate on events that always happen.

## Operating principle: no holes inside the declared trust boundary

Start with maximum closure inside the product's declared trust boundary — every deterministic check rejects invalid candidates from day one — then relax whatever proves too costly in real use. Where "no holes" is impossible (a semantic contradiction, an unwritten decision, or an actor intentionally weakening repository policy), say so rather than pretend a gate covers it.

## The truth model

"Is the doc or the code the truth?" is the wrong question. Separate the *kinds* of truth:

| Layer | Meaning | Authority |
|---|---|---|
| `status: current` wiki pages | agreed intent, architecture, contracts, invariants | **SSOT for intent** |
| code, tests, schemas, migrations | what actually runs | **implementation evidence** |
| `status: proposed` pages | not yet built or approved | not current |
| conflict records | unresolved disagreements | a decision queue |
| proposal `work_items` | validated future-work contracts and dependencies | not current behavior |
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

1. **Session start** — every agent auto-reads `AGENTS.md`: a generic remaining-work request routes to the no-query repository queue, while selected work routes to its current invariants, context pages, conflicts, sources, and explicitly non-current proposal owner. (Compliance rail.)
2. **Local commit** — a pre-commit hook runs the cheap structural lint on staged files; a pre-push hook blocks direct pushes to `main`. Bypassable feedback.
3. **Pre-PR / pull request / CI** — `wiki:review-preflight` prepares and validates risk-selected independent reconciliation before publication. Structural, generated-freshness, impact, integration-seam, and Ready-only review-attestation checks then reject invalid candidates; deployments that make those jobs required checks also use them to block merges. A weekly job re-audits everything.

## What rejects an invalid candidate (all deterministic)

These checks block a GitHub merge only when deployment policy makes their jobs required; otherwise they still fail deterministically and provide evidence to trusted maintainers.

- **Structure** (`wiki:lint`): frontmatter and required fields, duplicate page/work IDs, work dependency/lifecycle/context rules, broken internal links, missing source paths, orphaned/empty globs, coverage, and generated-file freshness.
- **Generated freshness** (`wiki:generated --check`): the index, current-status, repository work queue, conflicts index, reverse maps, and any code-derived inventories must match a clean regeneration.
- **Impact** (`wiki:impact --enforce`): from the PR diff, compute affected pages and conflicts, then reject — a changed source whose page is stale or unverified; an unmapped high-risk source; a current page silently dropped; PR metadata that omits an affected page or conflict; an invalid conflict transition; or `wiki_action: none` on a code change.
- **Integration seams** (`wiki:doctor`): provider-neutral core checks require the Fresh-context config, canonical CLI commands, and a root `AGENTS.md` whose marked guidance meaningfully routes agents through the wiki index/current status/invariants, no-query generic work discovery, selected-work context, topic search/context, and non-current authority labels. Marker-only, placeholder, and command-name-only entrypoints fail. The GitHub adapter separately checks the PR metadata template and stable workflow job. The composed command requires every selected seam to remain installed.
- **Fresh-context preflight and attestation** (`wiki:review-preflight`, `wiki:review-check`): before PR creation, use trusted policy and the actual impact/manifest to return `not-required` or prepare a review bundle. The authoring agent reconciles actionable findings from a separate review context until local PASS. For applicable Ready PRs, CI recomputes the manifest and rejects a missing, malformed, non-PASS, stale, empty-evidence, or untrusted report.

The distinction between *high-risk* and *low-risk* stale no longer decides pass/fail — both fail validation. It sharpens where a human looks first.

## Zero-knowledge work discovery

Proposal pages may own `work_items` in structured frontmatter. The engine validates their repository-wide ID graph, lifecycle fields, current-page context targets, dependencies, priorities, blockers, deferred reasons, and durable done evidence. It derives `not-started` into `ready` or `waiting`, recommends active work before ready work by explicit priority and ID, and never auto-selects blocked, waiting, deferred, or conflict records.

`wiki:work` needs no search term and works offline. Its deterministic Markdown twin, `wiki/work-queue.md`, is generated and linked from both entrypoints. `wiki:context -- --work <ID>` then assembles the work contract, every current invariant, declared current context pages, related open conflicts, exact/glob sources, and the owning proposal under the explicit label `NON-CURRENT WORK OWNER`. This makes a plain "what work remains?" sufficient for re-entry without turning proposals into current authority or making the engine interpret natural language.

## Verification without commit-hash churn

Pinning a commit SHA into every page would make every commit touch every page. Instead the engine stores a blob **hash of each page's sources** in `.wiki/state.json`. A source change makes the page stale; you clear it by editing the page and running `wiki:verify`, or — when meaning did not change — by recording an explicit `--unchanged "<reason>"`. Batching this per PR (not per commit) keeps the busywork on the hottest files small.

## Conflicts are first-class

A missing or ambiguous decision is not permission to invent behavior; it is a **conflict**. Each conflict is a page under `wiki/conflicts/open/**` with a type, severity, affected pages/invariants, and **acceptance criteria**. A PR whose diff touches a conflict's sources must declare `resolve`, `retain`, or `introduce` — and `resolve` is only accepted when the archived, verified record, the current pages, and the evidence all line up. This is how two parallel PRs cannot quietly re-open or bury a known disagreement.

## Why no LLM in the deterministic validation path

CI does not need to invoke an LLM, depend on one vendor, or turn model availability into an implicit repository secret. Before a PR exists, `wiki:review-preflight` classifies actual changed paths, merge-base/HEAD affected invariants, affected conflicts, and current-page removals. When review applies it produces a manifest bound to the full candidate HEAD, merge-base, canonical semantic metadata, impact report, diff, affected pages/invariants/conflicts, and path-sorted bundle file hashes. The authoring code agent gives that bundle to a context-isolated reviewer or sub-agent, reconciles actionable `NEEDS_RECONCILE` findings, and validates PASS locally.

The Ready-only `wiki-review-attestation` job performs no semantic inference or Fresh-context review. Its risk selector is deterministic and executes from trusted base code/policy rather than author labels alone. For applicable changes it recomputes the manifest and validates the external attestation's schema, verdict, evidence, exact SHA/digests, authenticated actor, allowlist, and—when enabled—author-separation policy. This reliably prevents omission, reuse after a new commit or metadata change, a PASS for the wrong base, empty evidence, and an author-editable PR-body string masquerading as the authenticated report. Risk-based mode deliberately does not provide the same semantic-review coverage for non-selected changes.

That does **not** prove the reviewer really had no prior context, reasoned well, or inspected every claimed source. Context isolation and reviewer quality remain inside the selected reviewer/orchestrator trust boundary. The default GitHub reference policy is therefore accurately an **attestation presence guard**, not cryptographic proof of independent cognition.

Actor separation is a deployment choice. When review applies, a solo repository uses `requireDifferentActor: false`: a separate context-isolated session creates the report, while the PR author's authenticated GitHub account may publish it. CI can verify the publisher and bindings, but not the session separation. A team can set `requireDifferentActor: true` after provisioning a second reviewer account or bot; enabling it without that channel intentionally fails the attestation job for applicable solo PRs and blocks merge only where deployment policy makes that job required.

Reviewer failures are explicit rather than hidden: every `NEEDS_RECONCILE` finding is dispositioned before PR creation — fixed, tracked in an open conflict with acceptance criteria, or recorded as a named follow-up — and each new HEAD receives a new bundle/review. Convergence is therefore defined by disposition rather than by an empty finding list, which keeps a large change from looping until the whole repository is perfect. Ambiguity becomes a conflict or owner decision rather than a speculative repair loop. A required report is attached to a Draft after local PASS; Drafts skip the review-attestation check, while the Ready-PR job succeeds only with either `required: false` or PASS for the current HEAD. Deployment policy decides whether that job is required for merge. Projects that deliberately choose `advisory` mode receive warnings; missing config never silently becomes advisory. Existing configurations that omit `requiredWhen` retain all-PR review.

## GitHub reference trust boundary

The GitHub reference job runs on `pull_request` for non-Draft PRs so GitHub associates the Ready-only validation check with the PR test-merge commit without producing an expected failure while a locally-passed report is being attached. It explicitly checks out the base implementation and trust policy, fetches the PR HEAD into a detached worktree, and treats every head file as data. Bun remains in the trusted base working directory and receives the detached head only through the CLI's `--root` data path, so an untrusted `bunfig.toml` or preload cannot run before validation. The job never imports scripts, installs dependencies, or runs commands from the PR head. The external report is selected from GitHub PR reviews/comments and its `reviewer` must match the authenticated envelope actor; the PR body's `fresh_context` block is only a required status mirror. Marking the prepared Draft Ready triggers the Ready-only validation job.

This still has a bootstrap boundary. The engine and trust policy are pinned to the base, but the `pull_request` workflow definition is part of the PR test-merge tree and can itself be edited. A rewrite that preserves a required job name can counterfeit success. wiki-ssot explicitly assumes that repository developers and administrators are trusted not to do that; defending against those actors with required workflows, CODEOWNERS, rulesets, or administrator-bypass policy is organization-level governance outside the product contract. Deployments may add those controls, but the toolkit neither requires nor audits them. A green job is therefore evidence within the trusted-maintainer model, not a security guarantee against a hostile or compromised maintainer.

## What it is not

- Not a docs-site generator or a hosted service.
- Not an auto-generated API reference that replaces written intent.
- Not a decision-maker: ambiguity becomes a conflict for a human to resolve.
- Not an organization-security policy that governs trusted repository developers or administrators.

## Credit

The `source → wiki → schema` framing is from Andrej Karpathy's [LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). wiki-ssot adds the deterministic schema, the reverse-index/staleness engine, the conflict lifecycle, and the three enforcement rails.
