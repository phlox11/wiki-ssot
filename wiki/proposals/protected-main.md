---
id: proposal/protected-main
summary: Proposed GitHub branch-protection ruleset for main — the durable remote boundary that closes direct pushes and the cross-PR merge-race once activated per repository.
kind: proposal
status: proposed
authority: normative
owners: ["@phlox11"]
sources:
  - path: .github/workflows/checks.yml
related: [operations/enforcement]
tags: [proposal, github, branch-protection]
---

# Protected main (proposal)

Local hooks and CI are bypassable. The durable remote boundary is a GitHub branch-protection ruleset on `main`. Configure it in **Settings → Rules → Rulesets → New branch ruleset**, targeting `main`:

- Enforcement status **Active**, with an **empty bypass list** so the rules apply to everyone, including administrators.
- **Require a pull request before merging.**
- **Require status checks:** `code-check`, `wiki-structure`, `wiki-generated`, `wiki-impact`, and `wiki-fresh-context`. A check only appears in the list after it has run once.
- **Require branches to be up to date before merging** — this forces a second PR to rebase onto the just-merged `main` and re-run CI, catching cross-PR interactions before merge.
- Protect `.github/workflows/checks.yml` with a ruleset-required workflow where available, or CODEOWNERS plus required owner review. The Fresh-context job pins its engine and policy to base, but a `pull_request` workflow definition is still a PR-editable bootstrap seam.
- **Block force pushes** and **restrict deletions**.

This page stays `status: proposed` until a repository shows the ruleset active. Tracked workflow files cannot prove or activate repository settings; without the required-check ruleset, even a successful `wiki-fresh-context` run is not a merge guardrail. Organization-owned private repositories require a plan that enforces rulesets (for example GitHub Team); until then `main` is protected only by the honor system and the local hooks described in [operations/enforcement](../operations/enforcement.md).
