import { generateInventories } from "./inventories";
import { GENERATED_HEADER, generatedCoreFiles } from "./generated-views";
import { isKitManagedPath } from "./kit-packaging";
import { loadWikiPages, validateMarkdownLinks, validatePages } from "./page-validation";
import type { Finding, WikiPage } from "./model";
import { type RepoView } from "./repository-view";
import { readConfig, validateCoverage, validateIntegrationSeams, validateState, type StateAudit } from "./verification";

/** The result already produced by the eager CLI context loader. */
export type LoadedWikiPages = { pages: WikiPage[]; findings: Finding[] };

/**
 * All repository-wide deterministic validation that can share one page load.
 *
 * The command projections deliberately consume this object instead of calling
 * their underlying validators in different combinations.  Keeping the
 * aggregate data-only also lets unit callers inject an already loaded page
 * result (the CLI does this) without changing the legacy public functions.
 */
export type RepositoryValidation = {
  loaded: LoadedWikiPages;
  integration: Finding[];
  structural: Finding[];
  coreGenerated: Finding[];
  inventoryGenerated: Finding[];
  state: StateAudit;
  generated: Record<string, string>;
  inventory: Record<string, string>;
};

export type RepositoryValidationOptions = {
  loaded?: LoadedWikiPages;
  /** Include deterministic generated-file comparisons (default true). */
  checkGenerated?: boolean;
  /** Include inventory generated-file comparisons (default true). */
  checkInventory?: boolean;
  /** Include state validation (default true). */
  checkState?: boolean;
  /** Additional generated files retained for the audit compatibility API. */
  extraGenerated?: Record<string, string>;
  /** Focused-test seam; production callers use the project inventory adapter. */
  inventoryGenerator?: (view: RepoView) => Record<string, string>;
  /** Focused-test seam; production callers use deterministic core generation. */
  coreGenerator?: (pages: WikiPage[], name: string) => Record<string, string>;
};

function generatedFinding(findings: Finding[], path: string, code: string, message: string): void {
  findings.push({ code, message, path, severity: "error" });
}

/** Byte comparison shared by the aggregate and the legacy facade. */
export function compareGenerated(view: RepoView, expected: Record<string, string>): Finding[] {
  const findings: Finding[] = [];
  for (const [path, content] of Object.entries(expected)) {
    if (!view.exists(path)) generatedFinding(findings, path, "generated-missing", `generated file is missing; regenerate ${path}`);
    else if (view.read(path) !== content) generatedFinding(findings, path, "generated-stale", `generated file differs from deterministic output; regenerate ${path}`);
    else if (path.endsWith(".md") && !content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trimStart().startsWith(GENERATED_HEADER)) {
      generatedFinding(findings, path, "generated-header", "generated Markdown requires the do-not-edit header");
    }
  }
  return findings;
}

/**
 * Build the shared validation projection once for a repository revision.
 * `loaded` is optional for direct callers and required by the canonical CLI
 * path when it already has an eager page parse result.
 */
export function buildRepositoryValidation(
  view: RepoView,
  options: RepositoryValidationOptions = {},
): RepositoryValidation {
  const loaded = options.loaded ?? loadWikiPages(view);
  const config = readConfig(view);
  const policy = { publishesKit: config.publishesKit, isManagedPath: isKitManagedPath };
  const integration = validateIntegrationSeams(view);
  const structural = [
    ...loaded.findings,
    ...validatePages(view, loaded.pages),
    ...validateMarkdownLinks(view, policy),
    ...validateCoverage(view, loaded.pages),
  ];
  const generated = {
    ...(options.coreGenerator ?? generatedCoreFiles)(loaded.pages, config.name),
    ...(options.extraGenerated ?? {}),
  };
  const inventory = options.checkInventory === false
    ? {}
    : (options.inventoryGenerator ?? generateInventories)(view);
  const coreGenerated: Finding[] = [];
  const inventoryGenerated: Finding[] = [];
  if (options.checkGenerated !== false) {
    // Keep the core projection separate so lint/check can preserve their old
    // output while audit/local-check can choose both generated families.
    coreGenerated.push(...compareGenerated(view, generated));
  }
  if (options.checkInventory !== false) inventoryGenerated.push(...compareGenerated(view, inventory));
  const state = options.checkState === false
    ? { stalePages: [], highRiskStalePages: [], advisoryStalePages: [], findings: [] }
    : validateState(view, loaded.pages);
  return { loaded, integration, structural, coreGenerated, inventoryGenerated, state, generated, inventory };
}

export function aggregateFindings(
  result: RepositoryValidation,
  options: { includeCoreGenerated?: boolean; includeInventoryGenerated?: boolean; includeState?: boolean } = {},
): Finding[] {
  return [
    ...result.structural,
    ...result.integration,
    ...(options.includeCoreGenerated === false ? [] : result.coreGenerated),
    ...(options.includeInventoryGenerated === false ? [] : result.inventoryGenerated),
    ...(options.includeState === false ? [] : result.state.findings),
  ];
}
