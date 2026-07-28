import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  KIT_ENTRIES,
  KIT_EXCLUDE_END,
  KIT_EXCLUDE_START,
  KIT_MANIFEST_TARGET,
  compareKit,
  createRepoView,
  isImplementationSourceChange,
  isKitManagedPath,
  kitFiles,
  kitPath,
  stripKitExclusions,
  writeKit,
} from "./core";
import { applySync, planSync, type SyncAction } from "./kit-sync";

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

  test("the derived copy carries no wiki obligation of its own", () => {
    expect(isImplementationSourceChange("scripts/wiki/core.ts")).toBe(true);
    expect(isImplementationSourceChange("kit/files/scripts/wiki/core.ts")).toBe(false);
  });
});

describe("emitted kit", () => {
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

  test("keeps the integration marker that doctor requires downstream", () => {
    // core.ts fails a repository whose AGENTS.md lost this marker, so stripping
    // instance-only guidance must never take the marker with it.
    expect(realKit().files["kit/files/AGENTS.md"]).toContain("wiki-ssot:fresh-context-guardrail");
  });

  test("drops instance-only guidance from the shipped AGENTS.md", () => {
    const shipped = realKit().files["kit/files/AGENTS.md"];
    expect(readFileSync("AGENTS.md", "utf8")).toContain("base-checkout");
    expect(shipped).not.toContain("base-checkout");
    expect(shipped).not.toContain("protected-main");
  });
});

describe("kit manifest", () => {
  function manifest() {
    return JSON.parse(realKit().files[`kit/files/${KIT_MANIFEST_TARGET}`]) as {
      digest: string;
      files: Record<string, { sha256: string; ownership: "kit" | "seed" }>;
    };
  }

  test("records ownership derived from placement", () => {
    const entries = manifest().files;
    expect(entries["AGENTS.md"].ownership).toBe("kit");
    expect(entries[".wiki/config.json"].ownership).toBe("seed");
  });

  test("omits itself and every reference file", () => {
    const entries = manifest().files;
    expect(KIT_MANIFEST_TARGET in entries).toBe(false);
    expect("package.kit.json" in entries).toBe(false);
    expect(Object.keys(entries).length).toBe(KIT_ENTRIES.filter((entry) => entry.placement !== "reference").length);
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

  test("writing removes orphans and then compares clean", () => {
    const root = tempRepo();
    put(root, "kit/files/gone.txt", "stale payload");
    const expected = { "kit/files/kept.txt": "kept" };
    const result = writeKit(createRepoView(root), expected);
    expect(result.removed).toEqual(["kit/files/gone.txt"]);
    expect(compareKit(createRepoView(root), expected)).toEqual([]);
  });
});

describe("kit sync", () => {
  function stageKit(): string {
    const root = tempDir("kit-src-");
    const { files } = realKit();
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path.replace(/^kit\//, ""))), { recursive: true });
      writeFileSync(join(root, path.replace(/^kit\//, "")), content);
    }
    return root;
  }

  function actionFor(plan: ReturnType<typeof planSync>, target: string): SyncAction | undefined {
    return plan.entries.find((entry) => entry.target === target)?.action;
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
    expect(readFileSync(join(repo, KIT_MANIFEST_TARGET), "utf8").length).toBeGreaterThan(0);
  });

  test("a second run reports nothing to do", () => {
    const kit = stageKit();
    const repo = tempDir("kit-dest-");
    applySync(kit, repo, planSync(kit, repo));
    const plan = planSync(kit, repo);
    expect(actionFor(plan, "AGENTS.md")).toBe("unchanged");
    expect(actionFor(plan, ".wiki/config.json")).toBe("seed-present");
  });

  test("an untouched file is updated when the kit moves", () => {
    const kit = stageKit();
    const repo = tempDir("kit-dest-");
    applySync(kit, repo, planSync(kit, repo));
    writeFileSync(join(kit, "files/AGENTS.md"), `${readFileSync(join(kit, "files/AGENTS.md"), "utf8")}\nupstream line\n`);
    const plan = planSync(kit, repo);
    expect(actionFor(plan, "AGENTS.md")).toBe("update");
    applySync(kit, repo, plan);
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain("upstream line");
  });

  test("a local edit is left alone when the kit did not move", () => {
    const kit = stageKit();
    const repo = tempDir("kit-dest-");
    applySync(kit, repo, planSync(kit, repo));
    writeFileSync(join(repo, "AGENTS.md"), "entirely mine\n");
    const plan = planSync(kit, repo);
    expect(actionFor(plan, "AGENTS.md")).toBe("customized");
    applySync(kit, repo, plan);
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toBe("entirely mine\n");
  });

  test("a local edit plus an upstream change conflicts without clobbering", () => {
    const kit = stageKit();
    const repo = tempDir("kit-dest-");
    applySync(kit, repo, planSync(kit, repo));
    const before = readFileSync(join(repo, KIT_MANIFEST_TARGET), "utf8");
    writeFileSync(join(repo, "AGENTS.md"), "mine\n");
    writeFileSync(join(kit, "files/AGENTS.md"), "theirs\n");

    const plan = planSync(kit, repo);
    expect(plan.conflicts).toEqual(["AGENTS.md"]);
    expect(plan.advanceManifest).toBe(false);
    applySync(kit, repo, plan);

    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toBe("mine\n");
    expect(readFileSync(join(repo, "AGENTS.md.kit-new"), "utf8")).toBe("theirs\n");
    // An unresolved conflict must not be downgraded to "your customization" by
    // advancing the recorded manifest underneath it.
    expect(readFileSync(join(repo, KIT_MANIFEST_TARGET), "utf8")).toBe(before);
  });

  test("an existing file with no recorded manifest is a conflict, not an overwrite", () => {
    const kit = stageKit();
    const repo = tempDir("kit-dest-");
    mkdirSync(join(repo, "wiki"), { recursive: true });
    writeFileSync(join(repo, "AGENTS.md"), "pre-existing instructions\n");
    const plan = planSync(kit, repo);
    expect(plan.conflicts).toEqual(["AGENTS.md"]);
    applySync(kit, repo, plan);
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toBe("pre-existing instructions\n");
  });

  test("an upgrade never rewrites a seed file", () => {
    const kit = stageKit();
    const repo = tempDir("kit-dest-");
    applySync(kit, repo, planSync(kit, repo));
    writeFileSync(join(repo, ".wiki/config.json"), '{"version":1,"name":"mine"}\n');
    writeFileSync(join(kit, "seed/.wiki/config.json"), '{"version":1,"name":"upstream"}\n');
    applySync(kit, repo, planSync(kit, repo));
    expect(readFileSync(join(repo, ".wiki/config.json"), "utf8")).toContain("mine");
  });

  test("a dry run writes nothing", () => {
    const kit = stageKit();
    const repo = tempDir("kit-dest-");
    planSync(kit, repo);
    expect(Bun.spawnSync(["ls", "-A", repo]).stdout.toString().trim()).toBe("");
  });
});
