---
id: architecture/engine
summary: A provider-neutral Bun/TypeScript engine drives deterministic wiki, work discovery, and Fresh-context attestation checks; thin CLI, GitHub adapter, and inventory seams connect it to repositories.
kind: architecture
status: current
authority: observed
owners: ["@phlox11"]
sources:
  - glob: scripts/wiki/**/*.ts
  - path: scripts/wiki/tsconfig.json
related: [operations/enforcement, product/invariants]
tags: [architecture, engine]
---

# Engine

The engine has one-way layers: `model.ts` owns Wiki models; `serialization.ts` stable JSON and hashes; `repository-view.ts` normalized working or staged reads; page/work validation their respective rules; `discovery.ts` search and queues; `context.ts` source-complete projections; `generated-views.ts` deterministic Wiki views and maps; `verification.ts` state, configuration, coverage, source mapping, and integration seams; `impact.ts` diffs, PR metadata, affected authority and conflict lifecycle, and risk selection; `review-bundle.ts` exact-revision focused inputs and bundle digests; `review-attestation.ts` report parsing, finding adjudication, trust, and review checks; and `kit-packaging.ts` portable entries, rendering, manifests, comparison, and writes. None imports `core.ts`.

`core.ts` stays the compatibility facade and owns reusable handoffs plus cross-domain lint, audit, generated-file, and Markdown-link orchestration. It re-exports the verification, impact, bundle, and attestation APIs by identity. The CLI runtime preserves the frozen parser, 17-command order, injectable output, and exit outcomes; the renderer owns work/context text; and bounded discovery, generation, validation/impact, and review handlers import inward toward the domain modules, using only the narrow cross-domain operations that remain in the facade. No handler is imported by a domain module. Impact never imports either review module; attestation may consume impact and bundle construction; kit packaging retains its minimal model, repository-view, and serialization dependencies. `kit-sync.ts` remains standalone for pre-install use.

The agent-entrypoint seam requires affirmative line-level clause shapes rather than a bag of marker and command tokens: index/current-status/invariant reading, no-query generic work discovery, selected-work context, topic search/context, and non-current authority labelling must all be present, and common explicit directive negations make the matching clause absent. This is a deterministic syntax contract, not a general semantic interpreter. `scripts/wiki/cli.ts` is the thin executable registry: it creates the repository view, preserves help and malformed-page ordering, dispatches a named handler, and centralizes usage versus unexpected errors. The unchanged path exposes no-query `wiki:work`, selected `wiki:context -- --work` plus exact-revision `--artifact`/`--reuse` handoffs, pre-PR `wiki:review-preflight`, lower-level `wiki:review-bundle` / `wiki:review-check`, and `wiki:doctor` with stable machine-readable findings. Preflight returns `not-required`, `review-required`, `needs-reconcile`, or `pass`, prepares the exact bundle before a PR exists, and validates a separate review context's report without treating the still-pending PR-body mirror as evidence.

The publishing repository treats the wiki engine as one recursive boundary. The
current architecture declaration and `.wiki/coverage.json` include
`scripts/wiki/**/*.ts`, so maintained TypeScript implementation and test files
at any depth expand into the generated source map and must map to this page or a
reasoned exclusion. `.wiki/config.json` uses the broader recursive
`scripts/wiki/**` boundary for high-risk staleness and Fresh-context selection,
so adding another engine file type cannot silently evade those risk rails.
Changing a mapped nested source without updating or explicitly verifying this
page therefore fails enforced impact even when structural lint remains green.

Portable regression ownership follows the same domain seams instead of three
all-purpose suites. Fresh-context tests are separated into focused manifest and
requirement selection, report and disposition adjudication, exact-HEAD
preflight/check, GitHub attestation, and integration-seam suites. Wiki engine
tests separately own page schema and links, generated data, verification and
coverage, impact and conflicts, and repository hooks; selected-work and generic
topic-context CLI regressions are also separate. Shared repository builders,
Git/process runners, page factories, and review/report factories live only
under `scripts/wiki/test-fixtures/`; production modules never import that
directory. The recursive test runner discovers every shipped `*.test.ts`
exactly once in deterministic order, while fixture modules are shipped through
the same Kit manifest without being test entrypoints themselves.

Work records remain next to proposal rationale. `validateWorkItems` validates their repository-wide graph, including the optional `agent | human | either` executor whose omission normalizes to `agent`, and `buildWorkQueue` derives the execution view from validated records. Executor is independent from state. Stored `not-started` becomes `ready` only when every dependency is done and `waiting` otherwise; filtering never removes nodes before that calculation. Recommendation considers only `agent` or `either`, then prefers active over ready, `critical → high → normal → low`, and ID. The default/all projection keeps human work visible, while agent and human executor filters respectively show agent/either and human/either without making human-exclusive work recommendable. The generated `wiki/work-queue.md` and JSON/text CLI views are deterministic projections; proposal frontmatter remains the SSOT. Selected human context carries explicit reporting and handoff guidance without assumed credentials or authority. The generated queue carries inert archived/derived compatibility frontmatter so a trusted merge-base engine that does not yet recognize its generated path can parse the introducing PR without treating the queue as current authority.

`buildSelectedWorkContext` and `buildTopicContext` produce exhaustive provider-neutral semantic models, while deterministic projection helpers derive the default compact text/JSON representation from the same data. Each selected current page, relevant open conflict, and non-current rationale page retains kind, status, authority, Wiki path, owners, summary, exact source declarations, glob declarations with path-sorted matches, the complete expanded source-file set, page-local open-conflict IDs, a stable body digest, and a focused full-context command. Compact output omits complete bodies and the repeated aggregate source list; `--full` preserves the prior exhaustive body-complete representation. Their authoritative read order remains stable: all returned current invariants by ID, relevant conflicts by severity and ID, other returned current pages by ID, then the deduplicated expanded authority-source files by path.

Selected-work context adds all current invariants and keeps its owning proposal separate as `ownerPage`, rendered only after the authoritative source order under `NON-CURRENT WORK OWNER`. Generic topic context consumes the unchanged shared query matcher, closes the set of open conflicts relevant to returned current pages, and exposes current pages in `pages`, open resolution contracts in `conflicts`, and directly matched proposed, deprecated, archived, or resolved-conflict pages in `nonCurrentPages`. Text renders that last group only after `SOURCE READ ORDER` under status-specific `NON-CURRENT RATIONALE` headings. Non-current pages retain their own complete source fields in `sources`, but do not enter the authoritative read order. Conflict- and impact-based context keep their existing deterministic path.

For one selected work item at a clean committed HEAD, the same semantic model can emit a reusable machine-readable handoff. The artifact deliberately omits page and source bodies and binds the work selector and acceptance, canonical prospective PR metadata, base ref and SHA, merge-base SHA, HEAD SHA, controlling page digests, open-conflict digests, expanded current-authority and work-owner source digests, the full selected-context digest, and a handoff read order. That order preserves the selected context's invariant → conflict → current-page sequence and appends the deduplicated owner-declared sources without promoting the proposed owner page to current authority. Validation recomputes all bindings and treats reuse as all-or-nothing: a selector, metadata, base, merge-base, HEAD, page, conflict, source, context, read-order, or artifact-digest mismatch rejects the handoff. The artifact removes repeated broad discovery and context serialization between authoring and implementation roles at the same revision; it is not authority and never substitutes for opening the listed current pages and implementation sources.

Topic-query matching is one provider-neutral core operation shared by `wiki:search` and generic query-based `wiki:context`. It searches page ID, summary, tags, and body with lowercase whitespace-delimited query terms and literal substring checks; terms do not require token boundaries. When at least one page matches every term, only complete matches are selected and their source-complete semantic context is projected compactly by default. When no complete match exists, partial matches remain ordered by descending matched-term count and then page ID, but the default path builds candidate metadata directly from search results and frontmatter before any source glob or body context expansion; exact `--page <ID> --full` or `--conflict` commands open the selected layer, and `--full` retains exhaustive compatibility. The focused PV-05 regression materializes the immutable feature-change fixture and reproduces its legacy any-term result exactly: the irrelevant `features/orders` page, whose body carries the multi-area task, matches the feature query on `for`, `while`, `the`, and `and`. The complete-match preference retains both required authorities, `features/checkout` and `product/money-invariants`, while removing that partial noise. The candidate projection adds no stop-word filter, current-status ranking, field weighting, source-path search, or provider-dependent behavior that could hide a controlling page or conflict.

The review manifest binds the repository-relative base ref, exact merge-base and HEAD SHAs, canonical semantic PR metadata/impact/diff digests, affected page/invariant/conflict IDs, and sorted bundle file hashes. A focused sub-manifest stores each Wiki or conflict body once under its content digest and lets non-exclusive roles such as affected page, invariant, conflict, or removed page reference that object; a page that is both affected authority and an invariant therefore has one body and two roles. Source entries separately identify changed sources, directly affected authority sources, relevant tests, and supporting sources while retaining declaring-page and exact/glob-expansion provenance plus HEAD/merge-base content digests. The deterministic validator rejects a missing role, required input, object, or digest binding, so a broad declaration cannot obtain a smaller bundle by hiding a changed primary source or relevant test. Timestamp, output directory, JSON key order, and OS temporary paths never enter the digest.

Version 2 findings are adjudicated, not merely shape-checked. A fixed table decides which dispositions retire which classification, so `candidate_regression` and `declared_contract_violation` accept only `fixed` or `unresolved`, `decision_ambiguity` accepts `fixed`, `unresolved`, or a conflict disposition but never a dismissal or follow-up, and `recorded` is confined to a `suggestion`. A disposition naming a conflict is resolved against the open conflicts at the reviewed HEAD and must match on the conflict type its classification implies where one is implied, on `origin: baseline` for a classification asserting the problem predates the candidate, and on at least one page shared with the finding's `page:` scope refs — a finding naming no page cannot be tracked by a conflict at all, since every conflict declares an affected page. `unrelated_defect` implies no conflict type, and `decision_ambiguity` is exempt from the `origin` rule because a change may legitimately raise a new question about its own behaviour.

Because `origin` is authored and `classification` is reviewed independently, the `origin` rule stops a finding from being filed as pre-existing while the conflict it names admits the change introduced it. It does not audit `origin` against the diff, so a conflict mislabelled `baseline` still passes it; what blocks a candidate-caused break is the table, which admits no deferring disposition at all once the reviewer classifies it as one. The table applies whether or not a conflict list is supplied; only conflict-pointer resolution requires one, and `reviewCheck` always supplies it, so an empty repository conflict set makes every pointer dangling.

Ready CI validates with the merge-base engine and policy, so the bundle a candidate is measured against is the one the *base* engine emits. Bundle content is therefore version-bound rather than frozen: a change to the prompt, report contract, or impact JSON shape governs the PRs that follow it, and the PR introducing that change must generate its own bundle with the base engine (`bun <base-checkout>/scripts/wiki/cli.ts review-preflight --root <candidate>`) so the digest CI recomputes matches. Report validation accepts version 1 and version 2, so a report prepared before an engine upgrade is never invalidated by the upgrade itself.

The engine is provider- and framework-agnostic. Three adapters stay outside its trust-neutral contract:

- `.wiki/config.json` — display name, `highRisk` globs, the opt-in `publishesKit` flag, and explicit Fresh-context mode/evidence/reviewer trust policy. Optional `requiredWhen` keeps legacy all-PR behavior when omitted or selects trusted changed-file, invariant, conflict, and current-page-removal risk signals. Affected invariants are preserved from both the merge base and HEAD, so changing an invariant's kind cannot remove the risk signal.
- `scripts/wiki/inventories.ts` — an adapter that emits deterministic `wiki/_generated/**` pages from code; it returns `{}` by default. `scripts/wiki/inventories.example.ts` is a reference implementation over API routes, shared contracts, database tables, and app routes; it ships as a kit `reference` file, so an adopting repository reads it from the kit checkout rather than receiving a copy.
- `scripts/wiki/github-attestation.ts` — the GitHub reference adapter that selects the newest marked report from authenticated PR review/comment envelopes, preserves malformed newest reports for fail-closed core validation, passes the actor identity to the core validator, and checks GitHub-specific PR-template/workflow seams.

`kit-packaging.test.ts` covers entries, exclusions, rendering, manifests, drift, and writes; `kit.test.ts` covers integration and sync. The other synthetic or Git-backed suites cover work/context, review/impact/trust, CLI behavior, and new/adopt/upgrade flows including dry-run, idempotence, managed/package ownership, version 1 migration, customization safety, and the final `ready` loop. `test-runner.ts` runs each shipped Wiki test in an isolated bounded-parallel Bun process so adoption and historical fixtures do not share accumulated memory. Older adoption fixtures remain reproducibility evidence. The suites require only `bun`, `typescript`, `yaml`, and `git`.

Publishing-only measurement runners stay outside `KIT_ENTRIES`. The versioned
Primary scenario contract and its pinned baseline/current evaluators measure
authority, sources, conflicts, coverage, context size, command order, and drift
without an LLM; exact revisions, reports, and tests bind those results
byte-for-byte and isolate them from ambient PR metadata.

The TE-00, TE-04, and TE-06 runners likewise use disposable exact-revision
fixtures. They distinguish deterministic bundle bytes and source breadth from
external model calls or provider timing, which remain unavailable unless a
controlled pilot records them. Compact results are digest-bound to retained
full evidence, and exit validation reruns the Primary, kit, adoption,
selected-work, and focused-review correctness floors.

`kit-modularity-baseline.ts` pins the pre-motion revision and records compiler
edges, public exports, CLI fixtures, generated paths, suite ownership,
`KIT_ENTRIES`, lifecycle behavior, and the manifest digest. Its byte-stable
evidence is the compatibility reference for the KM split, not adopter runtime.

## Kit distribution

`KIT_ENTRIES` names every shipped file and its placement. `files` are replaced on upgrade, `managed` owns one marked host block, `seed` writes only when absent, and `reference` is read from the kit checkout without installation. Manifest version 2 binds file, managed-block, and reference hashes without timestamps; the installed manifest also records inspected host integrations. `wiki:kit --check` detects drift and orphans, while `kit/README.md` remains hand-written.

`kit:exclude` removes only publisher-specific guidance; downstream rules such as base-engine review and the required agent markers remain. Unbalanced markers fail generation. Publishing behavior is opt-in through `publishesKit`, so an adopter's ordinary `kit/` directory receives no exemption or overwrite rule; the publisher still link-checks its hand-written README and uses the orphan scan to reject hidden additions.

Standalone `kit-sync.ts` performs three-way file classification; `apply.ts` detects `new`, `adopt`, or `upgrade`, applies files and managed blocks, merges only toolkit-owned scripts and compatible dependencies, installs hooks, regenerates, and runs installed checks. Dry-run never writes or returns `ready`; missing source-backed current pages or coverage remains `needs-reconcile`. Apply invokes no model and changes no Git publication state.

Managed blocks preserve bytes outside one valid marker pair and fail closed on malformed or duplicate pairs. Only byte-known version-1 integrations migrate automatically; customized workflows require an explicit merge while host jobs survive. Sync classifies `create`, `unchanged`, `update`, `customized`, or `conflict`, refuses malformed manifests, symlink targets, escaping paths, and symlinked ancestors, and never writes through the manifest link. Per-file manifest advancement prevents one conflict from freezing later updates; `--accept` records an explicit hand merge without rewriting it, and removed upstream files are reported once rather than deleted.
