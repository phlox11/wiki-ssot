import { afterEach, describe, expect, test } from "bun:test";
import { dirname, join, relative } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRepoView } from "./repository-view";
import { loadWikiPages } from "./page-validation";
import { hashContent, jsonStable } from "./serialization";
import { impactReport, type PrMetadata } from "./impact";
import {
  buildFocusedReviewManifest,
  buildReviewManifest,
  makeReviewBundle,
  recursiveFiles,
  validateFocusedReviewManifest,
  validateReviewBundleBindings,
  type FocusedReviewManifest,
} from "./review-bundle";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function run(root: string, command: string[]) {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

function put(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "review-bundle-test-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Review Bundle Test"]);
  run(root, ["git", "config", "user.email", "review-bundle@example.invalid"]);
  const source = "src/contract.ts";
  const page = "wiki/architecture/contracts.md";
  const pageBody = `---
id: architecture/contracts
summary: Contract
kind: architecture
status: current
authority: observed
owners: ["@owner"]
sources:
  - path: src/contract.ts
---

# Contracts
`;
  put(root, source, "export const version = 1;\n");
  put(root, page, pageBody);
  put(root, ".wiki/config.json", jsonStable({ version: 1, name: "bundle", highRisk: ["src/**"], publishesKit: false }));
  put(root, ".wiki/state.json", jsonStable({ version: 1, pages: { "architecture/contracts": { sources: { [source]: hashContent("export const version = 1;\n") }, verification: { kind: "updated" } } } }));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "baseline"]);
  put(root, source, "export const version = 2;\n");
  run(root, ["git", "add", source]);
  run(root, ["git", "commit", "-qm", "candidate"]);
  return root;
}

function metadata(): PrMetadata {
  return {
    change_type: "refactor",
    semantic_change: false,
    wiki_action: "verify",
    affected_pages: ["architecture/contracts"],
    affected_invariants: [],
    touched_conflicts: [],
  };
}

function bundleFiles(root: string): Record<string, string> {
  const output = join(root, "bundle");
  const view = createRepoView(root);
  const pages = loadWikiPages(view).pages;
  const report = impactReport(view, pages, { base: "HEAD~1", metadata: metadata() });
  makeReviewBundle(view, pages, report, "bundle", metadata());
  return Object.fromEntries(recursiveFiles(output).map((path) => [relative(output, path), readFileSync(path, "utf8")]));
}

describe("review-bundle boundaries", () => {
  test("constructs focused roles, content-addressed objects, and a bound manifest", () => {
    const root = fixture();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: metadata() });
    const focused = buildFocusedReviewManifest(view, pages, report, metadata());
    expect(focused.body_roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "affected_page", id: "architecture/contracts", lifecycle: "head" }),
    ]));
    expect(focused.source_roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "src/contract.ts", roles: expect.arrayContaining(["changed_source", "affected_authority_source"]) }),
    ]));
    const manifest = buildReviewManifest(view, pages, report, metadata());
    expect(manifest.bundle_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.focused_manifest_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("validates every enclosing file digest and fails closed when an authority role is omitted", () => {
    const root = fixture();
    const files = bundleFiles(root);
    const manifest = JSON.parse(files["bundle/manifest.json"] ?? files["manifest.json"]) as ReturnType<typeof buildReviewManifest>;
    const focused = JSON.parse(files["bundle/focused-manifest.json"] ?? files["focused-manifest.json"]) as FocusedReviewManifest;
    const prefix = files["bundle/"] ? "bundle/" : "";
    const focusedPath = `${prefix}focused-manifest.json`;
    const objectPath = focused.body_roles.find((role) => role.role === "affected_page" && role.lifecycle === "head")?.digest;
    expect(objectPath).toBeString();
    const removed = focused.body_roles.filter((role) => !(role.role === "affected_page" && role.id === "architecture/contracts" && role.lifecycle === "head"));
    const tampered = { ...focused, body_roles: removed };
    const tamperedFiles = { ...files, [focusedPath]: jsonStable(tampered) };
    const findings = validateFocusedReviewManifest(tampered, tamperedFiles, manifest, true);
    expect(findings.map((item) => item.code)).toContain("focused-manifest-affected_page-missing");
    expect(validateReviewBundleBindings).toBe(validateFocusedReviewManifest);
  });

  test("emits no duplicate recursive paths and keeps the focused index deterministic", () => {
    const root = fixture();
    const files = bundleFiles(root);
    const paths = Object.keys(files);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("manifest.json");
  });
});
