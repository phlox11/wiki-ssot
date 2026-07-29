import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  KIT_ENTRIES,
  KIT_EXCLUDE_END,
  KIT_EXCLUDE_START,
  KIT_MANIFEST_TARGET,
  compareKit,
  createRepoView,
  evaluateFreshContextRequirement,
  isImplementationSourceChange,
  isKitManagedPath,
  jsonStable,
  kitFiles,
  kitPath,
  parseFreshContextPolicy,
  readConfig,
  stripKitExclusions,
  writeKit,
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

describe("kit:exclude stripping", () => {
  test("removes a marked region and both markers", () => {
    const result = stripKitExclusions(`keep one\n${KIT_EXCLUDE_START}\ndrop me\n${KIT_EXCLUDE_END}\nkeep two`);
    expect(result.error).toBeUndefined();
    expect(result.content).toBe("keep one\nkeep two");
  });

  test("leaves unmarked content byte-identical", () => {
    const raw = "# Title\n\n- a\n- b\n";
    expect(stripKitExclusions(raw).content).toBe(raw);
  });

  test("matches markers regardless of indentation", () => {
    const result = stripKitExclusions(`keep\n   ${KIT_EXCLUDE_START}\n   - nested bullet\n   ${KIT_EXCLUDE_END}\nkeep`);
    expect(result.content).toBe("keep\nkeep");
  });

  test("supports nested regions", () => {
    const result = stripKitExclusions(`a\n${KIT_EXCLUDE_START}\nb\n${KIT_EXCLUDE_START}\nc\n${KIT_EXCLUDE_END}\nd\n${KIT_EXCLUDE_END}\ne`);
    expect(result.content).toBe("a\ne");
  });

  test("refuses an unclosed region instead of truncating the file", () => {
    const raw = `a\n${KIT_EXCLUDE_START}\nb`;
    const result = stripKitExclusions(raw);
    expect(result.error).toContain("unclosed");
    expect(result.content).toBe(raw);
  });

  test("refuses a stray end marker", () => {
    const raw = `a\n${KIT_EXCLUDE_END}\nb`;
    const result = stripKitExclusions(raw);
    expect(result.error).toContain("unbalanced");
    expect(result.content).toBe(raw);
  });
});

describe("kit entry table", () => {
  test("every entry names a source that exists", () => {
    const view = createRepoView(process.cwd());
    const missing = KIT_ENTRIES.filter((entry) => entry.source.kind !== "literal" && !view.exists((entry.source as { from: string }).from));
    expect(missing.map((entry) => entry.target)).toEqual([]);
  });

  test("targets and emitted paths are unique", () => {
    const targets = KIT_ENTRIES.map((entry) => entry.target);
    expect(new Set(targets).size).toBe(targets.length);
    const paths = KIT_ENTRIES.map(kitPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("placement decides the emitted directory", () => {
    expect(kitPath({ target: "AGENTS.md", placement: "files" })).toBe("kit/files/AGENTS.md");
    expect(kitPath({ target: ".wiki/config.json", placement: "seed" })).toBe("kit/seed/.wiki/config.json");
    expect(kitPath({ target: "package.kit.json", placement: "reference" })).toBe("kit/package.kit.json");
  });

  test("kit/README.md is hand-written and stays out of generator ownership", () => {
    expect(isKitManagedPath("kit/README.md")).toBe(false);
    expect(isKitManagedPath("kit/files/AGENTS.md")).toBe(true);
    expect(isKitManagedPath("kit/package.kit.json")).toBe(true);
    expect(isKitManagedPath("scripts/wiki/core.ts")).toBe(false);
  });

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

  test("renders every entry without a source finding", () => {
    const { files, findings } = realKit();
    expect(findings).toEqual([]);
    expect(Object.keys(files).length).toBe(KIT_ENTRIES.length + 1);
  });

  test("is deterministic across runs", () => {
    expect(realKit().files).toEqual(realKit().files);
  });

  test("no exclusion marker survives a stripped file", () => {
    // Scoped to `strip` entries on purpose: the engine source legitimately ships
    // the marker text because it is where the constants are defined.
    const { files } = realKit();
    const leaked = KIT_ENTRIES.filter((entry) => entry.source.kind === "strip")
      .map((entry) => kitPath(entry))
      .filter((path) => files[path].includes(KIT_EXCLUDE_START) || files[path].includes(KIT_EXCLUDE_END));
    expect(leaked).toEqual([]);
  });

  test("at least one shipped file is actually stripped, so the check is not vacuous", () => {
    const { files } = realKit();
    const shrunk = KIT_ENTRIES.filter((entry) => entry.source.kind === "strip")
      .filter((entry) => files[kitPath(entry)] !== readFileSync((entry.source as { from: string }).from, "utf8"));
    expect(shrunk.length).toBeGreaterThan(0);
  });

  test("keeps the integration markers and work route that doctor requires downstream", () => {
    // core.ts fails a repository whose AGENTS.md lost this marker, so stripping
    // instance-only guidance must never take the marker with it.
    const agents = realKit().files["kit/files/AGENTS.md"];
    expect(agents).toContain("wiki-ssot:fresh-context-guardrail");
    expect(agents).toContain("wiki-ssot:work-discovery");
    expect(agents).toContain("bun run wiki:work");
  });

  test("ships the work command and its dedicated regression suite", () => {
    const { files } = realKit();
    expect(files["kit/files/scripts/wiki/work.test.ts"]).toContain("generic fresh-session prompts");
    const fragment = JSON.parse(files["kit/package.kit.json"]);
    expect(fragment.scripts["wiki:work"]).toBe("bun scripts/wiki/cli.ts work");
  });

  test("drops guidance that points at pages only this repository has", () => {
    const { files } = realKit();
    expect(readFileSync("AGENTS.md", "utf8")).toContain("protected-main");
    expect(files["kit/files/AGENTS.md"]).not.toContain("protected-main");
    expect(files["kit/files/wiki/WORKFLOW.md"]).not.toContain("protected-main");
  });

  test("keeps the base-engine bundle rule, which applies downstream too", () => {
    // The shipped checks.yml does the same base.sha checkout and the shipped
    // policy lists scripts/wiki/** as review-triggering, so an adopter editing
    // the engine hits the same digest recomputation. Stripping it from the
    // entrypoint while wiki/WORKFLOW.md kept it left the two disagreeing.
    const { files } = realKit();
    expect(files["kit/files/AGENTS.md"]).toContain("base-checkout");
    expect(files["kit/files/wiki/WORKFLOW.md"]).toContain("merge-base engine");
  });

  test("ships the warning that branch protection matches on check name", () => {
    // checks.yml is part of the payload, so every adopting repository inherits
    // the seam, while the wiki page and docs that explained it stay behind here.
    expect(realKit().files["kit/files/AGENTS.md"]).toContain("keeps a required job's name");
  });
});

describe("kit manifest", () => {
  function manifest() {
    return JSON.parse(realKit().files[`kit/files/${KIT_MANIFEST_TARGET}`]) as {
      digest: string;
      files: Record<string, { sha256: string; ownership: "kit" | "seed" }>;
      reference: Record<string, string>;
    };
  }

  test("records ownership derived from placement", () => {
    const entries = manifest().files;
    expect(entries["AGENTS.md"].ownership).toBe("kit");
    expect(entries[".wiki/config.json"].ownership).toBe("seed");
  });

  test("keeps reference files out of the synced file map but inside the kit", () => {
    const parsed = manifest();
    expect(KIT_MANIFEST_TARGET in parsed.files).toBe(false);
    expect("package.kit.json" in parsed.files).toBe(false);
    expect("package.kit.json" in parsed.reference).toBe(true);
    expect(Object.keys(parsed.files).length).toBe(KIT_ENTRIES.filter((entry) => entry.placement !== "reference").length);
  });

  test("the digest covers reference files too", () => {
    // A dependency bump reaches an adopter only through package.kit.json. If the
    // digest ignored it, every "are you up to date" check would say nothing moved.
    const parsed = manifest();
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(jsonStable({ files: parsed.files, reference: parsed.reference }));
    expect(hasher.digest("hex")).toBe(parsed.digest);

    const withoutReference = new Bun.CryptoHasher("sha256");
    withoutReference.update(jsonStable(parsed.files));
    expect(withoutReference.digest("hex")).not.toBe(parsed.digest);
  });

  test("hashes match the bytes actually shipped", () => {
    const { files } = realKit();
    for (const [target, meta] of Object.entries(manifest().files)) {
      const shipped = files[kitPath({ target, placement: meta.ownership === "kit" ? "files" : "seed" })];
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(shipped);
      expect(hasher.digest("hex")).toBe(meta.sha256);
    }
  });

  test("carries no timestamp or version tag that would churn", () => {
    const raw = realKit().files[`kit/files/${KIT_MANIFEST_TARGET}`];
    expect(raw).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(/[0-9a-f]{64}/.test(manifest().digest)).toBe(true);
  });
});

describe("kit drift detection", () => {
  test("reports a missing file, an edited file, and an orphan", () => {
    const root = tempRepo();
    put(root, "kit/files/a.txt", "expected a");
    put(root, "kit/files/b.txt", "hand-edited b");
    put(root, "kit/files/gone.txt", "no longer generated");
    put(root, "kit/README.md", "hand-written, not generated");
    const findings = compareKit(createRepoView(root), {
      "kit/files/a.txt": "expected a",
      "kit/files/b.txt": "expected b",
      "kit/files/c.txt": "expected c",
    });
    expect(findings.map((finding) => [finding.code, finding.path]).sort()).toEqual([
      ["kit-missing", "kit/files/c.txt"],
      ["kit-orphan", "kit/files/gone.txt"],
      ["kit-stale", "kit/files/b.txt"],
    ]);
  });

  test("writing removes orphans and then compares clean even once they are tracked", () => {
    const root = tempRepo();
    put(root, "kit/files/gone.txt", "stale payload");
    // Commit first: `git ls-files --cached` keeps listing a deleted file until
    // the deletion is staged, so an index-based orphan scan would re-report it.
    run(root, ["git", "add", "-A"]);
    run(root, ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"]);
    const expected = { "kit/files/kept.txt": "kept" };
    const result = writeKit(createRepoView(root), expected);
    expect(result.removed).toEqual(["kit/files/gone.txt"]);
    expect(compareKit(createRepoView(root), expected)).toEqual([]);
  });
});


describe("kit sync", () => {
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
    expect(actionFor(plan, "AGENTS.md")).toBe("create");
    expect(actionFor(plan, ".wiki/config.json")).toBe("seed-created");
    applySync(kit, repo, plan);
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain("wiki-ssot:fresh-context-guardrail");
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain("wiki-ssot:work-discovery");
    expect(readFileSync(join(repo, "scripts/wiki/work.test.ts"), "utf8")).toContain("generic fresh-session prompts");
  });

  test("a second run reports nothing to do", () => {
    const { kit, repo } = adopt();
    const plan = planSync(kit, repo);
    expect(actionFor(plan, "AGENTS.md")).toBe("unchanged");
    expect(actionFor(plan, ".wiki/config.json")).toBe("seed-present");
  });

  test("an untouched file is updated when the kit moves", () => {
    const { kit, repo } = adopt();
    moveUpstream(kit, "AGENTS.md", "upstream v2\n");
    const plan = planSync(kit, repo);
    expect(actionFor(plan, "AGENTS.md")).toBe("update");
    applySync(kit, repo, plan);
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toBe("upstream v2\n");
  });

  test("a local edit is left alone when the kit did not move", () => {
    const { kit, repo } = adopt();
    writeFileSync(join(repo, "AGENTS.md"), "entirely mine\n");
    const plan = planSync(kit, repo);
    expect(actionFor(plan, "AGENTS.md")).toBe("customized");
    applySync(kit, repo, plan);
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toBe("entirely mine\n");
  });

  test("a local edit plus an upstream change conflicts without clobbering", () => {
    const { kit, repo } = adopt();
    writeFileSync(join(repo, "AGENTS.md"), "mine\n");
    moveUpstream(kit, "AGENTS.md", "theirs\n");
    const plan = planSync(kit, repo);
    expect(plan.conflicts).toEqual(["AGENTS.md"]);
    applySync(kit, repo, plan);
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toBe("mine\n");
    expect(readFileSync(join(repo, "AGENTS.md.kit-new"), "utf8")).toBe("theirs\n");
  });

  test("a hand-merged conflict terminates once accepted", () => {
    // Without --accept the merged file matches neither the incoming nor the
    // recorded version, so it would re-conflict on every future run forever.
    const { kit, repo } = adopt();
    writeFileSync(join(repo, "AGENTS.md"), "mine\n");
    moveUpstream(kit, "AGENTS.md", "theirs\n");
    applySync(kit, repo, planSync(kit, repo));

    writeFileSync(join(repo, "AGENTS.md"), "mine + theirs\n");
    rmSync(join(repo, "AGENTS.md.kit-new"));
    expect(actionFor(planSync(kit, repo), "AGENTS.md")).toBe("conflict");

    const accepted = planSync(kit, repo, ["AGENTS.md"]);
    expect(accepted.conflicts).toEqual([]);
    expect(actionFor(accepted, "AGENTS.md")).toBe("resolved");
    applySync(kit, repo, accepted);

    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toBe("mine + theirs\n");
    const after = planSync(kit, repo);
    expect(actionFor(after, "AGENTS.md")).toBe("customized");
    expect(after.conflicts).toEqual([]);
  });

  test("one stuck conflict does not turn later clean updates into false conflicts", () => {
    // The manifest advances per file. A global advance would freeze the baseline
    // and make every subsequent upstream change look like the adopter's edit.
    const { kit, repo } = adopt();
    writeFileSync(join(repo, "AGENTS.md"), "mine\n");
    moveUpstream(kit, "AGENTS.md", "theirs v2\n");
    moveUpstream(kit, "wiki/README.md", "readme v2\n");
    applySync(kit, repo, planSync(kit, repo));
    expect(readFileSync(join(repo, "wiki/README.md"), "utf8")).toBe("readme v2\n");

    moveUpstream(kit, "wiki/README.md", "readme v3\n");
    const plan = planSync(kit, repo);
    expect(actionFor(plan, "wiki/README.md")).toBe("update");
    expect(plan.conflicts).toEqual(["AGENTS.md"]);
    applySync(kit, repo, plan);
    expect(readFileSync(join(repo, "wiki/README.md"), "utf8")).toBe("readme v3\n");
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
    writeFileSync(join(repo, "AGENTS.md"), "pre-existing instructions\n");
    writeFileSync(join(repo, "wiki/README.md"), readFileSync(join(kit, "files/wiki/README.md"), "utf8"));
    const plan = planSync(kit, repo);
    expect(plan.conflicts).toEqual(["AGENTS.md"]);
    expect(actionFor(plan, "wiki/README.md")).toBe("unchanged");
    applySync(kit, repo, plan);
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toBe("pre-existing instructions\n");
  });

  test("a symlinked target is never written through", () => {
    const { kit, repo } = adopt();
    const outside = join(tempDir("kit-outside-"), "shared-AGENTS.md");
    writeFileSync(outside, "shared\n");
    rmSync(join(repo, "AGENTS.md"));
    symlinkSync(outside, join(repo, "AGENTS.md"));
    moveUpstream(kit, "AGENTS.md", "theirs\n");
    const plan = planSync(kit, repo);
    expect(actionFor(plan, "AGENTS.md")).toBe("conflict");
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
    chmodSync(join(kit, "files/.husky/pre-commit"), 0o755);
    applySync(kit, repo, planSync(kit, repo));
    expect(statSync(join(repo, ".husky/pre-commit")).mode & 0o111).not.toBe(0);
  });

  test("a dry run writes nothing", () => {
    const kit = stageKit();
    const repo = tempDir("kit-dest-");
    planSync(kit, repo);
    expect(Bun.spawnSync(["ls", "-A", repo]).stdout.toString().trim()).toBe("");
  });
});
