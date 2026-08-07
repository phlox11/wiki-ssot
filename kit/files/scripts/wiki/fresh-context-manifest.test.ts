import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildFocusedReviewManifest,
  buildReviewManifest,
  cleanupTemporary,
  createRepoView,
  evaluateFreshContextRequirement,
  hashContent,
  impactReport,
  jsonStable,
  loadWikiPages,
  makeReviewBundle,
  parseFreshContextPolicy,
  reviewCheck,
  selectGitHubAttestation,
  validateFreshContextAttestation,
  validateFreshContextFindings,
  validateFocusedReviewManifest,
  validateGitHubIntegrationSeams,
  validateIntegrationSeams,
  validatePrMetadata,
  verifyState,
  GITHUB_ATTESTATION_MARKER,
  run,
  put,
  policy,
  providerNeutralAgentEntrypoint,
  coreIntegrationView,
  page,
  metadata,
  tempReviewRepo,
  tempFocusedReviewRepo,
  tempMergeBaseGlobReviewRepo,
  tempAuthoritySourceReviewRepo,
  tempNonInvariantMergeBaseGlobReviewRepo,
  tempConflictInvariantAuthorityReviewRepo,
  tempAffectedPageBaseExactReviewRepo,
  tempAffectedPageBaseGlobReviewRepo,
  tempRenamedCurrentPageReviewRepo,
  tempResolvedConflictMoveReviewRepo,
  rebindFocusedBundle,
  manifestFor,
  reportFor,
  reportV2For,
  findingFor,
  codes,
  conflictFor,
  conflictPage,
  adjudicate,
  type ConflictSummary,
  type FreshContextFinding,
  type FreshContextPolicy,
  type FreshContextReportV1,
  type FreshContextReportV2,
  type PrMetadata,
  type ReviewManifest,
  type FocusedReviewManifest,
} from "./test-fixtures/fresh-context";

afterEach(cleanupTemporary);

describe("fresh-context review manifest", () => {
  test("is byte-identical and digest-identical for the same repository state", () => {
    const root = tempReviewRepo();
    const first = manifestFor(root);
    const second = manifestFor(root);
    expect(jsonStable(first)).toBe(jsonStable(second));
    expect(first.bundle_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.head_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(first.merge_base_sha).toMatch(/^[0-9a-f]{40}$/);

    const one = makeReviewBundle(createRepoView(root), loadWikiPages(createRepoView(root)).pages, impactReport(createRepoView(root), loadWikiPages(createRepoView(root)).pages, { base: "HEAD~1", metadata: metadata() }), "bundle-one", metadata());
    const two = makeReviewBundle(createRepoView(root), loadWikiPages(createRepoView(root)).pages, impactReport(createRepoView(root), loadWikiPages(createRepoView(root)).pages, { base: "HEAD~1", metadata: metadata() }), "bundle-two", metadata());
    expect(readFileSync(join(one, "manifest.json"), "utf8")).toBe(readFileSync(join(two, "manifest.json"), "utf8"));
    expect(hashContent(readFileSync(join(one, "PROMPT.md"), "utf8"))).toBe("62172d6a4e012dafb52e5172c4b98c90e7ace311f0bb9dfcaf82f0ca6a3c795f");
    expect(hashContent(readFileSync(join(one, "REPORT.md"), "utf8"))).toBe("67e53b0950c120a27d7c6ae2bb9312094216f04eaf7df7f42f983e214dd7767e");
    expect(JSON.parse(readFileSync(join(one, "impact.json"), "utf8")).affectedInvariants).toBeUndefined();
    expect(existsSync(join(one, "REPORT.example.json"))).toBe(true);
    expect(existsSync(join(one, "REPORT.md"))).toBe(true);
  });

  test("stores overlapping page and invariant bodies once and rejects focused-input tampering", () => {
    const root = tempFocusedReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({
      affected_pages: ["product/invariants", "product/test"],
      affected_invariants: ["product/invariants"],
      touched_conflicts: [{ id: "C-001", action: "retain", reason: "The baseline conflict remains relevant to this focused review." }],
    });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    expect(report.affectedPages).toContain("product/invariants");
    expect(report.affectedConflicts.map((conflict) => conflict.id)).toContain("C-001");
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const bundle = makeReviewBundle(view, pages, report, "focused-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    const invariantRoles = focused.body_roles.filter((role) => role.id === "product/invariants");
    expect(invariantRoles.map((role) => role.role)).toEqual(["affected_page", "invariant"]);
    expect(invariantRoles[0].digest).toBe(invariantRoles[1].digest);
    expect(focused.objects.filter((object) => object.digest === invariantRoles[0].digest)).toHaveLength(1);
    const conflictAlias = join(bundle, "conflicts/C-001.md");
    expect(lstatSync(conflictAlias).isSymbolicLink()).toBe(true);
    expect(readlinkSync(conflictAlias)).toContain("../objects/");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const clone = (): FocusedReviewManifest => JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const missing = (role: string, id: string) => {
      const candidate = clone();
      candidate.body_roles = candidate.body_roles.filter((item) => !(item.role === role && item.id === id));
      return validateFocusedReviewManifest(candidate, files, reviewManifest).map((finding) => finding.code);
    };
    expect(missing("affected_page", "product/invariants")).toContain("focused-manifest-affected_page-missing");
    expect(missing("invariant", "product/invariants")).toContain("focused-manifest-invariant-missing");
    expect(missing("conflict", "C-001")).toContain("focused-manifest-conflict-missing");

    const changedSource = clone();
    const source = changedSource.source_roles.find((item) => item.path === "source.ts");
    if (!source) throw new Error("focused source fixture did not classify source.ts");
    source.roles = source.roles.filter((role) => role !== "changed_source");
    expect(validateFocusedReviewManifest(changedSource, files, reviewManifest).map((finding) => finding.code)).toContain("focused-manifest-changed-source-required");

    const changedTest = clone();
    const testSource = changedTest.source_roles.find((item) => item.path === "scripts/wiki/te04.test.ts");
    if (!testSource) throw new Error("focused source fixture did not classify the changed test");
    testSource.roles = testSource.roles.filter((role) => role !== "relevant_test");
    expect(validateFocusedReviewManifest(changedTest, files, reviewManifest).map((finding) => finding.code)).toContain("focused-manifest-relevant-test-required");

    const tampered = clone();
    const objectPath = tampered.objects[0].object_path;
    const tamperedFiles = { ...files, [objectPath]: `${files[objectPath]}tampered` };
    expect(validateFocusedReviewManifest(tampered, tamperedFiles, reviewManifest).map((finding) => finding.code)).toContain("focused-manifest-object-digest");

    // An attacker cannot hide a changed path by editing the focused index and
    // recomputing every focused/enclosing digest: impact.json remains the
    // digest-bound canonical changed-file set.
    const omitted = clone();
    const omittedSource = omitted.source_roles.find((item) => item.path === "source.ts");
    if (!omittedSource) throw new Error("focused source fixture did not classify source.ts for omission test");
    const omittedDeclarationIds = new Set(omittedSource.declaration_ids);
    omitted.changed_files = omitted.changed_files.filter((path) => path !== "source.ts");
    omitted.source_roles = omitted.source_roles.filter((item) => item.path !== "source.ts");
    omitted.source_declarations = omitted.source_declarations.filter((declaration) => !omittedDeclarationIds.has(declaration.id));
    const omittedFocusedRaw = jsonStable(omitted);
    const omittedManifest = {
      ...reviewManifest,
      file_digests: { ...reviewManifest.file_digests, "focused-manifest.json": hashContent(omittedFocusedRaw) },
      focused_manifest_digest: hashContent(omittedFocusedRaw),
    } as ReviewManifest;
    const omittedManifestCore = { ...omittedManifest } as Record<string, unknown>;
    delete omittedManifestCore.bundle_digest;
    omittedManifest.bundle_digest = hashContent(jsonStable(omittedManifestCore));
    const omittedFiles = { ...files, "focused-manifest.json": omittedFocusedRaw };
    const omittedCodes = validateFocusedReviewManifest(omitted, omittedFiles, omittedManifest).map((finding) => finding.code);
    expect(omittedCodes).toContain("focused-manifest-changed-files-binding");
    expect(omittedCodes).toContain("focused-manifest-changed-source-binding");
  });

  test("expands merge-base glob provenance for removed sources and hashes empty blobs", () => {
    const root = tempMergeBaseGlobReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/invariants"], affected_invariants: ["product/invariants"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const removed = focused.source_roles.find((source) => source.path === "src/removed.ts");
    const emptyHead = focused.source_roles.find((source) => source.path === "src/empty-head.ts");
    if (!removed || !emptyHead) throw new Error("merge-base glob fixture did not bind both changed source paths");

    expect(removed.lifecycle).toBe("removed");
    expect(removed.head_digest).toBeUndefined();
    expect(removed.merge_base_digest).toBe(hashContent(""));
    expect(removed.roles).toEqual(expect.arrayContaining(["changed_source", "affected_authority_source"]));
    expect(removed.declared_by).toContain("product/invariants");
    expect(removed.declaration_ids).toHaveLength(1);
    const removedDeclaration = focused.source_declarations.find((declaration) => declaration.id === removed.declaration_ids[0]);
    expect(removedDeclaration).toMatchObject({
      page_id: "product/invariants",
      matched_via: "glob",
      expanded_glob: "src/**/*.ts",
      declaration: { glob: "src/**/*.ts" },
    });

    expect(emptyHead.lifecycle).toBe("changed");
    expect(emptyHead.head_digest).toBe(hashContent(""));
    expect(emptyHead.merge_base_digest).toBe(hashContent("seed"));

    const bundle = makeReviewBundle(view, pages, report, "merge-base-glob-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const missingProvenance = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const missingSource = missingProvenance.source_roles.find((source) => source.path === "src/removed.ts");
    if (!missingSource) throw new Error("removed source provenance disappeared");
    missingSource.declaration_ids = [];
    expect(validateFocusedReviewManifest(missingProvenance, files, reviewManifest).map((finding) => finding.code)).toContain("focused-manifest-authority-provenance");

    const misclassified = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const misclassifiedSource = misclassified.source_roles.find((source) => source.path === "src/removed.ts");
    if (!misclassifiedSource) throw new Error("removed source role disappeared");
    misclassifiedSource.roles = misclassifiedSource.roles.filter((role) => role !== "affected_authority_source");
    expect(validateFocusedReviewManifest(misclassified, files, reviewManifest).map((finding) => finding.code)).toContain("focused-manifest-authority-role-required");

    const invalidLifecycle = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const invalidSource = invalidLifecycle.source_roles.find((source) => source.path === "src/empty-head.ts");
    if (!invalidSource) throw new Error("empty-head source lifecycle disappeared");
    invalidSource.lifecycle = "unchanged";
    expect(validateFocusedReviewManifest(invalidLifecycle, files, reviewManifest).map((finding) => finding.code)).toContain("focused-manifest-lifecycle-binding");
  });

  test("preserves a removed empty merge-base glob source for an affected product page", () => {
    const root = tempNonInvariantMergeBaseGlobReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/test"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    expect(report.affectedPages).toContain("product/test");
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const removed = focused.source_roles.find((source) => source.path === "src/removed.ts");
    if (!removed) throw new Error("product authority fixture did not bind the removed source");
    expect(removed.lifecycle).toBe("removed");
    expect(removed.head_digest).toBeUndefined();
    expect(removed.merge_base_digest).toBe(hashContent(""));
    expect(removed.roles).toEqual(expect.arrayContaining(["changed_source", "affected_authority_source"]));
    expect(removed.declared_by).toEqual(["product/test"]);
    expect(removed.declaration_ids).toHaveLength(1);
    const declaration = focused.source_declarations.find((item) => item.id === removed.declaration_ids[0]);
    expect(declaration).toMatchObject({
      page_id: "product/test",
      matched_via: "glob",
      expanded_glob: "src/**/*.ts",
      declaration: { glob: "src/**/*.ts" },
    });

    const bundle = makeReviewBundle(view, pages, report, "product-merge-base-glob-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const omitted = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const omittedSource = omitted.source_roles.find((source) => source.path === "src/removed.ts");
    if (!omittedSource) throw new Error("product removed-source provenance disappeared");
    const omittedDeclarationIds = new Set(omittedSource.declaration_ids);
    omitted.source_roles = omitted.source_roles.filter((source) => source.path !== "src/removed.ts");
    omitted.source_declarations = omitted.source_declarations.filter((item) => !omittedDeclarationIds.has(item.id));
    const omittedRebound = rebindFocusedBundle(omitted, files, reviewManifest);
    const omittedCodes = validateFocusedReviewManifest(omitted, omittedRebound.files, omittedRebound.manifest).map((finding) => finding.code);
    expect(omittedCodes).toContain("focused-manifest-authority-source-required");

    const relabeled = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const relabeledSource = relabeled.source_roles.find((source) => source.path === "src/removed.ts");
    if (!relabeledSource) throw new Error("product removed-source role disappeared");
    const relabeledDeclarationIds = new Set(relabeledSource.declaration_ids);
    relabeledSource.roles = ["changed_source", "supporting_source"];
    relabeledSource.declared_by = [];
    relabeledSource.declaration_ids = [];
    relabeled.source_declarations = relabeled.source_declarations.filter((item) => !relabeledDeclarationIds.has(item.id));
    const relabeledRebound = rebindFocusedBundle(relabeled, files, reviewManifest);
    const relabeledCodes = validateFocusedReviewManifest(relabeled, relabeledRebound.files, relabeledRebound.manifest).map((finding) => finding.code);
    expect(relabeledCodes).toContain("focused-manifest-authority-role-required");
    expect(relabeledCodes).toContain("focused-manifest-authority-provenance");
    expect(relabeledCodes).toContain("focused-manifest-authority-declaration-required");
  });

  test("binds conflict-derived invariant authority sources even when the invariant is otherwise unaffected", () => {
    const root = tempConflictInvariantAuthorityReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({
      affected_pages: [],
      affected_invariants: [],
      semantic_change: false,
      touched_conflicts: [{ id: "C-001", action: "retain", reason: "The conflict remains open while its evidence is refreshed." }],
    });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    expect(report.affectedPages).not.toContain("product/invariants");
    expect(report.affectedConflicts.map((conflict) => conflict.id)).toContain("C-001");
    expect(prMetadata.affected_invariants).toEqual([]);
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const invariantSource = focused.source_roles.find((source) => source.path === "invariant.ts");
    if (!invariantSource) throw new Error("conflict-derived invariant source was not focused");
    expect(invariantSource.lifecycle).toBe("unchanged");
    expect(invariantSource.roles).toContain("affected_authority_source");
    expect(invariantSource.declared_by).toEqual(["product/invariants"]);
    expect(invariantSource.declaration_ids).toHaveLength(1);
    expect(focused.source_declarations.find((item) => item.id === invariantSource.declaration_ids[0])).toMatchObject({
      page_id: "product/invariants",
      matched_via: "path",
      declaration: { path: "invariant.ts" },
    });

    const bundle = makeReviewBundle(view, pages, report, "conflict-invariant-authority-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(reviewManifest.affected_invariant_ids).toContain("product/invariants");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const omitted = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const omittedSource = omitted.source_roles.find((source) => source.path === "invariant.ts");
    if (!omittedSource) throw new Error("conflict-derived invariant source disappeared");
    const omittedDeclarationIds = new Set(omittedSource.declaration_ids);
    omitted.source_roles = omitted.source_roles.filter((source) => source.path !== "invariant.ts");
    omitted.source_declarations = omitted.source_declarations.filter((item) => !omittedDeclarationIds.has(item.id));
    const omittedRebound = rebindFocusedBundle(omitted, files, reviewManifest);
    expect(validateFocusedReviewManifest(omitted, omittedRebound.files, omittedRebound.manifest).map((finding) => finding.code)).toContain("focused-manifest-authority-source-required");

    const relabeled = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const relabeledSource = relabeled.source_roles.find((source) => source.path === "invariant.ts");
    if (!relabeledSource) throw new Error("conflict-derived invariant role disappeared");
    const relabeledDeclarationIds = new Set(relabeledSource.declaration_ids);
    relabeledSource.roles = ["supporting_source"];
    relabeledSource.declared_by = [];
    relabeledSource.declaration_ids = [];
    relabeled.source_declarations = relabeled.source_declarations.filter((item) => !relabeledDeclarationIds.has(item.id));
    const relabeledRebound = rebindFocusedBundle(relabeled, files, reviewManifest);
    const relabeledCodes = validateFocusedReviewManifest(relabeled, relabeledRebound.files, relabeledRebound.manifest).map((finding) => finding.code);
    expect(relabeledCodes).toContain("focused-manifest-authority-role-required");
    expect(relabeledCodes).toContain("focused-manifest-authority-provenance");
    expect(relabeledCodes).toContain("focused-manifest-authority-declaration-required");
  });

  test("retains a base-only exact authority declaration when an affected page replaces it", () => {
    const root = tempAffectedPageBaseExactReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/test"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    expect(focused.body_roles).toContainEqual(expect.objectContaining({ role: "affected_page", id: "product/test", lifecycle: "merge-base" }));
    const oldSource = focused.source_roles.find((source) => source.path === "old.ts");
    if (!oldSource) throw new Error("base-only exact source was not focused");
    expect(oldSource.lifecycle).toBe("unchanged");
    expect(oldSource.roles).toContain("affected_authority_source");
    expect(oldSource.declared_by).toEqual(["product/test"]);
    expect(oldSource.declaration_ids).toHaveLength(1);
    expect(focused.source_declarations.find((item) => item.id === oldSource.declaration_ids[0])).toMatchObject({
      page_id: "product/test",
      matched_via: "path",
      declaration: { path: "old.ts" },
    });

    const bundle = makeReviewBundle(view, pages, report, "affected-base-exact-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const omitted = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const omittedSource = omitted.source_roles.find((source) => source.path === "old.ts");
    if (!omittedSource) throw new Error("base-only exact source disappeared");
    const omittedDeclarationIds = new Set(omittedSource.declaration_ids);
    omitted.source_roles = omitted.source_roles.filter((source) => source.path !== "old.ts");
    omitted.source_declarations = omitted.source_declarations.filter((item) => !omittedDeclarationIds.has(item.id));
    const rebound = rebindFocusedBundle(omitted, files, reviewManifest);
    expect(validateFocusedReviewManifest(omitted, rebound.files, rebound.manifest).map((finding) => finding.code)).toContain("focused-manifest-authority-source-required");
  });

  test("rejects digest-rebound omission of an affected page HEAD body with its unique source provenance", () => {
    const root = tempAffectedPageBaseExactReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/test"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const bundle = makeReviewBundle(view, pages, report, "affected-head-omission-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const omitted = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const headRole = omitted.body_roles.find((role) => role.role === "affected_page" && role.id === "product/test" && role.lifecycle === "head");
    if (!headRole) throw new Error("affected page HEAD body role disappeared");
    omitted.body_roles = omitted.body_roles.filter((role) => role !== headRole);
    if (!omitted.body_roles.some((role) => role.digest === headRole.digest)) omitted.objects = omitted.objects.filter((object) => object.digest !== headRole.digest);
    const headSource = omitted.source_roles.find((source) => source.path === "new.ts");
    if (!headSource) throw new Error("affected page HEAD source provenance disappeared");
    const headDeclarationIds = new Set(headSource.declaration_ids);
    omitted.source_roles = omitted.source_roles.filter((source) => source.path !== "new.ts");
    omitted.source_declarations = omitted.source_declarations.filter((declaration) => !headDeclarationIds.has(declaration.id));
    const rebound = rebindFocusedBundle(omitted, files, reviewManifest);
    expect(validateFocusedReviewManifest(omitted, rebound.files, rebound.manifest, true, root).map((finding) => finding.code)).toContain("focused-manifest-affected_page-missing");
  });

  test("rejects digest-rebound omission of a conditional merge-base body with its unique source provenance", () => {
    const root = tempAffectedPageBaseExactReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/test"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const bundle = makeReviewBundle(view, pages, report, "affected-merge-base-omission-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const omitted = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const baseRole = omitted.body_roles.find((role) => role.role === "affected_page" && role.id === "product/test" && role.lifecycle === "merge-base");
    if (!baseRole) throw new Error("affected page merge-base body role disappeared");
    omitted.body_roles = omitted.body_roles.filter((role) => role !== baseRole);
    if (!omitted.body_roles.some((role) => role.digest === baseRole.digest)) omitted.objects = omitted.objects.filter((object) => object.digest !== baseRole.digest);
    const baseSource = omitted.source_roles.find((source) => source.path === "old.ts");
    if (!baseSource) throw new Error("affected page merge-base source provenance disappeared");
    const baseDeclarationIds = new Set(baseSource.declaration_ids);
    omitted.source_roles = omitted.source_roles.filter((source) => source.path !== "old.ts");
    omitted.source_declarations = omitted.source_declarations.filter((declaration) => !baseDeclarationIds.has(declaration.id));
    const rebound = rebindFocusedBundle(omitted, files, reviewManifest);
    expect(validateFocusedReviewManifest(omitted, rebound.files, rebound.manifest, true, root).map((finding) => finding.code)).toContain("focused-manifest-affected_page-merge-base-missing");
  });

  test("rejects digest-rebound relabeling of merge-base bytes as an affected page HEAD body", () => {
    const root = tempAffectedPageBaseExactReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/test"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const bundle = makeReviewBundle(view, pages, report, "affected-lifecycle-relabel-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    const relabeled = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const headRole = relabeled.body_roles.find((role) => role.role === "affected_page" && role.id === "product/test" && role.lifecycle === "head");
    const baseRole = relabeled.body_roles.find((role) => role.role === "affected_page" && role.id === "product/test" && role.lifecycle === "merge-base");
    if (!headRole || !baseRole) throw new Error("affected page lifecycle roles disappeared");
    relabeled.body_roles = relabeled.body_roles.filter((role) => role !== headRole);
    baseRole.lifecycle = "head";
    const rebound = rebindFocusedBundle(relabeled, files, reviewManifest);
    const codes = validateFocusedReviewManifest(relabeled, rebound.files, rebound.manifest, true, root).map((finding) => finding.code);
    expect(codes).toContain("focused-manifest-body-revision-binding");
  });

  test("rejects a self-asserted removed-page exception when HEAD still has the current page", () => {
    const root = tempAffectedPageBaseExactReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/test"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const bundle = makeReviewBundle(view, pages, report, "affected-exception-relabel-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    const relabeled = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const headRole = relabeled.body_roles.find((role) => role.role === "affected_page" && role.id === "product/test" && role.lifecycle === "head");
    const baseRole = relabeled.body_roles.find((role) => role.role === "affected_page" && role.id === "product/test" && role.lifecycle === "merge-base");
    if (!headRole || !baseRole) throw new Error("affected page lifecycle roles disappeared");
    relabeled.body_roles = relabeled.body_roles.filter((role) => role !== headRole);
    baseRole.role = "removed_page";
    const rebound = rebindFocusedBundle(relabeled, files, reviewManifest);
    const codes = validateFocusedReviewManifest(relabeled, rebound.files, rebound.manifest, true, root).map((finding) => finding.code);
    expect(codes).toContain("focused-manifest-removed-page-exception");
  });

  test("rejects a removed-page exception when the current page moved to another HEAD path", () => {
    const root = tempRenamedCurrentPageReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ change_type: "editorial", affected_pages: ["product/test"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    expect(report.affectedPages).toContain("product/test");
    expect(report.removedCurrentPages).toEqual([]);
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const bundle = makeReviewBundle(view, pages, report, "renamed-page-exception-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest, true, root)).toEqual([]);

    const relabeled = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const headRole = relabeled.body_roles.find((role) => role.role === "affected_page" && role.id === "product/test" && role.lifecycle === "head");
    if (!headRole) throw new Error("renamed page HEAD body role disappeared");
    const baseRaw = run(root, ["git", "show", "HEAD~1:wiki/product/original.md"]);
    const baseDigest = hashContent(baseRaw);
    relabeled.body_roles = relabeled.body_roles.filter((role) => role !== headRole);
    relabeled.objects = relabeled.objects.filter((object) => object.digest !== headRole.digest);
    relabeled.body_roles.push({ role: "removed_page", id: "product/test", wiki_path: "wiki/product/original.md", lifecycle: "merge-base", digest: baseDigest });
    relabeled.objects.push({ digest: baseDigest, object_path: `objects/${baseDigest}.md`, bytes: Buffer.byteLength(baseRaw, "utf8") });
    const rebound = rebindFocusedBundle(relabeled, files, reviewManifest, { [`objects/${baseDigest}.md`]: baseRaw });
    const codes = validateFocusedReviewManifest(relabeled, rebound.files, rebound.manifest, true, root).map((finding) => finding.code);
    expect(codes).toContain("focused-manifest-removed-page-exception");
  });

  test("rejects a conflict merge-base exception when the conflict moved open to resolved at HEAD", () => {
    const root = tempResolvedConflictMoveReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({
      change_type: "reconcile",
      affected_pages: ["product/test"],
      touched_conflicts: [{ id: "C-001", action: "resolve", reason: "The resolved conflict remains bound to its exact evidence." }],
    });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    expect(report.affectedConflicts.map((conflict) => conflict.id)).toContain("C-001");
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const bundle = makeReviewBundle(view, pages, report, "resolved-conflict-exception-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest, true, root)).toEqual([]);

    const relabeled = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const headRole = relabeled.body_roles.find((role) => role.role === "conflict" && role.id === "C-001" && role.lifecycle === "head");
    if (!headRole) throw new Error("resolved conflict HEAD body role disappeared");
    const baseRaw = run(root, ["git", "show", "HEAD~1:wiki/conflicts/open/C-001.md"]);
    const baseDigest = hashContent(baseRaw);
    relabeled.body_roles = relabeled.body_roles.filter((role) => role !== headRole);
    relabeled.objects = relabeled.objects.filter((object) => object.digest !== headRole.digest);
    relabeled.body_roles.push({ role: "conflict", id: "C-001", wiki_path: "wiki/conflicts/open/C-001.md", lifecycle: "merge-base", digest: baseDigest });
    relabeled.objects.push({ digest: baseDigest, object_path: `objects/${baseDigest}.md`, bytes: Buffer.byteLength(baseRaw, "utf8") });
    const rebound = rebindFocusedBundle(relabeled, files, reviewManifest, { [`objects/${baseDigest}.md`]: baseRaw });
    const codes = validateFocusedReviewManifest(relabeled, rebound.files, rebound.manifest, true, root).map((finding) => finding.code);
    expect(codes).toContain("focused-manifest-conflict-exception");
  });

  test("rejects arbitrary source hashes even when their submitted lifecycle remains structurally consistent", () => {
    const root = tempAffectedPageBaseExactReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/test"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const bundle = makeReviewBundle(view, pages, report, "arbitrary-source-hashes-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    const tampered = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const source = tampered.source_roles.find((item) => item.path === "new.ts");
    if (!source || source.head_digest == null || source.merge_base_digest == null) throw new Error("unchanged source lifecycle disappeared");
    source.head_digest = "1".repeat(64);
    source.merge_base_digest = "2".repeat(64);
    source.lifecycle = "changed";
    const rebound = rebindFocusedBundle(tampered, files, reviewManifest);
    const codes = validateFocusedReviewManifest(tampered, rebound.files, rebound.manifest, true, root).map((finding) => finding.code);
    expect(codes).toContain("focused-manifest-source-head-revision-binding");
    expect(codes).toContain("focused-manifest-source-base-revision-binding");
    expect(codes).toContain("focused-manifest-source-revision-lifecycle");
  });

  test("retains a deleted empty glob match from an affected page's merge-base body", () => {
    const root = tempAffectedPageBaseGlobReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/test"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    expect(focused.body_roles).toContainEqual(expect.objectContaining({ role: "affected_page", id: "product/test", lifecycle: "merge-base" }));
    const removed = focused.source_roles.find((source) => source.path === "src/removed.ts");
    if (!removed) throw new Error("base-only glob source was not focused");
    expect(removed.lifecycle).toBe("removed");
    expect(removed.head_digest).toBeUndefined();
    expect(removed.merge_base_digest).toBe(hashContent(""));
    expect(removed.roles).toEqual(expect.arrayContaining(["changed_source", "affected_authority_source"]));
    expect(removed.declared_by).toEqual(["product/test"]);
    expect(removed.declaration_ids).toHaveLength(1);
    expect(focused.source_declarations.find((item) => item.id === removed.declaration_ids[0])).toMatchObject({
      page_id: "product/test",
      matched_via: "glob",
      expanded_glob: "src/**/*.ts",
      declaration: { glob: "src/**/*.ts" },
    });

    const bundle = makeReviewBundle(view, pages, report, "affected-base-glob-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const relabeled = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const relabeledSource = relabeled.source_roles.find((source) => source.path === "src/removed.ts");
    if (!relabeledSource) throw new Error("base-only glob source disappeared");
    const relabeledDeclarationIds = new Set(relabeledSource.declaration_ids);
    relabeledSource.roles = ["changed_source", "supporting_source"];
    relabeledSource.declared_by = [];
    relabeledSource.declaration_ids = [];
    relabeled.source_declarations = relabeled.source_declarations.filter((item) => !relabeledDeclarationIds.has(item.id));
    const rebound = rebindFocusedBundle(relabeled, files, reviewManifest);
    const codes = validateFocusedReviewManifest(relabeled, rebound.files, rebound.manifest).map((finding) => finding.code);
    expect(codes).toContain("focused-manifest-authority-role-required");
    expect(codes).toContain("focused-manifest-authority-provenance");
    expect(codes).toContain("focused-manifest-authority-declaration-required");
  });

  test("rejects digest-rebound omission of an unchanged exact authority source", () => {
    const root = tempAuthoritySourceReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/invariants"], affected_invariants: ["product/invariants"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const bundle = makeReviewBundle(view, pages, report, "authority-source-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const omitted = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const configSource = omitted.source_roles.find((source) => source.path === ".wiki/config.json");
    if (!configSource) throw new Error("authority fixture did not bind .wiki/config.json");
    const omittedDeclarationIds = new Set(configSource.declaration_ids);
    omitted.source_roles = omitted.source_roles.filter((source) => source.path !== ".wiki/config.json");
    omitted.source_declarations = omitted.source_declarations.filter((declaration) => !omittedDeclarationIds.has(declaration.id));
    const rebound = rebindFocusedBundle(omitted, files, reviewManifest);
    const codes = validateFocusedReviewManifest(omitted, rebound.files, rebound.manifest).map((finding) => finding.code);
    expect(codes).toContain("focused-manifest-authority-source-required");
  });

  test("rejects digest-rebound relabeling of a changed exact authority source", () => {
    const root = tempAuthoritySourceReviewRepo();
    const view = createRepoView(root);
    const pages = loadWikiPages(view).pages;
    const prMetadata = metadata({ affected_pages: ["product/invariants"], affected_invariants: ["product/invariants"] });
    const report = impactReport(view, pages, { base: "HEAD~1", metadata: prMetadata });
    const focused = buildFocusedReviewManifest(view, pages, report, prMetadata);
    const bundle = makeReviewBundle(view, pages, report, "authority-source-changed-bundle", prMetadata);
    const reviewManifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")) as ReviewManifest;
    const files: Record<string, string> = {};
    for (const path of Object.keys(reviewManifest.file_digests)) files[path] = readFileSync(join(bundle, path), "utf8");
    expect(validateFocusedReviewManifest(focused, files, reviewManifest)).toEqual([]);

    const relabeled = JSON.parse(JSON.stringify(focused)) as FocusedReviewManifest;
    const readmeSource = relabeled.source_roles.find((source) => source.path === "README.md");
    if (!readmeSource) throw new Error("authority fixture did not bind changed README.md");
    const removedDeclarationIds = new Set(readmeSource.declaration_ids);
    readmeSource.roles = ["changed_source", "supporting_source"];
    readmeSource.declared_by = [];
    readmeSource.declaration_ids = [];
    relabeled.source_declarations = relabeled.source_declarations.filter((declaration) => !removedDeclarationIds.has(declaration.id));
    const rebound = rebindFocusedBundle(relabeled, files, reviewManifest);
    const codes = validateFocusedReviewManifest(relabeled, rebound.files, rebound.manifest).map((finding) => finding.code);
    expect(codes).toContain("focused-manifest-authority-role-required");
    expect(codes).toContain("focused-manifest-authority-provenance");
    expect(codes).toContain("focused-manifest-authority-declaration-required");
  });

  test("changes when canonical PR metadata changes without changing HEAD", () => {
    const root = tempReviewRepo();
    const first = manifestFor(root);
    const changed = manifestFor(root, metadata({ change_type: "fix" }));
    expect(first.pr_metadata_digest).not.toBe(changed.pr_metadata_digest);
    expect(first.bundle_digest).not.toBe(changed.bundle_digest);
    expect(codes(validateFreshContextAttestation({
      policy: policy(),
      manifest: changed,
      report: reportFor(first),
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    }))).toContain("fresh-context-bundle-stale");
  });

  test("changes after an affected page or conflict changes", () => {
    const root = tempReviewRepo();
    const first = manifestFor(root);
    put(root, "wiki/product/test.md", page("source.ts", "The version two contract now includes more evidence."));
    put(root, "wiki/conflicts/open/C-900.md", `---
id: conflict/C-900
conflict_id: C-900
summary: Review test conflict.
kind: conflict
status: conflicted
authority: observed
owners: ["@owner"]
conflict_type: documentation
severity: low
origin: introduced_by_change
opened_at: 2026-07-24
sources:
  - path: source.ts
affected_pages: [product/test]
affected_invariants: []
resolution:
  state: open
  decision: null
  acceptance:
    - Reconcile the added evidence.
---

# Review test conflict
`);
    run(root, ["git", "add", "."]);
    run(root, ["git", "commit", "-qm", "change affected review inputs"]);
    const second = manifestFor(root, metadata({
      touched_conflicts: [{ id: "C-900", action: "introduce" }],
    }));
    expect(first.bundle_digest).not.toBe(second.bundle_digest);
    expect(second.affected_conflict_ids).toEqual(["C-900"]);
    expect(codes(validateFreshContextAttestation({
      policy: policy(),
      manifest: second,
      report: reportFor(first),
      reviewerActor: "trusted-reviewer",
      prAuthor: "author",
    }))).toContain("fresh-context-bundle-stale");
  });
});

