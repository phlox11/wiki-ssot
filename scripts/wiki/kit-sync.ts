#!/usr/bin/env bun
/**
 * Copy the wiki-ssot kit into another repository, or bring an already-adopted
 * repository up to date with a newer kit.
 *
 * Run it from a checkout of wiki-ssot, pointing at the target repository:
 *
 *   bun scripts/wiki/kit-sync.ts --into /path/to/your-repo
 *   bun scripts/wiki/kit-sync.ts --into /path/to/your-repo --dry-run
 *   bun scripts/wiki/kit-sync.ts --into /path/to/your-repo --accept AGENTS.md
 *
 * The point of the tool is that an upgrade must not treat "you never touched
 * this file" and "you edited this file" the same way. It compares three
 * versions of every kit-owned file — the one in the new kit, the one recorded
 * in the target's `.wiki/kit-manifest.json` from its last sync, and the one on
 * disk — and decides per file:
 *
 *   local absent                          -> create
 *   local == incoming                     -> unchanged   (nothing to do)
 *   local is a symlink                    -> conflict    (never written through)
 *   local != incoming, no recorded        -> conflict    (cannot prove it pristine)
 *   local == recorded, kit moved          -> update      (safe to replace)
 *   local != recorded, kit did not move   -> customized  (your edit, left alone)
 *   local != recorded, kit moved          -> conflict    (both moved)
 *
 * A conflict writes the incoming version beside the file as `<path>.kit-new`
 * and leaves the original untouched.
 *
 * Two properties make the loop terminate, and both are load-bearing:
 *
 *  - The recorded manifest advances PER FILE. Every file actually applied gets
 *    its incoming hash recorded; only conflicting entries keep their old hash.
 *    A single stuck conflict must not freeze the whole manifest, or every later
 *    clean update would be misread as a conflict against a stale baseline.
 *  - Resolving a conflict is explicit. After merging by hand the file matches
 *    neither the incoming nor the recorded version, so nothing about it can be
 *    inferred; `--accept <path>` records the incoming hash without touching the
 *    file, which turns it into an ordinary `customized` from then on.
 *
 * Seed files (`kit/seed/**`) are written only when absent and are never
 * updated, so project policy, recorded source hashes, and a project-specific
 * inventory implementation survive every upgrade.
 *
 * This script is intentionally standalone — it must run against a repository
 * that does not have this engine installed yet, so it imports nothing.
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const MANIFEST_TARGET = ".wiki/kit-manifest.json";

export type KitOwnership = "kit" | "seed";
export type KitManifestEntry = { sha256: string; ownership: KitOwnership };
export type KitManifest = {
  version: number;
  kit: string;
  digest: string;
  files: Record<string, KitManifestEntry>;
};

export type SyncAction =
  | "create"
  | "unchanged"
  | "update"
  | "customized"
  | "conflict"
  | "resolved"
  | "removed-upstream"
  | "seed-created"
  | "seed-present";

export type SyncEntry = { target: string; ownership: KitOwnership; action: SyncAction };

export type SyncPlan = {
  digest: string;
  entries: SyncEntry[];
  conflicts: string[];
  /** What `.wiki/kit-manifest.json` becomes: incoming hashes except for conflicts. */
  nextManifest: KitManifest;
};

export function sha256(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

function isManifest(value: unknown): value is KitManifest {
  if (value == null || typeof value !== "object") return false;
  const files = (value as KitManifest).files;
  if (files == null || typeof files !== "object") return false;
  return Object.values(files).every((entry) => entry != null && typeof entry === "object" && typeof (entry as KitManifestEntry).sha256 === "string");
}

export function readManifest(path: string): KitManifest | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function escapes(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel.startsWith("..") || isAbsolute(rel);
}

/**
 * Refuse any target that would write outside the destination repository.
 *
 * The lexical check alone is not enough: `resolve`/`relative` do not follow
 * symlinks, so a symlinked directory component — a `scripts -> ../shared/scripts`
 * arrangement, say — passes it while `mkdir`/`writeFile` traverse the link and
 * land outside. Resolve the deepest existing ancestor too.
 */
function resolveInside(root: string, target: string): string {
  const realRoot = realpathSync(root);
  const full = resolve(realRoot, target);
  if (relative(realRoot, full) === "" || escapes(realRoot, full)) throw new Error(`kit manifest target escapes the destination repository: ${target}`);
  let ancestor = dirname(full);
  while (!existsSync(ancestor) && ancestor !== dirname(ancestor)) ancestor = dirname(ancestor);
  if (escapes(realRoot, realpathSync(ancestor))) throw new Error(`kit target resolves outside the destination through a symlinked directory: ${target}`);
  return full;
}

function classify(newContent: string, recorded: string | undefined, localPath: string): SyncAction {
  if (!existsSync(localPath)) return "create";
  // Writing through a symlink would modify a file outside the destination while
  // the destination's own `git diff` shows nothing.
  if (lstatSync(localPath).isSymbolicLink()) return "conflict";
  const local = sha256(readFileSync(localPath, "utf8"));
  const incoming = sha256(newContent);
  if (local === incoming) return "unchanged";
  if (recorded == null) return "conflict";
  if (local === recorded) return "update";
  return recorded === incoming ? "customized" : "conflict";
}

export function planSync(kitRoot: string, repoRoot: string, accept: string[] = []): SyncPlan {
  const manifestPath = join(kitRoot, "files", MANIFEST_TARGET);
  if (!existsSync(manifestPath)) throw new Error(`not a kit directory (no ${MANIFEST_TARGET}): ${kitRoot}`);
  let incoming: unknown;
  try {
    incoming = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    throw new Error(`kit manifest is not valid JSON: ${manifestPath}`);
  }
  if (!isManifest(incoming)) throw new Error(`kit manifest is malformed: ${manifestPath}`);
  const recorded = readManifest(join(repoRoot, MANIFEST_TARGET));
  const accepted = new Set(accept);

  const entries: SyncEntry[] = [];
  const nextFiles: Record<string, KitManifestEntry> = {};
  for (const [target, meta] of Object.entries(incoming.files).sort(([a], [b]) => a.localeCompare(b))) {
    const ownership: KitOwnership = meta.ownership === "seed" ? "seed" : "kit";
    const sourcePath = join(kitRoot, ownership === "kit" ? "files" : "seed", target);
    if (!existsSync(sourcePath)) throw new Error(`kit manifest lists a file the kit does not contain: ${target}`);
    const localPath = resolveInside(repoRoot, target);

    if (ownership === "seed") {
      entries.push({ target, ownership, action: existsSync(localPath) ? "seed-present" : "seed-created" });
      nextFiles[target] = meta;
      continue;
    }

    let action = classify(readFileSync(sourcePath, "utf8"), recorded?.files[target]?.sha256, localPath);
    if (action === "conflict" && accepted.has(target)) action = "resolved";
    entries.push({ target, ownership, action });
    // A conflict keeps its old baseline so it stays a conflict until resolved;
    // everything else advances, so one stuck file cannot block the rest.
    if (action === "conflict") {
      const previous = recorded?.files[target];
      if (previous != null) nextFiles[target] = previous;
    } else {
      nextFiles[target] = meta;
    }
  }

  // A file an older kit shipped and this one dropped is reported once and then
  // forgotten. It is the adopter's file now; deleting it here is not this tool's
  // call, and re-reporting it forever would be noise.
  for (const target of Object.keys(recorded?.files ?? {})) {
    if (target in incoming.files) continue;
    if (!existsSync(join(repoRoot, target))) continue;
    entries.push({ target, ownership: recorded!.files[target].ownership, action: "removed-upstream" });
  }

  entries.sort((a, b) => a.target.localeCompare(b.target));
  const conflicts = entries.filter((entry) => entry.action === "conflict").map((entry) => entry.target);
  return {
    digest: incoming.digest,
    entries,
    conflicts,
    nextManifest: { ...incoming, files: nextFiles },
  };
}

function write(path: string, content: string, mode?: number) {
  // `classify` turns a symlinked kit-owned file into a conflict, but the manifest
  // write does not go through it, so the guard has to live here as well.
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`refusing to write through a symlink: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (mode != null) chmodSync(path, mode & 0o777);
}

export function applySync(kitRoot: string, repoRoot: string, plan: SyncPlan): string[] {
  const applied: string[] = [];
  for (const entry of plan.entries) {
    if (entry.action === "removed-upstream" || entry.action === "resolved") continue;
    const sourcePath = join(kitRoot, entry.ownership === "kit" ? "files" : "seed", entry.target);
    const localPath = resolveInside(repoRoot, entry.target);
    if (entry.action === "create" || entry.action === "update" || entry.action === "seed-created") {
      write(localPath, readFileSync(sourcePath, "utf8"), statSync(sourcePath).mode);
      applied.push(entry.target);
    } else if (entry.action === "conflict") {
      write(`${localPath}.kit-new`, readFileSync(sourcePath, "utf8"));
      applied.push(`${entry.target}.kit-new`);
    }
  }
  write(resolveInside(repoRoot, MANIFEST_TARGET), `${JSON.stringify(plan.nextManifest, null, 2)}\n`);
  applied.push(MANIFEST_TARGET);
  return applied.sort();
}

function defaultKitRoot(): string {
  // The kit sits beside this script's repository root: scripts/wiki/ -> ../../kit
  return resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "kit");
}

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function flags(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === `--${name}` && argv[index + 1] != null) values.push(argv[index + 1]);
  }
  return values;
}

async function main() {
  const argv = Bun.argv.slice(2);
  const into = flag(argv, "into");
  if (into == null) throw new Error("usage: bun scripts/wiki/kit-sync.ts --into <repo> [--kit <dir>] [--accept <path>]... [--dry-run] [--json]");
  const repoRoot = resolve(into);
  const kitRoot = resolve(flag(argv, "kit") ?? defaultKitRoot());
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) throw new Error(`target is not a directory: ${repoRoot}`);

  const plan = planSync(kitRoot, repoRoot, flags(argv, "accept"));
  const dryRun = argv.includes("--dry-run");
  const applied = dryRun ? [] : applySync(kitRoot, repoRoot, plan);

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ ok: plan.conflicts.length === 0, dryRun, digest: plan.digest, plan: plan.entries, applied }, null, 2));
  } else {
    const counts = new Map<SyncAction, number>();
    for (const entry of plan.entries) counts.set(entry.action, (counts.get(entry.action) ?? 0) + 1);
    console.log(`kit ${plan.digest.slice(0, 12)} -> ${relative(process.cwd(), repoRoot) || "."}${dryRun ? " (dry run)" : ""}`);
    const order: SyncAction[] = ["create", "update", "resolved", "seed-created", "unchanged", "seed-present", "customized", "removed-upstream", "conflict"];
    for (const action of order) {
      const count = counts.get(action);
      if (count != null) console.log(`  ${action.padEnd(16)} ${count}`);
    }
    for (const entry of plan.entries.filter((item) => item.action === "removed-upstream")) {
      console.log(`  - ${entry.target} — no longer shipped by the kit; delete it yourself if you want it gone`);
    }
    for (const target of plan.conflicts) {
      console.log(`  ! ${target} — kept yours; incoming written to ${target}.kit-new`);
    }
    if (plan.conflicts.length > 0) {
      console.log(`merge each conflict, delete its .kit-new, then re-run with ${plan.conflicts.map((target) => `--accept ${target}`).join(" ")}`);
    }
  }
  process.exitCode = plan.conflicts.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
