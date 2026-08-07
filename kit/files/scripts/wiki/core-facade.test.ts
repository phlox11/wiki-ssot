import { describe, expect, test } from "bun:test";
import * as core from "./core";
import * as model from "./model";
import * as serialization from "./serialization";
import * as repositoryView from "./repository-view";
import * as pageValidation from "./page-validation";
import * as workValidation from "./work-validation";
import * as discovery from "./discovery";
import * as context from "./context";
import * as generatedViews from "./generated-views";
import * as kitPackaging from "./kit-packaging";
import * as verification from "./verification";
import * as impact from "./impact";
import * as reviewBundle from "./review-bundle";
import * as reviewAttestation from "./review-attestation";

describe("core compatibility facade", () => {
  test("re-exports shared value APIs by identity", () => {
    expect(core.jsonStable).toBe(serialization.jsonStable);
    expect(core.hashContent).toBe(serialization.hashContent);
    expect(core.createRepoView).toBe(repositoryView.createRepoView);
    expect(core.normalizeRepoPath).toBe(repositoryView.normalizeRepoPath);
    expect(core.expandSource).toBe(repositoryView.expandSource);
    expect(core.parseWikiPage).toBe(pageValidation.parseWikiPage);
    expect(core.loadWikiPages).toBe(pageValidation.loadWikiPages);
    expect(core.validatePages).toBe(pageValidation.validatePages);
    expect(core.validateWorkItems).toBe(workValidation.validateWorkItems);
    expect(core.isConflictGuardFinding).toBe(model.isConflictGuardFinding);
  });

  test("keeps the one-argument Markdown-link facade while foundation accepts policy", () => {
    expect(core.validateMarkdownLinks.length).toBe(1);
    expect(pageValidation.validateMarkdownLinks.length).toBe(1);
  });

  test("re-exports discovery, context, and generated views by identity", () => {
    expect(core.currentPages).toBe(discovery.currentPages);
    expect(core.searchWikiPages).toBe(discovery.searchWikiPages);
    expect(core.conflictSummary).toBe(discovery.conflictSummary);
    expect(core.openConflicts).toBe(discovery.openConflicts);
    expect(core.buildWorkQueue).toBe(discovery.buildWorkQueue);
    expect(core.projectWorkQueue).toBe(discovery.projectWorkQueue);

    expect(core.buildSelectedWorkContext).toBe(context.buildSelectedWorkContext);
    expect(core.buildTopicContext).toBe(context.buildTopicContext);
    expect(core.buildCompactTopicCandidateContext).toBe(context.buildCompactTopicCandidateContext);
    expect(core.projectSelectedWorkContext).toBe(context.projectSelectedWorkContext);
    expect(core.projectTopicContext).toBe(context.projectTopicContext);
    expect(core.buildPageContext).toBe(context.buildPageContext);

    expect(core.GENERATED_HEADER).toBe(generatedViews.GENERATED_HEADER);
    expect(core.generateWorkQueue).toBe(generatedViews.generateWorkQueue);
    expect(core.generateConflictsIndex).toBe(generatedViews.generateConflictsIndex);
    expect(core.generateIndex).toBe(generatedViews.generateIndex);
    expect(core.generateCurrentStatus).toBe(generatedViews.generateCurrentStatus);
    expect(core.buildSourceMap).toBe(generatedViews.buildSourceMap);
    expect(core.buildConflictMap).toBe(generatedViews.buildConflictMap);
    expect(core.generatedCoreFiles).toBe(generatedViews.generatedCoreFiles);

    expect(core.KIT_ROOT).toBe(kitPackaging.KIT_ROOT);
    expect(core.KIT_MANIFEST_TARGET).toBe(kitPackaging.KIT_MANIFEST_TARGET);
    expect(core.KIT_EXCLUDE_START).toBe(kitPackaging.KIT_EXCLUDE_START);
    expect(core.KIT_EXCLUDE_END).toBe(kitPackaging.KIT_EXCLUDE_END);
    expect(core.KIT_ENTRIES).toBe(kitPackaging.KIT_ENTRIES);
    expect(core.kitPath).toBe(kitPackaging.kitPath);
    expect(core.isKitManagedPath).toBe(kitPackaging.isKitManagedPath);
    expect(core.stripKitExclusions).toBe(kitPackaging.stripKitExclusions);
    expect(core.kitFiles).toBe(kitPackaging.kitFiles);
    expect(core.compareKit).toBe(kitPackaging.compareKit);
    expect(core.writeKit).toBe(kitPackaging.writeKit);
  });

  test("re-exports verification, impact, bundle, and attestation APIs by identity", () => {
    for (const name of [
      "mappedConflicts", "sourceHashes", "readState", "verifyState", "validateState",
      "parseFreshContextPolicy", "readConfig", "validateIntegrationSeams", "isHighRisk",
      "validateCoverage", "mappedPages", "UsageError",
    ] as const) {
      expect(core[name]).toBe(verification[name]);
    }
    for (const name of [
      "changedFiles", "resolveDiffBase", "parsePrMetadata", "validatePrMetadata", "impactReport",
      "isImplementationSourceChange", "evaluateFreshContextRequirement",
    ] as const) {
      expect(core[name]).toBe(impact[name]);
    }
    for (const name of [
      "buildFocusedReviewManifest", "validateFocusedReviewManifest", "buildReviewManifest",
      "makeReviewBundle", "recursiveFiles",
    ] as const) {
      expect(core[name]).toBe(reviewBundle[name]);
    }
    expect(core.validateReviewBundleBindings).toBe(reviewBundle.validateFocusedReviewManifest);
    for (const name of ["validateFreshContextFindings", "validateFreshContextAttestation", "parseFreshContextReport", "reviewCheck"] as const) {
      expect(core[name]).toBe(reviewAttestation[name]);
    }
  });
});
