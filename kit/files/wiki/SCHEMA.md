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
    context: always
  - glob: test/checkout/**/*.test.ts
    context: catalog
    reason: Track the complete checkout test boundary without reading every test in ordinary compact context.
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
- `sources`: array of `{path, symbols?, context?}` or `{glob, context?, reason?}`. `context` is `always | catalog`: `always` enters the compact mandatory read order, while `catalog` remains fully tracked but is represented there by its declaration, reason, path count, bytes, digest, and expansion command. Optional `symbols` on a `.ts/.tsx/.js/.jsx` path are checked against the file's exports.

Source context changes reading cost only. Source maps, configured coverage, verification hashes, drift, impact, conflict mapping, and full context continue to expand the complete declaration. A declaration with no `context` is a legacy `always` declaration so an engine upgrade does not break an existing repository. Any declaration added or changed relative to the selected base must state `context` explicitly; `catalog` requires a concrete reason of at least 20 characters, and every current page that uses catalog context retains at least one effective `always` anchor. `wiki:scope -- --base <ref>` audits these structural rules and explains breadth and review-selection causes without imposing numeric budgets.

Optional `affects` and `related` values are page IDs and must resolve. They are directed navigation declarations: they appear in the generated catalog and relationship graph but do not by themselves propagate current authority, staleness, impact, or review scope. `tags` are search terms.

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

- `.wiki/config.json` — version 2 declares `enforcement.mode: local-status`, its status context, argv-array `localChecks`, and an explicit reasoned `review.when` selector. `semanticVerify` contains `enabled` and `reason`; enabled true requires a 20+ character reason and selects canonical `semantic_change: true` plus `wiki_action: verify` metadata even without another risk signal, while explicit false preserves selection by changed-file rules, actual kit-owned files, affected invariants/conflicts, and removed current pages. Omission remains readable only for a targeted migration finding and cannot pass doctor or the canonical local gate; malformed selector state is invalid. Version 2 has no implicit all-PR fallback. Version 1 remains readable with its `freshContext` mode, verdict/evidence/trust policy, optional all/risk-based `requiredWhen`, and historical authenticated-actor semantics. A changed file matching top-level `highRisk` still labels its affected page staleness; that label is separate from either review selector. `name` titles generated navigation and `publishesKit` enables publisher-only kit checks.
- `.wiki/coverage.json` — `{ "version": 1, "include": ["glob", ...], "exclusions": [{ "glob": "...", "reason": "20+ chars" }] }`. Every included file must map to a current page's `sources`, or carry a reasoned exclusion.
- `.wiki/state.json` — generated verification ledger of per-page source hashes. Update with `bun run wiki:verify`.
- `.wiki/source-map.json`, `.wiki/conflict-map.json` — generated reverse indexes; never hand-edit.
- `.wiki/relationship-graph.json` — generated page/work graph. It contains stable page and work nodes plus declared `related`, `affects`, conflict affected-page/invariant, work context-page, and work dependency edges. It is a disposable navigation projection, not authority.
- `.wiki/legacy-link-allowlist.json` — optional, time-boxed exceptions for known-broken links during migration.
