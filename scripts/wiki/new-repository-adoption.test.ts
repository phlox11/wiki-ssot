import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

type CommandResult = {
  stdout: string;
  stderr: string;
};

const temporary: string[] = [];
const publisherRoot = process.cwd();
const commandEnvironment: Record<string, string | undefined> = {
  ...process.env,
  HUSKY: "0",
};
delete commandEnvironment.GITHUB_EVENT_NAME;
delete commandEnvironment.WIKI_PR_BODY;

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

function run(
  root: string,
  command: string[],
  environment: Record<string, string | undefined> = commandEnvironment,
): CommandResult {
  const result = Bun.spawnSync(command, {
    cwd: root,
    env: environment,
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

function materializeCachedDependencies(repo: string): void {
  const cacheRoot = run(publisherRoot, [process.execPath, "pm", "cache"]).stdout.trim();
  const lock = readFileSync(join(publisherRoot, "bun.lock"), "utf8");
  const packages = [...lock.matchAll(/^ {4}"([^"]+)": \["([^"]+)"/gm)]
    .map((match) => ({ name: match[1], resolved: match[2] }));
  if (packages.length === 0) throw new Error("publisher bun.lock contains no resolved packages");

  const bins = join(repo, "node_modules/.bin");
  mkdirSync(bins, { recursive: true });
  for (const { name, resolved } of packages) {
    const version = resolved.startsWith(`${name}@`) ? resolved.slice(name.length + 1) : "";
    if (version.length === 0) throw new Error(`cannot derive cached version for ${name}: ${resolved}`);

    const segments = name.split("/");
    const basename = segments.pop()!;
    const cacheParent = join(cacheRoot, ...segments);
    const prefix = `${basename}@${version}`;
    const candidates = readdirSync(cacheParent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && (entry.name === prefix || entry.name.startsWith(`${prefix}@`)))
      .map((entry) => entry.name)
      .sort();
    if (candidates.length === 0) {
      throw new Error(`publisher install cache is missing ${resolved}; run bun install before the test`);
    }

    const source = join(cacheParent, candidates[0]);
    const target = join(repo, "node_modules", name);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true });

    const packageJson = JSON.parse(readFileSync(join(source, "package.json"), "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const packageBins = typeof packageJson.bin === "string"
      ? { [basename]: packageJson.bin }
      : packageJson.bin ?? {};
    for (const [command, path] of Object.entries(packageBins)) {
      symlinkSync(join(target, path), join(bins, command));
    }
  }
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
  test("reports an empty project incomplete, then reaches ready with its first covered feature", () => {
    const fixture = temporaryDirectory();
    const repo = join(fixture, "repo");
    const testKit = join(fixture, "kit");
    mkdirSync(repo);
    cpSync(join(publisherRoot, "kit"), testKit, { recursive: true });
    const testFragmentPath = join(testKit, "package.kit.json");
    const testFragment = JSON.parse(readFileSync(testFragmentPath, "utf8"));
    testFragment.scripts["wiki:tooling:test"] = "bun test scripts/wiki/wiki.test.ts -t 'frontmatter schema' --max-concurrency=1";
    writeFileSync(testFragmentPath, `${JSON.stringify(testFragment, null, 2)}\n`);

    run(repo, ["git", "init", "-q"]);
    run(repo, ["git", "config", "user.email", "adoption@example.test"]);
    run(repo, ["git", "config", "user.name", "Adoption Fixture"]);
    expect(run(repo, ["git", "ls-files"]).stdout).toBe("");

    const initialApply = Bun.spawnSync([
      process.execPath,
      join(publisherRoot, "scripts/wiki/apply.ts"),
      "--into",
      repo,
      "--kit",
      testKit,
      "--skip-install",
      "--json",
    ], { cwd: publisherRoot, env: commandEnvironment, stdout: "pipe", stderr: "pipe" });
    expect(initialApply.exitCode).toBe(1);
    const initialReport = JSON.parse(initialApply.stdout.toString());
    expect(initialReport).toMatchObject({ mode: "new", status: "needs-reconcile" });
    expect(initialReport.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "bootstrap-current-page-required" }),
      expect.objectContaining({ code: "bootstrap-coverage-required" }),
    ]));
    for (const target of [
      "scripts/wiki/discovery.ts",
      "scripts/wiki/context.ts",
      "scripts/wiki/generated-views.ts",
      "scripts/wiki/discovery.test.ts",
      "scripts/wiki/context.test.ts",
      "scripts/wiki/generated-views.test.ts",
    ]) {
      expect(existsSync(join(repo, target))).toBe(true);
    }
    const config = JSON.parse(readFileSync(join(repo, ".wiki/config.json"), "utf8"));
    config.name = "adoption-fixture";
    config.highRisk = [];
    put(repo, ".wiki/config.json", `${JSON.stringify(config, null, 2)}\n`);
    // The fixture is intentionally network-free. Materialize the exact packages
    // selected by the publisher lockfile from Bun's local cache, which the
    // outer repository's normal install populates before its test gate runs.
    materializeCachedDependencies(repo);

    expect(JSON.parse(readFileSync(join(repo, ".wiki/coverage.json"), "utf8"))).toEqual({
      exclusions: [],
      include: [],
      version: 1,
    });
    expect(readFileSync(join(repo, ".gitignore"), "utf8")).toContain("node_modules/");

    // Preserve an explicit test-only merge base after the deterministic install.
    // The apply report above remains the authority: this is not a completed Wiki.
    runWiki(repo, "generated");
    runWiki(repo, "verify");
    run(repo, ["git", "add", "-A"]);
    run(repo, ["git", "commit", "-qm", "test-only installed baseline"]);

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
    packageJson.scripts.typecheck = "tsc --noEmit";
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
    run(repo, ["bun", "test", "src"]);
    const readyApply = Bun.spawnSync([
      process.execPath,
      join(publisherRoot, "scripts/wiki/apply.ts"),
      "--into",
      repo,
      "--kit",
      testKit,
      "--skip-install",
      "--json",
    ], { cwd: publisherRoot, env: commandEnvironment, stdout: "pipe", stderr: "pipe" });
    expect(readyApply.exitCode).toBe(0);
    expect(JSON.parse(readyApply.stdout.toString())).toMatchObject({ mode: "upgrade", status: "ready" });

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
