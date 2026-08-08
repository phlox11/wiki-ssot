import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRepoView } from "./core";
import { KIT_ENTRIES, KIT_MANIFEST_TARGET, kitFiles, kitPath } from "./kit-packaging";

/** The kit as this repository actually publishes it. */
function realKit() {
  const view = createRepoView(process.cwd());
  return { view, ...kitFiles(view) };
}

describe("publisher kit entry table", () => {
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
});

describe("publisher emitted kit", () => {
  test("renders every entry without a source finding", () => {
    const { files, findings } = realKit();
    expect(findings).toEqual([]);
    expect(Object.keys(files).length).toBe(KIT_ENTRIES.length + 1);
  });

  test("at least one shipped file is actually stripped, so the check is not vacuous", () => {
    const { files } = realKit();
    const shrunk = KIT_ENTRIES.filter((entry) => entry.source.kind === "strip")
      .filter((entry) => files[kitPath(entry)] !== readFileSync((entry.source as { from: string }).from, "utf8"));
    expect(shrunk.length).toBeGreaterThan(0);
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
});

describe("publisher kit manifest", () => {
  function manifest() {
    return JSON.parse(realKit().files[`kit/files/${KIT_MANIFEST_TARGET}`]) as {
      digest: string;
      files: Record<string, { sha256: string; ownership: "kit" | "seed" }>;
      managed: Record<string, { sha256: string; start: string; end: string }>;
      reference: Record<string, string>;
    };
  }

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
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(legacy);
    expect(hasher.digest("hex")).toBe("7b80d39485cd5d7b65c088cea39cdf085866371f3c13ab012e760b7d66f0efac");
    expect(legacy).toContain("code-check:");
    expect(legacy).toContain("wiki-structure:");
    expect(host).toContain("code-check:");
    expect(host).not.toContain("wiki-structure:");
  });
});
