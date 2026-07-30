# PV-16 recursive wiki-engine boundary

PV-05 measured a real publishing-repository escape at immutable engine revision
`58869b75dc23374b918a79d9731c601764018ead`: the one-level
`scripts/wiki/*.ts` coverage and current-page source declarations did not include
`scripts/wiki/parsers/edge.ts` or its nested test, and a code-only probe passed
both structural lint and enforced impact. That historical report remains
unchanged.

PV-16 closes the current publishing boundary without changing the engine's glob
semantics:

- `.wiki/coverage.json` and `architecture/engine` declare
  `scripts/wiki/**/*.ts`, covering maintained TypeScript implementation and test
  files at every depth.
- `.wiki/config.json` uses `scripts/wiki/**` for both high-risk staleness and
  Fresh-context changed-file selection.
- the generated source map expands the recursive architecture declaration, and
  the downstream kit retains its existing recursive `scripts/wiki/**`
  Fresh-context selector while leaving adopter coverage and domain risk policy
  adopter-owned.

`scripts/wiki/publisher-boundary.test.ts` binds those repository surfaces
together. It checks nested implementation, nested test, and deeper implementation
paths against coverage, source mapping, high-risk classification, publisher
review selection, and the generated downstream seed. Its two temporary Git
repository probes then change `scripts/wiki/parsers/edge.ts` and
`scripts/wiki/parsers/edge.test.ts` independently. Structural lint remains green
because both files are valid mapped sources, while `wiki:impact --enforce` fails
with high-risk stale verification until `architecture/engine` is explicitly
verified. The two deterministic gates can therefore no longer both pass a
code-only nested wiki-engine change.
