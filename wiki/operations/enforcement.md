---
id: operations/enforcement
summary: Three rails enforce the wiki — the agent entrypoint on every session, local git hooks on every commit and push, and blocking CI jobs plus a weekly audit on the repository.
kind: operation
status: current
authority: normative
owners: ["@phlox11"]
sources:
  - path: .github/workflows/checks.yml
  - path: .github/workflows/wiki-audit.yml
  - path: .husky/pre-commit
  - path: .husky/pre-push
  - path: scripts/wiki/core.ts
related: [architecture/engine, product/invariants]
tags: [enforcement, ci, hooks]
---

# Enforcement

Enforcement is deterministic and attached to events that always happen.

- **Session start.** Every agent reads `AGENTS.md`, which points at the wiki entrypoint, the required workflow, and the commands.
- **Local commit.** `.husky/pre-commit` runs `wiki:lint --staged`; `.husky/pre-push` blocks direct pushes to `main`. Hooks are bypassable feedback, not a security boundary.
- **Pull request (CI).** `.github/workflows/checks.yml` runs four jobs that block the merge on any error finding: `code-check` (typecheck + tests), `wiki-structure` (`wiki:lint`), `wiki-generated` (`wiki:generated --check`), and `wiki-impact` (`wiki:impact --enforce`: PR metadata, conflict lifecycle, source staleness, coverage, and unmapped high-risk sources).
- **Weekly.** `.github/workflows/wiki-audit.yml` re-runs the full audit and fails on any stale page.

The durable remote boundary — required checks and no direct pushes to `main` — is GitHub branch protection, configured per repository (see [proposal/protected-main](../proposals/protected-main.md)). Until it is active, `main` is protected only by the honor system and the local hooks.
