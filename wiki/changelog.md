# Changelog

Record only current-contract changes here: product-contract changes, significant architecture decisions, invariant changes, large reconciles, and schema or process changes. Git remains the source of truth for ordinary change history.

- Initial wiki established: engine, enforcement rails, and the self-describing pages.
- Fresh-context reconciliation promoted from advisory prose to a required, HEAD/bundle-bound attestation guard with explicit reviewer trust policy, downstream integration checks, and trusted GitHub reference enforcement.
- Fresh-context actor separation made deployment-specific: solo repositories may use the PR author's authenticated publisher for a separate session's report, while teams can require a distinct reviewer actor.
- Fresh-context review made risk-selectable from trusted changed-file, invariant, conflict, and current-page-removal signals while preserving all-PR behavior for existing configurations.
- Fresh-context reconciliation moved before PR creation through `wiki:review-preflight`; Drafts now skip the expected attestation failure, findings must be actionable, and merge-base invariant risk signals survive kind changes.
