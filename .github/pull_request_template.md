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

`fresh_context` is a machine-validated status mirror. It is not an independent attestation: a reviewer must publish the structured report through the trusted PR review/comment channel using `<!-- wiki-ssot:fresh-context-attestation -->`.

## Verification

- [ ] `bun run wiki:lint`
- [ ] `bun run wiki:doctor`
- [ ] `bun run wiki:impact -- --base origin/main` reviewed
- [ ] Generated files refreshed (`bun run wiki:generated`)
- [ ] Relevant typecheck/tests pass
- [ ] `wiki-fresh-context` passes for the current PR HEAD and bundle digest
