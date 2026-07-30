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
  - path: package.json
  - path: .wiki/config.json
  - path: .wiki/coverage.json
  - path: scripts/wiki/core.ts
  - path: scripts/wiki/cli.ts
  - path: scripts/wiki/work.test.ts
  - path: scripts/wiki/primary-scenarios.ts
  - path: scripts/wiki/primary-scenarios.test.ts
  - path: scripts/wiki/primary-baseline.ts
  - path: scripts/wiki/primary-baseline.test.ts
  - path: docs/evidence/pv-05-primary-baseline.json
  - path: docs/evidence/pv-05-primary-baseline.md
  - path: wiki/SCHEMA.md
  - path: wiki/WORKFLOW.md
  - path: docs/commands.md
  - path: docs/adopt-existing-repo.md
  - path: docs/adopt-new-repo.md
related: [product/scope, product/invariants, architecture/engine, operations/enforcement, proposal/protected-main]
tags: [roadmap, primary, findability, fresh-session, context, adoption, dogfood]
work_items:
  - id: PV-00
    title: Put the roadmap and backlog in the repository wiki
    state: done
    priority: critical
    depends_on: []
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - The Primary validation roadmap and backlog are stored in a version-controlled proposal page.
    evidence:
      - wiki/proposals/primary-findability-validation.md
  - id: PV-01
    title: Decide the editable checks.yml workflow trust boundary
    state: done
    priority: critical
    depends_on: []
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Current scope explicitly states that repository write/admin actors are trusted.
      - Organization-level required workflows, CODEOWNERS, rulesets, and administrator-bypass policy are outside the product contract.
      - Documentation discloses that an editable pull_request workflow can preserve a required job name while removing validation.
      - No current page claims security against a hostile or compromised maintainer.
    evidence:
      - wiki/product/scope.md
      - wiki/operations/enforcement.md
      - docs/design.md
  - id: PV-02
    title: Make the product-scope contract review-triggering
    state: done
    priority: critical
    depends_on: []
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Changes to wiki/product/scope.md, README.md, or docs/design.md require Fresh-context reconciliation.
      - A regression test proves all three paths are selected.
      - Publishing-repository and downstream-kit policy remain intentionally distinct.
    evidence:
      - .wiki/config.json
      - scripts/wiki/kit.test.ts
      - wiki/operations/enforcement.md
  - id: PV-03
    title: Provide zero-knowledge repository-wide work discovery
    state: done
    priority: critical
    depends_on: [PV-00]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - A no-query command lists repository-wide outstanding work.
      - The queue is derived from machine-readable repository records rather than Markdown table parsing or chat memory.
      - Open conflicts are included as first-class decision work.
      - Default output separates ready, active, waiting, blocked, and deferred work, while completed work is opt-in.
      - Blocked, deferred, and done states require their corresponding reason or durable evidence.
      - The schema rejects duplicate IDs, invalid states, invalid context pages, illegal lifecycle fields, unknown or self dependencies, and dependency cycles.
      - Ordering and recommendation are deterministic from explicit priority, dependency, and ID data.
      - Every result names its owning proposal and provides a selected-work context command.
      - A generated work queue is linked from the wiki entrypoint and current status.
      - The agent entrypoint routes generic remaining-work requests to the no-query command.
      - Tests start from prompts containing no proposal ID, work ID, or task-specific search term.
    evidence:
      - scripts/wiki/work.test.ts
      - wiki/work-queue.md
      - AGENTS.md
  - id: PV-04
    title: Define deterministic Primary scenarios, expected context, and metrics
    state: done
    priority: high
    depends_on: [PV-03]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Versioned scenarios cover feature changes, refactors, invariants, conflicts, multi-area work, mixed current and proposed matches, and coverage edges.
      - Each scenario declares its task, required authorities, sources, conflicts, expected changes, and wiki action.
      - A deterministic runner or test contract evaluates scenario context without an LLM.
    evidence:
      - scripts/wiki/primary-scenarios.ts
      - scripts/wiki/primary-scenarios.test.ts
  - id: PV-05
    title: Capture the unmodified Primary baseline
    state: done
    priority: high
    depends_on: [PV-04]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - A machine-readable report records recall, authority labelling, irrelevant context, unmapped files, command sequence, and drift escapes for every scenario.
      - A short interpretation distinguishes measured failures from hypotheses.
    evidence:
      - docs/evidence/pv-05-primary-baseline.json
      - docs/evidence/pv-05-primary-baseline.md
      - scripts/wiki/primary-baseline.test.ts
  - id: PV-06
    title: Make selected-work context authority- and source-complete
    state: not-started
    priority: high
    depends_on: [PV-05]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Current pages are the authoritative default result set.
      - Non-current pages are omitted or clearly separated from current authority.
      - Every returned page exposes status, authority, wiki path, exact sources, globs, and relevant open conflicts.
      - Deterministic glob expansion and a stable invariant-conflict-page-source read order are available.
      - Text and JSON outputs express the same semantic fields.
      - Existing impact-based context remains deterministic.
    evidence: []
  - id: PV-07
    title: Improve wiki:search only for baseline-proven misses
    state: not-started
    priority: normal
    depends_on: [PV-05]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Every selected search change starts from a failing baseline scenario and ends with focused passing evidence.
      - No ranking or search machinery is added without a reproduced miss.
    evidence: []
  - id: PV-08
    title: Validate new-repository adoption and coverage growth
    state: not-started
    priority: high
    depends_on: [PV-04]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - The empty repository starting state and expected point of becoming green are explicit.
      - The first feature adds code, a current page, source mapping, coverage, verification, and tests in one candidate.
      - Generated, lint, doctor, impact, typecheck, test, and applicable review preflight gates pass.
    evidence: []
  - id: PV-09
    title: Validate existing-repository bootstrap and coverage closure
    state: not-started
    priority: high
    depends_on: [PV-04]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Every covered file maps to a current page or a reasoned exclusion.
      - Confirmed behavior is compiled from primary sources and ambiguity becomes a conflict.
      - Initial review can disposition pre-existing mismatches without expanding the bootstrap candidate.
      - A later kit upgrade preserves adopter-owned policy, state, inventories, and local customizations.
    evidence: []
  - id: PV-10
    title: Strengthen the agent-entrypoint integration contract
    state: not-started
    priority: high
    depends_on: [PV-03, PV-05]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - The installed entrypoint points to the wiki index and current status.
      - Generic remaining-work requests route to the repository-wide work queue without a known node or search term.
      - The entrypoint directs agents to invariants, search, and selected context while preserving non-current authority labels.
      - Marker-only, placeholder, and command-name-only entrypoints fail tests.
      - The contract remains provider-neutral.
    evidence: []
  - id: PV-11
    title: Run fresh-session agent pilots over both adoption paths
    state: not-started
    priority: high
    depends_on: [PV-06, PV-08, PV-09, PV-10]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Versioned pilot records preserve the exact task, repository and base, commands, surfaced authorities and sources, changes, misses, and gate result.
      - Both new- and existing-repository adoption paths are exercised in isolated sessions.
      - PV-07 evidence is included when the baseline made search work applicable.
    evidence: []
  - id: PV-12
    title: Evaluate the Primary exit gate and decide the next investment
    state: not-started
    priority: high
    depends_on: [PV-11]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - A fresh session can enumerate remaining work from a generic request without knowing any internal node or ID.
      - The queue correctly distinguishes ready, active, waiting, blocked, deferred, and evidenced done work.
      - Every scenario surfaces all controlling current pages, invariants, relevant open conflicts, and required implementation sources.
      - No non-current page is presented as current authority.
      - Every changed file inside configured coverage maps to a current page or a reasoned exclusion.
      - No scenario demonstrates a code or wiki drift escape through deterministic gates.
      - Both adoption paths run reproducibly from their documented starting state to green.
      - Remaining misses are classified as a concrete defect, owner decision, or explicitly accepted limitation.
      - The owner records Primary validated, another focused cycle, or changed product priority with supporting evidence.
    evidence: []
  - id: PV-13
    title: Define and validate a meaningful followup_ref contract
    state: deferred
    priority: low
    depends_on: []
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Accepted reference syntax, existence policy, provider ownership, and offline behavior are explicit.
      - Adversarial tests prove the selected contract cannot be satisfied by meaningless prose.
    evidence: []
    deferred_reason: Reconsider after the Primary exit gate or a reproduced disposition escape.
  - id: PV-14
    title: Decide whether a reviewer claim-audit artifact is needed
    state: deferred
    priority: low
    depends_on: []
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - A concrete false-claim incident identifies which claim must become checkable.
      - The selected artifact contract states what it can and cannot prove.
    evidence: []
    deferred_reason: Reconsider after a reproduced false-claim incident or the Primary exit gate.
  - id: PV-15
    title: Reconsider source-map and bootstrap review breadth
    state: deferred
    priority: low
    depends_on: [PV-05]
    context_pages: [product/scope, product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - A scenario proves current source-to-page mapping causes a measurable harmful over-bundling failure.
      - Any redesign preserves deterministic source tracing and review completeness.
    evidence: []
    deferred_reason: Reconsider only when Primary baseline evidence demonstrates harmful over-bundling.
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
- Resolve known trust-boundary questions before relying on the system, either by closing a gap or explicitly recording an accepted limit.
- Make outstanding work repository-wide and machine-discoverable before relying on a human-readable roadmap table.
- Measure the current Primary path before changing search or context behavior.
- Improve `wiki:context`, search, coverage/bootstrap, and the session entrypoint only where the baseline exposes a failure.
- Validate both deterministic context completeness and real fresh-session adoption flows.
- Resume Secondary feature work only after the Primary exit gate is met or an owner explicitly changes this priority.

## Work queue

The `work_items` frontmatter is the only state, dependency, acceptance, and evidence contract. `not-started` is derived as `ready` when every dependency is done and `waiting` otherwise. Update a work record in the same PR that changes it; never mark an item done from a chat summary.

Inspect the deterministic human view at [work queue](../work-queue.md), run `bun run wiki:work`, or assemble a selected item's complete context with `bun run wiki:context -- --work <ID>`.

## Phase A — close known boundaries

### `PV-01`: decide the workflow trust boundary

A pull request can edit `.github/workflows/checks.yml`, keep a required job name, and replace its validation steps. The owner explicitly accepts this bootstrap seam by trusting repository write/admin actors and keeping organization-level security outside the product contract. The earlier hardening proposal is retained as archived history in [proposal/protected-main](./protected-main.md).

### `PV-02`: protect the scope contract from unreviewed semantic movement

The publishing repository's risk selector now protects the product-scope page and both of its declared primary sources. A publishing-only regression test exercises all three paths through the Fresh-context requirement evaluator and proves that these repository-specific paths do not leak into the generated downstream seed policy.

## Phase B — make work discoverable and establish a Primary baseline

### `PV-03`: zero-knowledge work discovery

The previous proposal table was a transitional human-readable tracker. It did not satisfy the product goal by itself: a new session had no reason to know this page existed, and the engine did not parse its rows, dependencies, states, or evidence.

The required user experience is:

1. the user asks a generic question such as "what work remains?", "what is unfinished?", or "what should we do next?";
2. the agent entrypoint directs all such requests to one standard repository command without requiring search terms;
3. the command scans the whole repository's structured work records and open conflicts;
4. it reports what is ready, active, waiting, blocked, and deferred, with explicit dependencies and evidence;
5. the user can select an item by the returned ID, after which a standard context command returns its controlling current pages, invariants, conflicts, proposal detail, acceptance criteria, and sources.

The selected representation is the structured `work_items` field on proposal pages. It keeps detailed rationale close to its wiki node while giving the engine a stable schema. GitHub issues may be linked as evidence or execution channels, but the repository queue remains usable without a live provider API.

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

Version 1 lives in `scripts/wiki/primary-scenarios.ts`. It uses a controlled synthetic contract rather than treating this repository's current page set as the fixture, so later baseline and isolated-agent runs can share stable expectations. The deterministic evaluator records current-page, invariant, conflict, implementation-source, authority-label, non-current-label, and expected-change recall together with irrelevant pages, unmapped files, context bytes, command sequence, drift escapes, and the expected wiki action. `scripts/wiki/primary-scenarios.test.ts` locks the eight categories, required declarations, incomplete-observation behavior, and byte-stable output. This contract defines what `PV-05` measures; it does not record the baseline result itself.

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

The version 1 baseline is recorded in
[`docs/evidence/pv-05-primary-baseline.json`](../../docs/evidence/pv-05-primary-baseline.json),
with measured results separated from untested hypotheses in the adjacent
[`pv-05-primary-baseline.md`](../../docs/evidence/pv-05-primary-baseline.md).
Against the unmodified engine, the default text discovery path recalled all 9 controlling
current-page expectations, all 4 invariant expectations, and both required conflicts. It
exposed 0 of 18 declared implementation sources and 0 of 14 exact status-plus-authority
labels, returned 91 irrelevant page occurrences, stated no expected wiki action, and left
two nested coverage-edge files unmapped. The code-only probe for that edge passed both
`wiki:lint` and `wiki:impact --enforce`; all seven mapped-source probes were caught.
These are fixture measurements, not evidence of model comprehension, adoption behavior,
runtime cost, or the correct search remedy.

## Phase C — improve selected-work context

### `PV-06`: authoritative context output

Default context output should make the truth model visible without requiring the caller to remember hidden conventions.

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

This work improves discoverability. It does not claim proof that the agent cognitively read the returned material.

## Phase D — validate adoption

### `PV-08`: new repository

Validate the documented empty-repository path from kit sync through the first feature.

### `PV-09`: existing repository

Validate bootstrap over a repository that already contains multiple code areas and at least one ambiguous intent.

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

`PV-12` may pass only when its frontmatter acceptance contract is satisfied with durable evidence.

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

1. `PV-03` makes remaining work discoverable without prior node knowledge.
2. `PV-02` closes the in-repository scope-review boundary while `PV-04` can begin the scenario contract.
3. `PV-01` records the trusted-developer boundary; organization-level workflow protection is not part of the remaining roadmap.
4. `PV-05` records the baseline before behavior changes.
5. `PV-06` fixes selected-work context completeness.
6. `PV-07` runs only if the baseline proves search failures.
7. `PV-08`, `PV-09`, and `PV-10` make adoption and entrypoint behavior reproducible.
8. `PV-11` runs isolated agent pilots.
9. `PV-12` records the owner decision at the Primary exit gate.
10. `PV-13`–`PV-15` are reconsidered from evidence rather than momentum.

Primary validation may claim the deterministic rails only within the trusted-developer boundary. It must not claim protection against a hostile maintainer or organization-level security guarantees.

## Decision log

Record decisions here when they concern proposed sequencing or evaluation. If a missing decision makes current behavior ambiguous, open a conflict instead.

| Decision | State | Result or required owner input |
|---|---|---|
| Prioritize Primary validation over new Secondary review features | proposed | Approve this roadmap or revise its priority |
| Zero-knowledge re-entry | decided | A user may ask only what work remains; no proposal ID, task ID, or search term is required |
| Workflow protection boundary | decided | Trust repository developers/admins; leave required workflows, CODEOWNERS, rulesets, and bypass policy to deployments |
| Pilot repositories/fixtures | pending | Select at least one new-repository and one existing-repository target |
| Search work after baseline | applicable | PV-05 reproduced 91 irrelevant page occurrences from substring matching; PV-07 must still select remedies from focused failing evidence |
| Resume Secondary feature investment | pending | Decide at `PV-12` from exit-gate evidence |

## Per-PR update protocol

Each implementing PR must:

1. name the `PV-NN` item in its metadata and description;
2. change only one coherent work item unless the tracker declares them inseparable;
3. add the failing scenario or evidence before the fix where practical;
4. update current wiki pages when behavior changes;
5. update this item's structured state and durable evidence;
6. regenerate deterministic artifacts and pass the repository's full preflight;
7. leave undecidable current intent in a conflict rather than marking the item done.
