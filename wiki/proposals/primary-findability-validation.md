---
id: proposal/primary-findability-validation
summary: Validate and improve wiki-ssot's primary promise that a fresh coding-agent session can discover the controlling current wiki, constraints, conflicts, and implementation sources before editing.
kind: proposal
status: proposed
authority: normative
owners: ["@phlox11"]
sources:
  - path: README.md
  - path: docs/design.md
  - path: AGENTS.md
  - path: .wiki/config.json
  - path: .wiki/coverage.json
  - path: scripts/wiki/cli.ts
  - path: docs/adopt-existing-repo.md
  - path: docs/adopt-new-repo.md
related: [product/scope, product/invariants, architecture/engine, operations/enforcement, proposal/protected-main]
tags: [roadmap, primary, findability, fresh-session, context, adoption, dogfood]
---

# Primary findability validation roadmap

This page is the durable tracker for validating wiki-ssot's primary product promise. It is proposed work, not a statement of current behavior. The current contract remains in [product/scope](../product/scope.md), [product/invariants](../product/invariants.md), [architecture/engine](../architecture/engine.md), and [operations/enforcement](../operations/enforcement.md).

## Product question

Can a coding agent starting with no repository memory reliably discover:

1. what work remains without already knowing a wiki node, proposal ID, or task ID;
2. the current intent and constraints that control a selected task;
3. the relevant open conflicts and unresolved decisions;
4. the implementation sources it must inspect;
5. the wiki pages it must update or explicitly verify after changing code;
6. the gates it must satisfy before publication?

The goal is not to prove that a model read or understood text. A command receipt cannot prove cognition. The product can instead make the correct context complete, authoritative, easy to discover, and difficult to confuse with proposals or historical material.

The target re-entry request is deliberately ordinary: a user starting a new session should be able to ask "what work remains?" without naming this proposal or any internal ID. The agent entrypoint must map that intent to one repository-wide work-discovery command.

## Strategy

- Treat the existing Secondary enforcement path as mature enough to freeze for feature work. Fix security or contract-integrity defects, but do not expand review machinery without a reproduced failure.
- Close known trust-boundary gaps before relying on the system as validation evidence.
- Make outstanding work repository-wide and machine-discoverable before relying on a human-readable roadmap table.
- Measure the current Primary path before changing search or context behavior.
- Improve `wiki:context`, search, coverage/bootstrap, and the session entrypoint only where the baseline exposes a failure.
- Validate both deterministic context completeness and real fresh-session adoption flows.
- Resume Secondary feature work only after the Primary exit gate is met or an owner explicitly changes this priority.

## Status vocabulary

| Status | Meaning |
|---|---|
| `not-started` | No candidate work has begun. |
| `ready` | Inputs and owner decisions are sufficient to begin. |
| `active` | A candidate is being implemented or validated. |
| `blocked` | A named decision, capability, or external setting is required. |
| `done` | Acceptance criteria are satisfied and evidence is linked. |
| `deferred` | Deliberately outside the current critical path, with a reason. |

Update the tracker in the same PR that changes a work item's state. A `done` item must name durable evidence: a PR/commit, a test or fixture path, a report path, or verified repository settings. Do not mark an item done from a chat summary.

## Master tracker

| ID | Work item | Status | Depends on | Durable evidence required |
|---|---|---|---|---|
| `PV-00` | Put the roadmap and backlog in the repository wiki | `done` | — | This proposal page |
| `PV-01` | Protect the editable `checks.yml` workflow bootstrap seam | `blocked` | Owner selects an available GitHub protection mechanism | Verified ruleset/workflow protection or CODEOWNERS plus required owner review |
| `PV-02` | Make the product-scope contract review-triggering | `ready` | — | Config/test change covering `wiki/product/scope.md`, `README.md`, and `docs/design.md` |
| `PV-03` | Provide zero-knowledge, repository-wide work discovery | `ready` | `PV-00` | Machine-readable work schema, validated aggregate queue, and a no-query command |
| `PV-04` | Define deterministic Primary scenarios, expected context, and metrics | `not-started` | `PV-03` | Versioned fixture/scenario files and a reproducible runner or test contract |
| `PV-05` | Capture the unmodified Primary baseline | `not-started` | `PV-04` | Machine-readable baseline plus a short interpretation |
| `PV-06` | Make selected-work context authority- and source-complete | `not-started` | `PV-05` | Contract tests and updated current wiki/docs |
| `PV-07` | Improve `wiki:search` only for baseline-proven misses | `not-started` | `PV-05`; may be skipped if no search failure is found | Before/after scenario evidence and focused tests |
| `PV-08` | Validate new-repository adoption and coverage growth | `not-started` | `PV-04` | Clean fixture smoke test and recorded expected setup edits |
| `PV-09` | Validate existing-repository bootstrap and coverage closure | `not-started` | `PV-04` | Existing-code fixture smoke test with zero unexplained unmapped sources |
| `PV-10` | Strengthen the agent-entrypoint integration contract | `not-started` | `PV-03`, `PV-05` | Doctor tests proving generic re-entry and context guidance cannot become inert |
| `PV-11` | Run fresh-session agent pilots over both adoption paths | `not-started` | `PV-06`, `PV-08`, `PV-09`, `PV-10`; `PV-07` if applicable | Versioned task inputs, expected authorities/sources, and observed results |
| `PV-12` | Evaluate the Primary exit gate and decide the next investment | `not-started` | `PV-11` | Owner decision recorded below with supporting evidence |
| `PV-13` | Define and validate a meaningful `followup_ref` contract | `deferred` | Primary exit gate or reproduced disposition escape | Accepted reference syntax, resolution policy, and adversarial tests |
| `PV-14` | Decide whether a reviewer claim-audit artifact is needed | `deferred` | Reproduced false-claim incident or Primary exit gate | Concrete incident and selected artifact contract |
| `PV-15` | Reconsider source-map/bootstrap review breadth | `deferred` | Baseline evidence of harmful over-bundling | Scenario showing the current source-to-page rule causes a measurable failure |

## Phase A — close known boundaries

### `PV-01`: protect the workflow definition

The current branch protection requires the stable checks, but a pull request can still edit `.github/workflows/checks.yml`, keep a required job name, and replace its validation steps. The tracked-file design and required remote state are already specified in [proposal/protected-main](./protected-main.md); this roadmap does not duplicate that contract.

Acceptance:

- An active repository setting protects `.github/workflows/checks.yml` through a ruleset-required workflow, or CODEOWNERS plus required owner review.
- Strict required checks still include `code-check`, `wiki-structure`, `wiki-generated`, `wiki-impact`, `wiki-review-attestation`, and `wiki-kit`.
- Administrators cannot bypass the chosen protection unintentionally.
- Force pushes and branch deletion remain blocked.
- The resulting remote state is re-read after the change and recorded as evidence.

Decision gate:

- Owner selects the protection mechanism available for this repository and account plan.

### `PV-02`: protect the scope contract from unreviewed semantic movement

The risk selector currently protects enforcement and invariant files but does not select the product-scope page or either of its declared primary sources.

Acceptance:

- Changes to `wiki/product/scope.md`, `README.md`, or `docs/design.md` require Fresh-context reconciliation.
- A regression test proves all three paths are selected.
- The publishing repository and downstream kit policy remain intentionally distinct; instance-only paths must not leak into adopter policy without an explicit product decision.

## Phase B — make work discoverable and establish a Primary baseline

### `PV-03`: zero-knowledge work discovery

The current proposal table is a transitional human-readable tracker. It does not satisfy the product goal by itself: a new session has no reason to know this page exists, and the engine does not parse its rows, dependencies, states, or evidence.

The required user experience is:

1. the user asks a generic question such as "what work remains?", "what is unfinished?", or "what should we do next?";
2. the agent entrypoint directs all such requests to one standard repository command without requiring search terms;
3. the command scans the whole repository's structured work records and open conflicts;
4. it reports what is ready, active, blocked, and deferred, with explicit dependencies and evidence;
5. the user can select an item by the returned ID, after which a standard context command returns its controlling current pages, invariants, conflicts, proposal detail, acceptance criteria, and sources.

Acceptance:

- A no-query command such as `wiki:work` lists repository-wide outstanding work; the final command name is part of this item's implementation decision.
- The queue is derived from machine-readable repository records rather than Markdown table parsing or chat memory.
- Open conflicts are included or linked as first-class decision work.
- Default output separates `ready`, `active`, `blocked`, and `deferred`; completed work is hidden unless requested.
- A blocked item names its blocker or required owner decision.
- A done item requires non-empty durable evidence.
- The schema rejects duplicate IDs, unknown dependencies, dependency cycles, illegal states, done-without-evidence, and blocked-without-a-blocker.
- Ordering is deterministic and follows explicit priority and dependency data rather than agent preference.
- Every result names its owning wiki node and provides the next context command.
- A generated work-queue entrypoint is linked from the wiki entrypoint so humans can inspect the same state without running the CLI.
- `AGENTS.md` tells an agent receiving a generic remaining-work request to run this command before searching by topic.
- Tests begin from a fresh session prompt that contains no proposal ID, work ID, or task-specific search term.

The work-record representation may be structured fields on proposal/task pages or a dedicated repository-owned work-item format. Whichever representation is selected must keep detailed rationale close to its wiki node while giving the engine a stable schema. GitHub issues may be linked as evidence or execution channels, but the repository queue must remain usable without a live provider API.

### `PV-04`: deterministic scenario contract

Create versioned scenarios for at least:

1. a feature behavior change;
2. a semantics-preserving refactor;
3. a change controlled by an invariant;
4. a code/wiki disagreement requiring a conflict;
5. a task touching an existing open conflict;
6. a task spanning more than one code area;
7. a query matching both current and proposed pages;
8. a changed implementation file near the edge of configured coverage.

Each scenario declares:

- the natural-language task;
- controlling current page IDs;
- controlling invariant IDs;
- relevant conflict IDs;
- implementation sources that must be surfaced;
- non-current pages that may be useful but must be labelled;
- files expected to change;
- expected wiki action.

The scenario contract must be usable without an LLM so deterministic context output can be tested separately from agent behavior.

### `PV-05`: baseline report

Run the scenarios against the unmodified engine and record:

- current-page recall;
- invariant recall;
- conflict recall;
- implementation-source recall;
- non-current authority labelling;
- irrelevant-page count;
- unmapped changed files;
- context size and command sequence;
- any code/wiki drift that the gates fail to catch.

Time and token cost are observations during the baseline, not preselected pass/fail thresholds.

Known hypotheses to test rather than assume:

- keyword `wiki:context` can return a proposal without clearly separating its non-current status;
- text context names the wiki page path but not the page's declared implementation `sources`;
- simple substring search may over-return loosely related pages;
- coverage and adoption defaults may produce different first-run behavior between new and existing repositories.

## Phase C — improve selected-work context

### `PV-06`: authoritative context output

Default context output should make the truth model visible without requiring the caller to remember hidden conventions.

Acceptance:

- Current pages are the authoritative default result set.
- Proposed, deprecated, and archived pages are omitted or placed in a clearly labelled non-current section.
- Each returned page exposes `status`, `authority`, wiki path, declared exact sources, declared globs, and relevant open conflicts.
- Glob expansion is available deterministically when the caller needs concrete source files.
- Output communicates a stable read order: invariants and conflicts, current page, then implementation sources.
- Text and JSON outputs express the same semantic fields.
- Existing impact-based context behavior remains deterministic.

### `PV-07`: evidence-driven search changes

Do not add ranking machinery merely because the implementation is simple. Select changes only from baseline misses.

Candidate remedies include:

- current-first ranking;
- separate current and non-current result groups;
- weighting IDs, tags, summaries, and source paths differently;
- distinguishing all-term from partial-term matches;
- searching declared source paths;
- linking a search result directly to a focused context command.

Every selected remedy requires a failing scenario before the change and a passing one after it.

### `PV-10`: session entrypoint integrity

The integration doctor currently must not treat the marker alone as sufficient evidence that an agent can find the wiki workflow.

Acceptance:

- The installed entrypoint points to `wiki/index.md` and `wiki/current-status.md`.
- A generic question about remaining or next work routes to the repository-wide work queue without requiring a known node or search term.
- It directs the agent to current invariant pages and `wiki:search` / `wiki:context`.
- It preserves the rule that proposed or archived pages are not current behavior.
- Marker-only, placeholder, or command-name-only entrypoints fail a test.
- The contract remains provider-neutral; host-specific bridge files may point at it without moving model behavior into core.

This work improves discoverability. It does not claim proof that the agent cognitively read the returned material.

## Phase D — validate adoption

### `PV-08`: new repository

Validate the documented empty-repository path from kit sync through the first feature.

Acceptance:

- The exact initial state of `.wiki/coverage.json` is intentional and consistent with the playbook.
- The point at which an empty repository is expected to become green is explicit.
- The first feature adds code, a current page, source mapping, coverage, verification, and tests in one candidate.
- Generated files, lint, doctor, impact, typecheck, tests, and applicable review preflight pass.

### `PV-09`: existing repository

Validate bootstrap over a repository that already contains multiple code areas and at least one ambiguous intent.

Acceptance:

- Every file selected by coverage maps to a current page or a reasoned exclusion.
- Confirmed current behavior is compiled from primary sources rather than copied from old prose.
- The ambiguous behavior becomes a conflict instead of an invented current statement.
- The initial review can disposition pre-existing mismatches without forcing the entire repository into the bootstrap PR.
- A later kit upgrade preserves adopter-owned policy, state, inventories, and local customizations.

### `PV-11`: fresh-session agent pilots

Run isolated sessions against the versioned scenarios. Preserve:

- the exact task prompt;
- repository and base commit;
- context/search commands used;
- pages, conflicts, and sources surfaced;
- files inspected and changed;
- missed authority or unnecessary context;
- deterministic gate result.

The pilot measures whether the provided path is usable. It does not turn subjective reviewer quality into a deterministic claim.

## Primary exit gate

`PV-12` may pass only when:

- a fresh session can enumerate remaining work from a generic request without knowing any internal node or ID;
- the queue correctly distinguishes ready, active, blocked, deferred, and evidenced done work;
- every scenario surfaces all controlling current pages;
- every scenario surfaces all controlling invariants and relevant open conflicts;
- every context result exposes the required implementation sources;
- no non-current page is presented as current authority;
- every changed file inside configured coverage maps to a current page or a reasoned exclusion;
- no scenario demonstrates a code/wiki drift escape through the deterministic gates;
- both adoption paths run from their documented starting state to green reproducibly;
- remaining misses are classified as a concrete defect, an owner decision, or an explicitly accepted limitation.

The owner then records one outcome:

1. **Primary validated:** resume balanced product work.
2. **Primary needs another focused cycle:** name the failed criteria and next bounded changes.
3. **Product priority changed:** update the current product scope and rationale in the same PR.

## Secondary backlog disposition

### `PV-13`: `followup_ref`

The current validator requires a non-empty value but does not define whether a meaningful reference is a GitHub issue URL, repository path, provider-neutral identifier, or something else. A length check alone would make prose longer without proving that the target exists.

Before implementation, decide:

- accepted reference syntax;
- whether existence is checked;
- which layer owns provider-specific resolution;
- how an offline/provider-neutral deployment behaves.

### `PV-14`: reviewer claim audit

Do not choose among a CLI artifact, agent-process step, or lint heuristic without a reproduced claim failure and a statement of which claim must become checkable. The engine explicitly leaves honest classification to reviewer judgement; this item must not silently claim to solve that boundary.

### `PV-15`: bootstrap review breadth

`buildSourceMap` intentionally makes a current page's declared sources affect that page. Changing the rule is a truth-model redesign, not a small optimization. Revisit only if a Primary baseline shows that valid source tracing creates harmful, non-actionable context or review scope.

### Multi-lens review

Parallel review lenses remain an orchestrator technique outside the core contract unless evidence shows that one context-isolated reviewer cannot satisfy a product invariant. No repository work item is open for this by default.

## Execution order

The intended critical path is:

1. `PV-01` and `PV-02` close boundary gaps.
2. `PV-03` makes remaining work discoverable without prior node knowledge.
3. `PV-04` defines scenarios and expected authorities.
4. `PV-05` records the baseline before behavior changes.
5. `PV-06` fixes selected-work context completeness.
6. `PV-07` runs only if the baseline proves search failures.
7. `PV-08`, `PV-09`, and `PV-10` make adoption and entrypoint behavior reproducible.
8. `PV-11` runs isolated agent pilots.
9. `PV-12` records the owner decision at the Primary exit gate.
10. `PV-13`–`PV-15` are reconsidered from evidence rather than momentum.

`PV-03` and read-only baseline preparation may proceed while the external setting decision for `PV-01` is pending, but no final Primary validation should claim a complete merge boundary until `PV-01` is done.

## Decision log

Record decisions here when they concern proposed sequencing or evaluation. If a missing decision makes current behavior ambiguous, open a conflict instead.

| Decision | State | Result or required owner input |
|---|---|---|
| Prioritize Primary validation over new Secondary review features | proposed | Approve this roadmap or revise its priority |
| Zero-knowledge re-entry | decided | A user may ask only what work remains; no proposal ID, task ID, or search term is required |
| Workflow protection mechanism | pending | Select ruleset-required workflow or CODEOWNERS/required owner review |
| Pilot repositories/fixtures | pending | Select at least one new-repository and one existing-repository target |
| Search work after baseline | pending | Execute only for reproduced misses |
| Resume Secondary feature investment | pending | Decide at `PV-12` from exit-gate evidence |

## Per-PR update protocol

Each implementing PR must:

1. name the `PV-NN` item in its metadata and description;
2. change only one coherent work item unless the tracker declares them inseparable;
3. add the failing scenario or evidence before the fix where practical;
4. update current wiki pages when behavior changes;
5. update this tracker status and durable-evidence cell;
6. regenerate deterministic artifacts and pass the repository's full preflight;
7. leave undecidable current intent in a conflict rather than marking the item done.
