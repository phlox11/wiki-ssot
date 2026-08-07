import { parse as parseYaml } from "yaml";
import { git, type RepoView } from "./repository-view";
import {
  type Finding,
  type WikiPage,
  type WikiStatus,
} from "./model";
import { conflictSummary } from "./discovery";
import type { ConflictSummary } from "./discovery";
import { buildConflictMap, buildSourceMap } from "./generated-views";
import { isContentPage, parseWikiPage } from "./page-validation";
import { isHighRisk, mappedConflicts, mappedPages, readConfig, readState, sourceHashes, UsageError, type FreshContextPolicy } from "./verification";
import { isKitManagedPath } from "./kit-packaging";
import { jsonStable } from "./serialization";

export function changedFiles(root: string, base?: string): string[] {
  const chosen = resolveDiffBase(root, base);
  const result = Bun.spawnSync(["git", "diff", "--name-only", `${chosen}...HEAD`], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new UsageError(`invalid --base ${chosen}: ${result.stderr.toString().trim() || "git diff failed"}`);
  return result.stdout.toString().split("\n").filter(Boolean).sort();
}

export function resolveDiffBase(root: string, base?: string): string {
  const exists = (ref: string) => Bun.spawnSync(["git", "rev-parse", "--verify", `${ref}^{commit}`], { cwd: root, stdout: "pipe", stderr: "pipe" }).exitCode === 0;
  if (base != null) {
    if (!exists(base)) throw new UsageError(`invalid --base ${base}: revision does not exist`);
    return base;
  }
  if (exists("origin/main")) return "origin/main";
  if (exists("HEAD~1")) return "HEAD~1";
  if (exists("HEAD")) return "HEAD";
  throw new UsageError("repository has no commit to use as an impact base");
}

export type PrMetadata = {
  change_type?: string;
  semantic_change?: boolean;
  wiki_action?: "update" | "verify" | "none";
  affected_pages?: string[];
  affected_invariants?: string[];
  touched_conflicts?: { id: string; action: "resolve" | "retain" | "introduce"; reason?: string }[];
  fresh_context?: {
    verdict: "PENDING" | "PASS" | "NEEDS_RECONCILE";
    reviewed_head_sha: string;
    bundle_digest: string;
    reviewer: string;
    evidence: string[];
  };
};

export function parsePrMetadata(raw?: string): PrMetadata | undefined {
  return validatePrMetadata(raw).metadata;
}

const CHANGE_TYPES = new Set(["feature", "fix", "refactor", "operations", "proposal", "editorial", "reconcile", "chore", "test", "docs"]);
const WIKI_ACTIONS = new Set(["update", "verify", "none"]);
const CONFLICT_ACTIONS = new Set(["resolve", "retain", "introduce"]);

export function validatePrMetadata(raw?: string, required = false): { metadata?: PrMetadata; findings: Finding[] } {
  const findings: Finding[] = [];
  if (!raw?.trim()) {
    if (required) findings.push({ code: "metadata-missing", message: "PR body requires a parseable yaml metadata block", severity: "error" });
    return { findings };
  }
  const fenced = raw.match(/```ya?ml\s*\n([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? raw;
  let parsed: unknown;
  try { parsed = parseYaml(candidate); }
  catch (error) {
    findings.push({ code: "metadata-parse", message: error instanceof Error ? error.message : String(error), severity: "error" });
    return { findings };
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    findings.push({ code: "metadata-shape", message: "PR metadata must be a YAML mapping", severity: "error" });
    return { findings };
  }
  const value = parsed as Record<string, unknown>;
  if (typeof value.change_type !== "string" || !CHANGE_TYPES.has(value.change_type)) findings.push({ code: "metadata-change-type", message: `invalid or missing change_type: ${String(value.change_type)}`, severity: "error" });
  if (typeof value.semantic_change !== "boolean") findings.push({ code: "metadata-semantic-change", message: "semantic_change must be boolean", severity: "error" });
  if (typeof value.wiki_action !== "string" || !WIKI_ACTIONS.has(value.wiki_action)) findings.push({ code: "metadata-wiki-action", message: `invalid or missing wiki_action: ${String(value.wiki_action)}`, severity: "error" });
  for (const field of ["affected_pages", "affected_invariants"] as const) {
    if (!Array.isArray(value[field]) || !(value[field] as unknown[]).every((item) => typeof item === "string")) findings.push({ code: `metadata-${field.replaceAll("_", "-")}`, message: `${field} must be a string array`, severity: "error" });
  }
  if (!Array.isArray(value.touched_conflicts)) {
    findings.push({ code: "metadata-touched-conflicts", message: "touched_conflicts must be an array", severity: "error" });
  } else {
    const seen = new Set<string>();
    for (const item of value.touched_conflicts) {
      if (item == null || typeof item !== "object" || Array.isArray(item)) {
        findings.push({ code: "metadata-conflict-touch", message: "each touched_conflicts entry must be an object", severity: "error" });
        continue;
      }
      const touch = item as Record<string, unknown>;
      if (typeof touch.id !== "string" || !/^C-\d{3}$/.test(touch.id)) findings.push({ code: "metadata-conflict-id", message: `invalid conflict id: ${String(touch.id)}`, severity: "error" });
      else if (seen.has(touch.id)) findings.push({ code: "metadata-conflict-duplicate", message: `duplicate conflict metadata: ${touch.id}`, severity: "error" });
      else seen.add(touch.id);
      if (typeof touch.action !== "string" || !CONFLICT_ACTIONS.has(touch.action)) findings.push({ code: "metadata-conflict-action", message: `invalid conflict action: ${String(touch.action)}`, severity: "error" });
      if (touch.action === "retain" && (typeof touch.reason !== "string" || touch.reason.trim().length < 20)) findings.push({ code: "metadata-conflict-retain-reason", message: `retaining ${String(touch.id)} requires a 20+ character reason`, severity: "error" });
    }
  }
  if (value.fresh_context == null) {
    if (required) findings.push({ code: "metadata-fresh-context-missing", message: "PR metadata requires the structured fresh_context block even when the template is bypassed", severity: "error" });
  } else if (typeof value.fresh_context !== "object" || Array.isArray(value.fresh_context)) {
    findings.push({ code: "metadata-fresh-context-shape", message: "fresh_context must be a mapping", severity: "error" });
  } else {
    const fresh = value.fresh_context as Record<string, unknown>;
    if (!["PENDING", "PASS", "NEEDS_RECONCILE"].includes(String(fresh.verdict))) findings.push({ code: "metadata-fresh-context-verdict", message: "fresh_context.verdict must be PENDING, PASS, or NEEDS_RECONCILE", severity: "error" });
    for (const field of ["reviewed_head_sha", "bundle_digest", "reviewer"] as const) {
      if (typeof fresh[field] !== "string") findings.push({ code: "metadata-fresh-context-shape", message: `fresh_context.${field} must be a string`, severity: "error" });
    }
    if (!Array.isArray(fresh.evidence) || !fresh.evidence.every((item) => typeof item === "string")) findings.push({ code: "metadata-fresh-context-shape", message: "fresh_context.evidence must be a string array", severity: "error" });
    if (fresh.verdict === "PASS" || fresh.verdict === "NEEDS_RECONCILE") {
      if (typeof fresh.reviewed_head_sha !== "string" || !/^[0-9a-f]{40}$/.test(fresh.reviewed_head_sha)
        || typeof fresh.bundle_digest !== "string" || !/^[0-9a-f]{64}$/.test(fresh.bundle_digest)
        || typeof fresh.reviewer !== "string" || fresh.reviewer.trim().length === 0) {
        findings.push({ code: "metadata-fresh-context-binding", message: "completed fresh_context status requires exact reviewed_head_sha, bundle_digest, and reviewer", severity: "error" });
      }
      if (!Array.isArray(fresh.evidence) || fresh.evidence.length === 0 || fresh.evidence.some((item) => typeof item !== "string" || item.trim().length === 0)) {
        findings.push({ code: "metadata-fresh-context-evidence", message: "completed fresh_context status requires non-empty evidence", severity: "error" });
      }
    }
  }
  return findings.length > 0 ? { findings } : { metadata: value as PrMetadata, findings };
}

export type ImpactReport = {
  base: string;
  mergeBase: string;
  changedFiles: string[];
  affectedPages: string[];
  affectedConflicts: ConflictSummary[];
  removedCurrentPages: { id: string; path: string; headStatus?: WikiStatus }[];
  stalePages: string[];
  highRiskStalePages: string[];
  advisoryStalePages: string[];
  unmappedHighRisk: string[];
  findings: Finding[];
};

export function impactReport(view: RepoView, pages: WikiPage[], options: { base?: string; metadata?: PrMetadata } = {}): ImpactReport {
  const resolvedBase = resolveDiffBase(view.root, options.base);
  const mergeBase = git(view.root, ["merge-base", resolvedBase, "HEAD"]).trim();
  if (!mergeBase) throw new UsageError(`invalid --base ${resolvedBase}: no merge base with HEAD`);
  const files = changedFiles(view.root, resolvedBase);
  const config = readConfig(view);
  const sourceMap = buildSourceMap(pages);
  const baseConflictPaths = git(view.root, ["ls-tree", "-r", "--name-only", mergeBase, "--", "wiki/conflicts"], true).split("\n").filter((path) => path.endsWith(".md"));
  const baseConflicts = baseConflictPaths.flatMap((path) => {
    const raw = git(view.root, ["show", `${mergeBase}:${path}`], true);
    if (!raw) return [];
    try {
      const page = parseWikiPage(path, raw);
      return page.data.kind === "conflict" ? [page] : [];
    } catch {
      return [];
    }
  });
  const conflictsById = new Map<string, WikiPage>();
  for (const page of [...baseConflicts, ...pages.filter((item) => item.data.kind === "conflict")]) conflictsById.set(page.data.conflict_id!, page);
  const conflictMap = buildConflictMap([...baseConflicts, ...pages]);
  const affected = new Set<string>();
  const affectedConflictIds = new Set<string>();
  const highRiskAffected = new Set<string>();
  const unmappedHighRisk: string[] = [];
  const removedCurrentPages: { id: string; path: string; headStatus?: WikiStatus }[] = [];
  for (const path of files) {
    const mapped = mappedPages(sourceMap, path);
    for (const id of mapped) affected.add(id);
    for (const id of mappedConflicts(conflictMap, path)) affectedConflictIds.add(id);
    if (isHighRisk(config, path)) for (const id of mapped) highRiskAffected.add(id);
    const directlyChanged = pages.find((page) => page.path === path && page.data.status === "current");
    if (directlyChanged) affected.add(directlyChanged.data.id);
    const directlyChangedConflict = pages.find((page) => page.path === path && page.data.kind === "conflict");
    if (directlyChangedConflict?.data.conflict_id) affectedConflictIds.add(directlyChangedConflict.data.conflict_id);
    if (isContentPage(path)) {
      const baseRaw = git(view.root, ["show", `${mergeBase}:${path}`], true);
      if (baseRaw) {
        try {
          const basePage = parseWikiPage(path, baseRaw);
          if (basePage.data.status === "current") {
            affected.add(basePage.data.id);
            if (!pages.some((page) => page.data.id === basePage.data.id && page.data.status === "current")) {
              const headPage = pages.find((page) => page.data.id === basePage.data.id);
              removedCurrentPages.push({ id: basePage.data.id, path, ...(headPage ? { headStatus: headPage.data.status } : {}) });
            }
          }
          if (basePage.data.kind === "conflict" && basePage.data.conflict_id) affectedConflictIds.add(basePage.data.conflict_id);
        } catch {
          // A deleted non-page or malformed historical page is handled by the ordinary diff review.
        }
      }
    }
    if (isHighRisk(config, path) && mapped.length === 0) unmappedHighRisk.push(path);
  }
  for (const id of options.metadata?.affected_pages ?? []) {
    if (pages.some((page) => page.data.id === id && page.data.status === "current")) affected.add(id);
  }
  const state = readState(view);
  const stalePages: string[] = [];
  const removedIds = new Set(removedCurrentPages.map((page) => page.id));
  for (const id of affected) {
    if (removedIds.has(id)) continue;
    const page = pages.find((item) => item.data.id === id);
    if (!page || jsonStable(state.pages[id]?.sources ?? {}) !== jsonStable(sourceHashes(view, page))) stalePages.push(id);
  }
  const highRiskStalePages = stalePages.filter((id) => highRiskAffected.has(id)).sort();
  const advisoryStalePages = stalePages.filter((id) => !highRiskAffected.has(id)).sort();
  const findings: Finding[] = unmappedHighRisk.map((path) => ({ code: "unmapped-high-risk", message: `high-risk source has no current wiki page: ${path}`, path, severity: "error" as const }));
  for (const page of removedCurrentPages) findings.push({ code: "current-page-removed", message: `page was removed from current SSOT without a current page retaining its ID: ${page.id}`, path: page.path, severity: "error" });
  for (const id of highRiskStalePages) findings.push({ code: "stale-verification", message: `high-risk affected page has stale or missing source verification: ${id}`, severity: "error" });
  for (const id of advisoryStalePages) findings.push({ code: "stale-verification-low-risk", message: `low-risk affected page has stale or missing source verification: ${id}`, severity: "error" });
  const metadata = options.metadata;
  if (metadata) {
    const pageById = new Map(pages.map((page) => [page.data.id, page]));
    const removedIds = new Set(removedCurrentPages.map((page) => page.id));
    for (const id of metadata.affected_pages ?? []) {
      if (!pageById.has(id) && !removedIds.has(id)) findings.push({ code: "metadata-page-unknown", message: `affected_pages references unknown page: ${id}`, severity: "error" });
    }
    for (const id of metadata.affected_invariants ?? []) {
      const page = pageById.get(id);
      if (!page || page.data.kind !== "invariant") findings.push({ code: "metadata-invariant-unknown", message: `affected_invariants must reference an invariant page: ${id}`, severity: "error" });
    }
    if (metadata.semantic_change === true && metadata.change_type !== "proposal" && ["update", "verify"].includes(metadata.wiki_action ?? "") && (metadata.affected_pages?.length ?? 0) === 0) {
      findings.push({ code: "metadata-pages-required", message: "semantic update/verify changes require affected_pages", severity: "error" });
    }
    if (metadata.semantic_change === true && metadata.wiki_action !== "none") {
      const declared = new Set(metadata.affected_pages ?? []);
      for (const id of affected) if (!declared.has(id)) findings.push({ code: "metadata-page-omitted", message: `affected page is missing from PR metadata: ${id}`, severity: "error" });
    }
    if (metadata.semantic_change === true && metadata.wiki_action === "none") findings.push({ code: "semantic-wiki-none", message: "semantic changes cannot use wiki_action: none", severity: "error" });
    // Bind the flag explicitly: passing the predicate to `.some` directly would
    // hand it the array index as `publishesKit`, granting the exemption from the
    // second element onward.
    const isImplementationSource = (path: string) => isImplementationSourceChange(path, config.publishesKit);
    if (files.some(isImplementationSource) && metadata.wiki_action === "none") findings.push({ code: "implementation-wiki-none", message: "implementation changes cannot use wiki_action: none", severity: "error" });
    const removedCurrentPaths = new Set(removedCurrentPages.map((page) => page.path));
    const changedCurrentDocs = files.filter((path) => removedCurrentPaths.has(path) || pages.some((page) => page.path === path && page.data.status === "current"));
    const implementationChanged = files.some(isImplementationSource);
    if (changedCurrentDocs.length > 0 && !implementationChanged && !["proposal", "editorial", "reconcile"].includes(metadata.change_type ?? "")) {
      findings.push({ code: "current-doc-only-policy", message: "current semantic documentation changes without code require proposal, editorial, or reconcile change_type", severity: "error" });
    }
    const touches = new Map((metadata.touched_conflicts ?? []).map((touch) => [touch.id, touch]));
    for (const id of affectedConflictIds) {
      if (!touches.has(id)) findings.push({ code: "conflict-not-declared", message: `changed sources or conflict records affect open conflict ${id}; declare resolve, retain, or introduce`, severity: "error" });
    }
    const baseById = new Map(baseConflicts.map((page) => [page.data.conflict_id!, page]));
    const headById = new Map(pages.filter((page) => page.data.kind === "conflict").map((page) => [page.data.conflict_id!, page]));
    for (const touch of metadata.touched_conflicts ?? []) {
      const head = headById.get(touch.id);
      const base = baseById.get(touch.id);
      const conflict = head ?? base;
      if (!conflict) {
        findings.push({ code: "metadata-conflict-unknown", message: `touched_conflicts references unknown conflict: ${touch.id}`, severity: "error" });
        continue;
      }
      if (touch.action === "introduce") {
        if (base) findings.push({ code: "conflict-introduce-existing", message: `${touch.id} already existed at the merge base`, severity: "error" });
        if (!head || head.data.status !== "conflicted") findings.push({ code: "conflict-introduce-state", message: `${touch.id} introduce requires an open conflicted page`, severity: "error" });
        if (head?.data.origin === "introduced_by_change" && head.data.severity === "high" && files.some(isImplementationSource)) {
          findings.push({ code: "conflict-introduced-high-risk", message: `a PR may not introduce a new high-severity implementation conflict: ${touch.id}`, severity: "error" });
        }
      }
      if (touch.action === "retain") {
        if (!base) findings.push({ code: "conflict-retain-missing-base", message: `${touch.id} retain requires the conflict to exist at the merge base; use introduce for a new conflict`, severity: "error" });
        if (!head || head.data.status !== "conflicted") findings.push({ code: "conflict-retain-state", message: `${touch.id} retain requires the conflict to remain open`, severity: "error" });
      }
      if (touch.action === "resolve") {
        if (!base) findings.push({ code: "conflict-resolve-missing-base", message: `${touch.id} resolve requires the conflict to exist at the merge base`, severity: "error" });
        const resolution = head?.data.resolution;
        if (!head || head.data.status !== "archived" || resolution?.state !== "verified" || !head.path.startsWith("wiki/conflicts/resolved/")) {
          findings.push({ code: "conflict-resolution-incomplete", message: `${touch.id} resolve requires a verified archived page under wiki/conflicts/resolved`, severity: "error" });
          continue;
        }
        if (!resolution.decision?.trim() || !(resolution.evidence?.length)) findings.push({ code: "conflict-resolution-evidence", message: `${touch.id} resolve requires a decision and evidence`, severity: "error" });
        const declaredPages = new Set(metadata.affected_pages ?? []);
        for (const id of head.data.affected_pages ?? []) {
          if (!declaredPages.has(id)) findings.push({ code: "conflict-resolution-page", message: `${touch.id} resolution must declare affected page ${id}`, severity: "error" });
          const page = pages.find((item) => item.data.id === id);
          if (!page || !files.includes(page.path)) findings.push({ code: "conflict-resolution-page-update", message: `${touch.id} resolution must update current page ${id}`, severity: "error" });
        }
        const declaredInvariants = new Set(metadata.affected_invariants ?? []);
        for (const id of head.data.affected_invariants ?? []) if (!declaredInvariants.has(id)) findings.push({ code: "conflict-resolution-invariant", message: `${touch.id} resolution must declare affected invariant ${id}`, severity: "error" });
        const changedEvidence = head.data.sources.some((source) => files.some((path) => "path" in source ? source.path === path : new Bun.Glob(source.glob).match(path)));
        if (!changedEvidence) findings.push({ code: "conflict-resolution-source", message: `${touch.id} resolution must update at least one declared primary source`, severity: "error" });
      }
    }
  }
  const affectedConflicts = [...affectedConflictIds].map((id) => conflictsById.get(id)).filter((page): page is WikiPage => page != null).map(conflictSummary)
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    base: resolvedBase,
    mergeBase,
    changedFiles: files,
    affectedPages: [...affected].sort(),
    affectedConflicts,
    removedCurrentPages: removedCurrentPages.sort((a, b) => a.id.localeCompare(b.id)),
    stalePages: stalePages.sort(),
    highRiskStalePages,
    advisoryStalePages,
    unmappedHighRisk: unmappedHighRisk.sort(),
    findings,
  };
}

/**
 * `publishesKit` defaults to false so the exemption is never granted by accident.
 * In the publishing repository `kit/**` is a derived copy of files that already
 * carry the wiki obligation, and `wiki:kit --check` keeps the copy honest;
 * elsewhere `kit/` is an ordinary directory and gets no exemption at all.
 */
export function isImplementationSourceChange(path: string, publishesKit = false): boolean {
  if (path.endsWith(".md")) return false;
  if (path.startsWith("wiki/_generated/")) return false;
  if (publishesKit && isKitManagedPath(path)) return false;
  if ([".wiki/state.json", ".wiki/source-map.json", ".wiki/conflict-map.json"].includes(path)) return false;
  return true;
}

export type FreshContextRequirement = {
  applies: boolean;
  reasons: string[];
};

export function evaluateFreshContextRequirement(
  policy: FreshContextPolicy,
  manifest: { affected_invariant_ids: string[]; affected_conflict_ids: string[] },
  impact: ImpactReport,
): FreshContextRequirement {
  const requiredWhen = policy.requiredWhen ?? { kind: "all" as const };
  if (requiredWhen.kind === "all") {
    return { applies: true, reasons: ["policy requires Fresh-context review for every pull request"] };
  }

  const reasons = new Set<string>();
  for (const pattern of requiredWhen.changedFileGlobs) {
    let glob: Bun.Glob;
    try {
      glob = new Bun.Glob(pattern);
    } catch {
      return { applies: true, reasons: [`invalid trusted Fresh-context risk glob fails closed: ${pattern}`] };
    }
    for (const path of impact.changedFiles) {
      if (glob.match(path)) reasons.add(`changed file matches ${pattern}: ${path}`);
    }
  }
  if (requiredWhen.affectedInvariants && manifest.affected_invariant_ids.length > 0) {
    reasons.add(`affected invariants: ${manifest.affected_invariant_ids.join(", ")}`);
  }
  if (requiredWhen.affectedConflicts && manifest.affected_conflict_ids.length > 0) {
    reasons.add(`affected conflicts: ${manifest.affected_conflict_ids.join(", ")}`);
  }
  if (requiredWhen.removedCurrentPages && impact.removedCurrentPages.length > 0) {
    reasons.add(`removed or demoted current pages: ${impact.removedCurrentPages.map((page) => page.id).join(", ")}`);
  }
  return { applies: reasons.size > 0, reasons: [...reasons].sort((a, b) => a.localeCompare(b)) };
}

export function canonicalPrMetadata(metadata?: PrMetadata): unknown {
  if (!metadata) return null;
  return {
    change_type: metadata.change_type,
    semantic_change: metadata.semantic_change,
    wiki_action: metadata.wiki_action,
    affected_pages: [...(metadata.affected_pages ?? [])].sort((a, b) => a.localeCompare(b)),
    affected_invariants: [...(metadata.affected_invariants ?? [])].sort((a, b) => a.localeCompare(b)),
    touched_conflicts: [...(metadata.touched_conflicts ?? [])]
      .map((touch) => ({ id: touch.id, action: touch.action, ...(touch.reason == null ? {} : { reason: touch.reason.trim() }) }))
      .sort((a, b) => a.id.localeCompare(b.id) || a.action.localeCompare(b.action)),
  };
}
