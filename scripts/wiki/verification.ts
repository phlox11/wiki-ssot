import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { expandSource, type RepoView } from "./repository-view";
import type { ConflictMap, SourceMap } from "./generated-views";
import { buildSourceMap } from "./generated-views";
import { currentPages } from "./discovery";
import type { Finding, WikiPage } from "./model";
import { hashContent, jsonStable } from "./serialization";
import { hasTypedManagedAgentRules, validateManagedAgentRules } from "./agent-rules";

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
export type V2ChangedFileRule = {
  glob: string;
  reason: string;
};
export type V2SemanticVerify = {
  enabled: boolean;
  reason: string;
};
export type V2ReviewWhen = {
  kind: "risk-based";
  changedFileRules: V2ChangedFileRule[];
  changedKitOwnedFiles: boolean;
  affectedInvariants: boolean;
  affectedConflicts: boolean;
  removedCurrentPages: boolean;
  /**
   * Explicit semantic-change metadata guard.  The field is optional only in
   * the migration-shaped value returned by parseWikiConfigV2; a repository
   * cannot pass validation or the canonical gate until it is present.
   */
  semanticVerify?: V2SemanticVerify;
};
export type WikiConfigV1 = {
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
export type WikiConfigV2 = {
  version: 2;
  name: string;
  /** The optional high-risk labels remain supported so v1 adopters can carry them forward. */
  highRisk: string[];
  publishesKit: boolean;
  enforcement: {
    mode: "local-status";
    statusContext: string;
  };
  localChecks: { id: string; argv: string[] }[];
  review: {
    mode: "required";
    when: V2ReviewWhen;
  };
  /** Internal read status used to keep malformed v2 config on the v2 path. */
  configIssue?: "invalid" | "semantic-verify-missing";
};
export type WikiConfig = WikiConfigV1 | WikiConfigV2;

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function validNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

/**
 * Parse the explicit v2 local-enforcement contract.  This is intentionally
 * separate from the permissive v1 reader: an adopter with a malformed v2 file
 * must not silently fall back to a different enforcement policy.
 */
export function parseWikiConfigV2(value: unknown): WikiConfigV2 | undefined {
  const raw = objectRecord(value);
  if (raw == null || raw.version !== 2 || !validNonEmptyString(raw.name) || typeof raw.publishesKit !== "boolean") return undefined;
  const allowedKeys = new Set(["version", "name", "highRisk", "publishesKit", "enforcement", "localChecks", "review"]);
  if (Object.keys(raw).some((key) => !allowedKeys.has(key))) return undefined;
  // v2 has no GitHub actor/mirror seam. Reject the old policy explicitly so a
  // partial conversion cannot claim local isolation while still depending on it.
  if ("freshContext" in raw) return undefined;
  if ("highRisk" in raw && !Array.isArray(raw.highRisk)) return undefined;
  if (Array.isArray(raw.highRisk) && raw.highRisk.some((item) => !validNonEmptyString(item))) return undefined;
  const enforcement = objectRecord(raw.enforcement);
  if (enforcement == null || !hasOnlyKeys(enforcement, ["mode", "statusContext"]) || enforcement.mode !== "local-status" || !validNonEmptyString(enforcement.statusContext)) return undefined;

  if (!Array.isArray(raw.localChecks)) return undefined;
  const ids = new Set<string>();
  const localChecks: { id: string; argv: string[] }[] = [];
  for (const item of raw.localChecks) {
    const check = objectRecord(item);
    const id = check?.id;
    const normalizedId = validNonEmptyString(id) ? id.trim() : "";
    if (check == null || !hasOnlyKeys(check, ["id", "argv"]) || normalizedId.length === 0 || ids.has(normalizedId) || !Array.isArray(check.argv)
      || check.argv.length === 0 || check.argv.some((arg) => !validNonEmptyString(arg))) return undefined;
    ids.add(normalizedId);
    // Preserve argv bytes exactly. Validation only rejects blank entries; an
    // intentional argument may include surrounding spaces.
    localChecks.push({ id: normalizedId, argv: [...check.argv] });
  }

  const review = objectRecord(raw.review);
  const when = review == null ? undefined : objectRecord(review.when);
  if (review == null || !hasOnlyKeys(review, ["mode", "when"]) || review.mode !== "required" || when == null || !hasOnlyKeys(when, ["kind", "changedFileRules", "changedKitOwnedFiles", "affectedInvariants", "affectedConflicts", "removedCurrentPages", "semanticVerify"]) || when.kind !== "risk-based"
    || !Array.isArray(when.changedFileRules)
    || typeof when.changedKitOwnedFiles !== "boolean"
    || typeof when.affectedInvariants !== "boolean"
    || typeof when.affectedConflicts !== "boolean"
    || typeof when.removedCurrentPages !== "boolean") return undefined;
  const changedFileRules: V2ChangedFileRule[] = [];
  const globs = new Set<string>();
  for (const item of when.changedFileRules) {
    const rule = objectRecord(item);
    const glob = validNonEmptyString(rule?.glob) ? rule.glob.trim() : "";
    if (rule == null || !hasOnlyKeys(rule, ["glob", "reason"]) || glob.length === 0 || !validNonEmptyString(rule.reason) || rule.reason.trim().length < 20 || globs.has(glob)) return undefined;
    try { new Bun.Glob(glob); } catch { return undefined; }
    globs.add(glob);
    changedFileRules.push({ glob, reason: rule.reason.trim() });
  }
  let semanticVerify: V2SemanticVerify | undefined;
  if ("semanticVerify" in when) {
    const rawSemanticVerify = objectRecord(when.semanticVerify);
    if (rawSemanticVerify == null || !hasOnlyKeys(rawSemanticVerify, ["enabled", "reason"]) || typeof rawSemanticVerify.enabled !== "boolean" || typeof rawSemanticVerify.reason !== "string") return undefined;
    const reason = rawSemanticVerify.reason.trim();
    if (reason.length === 0 || (rawSemanticVerify.enabled && reason.length < 20)) return undefined;
    semanticVerify = { enabled: rawSemanticVerify.enabled, reason };
  }
  if (changedFileRules.length === 0 && !when.changedKitOwnedFiles && !when.affectedInvariants && !when.affectedConflicts && !when.removedCurrentPages && !semanticVerify?.enabled) return undefined;
  return {
    version: 2,
    name: raw.name.trim(),
    highRisk: Array.isArray(raw.highRisk) ? raw.highRisk.map((item) => (item as string).trim()) : [],
    publishesKit: raw.publishesKit,
    enforcement: { mode: "local-status", statusContext: enforcement.statusContext.trim() },
    localChecks,
    review: {
      mode: "required",
      when: {
        kind: "risk-based",
        changedFileRules: changedFileRules.sort((a, b) => a.glob.localeCompare(b.glob) || a.reason.localeCompare(b.reason)),
        changedKitOwnedFiles: when.changedKitOwnedFiles,
        affectedInvariants: when.affectedInvariants,
        affectedConflicts: when.affectedConflicts,
        removedCurrentPages: when.removedCurrentPages,
        ...(semanticVerify ? { semanticVerify } : {}),
      },
    },
  };
}

function invalidV2Config(value: Record<string, unknown>): WikiConfigV2 {
  const rawEnforcement = objectRecord(value.enforcement);
  const statusContext = validNonEmptyString(rawEnforcement?.statusContext) ? rawEnforcement.statusContext.trim() : "wiki-ssot/local";
  return {
    version: 2,
    name: validNonEmptyString(value.name) ? value.name.trim() : "Project",
    highRisk: Array.isArray(value.highRisk) ? value.highRisk.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [],
    publishesKit: value.publishesKit === true,
    enforcement: { mode: "local-status", statusContext },
    localChecks: [],
    review: {
      mode: "required",
      when: {
        kind: "risk-based",
        changedFileRules: [],
        changedKitOwnedFiles: false,
        affectedInvariants: false,
        affectedConflicts: false,
        removedCurrentPages: false,
      },
    },
    configIssue: "invalid",
  };
}

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
    if (raw.version === 2) {
      const parsed = parseWikiConfigV2(raw);
      if (parsed) return parsed.review.when.semanticVerify == null ? { ...parsed, configIssue: "semantic-verify-missing" } : parsed;
      // Keep malformed v2 policy on the local-status path. Returning the v1
      // fallback here would let impact/review callers silently change policy
      // while doctor reports a different configuration failure.
      return invalidV2Config(raw);
    }
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

export function validateIntegrationSeams(view: RepoView): Finding[] {
  const findings: Finding[] = [];
  let configRaw: Record<string, unknown> | undefined;
  let parsedConfig: WikiConfig | undefined;
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
    if (configRaw?.version === 2) {
      parsedConfig = parseWikiConfigV2(configRaw);
      if (!parsedConfig) {
        findings.push({
          code: "local-status-config-invalid",
          message: ".wiki/config.json v2 requires local-status enforcement, argv-array localChecks, a non-inert risk-based review selector, and a valid semanticVerify {enabled, reason} selector",
          path: ".wiki/config.json",
          severity: "error",
        });
        const rawReview = objectRecord(configRaw.review);
        const rawWhen = objectRecord(rawReview?.when);
        if (rawWhen != null && "semanticVerify" in rawWhen) findings.push({
          code: "local-status-semantic-verify-invalid",
          message: ".wiki/config.json review.when.semanticVerify requires boolean enabled and a non-empty reason; enabled true requires a trimmed reason of at least 20 characters",
          path: ".wiki/config.json",
          severity: "error",
        });
      } else if (parsedConfig.review.when.semanticVerify == null) {
        findings.push({
          code: "local-status-semantic-verify-missing",
          message: ".wiki/config.json v2 review.when.semanticVerify is missing; choose enabled: true with a 20+ character reason or enabled: false explicitly, then rerun wiki:doctor and wiki:check",
          path: ".wiki/config.json",
          severity: "error",
        });
      }
    } else if (configRaw && configRaw.freshContext == null) {
      findings.push({ code: "fresh-context-config-missing", message: ".wiki/config.json must declare an explicit freshContext policy; missing policy never falls back silently to advisory", path: ".wiki/config.json", severity: "error" });
    } else if (configRaw && !parseFreshContextPolicy(configRaw.freshContext)) {
      findings.push({ code: "fresh-context-config-invalid", message: "freshContext requires mode, requiredVerdict: PASS, evidenceRequired, a complete trust policy, and a valid optional requiredWhen selector", path: ".wiki/config.json", severity: "error" });
    }
  }

  const agents = view.exists("AGENTS.md") ? view.read("AGENTS.md") : "";
  if (parsedConfig?.version === 2 || hasTypedManagedAgentRules(agents)) {
    findings.push(...validateManagedAgentRules(agents));
  } else if (!agents.includes("wiki-ssot:fresh-context-guardrail")) {
    // v1 adopters keep their legacy marker contract until an upgrade replaces
    // the managed block with the typed v2 rule payload.
    findings.push({ code: "fresh-context-agents-marker-missing", message: "root AGENTS.md must contain the wiki-ssot:fresh-context-guardrail integration marker", path: "AGENTS.md", severity: "error" });
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

  if (parsedConfig?.version === 2) {
    if (scripts["wiki:check"] !== "bun scripts/wiki/cli.ts check" || scripts["wiki:publish"] !== "bun scripts/wiki/cli.ts publish") {
      findings.push({ code: "local-status-command-missing", message: "v2 local-status enforcement requires canonical wiki:check and wiki:publish package scripts", path: packagePath, severity: "error" });
    }
    const workflowPaths = view.listFiles()
      .filter((path) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path))
      .filter((path) => view.exists(path) && (view.mode === "staged" || existsSync(join(view.root, path))))
      .filter((path) => {
        const content = view.read(path);
        return /(?:^|[\s/_-])wiki(?:-|:|\s|$)/i.test(path)
          || /wiki-(?:structure|generated|impact|review-attestation)|scripts\/wiki\/(?:cli|github-attestation)\.ts|\bbun\s+(?:run\s+)?wiki:|\bwiki:(?:lint|doctor|audit|impact|generated|review|check)\b/.test(content);
      })
      .sort();
    if (workflowPaths.length > 0) {
      findings.push({
        code: "local-status-needs-reconcile",
        message: `v2 local-status enforcement still has active Wiki workflow(s): ${workflowPaths.join(", ")}. Confirm each host command is in localChecks, delete the workflows, run wiki:check and wiki:publish, then replace the branch rule with ${parsedConfig.enforcement.statusContext}.`,
        path: workflowPaths[0],
        severity: "error",
      });
    }
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
