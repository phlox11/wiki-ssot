import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

type CommandResult = {
  stdout: string;
  stderr: string;
};

const temporary: string[] = [];
const publisherRoot = process.cwd();
const publisherNodeModules = join(publisherRoot, "node_modules");
const commandEnvironment = {
  ...process.env,
  HUSKY: "0",
  NODE_PATH: publisherNodeModules,
  PATH: `${join(publisherNodeModules, ".bin")}:${process.env.PATH ?? ""}`,
};

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-new-adoption-"));
  temporary.push(root);
  return root;
}

function put(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function run(root: string, command: string[]): CommandResult {
  const result = Bun.spawnSync(command, {
    cwd: root,
    env: commandEnvironment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (result.exitCode !== 0) {
    throw new Error(`command failed (${result.exitCode}): ${command.join(" ")}\n${stdout}${stderr}`);
  }
  return { stdout, stderr };
}

function runWiki(root: string, command: string, ...args: string[]): CommandResult {
  return run(root, [process.execPath, "scripts/wiki/cli.ts", command, ...args]);
}

function mergeKitPackage(repo: string): void {
  const incoming = JSON.parse(readFileSync(join(publisherRoot, "kit/package.kit.json"), "utf8")) as {
    type: string;
    engines: Record<string, string>;
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  put(repo, "package.json", `${JSON.stringify(incoming, null, 2)}\n`);
}

function writeMetadata(path: string): void {
  writeFileSync(path, `## Wiki metadata

\`\`\`yaml
change_type: feature
semantic_change: true
wiki_action: update
affected_pages: [features/greeting]
affected_invariants: []
touched_conflicts: []
fresh_context:
  verdict: PENDING
  reviewed_head_sha: ""
  bundle_digest: ""
  reviewer: ""
  evidence: []
\`\`\`
`);
}

describe("new-repository adoption", () => {
  test("starts green, then adds the first covered and verified feature as one candidate", () => {
    const fixture = temporaryDirectory();
    const repo = join(fixture, "repo");
    mkdirSync(repo);

    run(repo, ["git", "init", "-q"]);
    run(repo, ["git", "config", "user.email", "adoption@example.test"]);
    run(repo, ["git", "config", "user.name", "Adoption Fixture"]);
    run(repo, ["git", "commit", "--allow-empty", "-qm", "empty repository"]);
    expect(run(repo, ["git", "ls-files"]).stdout).toBe("");

    const sync = run(publisherRoot, [
      process.execPath,
      "scripts/wiki/kit-sync.ts",
      "--into",
      repo,
      "--json",
    ]);
    expect(JSON.parse(sync.stdout)).toMatchObject({ ok: true, dryRun: false });
    mergeKitPackage(repo);
    const config = JSON.parse(readFileSync(join(repo, ".wiki/config.json"), "utf8"));
    config.name = "adoption-fixture";
    config.highRisk = [];
    put(repo, ".wiki/config.json", `${JSON.stringify(config, null, 2)}\n`);
    // The fixture is deliberately offline. Link the publisher's lockfile-backed
    // install to represent the documented `bun install`, and keep that harness
    // detail out of both adoption commits.
    symlinkSync(publisherNodeModules, join(repo, "node_modules"), "dir");
    writeFileSync(join(repo, ".git/info/exclude"), "node_modules\n");

    expect(JSON.parse(readFileSync(join(repo, ".wiki/coverage.json"), "utf8"))).toEqual({
      exclusions: [],
      include: [],
      version: 1,
    });
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toContain("node_modules/");

    // The first green point is after kit sync, package merge/dependency
    // availability, deterministic generation, and the empty verification pass.
    runWiki(repo, "generated");
    runWiki(repo, "verify");
    expect(JSON.parse(runWiki(repo, "lint", "--json").stdout)).toMatchObject({ ok: true });
    expect(JSON.parse(runWiki(repo, "doctor", "--json").stdout)).toMatchObject({ ok: true });
    run(repo, ["bun", "run", "typecheck"]);
    run(repo, ["bun", "run", "test"]);
    run(repo, ["git", "add", "-A"]);
    run(repo, ["git", "commit", "-qm", "adopt wiki kit"]);

    put(repo, "src/greeting.ts", `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`);
    put(repo, "src/greeting.test.ts", `import { expect, test } from "bun:test";
import { greet } from "./greeting";

test("greets by name", () => {
  expect(greet("Ada")).toBe("Hello, Ada!");
});
`);
    put(repo, "wiki/features/greeting.md", `---
id: features/greeting
summary: Greeting returns a stable personalized message.
kind: feature
status: current
authority: observed
owners: ["@adopter"]
sources:
  - path: src/greeting.ts
    symbols: [greet]
  - path: src/greeting.test.ts
---

# Greeting

\`greet(name)\` returns \`Hello, <name>!\`.
`);

    const coverage = JSON.parse(readFileSync(join(repo, ".wiki/coverage.json"), "utf8"));
    coverage.include = ["src/**/*.ts"];
    put(repo, ".wiki/coverage.json", `${JSON.stringify(coverage, null, 2)}\n`);

    const packageJson = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    packageJson.scripts.test = "bun test scripts/wiki src";
    put(repo, "package.json", `${JSON.stringify(packageJson, null, 2)}\n`);

    const tsconfig = JSON.parse(readFileSync(join(repo, "tsconfig.json"), "utf8"));
    tsconfig.include = ["scripts/**/*.ts", "src/**/*.ts"];
    put(repo, "tsconfig.json", `${JSON.stringify(tsconfig, null, 2)}\n`);

    runWiki(repo, "generated");
    const beforeVerification = Bun.spawnSync(
      [process.execPath, "scripts/wiki/cli.ts", "audit", "--json"],
      { cwd: repo, env: commandEnvironment, stdout: "pipe", stderr: "pipe" },
    );
    expect(beforeVerification.exitCode).toBe(1);
    expect(JSON.parse(beforeVerification.stdout.toString()).findings).toContainEqual(
      expect.objectContaining({ code: "state-stale-low-risk", path: ".wiki/state.json" }),
    );

    runWiki(repo, "verify");
    runWiki(repo, "generated", "--check");
    expect(JSON.parse(runWiki(repo, "lint", "--json").stdout)).toMatchObject({ ok: true });
    expect(JSON.parse(runWiki(repo, "doctor", "--json").stdout)).toMatchObject({ ok: true });
    run(repo, ["bun", "run", "typecheck"]);
    run(repo, ["bun", "run", "test"]);

    run(repo, ["git", "add", "-A"]);
    run(repo, ["git", "commit", "-qm", "add first feature"]);
    const featureCandidate = run(
      repo,
      ["git", "diff", "--name-only", "HEAD~1", "HEAD"],
    ).stdout.trim().split("\n");
    expect(featureCandidate).toEqual(expect.arrayContaining([
      ".wiki/coverage.json",
      ".wiki/source-map.json",
      ".wiki/state.json",
      "src/greeting.test.ts",
      "src/greeting.ts",
      "wiki/features/greeting.md",
    ]));

    const metadata = join(fixture, "pr-body.md");
    const bundle = join(fixture, "review-bundle");
    writeMetadata(metadata);

    const impact = JSON.parse(runWiki(
      repo,
      "impact",
      "--base",
      "HEAD~1",
      "--metadata",
      metadata,
      "--enforce",
      "--json",
    ).stdout);
    expect(impact).toMatchObject({
      affectedPages: ["features/greeting"],
      findings: [],
      unmappedHighRisk: [],
    });

    const preflight = JSON.parse(runWiki(
      repo,
      "review-preflight",
      "--base",
      "HEAD~1",
      "--metadata",
      metadata,
      "--output",
      bundle,
      "--json",
    ).stdout);
    expect(preflight).toMatchObject({
      ok: true,
      ready: true,
      status: "not-required",
    });

    expect(run(repo, ["git", "status", "--porcelain"]).stdout).toBe("");
    const sourceMap = JSON.parse(readFileSync(join(repo, ".wiki/source-map.json"), "utf8"));
    expect(sourceMap.exact["src/greeting.ts"]).toEqual(["features/greeting"]);
    expect(sourceMap.exact["src/greeting.test.ts"]).toEqual(["features/greeting"]);
    const state = JSON.parse(readFileSync(join(repo, ".wiki/state.json"), "utf8"));
    expect(state.pages["features/greeting"]).toMatchObject({
      verification: { kind: "updated" },
    });
  }, 120_000);
});
