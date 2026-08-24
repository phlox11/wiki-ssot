import { openConflicts } from "./discovery";
import { buildRepositoryValidation, type RepositoryValidation } from "./repository-validation";
import { expandSource, type RepoView } from "./repository-view";
import type { Finding, WikiPage } from "./model";
import { hashContent, jsonStable } from "./serialization";
import { readState, sourceHashes, type WikiState } from "./verification";

/**
 * A repository-wide reconciliation plan is deliberately a plan, not a
 * verifier.  A matching source hash only proves that the last ledger update
 * saw the same bytes; it never proves that the Wiki still describes the
 * observable contract.  Every page therefore carries the explicit semantic
 * reconciliation scope below.
 */
export const SEMANTIC_RECONCILIATION_SCOPE = "semantic_reconciliation_required" as const;

export type ReconciliationStatus = "ready" | "needs-reconcile" | "blocked";
export type ReconciliationLedgerState = "current" | "stale" | "missing";

export type ReconciliationPage = {
  id: string;
  path: string;
  /** Descriptive alias for consumers that call the field a Wiki path. */
  wikiPath: string;
  authority: WikiPage["data"]["authority"];
  ledger: ReconciliationLedgerState;
  ledgerState: ReconciliationLedgerState;
  changedSourcePaths: string[];
  sourceCount: number;
  sourceDigest: string;
  relevantOpenConflictIds: string[];
  fullContextCommand: string;
  verifyCommands: {
    updated: string;
    unchanged: string;
  };
  updatedVerifyCommand: string;
  unchangedVerifyCommand: string;
  semanticScope: typeof SEMANTIC_RECONCILIATION_SCOPE;
};

export type ReconciliationFindingGroups = {
  structural: Finding[];
  integration: Finding[];
  coverage: Finding[];
  generated: Finding[];
  inventory: Finding[];
  state: Finding[];
};

export type ReconciliationPlan = {
  version: 1;
  kind: "wiki-reconciliation-plan";
  status: ReconciliationStatus;
  constructionStatus: ReconciliationStatus;
  semanticScope: typeof SEMANTIC_RECONCILIATION_SCOPE;
  pages: ReconciliationPage[];
  findings: ReconciliationFindingGroups;
  findingCount: number;
  planDigest: string;
};

type SourceSnapshot = {
  hashes: Record<string, string>;
  error?: Finding;
};

const EMPTY_FINDINGS: ReconciliationFindingGroups = {
  structural: [],
  integration: [],
  coverage: [],
  generated: [],
  inventory: [],
  state: [],
};

function finding(code: string, message: string, path?: string, severity: Finding["severity"] = "error"): Finding {
  return { code, message, ...(path == null ? {} : { path }), severity };
}

function sortFindings(items: Finding[]): Finding[] {
  return [...items].sort((a, b) => `${a.path ?? ""}\0${a.code}\0${a.severity}\0${a.message}`.localeCompare(`${b.path ?? ""}\0${b.code}\0${b.severity}\0${b.message}`));
}

function sourceSnapshot(view: RepoView, page: WikiPage): SourceSnapshot {
  try {
    if (!Array.isArray(page.data.sources)) {
      return {
        hashes: {},
        error: finding("reconciliation-source-invalid", `current page ${page.data.id} does not have a readable sources array`, page.path),
      };
    }
    return { hashes: sourceHashes(view, page) };
  } catch (error) {
    return {
      hashes: {},
      error: finding(
        "reconciliation-source-unreadable",
        `could not snapshot sources for ${page.data.id}: ${error instanceof Error ? error.message : String(error)}`,
        page.path,
      ),
    };
  }
}

function readStateSafely(view: RepoView): { state: WikiState; findings: Finding[] } {
  try {
    const state = readState(view);
    if (state == null || state.version !== 1 || state.pages == null || typeof state.pages !== "object" || Array.isArray(state.pages)) {
      return {
        state: { version: 1, pages: {} },
        findings: [finding("state-invalid", "state requires version 1 and a pages object", ".wiki/state.json")],
      };
    }
    return { state, findings: [] };
  } catch (error) {
    return {
      state: { version: 1, pages: {} },
      findings: [finding("state-parse", error instanceof Error ? error.message : String(error), ".wiki/state.json")],
    };
  }
}

function relevantConflicts(view: RepoView, page: WikiPage, pages: WikiPage[], actualPaths: string[]): string[] {
  const result = new Set<string>();
  let conflicts: WikiPage[] = [];
  try {
    conflicts = openConflicts(pages);
  } catch {
    // Page validation findings make the plan blocked.  Keep this projection
    // deterministic and let the structural findings explain the malformed
    // conflict record instead of throwing from a reporting command.
    return [];
  }
  for (const conflict of conflicts) {
    const id = conflict.data.conflict_id;
    if (typeof id !== "string" || id.length === 0) continue;
    if ((conflict.data.affected_pages ?? []).includes(page.data.id)
      || (conflict.data.affected_invariants ?? []).includes(page.data.id)) {
      result.add(id);
      continue;
    }
    try {
      const conflictPaths = new Set<string>();
      if (Array.isArray(conflict.data.sources)) {
        for (const source of conflict.data.sources) for (const path of expandSource(view, source)) conflictPaths.add(path);
      }
      if (actualPaths.some((path) => conflictPaths.has(path))) result.add(id);
    } catch {
      // A malformed conflict source is included in validation findings.  It
      // cannot safely be treated as relevant, so omit it from this bounded
      // projection rather than inventing an edge.
    }
  }
  return [...result].sort((a, b) => a.localeCompare(b));
}

function shellQuote(value: string): string {
  // IDs are schema-controlled, but quoting keeps the command exact for a
  // future path-independent ID with punctuation.
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function verifyCommands(id: string): { updated: string; unchanged: string } {
  const page = id;
  const unchangedReason = "Semantic reconciliation found no observable contract change.";
  return {
    updated: `bun run wiki:verify -- --page ${page}`,
    unchanged: `bun run wiki:verify -- --page ${page} --unchanged ${shellQuote(unchangedReason)}`,
  };
}

function changedPaths(stored: Record<string, string>, actual: Record<string, string>): string[] {
  return [...new Set([...Object.keys(stored), ...Object.keys(actual)])]
    .filter((path) => stored[path] !== actual[path])
    .sort((a, b) => a.localeCompare(b));
}

function pagePlan(view: RepoView, page: WikiPage, pages: WikiPage[], state: WikiState): { page: ReconciliationPage; stateFinding?: Finding; sourceFinding?: Finding } {
  const snapshot = sourceSnapshot(view, page);
  const actual = snapshot.hashes;
  const entry = state.pages[page.data.id];
  const stored = entry?.sources != null && typeof entry.sources === "object" && !Array.isArray(entry.sources)
    ? entry.sources
    : undefined;
  const ledger: ReconciliationLedgerState = stored == null
    ? "missing"
    : jsonStable(stored) === jsonStable(actual) ? "current" : "stale";
  const changed = stored == null ? Object.keys(actual).sort((a, b) => a.localeCompare(b)) : changedPaths(stored, actual);
  const commands = verifyCommands(page.data.id);
  const item: ReconciliationPage = {
    id: page.data.id,
    path: page.path,
    wikiPath: page.path,
    authority: page.data.authority,
    ledger,
    ledgerState: ledger,
    changedSourcePaths: changed,
    sourceCount: Object.keys(actual).length,
    sourceDigest: hashContent(jsonStable(actual)),
    relevantOpenConflictIds: relevantConflicts(view, page, pages, Object.keys(actual)),
    fullContextCommand: `bun run wiki:context -- --page ${page.data.id} --full`,
    verifyCommands: commands,
    updatedVerifyCommand: commands.updated,
    unchangedVerifyCommand: commands.unchanged,
    semanticScope: SEMANTIC_RECONCILIATION_SCOPE,
  };
  const stateFinding = ledger === "missing"
    ? finding("reconciliation-state-missing", `current page has no verification ledger entry: ${page.data.id}`, ".wiki/state.json", "warning")
    : ledger === "stale"
      ? finding("reconciliation-state-stale", `source ledger differs from the current repository snapshot: ${page.data.id}`, ".wiki/state.json", "warning")
      : undefined;
  return { page: item, stateFinding, sourceFinding: snapshot.error };
}

function groupedFindings(validation: RepositoryValidation | undefined, extra: Finding[]): ReconciliationFindingGroups {
  if (validation == null) {
    return { ...EMPTY_FINDINGS, structural: sortFindings(extra) };
  }
  const structural: Finding[] = [];
  const coverage: Finding[] = [];
  for (const item of validation.structural) {
    if (item.code.startsWith("coverage-") || item.path === ".wiki/coverage.json") coverage.push(item);
    else structural.push(item);
  }
  return {
    structural: sortFindings([...structural, ...extra]),
    integration: sortFindings(validation.integration),
    coverage: sortFindings(coverage),
    generated: sortFindings(validation.coreGenerated),
    inventory: sortFindings(validation.inventoryGenerated),
    state: sortFindings(validation.state.findings),
  };
}

function flattenFindings(groups: ReconciliationFindingGroups): Finding[] {
  return [groups.structural, groups.integration, groups.coverage, groups.generated, groups.inventory, groups.state].flat();
}

function isBlockingFinding(item: Finding): boolean {
  return item.code === "frontmatter-parse"
    || item.code === "duplicate-id"
    || item.code === "frontmatter-required"
    || item.code === "frontmatter-id"
    || item.code === "frontmatter-status"
    || item.code === "frontmatter-authority"
    || item.code === "frontmatter-sources"
    || item.code === "reconciliation-source-invalid"
    || item.code === "reconciliation-source-unreadable";
}

/**
 * Build a complete, deterministic, read-only reconciliation plan.
 *
 * `loadedFindings` is accepted separately because the CLI eagerly loads pages
 * to preserve its historical short-circuit behavior.  Reconcile is explicitly
 * allowed to inspect those findings and return a blocked plan instead.
 */
export function buildReconciliationPlan(
  view: RepoView,
  pages: WikiPage[],
  loadedFindings: Finding[] = [],
): ReconciliationPlan {
  // Do not let malformed runtime YAML values escape as a thrown sort error.
  // Validation findings below make the plan blocked; only structurally usable
  // current IDs participate in the page projection.
  const sortedPages = pages
    .filter((page) => page?.data?.status === "current" && typeof page.data.id === "string")
    .sort((a, b) => a.data.id.localeCompare(b.data.id));
  const stateResult = readStateSafely(view);
  const pageResults = sortedPages.map((page) => pagePlan(view, page, pages, stateResult.state));
  const pageFindings = [
    ...stateResult.findings,
    ...pageResults.flatMap((result) => [result.stateFinding, result.sourceFinding].filter((item): item is Finding => item != null)),
  ];

  let validation: RepositoryValidation | undefined;
  const validationExtra: Finding[] = [...loadedFindings];
  let validationConstructionFailed = false;
  try {
    validation = buildRepositoryValidation(view, {
      loaded: { pages, findings: loadedFindings },
      checkGenerated: true,
      checkInventory: true,
      checkState: true,
    });
  } catch (error) {
    validationConstructionFailed = true;
    validationExtra.push(finding(
      "reconciliation-validation-failed",
      `repository validation could not be constructed: ${error instanceof Error ? error.message : String(error)}`,
    ));
  }
  const groups = groupedFindings(validation, [...(validation == null ? validationExtra : []), ...pageFindings]);
  // The page universe is unsafe when parsing or identity/schema errors mean a
  // complete current-page set cannot be established.  Other deterministic
  // findings are actionable reconciliation work and retain exit code 0.
  const allFindings = flattenFindings(groups);
  const blocked = validationConstructionFailed || allFindings.some(isBlockingFinding);
  const status: ReconciliationStatus = blocked
    ? "blocked"
    : allFindings.length > 0 || pageResults.some((result) => result.page.ledger !== "current")
      ? "needs-reconcile"
      : "ready";
  const pagesForPlan = pageResults.map((result) => result.page).sort((a, b) => a.id.localeCompare(b.id));
  const base: Omit<ReconciliationPlan, "planDigest"> = {
    version: 1,
    kind: "wiki-reconciliation-plan",
    status,
    constructionStatus: status,
    semanticScope: SEMANTIC_RECONCILIATION_SCOPE,
    pages: pagesForPlan,
    findings: groups,
    findingCount: allFindings.length,
  };
  return { ...base, planDigest: hashContent(jsonStable(base)) };
}

/** Compatibility-friendly alias for callers that describe the operation as a repository reconcile. */
export const reconcileRepository = buildReconciliationPlan;

function renderFindingSection(title: string, findings: Finding[]): string[] {
  const lines = [`${title} (${findings.length})`];
  if (findings.length === 0) return [...lines, "  none"];
  for (const item of findings) lines.push(`  ${item.severity.toUpperCase()} [${item.code}]${item.path ? ` ${item.path}:` : ""} ${item.message}`);
  return lines;
}

/** Stable human-readable projection of a plan. */
export function reconciliationText(plan: ReconciliationPlan): string {
  const lines = [
    "Wiki reconciliation plan",
    `Status: ${plan.status}`,
    `Semantic scope: ${plan.semanticScope} (every current page)`,
    `Plan digest: ${plan.planDigest}`,
    "",
    `Current pages (${plan.pages.length})`,
  ];
  for (const page of plan.pages) {
    lines.push(
      `- ${page.id} [${page.authority}] ledger=${page.ledger} path=${page.path}`,
      `  changed sources: ${page.changedSourcePaths.join(", ") || "none"}`,
      `  sources: ${page.sourceCount}; digest=${page.sourceDigest}`,
      `  open conflicts: ${page.relevantOpenConflictIds.join(", ") || "none"}`,
      `  semantic scope: ${page.semanticScope}`,
      `  context: ${page.fullContextCommand}`,
      `  verify updated: ${page.updatedVerifyCommand}`,
      `  verify unchanged: ${page.unchangedVerifyCommand}`,
    );
  }
  lines.push("", "Repository findings", ...renderFindingSection("Structural", plan.findings.structural), "", ...renderFindingSection("Integration", plan.findings.integration), "", ...renderFindingSection("Coverage", plan.findings.coverage), "", ...renderFindingSection("Generated", plan.findings.generated), "", ...renderFindingSection("Inventory", plan.findings.inventory), "", ...renderFindingSection("State", plan.findings.state));
  return `${lines.join("\n").trimEnd()}\n`;
}
