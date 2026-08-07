import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  createRepoView,
  evaluateFreshContextRequirement,
  isImplementationSourceChange,
  kitFiles,
  parseFreshContextPolicy,
  readConfig,
  validateIntegrationSeams,
  type ImpactReport,
  type ReviewManifest,
} from "./core";
import { MANIFEST_TARGET, applySync, planSync, sha256 } from "./kit-sync";
const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
function tempDir(prefix = "kit-test-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(root);
  return root;
}
function tempRepo(): string {
  const root = tempDir();
  run(root, ["git", "init", "-q"]);
  return root;
}

function run(root: string, command: string[]) {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function put(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** The kit as this repository actually publishes it. */
function realKit() {
  const view = createRepoView(process.cwd());
  return { view, ...kitFiles(view) };
}


describe("kit entry table", () => {
  test("the derived copy carries no wiki obligation in the publishing repository", () => {
    expect(isImplementationSourceChange("scripts/wiki/core.ts", true)).toBe(true);
    expect(isImplementationSourceChange("kit/files/scripts/wiki/core.ts", true)).toBe(false);
  });

  test("a repository that does not publish a kit gets no kit/ exemption", () => {
    // This engine ships verbatim inside the kit, so an unconditional exemption
    // would disable the rails over any adopter's own kit/ directory.
    expect(isImplementationSourceChange("kit/files/scripts/wiki/core.ts")).toBe(true);
    expect(isImplementationSourceChange("kit/anything.ts", false)).toBe(true);
  });

  test("the exemption must be passed explicitly for every path", () => {
    // The flag is typed boolean so `files.some(isImplementationSourceChange)` is
    // a compile error; passing the array index would otherwise exempt every
    // element after the first. Callers bind it once, explicitly.
    const paths = ["a.ts", "kit/b.ts", "kit/c.ts"];
    expect(paths.map((path) => isImplementationSourceChange(path, true))).toEqual([true, false, false]);
    expect(paths.map((path) => isImplementationSourceChange(path, false))).toEqual([true, true, true]);
  });
});

describe("emitted kit", () => {
  test("review-selects this publisher's product-scope contract without leaking its paths downstream", () => {
    const publisherPolicy = readConfig(createRepoView(process.cwd())).freshContext;
    expect(publisherPolicy).toBeDefined();

    const manifest: ReviewManifest = {
      version: 1,
      base_ref: "origin/main",
      merge_base_sha: "0".repeat(40),
      head_sha: "1".repeat(40),
      pr_metadata_digest: "2".repeat(64),
      impact_report_digest: "3".repeat(64),
      diff_digest: "4".repeat(64),
      affected_page_ids: [],
      affected_invariant_ids: [],
      affected_conflict_ids: [],
      file_digests: {},
      bundle_digest: "5".repeat(64),
    };
    const productScopePaths = ["wiki/product/scope.md", "README.md", "docs/design.md"];
    for (const path of productScopePaths) {
      const impact: ImpactReport = {
        base: "origin/main",
        mergeBase: manifest.merge_base_sha,
        changedFiles: [path],
        affectedPages: [],
        affectedConflicts: [],
        removedCurrentPages: [],
        stalePages: [],
        highRiskStalePages: [],
        advisoryStalePages: [],
        unmappedHighRisk: [],
        findings: [],
      };
      expect(evaluateFreshContextRequirement(publisherPolicy!, manifest, impact)).toEqual({
        applies: true,
        reasons: [`changed file matches ${path}: ${path}`],
      });
    }

    const downstreamConfig = JSON.parse(realKit().files["kit/seed/.wiki/config.json"]) as { freshContext?: unknown };
    const downstreamPolicy = parseFreshContextPolicy(downstreamConfig.freshContext);
    expect(downstreamPolicy?.requiredWhen?.kind).toBe("risk-based");
    if (downstreamPolicy?.requiredWhen?.kind !== "risk-based") throw new Error("expected downstream risk-based policy");
    for (const path of productScopePaths) {
      expect(downstreamPolicy.requiredWhen.changedFileGlobs).not.toContain(path);
    }
  });

  test("keeps a complete provider-neutral agent entrypoint contract downstream", () => {
    const { files } = realKit();
    const installed = {
      ".wiki/config.json": files["kit/seed/.wiki/config.json"],
      "AGENTS.md": files["kit/managed/AGENTS.md"],
      "package.json": files["kit/package.kit.json"],
    };
    const view = {
      root: "/memory",
      mode: "working" as const,
      listFiles: () => Object.keys(installed).sort(),
      exists: (path: string) => path in installed,
      read: (path: string) => installed[path as keyof typeof installed] ?? "",
    };
    expect(validateIntegrationSeams(view)).toEqual([]);
  });

});




describe("kit sync", () => {
  const SYNC_TARGET = "wiki/README.md";
  const SECOND_SYNC_TARGET = "scripts/wiki/cli.ts";

  function stageKit(): string {
    const root = tempDir("kit-src-");
    for (const [path, content] of Object.entries(realKit().files)) {
      const target = join(root, path.replace(/^kit\//, ""));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    return root;
  }

  /** Rewrite a kit-owned file and re-hash it, the way a real upstream change would. */
  function moveUpstream(kit: string, target: string, content: string) {
    writeFileSync(join(kit, "files", target), content);
    const manifestPath = join(kit, "files", MANIFEST_TARGET);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.files[target].sha256 = sha256(content);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  function actionFor(plan: { entries: { target: string; action: string }[] }, target: string) {
    return plan.entries.find((entry) => entry.target === target)?.action;
  }

  function adopt(): { kit: string; repo: string } {
    const kit = stageKit();
    const repo = tempDir("kit-dest-");
    applySync(kit, repo, planSync(kit, repo));
    return { kit, repo };
  }

  test("a fresh target creates every kit file and seeds the rest", () => {
    const kit = stageKit();
    const repo = tempDir("kit-dest-");
    const plan = planSync(kit, repo);
    expect(plan.conflicts).toEqual([]);
    expect(actionFor(plan, SYNC_TARGET)).toBe("create");
    expect(actionFor(plan, ".wiki/config.json")).toBe("seed-created");
    applySync(kit, repo, plan);
    expect(readFileSync(join(repo, SYNC_TARGET), "utf8")).toContain("single source of truth");
    expect(readFileSync(join(repo, "scripts/wiki/work-topic-context.test.ts"), "utf8")).toContain("generic fresh-session prompts");
    for (const target of [
      "scripts/wiki/verification.ts",
      "scripts/wiki/impact.ts",
      "scripts/wiki/review-bundle.ts",
      "scripts/wiki/review-attestation.ts",
      "scripts/wiki/verification.test.ts",
      "scripts/wiki/impact.test.ts",
      "scripts/wiki/review-bundle.test.ts",
      "scripts/wiki/review-attestation.test.ts",
    ]) expect(readFileSync(join(repo, target), "utf8")).toContain("import");
  });

  test("a second run reports nothing to do", () => {
    const { kit, repo } = adopt();
    const plan = planSync(kit, repo);
    expect(actionFor(plan, SYNC_TARGET)).toBe("unchanged");
    expect(actionFor(plan, ".wiki/config.json")).toBe("seed-present");
  });

  test("an untouched file is updated when the kit moves", () => {
    const { kit, repo } = adopt();
    moveUpstream(kit, SYNC_TARGET, "upstream v2\n");
    const plan = planSync(kit, repo);
    expect(actionFor(plan, SYNC_TARGET)).toBe("update");
    applySync(kit, repo, plan);
    expect(readFileSync(join(repo, SYNC_TARGET), "utf8")).toBe("upstream v2\n");
  });

  test("a local edit is left alone when the kit did not move", () => {
    const { kit, repo } = adopt();
    writeFileSync(join(repo, SYNC_TARGET), "entirely mine\n");
    const plan = planSync(kit, repo);
    expect(actionFor(plan, SYNC_TARGET)).toBe("customized");
    applySync(kit, repo, plan);
    expect(readFileSync(join(repo, SYNC_TARGET), "utf8")).toBe("entirely mine\n");
  });

  test("a local edit plus an upstream change conflicts without clobbering", () => {
    const { kit, repo } = adopt();
    writeFileSync(join(repo, SYNC_TARGET), "mine\n");
    moveUpstream(kit, SYNC_TARGET, "theirs\n");
    const plan = planSync(kit, repo);
    expect(plan.conflicts).toEqual([SYNC_TARGET]);
    applySync(kit, repo, plan);
    expect(readFileSync(join(repo, SYNC_TARGET), "utf8")).toBe("mine\n");
    expect(readFileSync(join(repo, `${SYNC_TARGET}.kit-new`), "utf8")).toBe("theirs\n");
  });

  test("a hand-merged conflict terminates once accepted", () => {
    // Without --accept the merged file matches neither the incoming nor the
    // recorded version, so it would re-conflict on every future run forever.
    const { kit, repo } = adopt();
    writeFileSync(join(repo, SYNC_TARGET), "mine\n");
    moveUpstream(kit, SYNC_TARGET, "theirs\n");
    applySync(kit, repo, planSync(kit, repo));

    writeFileSync(join(repo, SYNC_TARGET), "mine + theirs\n");
    rmSync(join(repo, `${SYNC_TARGET}.kit-new`));
    expect(actionFor(planSync(kit, repo), SYNC_TARGET)).toBe("conflict");

    const accepted = planSync(kit, repo, [SYNC_TARGET]);
    expect(accepted.conflicts).toEqual([]);
    expect(actionFor(accepted, SYNC_TARGET)).toBe("resolved");
    applySync(kit, repo, accepted);

    expect(readFileSync(join(repo, SYNC_TARGET), "utf8")).toBe("mine + theirs\n");
    const after = planSync(kit, repo);
    expect(actionFor(after, SYNC_TARGET)).toBe("customized");
    expect(after.conflicts).toEqual([]);
  });

  test("one stuck conflict does not turn later clean updates into false conflicts", () => {
    // The manifest advances per file. A global advance would freeze the baseline
    // and make every subsequent upstream change look like the adopter's edit.
    const { kit, repo } = adopt();
    writeFileSync(join(repo, SYNC_TARGET), "mine\n");
    moveUpstream(kit, SYNC_TARGET, "theirs v2\n");
    moveUpstream(kit, SECOND_SYNC_TARGET, "cli v2\n");
    applySync(kit, repo, planSync(kit, repo));
    expect(readFileSync(join(repo, SECOND_SYNC_TARGET), "utf8")).toBe("cli v2\n");

    moveUpstream(kit, SECOND_SYNC_TARGET, "cli v3\n");
    const plan = planSync(kit, repo);
    expect(actionFor(plan, SECOND_SYNC_TARGET)).toBe("update");
    expect(plan.conflicts).toEqual([SYNC_TARGET]);
    applySync(kit, repo, plan);
    expect(readFileSync(join(repo, SECOND_SYNC_TARGET), "utf8")).toBe("cli v3\n");
  });

  test("an upgrade never rewrites a seed file", () => {
    const { kit, repo } = adopt();
    writeFileSync(join(repo, ".wiki/config.json"), '{"version":1,"name":"mine"}\n');
    writeFileSync(join(kit, "seed/.wiki/config.json"), '{"version":1,"name":"upstream"}\n');
    applySync(kit, repo, planSync(kit, repo));
    expect(readFileSync(join(repo, ".wiki/config.json"), "utf8")).toContain("mine");
  });

  test("an existing file with no recorded manifest is a conflict, but a matching one is not", () => {
    const kit = stageKit();
    const repo = tempDir("kit-dest-");
    mkdirSync(join(repo, "wiki"), { recursive: true });
    mkdirSync(join(repo, "scripts/wiki"), { recursive: true });
    writeFileSync(join(repo, SECOND_SYNC_TARGET), "pre-existing implementation\n");
    writeFileSync(join(repo, SYNC_TARGET), readFileSync(join(kit, "files", SYNC_TARGET), "utf8"));
    const plan = planSync(kit, repo);
    expect(plan.conflicts).toEqual([SECOND_SYNC_TARGET]);
    expect(actionFor(plan, SYNC_TARGET)).toBe("unchanged");
    applySync(kit, repo, plan);
    expect(readFileSync(join(repo, SECOND_SYNC_TARGET), "utf8")).toBe("pre-existing implementation\n");
  });

  test("a symlinked target is never written through", () => {
    const { kit, repo } = adopt();
    const outside = join(tempDir("kit-outside-"), "shared-wiki-readme.md");
    writeFileSync(outside, "shared\n");
    rmSync(join(repo, SYNC_TARGET));
    symlinkSync(outside, join(repo, SYNC_TARGET));
    moveUpstream(kit, SYNC_TARGET, "theirs\n");
    const plan = planSync(kit, repo);
    expect(actionFor(plan, SYNC_TARGET)).toBe("conflict");
    applySync(kit, repo, plan);
    expect(readFileSync(outside, "utf8")).toBe("shared\n");
  });

  test("a deleted reference file is never re-created", () => {
    // Seed placement cannot make a deletion stick: "seed" means "written when
    // absent", which is exactly re-creation. Reference files are never copied.
    const { kit, repo } = adopt();
    expect(existsSync(join(repo, "scripts/wiki/inventories.example.ts"))).toBe(false);
    expect(existsSync(join(repo, "package.kit.json"))).toBe(false);
    applySync(kit, repo, planSync(kit, repo));
    expect(existsSync(join(repo, "scripts/wiki/inventories.example.ts"))).toBe(false);
    expect(existsSync(join(repo, "package.kit.json"))).toBe(false);
  });

  test("a symlinked manifest is not written through", () => {
    // The manifest write bypasses classification, so it needs its own guard.
    const { kit, repo } = adopt();
    const outside = join(tempDir("kit-outside-"), "victim.json");
    writeFileSync(outside, "ORIGINAL\n");
    rmSync(join(repo, MANIFEST_TARGET));
    symlinkSync(outside, join(repo, MANIFEST_TARGET));
    expect(() => applySync(kit, repo, planSync(kit, repo))).toThrow(/symlink/);
    expect(readFileSync(outside, "utf8")).toBe("ORIGINAL\n");
  });

  test("a symlinked ancestor directory cannot smuggle writes outside", () => {
    // resolve()/relative() are lexical and do not follow links, so the lexical
    // test alone lets every target under a symlinked directory land outside.
    const kit = stageKit();
    const repo = tempDir("kit-dest-");
    const outside = tempDir("kit-outside-");
    symlinkSync(outside, join(repo, "scripts"));
    expect(() => planSync(kit, repo)).toThrow(/symlinked directory/);
    expect(Bun.spawnSync(["ls", "-A", outside]).stdout.toString().trim()).toBe("");
  });

  test("a manifest target that escapes the destination is refused", () => {
    const { kit, repo } = adopt();
    const manifestPath = join(kit, "files", MANIFEST_TARGET);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.files["../escaped.txt"] = { sha256: sha256("x"), ownership: "kit" };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(kit, "files/../escaped.txt"), "x");
    expect(() => planSync(kit, repo)).toThrow(/escapes the destination/);
  });

  test("a file the kit stopped shipping is reported once", () => {
    const { kit, repo } = adopt();
    const manifestPath = join(kit, "files", MANIFEST_TARGET);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    delete manifest.files["wiki/README.md"];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const plan = planSync(kit, repo);
    expect(actionFor(plan, "wiki/README.md")).toBe("removed-upstream");
    applySync(kit, repo, plan);
    expect(existsSync(join(repo, "wiki/README.md"))).toBe(true);
    expect(actionFor(planSync(kit, repo), "wiki/README.md")).toBeUndefined();
  });

  test("a malformed incoming manifest is refused rather than crashing", () => {
    const { kit, repo } = adopt();
    writeFileSync(join(kit, "files", MANIFEST_TARGET), '{"version":1,"files":null}\n');
    expect(() => planSync(kit, repo)).toThrow(/malformed/);
  });

  test("an executable source stays executable in the target", () => {
    const kit = stageKit();
    const repo = tempDir("kit-dest-");
    chmodSync(join(kit, "files", SECOND_SYNC_TARGET), 0o755);
    applySync(kit, repo, planSync(kit, repo));
    expect(statSync(join(repo, SECOND_SYNC_TARGET)).mode & 0o111).not.toBe(0);
  });

  test("a dry run writes nothing", () => {
    const kit = stageKit();
    const repo = tempDir("kit-dest-");
    planSync(kit, repo);
    expect(Bun.spawnSync(["ls", "-A", repo]).stdout.toString().trim()).toBe("");
  });
});
