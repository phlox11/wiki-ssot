<!-- wiki-ssot:managed:start -->
<!-- wiki-ssot:managed:version=2 -->
<!-- wiki-ssot:rule id=authority-current-pages -->
## Wiki SSOT authority

- Start at wiki/index.md, then read wiki/current-status.md and every current kind: invariant page before editing.
- Current pages linked from wiki/index.md define current product intent, architecture, contracts, invariants, and operations.
- Code, tests, schemas, and migrations are implementation evidence; record a conflict when evidence and current wiki disagree.
- Proposed, conflicted, deprecated, and archived pages are not current behavior.

<!-- wiki-ssot:rule id=work-discovery -->
## Work discovery

- For an unspecified remaining-work request, run bun run wiki:work before selecting a work item.
- After selecting an item, run its printed bun run wiki:context -- --work <ID> command.
- Dependency derivation happens before executor filtering, and human-only work is never auto-selected.

<!-- wiki-ssot:rule id=context-first -->
## Topic context

- Start a named topic with bun run wiki:context -- "<task terms>".
- bun run wiki:search remains available for optional manual exploration and is not a required prerequisite.

<!-- wiki-ssot:rule id=source-read-order -->
## Source evidence

- Read affected current pages and their context: always sources directly; expand context: catalog sources when the task or evidence requires them.
- Do not rely on a compact wiki summary as a substitute for the listed implementation evidence.

<!-- wiki-ssot:rule id=change-and-generated-checks -->
## Change and generated checks

- Change wiki, implementation, and tests together when behavior or intent changes.
- Regenerate deterministic artifacts, then run the canonical lint, impact, typecheck, and relevant tests.

<!-- wiki-ssot:rule id=review-exact-head -->
## Exact revision review

- Commit the candidate before review so metadata, sources, report, and bundle bind one exact HEAD.
- Run bun run wiki:review-preflight before the canonical local check and independent review.
- A required review is independent SSOT reconciliation; the authoring session never marks its own work PASS.
- Run wiki:check and publish its exact result through the wiki-ssot/local status boundary.
- Detailed workflow and migration steps live in wiki/WORKFLOW.md.

<!-- wiki-ssot:rule id=conflict-resolution -->
## Conflict and schema safety

- Follow wiki/SCHEMA.md and keep stable IDs path-independent.
- A missing or ambiguous product decision is an open conflict, not permission to invent behavior.
- Never resolve an open decision conflict without an explicit owner decision.

<!-- wiki-ssot:rule id=human-work-guardrail -->
## Human work guardrail

- Do not automatically select executor: human work.
- Report the required procedure and hand it off to a human without assuming credentials, authority, or permissions.

<!-- wiki-ssot:rule id=git-safety -->
## Git and safety

- Work on a feature branch and preserve unrelated changes.
- Do not bypass checks or use destructive Git operations to make a change appear valid.

<!-- wiki-ssot:managed:end -->
