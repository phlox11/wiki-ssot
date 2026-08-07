import { describe, expect, test } from "bun:test";
import * as core from "./core";
import * as model from "./model";
import * as serialization from "./serialization";
import * as repositoryView from "./repository-view";
import * as pageValidation from "./page-validation";
import * as workValidation from "./work-validation";

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
});
