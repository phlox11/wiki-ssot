---
id: proposal/kit-code-splitting
summary: Split the portable Wiki SSOT kit's oversized core, CLI, and test modules into stable domain seams without changing commands, output contracts, adoption, upgrade, or review guarantees.
kind: proposal
status: proposed
authority: normative
owners: ["@phlox11"]
sources:
  - path: scripts/wiki/core.ts
  - path: scripts/wiki/cli.ts
  - path: scripts/wiki/fresh-context.test.ts
  - path: scripts/wiki/wiki.test.ts
  - path: scripts/wiki/work.test.ts
  - path: scripts/wiki/kit.test.ts
  - path: scripts/wiki/kit-sync.ts
  - path: scripts/wiki/apply.ts
  - path: scripts/wiki/test-runner.ts
  - path: scripts/wiki/kit-modularity-baseline.ts
  - path: scripts/wiki/kit-modularity-baseline.test.ts
  - path: docs/evidence/km-00-portable-kit-baseline.json
  - path: docs/evidence/km-00-portable-kit-baseline.md
affects: [architecture/engine, operations/enforcement]
related: [proposal/token-efficiency, architecture/engine, operations/enforcement, product/invariants]
tags: [roadmap, kit, modularity, split, refactor, maintainability, tests, cli]
work_items:
  - id: KM-00
    title: Freeze the portable-kit modularity baseline and compatibility contract
    state: done
    executor: agent
    priority: normal
    depends_on: [TE-06-OWNER]
    context_pages: [product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - A versioned baseline records exact revision, KIT_ENTRIES membership, kit-owned TypeScript line and byte counts, exported symbols, import edges, CLI commands, JSON and text fixtures, test-suite boundaries, and kit manifest digest.
      - The baseline confirms or revises the initial candidate rule using kit ownership, payload share or byte size, responsibility count, and change-coupling evidence rather than treating line count alone as proof that a split is beneficial.
      - The compatibility contract freezes public command names and flags, exit codes, text and JSON shapes, deterministic ordering, exported API used by shipped and publishing-only callers, generated paths, kit placement, manifest semantics, and adoption or upgrade behavior.
      - The baseline identifies any token-efficiency follow-up that still changes the same modules and records the safe integration order before code motion begins.
      - No implementation module is moved or renamed in this baseline PR.
    evidence:
      - scripts/wiki/kit-modularity-baseline.ts
      - scripts/wiki/kit-modularity-baseline.test.ts
      - docs/evidence/km-00-portable-kit-baseline.json
      - docs/evidence/km-00-portable-kit-baseline.md
      - wiki/proposals/kit-code-splitting.md
  - id: KM-00-OWNER
    title: Ratify the portable-kit module budget and split contract
    state: done
    executor: human
    priority: normal
    depends_on: [KM-00]
    context_pages: [product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - The owner explicitly ratifies the module-size and responsibility screen, exception rule, compatibility surface, target dependency graph, and delivery sequence before implementation begins.
      - Any changed numeric bound or accepted oversized exception is recorded with its evidence and rationale rather than being treated as current kit policy by implication.
      - The decision confirms that compatibility, coverage, exact-HEAD review, kit ownership, and adoption or upgrade safety take priority over satisfying a numeric size target.
    evidence:
      - wiki/proposals/kit-code-splitting.md
      - docs/evidence/km-00-portable-kit-baseline.json
      - docs/evidence/km-00-portable-kit-baseline.md
  - id: KM-01
    title: Extract shared model, repository-view, and page-validation primitives
    state: not-started
    executor: agent
    priority: normal
    depends_on: [KM-00-OWNER]
    context_pages: [product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Wiki domain types, stable serialization and hashing helpers, repository-view access, page parsing, page schema validation, link validation, and work-item schema validation move behind named modules with one-way imports and no circular dependency.
      - Existing public exports remain available through a compatibility facade until every in-repository and kit consumer has migrated, so a structural split does not become an accidental public API break.
      - Staged versus working-tree reads, source-symbol validation, path normalization, finding codes, deterministic ordering, and malformed-input behavior remain byte- or structure-equivalent to the KM-00 fixtures.
      - Focused unit tests cover each extracted boundary, and the portable test runner discovers the new test files deterministically.
      - KIT_ENTRIES, generated kit files, manifest hashes, TypeScript configuration, coverage mapping, and adoption or upgrade fixtures include every new kit-owned module.
    evidence: []
  - id: KM-02
    title: Extract work discovery, search, context, and generated-view modules
    state: not-started
    executor: agent
    priority: normal
    depends_on: [KM-01]
    context_pages: [product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Queue derivation, executor projection, recommendation, search, selected-work context, topic context, source expansion, read ordering, and generated index or status rendering are grouped into explicit discovery, context, and generated-view modules.
      - Current invariants, conflicts, current pages, non-current rationale labels, source declarations, expanded paths, focused commands, and deterministic text and JSON ordering preserve the ratified token-efficiency contract.
      - Work IDs, lifecycle validation, recommendation priority, human-work handoff, partial-match discovery, and selected-work behavior retain their focused regression coverage.
      - Domain tests move with the extracted behavior so work.test.ts no longer combines schema, queue, CLI, and context concerns in one file.
      - The split neither re-expands compact context nor weakens source traceability, coverage, drift detection, or open-conflict inclusion.
    evidence: []
  - id: KM-03
    title: Extract portable-kit packaging and generation from the engine core
    state: not-started
    executor: agent
    priority: normal
    depends_on: [KM-02]
    context_pages: [product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Kit entry declarations, placement and ownership types, templates, exclusion stripping, managed-block extraction, package-fragment rendering, manifest construction, comparison, and writing move into a dedicated kit packaging module.
      - The packaging module depends only on the minimum shared repository and serialization primitives and does not import discovery, impact, review, or CLI command handlers.
      - Every newly extracted module that adopters require is declared exactly once in KIT_ENTRIES and arrives under kit/files with deterministic content and manifest hashes.
      - New, adopt, upgrade, dry-run, customized-file, orphan, removed-upstream, seed, managed-block, reference, executable-mode, and symlink containment regressions continue to pass without changing ownership semantics.
      - The publishing repository's wiki:kit check remains byte-stable apart from the intentionally added module paths and updated content-addressed manifest.
    evidence: []
  - id: KM-04
    title: Extract verification, impact, and exact-HEAD review modules
    state: not-started
    executor: agent
    priority: normal
    depends_on: [KM-03]
    context_pages: [product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - Verification state, config and coverage validation, source and conflict mapping, impact analysis, PR metadata, review requirement selection, bundle construction, report parsing, finding adjudication, and attestation checking move into explicit verification, impact, and review modules.
      - Exact HEAD, merge base, metadata, affected authority, conflicts, sources, bundle digest, reviewer identity, finding classification, disposition, and stale-evidence behavior remain compatible with the KM-00 contract.
      - Review-bundle tests retain fail-closed coverage for omitted authority, sources, tests, conflicts, and digest bindings, and do not permit authoring-session self-PASS.
      - The candidate is preflighted with the merge-base engine whenever its own bundle-content changes require that compatibility path.
      - Generated source maps, current Wiki authority, high-risk selection, Fresh-context selection, and implementation-source classification remain reconciled with the extracted paths.
    evidence: []
  - id: KM-05
    title: Replace the monolithic CLI dispatcher with bounded command handlers
    state: not-started
    executor: agent
    priority: normal
    depends_on: [KM-04]
    context_pages: [product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - scripts/wiki/cli.ts becomes a thin executable entrypoint that owns argument parsing, shared error handling, and command registration while bounded handlers own discovery, generation, validation, impact, and review commands.
      - Every existing command, flag, help string, usage error, exit code, standard-output payload, standard-error finding, JSON shape, staged mode, and root override remains compatible with KM-00 fixtures.
      - Handler dependencies point toward domain modules and do not recreate a second all-purpose core or introduce circular imports.
      - Direct command-handler tests cover success, usage errors, malformed repositories, and write guards without requiring every unit case to spawn the complete CLI process.
      - The shipped executable path and package.json wiki scripts remain unchanged for adopters.
    evidence: []
  - id: KM-06
    title: Split portable regression suites and consolidate shared fixtures
    state: not-started
    executor: agent
    priority: normal
    depends_on: [KM-05]
    context_pages: [product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - fresh-context.test.ts is divided by manifest and requirement selection, report schema and disposition adjudication, exact-HEAD preflight or check behavior, GitHub attestation, and integration-seam contracts.
      - wiki.test.ts is divided by page schema and links, generated data, verification and coverage, impact and conflicts, and repository hooks; remaining work and context cases are divided along their extracted domain boundaries.
      - Shared repository builders, Git helpers, page factories, report factories, and process runners live in test-only fixture modules with explicit ownership and no production import of test utilities.
      - Test names and assertions remain traceable from the pre-split suite, and the test runner proves every new file is discovered exactly once in deterministic order.
      - The refactor does not reduce negative, malformed-input, symlink, stale-evidence, coverage, conflict, adoption, or upgrade cases merely to satisfy a file-size target.
    evidence: []
  - id: KM-07
    title: Validate the modular kit and install a bounded growth guard
    state: not-started
    executor: agent
    priority: normal
    depends_on: [KM-06]
    context_pages: [product/invariants, architecture/engine, operations/enforcement]
    acceptance:
      - One exact combined revision passes generated, kit, lint, doctor, impact, typecheck, full tests, audit, exact-HEAD preflight, and isolated review whenever policy requires it.
      - Fresh new-repository adoption and existing-repository upgrade fixtures prove that every extracted file is installed, updated, conflict-classified, and removed-upstream according to the existing manifest contract.
      - The final evidence compares per-module lines, bytes, exports, dependencies, test ownership, kit payload size, and changed-file breadth with KM-00 and explains any regression.
      - A deterministic growth check fails only on ratified kit-owned module boundaries and gives an actionable instruction to split, justify, or revise the bound; it does not treat total repository line count as a quality oracle.
      - The initial exit target leaves no all-purpose production module above the ratified bound, keeps the CLI entrypoint thin, and leaves each portable regression file aligned with one named contract area without reducing behavioral coverage.
    evidence: []
---

# Portable kit code splitting

This proposal schedules a semantic-preserving modularization cycle after the
token-efficiency proposal. It is a `status: proposed` plan and does not describe
current behavior. `KM-00` intentionally waits for `TE-06-OWNER`, because
`TE-01` through `TE-04` are expected to change the same context, source, and
review surfaces. Starting code motion before those contracts settle would make
their measurements harder to compare and create avoidable merge conflicts.

The scope is kit-first. A file is a primary split candidate when it is shipped
as kit-owned code to every adopter, occupies a material share of the portable
payload or crosses the initial size screen, and combines responsibilities that
can be protected by separate contracts. Line count alone is supporting
evidence, not the decision rule.

## Reproduced portable baseline

The initial inventory was reproduced at exact repository revision
`6f6298cf9174338d71fee66e6a20ce8db7ed2c84`. `wiki:kit --check` passed. The
kit-owned `scripts/wiki` files copied verbatim by `KIT_ENTRIES` total 353,941
UTF-8 bytes:

| Shipped file | Role | Lines | Bytes | Portable tooling share | Initial disposition |
|---|---|---:|---:|---:|---|
| `scripts/wiki/core.ts` | production | 2,972 | 159,745 | 45.1% | split by domain |
| `scripts/wiki/fresh-context.test.ts` | regression | 1,566 | 69,390 | 19.6% | split by review contract |
| `scripts/wiki/wiki.test.ts` | regression | 745 | 41,668 | 11.8% | split by engine contract |
| `scripts/wiki/cli.ts` | production | 880 | 39,867 | 11.3% | thin entrypoint plus handlers |
| `scripts/wiki/work.test.ts` | regression | 660 | 31,061 | 8.8% | split by work and context domain |
| `scripts/wiki/github-attestation.ts` | production | 189 | 10,013 | 2.8% | retain and monitor |
| `scripts/wiki/test-runner.ts` | test infrastructure | 47 | 1,767 | 0.5% | retain and extend discovery checks |
| `scripts/wiki/tsconfig.json` | configuration | 18 | 430 | 0.1% | retain |

The five proposed split targets account for 96.6% of this portable tooling
payload. Their sizes are not the only signal:

- `core.ts` currently owns page and work schemas, repository access,
  validation, search, queue and context projection, generated views, kit
  packaging, verification state, config and coverage, impact, PR metadata,
  review bundles, and Fresh-context attestation.
- `cli.ts` routes every public command through one 673-line `main` function in
  addition to its text renderers and argument parsing.
- `fresh-context.test.ts` combines manifest determinism, risk selection, report
  validation, structured findings, disposition adjudication, GitHub envelopes,
  agent-entrypoint seams, and workflow seams in one file.
- `wiki.test.ts` combines schema, links, staged snapshots, search, generated
  data, coverage, verification, impact, conflict, and hook regressions.
- `work.test.ts` combines work schema and graph validation, queue projection,
  CLI behavior, selected-work context, and generic topic context.

## Initial modularity screen

`KM-00` turns this diagnosis into a checked contract and `KM-00-OWNER` ratifies
it before implementation. The values below are proposed starting points, not
current kit policy. The initial screen marks
a kit-owned TypeScript file for review when any of these hold:

1. it exceeds 1,000 lines or 64 KiB;
2. it exceeds 30 KiB or 10% of the copied portable tooling payload and owns
   more than one independently testable contract area;
3. one top-level dispatcher or orchestrator exceeds 250 lines;
4. unrelated work repeatedly changes the same file because its responsibilities
   are not separated.

Meeting a screen does not force a split. The baseline must show a stable seam,
compatible dependency direction, and focused regression ownership. Conversely,
splitting one large file into several arbitrary fragments does not satisfy the
proposal.

## Frozen KM-00 baseline and compatibility contract

The checked KM-00 evidence is pinned to exact pre-motion revision
`2f8629fdd37bbd4001ffc07e65964fcead1d16d4`. The publishing-only, model-free
runner checks out that revision in a disposable local clone, loads the pinned
kit engine, analyzes TypeScript imports and exports through the compiler API,
and records byte-stable JSON and Markdown. UTF-8 byte counts include the full
blob, and line counts count LF bytes, including a final newline. The evidence
binds the complete `KIT_ENTRIES` table, generated paths, test-suite boundaries,
exported symbols, import and caller edges, representative CLI fixtures, and
manifest-v2 digest
`4963245ac4504cb8c6062dea1816a748af88f63deb669411ab6e242a4cd7b52e`.

At that revision, copied kit-owned `scripts/wiki` tooling totals 9,852 lines
and 521,482 UTF-8 bytes. The five proposed split targets total 9,598 lines and
509,272 bytes, or 97.7% of that payload:

| Target | Lines | Bytes | Payload share | Recorded responsibility areas |
|---|---:|---:|---:|---:|
| `scripts/wiki/core.ts` | 4,144 | 230,066 | 44.1% | 10 |
| `scripts/wiki/fresh-context.test.ts` | 2,400 | 126,643 | 24.3% | 5 |
| `scripts/wiki/cli.ts` | 1,277 | 58,274 | 11.2% | 5 |
| `scripts/wiki/work.test.ts` | 1,032 | 52,621 | 10.1% | 5 |
| `scripts/wiki/wiki.test.ts` | 745 | 41,668 | 8.0% | 5 |

This confirms the initial candidate set without turning line count into the
decision rule. Every target is kit-owned and carries material payload or
responsibility breadth. Change history since
`6f6298cf9174338d71fee66e6a20ce8db7ed2c84`, excluding merge commits, is kept
as additional coupling evidence: it may strengthen a split case but its absence
does not erase independently measured payload and responsibility evidence.
`apply.ts` and publishing-only validation runners remain measured context, not
first-cycle split targets, because they are not copied kit runtime or regression
files.

The compatibility surface frozen for KM-01 through KM-07 is:

- the 17 public `scripts/wiki/cli.ts` commands, their accepted flags and
  selector combinations, help and usage behavior, success/finding/usage exit
  codes, stdout/stderr separation, deterministic ordering, and representative
  JSON field and text-heading digests;
- exported and re-exported value and type APIs, including type-only clauses,
  used by shipped and publishing-only callers, plus normalized import edges;
- generated Wiki, source-map, conflict-map, inventory, kit, and manifest paths;
- every kit target, source kind, `files | seed | managed | reference` placement,
  ownership rule, per-file hash, and content-addressed manifest-v2 semantics;
- `new`, `adopt`, `upgrade`, and dry-run outcomes, host-file preservation,
  version-1 workflow migration, conflict and explicit-accept behavior,
  removed-upstream handling, and symlink containment; and
- deterministic discovery of each portable regression file exactly once, with
  existing negative and malformed-input coverage preserved.

Compatibility, coverage, exact-HEAD review, kit ownership, and safe adoption or
upgrade take priority over any numeric module target. `KM-00-OWNER` must ratify
the proposed screen, exceptions, target dependency graph, and delivery sequence
before code motion begins. `TE-03` remains deferred. If it is explicitly
activated before that ratification, it must finish first and this baseline must
be regenerated; otherwise it follows KM-07 so it cannot invalidate the module
and source-boundary measurements mid-cycle. This KM-00 change moves or renames
no production module.

## Owner ratification

The owner ratifies the KM-00 module budget and split contract without changing
the proposed bounds. A kit-owned TypeScript file enters split review when it
exceeds 1,000 lines or 64 KiB; when it exceeds 30 KiB or 10% of the copied
portable payload and owns more than one independently testable contract area;
when one top-level dispatcher or orchestrator exceeds 250 lines; or when
non-merge history shows repeated unrelated change coupling. Passing the screen
does not force a split. A stable responsibility seam, one-way dependency
direction, focused regression ownership, and preserved compatibility remain
required, and any retained oversized exception must record its evidence and
rationale. No oversized exception is accepted by this decision in advance.

This decision is bound to the exact KM-00 baseline revision
`2f8629fdd37bbd4001ffc07e65964fcead1d16d4` and manifest-v2 digest
`4963245ac4504cb8c6062dea1816a748af88f63deb669411ab6e242a4cd7b52e`.
It ratifies the frozen 17-command CLI, public value and type exports, generated
paths, kit placement and ownership, manifest semantics, deterministic test
discovery, and new, adopt, upgrade, and dry-run behavior as compatibility
constraints for KM-01 through KM-07. Compatibility, behavioral coverage,
exact-HEAD independent review, kit ownership, and safe adoption or upgrade take
priority over satisfying any numeric target.

The owner also ratifies the target dependency direction and the sequential
delivery order recorded below: KM-01 through KM-07 proceed only after their
predecessor is merged and revalidated. `TE-03` remains deferred until after
KM-07; activating it earlier would require it to finish first and KM-00 to be
regenerated before code motion. The publishing-only `apply.ts` and Primary
measurement runners remain outside this first portable-kit split cycle.

## Target module shape

The exact filenames remain an implementation choice within the work-item
contracts, but the dependency direction should converge on this shape:

```text
shared model / stable serialization / repository view
  -> page and work validation
  -> discovery, context, and generated views
  -> verification, coverage, impact, and review
  -> portable kit packaging
  -> bounded CLI handlers
  -> thin scripts/wiki/cli.ts entrypoint
```

Production modules must not import CLI handlers or test fixtures. Kit packaging
must not import discovery or review merely to reach a shared helper. Review may
consume impact and validated Wiki models, but impact must not consume review
attestation. A compatibility facade may temporarily preserve existing imports,
but the exit gate must not leave a second monolith that re-exports internal
stateful behavior without a documented boundary.

## Delivery order

1. `KM-00` runs after the token-efficiency owner exit and prepares compatibility
   plus the measured split contract.
2. `KM-00-OWNER` records the human decision on the proposed budget, exceptions,
   target graph, and sequence.
3. `KM-01` extracts the shared foundation first.
4. `KM-02`, `KM-03`, and `KM-04` sequentially separate discovery and context,
   kit packaging, and verification or review domains. They stay linear because
   each step changes the compatibility facade, kit entries, and architecture
   source boundaries.
5. `KM-05` makes the existing CLI path a thin dispatcher over those domains.
6. `KM-06` finishes the portable test-suite split and shared test fixtures.
7. `KM-07` validates a complete kit adoption and upgrade cycle and installs the
   ratified growth guard.

Each implementation item is a semantic-preserving refactor unless a separately
approved current contract says otherwise. Every PR updates current Wiki source
boundaries, verification state, generated maps, kit output, tests, and adoption
evidence together. A moved function is not complete while an old compatibility
path, fixture, or generated kit copy silently points at stale code.

## Explicitly deferred large files

`scripts/wiki/apply.ts` and `scripts/wiki/primary-baseline.ts` are also large,
but they are not copied as kit-owned runtime or regression files by
`KIT_ENTRIES`. `apply.ts` is the publishing checkout's external application
orchestrator, and the Primary runners are publishing-only validation evidence.
They remain visible in KM-00 measurements but are outside the first split cycle.
A later proposal may split them if change-coupling or maintenance evidence
justifies expanding beyond the portable payload.

## Non-goals and limits

- This proposal does not change current Wiki SSOT behavior or activate any
  implementation work before its dependencies are done.
- It does not rename the public `scripts/wiki/cli.ts` entrypoint, remove a
  command, change output contracts, or replace Bun and TypeScript.
- It does not weaken deterministic generation, coverage, impact, source
  verification, conflicts, exact-HEAD review, or reviewer separation.
- It does not remove regression cases to make files smaller or optimize only
  the publishing repository while breaking an adopting repository.
- It does not make total repository lines, file count, or module count a
  permanent quality target.
- It does not include the external apply orchestrator or Primary measurement
  runners in the initial implementation scope.

## Exit gate

`KM-07` may pass only when the portable kit installs and upgrades with the same
observable contracts, every new module is manifest-owned and source-mapped,
the complete deterministic and regression gates pass at one exact revision,
and the measured module graph no longer contains the all-purpose core, CLI, or
portable test-suite boundaries identified here. If compatibility and a numeric
bound conflict, compatibility wins and the evidence records a bounded follow-up
or a reasoned exception rather than hiding behavior.
