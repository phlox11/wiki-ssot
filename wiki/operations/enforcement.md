---
id: operations/enforcement
summary: Three rails enforce the wiki — agent workflow, local hooks, and blocking CI including the trusted wiki-review-attestation check, with branch protection as the durable merge boundary.
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
- **Pre-PR semantic reconciliation.** After deterministic checks and prospective PR metadata are complete, `wiki:review-preflight` evaluates trusted risk policy before any PR exists. Low-risk candidates are ready immediately. For selected changes it emits an exact bundle for a context-isolated reviewer; the authoring agent dispositions every returned finding — fixing what this candidate broke or declared, tracking a pre-existing mismatch or undecided intent in an open conflict, recording a named follow-up for an out-of-scope defect — and reruns preflight on the new HEAD until the candidate passes or requires an explicit owner decision. Preflight rejects a disposition the finding's classification does not admit, and a conflict pointer that does not resolve to a matching open conflict, so a deferral that only looks like tracking fails before the PR exists.
- **Pull request (CI).** `.github/workflows/checks.yml` runs the structural jobs on pull requests and runs `wiki-review-attestation` only for non-Draft PRs. Required reports are attached to a Draft after local PASS, mirrored into the PR body, and then validated when the PR becomes Ready. The check name deliberately describes validation of an existing attestation; it does not perform semantic Fresh-context review in CI.
- **Fresh-context trust path.** The GitHub reference job is triggered for opened, synchronize, reopened, edited, ready-for-review, and converted-to-draft activity, but skips Drafts instead of emitting an expected failure while an attestation is being attached. For a Ready PR it runs on `pull_request` so the check attaches to the PR test-merge commit, but explicitly executes the trusted base engine/policy while treating the detached PR HEAD as data. Bun stays in the trusted working directory and receives the head only through `--root`, preventing an untrusted `bunfig.toml` preload; the job never installs or executes head code. The trusted engine classifies the actual diff using configured changed-file globs plus merge-base/HEAD affected invariants, conflicts, and current-page removals. A low-risk change records `required: false` and passes without a report. A required change reads the newest marked report from authenticated PR review/comment envelopes and rejects missing, malformed, non-PASS, stale, empty-evidence, or untrusted attestations.
- **Weekly.** `.github/workflows/wiki-audit.yml` re-runs the full audit and fails on any stale page.

When review is required, preflight makes context isolation an authoring-agent responsibility and the GitHub job proves attestation presence, authenticated actor, and exact target/freshness—not that the reviewer truly reasoned correctly. This repository uses the solo-maintainer policy `requireDifferentActor: false`, so the PR author's authenticated account may publish a report produced by a separate review context. Teams may enable actor separation only after provisioning another reviewer account or bot. Applicable required mode fails closed for Ready PRs during reviewer/API/output failures; advisory mode is an explicit configuration, never a silent fallback. Omitting `requiredWhen` preserves the legacy policy that every PR is applicable.

The durable remote boundary—required checks including `wiki-review-attestation`, current branches, and no direct pushes to `main`—is GitHub branch protection configured per repository (see [proposal/protected-main](../proposals/protected-main.md)). Base code/policy pinning stops PR-head engine/config changes from weakening the current run, but the workflow definition itself remains a bootstrap seam: protect it with a ruleset-required workflow or CODEOWNERS/required owner review. The installing PR cannot be protected by a base check that does not exist yet. Until these repository settings are active, successful CI is evidence rather than a complete merge guardrail.

Renaming a required check is a no-gap migration, not a tracked-file-only edit. First push the candidate while the old context remains required and confirm the new context succeeds on the exact HEAD. Then update branch protection to require both old and new contexts, preserving strict mode and every unrelated required context. Remove the old context only after re-reading protection and confirming the new successful context is bound; finally verify strict mode, the complete required-context set, and the PR merge state again. The PR may remain temporarily blocked by the obsolete context during this sequence, but it is never temporarily less protected.
