## Summary

<!-- What changed, and why? -->

## Wiki metadata

```yaml
change_type: feature
semantic_change: true
wiki_action: update
affected_pages: []
affected_invariants: []
touched_conflicts: []
fresh_context:
  verdict: PENDING
  reviewed_head_sha: ""
  bundle_digest: ""
  reviewer: ""
  evidence: []
```

`fresh_context` is a machine-validated status mirror. When trusted policy reports `required: true`, a reviewer must publish the structured report through the trusted PR review/comment channel using `<!-- wiki-ssot:fresh-context-attestation -->`; the mirror is not an independent attestation.

## Verification

- [ ] `bun run wiki:lint`
- [ ] `bun run wiki:doctor`
- [ ] `bun run wiki:impact -- --base origin/main` reviewed
- [ ] Generated files refreshed (`bun run wiki:generated`)
- [ ] Relevant typecheck/tests pass
- [ ] `wiki-fresh-context` records `required: false` or validates PASS for the current PR HEAD and bundle digest
