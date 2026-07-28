#!/usr/bin/env bun
/**
 * Copy the wiki-ssot kit into another repository, or bring an already-adopted
 * repository up to date with a newer kit.
 *
 * Run it from a checkout of wiki-ssot, pointing at the target repository:
 *
 *   bun scripts/wiki/kit-sync.ts --into /path/to/your-repo
 *   bun scripts/wiki/kit-sync.ts --into /path/to/your-repo --dry-run
 *
 * The point of the tool is that an upgrade must not treat "you never touched
 * this file" and "you edited this file" the same way. It compares three
 * versions of every kit-owned file — the one in the new kit, the one recorded
 * in the target's `.wiki/kit-manifest.json` from its last sync, and the one on
 * disk — and decides per file:
 *
 *   local absent                      -> create
 *   local == new                      -> unchanged   (nothing to do)
 *   local == old, kit moved           -> update      (safe to replace)
 *   local != old, kit did not move    -> customized  (your edit, left alone)
 *   local != old, kit moved           -> conflict    (both moved; never clobbered)
 *   local != new, no recorded old     -> conflict    (cannot prove it is pristine)
 *
 * A conflict writes the incoming version beside the file as `<path>.kit-new`
 * and leaves the original untouched. The recorded manifest is only advanced
 * when no conflicts remain, so an unresolved conflict cannot be silently
 * downgraded into "your customization" by the next run.
 *
 * Seed files (`kit/seed/**`) are written only when absent and are never
 * updated, so project policy, recorded source hashes, and a project-specific
 * inventory implementation survive every upgrade.
 *
 * This script is intentionally standalone — it must run against a repository
 * that does not have this engine installed yet, so it imports nothing.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const MANIFEST_TARGET = ".wiki/kit-manifest.json";

export type KitOwnership = "kit" | "seed";
export type KitManifest = {
  version: number;
  kit: string;
  digest: string;
  files: Record<string, { sha256: string; ownership: KitOwnership }>;
};

export type SyncAction = "create" | "unchanged" | "update" | "customized" | "conflict" | "seed-created" | "seed-present";

export type SyncEntry = { target: string; ownership: KitOwnership; action: SyncAction };

export type SyncPlan = {
  digest: string;
  entries: SyncEntry[];
  conflicts: string[];
  /** False when a conflict is unresolved, so the recorded manifest stays put. */
  advanceManifest: boolean;
};

export function sha256(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

export function readManifest(path: string): KitManifest | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as KitManifest;
    return parsed != null && typeof parsed === "object" && parsed.files != null ? parsed : null;
  } catch {
    return null;
  }
}

function classify(newContent: string, recorded: string | undefined, localPath: string): SyncAction {
  if (!existsSync(localPath)) return "create";
  const local = sha256(readFileSync(localPath, "utf8"));
  const incoming = sha256(newContent);
  if (local === incoming) return "unchanged";
  if (recorded == null) return "conflict";
  if (local === recorded) return "update";
  return recorded === incoming ? "customized" : "conflict";
}

export function planSync(kitRoot: string, repoRoot: string): SyncPlan {
  const manifestPath = join(kitRoot, "files", MANIFEST_TARGET);
  if (!existsSync(manifestPath)) throw new Error(`not a kit directory (no ${MANIFEST_TARGET}): ${kitRoot}`);
  const incoming = JSON.parse(readFileSync(manifestPath, "utf8")) as KitManifest;
  const recorded = readManifest(join(repoRoot, MANIFEST_TARGET));

  const entries: SyncEntry[] = [];
  for (const [target, meta] of Object.entries(incoming.files).sort(([a], [b]) => a.localeCompare(b))) {
    const sourcePath = join(kitRoot, meta.ownership === "kit" ? "files" : "seed", target);
    if (!existsSync(sourcePath)) throw new Error(`kit manifest lists a file the kit does not contain: ${target}`);
    const localPath = join(repoRoot, target);
    if (meta.ownership === "seed") {
      entries.push({ target, ownership: "seed", action: existsSync(localPath) ? "seed-present" : "seed-created" });
      continue;
    }
    entries.push({ target, ownership: "kit", action: classify(readFileSync(sourcePath, "utf8"), recorded?.files[target]?.sha256, localPath) });
  }

  const conflicts = entries.filter((entry) => entry.action === "conflict").map((entry) => entry.target);
  return { digest: incoming.digest, entries, conflicts, advanceManifest: conflicts.length === 0 };
}

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function applySync(kitRoot: string, repoRoot: string, plan: SyncPlan): string[] {
  const applied: string[] = [];
  for (const entry of plan.entries) {
    const sourcePath = join(kitRoot, entry.ownership === "kit" ? "files" : "seed", entry.target);
    const localPath = join(repoRoot, entry.target);
    const content = readFileSync(sourcePath, "utf8");
    if (entry.action === "create" || entry.action === "update" || entry.action === "seed-created") {
      write(localPath, content);
      applied.push(entry.target);
    } else if (entry.action === "conflict") {
      write(`${localPath}.kit-new`, content);
      applied.push(`${entry.target}.kit-new`);
    }
  }
  if (plan.advanceManifest) {
    write(join(repoRoot, MANIFEST_TARGET), readFileSync(join(kitRoot, "files", MANIFEST_TARGET), "utf8"));
    applied.push(MANIFEST_TARGET);
  }
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

async function main() {
  const argv = Bun.argv.slice(2);
  const into = flag(argv, "into");
  if (into == null) throw new Error("usage: bun scripts/wiki/kit-sync.ts --into <repo> [--kit <dir>] [--dry-run] [--json]");
  const repoRoot = resolve(into);
  const kitRoot = resolve(flag(argv, "kit") ?? defaultKitRoot());
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) throw new Error(`target is not a directory: ${repoRoot}`);

  const plan = planSync(kitRoot, repoRoot);
  const dryRun = argv.includes("--dry-run");
  const applied = dryRun ? [] : applySync(kitRoot, repoRoot, plan);

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ ok: plan.conflicts.length === 0, dryRun, digest: plan.digest, plan: plan.entries, applied }, null, 2));
  } else {
    const counts = new Map<SyncAction, number>();
    for (const entry of plan.entries) counts.set(entry.action, (counts.get(entry.action) ?? 0) + 1);
    console.log(`kit ${plan.digest.slice(0, 12)} -> ${relative(process.cwd(), repoRoot) || "."}${dryRun ? " (dry run)" : ""}`);
    for (const action of ["create", "update", "seed-created", "unchanged", "seed-present", "customized", "conflict"] as SyncAction[]) {
      const count = counts.get(action);
      if (count != null) console.log(`  ${action.padEnd(12)} ${count}`);
    }
    for (const target of plan.conflicts) console.log(`  ! ${target} — kept yours; incoming written to ${target}.kit-new`);
    if (!plan.advanceManifest) console.log(`resolve the conflicts above, then re-run; ${MANIFEST_TARGET} was not advanced`);
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
