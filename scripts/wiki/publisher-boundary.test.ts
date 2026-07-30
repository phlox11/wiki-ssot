import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildSourceMap,
  createRepoView,
  evaluateFreshContextRequirement,
  generatedCoreFiles,
  isHighRisk,
  jsonStable,
  loadWikiPages,
  mappedPages,
  readConfig,
  verifyState,
  type ImpactReport,
  type ReviewManifest,
} from "./core";

const temporary: string[] = [];
const AMBIENT_PULL_REQUEST_KEYS = [
  "GITHUB_EVENT_NAME",
  "GITHUB_EVENT_PATH",
  "GITHUB_HEAD_REF",
  "GITHUB_BASE_REF",
  "WIKI_PR_BODY",
] as const;

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-publisher-boundary-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Publisher Boundary Test"]);
  run(root, ["git", "config", "user.email", "wiki-publisher-boundary@example.invalid"]);
  return root;
}

function run(root: string, command: string[]) {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

function put(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function isolatedFixtureEnvironment(environment: Record<string, string | undefined>) {
  const isolated = { ...environment };
  for (const key of AMBIENT_PULL_REQUEST_KEYS) delete isolated[key];
  return isolated;
}

function ambientPullRequestEnvironment() {
  return {
    ...process.env,
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: "/tmp/publisher-pull-request-event.json",
    GITHUB_HEAD_REF: "codex/pv-16-recursive-coverage",
    GITHUB_BASE_REF: "main",
    WIKI_PR_BODY: [
      "```yaml",
      "change_type: fix",
      "semantic_change: true",
      "wiki_action: update",
      "affected_pages:",
      "  - architecture/engine",
      "  - operations/enforcement",
      "affected_invariants: []",
      "touched_conflicts: []",
      "```",
    ].join("\n"),
  };
}

function spawn(root: string, command: string[], environment: Record<string, string | undefined> = process.env) {
  return Bun.spawnSync(command, {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedFixtureEnvironment(environment),
  });
}

function page(): string {
  return `---
id: architecture/engine
summary: The recursive wiki engine boundary.
kind: architecture
status: current
authority: observed
owners: ["@owner"]
sources:
  - glob: scripts/wiki/**/*.ts
related: []
tags: [architecture, engine]
---

# Engine

Nested TypeScript implementation and test files are maintained engine sources.
`;
}

function policyConfig() {
  return {
    version: 1,
    name: "recursive-boundary-fixture",
    highRisk: ["scripts/wiki/**"],
    freshContext: {
      mode: "required",
      requiredVerdict: "PASS",
      evidenceRequired: true,
      requiredWhen: {
        kind: "risk-based",
        changedFileGlobs: ["scripts/wiki/**"],
        affectedInvariants: true,
        affectedConflicts: true,
        removedCurrentPages: true,
      },
      trust: {
        allowedReviewers: ["*"],
        requireDifferentActor: false,
        requireAuthenticatedActor: true,
      },
    },
  };
}

function prepareFixture(target: string): { root: string; cliPath: string } {
  const root = tempRepo();
  const cliPath = join(process.cwd(), "scripts/wiki/cli.ts");
  put(root, ".wiki/config.json", jsonStable(policyConfig()));
  put(root, ".wiki/coverage.json", jsonStable({
    version: 1,
    include: ["scripts/wiki/**/*.ts"],
    exclusions: [],
  }));
  put(root, "AGENTS.md", readFileSync(join(process.cwd(), "AGENTS.md"), "utf8"));
  put(root, "package.json", jsonStable({
    scripts: {
      "wiki:review-preflight": "bun scripts/wiki/cli.ts review-preflight",
      "wiki:review-check": "bun scripts/wiki/cli.ts review-check",
      "wiki:doctor": "bun scripts/wiki/cli.ts doctor",
      "wiki:work": "bun scripts/wiki/cli.ts work",
    },
  }));
  put(root, "wiki/architecture/engine.md", page());
  put(root, "wiki/changelog.md", "# Changelog\n");
  put(root, "scripts/wiki/parsers/edge.ts", "export const edge = 1;\n");
  put(root, "scripts/wiki/parsers/edge.test.ts", "export const edgeTest = 1;\n");

  let view = createRepoView(root);
  const pages = loadWikiPages(view).pages;
  for (const [path, content] of Object.entries(generatedCoreFiles(pages, readConfig(view).name))) {
    put(root, path, content);
  }
  view = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(view, loadWikiPages(view).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "recursive boundary baseline"]);

  put(root, target, `export const changed = ${JSON.stringify(target)};\n`);
  run(root, ["git", "add", target]);
  run(root, ["git", "commit", "-qm", `change ${target}`]);
  return { root, cliPath };
}

describe("PV-16 recursive publisher boundary", () => {
  test("publisher and downstream policy recursively select nested wiki-engine files", () => {
    const view = createRepoView(process.cwd());
    const pages = loadWikiPages(view).pages;
    const architecture = pages.find((item) => item.data.id === "architecture/engine");
    if (!architecture) throw new Error("missing architecture/engine");

    expect(architecture.data.sources).toContainEqual({ glob: "scripts/wiki/**/*.ts" });
    const coverage = JSON.parse(readFileSync(".wiki/coverage.json", "utf8")) as { include: string[] };
    expect(coverage.include).toContain("scripts/wiki/**/*.ts");

    const nestedFiles = [
      "scripts/wiki/parsers/edge.ts",
      "scripts/wiki/parsers/edge.test.ts",
      "scripts/wiki/parsers/deeper/edge.ts",
    ];
    const sourceMap = buildSourceMap(pages);
    const publisherConfig = readConfig(view);
    const policy = publisherConfig.freshContext;
    if (!policy) throw new Error("missing publisher Fresh-context policy");

    const manifest: ReviewManifest = {
      version: 1,
      base_ref: "origin/main",
      merge_base_sha: "0".repeat(40),
      head_sha: "1".repeat(40),
      pr_metadata_digest: "2".repeat(64),
      impact_report_digest: "3".repeat(64),
      diff_digest: "4".repeat(64),
      affected_page_ids: ["architecture/engine"],
      affected_invariant_ids: [],
      affected_conflict_ids: [],
      file_digests: {},
      bundle_digest: "5".repeat(64),
    };

    for (const path of nestedFiles) {
      expect(coverage.include.some((pattern) => new Bun.Glob(pattern).match(path))).toBe(true);
      expect(mappedPages(sourceMap, path)).toContain("architecture/engine");
      expect(isHighRisk(publisherConfig, path)).toBe(true);
      const impact: ImpactReport = {
        base: "origin/main",
        mergeBase: manifest.merge_base_sha,
        changedFiles: [path],
        affectedPages: ["architecture/engine"],
        affectedConflicts: [],
        removedCurrentPages: [],
        stalePages: ["architecture/engine"],
        highRiskStalePages: ["architecture/engine"],
        advisoryStalePages: [],
        unmappedHighRisk: [],
        findings: [],
      };
      expect(evaluateFreshContextRequirement(policy, manifest, impact)).toEqual({
        applies: true,
        reasons: [`changed file matches scripts/wiki/**: ${path}`],
      });
    }

    const downstream = JSON.parse(readFileSync("kit/seed/.wiki/config.json", "utf8")) as {
      freshContext: { requiredWhen: { changedFileGlobs: string[] } };
    };
    expect(downstream.freshContext.requiredWhen.changedFileGlobs).toContain("scripts/wiki/**");
    for (const path of nestedFiles) {
      expect(downstream.freshContext.requiredWhen.changedFileGlobs.some((pattern) => new Bun.Glob(pattern).match(path))).toBe(true);
    }
  });

  for (const target of ["scripts/wiki/parsers/edge.ts", "scripts/wiki/parsers/edge.test.ts"]) {
    test(`a code-only ${target} change cannot pass both lint and enforced impact under ambient PR metadata`, () => {
      const { root, cliPath } = prepareFixture(target);
      const ambient = ambientPullRequestEnvironment();
      expect(AMBIENT_PULL_REQUEST_KEYS.every((key) => !(key in isolatedFixtureEnvironment(ambient)))).toBe(true);
      const lint = spawn(root, [process.execPath, cliPath, "lint", "--root", root, "--json"], ambient);
      expect(lint.exitCode).toBe(0);

      const impact = spawn(root, [
        process.execPath,
        cliPath,
        "impact",
        "--root",
        root,
        "--base",
        "HEAD~1",
        "--enforce",
        "--json",
      ], ambient);
      expect(impact.exitCode).toBe(1);
      const report = JSON.parse(impact.stdout.toString()) as ImpactReport;
      expect(report.affectedPages).toEqual(["architecture/engine"]);
      expect(report.highRiskStalePages).toEqual(["architecture/engine"]);
      expect(report.unmappedHighRisk).toEqual([]);
      expect(report.findings.map((finding) => finding.code)).toContain("stale-verification");

      const verify = spawn(root, [
        process.execPath,
        cliPath,
        "verify",
        "--root",
        root,
        "--page",
        "architecture/engine",
        "--unchanged",
        "This fixture change preserves the declared recursive engine contract.",
      ], ambient);
      expect(verify.exitCode).toBe(0);
      const reconciled = spawn(root, [
        process.execPath,
        cliPath,
        "impact",
        "--root",
        root,
        "--base",
        "HEAD~1",
        "--enforce",
        "--json",
      ], ambient);
      if (reconciled.exitCode !== 0) {
        throw new Error(`reconciled fixture impact failed:\n${reconciled.stdout.toString()}\n${reconciled.stderr.toString()}`);
      }
      expect(reconciled.exitCode).toBe(0);
    });
  }
});
