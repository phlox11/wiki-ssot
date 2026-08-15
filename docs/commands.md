# Command reference

All commands are `bun run wiki:<name>`; each maps to `bun scripts/wiki/cli.ts <name>`. Pass CLI flags after `--`.

| Command | What it does | Blocks? |
|---|---|---|
| `wiki:lint` | Frontmatter, links, source paths, coverage, generated freshness. | pre-commit + local gate |
| `wiki:generated` | Regenerate the bounded index, complete catalog, cumulative current-status, work queue, conflicts, relationship graph, reverse maps, and inventories. Add `-- --check` to verify without writing. | local gate (`--check`) |
| `wiki:kit` | Regenerate the `kit/` copy-paste distribution from the files it ships. Add `-- --check` to fail on drift instead of writing. Refuses to run unless `.wiki/config.json` sets `publishesKit: true`, so it cannot overwrite an adopting repository's own `kit/`. | publisher local gate (`--check`) |
| `wiki:impact -- --base <ref>` | From the diff since `<ref>`, print affected pages/conflicts, staleness, and metadata findings. Add `--enforce` to exit non-zero on any error. | local gate (`--enforce`) |
| `wiki:verify -- --page <id>` | Record current source hashes for a page you updated. Add `--unchanged "<20+ char reason>"` when meaning did not change. With no `--page`, re-verifies every current page. | — |
| `wiki:search -- "<terms>"` | Search page IDs, summaries, tags, and bodies. Complete all-term matches are preferred when present; otherwise scored partial matches are returned deterministically. | — |
| `wiki:work` | With no query or ID, list every proposal work item and open conflict, derive ready/waiting state, and recommend the highest-priority active or ready `agent`/`either` item. `-- --executor agent` shows agent/either, `human` shows human/either for handoff, and `all` shows every executor; human-exclusive work is never auto-recommended. Add `--all` independently for completed work, `--json` for versioned output, or `--help` for work options. | — |
| `wiki:context -- "<terms>"` | The current pages, open conflicts, non-current rationale, and sources an agent should read for a topic. Query and `-- --work <ID>` default to a compact text/JSON projection with authority labels, paths, summaries, body digests, focused commands, exact sources, deterministically expanded globs, page-local conflict IDs, and an invariant → conflict → current-page → source read order. Add `--full` for the exhaustive body-complete representation. Complete matches keep the current selection semantics; partial-only matches return ordered compact candidates before source expansion, and each page candidate links to exact `-- --page <ID> --full` context. Also accepts `-- --conflict C-NNN` or `-- --base <ref>`; selectors cannot be combined. For a selected work item at a clean committed HEAD, `--work <ID> --artifact <path> --metadata <pr-body> --base <ref>` writes a bounded body-free handoff, while replacing `--artifact` with `--reuse` validates every binding before reuse. | — |
| `wiki:conflicts` | List open conflicts. `-- C-NNN` prints one resolution contract; `-- --all` includes resolved. | — |
| `wiki:review-preflight -- --base <ref> --metadata <file> [--output <dir>] [--report <file>]` | Before opening a PR, classify risk, prepare the exact independent-review bundle, or validate the returned report. Version 2 needs no PR-body report mirror or GitHub actor assertion. | pre-PR |
| `wiki:review-bundle -- --base <ref> --metadata <file>` | Write a deterministic content-addressed bundle with `manifest.json`, `focused-manifest.json`, reviewer instructions, and a report example. Wiki/conflict bodies are stored once by digest; overlapping roles and changed/authority/test/supporting source classifications remain explicit and validated. | review input |
| `wiki:review-check -- --base <ref> --metadata <file> [--report <file>]` | Evaluate trusted risk policy and return `required`/reasons. When required, recompute the current manifest and validate report schema, PASS, evidence, and exact SHA/digests. Version 1 additionally retains authenticated actor/mirror validation. | local review gate |
| `wiki:doctor` | Validate required downstream seams: explicit config, affirmative provider-neutral AGENTS authority/work/context clause shapes, canonical commands, semantic PR template, and enforcement-mode consistency. Version 2 reports actionable reconciliation when legacy Wiki workflows remain active. | local gate |
| `wiki:check -- --base <ref>` | Legacy convenience projection: lint + generated + impact. Its flags and output remain compatible when `--output` is absent. | local convenience |
| `wiki:check -- --base <ref> --metadata <file> [--report <file>] --output <result.json>` | Canonical local gate. Writes an exact result binding committed HEAD, resolved base/merge-base, metadata digest, check/review summaries/findings, configured v2 argv checks, and a deterministic digest. Changed toolkit-owned files select Wiki tooling typecheck + the full tooling suite; publisher mode also runs kit freshness/growth guards. Explicit metadata/report/output paths are the only permitted worktree exceptions. | required local gate |
| `wiki:publish -- --result <result.json> [--repo owner/repo] [--pr N]` | Revalidates the result, clean local HEAD, and remote PR head; upserts one `wiki-ssot:local-status` comment, then posts the configured v2 status context. Warnings are successful status; API failures are non-zero. | protected GitHub status |
| `wiki:audit` | Repo-wide diagnostic: structure + generated + every current page's source hashes. The canonical local gate already includes this coverage. | local diagnostic |
| `wiki:index` / `wiki:inventory` | Write just the core generated files / just the inventories. | — |
| `wiki:scale` | Publisher-only deterministic benchmark for the declared Schooled and large synthetic profiles. `-- --enforce` checks correctness, phase/RSS limits, and the bounded index size; explicit output flags preserve JSON/Markdown evidence. This harness is intentionally omitted from the downstream kit. | release evidence |

Generated navigation has two layers. `wiki/index.md` is a bounded first entrypoint grouped by the first path segment; `wiki/catalog.md` is the complete page listing. `wiki/current-status.md` reports cumulative lifecycle counts and links every current invariant without repeating the entire catalog. `.wiki/relationship-graph.json` is a deterministic, disposable projection for tools: page/work nodes plus declared `related`, `affects`, conflict-affect, work-context, and work-dependency edges. The graph does not add authority or change impact propagation.

`wiki:scale` does not replace `wiki:lint`, `wiki:audit`, or application tests. It builds disposable Git repositories and exercises load/validation, queue derivation, search, and generated views under fixed record profiles. Wall-clock and RSS measurements remain environment-sensitive diagnostics; `--enforce` supplies the reproducible acceptance envelope used by this publisher. Downstream repositories receive the runtime paths exercised by the benchmark, not the publisher-only harness or its fixture generator.

## Install, adopt, or upgrade

`apply.ts` is intentionally run from a WikiSsot checkout rather than through the target package scripts, because it must work before the target has the engine installed:

```sh
bun /path/to/WikiSsot/scripts/wiki/apply.ts --into /path/to/git-project [--dry-run] [--json] [--skip-install] [--accept <path>]
```

It detects `new`, `adopt`, or `upgrade`, performs every safe mechanical integration and Wiki check, and returns `ready`, `needs-merge`, `needs-reconcile`, or `failed`. `--dry-run` is byte-preserving: a safe bootstrapped plan is `preview`, while missing current-page/coverage work is still `needs-reconcile`; dry-run never returns `ready` because it did not run the installed checks. Resolve the named merge/semantic work and rerun the same command. Exit codes are 0 for `preview`/`ready`, 1 for expected action, and 2 for fatal failure. The command never creates Git history or performs semantic review itself.

## Common flows

Start a fresh session without knowing internal wiki nodes:

```sh
bun run wiki:work
# choose a recommended agent/either item from the deterministic result
bun run wiki:context -- --work PV-02
```

`wiki:work` never recommends human-exclusive, waiting, blocked, deferred, or conflict records. Human work stays visible in the default/all views, and `bun run wiki:work -- --executor human` narrows the display to human/either work without turning human work into a blocker or agent authorization. Executor filtering happens after full-graph dependency and queue-state derivation. The independent `--all` flag includes completed rows, so combinations such as `--executor human --all --json` are valid. Each row identifies executor, proposal owner, dependencies, unmet dependencies, state-specific reason/evidence, and the exact selected-context command. A human work context instructs the agent to report the procedure and hand off without assuming credentials or authority; `either` likewise grants no additional permission. Selected-work context presents current authority first, expands each source glob into a path-sorted file list, deduplicates those files into the authoritative read order, and places the owning proposal last under `NON-CURRENT WORK OWNER`. The default compact projection carries the same routing semantics with stable body digests and focused full-context commands but does not serialize complete Wiki bodies or a second aggregate source list. Query context applies the same source-complete truth model to current authority and conflicts. Directly matched non-current pages remain explicitly non-current, and a partial-only query returns ordered candidate metadata until the caller follows a focused command. `--full` restores the previous exhaustive body-complete text/JSON shape. An empty repository returns success with "No remaining work."

After selection and once prospective PR metadata exists, authoring and implementation roles can share one exact-revision routing artifact instead of repeating queue and broad context discovery:

```sh
bun run wiki:context -- --work TE-05 --artifact /tmp/te-05-context.json \
  --metadata /tmp/pr-body.md --base origin/main
# A later role validates all bindings at the same clean committed HEAD.
bun run wiki:context -- --work TE-05 --reuse /tmp/te-05-context.json \
  --metadata /tmp/pr-body.md --base origin/main
```

The artifact contains no page or source body. It binds the selector and work contract, canonical metadata, base and merge-base, committed HEAD, controlling pages, conflicts, expanded current-authority and work-owner sources, and its handoff read order by digest. The handoff keeps the selected context's authority order and appends deduplicated owner-declared sources as routing evidence; that does not make the proposed owner page current authority. Any mismatch invalidates the artifact as a unit. Validation is a routing shortcut only: every role still reads the listed controlling pages and implementation sources it needs. Reuse the artifact only at the exact revision it names; after a commit, rebase, metadata edit, authority edit, source edit, or conflict edit, build a new one.

For an existing installation, upgrade the engine before annotating human work. Older engines do not use `executor` to suppress recommendations. After upgrade, unannotated work remains compatible and normalizes to `agent`.

Before a PR:

```sh
bun run wiki:generated
bun run wiki:lint
bun run wiki:doctor
bun run wiki:impact -- --base origin/main --enforce
bun run typecheck && bun run test
```

Once the candidate is committed, the required exact-result path is:

```sh
bun run wiki:check -- --base origin/main --metadata pr-body.md \
  --output /tmp/wiki-result.json
# With a review report:
bun run wiki:check -- --base origin/main --metadata pr-body.md \
  --report review-report.json --output /tmp/wiki-result.json
bun run wiki:publish -- --result /tmp/wiki-result.json
# Or identify the PR explicitly:
bun run wiki:publish -- --result /tmp/wiki-result.json --repo owner/repo --pr 123
```

Version 2 runs its configured project argv checks locally and publishes only
the exact status. It ships no active Actions workflow and needs no Draft/Ready
attestation choreography. Publishing requires an authenticated `gh` CLI, but
the toolkit does not store tokens or run a hosted service.

You changed a source and its page's meaning:

```sh
# edit the page, then:
bun run wiki:verify -- --page architecture/api
```

You changed a source but the page's meaning is unchanged:

```sh
bun run wiki:verify -- --page architecture/api --unchanged "internal refactor only, exported behavior identical"
```

Fresh-context review:

```sh
# Commit the complete candidate first. Before a PR exists, classify and prepare
# the exact bundle when required; uncommitted candidate files are rejected.
bun run wiki:review-preflight -- --base origin/main --metadata pr-body.md \
  --output review-bundle --json
# Give the bundle to a context-isolated reviewer/sub-agent, then validate its report.
bun run wiki:review-preflight -- --base origin/main --metadata pr-body.md \
  --report report.json --json
```

Preflight returns `not-required`, `review-required`, `needs-reconcile`, or `pass`. A required `NEEDS_RECONCILE` report must identify the exact discrepancy, controlling authority, required code/wiki/test change, and acceptance criteria. The authoring agent dispositions each finding before opening the PR — fixing what this candidate broke or declared, tracking a pre-existing mismatch or undecidable intent in an open conflict, or recording a named follow-up — and reruns preflight on the new HEAD.

The report is JSON/YAML with exact bindings, reviewer, evidence, and summary or findings. `version: 1` carries free-text findings and stays accepted. `version: 2` carries structured findings: `id`, `classification`, `disposition`, `scope_refs`, `discrepancy`, `authority`, `evidence`, and `acceptance_criteria`, where `conflict_introduced`/`existing_conflict_linked` require `conflict_id`, `followup_created` requires `followup_ref`, and `dismissed_with_reason` requires a 20+ character `dismissal_reason`. A `PASS` may not carry an `unresolved` finding; `recorded` retires nothing and is confined to a `suggestion`. A fixed table decides which dispositions retire which classification — `candidate_regression` and `declared_contract_violation` accept only `fixed` or `unresolved`, and `decision_ambiguity` accepts those plus a conflict disposition but never a dismissal or follow-up — and a `conflict_id` must resolve to a conflict open at the reviewed HEAD whose conflict type matches where the classification implies one, whose `origin` is `baseline` when the classification says the problem predates the candidate, and whose affected pages overlap the finding's `page:` scope refs, which a finding declaring none cannot satisfy. `unrelated_defect` implies no type, and `decision_ambiguity` is exempt from the `origin` rule.

After local PASS, run canonical `wiki:check`, open or update the PR, and publish
that result. A new commit has no status and is blocked until the gate is rerun.
Version 2 keeps review evidence in the separate report and requires only the
semantic metadata block in the PR body. Its explicit risk selector has no
implicit all-PR fallback.

Version 1 remains compatible: `fresh_context`, authenticated actor checks,
`requiredWhen` omission, and `--reviewer-actor`/`--pr-author` retain their old
meaning. A first v1-to-v2 migration PR may carry one last legacy mirror for its
merge-base workflow; the v2 path ignores it. Local mode does not claim distinct
GitHub actor proof, so a v1 team with `requireDifferentActor: true` must not be
silently converted. Add `--json` to read/check commands for machine-readable
output.

See [WORKFLOW](../wiki/WORKFLOW.md) for the change process and [design](design.md) for why each gate exists.
