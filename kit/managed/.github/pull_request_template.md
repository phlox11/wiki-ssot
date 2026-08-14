<!-- wiki-ssot:managed:start -->
## Wiki metadata

```yaml
change_type: feature
semantic_change: true
wiki_action: update
affected_pages: []
affected_invariants: []
touched_conflicts: []
```

Run `wiki:review-preflight` before opening this PR. Version 2 keeps review evidence in the exact report rather than mirroring it into editable PR text.

## Verification

- [ ] `bun run wiki:lint`
- [ ] `bun run wiki:doctor`
- [ ] `bun run wiki:impact -- --base origin/main` reviewed
- [ ] Generated files refreshed (`bun run wiki:generated`)
- [ ] Relevant typecheck/tests pass
- [ ] Pre-PR `wiki:review-preflight` returned `pass` or `not-required`
- [ ] Canonical `wiki:check --output` passed for the committed PR HEAD
- [ ] `wiki:publish` posted the configured local-status context for the current PR HEAD
<!-- wiki-ssot:managed:end -->
