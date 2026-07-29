# wiki-ssot kit

The copy-paste distribution of wiki-ssot. Everything under `files/` and `seed/` is meant to land in **another** repository's root.

Everything in this directory except this README is generated — change the real file in the repository above and run `bun run wiki:kit`; CI fails when the two drift apart. This README is hand-maintained and is not covered by that check.

## What is in here

| Path | Meaning |
|---|---|
| `files/**` | **Kit-owned.** Copied on adoption, replaced on upgrade, so engine and enforcement improvements actually reach you. |
| `seed/**` | **Yours after the first copy.** Written only when absent, never updated, so your policy, your recorded source hashes, your inventory implementation, and your `tsconfig.json` survive every upgrade. |
| `package.kit.json`, `scripts/wiki/inventories.example.ts` | **Reference.** Read from this directory, never copied. Seed placement would not do: "seed" means "written when absent", so anything you merged away or deleted on purpose would come straight back on the next upgrade. |
| `files/.wiki/kit-manifest.json` | A sha256 per file, which side of the split it is on, and a roll-up `digest`. This is what lets an upgrade tell "you never touched this" from "you edited this". |

The manifest is the authoritative list — this table does not repeat it. To see exactly what you would receive:

```bash
bun -e 'const m = await Bun.file("kit/files/.wiki/kit-manifest.json").json(); console.log(`kit ${m.digest.slice(0,12)}`); for (const [p, v] of Object.entries(m.files)) console.log(`  ${v.ownership.padEnd(9)} ${p}`); for (const p of Object.keys(m.reference)) console.log(`  reference ${p}`)'
```

The kit has no version number. Its identity is `digest`, a content hash over every file it ships — the copied ones and the reference one alike. Two checkouts with the same digest hold byte-identical kits.

## Requirements

[Bun](https://bun.sh) ≥ 1.1 and git, in the target repository too.

## Adopt it in a new repository

From a checkout of this repository:

```bash
bun scripts/wiki/kit-sync.ts --into /path/to/your-repo --dry-run
bun scripts/wiki/kit-sync.ts --into /path/to/your-repo
```

If your repository already has an `AGENTS.md`, a PR template, or anything else the kit ships, the first run reports those as conflicts and writes the incoming version alongside as `<path>.kit-new` rather than overwriting you. That is expected — see [Apply an upgrade](#apply-an-upgrade) for how to settle them.

Then merge the scripts and dev dependencies into your `package.json`. This keeps your `type`, your `engines`, your dependency pins, and any script name you already use — it reports collisions instead of taking them:

```bash
cd /path/to/your-repo
KIT=/path/to/wiki-ssot/kit bun -e '
const pkg = await Bun.file("package.json").json().catch(() => ({}));
const add = await Bun.file(`${process.env.KIT}/package.kit.json`).json();
const scripts = { ...pkg.scripts }, kept = [], added = [];
for (const [name, value] of Object.entries(add.scripts)) {
  if (scripts[name] != null && scripts[name] !== value) kept.push(name);
  else { scripts[name] = value; added.push(name); }
}
await Bun.write("package.json", JSON.stringify({
  ...pkg,
  type: pkg.type ?? add.type,
  engines: { ...add.engines, ...pkg.engines },
  scripts,
  devDependencies: { ...add.devDependencies, ...pkg.devDependencies },
}, null, 2) + "\n");
console.log("added:", added.join(" ") || "(none)");
console.log("kept yours:", kept.join(" ") || "(none)");
'
bun install
```

Whatever it prints under **kept yours** is now your job: those scripts exist in your repository and the kit did not touch them. In practice this is `test`, `typecheck`, and `prepare`. Your CI runs `bun run typecheck` and `bun run test`, so make sure yours also cover `scripts/wiki/**` — the engine ships its own regression suite and it needs to run.

`bun install` activates the git hooks through the `prepare` script. If `prepare` was kept, run `bunx husky` once yourself.

Now make it yours — these are the `seed/` files, and nothing upstream will overwrite them:

- `.wiki/config.json` — set `name`, your `highRisk` globs, and the `freshContext` policy. The shipped `changedFileGlobs` covers the toolkit's own trust boundary; add your security, schema, and migration paths.
- `.wiki/coverage.json` — set `include` to the code that must always map to a page. Start narrow.
- `scripts/wiki/inventories.ts` — leave the stub until you want code-derived pages. The patterns live in `kit/scripts/wiki/inventories.example.ts` in this checkout; it is never copied into your repository, so there is nothing to delete afterwards.
- `tsconfig.json` — if you already had one, yours was kept. If this became yours, add your own source globs to `include`; as shipped it typechecks only `scripts/**`, so CI would pass while never looking at your `src/`.

Then bootstrap your pages and go green:

```bash
bun run wiki:generated
bun run wiki:verify
bun run wiki:lint
bun run wiki:doctor
bun run wiki:work
bun run typecheck && bun run test
```

`wiki:doctor` passes immediately — it checks that the rails arrived intact. `wiki:work` also succeeds with "No remaining work" until you add proposal work records; later it becomes the no-query entrypoint for generic remaining-work requests. `wiki:lint` is supposed to fail at this point, and its errors are the to-do list: first that `coverage.json`'s `include` matches nothing, then, once it does, one `coverage-unmapped` error per code file that no page claims yet. Driving that list to zero is the adoption.

Writing the first pages is the real work, and it is not a copy step. `wiki/SCHEMA.md` defines the page contract; the playbook for recompiling pages from code you already have is in this repository's [docs/adopt-existing-repo.md](../docs/adopt-existing-repo.md), starting at section 3.

One step no file can do for you: configure GitHub branch protection on `main` to require `code-check`, `wiki-structure`, `wiki-generated`, `wiki-impact`, and `wiki-review-attestation`, require branches to be current, and disallow direct pushes. Until that is set, CI is evidence, not a merge boundary.

Setting it is still not a complete boundary, and it is worth knowing why. Branch protection matches on check name, not on what the check does, and for a `pull_request` event GitHub runs the workflow file from the PR's own merge tree. So a PR can leave `wiki-review-attestation` in place as a job name, empty its steps, and go green without validating anything. The attestation engine is not the weak point — the `wiki-review-attestation` job checks out the base commit and passes the PR head in only as data — but the job that says so lives in a file a PR can rewrite. Close it by protecting `.github/workflows/checks.yml`: a ruleset-required workflow where available, which depends on who owns the repository and on its plan, otherwise CODEOWNERS plus required owner review, which needs a second account because GitHub does not let you approve your own pull request.

### Without the tool

`kit-sync.ts` exists because "copy everything" is wrong for `seed/`, and because overwriting a file you edited is wrong for `files/`. If you would rather do the first copy by hand, into a repository that has none of these files yet:

```bash
DEST=/path/to/your-repo
cp -R kit/files/. "$DEST"/
(cd kit/seed && find . -type f) | sed 's|^\./||' | while IFS= read -r f; do
  [ -e "$DEST/$f" ] || { mkdir -p "$DEST/$(dirname "$f")"; cp "kit/seed/$f" "$DEST/$f"; }
done
```

There is no by-hand equivalent for an upgrade. Use the tool.

## Apply an upgrade

When this repository publishes a newer kit, run the same command against your already-adopted repository:

```bash
git -C /path/to/wiki-ssot pull
bun /path/to/wiki-ssot/scripts/wiki/kit-sync.ts --into /path/to/your-repo
```

For every kit-owned file it compares three versions — the incoming one, the one recorded in your `.wiki/kit-manifest.json` at your last sync, and the one on your disk:

| Your file | Upstream | Result |
|---|---|---|
| absent | — | `create` |
| byte-identical to the incoming version | — | `unchanged` |
| identical to what you last synced | changed | `update` — replaced |
| edited by you | unchanged | `customized` — left alone |
| edited by you | changed | `conflict` — **never overwritten** |
| differs, and you have no recorded manifest | — | `conflict` — cannot be proven pristine |
| a symlink | — | `conflict` — never written through |

Two more outcomes are not about your edits: `seed-created` / `seed-present` for `seed/` files, and `removed-upstream` for a file an older kit shipped and this one no longer does. A removal is **reported once and then forgotten** — the file is yours now, and deleting things in your repository is not this tool's call.

A conflict writes the incoming version beside your file as `<path>.kit-new`, leaves yours untouched, and exits non-zero. Everything that did not conflict is still applied, and the manifest advances for exactly those files — one stuck conflict never blocks the rest.

Resolve a conflict by merging and telling the tool you did:

```bash
cd /path/to/your-repo
diff -u AGENTS.md AGENTS.md.kit-new     # or your merge tool
# ...merge by hand, then:
rm AGENTS.md.kit-new
bun /path/to/wiki-ssot/scripts/wiki/kit-sync.ts --into . --accept AGENTS.md
```

`--accept` is required and not cosmetic. A hand-merged file matches neither the incoming version nor the recorded one, so nothing about it can be inferred; `--accept` records the incoming hash without touching your file, which turns it into an ordinary `customized` from then on. Without it the file would re-conflict on every future run. Pass `--accept` once per resolved path — the tool prints the exact flags for you.

To take upstream's version instead, `mv AGENTS.md.kit-new AGENTS.md` and re-run; it becomes `unchanged`.

Upgrades never touch `seed/` files. If upstream changes the shape of `.wiki/config.json`, that arrives as a note in this repository's `wiki/changelog.md`, not as an overwrite of your policy. Dependencies and scripts arrive through `package.kit.json`, which is never copied either — when the digest moves, re-run the merge command above.

Review the result as an ordinary change — `git diff` in your repository shows exactly what moved.

## Check what you are running

Confirm an adopted repository still matches the kit it recorded:

```bash
cd /path/to/your-repo
bun -e 'const m = await Bun.file(".wiki/kit-manifest.json").json(); let bad = 0; for (const [p, v] of Object.entries(m.files)) { const f = Bun.file(p); if (!(await f.exists())) { console.log(`missing    ${p}`); if (v.ownership === "kit") bad++; continue; } const h = new Bun.CryptoHasher("sha256"); h.update(await f.text()); if (h.digest("hex") !== v.sha256) { console.log(`${v.ownership === "seed" ? "yours     " : "modified  "} ${p}`); if (v.ownership === "kit") bad++; } } console.log(bad === 0 ? `kit ${m.digest.slice(0,12)} intact` : `${bad} kit-owned file(s) diverged`)'
```

A `seed/` file showing as changed is expected — that is your configuration. A kit-owned file showing as modified means an edit that the next upgrade will surface as a conflict, or one you resolved with `--accept`, which is the same thing recorded deliberately.
