---
id: operations/enforcement
summary: Three rails enforce the wiki — agent workflow, local hooks, and blocking CI including a trusted Fresh-context attestation check, with branch protection as the durable merge boundary.
kind: operation
status: current
authority: normative
owners: ["@phlox11"]
sources:
  - path: .wiki/config.json
  - path: AGENTS.md
  - path: package.json
  - path: .github/pull_request_template.md
  - path: .github/workflows/checks.yml
  - path: .github/workflows/wiki-audit.yml
  - path: .husky/pre-commit
  - path: .husky/pre-push
  - path: scripts/wiki/core.ts
  - path: scripts/wiki/cli.ts
  - path: scripts/wiki/github-attestation.ts
related: [architecture/engine, product/invariants]
tags: [enforcement, ci, hooks]
---

# Enforcement

Enforcement is attached to events that always happen. Semantic review is external; the blocking validation of its attestation is deterministic.

- **Session start.** Every agent reads `AGENTS.md`, which points at the wiki entrypoint, the required workflow, and the commands.
- **Local commit.** `.husky/pre-commit` runs `wiki:lint --staged`; `.husky/pre-push` blocks direct pushes to `main`. Hooks are bypassable feedback, not a security boundary.
- **Pull request (CI).** `.github/workflows/checks.yml` runs five stable jobs: `code-check` (typecheck + tests), `wiki-structure` (`wiki:lint` + `wiki:doctor`), `wiki-generated` (`wiki:generated --check`), `wiki-impact` (`wiki:impact --enforce`), and `wiki-fresh-context`.
- **Fresh-context trust path.** The GitHub reference job is triggered for opened, synchronize, reopened, edited, and ready-for-review activity. It runs on `pull_request` so the check attaches to the PR test-merge commit, but explicitly executes the trusted base engine/policy while treating the detached PR HEAD as data. Bun stays in the trusted working directory and receives the head only through `--root`, preventing an untrusted `bunfig.toml` preload; the job never installs or executes head code. It reads the newest marked report from authenticated PR review/comment envelopes and rejects missing, malformed, non-PASS, stale, empty-evidence, or untrusted attestations. Mirroring a newly published report into the PR body triggers `edited`; Drafts may remain pending/red, while Ready/merge requires current PASS.
- **Weekly.** `.github/workflows/wiki-audit.yml` re-runs the full audit and fails on any stale page.

The job proves attestation presence, authenticated actor, and exact target/freshness—not that the reviewer truly had an isolated context or reasoned correctly. That remains the reviewer/orchestrator trust boundary. This repository uses the solo-maintainer policy `requireDifferentActor: false`, so the PR author's authenticated account may publish a report produced by a separate review session. Teams may enable actor separation only after provisioning another reviewer account or bot. Required mode fails closed during reviewer/API/output failures; advisory mode is an explicit configuration, never a silent fallback.

The durable remote boundary—required checks including `wiki-fresh-context`, current branches, and no direct pushes to `main`—is GitHub branch protection configured per repository (see [proposal/protected-main](../proposals/protected-main.md)). Base code/policy pinning stops PR-head engine/config changes from weakening the current run, but the workflow definition itself remains a bootstrap seam: protect it with a ruleset-required workflow or CODEOWNERS/required owner review. The installing PR cannot be protected by a base check that does not exist yet. Until these repository settings are active, successful CI is evidence rather than a complete merge guardrail.
