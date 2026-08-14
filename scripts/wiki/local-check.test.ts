import { afterEach, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRepoView, generatedCoreFiles, loadWikiPages, readConfig, reviewCheck, validatePrMetadata, verifyState, type PrMetadata } from "./core";
import { localCheckDigest, parseLocalCheckResult, runLocalCheck, validateLocalCheckResult, type LocalCheckResult } from "./local-check";
import { jsonStable } from "./serialization";

const temporary: string[] = [];
const isGeneratedKitMirror = import.meta.dir.includes("/kit/files/");

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function run(root: string, command: string[]): string {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

function put(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function metadata(options: {
  affectedInvariants?: string[];
  freshContext?: Partial<NonNullable<PrMetadata["fresh_context"]>>;
} = {}): string {
  const mirror = {
    verdict: "PENDING" as const,
    reviewed_head_sha: "pending",
    bundle_digest: "pending",
    reviewer: "pending",
    evidence: [] as string[],
    ...options.freshContext,
  };
  const value: PrMetadata = {
    change_type: "refactor",
    semantic_change: false,
    wiki_action: "verify",
    affected_pages: [],
    affected_invariants: options.affectedInvariants ?? [],
    touched_conflicts: [],
    fresh_context: mirror,
  };
  return [
    `change_type: ${value.change_type}`,
    `semantic_change: ${value.semantic_change}`,
    `wiki_action: ${value.wiki_action}`,
    "affected_pages: []",
    `affected_invariants: [${(options.affectedInvariants ?? []).join(", ")}]`,
    "touched_conflicts: []",
    "fresh_context:",
    `  verdict: ${mirror.verdict}`,
    `  reviewed_head_sha: ${mirror.reviewed_head_sha}`,
    `  bundle_digest: ${mirror.bundle_digest}`,
    `  reviewer: ${mirror.reviewer}`,
    `  evidence: ${JSON.stringify(mirror.evidence)}`,
  ].join("\n");
}

function repo(options: { risk?: boolean; changed?: boolean; publishesKit?: boolean; toolkitChanged?: boolean; invariant?: boolean; authenticatedPolicy?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-local-check-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Local Test"]);
  run(root, ["git", "config", "user.email", "wiki-local@example.invalid"]);
  put(root, ".wiki/config.json", jsonStable({
    version: 1,
    name: "local-check-test",
    publishesKit: options.publishesKit === true,
    highRisk: options.risk ? ["src/**"] : [],
    freshContext: {
      mode: "required",
      requiredVerdict: "PASS",
      evidenceRequired: true,
      requiredWhen: {
        kind: "risk-based",
        changedFileGlobs: options.risk ? ["src/**"] : ["scripts/wiki/**"],
        affectedInvariants: true,
        affectedConflicts: true,
        removedCurrentPages: true,
      },
      trust: {
        allowedReviewers: options.authenticatedPolicy ? ["trusted-reviewer"] : ["*"],
        requireDifferentActor: options.authenticatedPolicy === true,
        requireAuthenticatedActor: options.authenticatedPolicy === true,
      },
    },
  }));
  put(root, "src/value.ts", "export const value = 1;\n");
  put(root, "wiki/product/test.md", [
    "---", "id: product/test", "summary: Local check test", "kind: product", "status: current",
    "authority: observed", "owners: [\"@owner\"]", "sources:", "  - path: src/value.ts", "---", "", "# Test", "",
  ].join("\n"));
  if (options.invariant) {
    put(root, "wiki/product/invariant.md", [
      "---", "id: product/invariant", "summary: Local check invariant", "kind: invariant", "status: current",
      "authority: normative", "owners: [\"@owner\"]", "sources:", "  - path: src/value.ts", "---", "", "# Invariant", "",
    ].join("\n"));
  }
  const view = createRepoView(root);
  if (options.authenticatedPolicy) {
    put(root, "AGENTS.md", readFileSync(join(process.cwd(), "AGENTS.md"), "utf8"));
    put(root, "package.json", readFileSync(join(process.cwd(), "package.json"), "utf8"));
    put(root, "wiki/changelog.md", "# Changelog\n");
    for (const [path, content] of Object.entries(generatedCoreFiles(loadWikiPages(view).pages, readConfig(view).name))) put(root, path, content);
  }
  const completeView = createRepoView(root);
  put(root, ".wiki/state.json", jsonStable(verifyState(completeView, loadWikiPages(completeView).pages, [], undefined)));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "baseline"]);
  if (options.changed) {
    put(root, "src/value.ts", "export const value = 2;\n");
    const changedView = createRepoView(root);
    put(root, ".wiki/state.json", jsonStable(verifyState(changedView, loadWikiPages(changedView).pages, [], undefined)));
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "change"]);
  }
  if (options.toolkitChanged) {
    put(root, "scripts/wiki/local-check.ts", "export const toolkitChange = true;\n");
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "toolkit change"]);
  }
  return root;
}

function syntheticResult(head: string, ok = true): LocalCheckResult {
  const core: Omit<LocalCheckResult, "result_digest"> = {
    version: 1,
    status: ok ? "pass" : "failure",
    ok,
    head_sha: head,
    base_ref: "HEAD",
    base_sha: head,
    merge_base_sha: head,
    metadata_digest: "1".repeat(64),
    checks: {
      structural: { ok, findings: [] },
      state: { ok, findings: [] },
      impact: {
        base: "HEAD", merge_base: head, changed_files: [], affected_pages: [], affected_invariants: [],
        affected_conflicts: [], removed_current_pages: [], stale_pages: [], high_risk_stale_pages: [],
        advisory_stale_pages: [], unmapped_high_risk: [], findings: [],
      },
      review: {
        ok, required: false, status: "not-required", mode: "required", requirement_reasons: [], findings: [],
        affected_invariants: [], affected_conflicts: [],
      },
      tooling: { selected: false, changed_files: [], commands: [], findings: [], ok: true },
    },
    findings: [], warnings: [],
  };
  return { ...core, result_digest: localCheckDigest(core) };
}

describe("canonical local check result", () => {
  test("is deterministic and binds exact HEAD/base/metadata/check summaries", () => {
    const root = repo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const first = runLocalCheck({ root, view, pages, base: "HEAD", metadataRaw: metadata(), dirtyPaths: [] });
    const second = runLocalCheck({ root, view, pages, base: "HEAD", metadataRaw: metadata(), dirtyPaths: [] });
    expect(first).toEqual(second);
    expect(first.result_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.head_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(first.base_sha).toBe(first.head_sha);
    expect(first.metadata_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(validateLocalCheckResult(first)).toEqual([]);
  });

  test("rejects tampered result content and accepts a round trip", () => {
    const root = repo();
    const view = createRepoView(root);
    const result = runLocalCheck({ root, view, pages: loadWikiPages(view).pages, base: "HEAD", metadataRaw: metadata(), dirtyPaths: [] });
    expect(parseLocalCheckResult(JSON.stringify(result))).toEqual(result);
    const tampered = { ...result, metadata_digest: "0".repeat(64) };
    expect(validateLocalCheckResult(tampered).map((item) => item.code)).toContain("local-result-digest-invalid");

    const changedRoot = repo({ risk: true, changed: true });
    const changedView = createRepoView(changedRoot);
    const changed = runLocalCheck({ root: changedRoot, view: changedView, pages: loadWikiPages(changedView).pages, base: "HEAD~1", metadataRaw: metadata(), dirtyPaths: [] });
    const changedFiles = [...changed.checks.impact.changed_files];
    expect(changedFiles.length).toBeGreaterThan(0);
    const changedPath = { ...changed, checks: { ...changed.checks, impact: { ...changed.checks.impact, changed_files: changedFiles.map((path, index) => index === 0 ? "same-count-tamper.ts" : path) } } };
    expect(validateLocalCheckResult(changedPath).map((item) => item.code)).toContain("local-result-digest-invalid");
  });

  test("binds metadata-named and directly affected invariants into impact and review", () => {
    const metadataRoot = repo({ invariant: true });
    const metadataView = createRepoView(metadataRoot);
    const metadataResult = runLocalCheck({
      root: metadataRoot,
      view: metadataView,
      pages: loadWikiPages(metadataView).pages,
      base: "HEAD",
      metadataRaw: metadata({ affectedInvariants: ["product/invariant"] }),
      dirtyPaths: [],
    });
    expect(metadataResult.checks.impact.affected_invariants).toEqual(["product/invariant"]);
    expect(metadataResult.checks.review.affected_invariants).toEqual(["product/invariant"]);
    expect(validateLocalCheckResult(metadataResult)).toEqual([]);

    const changedRoot = repo({ invariant: true, changed: true });
    const changedView = createRepoView(changedRoot);
    const changedResult = runLocalCheck({
      root: changedRoot,
      view: changedView,
      pages: loadWikiPages(changedView).pages,
      base: "HEAD~1",
      metadataRaw: metadata(),
      dirtyPaths: [],
    });
    expect(changedResult.checks.impact.affected_invariants).toEqual(["product/invariant"]);
    expect(changedResult.checks.review.affected_invariants).toEqual(["product/invariant"]);
    expect(validateLocalCheckResult(changedResult)).toEqual([]);
  });

  test("binds reviewer and PR actors for an authenticated exact PASS", () => {
    const root = repo({ risk: true, changed: true, authenticatedPolicy: true });
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const pendingMetadataRaw = metadata();
    const pendingMetadata = validatePrMetadata(pendingMetadataRaw, true).metadata;
    if (!pendingMetadata) throw new Error("test metadata did not parse");
    const pending = reviewCheck(view, pages, { base: "HEAD~1", metadata: pendingMetadata });
    expect(pending.required).toBe(true);
    const report = {
      version: 1 as const,
      verdict: "PASS" as const,
      reviewed_head_sha: pending.manifest.head_sha,
      merge_base_sha: pending.manifest.merge_base_sha,
      bundle_digest: pending.manifest.bundle_digest,
      reviewer: "trusted-reviewer",
      evidence: ["The exact candidate and current contract were independently checked."],
      summary: "The implementation evidence and current wiki contract agree.",
    };
    const passMetadataRaw = metadata({
      freshContext: {
        verdict: report.verdict,
        reviewed_head_sha: report.reviewed_head_sha,
        bundle_digest: report.bundle_digest,
        reviewer: report.reviewer,
        evidence: report.evidence,
      },
    });
    const pass = runLocalCheck({
      root,
      view,
      pages,
      base: "HEAD~1",
      metadataRaw: passMetadataRaw,
      reportRaw: jsonStable(report),
      dirtyPaths: [],
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    });
    expect(pass.ok).toBe(true);
    expect(pass.checks.review.status).toBe("pass");
    expect(validateLocalCheckResult(pass)).toEqual([]);

    const missingActor = runLocalCheck({
      root,
      view,
      pages,
      base: "HEAD~1",
      metadataRaw: passMetadataRaw,
      reportRaw: jsonStable(report),
      dirtyPaths: [],
      prAuthor: "author",
    });
    expect(missingActor.ok).toBe(false);
    expect(missingActor.checks.review.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "fresh-context-reviewer-untrusted" }),
    ]));
  });

  test("fails closed when the requested base cannot be resolved", () => {
    const root = repo();
    const view = createRepoView(root);
    expect(() => runLocalCheck({ root, view, pages: loadWikiPages(view).pages, base: "not-a-revision", metadataRaw: metadata(), dirtyPaths: [] })).toThrow(/revision does not exist/);
  });

  test("fails closed on malformed nested check arrays without throwing", () => {
    const malformed = {
      version: 1,
      status: "pass",
      ok: true,
      head_sha: "1".repeat(40),
      base_ref: "HEAD",
      base_sha: "1".repeat(40),
      merge_base_sha: "1".repeat(40),
      metadata_digest: "1".repeat(64),
      checks: { structural: { ok: true, findings: "not-an-array" } },
      findings: [],
      warnings: [],
      result_digest: "1".repeat(64),
    };
    expect(() => validateLocalCheckResult(malformed)).not.toThrow();
    expect(validateLocalCheckResult(malformed).map((item) => item.code)).toContain("local-result-checks");
  });

  test("rejects dirty candidate paths while allowing the caller to provide them", () => {
    const root = repo();
    const view = createRepoView(root);
    put(root, "src/dirty.ts", "export const dirty = true;\n");
    const result = runLocalCheck({ root, view, pages: loadWikiPages(view).pages, base: "HEAD", metadataRaw: metadata() });
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "local-check-dirty", path: "src/dirty.ts" }),
    ]));
  });

  test("selects review-required for a risk change and not-required otherwise", () => {
    const requiredRoot = repo({ risk: true, changed: true });
    const requiredView = createRepoView(requiredRoot);
    const required = runLocalCheck({ root: requiredRoot, view: requiredView, pages: loadWikiPages(requiredView).pages, base: "HEAD~1", metadataRaw: metadata(), dirtyPaths: [] });
    expect(required.checks.review.status).toBe("review-required");
    expect(required.checks.review.required).toBe(true);

    const optionalRoot = repo({ risk: false, changed: false });
    const optionalView = createRepoView(optionalRoot);
    const optional = runLocalCheck({ root: optionalRoot, view: optionalView, pages: loadWikiPages(optionalView).pages, base: "HEAD", metadataRaw: metadata(), dirtyPaths: [] });
    expect(optional.checks.review.status).toBe("not-required");
    expect(optional.checks.review.required).toBe(false);
  });

  test("orchestrates publisher toolkit checks through an injected argv runner", () => {
    const root = repo({ publishesKit: true, toolkitChanged: true });
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const calls: string[][] = [];
    let run = 0;
    const runner = (argv: string[], cwd: string) => {
      expect(cwd).toBe(root);
      calls.push(argv);
      run += 1;
      return {
        exitCode: 0,
        stdout: `ok [${run}ms] ${root}/.cache/test peak-rss=${run * 10}MB\n`,
        stderr: "",
      };
    };
    const first = runLocalCheck({
      root,
      view,
      pages,
      base: "HEAD~1",
      metadataRaw: metadata(),
      dirtyPaths: [],
      runToolingChecks: true,
      argvRunner: runner,
    });
    const second = runLocalCheck({
      root,
      view,
      pages,
      base: "HEAD~1",
      metadataRaw: metadata(),
      dirtyPaths: [],
      runToolingChecks: true,
      argvRunner: runner,
    });
    expect(calls.map((argv) => argv.join(" "))).toEqual([
      "bun run wiki:tooling:typecheck",
      "bun run wiki:tooling:test",
      "bun run wiki:kit -- --check",
      "bun run wiki:tooling:guard",
      "bun run wiki:tooling:typecheck",
      "bun run wiki:tooling:test",
      "bun run wiki:kit -- --check",
      "bun run wiki:tooling:guard",
    ]);
    expect(first.checks.tooling).toMatchObject({ selected: true, ok: true, changed_files: ["scripts/wiki/local-check.ts"] });
    expect(first.checks.tooling.commands).toHaveLength(4);
    expect(first.checks.tooling.commands[0]).toMatchObject({
      id: "tooling-typecheck",
      argv: ["bun", "run", "wiki:tooling:typecheck"],
      exit_code: 0,
      ok: true,
    });
    expect(first).toEqual(second);
    expect(first.checks.tooling).toEqual(second.checks.tooling);
  });

  test("makes a failed injected toolkit command fail the canonical result", () => {
    const root = repo({ publishesKit: true, toolkitChanged: true });
    const view = createRepoView(root);
    const result = runLocalCheck({
      root,
      view,
      pages: loadWikiPages(view).pages,
      base: "HEAD~1",
      metadataRaw: metadata(),
      dirtyPaths: [],
      runToolingChecks: true,
      argvRunner: (argv) => ({
        exitCode: argv.includes("wiki:tooling:test") ? 7 : 0,
        stdout: "tooling output\n",
        stderr: "",
      }),
    });
    expect(result.checks.tooling.ok).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tooling-check-failed", severity: "error" }),
    ]));
  });

  test("keeps legacy check behavior when no output flag is selected", async () => {
    if (isGeneratedKitMirror) return;
    const { runCli } = await import("./cli");
    const output: string[] = [];
    const errors: string[] = [];
    const code = runCli(["check", "--base", "HEAD", "--json"], {
      cwd: process.cwd(),
      io: { stdout: (value) => output.push(value), stderr: (value) => errors.push(value) },
    });
    expect([0, 1]).toContain(code);
    expect(output.join("")).toContain("impact");
    expect(output.join("")).not.toContain("result_digest");
  });
});
