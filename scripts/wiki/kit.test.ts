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
  validateIntegrationSeams,
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
    const missing = KIT_ENTRIES.flatMap((entry) => {
      const paths = entry.source.kind === "literal" ? []
        : entry.source.kind === "legacy-v1-workflow" ? [entry.source.host, entry.source.wiki]
          : [entry.source.from];
      return paths.filter((path) => !view.exists(path)).map((path) => `${entry.target} <- ${path}`);
    });
    expect(missing).toEqual([]);
  });

  test("targets and emitted paths are unique", () => {
    const targets = KIT_ENTRIES.map((entry) => entry.target);
    expect(new Set(targets).size).toBe(targets.length);
    const paths = KIT_ENTRIES.map(kitPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("placement decides the emitted directory", () => {
    expect(kitPath({ target: "AGENTS.md", placement: "files" })).toBe("kit/files/AGENTS.md");
    expect(kitPath({ target: "AGENTS.md", placement: "managed" })).toBe("kit/managed/AGENTS.md");
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
    const leaked = KIT_ENTRIES.filter((entry) => entry.source.kind === "strip" || entry.source.kind === "managed-block")
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

  test("ships the work command and its dedicated regression suite", () => {
    const { files } = realKit();
    expect(files["kit/files/scripts/wiki/work.test.ts"]).toContain("generic fresh-session prompts");
    const fragment = JSON.parse(files["kit/package.kit.json"]);
    expect(fragment.scripts["wiki:work"]).toBe("bun scripts/wiki/cli.ts work");
  });

  test("ships each KM-02 module and focused suite exactly once", () => {
    const { files } = realKit();
    const targets = [
      "scripts/wiki/discovery.ts",
      "scripts/wiki/context.ts",
      "scripts/wiki/generated-views.ts",
      "scripts/wiki/discovery.test.ts",
      "scripts/wiki/context.test.ts",
      "scripts/wiki/generated-views.test.ts",
    ];
    for (const target of targets) {
      expect(KIT_ENTRIES.filter((entry) => entry.target === target)).toHaveLength(1);
      expect(files[`kit/files/${target}`]).toBeString();
    }
  });

  test("keeps publisher-only kit commands out of the downstream workflow", () => {
    const { view, files } = realKit();
    const publisherWorkflow = view.read("wiki/WORKFLOW.md");
    const downstreamWorkflow = files["kit/files/wiki/WORKFLOW.md"];
    const fragment = JSON.parse(files["kit/package.kit.json"]) as {
      scripts: Record<string, string>;
    };

    expect(publisherWorkflow).toContain("bun run wiki:kit");
    expect(publisherWorkflow).toContain("bun run wiki:kit -- --check");
    expect(fragment.scripts["wiki:kit"]).toBeUndefined();
    expect(downstreamWorkflow).not.toContain("wiki:kit");
  });

  test("drops guidance that points at pages only this repository has", () => {
    const { files } = realKit();
    expect(readFileSync("AGENTS.md", "utf8")).toContain("protected-main");
    expect(files["kit/managed/AGENTS.md"]).not.toContain("protected-main");
    expect(files["kit/files/wiki/WORKFLOW.md"]).not.toContain("protected-main");
  });

  test("keeps the base-engine bundle rule, which applies downstream too", () => {
    // The shipped wiki-ssot.yml does the same base.sha checkout and the shipped
    // policy lists scripts/wiki/** as review-triggering, so an adopter editing
    // the engine hits the same digest recomputation. Stripping it from the
    // entrypoint while wiki/WORKFLOW.md kept it left the two disagreeing.
    const { files } = realKit();
    expect(files["kit/managed/AGENTS.md"]).toContain("base-checkout");
    expect(files["kit/files/wiki/WORKFLOW.md"]).toContain("merge-base engine");
  });

  test("ships bounded reusable-context and orchestration guidance downstream", () => {
    const agents = realKit().files["kit/managed/AGENTS.md"];
    for (const required of [
      "bun run wiki:context -- --work <ID> --artifact <path> --metadata <pr-body> --base <ref>",
      "--reuse <path>",
      "Reuse never replaces reading the listed current pages and sources directly",
      "batch independent reads and deterministic checks and do not rerun `wiki:work` or broad context discovery",
      "Use bounded waits for running work rather than status polling",
      "Keep successful summaries bounded and point to digest-addressed full evidence",
      "one bounded phase handoff before publication",
      "the context-isolated reviewer are mandatory and remain separate",
      "provider-specific fan-out is optional",
      "does not promise provider cache continuity, approval behavior, model routing",
    ]) {
      expect(agents).toContain(required);
    }
  });

  test("ships the warning that branch protection matches on check name", () => {
    // wiki-ssot.yml is part of the payload, so every adopting repository inherits
    // the seam, while the wiki page and docs that explained it stay behind here.
    expect(realKit().files["kit/managed/AGENTS.md"]).toContain("keeps a required job's name");
  });
});

describe("kit manifest", () => {
  function manifest() {
    return JSON.parse(realKit().files[`kit/files/${KIT_MANIFEST_TARGET}`]) as {
      digest: string;
      files: Record<string, { sha256: string; ownership: "kit" | "seed" }>;
      managed: Record<string, { sha256: string; start: string; end: string }>;
      reference: Record<string, string>;
    };
  }

  test("records ownership derived from placement", () => {
    const parsed = manifest();
    expect(parsed.managed["AGENTS.md"].start).toBe("<!-- wiki-ssot:managed:start -->");
    expect(parsed.files[".wiki/config.json"].ownership).toBe("seed");
  });

  test("keeps reference files out of the synced file map but inside the kit", () => {
    const parsed = manifest();
    expect(KIT_MANIFEST_TARGET in parsed.files).toBe(false);
    expect("package.kit.json" in parsed.files).toBe(false);
    expect("package.kit.json" in parsed.reference).toBe(true);
    expect("migrations/v1/checks.yml" in parsed.reference).toBe(true);
    expect("migrations/v1/host-checks.yml" in parsed.reference).toBe(true);
    expect(Object.keys(parsed.files).length).toBe(KIT_ENTRIES.filter((entry) => entry.placement === "files" || entry.placement === "seed").length);
    expect(Object.keys(parsed.managed).length).toBe(KIT_ENTRIES.filter((entry) => entry.placement === "managed").length);
  });

  test("locks the exact version 1 workflow and its host-only migration result", () => {
    const { files } = realKit();
    const legacy = files["kit/migrations/v1/checks.yml"];
    const host = files["kit/migrations/v1/host-checks.yml"];
    expect(sha256(legacy)).toBe("53d46f240a5f4ee78327cae0d1e221ded01bd7b36b714c16121dd1256b1d92d5");
    expect(legacy).toContain("code-check:");
    expect(legacy).toContain("wiki-structure:");
    expect(host).toContain("code-check:");
    expect(host).not.toContain("wiki-structure:");
  });

  test("the digest covers reference files too", () => {
    // A dependency bump reaches an adopter only through package.kit.json. If the
    // digest ignored it, every "are you up to date" check would say nothing moved.
    const parsed = manifest();
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(jsonStable({ files: parsed.files, managed: parsed.managed, reference: parsed.reference }));
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
    for (const [target, meta] of Object.entries(manifest().managed)) {
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(files[kitPath({ target, placement: "managed" })]);
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
    expect(readFileSync(join(repo, "scripts/wiki/work.test.ts"), "utf8")).toContain("generic fresh-session prompts");
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
