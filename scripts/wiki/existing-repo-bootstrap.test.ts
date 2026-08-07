import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  allLintFindings,
  buildSourceMap,
  createRepoView,
  generatedCoreFiles,
  jsonStable,
  kitFiles,
  loadWikiPages,
  mappedPages,
  reviewCheck,
  validateCoverage,
  validateState,
  verifyState,
  writeGenerated,
  type FreshContextReportV2,
  type PrMetadata,
} from "./core";
import { MANIFEST_TARGET, applySync, planSync, sha256 } from "./kit-sync";
import { mergeManagedBlock } from "./apply";

const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(root);
  return root;
}

function put(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function run(root: string, command: string[]): string {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

/** Stage the exact content-addressed distribution this checkout publishes. */
function stageKit(): string {
  const root = tempDir("existing-bootstrap-kit-");
  const rendered = kitFiles(createRepoView(process.cwd()));
  expect(rendered.findings).toEqual([]);
  for (const [path, content] of Object.entries(rendered.files)) {
    put(root, path.replace(/^kit\//, ""), content);
  }
  return root;
}

function actionFor(plan: ReturnType<typeof planSync>, target: string): string | undefined {
  return plan.entries.find((entry) => entry.target === target)?.action;
}

/**
 * Move one staged kit file and keep its manifest content-addressed, modelling a
 * later published kit without depending on another repository checkout.
 */
function moveUpstream(kit: string, ownership: "kit" | "seed", target: string, content: string): void {
  put(kit, `${ownership === "kit" ? "files" : "seed"}/${target}`, content);
  const manifestPath = join(kit, "files", MANIFEST_TARGET);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    files: Record<string, { sha256: string; ownership: string }>;
    managed: Record<string, { sha256: string; start: string; end: string }>;
    reference: Record<string, string>;
    digest: string;
  };
  manifest.files[target].sha256 = sha256(content);
  manifest.digest = sha256(jsonStable({ files: manifest.files, managed: manifest.managed, reference: manifest.reference }));
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function moveManagedUpstream(kit: string, target: string, content: string): void {
  put(kit, `managed/${target}`, content);
  const manifestPath = join(kit, "files", MANIFEST_TARGET);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    files: Record<string, { sha256: string; ownership: string }>;
    managed: Record<string, { sha256: string; start: string; end: string }>;
    reference: Record<string, string>;
    digest: string;
  };
  manifest.managed[target].sha256 = sha256(content);
  manifest.digest = sha256(jsonStable({ files: manifest.files, managed: manifest.managed, reference: manifest.reference }));
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function mergePackageFragment(repo: string, kit: string): void {
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as {
    type?: string;
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
    [key: string]: unknown;
  };
  const fragment = JSON.parse(readFileSync(join(kit, "package.kit.json"), "utf8")) as typeof pkg;
  const scripts = { ...pkg.scripts };
  for (const [name, value] of Object.entries(fragment.scripts ?? {})) {
    if (scripts[name] == null || scripts[name] === value) scripts[name] = value;
  }
  // The existing repository owns this collision and deliberately extends its
  // test command so the host suite and shipped engine suites both run.
  scripts.test = "bun test src scripts/wiki";
  put(repo, "package.json", jsonStable({
    ...pkg,
    type: pkg.type ?? fragment.type,
    engines: { ...fragment.engines, ...pkg.engines },
    scripts,
    devDependencies: { ...fragment.devDependencies, ...pkg.devDependencies },
  }));
}

function billingPage(): string {
  return `---
id: product/billing
summary: Billing totals are calculated in integer cents with the configured tax basis points.
kind: product
status: current
authority: observed
owners: ["@billing"]
sources:
  - glob: src/billing/*.ts
---

# Billing

\`totalWithTax\` reads integer cents and applies the exported tax basis points.
The calculation and its executable example are the primary implementation evidence.
`;
}

function deliveryPage(): string {
  return `---
id: product/delivery
summary: Delivery dispatch currently returns accepted while its intended status remains unresolved.
kind: product
status: current
authority: observed
owners: ["@delivery"]
sources:
  - path: src/delivery/send.ts
  - path: src/delivery/contract.ts
---

# Delivery

The running implementation currently returns \`accepted\`. The adjacent contract
declares \`queued\`; this page does not invent which value should win and links
the discrepancy to conflict C-501.
`;
}

function deliveryConflict(): string {
  return `---
id: conflict/C-501
conflict_id: C-501
summary: Delivery implementation and its adjacent contract disagree on the accepted status.
kind: conflict
status: conflicted
authority: observed
owners: ["@delivery"]
conflict_type: implementation
severity: medium
origin: baseline
opened_at: 2026-07-30
sources:
  - path: src/delivery/send.ts
  - path: src/delivery/contract.ts
affected_pages: [product/delivery]
affected_invariants: []
resolution:
  state: open
  decision: null
  acceptance:
    - An owner selects accepted or queued and implementation, contract, page, and tests agree.
---

# Delivery status mismatch

The discrepancy predates wiki bootstrap. The bootstrap candidate records it but
does not broaden itself into a behavior change.
`;
}

describe("existing-repository bootstrap evidence", () => {
  test("closes coverage, dispositions baseline ambiguity, and preserves adopter state through upgrade", () => {
    const repo = tempDir("existing-bootstrap-repo-");
    run(repo, ["git", "init", "-q"]);
    run(repo, ["git", "config", "user.name", "Existing Bootstrap Test"]);
    run(repo, ["git", "config", "user.email", "existing-bootstrap@example.invalid"]);

    // The starting repository has two independent code areas, an existing
    // agent entrypoint, host tooling, and a real code/contract disagreement.
    put(repo, "AGENTS.md", "# Existing repository instructions\n\nKeep the host release checklist intact.\n");
    put(repo, "package.json", jsonStable({
      name: "existing-service",
      type: "module",
      engines: { bun: ">=1.2.0" },
      scripts: { test: "bun test src", typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.8.0" },
    }));
    put(repo, "tsconfig.json", jsonStable({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }));
    put(repo, "src/billing/calculate.ts", "export const taxBasisPoints = 800;\nexport const totalWithTax = (cents: number) => cents + Math.trunc(cents * taxBasisPoints / 10_000);\n");
    put(repo, "src/billing/calculate.test.ts", "import { totalWithTax } from './calculate';\nif (totalWithTax(1_000) !== 1_080) throw new Error('billing total');\n");
    put(repo, "src/delivery/send.ts", "export const send = () => 'accepted' as const;\n");
    put(repo, "src/delivery/contract.ts", "export const intendedDeliveryStatus = 'queued' as const;\n");
    put(repo, "src/generated/client.ts", "export const generatedClient = true;\n");
    run(repo, ["git", "add", "."]);
    run(repo, ["git", "commit", "-qm", "existing repository baseline"]);
    const base = run(repo, ["git", "rev-parse", "HEAD"]).trim();

    const kit = stageKit();
    const initial = planSync(kit, repo);
    expect(initial.conflicts).toEqual([]);
    applySync(kit, repo, initial);
    for (const target of [
      "scripts/wiki/kit-packaging.ts",
      "scripts/wiki/discovery.ts",
      "scripts/wiki/context.ts",
      "scripts/wiki/generated-views.ts",
      "scripts/wiki/kit-packaging.test.ts",
      "scripts/wiki/discovery.test.ts",
      "scripts/wiki/context.test.ts",
      "scripts/wiki/generated-views.test.ts",
    ]) {
      expect(existsSync(join(repo, target))).toBe(true);
    }
    const initialAgents = mergeManagedBlock(
      readFileSync(join(repo, "AGENTS.md"), "utf8"),
      readFileSync(join(kit, "managed/AGENTS.md"), "utf8"),
    );
    expect(initialAgents.status).toBe("ready");
    writeFileSync(join(repo, "AGENTS.md"), initialAgents.content);
    expect(initialAgents.content).toContain("Existing repository instructions");
    expect(initialAgents.content).toContain("wiki-ssot:fresh-context-guardrail");
    mergePackageFragment(repo, kit);

    put(repo, ".wiki/config.json", jsonStable({
      version: 1,
      name: "existing-service",
      highRisk: ["src/delivery/**"],
      freshContext: {
        mode: "required",
        requiredVerdict: "PASS",
        evidenceRequired: true,
        requiredWhen: {
          kind: "risk-based",
          changedFileGlobs: [".wiki/**", "scripts/wiki/**", "src/delivery/**"],
          affectedInvariants: true,
          affectedConflicts: true,
          removedCurrentPages: true,
        },
        trust: {
          allowedReviewers: ["bootstrap-reviewer"],
          requireDifferentActor: true,
          requireAuthenticatedActor: true,
        },
      },
    }));
    put(repo, ".wiki/coverage.json", jsonStable({
      version: 1,
      include: ["src/**/*.ts"],
      exclusions: [{
        glob: "src/generated/**",
        reason: "Generated client output is recreated from an external schema and is not maintained by hand.",
      }],
    }));
    put(repo, "scripts/wiki/inventories.ts", "export async function generatedInventories() { return { 'wiki/_generated/areas.md': '# Existing service areas\\n' }; }\n");
    put(repo, "wiki/product/billing.md", billingPage());
    put(repo, "wiki/product/delivery.md", deliveryPage());
    put(repo, "wiki/conflicts/open/C-501.md", deliveryConflict());

    let view = createRepoView(repo);
    let pages = loadWikiPages(view).pages;
    writeGenerated(repo, generatedCoreFiles(pages, "existing-service"));
    view = createRepoView(repo);
    pages = loadWikiPages(view).pages;
    put(repo, ".wiki/state.json", jsonStable(verifyState(view, pages, [])));
    view = createRepoView(repo);
    pages = loadWikiPages(view).pages;

    const sourceMap = buildSourceMap(pages);
    expect(mappedPages(sourceMap, "src/billing/calculate.ts")).toEqual(["product/billing"]);
    expect(mappedPages(sourceMap, "src/billing/calculate.test.ts")).toEqual(["product/billing"]);
    expect(mappedPages(sourceMap, "src/delivery/send.ts")).toEqual(["product/delivery"]);
    expect(mappedPages(sourceMap, "src/delivery/contract.ts")).toEqual(["product/delivery"]);
    expect(mappedPages(sourceMap, "src/generated/client.ts")).toEqual([]);
    expect(readFileSync(join(repo, "src/delivery/send.ts"), "utf8")).toContain("'accepted'");
    expect(readFileSync(join(repo, "wiki/product/delivery.md"), "utf8")).toContain("currently returns `accepted`");
    expect(pages.find((page) => page.data.conflict_id === "C-501")?.data.origin).toBe("baseline");
    expect(validateCoverage(view, pages)).toEqual([]);
    expect(allLintFindings(view).findings.filter((finding) => finding.severity === "error")).toEqual([]);
    expect(validateState(view, pages).findings.filter((finding) => finding.severity === "error")).toEqual([]);

    run(repo, ["git", "add", "."]);
    run(repo, ["git", "commit", "-qm", "bootstrap wiki ssot"]);

    const metadata: PrMetadata = {
      change_type: "reconcile",
      semantic_change: true,
      wiki_action: "update",
      affected_pages: ["product/billing", "product/delivery"],
      affected_invariants: [],
      touched_conflicts: [{ id: "C-501", action: "introduce" }],
    };
    const pending = reviewCheck(view, pages, { base, metadata });
    expect(pending.required).toBe(true);
    expect(pending.impact.findings).toEqual([]);

    const report: FreshContextReportV2 = {
      version: 2,
      verdict: "PASS",
      reviewed_head_sha: pending.manifest.head_sha,
      merge_base_sha: pending.manifest.merge_base_sha,
      bundle_digest: pending.manifest.bundle_digest,
      reviewer: "bootstrap-reviewer",
      evidence: [
        "Inspected both code areas, current pages, C-501, source maps, coverage exclusion, verification state, and bootstrap diff.",
      ],
      summary: "The bootstrap records the pre-existing mismatch without changing delivery behavior.",
      findings: [{
        id: "FC-PV09-001",
        classification: "preexisting_implementation_mismatch",
        disposition: "conflict_introduced",
        conflict_id: "C-501",
        scope_refs: ["page:product/delivery", "source:src/delivery/send.ts", "source:src/delivery/contract.ts"],
        discrepancy: "The implementation returns accepted while its adjacent contract declares queued.",
        authority: { kind: "observed", ref: "src/delivery/send.ts and src/delivery/contract.ts" },
        acceptance_criteria: [
          "An owner selects the delivery status and code, contract, current page, and tests agree.",
        ],
        evidence: ["wiki/conflicts/open/C-501.md records the baseline mismatch and its closure criteria."],
      }],
    };
    const reviewed = reviewCheck(view, pages, {
      base,
      metadata,
      report,
      reviewerActor: "bootstrap-reviewer",
      prAuthor: "bootstrap-author",
    });
    expect(reviewed.ok).toBe(true);
    expect(reviewed.findings).toEqual([]);
    expect(reviewed.impact.changedFiles).toContain("wiki/conflicts/open/C-501.md");
    expect(reviewed.impact.changedFiles).not.toContain("src/delivery/send.ts");

    // A later kit moves both owned and seed files. Seeds remain byte-identical;
    // a clean owned file updates, while a locally customized owned file
    // conflicts and converges only after an explicit hand merge plus --accept.
    const adopterOwned = [
      ".wiki/config.json",
      ".wiki/coverage.json",
      ".wiki/state.json",
      "scripts/wiki/inventories.ts",
    ];
    const beforeUpgrade = Object.fromEntries(adopterOwned.map((path) => [path, readFileSync(join(repo, path), "utf8")]));
    const localAgents = `${readFileSync(join(repo, "AGENTS.md"), "utf8").trimEnd()}\n\n## Existing service customization\n\nRun the host release checklist before deployment.\n`;
    writeFileSync(join(repo, "AGENTS.md"), localAgents);

    const incomingAgents = readFileSync(join(kit, "managed/AGENTS.md"), "utf8")
      .replace("<!-- wiki-ssot:managed:end -->", "<!-- kit-v2-entrypoint -->\n<!-- wiki-ssot:managed:end -->");
    moveManagedUpstream(kit, "AGENTS.md", incomingAgents);
    moveUpstream(kit, "kit", "wiki/README.md", "# wiki\n\nUpstream kit v2 documentation.\n");
    moveUpstream(kit, "seed", ".wiki/config.json", '{"version":1,"name":"upstream-v2-policy"}\n');
    moveUpstream(kit, "seed", ".wiki/coverage.json", '{"version":1,"include":["upstream/**"],"exclusions":[]}\n');
    moveUpstream(kit, "seed", ".wiki/state.json", '{"version":1,"pages":{"upstream":{}}}\n');
    moveUpstream(kit, "seed", "scripts/wiki/inventories.ts", "export const upstreamInventory = true;\n");

    const upgrade = planSync(kit, repo);
    expect(actionFor(upgrade, "wiki/README.md")).toBe("update");
    for (const path of adopterOwned) expect(actionFor(upgrade, path)).toBe("seed-present");
    applySync(kit, repo, upgrade);
    expect(readFileSync(join(repo, "wiki/README.md"), "utf8")).toContain("Upstream kit v2");
    for (const path of adopterOwned) expect(readFileSync(join(repo, path), "utf8")).toBe(beforeUpgrade[path]);
    for (const target of [
      "scripts/wiki/kit-packaging.ts",
      "scripts/wiki/discovery.ts",
      "scripts/wiki/context.ts",
      "scripts/wiki/generated-views.ts",
      "scripts/wiki/kit-packaging.test.ts",
      "scripts/wiki/discovery.test.ts",
      "scripts/wiki/context.test.ts",
      "scripts/wiki/generated-views.test.ts",
    ]) {
      expect(existsSync(join(repo, target))).toBe(true);
    }

    const mergedUpgradeAgents = mergeManagedBlock(localAgents, incomingAgents);
    expect(mergedUpgradeAgents.status).toBe("ready");
    writeFileSync(join(repo, "AGENTS.md"), mergedUpgradeAgents.content);
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain("kit-v2-entrypoint");
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain("Existing service customization");
  });
});
