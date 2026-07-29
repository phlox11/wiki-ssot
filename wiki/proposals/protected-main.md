---
id: proposal/protected-main
summary: Archived workflow-protection proposal superseded by the owner decision to trust repository developers and leave organization security to deployments.
kind: proposal
status: archived
authority: normative
owners: ["@phlox11"]
sources:
  - path: .github/workflows/checks.yml
related: [operations/enforcement]
tags: [proposal, github, branch-protection]
---

# Protected main (archived)

The original proposal would have protected `.github/workflows/checks.yml` with a ruleset-required workflow or CODEOWNERS plus required owner review, alongside strict required checks and administrator-bypass restrictions.

The owner decided not to make organization-level security part of wiki-ssot. The current product contract trusts repository write/admin actors not to rewrite validation or weaken repository settings. Deployments remain free to add branch protection, required workflows, CODEOWNERS, and other governance, but the toolkit does not require, configure, or audit those controls. The accepted boundary is current in [product/scope](../product/scope.md) and [operations/enforcement](../operations/enforcement.md).
