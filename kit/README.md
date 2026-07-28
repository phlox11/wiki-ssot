# wiki-ssot kit

The copy-paste distribution of wiki-ssot. Everything under `files/` and `seed/` is meant to land in **another** repository's root.

This directory is generated. Do not hand-edit it — change the real file in this repository and run `bun run wiki:kit`. CI fails when the two drift apart.

## What is in here

| Path | Meaning |
|---|---|
| `files/**` | **Kit-owned.** Copied on adoption, replaced on upgrade, so engine and enforcement improvements actually reach you. |
| `seed/**` | **Yours after the first copy.** Written only when absent, never updated, so your policy, your recorded source hashes, and your inventory implementation survive every upgrade. |
| `package.kit.json` | **Reference.** Read from this directory and merged into your `package.json`; never copied, so an upgrade cannot re-drop a file you already merged away. |
| `files/.wiki/kit-manifest.json` | The file list, a sha256 per file, and which side of the split each one is on. This is what makes an upgrade able to tell "you never touched this" from "you edited this". |

The manifest is the authoritative list — this table does not repeat it. To see exactly what you would receive:

```bash
bun -e 'const m = await Bun.file("kit/files/.wiki/kit-manifest.json").json(); console.log(`kit ${m.digest.slice(0,12)} — ${Object.keys(m.files).length} files`); for (const [p, v] of Object.entries(m.files)) console.log(`  ${v.ownership.padEnd(5)} ${p}`)'
```

The kit has no version number. Its identity is `digest` — a content hash of every file it ships. Two checkouts with the same digest hold byte-identical kits.

## Requirements

[Bun](https://bun.sh) ≥ 1.1 and git, in the target repository too.

## Adopt it in a new repository

From a checkout of this repository:

```bash
bun scripts/wiki/kit-sync.ts --into /path/to/your-repo
```

Preview without writing anything first, if you like:

```bash
bun scripts/wiki/kit-sync.ts --into /path/to/your-repo --dry-run
```

Then merge the scripts and dev dependencies into your `package.json`. This keeps everything you already had:

```bash
cd /path/to/your-repo
KIT=/path/to/wiki-ssot/kit bun -e 'const pkg = await Bun.file("package.json").json().catch(() => ({})); const add = await Bun.file(`${process.env.KIT}/package.kit.json`).json(); await Bun.write("package.json", JSON.stringify({ ...pkg, ...add, scripts: { ...pkg.scripts, ...add.scripts }, devDependencies: { ...pkg.devDependencies, ...add.devDependencies } }, null, 2) + "\n")'
bun install
```

`bun install` activates the git hooks through the `prepare` script.

Now make it yours — these are the `seed/` files, and nothing upstream will overwrite them:

- `.wiki/config.json` — set `name`, your `highRisk` globs, and the `freshContext` policy. The shipped `changedFileGlobs` covers the toolkit's own trust boundary; add your security, schema, and migration paths.
- `.wiki/coverage.json` — set `include` to the code that must always map to a page. Start narrow.
- `scripts/wiki/inventories.ts` — leave the stub until you want code-derived pages; `scripts/wiki/inventories.example.ts` has the patterns.
- `tsconfig.json` — if you already had one, keep yours and make sure `scripts/**/*.ts` is in `include`.

Then bootstrap your pages and go green:

```bash
bun run wiki:generated
bun run wiki:verify
bun run wiki:lint
bun run wiki:doctor
bun run typecheck && bun run test
```

`wiki:doctor` passes immediately — it checks that the rails arrived intact. `wiki:lint` is supposed to fail at this point, and its errors are the to-do list: first that `coverage.json`'s `include` matches nothing, then, once it does, one `coverage-unmapped` error per code file that no page claims yet. Driving that list to zero is the adoption.

Writing the first pages is the real work, and it is not a copy step. `wiki/SCHEMA.md` defines the page contract; the playbook for recompiling pages from code you already have is in this repository's [docs/adopt-existing-repo.md](../docs/adopt-existing-repo.md), starting at section 3.

One step no file can do for you: configure GitHub branch protection on `main` to require `code-check`, `wiki-structure`, `wiki-generated`, `wiki-impact`, and `wiki-review-attestation`, require branches to be current, and disallow direct pushes. Until that is set, CI is evidence, not a merge boundary.

### Without the tool

`kit-sync.ts` exists because "copy everything" is wrong for `seed/`. If you would rather do it by hand, this is the equivalent:

```bash
DEST=/path/to/your-repo
cp -R kit/files/. "$DEST"/
(cd kit/seed && find . -type f) | sed 's|^\./||' | while IFS= read -r f; do
  [ -e "$DEST/$f" ] || { mkdir -p "$DEST/$(dirname "$f")"; cp "kit/seed/$f" "$DEST/$f"; }
done
```

## Apply an upgrade

When this repository publishes a newer kit, run the same command against your already-adopted repository:

```bash
git -C /path/to/wiki-ssot pull
bun /path/to/wiki-ssot/scripts/wiki/kit-sync.ts --into /path/to/your-repo
```

It compares three versions of every kit-owned file — the incoming one, the one recorded in your `.wiki/kit-manifest.json` at your last sync, and the one on your disk — and acts per file:

| Your file | Upstream | Result |
|---|---|---|
| absent | — | `create` |
| already equals the incoming version | — | `unchanged` |
| identical to what you last synced | changed | `update` — replaced |
| edited by you | unchanged | `customized` — left alone |
| edited by you | changed | `conflict` — **never overwritten** |
| present, but you have no recorded manifest | — | `conflict` — cannot be proven pristine |

A conflict writes the incoming version beside your file as `<path>.kit-new` and leaves yours untouched. The command exits non-zero and **does not advance** your recorded manifest, so an unresolved conflict cannot quietly turn into "your customization" on the next run.

Resolve a conflict by merging and deleting the sidecar:

```bash
cd /path/to/your-repo
diff -u AGENTS.md AGENTS.md.kit-new     # or your merge tool
# ...merge by hand, then:
rm AGENTS.md.kit-new
```

Re-run the sync. When nothing is left in conflict it exits 0 and records the new digest.

Upgrades never touch `seed/` files. If upstream changes the shape of `.wiki/config.json`, that arrives as a note in this repository's `wiki/changelog.md`, not as an overwrite of your policy.

Review the result as an ordinary change — `git diff` in your repository shows exactly what moved.

## Check what you are running

Confirm an adopted repository still matches the kit it recorded:

```bash
cd /path/to/your-repo
bun -e 'const m = await Bun.file(".wiki/kit-manifest.json").json(); let bad = 0; for (const [p, v] of Object.entries(m.files)) { const f = Bun.file(p); if (!(await f.exists())) { console.log(`missing    ${p}`); bad++; continue; } const h = new Bun.CryptoHasher("sha256"); h.update(await f.text()); if (h.digest("hex") !== v.sha256) { console.log(`${v.ownership === "seed" ? "yours     " : "modified  "} ${p}`); if (v.ownership === "kit") bad++; } } console.log(bad === 0 ? `kit ${m.digest.slice(0,12)} intact` : `${bad} kit-owned file(s) diverged`)'
```

A `seed/` file showing as changed is expected — that is your configuration. A kit-owned file showing as modified means either a local edit that an upgrade will flag as a conflict, or a sync that was interrupted.
