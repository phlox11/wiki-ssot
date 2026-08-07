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

`core.ts` stays the compatibility facade and owns reusable handoffs plus cross-domain lint, audit, generated-file, and Markdown-link orchestration. It re-exports the verification, impact, bundle, and attestation APIs by identity while the unchanged CLI still imports it, preserving command, text, JSON, stdout/stderr, and usage contracts until the bounded-handler stage. Impact never imports either review module; attestation may consume impact and bundle construction; kit packaging retains its minimal model, repository-view, and serialization dependencies. `kit-sync.ts` remains standalone for pre-install use.

The agent-entrypoint seam requires affirmative line-level clause shapes rather than a bag of marker and command tokens: index/current-status/invariant reading, no-query generic work discovery, selected-work context, topic search/context, and non-current authority labelling must all be present, and common explicit directive negations make the matching clause absent. This is a deterministic syntax contract, not a general semantic interpreter. `scripts/wiki/cli.ts` is a thin command layer exposing no-query `wiki:work`, selected `wiki:context -- --work` plus exact-revision `--artifact`/`--reuse` handoffs, pre-PR `wiki:review-preflight`, lower-level `wiki:review-bundle` / `wiki:review-check`, and `wiki:doctor` with stable machine-readable findings. Preflight returns `not-required`, `review-required`, `needs-reconcile`, or `pass`, prepares the exact bundle before a PR exists, and validates a separate review context's report without treating the still-pending PR-body mirror as evidence.

The publishing repository treats the wiki engine as one recursive boundary. The
current architecture declaration and `.wiki/coverage.json` include
`scripts/wiki/**/*.ts`, so maintained TypeScript implementation and test files
at any depth expand into the generated source map and must map to this page or a
reasoned exclusion. `.wiki/config.json` uses the broader recursive
`scripts/wiki/**` boundary for high-risk staleness and Fresh-context selection,
so adding another engine file type cannot silently evade those risk rails.
Changing a mapped nested source without updating or explicitly verifying this
page therefore fails enforced impact even when structural lint remains green.

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

`scripts/wiki/primary-scenarios.ts` is the repository-specific, versioned Primary-validation contract. Its eight synthetic scenarios declare tasks, required authorities and sources, relevant conflicts, expected changes, and wiki actions. A deterministic evaluator turns collected observations into recall, authority-labelling, irrelevant-context, coverage, context-size, command-sequence, and drift-escape metrics without invoking an LLM; `scripts/wiki/primary-scenarios.test.ts` locks category coverage, incomplete observations, and byte-stable results. `scripts/wiki/primary-baseline.ts` materializes those scenarios in a temporary git fixture, executes the unmodified default search/context path plus lint/impact drift probes, and reproduces the checked-in PV-05 JSON report and interpretation against immutable engine revision `58869b75dc23374b918a79d9731c601764018ead`. When the working engine no longer matches that revision, the runner clones the repository locally, detaches the clone at the pinned revision, reuses the installed dependency tree, and delegates measurement to that historical engine; current engine changes therefore cannot rewrite the evidence. That revision includes PV-08's kit-only adoption defaults; the measured Primary discovery and drift results remain unchanged. The runner removes ambient `GITHUB_EVENT_NAME` and `WIKI_PR_BODY` from fixture commands so GitHub Actions pull-request context cannot contaminate the synthetic measurements; its tests bind the evidence byte-for-byte, repeat the check under injected PR event metadata, and advance `origin/main` in an isolated clone to prove the historical evidence remains current after merge. These files intentionally stay outside `KIT_ENTRIES`: they validate this publishing repository's roadmap and are not part of the downstream toolkit.

`scripts/wiki/primary-current.ts` re-evaluates the same eight-scenario contract
against exact combined post-PV-16/PV-17/PV-18 revision
`8b93a6f6e8026963b5cdd49cbb7a8b737e71b9ec`. Its synthetic fixture uses the
recursive `scripts/wiki` coverage, source-mapping, and risk boundary, observes
generic topic context through the shared JSON model, materializes every
declared candidate, and probes every implementation/test source independently
for code-only drift. The checked-in PV-19 JSON report records per-scenario
authority, status, source, conflict, non-current separation, wiki action,
coverage disposition, reconciled candidate gates, and drift-gate results;
`scripts/wiki/primary-current.test.ts` binds it and its interpretation
byte-for-byte to the evaluated revision. The coverage-edge implementation and
test paths are each required to map to `architecture/engine` and fail enforced
impact with stale verification when changed without reconciliation. Like the
PV-05 measurement files, the PV-19 runner and report validate this publishing
repository and stay outside `KIT_ENTRIES`.

`scripts/wiki/token-efficiency-baseline.ts` is the publishing-only TE-00
measurement harness. It detaches disposable local clones at exact
pre-optimization revision
`6fd3a85414e00892930557cb8335e2d88ec90d66`, reproduces focused and broad
topic context, selected-work context, recursive TypeScript source expansion,
and a fixed local review candidate, then removes every disposable checkout.
The harness makes no model or provider call. Separate sanitized inputs retain
the external schooled diagnosis and the successful controlled publisher
rollout; strict accounting checks keep cached input inside raw input, reasoning
inside output, and unavailable latency or phase observations explicit rather
than coercing them to zero. Its tests bind the revision, deterministic review
candidate, source breadth, privacy exclusions, accounting, and byte-stable
JSON/Markdown evidence. Like the Primary evaluation runners, these files and
their evidence describe this publishing repository and remain outside
`KIT_ENTRIES`.

`scripts/wiki/te04-focused-review.ts` replays the fixed TE-00 review candidate
with the current focused-manifest engine in disposable local checkouts. It
records bundle and non-diff bytes, role-classified reviewer-source breadth,
exact attestation validation, and explicit deterministic versus externally
observed reviewer-call/time fields without invoking a model or provider.

`scripts/wiki/te06-controlled-comparison.ts` is the publishing-only fixed-task
comparison runner for the token-efficiency roadmap. It binds one exact combined
revision and the same TE-00 five-surface task, including the byte-identical
review-candidate recipe. Its default output is a compact projection bound to a
retained full record by content digest. `scripts/wiki/te06-exit-validation.ts`
is the separate publishing-only correctness harness: it validates those fixed
comparison records and requires the sanitized controlled-publisher observation
to retain the same canonical task identity and digest, then reruns the Primary,
kit, adoption, selected-work, and focused-review floors.
Successful suite diagnostics contain bounded counts and result digests instead
of test bodies. Both harnesses, their tests, and TE-06 evidence remain outside
`KIT_ENTRIES`; adopters receive the portable engine and regression behavior,
not this publisher repository's performance pilot or owner decision.

`scripts/wiki/kit-modularity-baseline.ts` is the publishing-only KM-00
compatibility and module-inventory harness. It detaches a disposable local clone
at the exact pre-motion revision, loads that revision's kit engine and inventory
adapter, and uses the TypeScript compiler API to bind kit-owned bytes and lines,
exports, re-exports, type-only declarations, import and caller edges, public CLI
commands and representative output fixtures, generated paths, regression-suite
boundaries, `KIT_ENTRIES`, lifecycle semantics, and the manifest-v2 digest. Its
test locks the checked JSON and Markdown evidence and stale-output behavior. The
harness makes no model or provider call, moves no production module, and remains
outside `KIT_ENTRIES`; it is publishing evidence used to judge the later
semantic-preserving KM split rather than adopter runtime.

## Kit distribution

The engine also emits its own copy-paste distribution. `KIT_ENTRIES` in `scripts/wiki/kit-packaging.ts` names every shipped file, production method, and placement; `core.ts` only preserves its compatibility re-export. `wiki:kit` writes `kit/**`, while `wiki:kit --check` detects drift and orphaned generated paths without silently deleting them. `kit/README.md` is hand-written and outside generator ownership.

Placement decides what happens downstream. `kit/files/**` is kit-owned and replaced on upgrade; `kit/managed/**` owns only one explicitly marked block inside a host integration file; `kit/seed/**` is written only when absent and never updated, so adopter policy, recorded source hashes, a project-specific inventory implementation, `.gitignore`, and an existing `tsconfig.json` survive; and a `reference` file such as `kit/package.kit.json` is read from the kit checkout and never copied. The seeded coverage starts empty as a prompt for project configuration, but the public apply loop refuses to call `new` or `adopt` complete until maintained coverage and a source-backed current page exist. Seed is not a way to make a deletion stick: it means "written when absent", so a file an adopter merges away or deliberately deletes would return. `kit/files/.wiki/kit-manifest.json` ships version 2 with kit files, managed-block markers/hashes, reference hashes, and a content-addressed roll-up digest; the installed `.wiki/kit-manifest.json` additionally persists the project-local list of inspected host-owned integrations. Neither carries a release tag or timestamp, so the same kit sources always produce the same kit manifest.

`kit:exclude` regions keep out of the payload only what an adopting repository cannot use — links to pages that exist only here and publishing-only `wiki:kit` commands that have no downstream package script or `publishesKit` policy. Rules that hold downstream stay in, including generating a bundle with the base engine, since the shipped workflow performs the same merge-base checkout and the shipped policy makes `scripts/wiki/**` review-triggering. The `wiki-ssot:fresh-context-guardrail` and `wiki-ssot:work-discovery` markers the seam check requires are preserved, and an unbalanced or unclosed marker fails generation rather than truncating a file.

Every rule about `kit/` is opt-in through `publishesKit` in `.wiki/config.json`, which the seed template omits. This engine is shipped verbatim inside the distribution, so an unconditional rule would follow it: in an adopting repository `kit/` is an ordinary directory, and exempting it from implementation-source classification and the Markdown link check — or letting `wiki:kit` overwrite it — would impose this repository's layout on theirs. In the publishing repository the exemption is a `kit/` path prefix that excludes the hand-written `kit/README.md`, so that file is still link-checked; it is not a test against the generator's output, and what keeps a hand-added path under `kit/` from hiding there is the separate `wiki:kit --check` orphan scan. `wiki:kit` refuses to run at all without the flag.

`scripts/wiki/kit-sync.ts` remains the standalone three-way file primitive and imports nothing from the engine. `scripts/wiki/apply.ts` is the public orchestrator above it. From a WikiSsot checkout it targets an initialized Git repository, detects `new` from an unborn HEAD, `adopt` from existing history without markers, and `upgrade` from an installed manifest/engine/agent seam. It uses the sync primitive for full kit files, performs fail-closed managed-block replacement for shared host files, merges only `wiki:*` scripts plus compatible toolkit dependencies and Bun minimum, explicitly installs hooks, regenerates, and runs the installed Wiki checks. Dry-run writes nothing and returns `preview` only for a mechanically safe, already-bootstrapped plan; missing current-page/coverage work remains `needs-reconcile`, and dry-run never returns the fully checked `ready` status. The command does not invoke an LLM or mutate Git publication state; semantic Wiki/code findings are returned to the invoking coding agent, which reruns the same command after reconciliation.

Managed blocks have exactly one declared start/end pair. A missing pair is appended, one valid pair is replaced, and malformed or duplicate markers fail closed. Content outside the pair is byte-preserved. Version 1 full-file integrations migrate automatically only when their bytes match a recognized payload; customized legacy content requires a one-time merge. The exact version 1 combined checks workflow is split deterministically: its `code-check` remains in `.github/workflows/checks.yml`, while its Wiki jobs move to the dedicated `.github/workflows/wiki-ssot.yml`. An unknown or customized legacy workflow is never deleted; it must retain its host jobs, remove duplicate Wiki jobs, and be explicitly accepted once.

For each kit-owned file the lower-level sync compares the incoming version, the version recorded in the target's manifest, and the version on disk, yielding `create`, `unchanged`, `update`, `customized`, or `conflict`. A file that differs with no recorded manifest is a conflict because it cannot be proven pristine, and a symlinked target is always a conflict because writing through it would modify a file outside the destination while the destination's own diff showed nothing. Containment is checked twice, because a lexical path test is not enough: a target that resolves outside the destination is refused, and so is one whose deepest existing ancestor resolves outside it through a symlinked directory. Every write refuses a symlinked destination, including the manifest write, which does not pass through classification. A malformed incoming manifest is rejected rather than crashing.

Two properties make the upgrade loop terminate. The manifest advances per file — every applied file records its incoming hash and only conflicting entries keep their old one — so a single stuck conflict cannot freeze the baseline and turn every later clean update into a false conflict. And resolution is explicit: a hand-merged file matches neither the incoming nor the recorded version, so `--accept <path>` records the incoming hash without touching the file, after which it reads as an ordinary `customized`. A file an older kit shipped and a newer one drops is reported once as `removed-upstream` and never deleted.
