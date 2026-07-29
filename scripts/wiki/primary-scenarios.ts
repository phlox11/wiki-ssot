import { jsonStable, type WikiAuthority, type WikiStatus } from "./core";

export const PRIMARY_SCENARIO_CONTRACT_VERSION = 1 as const;

export const PRIMARY_SCENARIO_CATEGORIES = [
  "feature-change",
  "semantics-preserving-refactor",
  "invariant-controlled-change",
  "code-wiki-disagreement",
  "existing-conflict",
  "multi-area-change",
  "mixed-current-proposed-query",
  "coverage-edge",
] as const;

export type PrimaryScenarioCategory = typeof PRIMARY_SCENARIO_CATEGORIES[number];
export type PrimaryWikiAction = "update" | "verify";
export type PrimaryAuthorityRole = "current-page" | "invariant" | "non-current";
export type PrimaryChangeKind =
  | "implementation"
  | "test"
  | "current-wiki"
  | "conflict"
  | "coverage"
  | "verification";

export type PrimaryAuthorityExpectation = {
  pageId: string;
  role: PrimaryAuthorityRole;
  status: WikiStatus;
  authority: WikiAuthority;
};

export type PrimaryExpectedChange = {
  path: string;
  kind: PrimaryChangeKind;
};

export type PrimaryScenario = {
  id: string;
  category: PrimaryScenarioCategory;
  task: string;
  requiredAuthorities: PrimaryAuthorityExpectation[];
  requiredSources: string[];
  requiredConflicts: string[];
  expectedChanges: PrimaryExpectedChange[];
  expectedWikiAction: PrimaryWikiAction;
};

export type PrimaryScenarioSuite = {
  version: typeof PRIMARY_SCENARIO_CONTRACT_VERSION;
  scenarios: PrimaryScenario[];
};

export type PrimaryObservedAuthority = {
  pageId: string;
  status?: WikiStatus;
  authority?: WikiAuthority;
};

export type PrimaryScenarioObservation = {
  authorities: PrimaryObservedAuthority[];
  sources: string[];
  conflicts: string[];
  changedFiles: string[];
  wikiAction?: PrimaryWikiAction;
  unmappedChangedFiles: string[];
  commands: string[];
  contextBytes: number;
  driftEscapes: string[];
};

export type PrimaryRecallMetric = {
  found: number;
  required: number;
  ratio: number;
};

export type PrimaryScenarioEvaluation = {
  contractVersion: typeof PRIMARY_SCENARIO_CONTRACT_VERSION;
  scenarioId: string;
  category: PrimaryScenarioCategory;
  metrics: {
    currentPageRecall: PrimaryRecallMetric;
    invariantRecall: PrimaryRecallMetric;
    conflictRecall: PrimaryRecallMetric;
    implementationSourceRecall: PrimaryRecallMetric;
    authorityLabelRecall: PrimaryRecallMetric;
    nonCurrentAuthorityLabelRecall: PrimaryRecallMetric;
    expectedChangeRecall: PrimaryRecallMetric;
    irrelevantPageCount: number;
    unmappedChangedFileCount: number;
    contextBytes: number;
    commandCount: number;
    driftEscapeCount: number;
  };
  commandSequence: string[];
  irrelevantPages: string[];
  unmappedChangedFiles: string[];
  driftEscapes: string[];
  wikiActionMatches: boolean;
  expectationsMet: boolean;
};

const scenario = (
  id: string,
  category: PrimaryScenarioCategory,
  task: string,
  requiredAuthorities: PrimaryAuthorityExpectation[],
  requiredSources: string[],
  requiredConflicts: string[],
  expectedChanges: PrimaryExpectedChange[],
  expectedWikiAction: PrimaryWikiAction,
): PrimaryScenario => ({
  id,
  category,
  task,
  requiredAuthorities,
  requiredSources,
  requiredConflicts,
  expectedChanges,
  expectedWikiAction,
});

/**
 * Version 1 is a controlled, synthetic contract rather than a claim about this
 * repository's current page set. PV-05 may collect the baseline with fixtures,
 * while PV-11 may use the same expectations in isolated agent pilots.
 */
export const PRIMARY_SCENARIO_SUITE: PrimaryScenarioSuite = {
  version: PRIMARY_SCENARIO_CONTRACT_VERSION,
  scenarios: [
    scenario(
      "primary-v1-feature-change",
      "feature-change",
      "Add support for partial refunds while preserving the checkout total and currency rules.",
      [
        { pageId: "features/checkout", role: "current-page", status: "current", authority: "observed" },
        { pageId: "product/money-invariants", role: "invariant", status: "current", authority: "normative" },
      ],
      ["src/checkout/refunds.ts", "test/checkout/refunds.test.ts"],
      [],
      [
        { path: "src/checkout/refunds.ts", kind: "implementation" },
        { path: "test/checkout/refunds.test.ts", kind: "test" },
        { path: "wiki/features/checkout.md", kind: "current-wiki" },
        { path: ".wiki/state.json", kind: "verification" },
      ],
      "update",
    ),
    scenario(
      "primary-v1-semantics-preserving-refactor",
      "semantics-preserving-refactor",
      "Split order contract parsing into helpers without changing its exported behavior.",
      [
        { pageId: "architecture/contracts", role: "current-page", status: "current", authority: "observed" },
      ],
      ["src/contracts/order.ts", "test/contracts/order.test.ts"],
      [],
      [
        { path: "src/contracts/order.ts", kind: "implementation" },
        { path: "test/contracts/order.test.ts", kind: "test" },
        { path: ".wiki/state.json", kind: "verification" },
      ],
      "verify",
    ),
    scenario(
      "primary-v1-invariant-controlled-change",
      "invariant-controlled-change",
      "Allow support staff to inspect a tenant record without weakening tenant isolation.",
      [
        { pageId: "features/tenant-access", role: "current-page", status: "current", authority: "observed" },
        { pageId: "product/tenant-isolation", role: "invariant", status: "current", authority: "normative" },
      ],
      ["src/tenancy/access.ts", "test/tenancy/access.test.ts"],
      [],
      [
        { path: "src/tenancy/access.ts", kind: "implementation" },
        { path: "test/tenancy/access.test.ts", kind: "test" },
        { path: "wiki/features/tenant-access.md", kind: "current-wiki" },
        { path: ".wiki/state.json", kind: "verification" },
      ],
      "update",
    ),
    scenario(
      "primary-v1-code-wiki-disagreement",
      "code-wiki-disagreement",
      "Reconcile the documented pricing rounding rule with the contradictory implementation evidence.",
      [
        { pageId: "features/pricing", role: "current-page", status: "current", authority: "normative" },
      ],
      ["src/pricing/calculate.ts", "test/pricing/calculate.test.ts"],
      ["C-101"],
      [
        { path: "wiki/conflicts/open/C-101.md", kind: "conflict" },
      ],
      "update",
    ),
    scenario(
      "primary-v1-existing-conflict",
      "existing-conflict",
      "Change export retention behavior while preserving or resolving the recorded retention conflict.",
      [
        { pageId: "features/export", role: "current-page", status: "current", authority: "observed" },
        { pageId: "product/data-retention", role: "invariant", status: "current", authority: "normative" },
      ],
      ["src/export/job.ts", "test/export/job.test.ts"],
      ["C-201"],
      [
        { path: "src/export/job.ts", kind: "implementation" },
        { path: "test/export/job.test.ts", kind: "test" },
        { path: "wiki/features/export.md", kind: "current-wiki" },
        { path: "wiki/conflicts/resolved/C-201.md", kind: "conflict" },
        { path: ".wiki/state.json", kind: "verification" },
      ],
      "update",
    ),
    scenario(
      "primary-v1-multi-area-change",
      "multi-area-change",
      "Persist order audit records while changing both the order service and the data model.",
      [
        { pageId: "features/orders", role: "current-page", status: "current", authority: "observed" },
        { pageId: "architecture/data", role: "current-page", status: "current", authority: "observed" },
      ],
      ["src/orders/service.ts", "db/migrations/0042_order_audit.sql", "test/orders/audit.test.ts"],
      [],
      [
        { path: "src/orders/service.ts", kind: "implementation" },
        { path: "db/migrations/0042_order_audit.sql", kind: "implementation" },
        { path: "test/orders/audit.test.ts", kind: "test" },
        { path: "wiki/features/orders.md", kind: "current-wiki" },
        { path: "wiki/architecture/data.md", kind: "current-wiki" },
        { path: ".wiki/state.json", kind: "verification" },
      ],
      "update",
    ),
    scenario(
      "primary-v1-mixed-current-proposed-query",
      "mixed-current-proposed-query",
      "Improve search relevance under the current search contract despite a similarly named future ranking proposal.",
      [
        { pageId: "product/search", role: "current-page", status: "current", authority: "normative" },
        { pageId: "proposal/search-ranking", role: "non-current", status: "proposed", authority: "normative" },
      ],
      ["src/search/query.ts", "test/search/query.test.ts"],
      [],
      [
        { path: "src/search/query.ts", kind: "implementation" },
        { path: "test/search/query.test.ts", kind: "test" },
        { path: "wiki/product/search.md", kind: "current-wiki" },
        { path: ".wiki/state.json", kind: "verification" },
      ],
      "update",
    ),
    scenario(
      "primary-v1-coverage-edge",
      "coverage-edge",
      "Add a nested wiki parser and close the coverage and source-mapping edge it exposes.",
      [
        { pageId: "architecture/engine", role: "current-page", status: "current", authority: "observed" },
        { pageId: "product/invariants", role: "invariant", status: "current", authority: "normative" },
      ],
      [".wiki/coverage.json", "scripts/wiki/parsers/edge.ts", "scripts/wiki/parsers/edge.test.ts"],
      [],
      [
        { path: "scripts/wiki/parsers/edge.ts", kind: "implementation" },
        { path: "scripts/wiki/parsers/edge.test.ts", kind: "test" },
        { path: ".wiki/coverage.json", kind: "coverage" },
        { path: "wiki/architecture/engine.md", kind: "current-wiki" },
        { path: ".wiki/state.json", kind: "verification" },
      ],
      "update",
    ),
  ],
};

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function recall(required: string[], observed: string[]): PrimaryRecallMetric {
  const expected = sortedUnique(required);
  const actual = new Set(observed);
  const found = expected.filter((item) => actual.has(item)).length;
  return { found, required: expected.length, ratio: expected.length === 0 ? 1 : found / expected.length };
}

function complete(metric: PrimaryRecallMetric): boolean {
  return metric.found === metric.required;
}

function nonBlank(value: string): boolean {
  return value.trim().length > 0;
}

export function validatePrimaryScenarioSuite(suite: PrimaryScenarioSuite): string[] {
  const findings: string[] = [];
  if (suite.version !== PRIMARY_SCENARIO_CONTRACT_VERSION) findings.push(`unsupported contract version: ${suite.version}`);
  const scenarioIds = new Set<string>();
  const coveredCategories = new Set<PrimaryScenarioCategory>();
  for (const item of suite.scenarios) {
    if (!nonBlank(item.id)) findings.push("scenario id must not be blank");
    else if (scenarioIds.has(item.id)) findings.push(`duplicate scenario id: ${item.id}`);
    else scenarioIds.add(item.id);
    if (!nonBlank(item.task)) findings.push(`${item.id}: task must not be blank`);
    coveredCategories.add(item.category);
    if (item.requiredAuthorities.length === 0) findings.push(`${item.id}: requiredAuthorities must not be empty`);
    if (item.requiredSources.length === 0 || item.requiredSources.some((source) => !nonBlank(source))) {
      findings.push(`${item.id}: requiredSources must contain non-blank paths`);
    }
    if (item.expectedChanges.length === 0 || item.expectedChanges.some((change) => !nonBlank(change.path))) {
      findings.push(`${item.id}: expectedChanges must contain non-blank paths`);
    }
    if (new Set(item.requiredAuthorities.map((authority) => authority.pageId)).size !== item.requiredAuthorities.length) {
      findings.push(`${item.id}: requiredAuthorities contains duplicate page IDs`);
    }
    if (new Set(item.requiredSources).size !== item.requiredSources.length) findings.push(`${item.id}: requiredSources contains duplicates`);
    if (new Set(item.requiredConflicts).size !== item.requiredConflicts.length) findings.push(`${item.id}: requiredConflicts contains duplicates`);
    if (new Set(item.expectedChanges.map((change) => change.path)).size !== item.expectedChanges.length) {
      findings.push(`${item.id}: expectedChanges contains duplicate paths`);
    }
    for (const authority of item.requiredAuthorities) {
      if (!nonBlank(authority.pageId)) findings.push(`${item.id}: authority pageId must not be blank`);
      if (authority.role === "non-current" && authority.status === "current") findings.push(`${item.id}: non-current authority cannot have current status`);
      if (authority.role !== "non-current" && authority.status !== "current") findings.push(`${item.id}: controlling authority must have current status`);
    }
    for (const conflict of item.requiredConflicts) {
      if (!/^C-\d{3}$/.test(conflict)) findings.push(`${item.id}: invalid conflict ID ${conflict}`);
    }
  }
  for (const category of PRIMARY_SCENARIO_CATEGORIES) {
    if (!coveredCategories.has(category)) findings.push(`missing required category: ${category}`);
  }
  return findings;
}

export function evaluatePrimaryScenario(
  item: PrimaryScenario,
  observation: PrimaryScenarioObservation,
): PrimaryScenarioEvaluation {
  const observedPageIds = sortedUnique(observation.authorities.map((authority) => authority.pageId));
  const expectedPageIds = sortedUnique(item.requiredAuthorities.map((authority) => authority.pageId));
  const currentPageRecall = recall(
    item.requiredAuthorities.filter((authority) => authority.role === "current-page").map((authority) => authority.pageId),
    observedPageIds,
  );
  const invariantRecall = recall(
    item.requiredAuthorities.filter((authority) => authority.role === "invariant").map((authority) => authority.pageId),
    observedPageIds,
  );
  const conflictRecall = recall(item.requiredConflicts, observation.conflicts);
  const implementationSourceRecall = recall(item.requiredSources, observation.sources);
  const expectedChangeRecall = recall(item.expectedChanges.map((change) => change.path), observation.changedFiles);
  const observedAuthorities = new Map(observation.authorities.map((authority) => [authority.pageId, authority]));
  const correctlyLabelled = item.requiredAuthorities
    .filter((authority) => {
      const observed = observedAuthorities.get(authority.pageId);
      return observed?.status === authority.status && observed.authority === authority.authority;
    })
    .map((authority) => authority.pageId);
  const authorityLabelRecall = recall(expectedPageIds, correctlyLabelled);
  const expectedNonCurrent = item.requiredAuthorities
    .filter((authority) => authority.role === "non-current")
    .map((authority) => authority.pageId);
  const correctlyLabelledNonCurrent = correctlyLabelled.filter((pageId) => expectedNonCurrent.includes(pageId));
  const nonCurrentAuthorityLabelRecall = recall(expectedNonCurrent, correctlyLabelledNonCurrent);
  const irrelevantPages = observedPageIds.filter((pageId) => !expectedPageIds.includes(pageId));
  const unmappedChangedFiles = sortedUnique(observation.unmappedChangedFiles);
  const driftEscapes = sortedUnique(observation.driftEscapes);
  const wikiActionMatches = observation.wikiAction === item.expectedWikiAction;
  const metrics = {
    currentPageRecall,
    invariantRecall,
    conflictRecall,
    implementationSourceRecall,
    authorityLabelRecall,
    nonCurrentAuthorityLabelRecall,
    expectedChangeRecall,
    irrelevantPageCount: irrelevantPages.length,
    unmappedChangedFileCount: unmappedChangedFiles.length,
    contextBytes: observation.contextBytes,
    commandCount: observation.commands.length,
    driftEscapeCount: driftEscapes.length,
  };
  const expectationsMet = [
    currentPageRecall,
    invariantRecall,
    conflictRecall,
    implementationSourceRecall,
    authorityLabelRecall,
    nonCurrentAuthorityLabelRecall,
    expectedChangeRecall,
  ].every(complete)
    && wikiActionMatches
    && unmappedChangedFiles.length === 0
    && driftEscapes.length === 0;
  return {
    contractVersion: PRIMARY_SCENARIO_CONTRACT_VERSION,
    scenarioId: item.id,
    category: item.category,
    metrics,
    commandSequence: [...observation.commands],
    irrelevantPages,
    unmappedChangedFiles,
    driftEscapes,
    wikiActionMatches,
    expectationsMet,
  };
}

export function renderPrimaryScenarioEvaluation(result: PrimaryScenarioEvaluation): string {
  return jsonStable(result);
}
