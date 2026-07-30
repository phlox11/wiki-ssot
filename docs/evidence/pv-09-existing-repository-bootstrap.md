# PV-09 existing-repository bootstrap evidence

Run the deterministic reproduction with:

```sh
bun test scripts/wiki/existing-repo-bootstrap.test.ts
```

The test creates a temporary git repository rather than relying on a developer's
machine or an external service. Its baseline deliberately contains:

- separate billing and delivery code areas;
- an existing `AGENTS.md`, `package.json`, and `tsconfig.json`;
- an implementation/contract mismatch in the delivery area; and
- generated code that belongs in coverage but has a specific reason for
  exclusion.

## Bootstrap path

The fixture performs the documented existing-repository flow:

1. Sync the generated kit and prove the existing `AGENTS.md` is preserved as a
   conflict rather than overwritten.
2. Hand-merge that file, accept it explicitly, and merge the package fragment
   while retaining the host package identity, engine constraint, dependency
   pin, and test responsibility.
3. Compile two small current pages from the billing and delivery sources.
4. Record the pre-existing delivery disagreement as open conflict `C-501`
   without changing either implementation source.
5. Configure coverage over `src/**/*.ts`, mapping both maintained areas to
   current pages and excluding only `src/generated/**` with a reason longer than
   the enforced minimum.
6. Generate indexes and maps, record source verification state, and assert
   structure, generated freshness, coverage, integration seams, and state
   validation are green.

The source-map assertions enumerate every non-excluded covered file. The
generated client is also asserted to have no page mapping, so its success
depends on the explicit exclusion rather than an accidental broad source glob.

## Initial reconciliation boundary

The bootstrap is committed over the untouched existing-repository baseline. A
version 2 Fresh-context report then classifies the `accepted` versus `queued`
disagreement as a `preexisting_implementation_mismatch` and dispositions it with
`conflict_introduced: C-501`.

The test proves that:

- the conflict has `origin: baseline`, type `implementation`, an overlapping
  current page, primary sources, and closable acceptance criteria;
- the prospective metadata declares the new conflict and both current pages;
- impact has no deterministic finding; and
- review validation returns PASS while the candidate diff still contains no
  delivery implementation change.

This is the intended bootstrap boundary: record pre-existing mismatch precisely
instead of expanding the first wiki candidate into an unrelated behavior fix.

## Upgrade preservation

The fixture next stages a content-addressed kit update that changes:

- an untouched kit-owned `wiki/README.md`;
- a locally customized kit-owned `AGENTS.md`; and
- upstream versions of `.wiki/config.json`, `.wiki/coverage.json`,
  `.wiki/state.json`, and `scripts/wiki/inventories.ts`.

The clean kit-owned file updates. The customized `AGENTS.md` conflicts, is
hand-merged, and becomes a stable `customized` result only after explicit
acceptance. Every seed file remains byte-identical to its pre-upgrade snapshot.
This binds the preservation claim to adopter-owned policy, coverage policy,
recorded verification state, project inventory implementation, and local
entrypoint customization in one reproducible lifecycle.
