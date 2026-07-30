---
id: operations/enforcement
summary: Three rails enforce the wiki within a trusted-maintainer boundary — zero-knowledge agent entry, local hooks, and deterministic CI including the wiki-review-attestation check.
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
  - path: .github/workflows/kit.yml
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

Enforcement is attached to events that always happen. Semantic review is external; the Ready-only validation of its attestation is deterministic.

- **Session start.** Every agent reads `AGENTS.md`. A generic remaining, unfinished, or next-work request runs `wiki:work` without asking for a search term or internal ID; only returned active or ready work may be selected automatically, and the printed `wiki:context -- --work <ID>` command supplies the exact work contract plus an invariant → conflict → current-page → expanded-source read order. Every page is authority-labelled with exact sources, deterministic glob matches, and relevant open conflicts; the proposal owner is separated as non-current rationale. Topic-specific work continues through search and context.
- **Local commit.** `.husky/pre-commit` runs `wiki:lint --staged`; `.husky/pre-push` blocks direct pushes to `main`. Hooks are bypassable feedback, not a security boundary.
- **Pre-PR semantic reconciliation.** After deterministic checks and prospective PR metadata are complete, `wiki:review-preflight` evaluates trusted risk policy before any PR exists. Low-risk candidates are ready immediately. For selected changes it emits an exact bundle for a context-isolated reviewer; the authoring agent dispositions every returned finding — fixing what this candidate broke or declared, tracking a pre-existing mismatch or undecided intent in an open conflict, recording a named follow-up for an out-of-scope defect — and reruns preflight on the new HEAD until the candidate passes or requires an explicit owner decision. Preflight rejects a disposition the finding's classification does not admit, and a conflict pointer that does not resolve to a matching open conflict, so a deferral that only looks like tracking fails before the PR exists.
- **Pull request (CI).** `.github/workflows/checks.yml` runs the structural jobs on pull requests and runs `wiki-review-attestation` only for non-Draft PRs. Required reports are attached to a Draft after local PASS, mirrored into the PR body, and then validated when the PR becomes Ready. The check name deliberately describes validation of an existing attestation; it does not perform semantic Fresh-context review in CI.
- **Fresh-context trust path.** The GitHub reference job is triggered for opened, synchronize, reopened, edited, ready-for-review, and converted-to-draft activity, but skips Drafts instead of emitting an expected failure while an attestation is being attached. For a Ready PR it runs on `pull_request` so the check attaches to the PR test-merge commit, but explicitly executes the trusted base engine/policy while treating the detached PR HEAD as data. Bun stays in the trusted working directory and receives the head only through `--root`, preventing an untrusted `bunfig.toml` preload; the job never installs or executes head code. The trusted engine classifies the actual diff using configured changed-file globs plus merge-base/HEAD affected invariants, conflicts, and current-page removals. A low-risk change records `required: false` and passes without a report. A required change reads the newest marked report from authenticated PR review/comment envelopes and rejects missing, malformed, non-PASS, stale, empty-evidence, or untrusted attestations.
- **Kit freshness.** `.github/workflows/kit.yml` runs `wiki:kit --check` and fails when the published `kit/**` distribution drifts from the files it is generated from. It is a separate workflow on purpose: `checks.yml` is itself part of the kit payload and runs in every adopting repository, where no `kit/` directory exists.
- **Weekly.** `.github/workflows/wiki-audit.yml` re-runs the full audit and fails on any stale page.

This publishing repository's changed-file selector explicitly requires Fresh-context reconciliation for `wiki/product/scope.md` and its declared sources, `README.md` and `docs/design.md`. Those instance-specific paths do not belong to the generated downstream seed policy: an adopter's `.wiki/config.json` remains project-owned and names the contract paths for that repository.

`wiki:doctor` treats work discovery as its own installation seam. It fails with stable findings when the root `wiki-ssot:work-discovery` marker, the literal `bun run wiki:work` command token, or the canonical `wiki:work` package script disappears. This presence check does not prove that the surrounding generic-request prose remains meaningful; rejecting marker-plus-command placeholders is a stronger integration contract left to the pending entrypoint-hardening work. It also does not claim the engine classifies natural language or that an agent followed the result.

When review is required, preflight makes context isolation an authoring-agent responsibility and the GitHub job proves attestation presence, authenticated actor, and exact target/freshness—not that the reviewer truly reasoned correctly. This repository uses the solo-maintainer policy `requireDifferentActor: false`, so the PR author's authenticated account may publish a report produced by a separate review context. Teams may enable actor separation only after provisioning another reviewer account or bot. Applicable required mode fails closed for Ready PRs during reviewer/API/output failures; advisory mode is an explicit configuration, never a silent fallback. Omitting `requiredWhen` preserves the legacy policy that every PR is applicable.

The reference integration assumes that repository developers and administrators are trusted. Base code/policy pinning prevents an ordinary PR head from substituting its engine or configuration during validation, but `.github/workflows/checks.yml` remains an editable bootstrap seam: an actor allowed to rewrite the workflow can preserve a required job name while removing its validation. Defending against that actor through required workflows, CODEOWNERS, rulesets, administrator-bypass restrictions, force-push policy, or deletion policy is organization-level governance outside the product contract. Deployments may add those controls, but wiki-ssot neither requires nor audits them. Successful CI is therefore evidence—and, where deployment policy makes it blocking, a merge guardrail—within the trusted-maintainer model, not a security guarantee against a hostile or compromised maintainer.
