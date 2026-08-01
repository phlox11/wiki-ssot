import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import * as apply from "./apply";

const roots: string[] = [];
const implementation = join(process.cwd(), "scripts/wiki/apply.ts");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(prefix = "wiki-apply-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function fastKit(): string {
  const parent = fixture("wiki-apply-kit-");
  const root = join(parent, "kit");
  cpSync(join(process.cwd(), "kit"), root, { recursive: true });
  const packagePath = join(root, "package.kit.json");
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { scripts: Record<string, string> };
  pkg.scripts["wiki:tooling:test"] = "bun test scripts/wiki/wiki.test.ts -t 'frontmatter schema' --max-concurrency=1";
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  return root;
}

function put(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function runApply(root: string, ...args: string[]) {
  return Bun.spawnSync([process.execPath, implementation, "--into", root, ...args], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HUSKY: "0" },
  });
}

function git(root: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function commitFixture(root: string): void {
  git(root, "add", ".");
  git(root, "-c", "user.name=Wiki Test", "-c", "user.email=wiki@example.invalid", "commit", "-qm", "fixture");
}

function snapshot(root: string): string {
  const paths = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, stdout: "pipe" })
    .stdout.toString().trim().split("\n").filter(Boolean).sort();
  return paths.map((path) => `${path}:${apply.sha256(readFileSync(join(root, path), "utf8"))}`).join("\n");
}

function jsonOutput(result: ReturnType<typeof runApply>): Record<string, unknown> {
  const stdout = result.stdout.toString().trim();
  return JSON.parse(stdout) as Record<string, unknown>;
}

describe("apply workflow", () => {
  test("detects new, adopt, and upgrade modes", () => {
    const newRepo = fixture();
    git(newRepo, "init", "-q");
    const newResult = runApply(newRepo, "--dry-run", "--json");
    expect(newResult.exitCode).toBe(1);
    expect(jsonOutput(newResult)).toMatchObject({
      mode: "new",
      status: "needs-reconcile",
      dryRun: true,
      findings: expect.arrayContaining([
        expect.objectContaining({ code: "bootstrap-current-page-required" }),
        expect.objectContaining({ code: "bootstrap-coverage-required" }),
      ]),
    });

    const existingRepo = fixture();
    git(existingRepo, "init", "-q");
    put(existingRepo, "README.md", "existing project\n");
    commitFixture(existingRepo);
    const adoptResult = runApply(existingRepo, "--dry-run", "--json");
    expect(adoptResult.exitCode).toBe(1);
    expect(jsonOutput(adoptResult)).toMatchObject({
      mode: "adopt",
      status: "needs-reconcile",
      findings: expect.arrayContaining([
        expect.objectContaining({ code: "bootstrap-current-page-required" }),
        expect.objectContaining({ code: "bootstrap-coverage-required" }),
      ]),
    });

    const oldWikiRepo = fixture();
    git(oldWikiRepo, "init", "-q");
    put(oldWikiRepo, ".wiki/kit-manifest.json", '{"version":1,"kit":"wiki-ssot","digest":"old","files":{}}\n');
    const upgraded = jsonOutput(runApply(oldWikiRepo, "--dry-run", "--json"));
    expect(upgraded.mode).toBe("upgrade");
  });

  test("dry-run writes nothing and applying twice is idempotent", () => {
    const repo = fixture();
    git(repo, "init", "-q");
    const before = Bun.spawnSync(["find", repo, "-type", "f", "-print"], { stdout: "pipe" }).stdout.toString();
    const preview = runApply(repo, "--dry-run", "--json");
    expect(preview.exitCode).toBe(1);
    expect(jsonOutput(preview)).toMatchObject({ status: "needs-reconcile", dryRun: true });
    expect(Bun.spawnSync(["find", repo, "-type", "f", "-print"], { stdout: "pipe" }).stdout.toString()).toBe(before);

    const first = runApply(repo, "--skip-install", "--json");
    expect(first.exitCode).toBe(1);
    expect(jsonOutput(first)).toMatchObject({ status: "needs-reconcile" });
    const afterFirst = snapshot(repo);
    const second = runApply(repo, "--skip-install", "--json");
    expect(second.exitCode).toBe(1);
    expect(jsonOutput(second)).toMatchObject({
      mode: "upgrade",
      status: "needs-reconcile",
      changes: [],
      findings: expect.arrayContaining([expect.objectContaining({ code: "bootstrap-current-page-required" })]),
    });
    expect(snapshot(repo)).toBe(afterFirst);
  }, 30_000);

  test("derives bootstrap completeness only from current pages with declared sources", () => {
    expect(apply.currentPageIdsFromSourceMap({
      version: 1,
      exact: { "src/app.ts": ["product/app", "product/app"] },
      globs: [{ glob: "test/**/*.ts", pages: ["product/app", "architecture/tests"] }],
    })).toEqual(["architecture/tests", "product/app"]);
    expect(apply.currentPageIdsFromSourceMap({ version: 1, exact: {}, globs: [] })).toEqual([]);
    expect(apply.currentPageIdsFromSourceMap({ version: 1, exact: { "proposal.md": "proposal/plan" }, globs: [{ pages: [42] }] })).toEqual([]);
  });

  test("non-current markdown cannot make a post-install rerun ready", () => {
    const repo = fixture();
    const kit = fastKit();
    git(repo, "init", "-q");
    expect(runApply(repo, "--kit", kit, "--skip-install", "--json").exitCode).toBe(1);
    symlinkSync(join(process.cwd(), "node_modules"), join(repo, "node_modules"), "dir");
    put(repo, "src/app.ts", "export const proposedOnly = true;\n");
    put(repo, ".wiki/coverage.json", `${JSON.stringify({
      version: 1,
      include: ["src/**/*.ts"],
      exclusions: [{
        glob: "src/**/*.ts",
        reason: "This source is excluded only to isolate the current-page bootstrap readiness contract.",
      }],
    }, null, 2)}\n`);
    put(repo, "wiki/proposals/plan.md", `---
id: proposal/plan
summary: This proposal deliberately remains outside the current contract.
kind: proposal
status: proposed
authority: normative
owners: ["@fixture"]
sources: [{path: package.json}]
work_items: []
---

# Proposed plan

This document must not satisfy current-page bootstrap readiness.
`);
    const rerun = runApply(repo, "--kit", kit, "--skip-install", "--json");
    expect(rerun.exitCode).toBe(1);
    expect(jsonOutput(rerun)).toMatchObject({
      mode: "upgrade",
      status: "needs-reconcile",
      checks: { generated: "pass", doctor: "pass", lint: "pass", audit: "pass" },
      findings: expect.arrayContaining([expect.objectContaining({ code: "bootstrap-current-page-required" })]),
    });
  }, 30_000);

  test("enables Husky only for the explicit hook installation command", () => {
    expect(apply.commandEnvironment({ HUSKY: "0", KEEP: "yes" }, true)).toEqual({ HUSKY: "0", KEEP: "yes" });
    expect(apply.commandEnvironment({ HUSKY: "0", KEEP: "yes" }, false)).toEqual({ KEEP: "yes" });
  });

  test("an incomplete installed manifest stays needs-reconcile in a dry-run no-op", () => {
    const repo = fixture();
    git(repo, "init", "-q");
    expect(runApply(repo, "--skip-install", "--json").exitCode).toBe(1);
    const result = runApply(repo, "--dry-run", "--json");
    expect(result.exitCode).toBe(1);
    expect(jsonOutput(result)).toMatchObject({ mode: "upgrade", status: "needs-reconcile", changes: [] });
  });

  test("managed block appends and replaces while malformed or duplicate blocks need merge", () => {
    const merge = (apply as Record<string, unknown>).mergeManagedBlock as ((existing: string, managed: string) => unknown) | undefined;
    expect(merge).toBeFunction();
    const managed = "managed content";
    const missing = merge!("before\nafter\n", managed) as Record<string, unknown>;
    expect(missing).toMatchObject({ status: "ready" });
    expect(String(missing.content ?? missing.text)).toContain("before");
    expect(String(missing.content ?? missing.text)).toContain("after");
    expect(String(missing.content ?? missing.text)).toContain(managed);

    const once = String(missing.content ?? missing.text);
    const replaced = merge!(once, "new managed content") as Record<string, unknown>;
    expect(replaced).toMatchObject({ status: "ready" });
    expect(String(replaced.content ?? replaced.text)).toContain("new managed content");
    expect(String(replaced.content ?? replaced.text)).not.toContain("\nmanaged content\n");

    expect(merge!(once + once, managed)).toMatchObject({ status: "needs-merge" });
    expect(merge!("<!-- wiki-ssot:managed:start -->\nunterminated", managed)).toMatchObject({ status: "needs-merge" });
  });

  test("managed integration targets fail closed on symlinks without duplicate conflicts", () => {
    const repo = fixture();
    git(repo, "init", "-q");
    symlinkSync("missing-agents-target.md", join(repo, "AGENTS.md"));
    const report = jsonOutput(runApply(repo, "--dry-run", "--json")) as {
      status: string;
      conflicts: { path: string; reason: string }[];
    };
    expect(report.status).toBe("needs-merge");
    expect(report.conflicts.filter((item) => item.path === "AGENTS.md")).toEqual([
      { path: "AGENTS.md", reason: "managed integration target is a symlink" },
    ]);
  });

  test("package merge changes only wiki-owned entries and reports incompatible shared dependencies", () => {
    const merge = (apply as Record<string, unknown>).mergePackageJson as ((host: unknown, toolkit: unknown) => unknown) | undefined;
    expect(merge).toBeFunction();
    const host = {
      scripts: { test: "custom test", typecheck: "custom types", prepare: "custom prepare", type: "custom type" },
      devDependencies: { typescript: "^5.0.0", vitest: "^1.0.0" },
    };
    const toolkit = {
      scripts: { "wiki:lint": "bun scripts/wiki/cli.ts lint", test: "bun test scripts/wiki" },
      devDependencies: { typescript: "^5.7.2", yaml: "^2.9.0" },
    };
    const merged = merge!(host, toolkit) as Record<string, unknown>;
    expect(merged).toMatchObject({ status: "needs-merge" });
    const result = (merged.packageJson ?? merged.result ?? merged) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(result.scripts.test).toBe("custom test");
    expect(result.scripts.typecheck).toBe("custom types");
    expect(result.devDependencies.vitest).toBe("^1.0.0");
    expect(result.devDependencies.yaml).toBe("^2.9.0");
  });

  test("package merge fails closed on an incompatible Bun engine", () => {
    const merged = apply.mergePackageJson(
      { engines: { bun: ">=0.9.0" } },
      { engines: { bun: ">=1.1.0" } },
    );
    expect(merged).toMatchObject({ status: "needs-merge", conflicts: ["engines.bun"] });
  });

  test("migrates pristine v1 integration files and keeps customized legacy content closed", () => {
    const pristine = fixture();
    git(pristine, "init", "-q");
    const oldAgents = "# old agents\n<!-- wiki-ssot:fresh-context-guardrail -->\nold rules\n";
    const oldWorkflow = readFileSync(join(process.cwd(), "kit/migrations/v1/checks.yml"), "utf8");
    const hostWorkflow = readFileSync(join(process.cwd(), "kit/migrations/v1/host-checks.yml"), "utf8");
    put(pristine, "AGENTS.md", oldAgents);
    put(pristine, ".github/workflows/checks.yml", oldWorkflow);
    put(pristine, ".wiki/kit-manifest.json", `${JSON.stringify({
      version: 1, kit: "wiki-ssot", digest: "0a56c1edf904d07a1069d8de233e24ee1346ab2ebe58adedd962f0ed7c531664",
      files: {
        "AGENTS.md": { ownership: "kit", sha256: apply.sha256(oldAgents) },
        ".github/workflows/checks.yml": { ownership: "kit", sha256: apply.sha256(oldWorkflow) },
      },
    })}\n`);
    const migrated = runApply(pristine, "--skip-install", "--json");
    expect(migrated.exitCode).toBe(1);
    expect(readFileSync(join(pristine, "AGENTS.md"), "utf8")).toContain("wiki-ssot:managed:start");
    expect(readFileSync(join(pristine, ".github/workflows/checks.yml"), "utf8")).toBe(hostWorkflow);
    expect(hostWorkflow).toContain("code-check:");
    expect(hostWorkflow).toContain("bun run typecheck");
    expect(hostWorkflow).toContain("bun run test");
    expect(hostWorkflow).not.toContain("wiki-structure:");
    expect(existsSync(join(pristine, ".github/workflows/wiki-ssot.yml"))).toBe(true);
    const pristineRerun = jsonOutput(runApply(pristine, "--skip-install", "--json"));
    expect(pristineRerun.status).not.toBe("needs-merge");
    expect(readFileSync(join(pristine, ".github/workflows/checks.yml"), "utf8")).toBe(hostWorkflow);
    const pristineManifest = JSON.parse(readFileSync(join(pristine, ".wiki/kit-manifest.json"), "utf8")) as { hostFiles?: string[] };
    expect(pristineManifest.hostFiles).toContain(".github/workflows/checks.yml");

    const customized = fixture();
    git(customized, "init", "-q");
    put(customized, "AGENTS.md", `${oldAgents}host customization\n`);
    put(customized, ".wiki/kit-manifest.json", `${JSON.stringify({
      version: 1, kit: "wiki-ssot", digest: "old",
      files: { "AGENTS.md": { ownership: "kit", sha256: apply.sha256(oldAgents) } },
    })}\n`);
    const conflict = runApply(customized, "--skip-install", "--json");
    expect(conflict.exitCode).toBe(1);
    expect(jsonOutput(conflict)).toMatchObject({ status: "needs-merge" });
    expect(readFileSync(join(customized, "AGENTS.md"), "utf8")).toContain("host customization");

    const customWorkflow = fixture();
    git(customWorkflow, "init", "-q");
    put(customWorkflow, ".github/workflows/checks.yml", `${oldWorkflow}# host jobs retained\n`);
    put(customWorkflow, ".wiki/kit-manifest.json", `${JSON.stringify({
      version: 1, kit: "wiki-ssot", digest: "old",
      files: { ".github/workflows/checks.yml": { ownership: "kit", sha256: apply.sha256(oldWorkflow) } },
    })}\n`);
    expect(jsonOutput(runApply(customWorkflow, "--skip-install", "--json"))).toMatchObject({ status: "needs-merge" });
    const stillDuplicated = runApply(customWorkflow, "--skip-install", "--json", "--accept", ".github/workflows/checks.yml");
    expect(jsonOutput(stillDuplicated)).toMatchObject({ status: "needs-merge" });
    put(customWorkflow, ".github/workflows/checks.yml", `${hostWorkflow}# host jobs retained\n`);
    const accepted = runApply(customWorkflow, "--skip-install", "--json", "--accept", ".github/workflows/checks.yml");
    expect(jsonOutput(accepted).status).not.toBe("needs-merge");
    const retainedWorkflow = readFileSync(join(customWorkflow, ".github/workflows/checks.yml"), "utf8");
    expect(retainedWorkflow).toContain("host jobs retained");
    expect(retainedWorkflow).toContain("code-check:");
    expect(retainedWorkflow).not.toContain("wiki-structure:");
    const acceptedManifest = JSON.parse(readFileSync(join(customWorkflow, ".wiki/kit-manifest.json"), "utf8")) as {
      files: Record<string, unknown>;
      hostFiles?: string[];
    };
    expect(acceptedManifest.files[".github/workflows/checks.yml"]).toBeUndefined();
    expect(acceptedManifest.hostFiles).toContain(".github/workflows/checks.yml");
    const acceptedRerun = jsonOutput(runApply(customWorkflow, "--skip-install", "--json"));
    expect(acceptedRerun.status).not.toBe("needs-merge");
    expect(readFileSync(join(customWorkflow, ".github/workflows/checks.yml"), "utf8")).toBe(retainedWorkflow);
  }, 30_000);

  test("legacy workflows without a complete manifest stay fail closed until host-only acceptance", () => {
    const repo = fixture();
    git(repo, "init", "-q");
    const oldWorkflow = readFileSync(join(process.cwd(), "kit/migrations/v1/checks.yml"), "utf8");
    const hostWorkflow = readFileSync(join(process.cwd(), "kit/migrations/v1/host-checks.yml"), "utf8");
    put(repo, "AGENTS.md", readFileSync(join(process.cwd(), "kit/managed/AGENTS.md"), "utf8"));
    put(repo, ".github/workflows/checks.yml", oldWorkflow);

    const preview = jsonOutput(runApply(repo, "--dry-run", "--json"));
    expect(preview).toMatchObject({ mode: "upgrade", status: "needs-merge" });
    expect(readFileSync(join(repo, ".github/workflows/checks.yml"), "utf8")).toBe(oldWorkflow);
    expect(existsSync(join(repo, ".github/workflows/wiki-ssot.yml"))).toBe(false);

    const missingManifest = jsonOutput(runApply(
      repo,
      "--skip-install",
      "--json",
      "--accept",
      ".github/workflows/checks.yml",
    ));
    expect(missingManifest).toMatchObject({
      mode: "upgrade",
      status: "needs-merge",
      conflicts: expect.arrayContaining([expect.objectContaining({
        path: ".github/workflows/checks.yml",
        reason: "legacy workflow must retain host jobs and remove duplicate Wiki jobs before it can be accepted",
      })]),
    });
    expect(readFileSync(join(repo, ".github/workflows/checks.yml"), "utf8")).toBe(oldWorkflow);
    expect(existsSync(join(repo, ".github/workflows/wiki-ssot.yml"))).toBe(true);

    const inspectedHostOnly = `${hostWorkflow}# inspected host jobs retained\n`;
    put(repo, ".github/workflows/checks.yml", inspectedHostOnly);
    const incompleteManifest = jsonOutput(runApply(repo, "--skip-install", "--json"));
    expect(incompleteManifest).toMatchObject({
      mode: "upgrade",
      status: "needs-merge",
      conflicts: expect.arrayContaining([expect.objectContaining({
        path: ".github/workflows/checks.yml",
        reason: "untracked legacy workflow must be explicitly accepted after inspection confirms it contains only host jobs",
      })]),
    });
    expect(readFileSync(join(repo, ".github/workflows/checks.yml"), "utf8")).toBe(inspectedHostOnly);

    const accepted = jsonOutput(runApply(
      repo,
      "--skip-install",
      "--json",
      "--accept",
      ".github/workflows/checks.yml",
    ));
    expect(accepted.status).not.toBe("needs-merge");
    const retainedWorkflow = readFileSync(join(repo, ".github/workflows/checks.yml"), "utf8");
    expect(retainedWorkflow).toBe(inspectedHostOnly);
    expect(retainedWorkflow).toContain("code-check:");
    expect(retainedWorkflow).not.toMatch(/^ {2}wiki-[A-Za-z0-9_-]+:/m);
    const manifest = JSON.parse(readFileSync(join(repo, ".wiki/kit-manifest.json"), "utf8")) as {
      files: Record<string, unknown>;
      hostFiles?: string[];
    };
    expect(manifest.files[".github/workflows/checks.yml"]).toBeUndefined();
    expect(manifest.hostFiles).toContain(".github/workflows/checks.yml");
    const converged = jsonOutput(runApply(repo, "--skip-install", "--json"));
    expect(converged.status).not.toBe("needs-merge");
    expect(readFileSync(join(repo, ".github/workflows/checks.yml"), "utf8")).toBe(inspectedHostOnly);
  }, 30_000);

  test("legacy Wiki job detection follows YAML structure before and after host tracking", () => {
    const hostWorkflow = readFileSync(join(process.cwd(), "kit/migrations/v1/host-checks.yml"), "utf8");
    const managedAgents = readFileSync(join(process.cwd(), "kit/managed/AGENTS.md"), "utf8");
    const variants = [
      {
        name: "four-space job key",
        content: `name: legacy-four-space
on: [pull_request]
jobs:
    wiki-lint:
      runs-on: ubuntu-latest
      steps:
        - run: bun run wiki:lint
    code-check:
      runs-on: ubuntu-latest
      steps:
        - run: bun run test
`,
      },
      {
        name: "quoted job key",
        content: `name: legacy-quoted
on: [pull_request]
jobs:
  "wiki-lint":
    runs-on: ubuntu-latest
    steps:
      - run: bun run wiki:lint
  code-check:
    runs-on: ubuntu-latest
    steps:
      - run: bun run test
`,
      },
    ];

    for (const variant of variants) {
      const untracked = fixture(`wiki-apply-${variant.name.replaceAll(" ", "-")}-`);
      git(untracked, "init", "-q");
      put(untracked, "AGENTS.md", managedAgents);
      put(untracked, ".github/workflows/checks.yml", variant.content);
      const blocked = jsonOutput(runApply(
        untracked,
        "--dry-run",
        "--json",
        "--accept",
        ".github/workflows/checks.yml",
      ));
      expect(blocked).toMatchObject({
        mode: "upgrade",
        status: "needs-merge",
        conflicts: expect.arrayContaining([expect.objectContaining({
          path: ".github/workflows/checks.yml",
          reason: "legacy workflow must retain host jobs and remove duplicate Wiki jobs before it can be accepted",
        })]),
      });
      expect(readFileSync(join(untracked, ".github/workflows/checks.yml"), "utf8")).toBe(variant.content);

      const tracked = fixture(`wiki-apply-tracked-${variant.name.replaceAll(" ", "-")}-`);
      git(tracked, "init", "-q");
      put(tracked, "AGENTS.md", managedAgents);
      put(tracked, ".github/workflows/checks.yml", hostWorkflow);
      const accepted = jsonOutput(runApply(
        tracked,
        "--skip-install",
        "--json",
        "--accept",
        ".github/workflows/checks.yml",
      ));
      expect(accepted.status).not.toBe("needs-merge");
      put(tracked, ".github/workflows/checks.yml", variant.content);
      const rescanned = jsonOutput(runApply(
        tracked,
        "--dry-run",
        "--json",
        "--accept",
        ".github/workflows/checks.yml",
      ));
      expect(rescanned).toMatchObject({
        mode: "upgrade",
        status: "needs-merge",
        conflicts: expect.arrayContaining([expect.objectContaining({
          path: ".github/workflows/checks.yml",
          reason: "legacy workflow must retain host jobs and remove duplicate Wiki jobs before it can be accepted",
        })]),
      });
      expect(readFileSync(join(tracked, ".github/workflows/checks.yml"), "utf8")).toBe(variant.content);
    }
  }, 30_000);

  test("an existing code repository adopts through the same loop and reaches ready", () => {
    const repo = fixture();
    const kit = fastKit();
    git(repo, "init", "-q");
    put(repo, "package.json", '{"scripts":{"test":"host-test"},"devDependencies":{"typescript":"^5.8.0"}}\n');
    put(repo, "src/app.ts", "export const adopted = true;\n");
    commitFixture(repo);
    symlinkSync(join(process.cwd(), "node_modules"), join(repo, "node_modules"), "dir");
    put(repo, ".wiki/coverage.json", '{"version":1,"include":["src/**/*.ts"],"exclusions":[]}\n');
    put(repo, "wiki/product/app.md", `---
id: product/app
summary: The adopted application exposes its maintained current marker.
kind: product
status: current
authority: observed
owners: ["@fixture"]
sources:
  - path: src/app.ts
related: []
tags: [fixture]
---

# Adopted application

The maintained source exposes the current marker.
`);
    const initial = runApply(repo, "--kit", kit, "--skip-install", "--json");
    expect(initial.exitCode).toBe(1);
    expect(jsonOutput(initial)).toMatchObject({ mode: "adopt", status: "needs-reconcile" });
    const verify = Bun.spawnSync([process.execPath, "scripts/wiki/cli.ts", "verify"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    expect(verify.exitCode).toBe(0);
    const ready = runApply(repo, "--kit", kit, "--skip-install", "--json");
    expect(ready.exitCode).toBe(0);
    expect(jsonOutput(ready)).toMatchObject({ mode: "upgrade", status: "ready" });
  }, 60_000);

  test("reconciled project reaches ready and keeps host lifecycle scripts", () => {
    const repo = fixture();
    const kit = fastKit();
    git(repo, "init", "-q");
    symlinkSync(join(process.cwd(), "node_modules"), join(repo, "node_modules"), "dir");
    put(repo, "package.json", `${JSON.stringify({ scripts: { test: "host-test", typecheck: "host-types", prepare: "host-prepare" } }, null, 2)}\n`);
    put(repo, "src/app.ts", "export const value = 1;\n");
    put(repo, ".wiki/coverage.json", '{"version":1,"include":["src/**/*.ts"],"exclusions":[]}\n');
    put(repo, "wiki/product/app.md", `---
id: product/app
summary: The fixture application exports its current value from the maintained source.
kind: product
status: current
authority: normative
owners: ["@fixture"]
sources:
  - path: src/app.ts
related: []
tags: [fixture]
---

# Fixture application

The maintained source exports the current fixture value.
`);
    const initial = runApply(repo, "--kit", kit, "--skip-install", "--json");
    expect(initial.exitCode).toBe(1);
    const verify = Bun.spawnSync([process.execPath, "scripts/wiki/cli.ts", "verify"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    expect(verify.exitCode).toBe(0);
    const ready = runApply(repo, "--kit", kit, "--skip-install", "--json");
    expect(jsonOutput(ready)).toMatchObject({ mode: "upgrade", status: "ready" });
    expect(ready.exitCode).toBe(0);
    const preview = runApply(repo, "--kit", kit, "--dry-run", "--json");
    expect(preview.exitCode).toBe(0);
    expect(jsonOutput(preview)).toMatchObject({ mode: "upgrade", status: "preview", dryRun: true, changes: [] });
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts).toMatchObject({ test: "host-test", typecheck: "host-types", prepare: "host-prepare" });
  }, 60_000);
});
