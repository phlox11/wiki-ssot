# Wiki page schema

Every content page except the wiki entrypoint, workflow, schema, changelog, and generated files starts with YAML frontmatter.

```yaml
---
id: features/checkout
summary: One-sentence description used by search and the generated index.
kind: feature
status: current
authority: observed
owners: ["@owner"]
sources:
  - path: src/checkout/index.ts
    symbols: [createCheckout]
  - glob: test/checkout/**/*.test.ts
affects: [product/invariants]
related: [architecture/api]
tags: [checkout, payments]
---
```

Required fields:

- `id`: unique, path-independent ID (conventionally `<group>/<name>`).
- `summary`: one-sentence search/index description.
- `kind`: page role — e.g. `product`, `invariant`, `architecture`, `feature`, `operation`, `proposal`, `conflict`.
- `status`: `current | proposed | deprecated | conflicted | archived`.
- `authority`: `normative | observed | derived`.
- `owners`: GitHub handle array.
- `sources`: array of `{path, symbols?}` or `{glob}`. A current page needs at least one source that exists. Optional `symbols` on a `.ts/.tsx/.js/.jsx` path are checked against the file's exports.

Optional `affects` and `related` values are page IDs and must resolve. `tags` are search terms.

`status: current` alone defines the current SSOT; there is no `wiki/current/` directory. A current page cannot use only a proposal as primary evidence. Future behavior stays `proposed` until an implementation PR promotes it.

Authorities:

- `normative`: approved intent or invariant that implementation must satisfy.
- `observed`: behavior directly established by executable sources.
- `derived`: deterministic inventory or explanation computed from primary sources.

## Proposal work items

A `kind: proposal` page may own a structured repository backlog in frontmatter:

```yaml
work_items:
  - id: PV-03
    title: Provide zero-knowledge repository-wide work discovery
    state: not-started
    executor: agent
    priority: critical
    depends_on: [PV-00]
    context_pages: [product/scope, product/invariants]
    acceptance:
      - A no-query command lists repository-wide outstanding work.
    evidence: []
```

Every item requires `id`, `title`, `state`, `priority`, `depends_on`, `context_pages`, `acceptance`, and `evidence`.

- `state`: `not-started | active | blocked | done | deferred`.
- `executor`: optional `agent | human | either`; omission normalizes to `agent` for backward compatibility. `agent` means a coding agent can perform the work, `human` means it requires a human capability such as an account, payment, physical device, credential, or legal declaration, and `either` means either executor can perform it.
- Executor and state are independent. Human work that can begin is still `not-started` and derives to `ready`; use `blocked` or `deferred` only for their ordinary lifecycle meanings.
- `priority`: `critical | high | normal | low`.
- Stored `not-started` derives to queue state `ready` when all dependencies are done and `waiting` otherwise.
- `blocked` requires a non-empty `blocker`; `deferred` requires a non-empty `deferred_reason`; `done` requires at least one durable `evidence` entry. Those conditional fields are illegal on other states.
- `active` and `done` require all dependencies to be done.
- IDs are repository-wide unique. Unknown, self, and cyclic dependencies are invalid.
- `context_pages` may name only existing, non-conflict `status: current` pages.
- A deprecated or archived proposal may retain only `done` or `deferred` work.

Frontmatter is the sole state, dependency, acceptance, and evidence contract. The proposal body keeps rationale rather than a second tracker. GitHub or provider records may appear as evidence, but the repository queue must remain complete offline.

`wiki:work` derives dependencies and queue state from the complete graph before applying an executor view. The default and `--executor all` views show every executor but recommend only `agent` or `either` work. `--executor agent` shows `agent` and `either`; `--executor human` shows `human` and `either` for human handoff and never recommends human-exclusive work. The existing `--all` flag independently includes completed rows, so it may be combined with any executor view. An executor value is classification, not authorization: it never grants external writes, destructive actions, credentials, or human authority.

Upgrade the Wiki SSOT engine before adding `executor: human` to an existing repository. Older engines ignore the classification when choosing recommendations; once upgraded, existing items may remain unmodified because omission continues to mean `agent`.

## Conflict pages

`wiki/conflicts.md` is generated. Each conflict is a content page under `wiki/conflicts/open/**` or `wiki/conflicts/resolved/**` with these additional fields:

```yaml
id: conflict/C-001
conflict_id: C-001
conflict_type: implementation   # decision | implementation | documentation
severity: high                  # high | medium | low
origin: baseline                # baseline | introduced_by_change
opened_at: 2026-01-31
affected_pages: [features/checkout]
affected_invariants: [product/invariants]
resolution:
  state: open                   # open | decision_pending | implementing | verified
  decision: null
  acceptance:
    - Define the missing behavior and cover it with a test.
  evidence: []
```

Open files require `status: conflicted`; resolved files require `status: archived`, `resolution.state: verified`, a decision, and evidence. Conflict `sources` must be non-empty so task context and diff impact can discover the item. Affected pages must be current, and affected invariants must be current invariant pages.

## Machine config (`.wiki/`)

- `.wiki/config.json` — version/name/`highRisk` plus an explicit `freshContext` policy. `freshContext` requires `mode: advisory | required`, `requiredVerdict: PASS`, `evidenceRequired`, and `trust.allowedReviewers` / `requireDifferentActor` / `requireAuthenticatedActor`. Optional `requiredWhen` is either `{kind: "all"}` or a `risk-based` selector with `changedFileGlobs` and boolean `affectedInvariants`, `affectedConflicts`, and `removedCurrentPages` signals; omitting it preserves all-PR review. An inert risk selector is invalid. Missing or malformed Fresh-context config is an integration error, not implicit advisory mode. `name` titles the generated index. A changed file matching a top-level `highRisk` glob makes its affected pages *high-risk* stale; that staleness label is separate from the Fresh-context `requiredWhen` selector. Both stale risk levels block.
- `.wiki/coverage.json` — `{ "version": 1, "include": ["glob", ...], "exclusions": [{ "glob": "...", "reason": "20+ chars" }] }`. Every included file must map to a current page's `sources`, or carry a reasoned exclusion.
- `.wiki/state.json` — generated verification ledger of per-page source hashes. Update with `bun run wiki:verify`.
- `.wiki/source-map.json`, `.wiki/conflict-map.json` — generated reverse indexes; never hand-edit.
- `.wiki/legacy-link-allowlist.json` — optional, time-boxed exceptions for known-broken links during migration.
