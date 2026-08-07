import { parse as parseYaml } from "yaml";
import { expandSource, type RepoView } from "./repository-view";
import type { ConflictMap, SourceMap } from "./generated-views";
import { buildSourceMap } from "./generated-views";
import { currentPages } from "./discovery";
import type { Finding, WikiPage } from "./model";
import { hashContent, jsonStable } from "./serialization";

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

export function mappedConflicts(conflictMap: ConflictMap, path: string): string[] {
  const ids = new Set(conflictMap.exact[path] ?? []);
  for (const item of conflictMap.globs) if (new Bun.Glob(item.glob).match(path)) for (const id of item.conflicts) ids.add(id);
  return [...ids].sort();
}

export function sourceHashes(view: RepoView, page: WikiPage): Record<string, string> {
  const result: Record<string, string> = {};
  for (const source of page.data.sources) for (const path of expandSource(view, source)) result[path] = hashContent(view.read(path));
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

export type WikiState = {
  version: 1;
  pages: Record<string, { sources: Record<string, string>; verification: { kind: "updated" | "unchanged"; reason?: string } }>;
};

export type StateAudit = {
  stalePages: string[];
  highRiskStalePages: string[];
  advisoryStalePages: string[];
  findings: Finding[];
};

export function readState(view: RepoView): WikiState {
  if (!view.exists(".wiki/state.json")) return { version: 1, pages: {} };
  return JSON.parse(view.read(".wiki/state.json")) as WikiState;
}

export function verifyState(view: RepoView, pages: WikiPage[], ids: string[], unchangedReason?: string): WikiState {
  if (unchangedReason != null && unchangedReason.trim().length < 20) throw new UsageError("--unchanged reason must contain at least 20 characters");
  const state = readState(view);
  const selected = ids.length === 0 ? currentPages(pages) : ids.map((id) => pages.find((page) => page.data.id === id) ?? (() => { throw new UsageError(`unknown page id: ${id}`); })());
  if (ids.length === 0) state.pages = {};
  for (const page of selected) {
    state.pages[page.data.id] = {
      sources: sourceHashes(view, page),
      verification: unchangedReason == null ? { kind: "updated" } : { kind: "unchanged", reason: unchangedReason.trim() },
    };
  }
  state.pages = Object.fromEntries(Object.entries(state.pages).sort(([a], [b]) => a.localeCompare(b)));
  return state;
}

export class UsageError extends Error {}

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateState(view: RepoView, pages: WikiPage[]): StateAudit {
  let state: WikiState;
  try {
    state = readState(view);
  } catch (error) {
    return {
      stalePages: [],
      highRiskStalePages: [],
      advisoryStalePages: [],
      findings: [{ code: "state-parse", message: error instanceof Error ? error.message : String(error), path: ".wiki/state.json", severity: "error" }],
    };
  }
  const findings: Finding[] = [];
  const stalePages: string[] = [];
  const highRiskStalePages: string[] = [];
  const advisoryStalePages: string[] = [];
  if (state.version !== 1 || state.pages == null || typeof state.pages !== "object" || Array.isArray(state.pages)) {
    findings.push({ code: "state-invalid", message: "state requires version 1 and a pages object", path: ".wiki/state.json", severity: "error" });
    return { stalePages, highRiskStalePages, advisoryStalePages, findings };
  }
  const config = readConfig(view);
  const current = currentPages(pages);
  const currentIds = new Set(current.map((page) => page.data.id));
  for (const id of Object.keys(state.pages)) {
    if (!currentIds.has(id)) findings.push({ code: "state-non-current-page", message: `state contains a non-current page: ${id}`, path: ".wiki/state.json", severity: "warning" });
  }
  for (const page of current) {
    const entry = state.pages[page.data.id];
    const actual = sourceHashes(view, page);
    const stored = entry?.sources ?? {};
    if (entry?.verification?.kind === "unchanged" && (entry.verification.reason?.trim().length ?? 0) < 20) {
      findings.push({ code: "state-unchanged-reason", message: `unchanged verification requires a 20+ character reason: ${page.data.id}`, path: ".wiki/state.json", severity: "error" });
    } else if (entry != null && !["updated", "unchanged"].includes(entry.verification?.kind)) {
      findings.push({ code: "state-verification-kind", message: `invalid verification kind: ${page.data.id}`, path: ".wiki/state.json", severity: "error" });
    }
    if (jsonStable(stored) === jsonStable(actual)) continue;
    stalePages.push(page.data.id);
    const changedSources = new Set([...Object.keys(stored), ...Object.keys(actual)].filter((path) => stored[path] !== actual[path]));
    const highRisk = [...changedSources].some((path) => isHighRisk(config, path));
    (highRisk ? highRiskStalePages : advisoryStalePages).push(page.data.id);
    findings.push({
      code: highRisk ? "state-stale-high-risk" : "state-stale-low-risk",
      message: `${highRisk ? "high-risk" : "low-risk"} sources changed since verification: ${page.data.id}`,
      path: ".wiki/state.json",
      severity: "error",
    });
  }
  return { stalePages: stalePages.sort(), highRiskStalePages: highRiskStalePages.sort(), advisoryStalePages: advisoryStalePages.sort(), findings };
}

export type FreshContextMode = "advisory" | "required";
export type FreshContextTrustPolicy = {
  allowedReviewers: string[];
  requireDifferentActor: boolean;
  requireAuthenticatedActor: boolean;
};
export type FreshContextRequiredWhen =
  | { kind: "all" }
  | {
    kind: "risk-based";
    changedFileGlobs: string[];
    affectedInvariants: boolean;
    affectedConflicts: boolean;
    removedCurrentPages: boolean;
  };
export type FreshContextPolicy = {
  mode: FreshContextMode;
  requiredVerdict: "PASS";
  evidenceRequired: boolean;
  trust: FreshContextTrustPolicy;
  requiredWhen?: FreshContextRequiredWhen;
};
export type WikiConfig = {
  version: 1;
  name: string;
  highRisk: string[];
  /**
   * True only in the repository that publishes the `kit/` distribution. This
   * engine is shipped verbatim inside that distribution, so every rule about
   * `kit/` has to be opt-in: in an adopting repository `kit/` is an ordinary
   * directory holding whatever that project keeps there, and silently exempting
   * it from the wiki rails — or letting `wiki:kit` overwrite it — would be a
   * rule about this repository's layout leaking into theirs.
   */
  publishesKit: boolean;
  freshContext?: FreshContextPolicy;
};

export function parseFreshContextPolicy(value: unknown): FreshContextPolicy | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const policy = value as Record<string, unknown>;
  const trust = policy.trust;
  if (policy.mode !== "advisory" && policy.mode !== "required") return undefined;
  if (policy.requiredVerdict !== "PASS" || typeof policy.evidenceRequired !== "boolean") return undefined;
  if (trust == null || typeof trust !== "object" || Array.isArray(trust)) return undefined;
  const trustValue = trust as Record<string, unknown>;
  if (!stringArray(trustValue.allowedReviewers) || trustValue.allowedReviewers.length === 0 || typeof trustValue.requireDifferentActor !== "boolean" || typeof trustValue.requireAuthenticatedActor !== "boolean") return undefined;
  let requiredWhen: FreshContextRequiredWhen | undefined;
  if (policy.requiredWhen != null) {
    if (typeof policy.requiredWhen !== "object" || Array.isArray(policy.requiredWhen)) return undefined;
    const required = policy.requiredWhen as Record<string, unknown>;
    if (required.kind === "all") {
      requiredWhen = { kind: "all" };
    } else if (required.kind === "risk-based") {
      if (!stringArray(required.changedFileGlobs)
        || required.changedFileGlobs.some((pattern) => pattern.trim().length === 0)
        || typeof required.affectedInvariants !== "boolean"
        || typeof required.affectedConflicts !== "boolean"
        || typeof required.removedCurrentPages !== "boolean") return undefined;
      try {
        for (const pattern of required.changedFileGlobs) new Bun.Glob(pattern);
      } catch {
        return undefined;
      }
      if (required.changedFileGlobs.length === 0 && !required.affectedInvariants && !required.affectedConflicts && !required.removedCurrentPages) return undefined;
      requiredWhen = {
        kind: "risk-based",
        changedFileGlobs: [...required.changedFileGlobs].sort((a, b) => a.localeCompare(b)),
        affectedInvariants: required.affectedInvariants,
        affectedConflicts: required.affectedConflicts,
        removedCurrentPages: required.removedCurrentPages,
      };
    } else {
      return undefined;
    }
  }
  return {
    mode: policy.mode,
    requiredVerdict: "PASS",
    evidenceRequired: policy.evidenceRequired,
    trust: {
      allowedReviewers: [...trustValue.allowedReviewers].sort((a, b) => a.localeCompare(b)),
      requireDifferentActor: trustValue.requireDifferentActor,
      requireAuthenticatedActor: trustValue.requireAuthenticatedActor,
    },
    ...(requiredWhen ? { requiredWhen } : {}),
  };
}

export function readConfig(view: RepoView): WikiConfig {
  const fallback: WikiConfig = { version: 1, name: "Project", highRisk: [], publishesKit: false };
  if (!view.exists(".wiki/config.json")) return fallback;
  try {
    const raw = JSON.parse(view.read(".wiki/config.json")) as Record<string, unknown>;
    const freshContext = parseFreshContextPolicy(raw.freshContext);
    return {
      version: 1,
      name: typeof raw.name === "string" && raw.name.length > 0 ? raw.name : "Project",
      highRisk: Array.isArray(raw.highRisk) ? raw.highRisk.filter((item): item is string => typeof item === "string" && item.length > 0) : [],
      publishesKit: raw.publishesKit === true,
      ...(freshContext ? { freshContext } : {}),
    };
  } catch {
    return fallback;
  }
}

function agentEntrypointContractGaps(agents: string): string[] {
  const lines = agents
    .split(/\r?\n/)
    .map((line) => line.replace(/[‘’]/g, "'").toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
  const gaps: string[] = [];
  const hasLine = (predicate: (line: string) => boolean) => lines.some(predicate);
  const hasWorkCommand = (line: string) => /(?:^|\s)bun run wiki:work(?=$|[\s,.;:—–])/.test(line);
  const explicitlyNegatesAction = (line: string, action: RegExp) => {
    const negation = /\b(?:do not|does not|don't|never|avoid|ignore|skip|must not|should not|cannot|can't|refuse to|not to)\b/g;
    for (const match of line.matchAll(negation)) {
      const sameClause = line.slice((match.index ?? 0) + match[0].length).split(/[.;—–]/, 1)[0];
      if (action.test(sameClause)) return true;
    }
    return false;
  };
  const hasNegatedWorkAction = (line: string) => explicitlyNegatesAction(
    line,
    /(?:^\s*bun run wiki:work\b|\b(?:run(?:ning)?|execut(?:e|ing)|us(?:e|ing)|invok(?:e|ing))\b[^.;]*\bbun run wiki:work\b)/,
  );
  const hasNoQueryPrerequisite = (line: string) =>
    /(without|no (?:known )?(?:node|id|search term)|before topic search)/.test(line)
    || /\b(?:do not require|(?:do|does) not need)\s+(?:(?:a|an|any|the)\s+)?(?:known\s+)?(?:node|proposal id|work id|search term)\b/.test(line);

  if (!hasLine((line) =>
    !explicitlyNegatesAction(line, /\b(start|begin|open|read|consult)\b/)
    && /\b(start|begin|open|read|consult)\b/.test(line)
    && line.includes("wiki/index.md")
    && line.includes("wiki/current-status.md")
    && line.includes("kind: invariant"))) {
    gaps.push("the wiki index/current-status/invariant read route");
  }
  if (!hasLine((line) =>
    !hasNegatedWorkAction(line)
    && hasWorkCommand(line)
    && /(what remains|unfinished|what should (?:we|you) do next|what should happen next|remaining[- ]work|next[- ]work)/.test(line)
    && hasNoQueryPrerequisite(line))) {
    gaps.push("the no-query generic remaining-work route");
  }
  if (!hasLine((line) =>
    !explicitlyNegatesAction(line, /\b(run|execute|follow|use|open)\b/)
    && /\bselect(?:ed|ing)?\b/.test(line)
    && /(returned|result|printed)/.test(line)
    && /\b(run|execute|follow|use|open)\b/.test(line)
    && line.includes("wiki:context -- --work <id>"))) {
    gaps.push("the selected-work context route");
  }
  if (!hasLine((line) =>
    !explicitlyNegatesAction(line, /\b(search|run|execute|use|open|consult)\b/)
    && /\b(search|topic)\b/.test(line)
    && /\b(edit|editing|implement|implementation)\b/.test(line)
    && line.includes('wiki:search -- "<task terms>"')
    && line.includes('wiki:context -- "<task terms>"'))) {
    gaps.push("the topic search/context route");
  }
  if (!hasLine((line) =>
    !explicitlyNegatesAction(line, /\b(label|present|state|treat|keep)\w*\b/)
    && ["proposed", "conflicted", "deprecated", "archived"].every((status) => line.includes(status))
    && /\b(label|present|state|status|treat)\w*\b/.test(line)
    && /(not current|non-current)/.test(line))) {
    gaps.push("the non-current authority boundary");
  }
  // Executor metadata is a routing contract, not an authorization mechanism.
  // This guardrail intentionally accepts the required negative authority
  // clause ("do not assume authority") instead of sending it through the
  // generic route-negation detector above.
  const humanOnlyNotAutoSelected = lines.some((line) =>
    ( /\bhuman[- ](?:only|exclusive)\b/.test(line)
      || /\bexecutor\s*:\s*human\b/.test(line)
      || /\bhuman\s+work\b/.test(line) )
    && (
      /\b(?:never|not|must not|should not|cannot|can't|do not)\b[^.;—–]{0,120}\b(?:auto[- ]?select(?:ed|ion)?|recommend(?:ed|ation)?|select(?:ed)? automatically|automatically\s+select)\b/.test(line)
      || /\b(?:never|not|must not|should not|cannot|can't|do not)\b[^.;—–]{0,120}\b(?:auto[- ]?select(?:ed|ion)?|recommend(?:ed|ation)?|select(?:ed)? automatically|automatically\s+select)\b[^.;—–]{0,120}(?:human[- ](?:only|exclusive)|executor\s*:\s*human|human\s+work)\b/.test(line)
    ));
  const reportsProcedure = lines.some((line) =>
    /\b(?:report|document|describe|provide|explain|state)\b[^.;—–]{0,120}\b(?:procedure|steps?|process|instructions?)\b/.test(line)
    && !explicitlyNegatesAction(line, /\b(?:report|document|describe|provide|explain|state)\b/));
  const handsOffToHuman = lines.some((line) =>
    /\b(?:hand(?:\s+it)?[- ]off|handoff|escalat(?:e|ion)|refer)\b[^.;—–]{0,100}\bhumans?\b/.test(line)
    && !explicitlyNegatesAction(line, /\b(?:hand(?:\s+it)?[- ]off|handoff|escalat(?:e|ion)|refer)\b/));
  const doesNotAssumeAuthority = lines.some((line) =>
    /\b(?:do not|must not|should not|never|cannot|can't)\s+(?:assume|presume)\s+(?:(?:any|additional|extra)\s+)?(?:credentials?|authority|permissions?)(?:\s+or\s+(?:credentials?|authority|permissions?))?\b/.test(line)
    || /\bno\s+(?:assumed|assumption of)\s+(?:credentials?|authority|permissions?)\b/.test(line)
    || /\bwithout\s+assuming\b[^.;—–]{0,100}\b(?:credentials?|authority|permissions?)\b/.test(line));
  if (!humanOnlyNotAutoSelected || !reportsProcedure || !handsOffToHuman || !doesNotAssumeAuthority) {
    gaps.push("the human-work executor guardrail (human-only auto-selection exclusion, procedure report/handoff, and no assumed authority)");
  }
  return gaps;
}

export function validateIntegrationSeams(view: RepoView): Finding[] {
  const findings: Finding[] = [];
  let configRaw: Record<string, unknown> | undefined;
  if (!view.exists(".wiki/config.json")) {
    findings.push({ code: "fresh-context-config-missing", message: ".wiki/config.json must declare an explicit freshContext policy", path: ".wiki/config.json", severity: "error" });
  } else {
    try {
      const parsed = JSON.parse(view.read(".wiki/config.json")) as unknown;
      if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) configRaw = parsed as Record<string, unknown>;
      else throw new Error("config must be a JSON object");
    } catch (error) {
      findings.push({ code: "fresh-context-config-invalid", message: error instanceof Error ? error.message : String(error), path: ".wiki/config.json", severity: "error" });
    }
    if (configRaw && configRaw.freshContext == null) {
      findings.push({ code: "fresh-context-config-missing", message: ".wiki/config.json must declare an explicit freshContext policy; missing policy never falls back silently to advisory", path: ".wiki/config.json", severity: "error" });
    } else if (configRaw && !parseFreshContextPolicy(configRaw.freshContext)) {
      findings.push({ code: "fresh-context-config-invalid", message: "freshContext requires mode, requiredVerdict: PASS, evidenceRequired, a complete trust policy, and a valid optional requiredWhen selector", path: ".wiki/config.json", severity: "error" });
    }
  }

  const agents = view.exists("AGENTS.md") ? view.read("AGENTS.md") : "";
  if (!agents.includes("wiki-ssot:fresh-context-guardrail")) {
    findings.push({ code: "fresh-context-agents-marker-missing", message: "root AGENTS.md must contain the wiki-ssot:fresh-context-guardrail integration marker", path: "AGENTS.md", severity: "error" });
  }
  const entrypointGaps = agentEntrypointContractGaps(agents);
  if (!agents.includes("wiki-ssot:work-discovery") || entrypointGaps.includes("the no-query generic remaining-work route")) {
    findings.push({ code: "work-discovery-entrypoint-missing", message: "root AGENTS.md must route generic remaining-work requests to bun run wiki:work without requiring a known node, ID, or search term", path: "AGENTS.md", severity: "error" });
  }
  if (entrypointGaps.length > 0) {
    findings.push({
      code: "agent-entrypoint-contract-incomplete",
      message: `root AGENTS.md must provide a meaningful provider-neutral wiki route; missing ${entrypointGaps.join(", ")}`,
      path: "AGENTS.md",
      severity: "error",
    });
  }

  const packagePath = "package.json";
  let scripts: Record<string, unknown> = {};
  if (view.exists(packagePath)) {
    try {
      const parsed = JSON.parse(view.read(packagePath)) as { scripts?: Record<string, unknown> };
      scripts = parsed.scripts ?? {};
    } catch {
      // The ordinary package/tooling checks report malformed package.json.
    }
  }
  if (scripts["wiki:review-preflight"] !== "bun scripts/wiki/cli.ts review-preflight"
    || scripts["wiki:review-check"] !== "bun scripts/wiki/cli.ts review-check"
    || scripts["wiki:doctor"] !== "bun scripts/wiki/cli.ts doctor") {
    findings.push({ code: "fresh-context-command-missing", message: "package.json must expose the canonical wiki:review-preflight, wiki:review-check, and wiki:doctor CLI entrypoints", path: packagePath, severity: "error" });
  }
  if (scripts["wiki:work"] !== "bun scripts/wiki/cli.ts work") {
    findings.push({ code: "work-command-missing", message: "package.json must expose the canonical wiki:work CLI entrypoint", path: packagePath, severity: "error" });
  }

  return findings;
}

export function isHighRisk(config: WikiConfig, path: string): boolean {
  return config.highRisk.some((pattern) => pattern === path || new Bun.Glob(pattern).match(path));
}

type CoverageConfig = {
  version: 1;
  include: string[];
  exclusions: { glob: string; reason: string }[];
};

export function validateCoverage(view: RepoView, pages: WikiPage[]): Finding[] {
  if (!view.exists(".wiki/coverage.json")) return [];
  let config: CoverageConfig;
  try {
    config = JSON.parse(view.read(".wiki/coverage.json")) as CoverageConfig;
  } catch (error) {
    return [{ code: "coverage-config-parse", message: error instanceof Error ? error.message : String(error), path: ".wiki/coverage.json", severity: "error" }];
  }
  if (config.version !== 1 || !Array.isArray(config.include) || !config.include.every((item) => typeof item === "string" && item.length > 0) || !Array.isArray(config.exclusions)) {
    return [{ code: "coverage-config-invalid", message: "coverage config requires version 1, include[], and exclusions[]", path: ".wiki/coverage.json", severity: "error" }];
  }
  const findings: Finding[] = [];
  const sourceMap = buildSourceMap(pages);
  const exclusionGlobs: Bun.Glob[] = [];
  for (const exclusion of config.exclusions) {
    if (exclusion == null || typeof exclusion !== "object" || typeof exclusion.glob !== "string" || typeof exclusion.reason !== "string" || exclusion.reason.trim().length < 20) {
      findings.push({ code: "coverage-exclusion-invalid", message: "coverage exclusions require a glob and a 20+ character reason", path: ".wiki/coverage.json", severity: "error" });
      continue;
    }
    try { exclusionGlobs.push(new Bun.Glob(exclusion.glob)); }
    catch { findings.push({ code: "coverage-exclusion-glob-invalid", message: `invalid coverage exclusion: ${exclusion.glob}`, path: ".wiki/coverage.json", severity: "error" }); }
  }
  const files = new Set<string>();
  for (const pattern of config.include) {
    let glob: Bun.Glob;
    try { glob = new Bun.Glob(pattern); }
    catch {
      findings.push({ code: "coverage-glob-invalid", message: `invalid coverage include: ${pattern}`, path: ".wiki/coverage.json", severity: "error" });
      continue;
    }
    const matched = view.listFiles().filter((path) => glob.match(path));
    if (matched.length === 0) findings.push({ code: "coverage-include-empty", message: `coverage include matches no tracked files: ${pattern}`, path: ".wiki/coverage.json", severity: "error" });
    for (const path of matched) files.add(path);
  }
  for (const path of [...files].sort()) {
    if (exclusionGlobs.some((glob) => glob.match(path))) continue;
    if (mappedPages(sourceMap, path).length === 0) findings.push({ code: "coverage-unmapped", message: `major code source has no current wiki mapping: ${path} — add this path to a current page's sources: (the feature/architecture page it implements), or add a reasoned exclusion to .wiki/coverage.json`, path, severity: "error" });
  }
  return findings;
}

export function mappedPages(sourceMap: SourceMap, path: string): string[] {
  const ids = new Set(sourceMap.exact[path] ?? []);
  for (const item of sourceMap.globs) if (new Bun.Glob(item.glob).match(path)) for (const id of item.pages) ids.add(id);
  return [...ids].sort();
}
