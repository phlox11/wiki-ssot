import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { expandSource, git, type RepoView } from "./repository-view";
import { isContentPage, parseWikiPage } from "./page-validation";
import type {
  Finding,
  WikiFrontmatter,
  WikiPage,
  WikiSource,
} from "./model";
import { currentPages } from "./discovery";
import { hashContent, jsonStable } from "./serialization";
import { canonicalPrMetadata, type ImpactReport, type PrMetadata } from "./impact";

export type ReviewManifest = {
  version: 1;
  base_ref: string;
  merge_base_sha: string;
  head_sha: string;
  pr_metadata_digest: string;
  impact_report_digest: string;
  diff_digest: string;
  affected_page_ids: string[];
  affected_invariant_ids: string[];
  affected_conflict_ids: string[];
  file_digests: Record<string, string>;
  bundle_digest: string;
  /**
   * TE-04 keeps the v1 manifest envelope so existing Fresh-context reports
   * remain valid, while binding the new focused reviewer-input projection by
   * digest.  The field is optional on hand-authored v1 fixtures for backwards
   * compatibility; publisher-generated manifests always populate it.
   */
  focused_manifest_digest?: string;
};

export type FocusedBodyRole = "affected_page" | "invariant" | "removed_page" | "conflict";
export type FocusedSourceRole = "changed_source" | "affected_authority_source" | "relevant_test" | "supporting_source";
export type FocusedBodyBinding = {
  role: FocusedBodyRole;
  id: string;
  wiki_path: string;
  lifecycle: "head" | "merge-base";
  digest: string;
};
export type FocusedBodyObject = {
  digest: string;
  object_path: string;
  bytes: number;
};
export type FocusedSourceDeclaration = {
  id: string;
  page_id: string;
  declaration: WikiSource;
  matched_via: "path" | "glob";
  expanded_glob?: string;
};
export type FocusedSourceBinding = {
  path: string;
  roles: FocusedSourceRole[];
  declared_by: string[];
  declaration_ids: string[];
  head_digest?: string;
  merge_base_digest?: string;
  lifecycle: "head" | "merge-base" | "added" | "removed" | "changed" | "unchanged";
};
export type FocusedReviewManifest = {
  version: 1;
  head_sha: string;
  merge_base_sha: string;
  diff_digest: string;
  impact_report_digest: string;
  pr_metadata_digest: string;
  changed_files: string[];
  body_roles: FocusedBodyBinding[];
  objects: FocusedBodyObject[];
  source_declarations: FocusedSourceDeclaration[];
  source_roles: FocusedSourceBinding[];
};

function canonicalImpactReport(report: ImpactReport): ImpactReport {
  const lexical = (a: string, b: string) => a.localeCompare(b);
  return {
    ...report,
    changedFiles: [...report.changedFiles].sort(lexical),
    affectedPages: [...report.affectedPages].sort(lexical),
    affectedConflicts: [...report.affectedConflicts].sort((a, b) => a.id.localeCompare(b.id)),
    removedCurrentPages: [...report.removedCurrentPages].sort((a, b) => a.id.localeCompare(b.id)),
    stalePages: [...report.stalePages].sort(lexical),
    highRiskStalePages: [...report.highRiskStalePages].sort(lexical),
    advisoryStalePages: [...report.advisoryStalePages].sort(lexical),
    unmappedHighRisk: [...report.unmappedHighRisk].sort(lexical),
    findings: [...report.findings].sort((a, b) => a.code.localeCompare(b.code) || (a.path ?? "").localeCompare(b.path ?? "") || a.message.localeCompare(b.message)),
  };
}
type FocusedReviewData = {
  manifest: FocusedReviewManifest;
  objects: Record<string, string>;
};

function focusedSourcePath(path: string): boolean {
  return /(^|\/)[^/]+\.(?:test|spec)\.[^/]+$/.test(path) || path.endsWith(".test.ts") || path.endsWith(".spec.ts");
}

function canonicalSourceDeclaration(source: WikiSource): WikiSource {
  return "path" in source
    ? { path: source.path, ...(source.symbols ? { symbols: [...source.symbols].sort((a, b) => a.localeCompare(b)) } : {}) }
    : { glob: source.glob };
}

function pageAtRevision(root: string, revision: string, path: string): WikiPage | undefined {
  const raw = git(root, ["show", `${revision}:${path}`], true);
  if (!raw) return undefined;
  try { return parseWikiPage(path, raw); } catch { return undefined; }
}

function filesAtRevision(root: string, revision: string): string[] {
  return git(root, ["ls-tree", "-r", "--name-only", revision], true)
    .split("\n")
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function sourceAtRevision(root: string, revision: string, path: string): { exists: boolean; raw: string } {
  // `git show` returns an empty string both for an empty blob and for a
  // missing path.  cat-file's exit code preserves that existence bit so an
  // empty source still receives a real SHA-256 digest and lifecycle state.
  const result = Bun.spawnSync(["git", "cat-file", "-p", `${revision}:${path}`], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0
    ? { exists: true, raw: result.stdout.toString() }
    : { exists: false, raw: "" };
}

function expandSourceAtRevision(root: string, revision: string, source: WikiSource, files: string[]): string[] {
  if ("path" in source) return files.includes(source.path) ? [source.path] : [];
  const glob = new Bun.Glob(source.glob);
  return files.filter((path) => glob.match(path)).sort((a, b) => a.localeCompare(b));
}

function focusedReviewData(view: RepoView, pages: WikiPage[], report: ImpactReport, metadata?: PrMetadata): FocusedReviewData {
  const headSha = git(view.root, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  const diff = git(view.root, ["diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", `${report.mergeBase}..HEAD`], true);
  const impact = jsonStable(canonicalImpactReport(report));
  const metadataDigest = hashContent(jsonStable(canonicalPrMetadata(metadata)));
  const objects = new Map<string, string>();
  const bodyRoles: FocusedBodyBinding[] = [];
  const addBody = (role: FocusedBodyRole, id: string, wikiPath: string, lifecycle: "head" | "merge-base", raw: string) => {
    if (!raw) return;
    const digest = hashContent(raw);
    const objectPath = `objects/${digest}.md`;
    objects.set(digest, raw);
    bodyRoles.push({ role, id, wiki_path: wikiPath, lifecycle, digest });
  };

  const currentById = new Map(pages.map((page) => [page.data.id, page]));
  const changedSet = new Set(report.changedFiles);
  const authorityIds = new Set([
    ...report.affectedPages,
    ...(metadata?.affected_invariants ?? []),
    ...report.affectedConflicts.flatMap((conflict) => conflict.affectedInvariants),
  ]);
  const canonicalPageSources = (page: WikiPage): WikiSource[] => page.data.sources
    .map(canonicalSourceDeclaration)
    .sort((a, b) => jsonStable(a).localeCompare(jsonStable(b)));
  const sourceDeclarationsDiffer = (headPage: WikiPage, basePage: WikiPage): boolean => jsonStable(canonicalPageSources(headPage)) !== jsonStable(canonicalPageSources(basePage));
  for (const id of [...report.affectedPages].sort((a, b) => a.localeCompare(b))) {
    const page = currentById.get(id);
    if (page) addBody("affected_page", id, page.path, "head", page.raw);
  }
  const invariants = currentPages(pages).filter((page) => page.data.kind === "invariant");
  for (const page of invariants) addBody("invariant", page.data.id, page.path, "head", page.raw);
  // Preserve a merge-base authority body when a current affected page changed
  // its source declarations. This is intentionally limited to declaration
  // differences so ordinary focused bundles do not duplicate unchanged page
  // bodies. Demoted/removed invariants retain their historical body as before.
  const baseAuthorityPaths = git(view.root, ["ls-tree", "-r", "--name-only", report.mergeBase, "--", "wiki"], true)
    .split("\n").filter(isContentPage);
  for (const path of baseAuthorityPaths) {
    const basePage = pageAtRevision(view.root, report.mergeBase, path);
    if (!basePage || basePage.data.status !== "current" || basePage.data.kind !== "invariant") continue;
    const headPage = currentById.get(basePage.data.id);
    if (!headPage || headPage.data.kind !== "invariant" || headPage.data.status !== "current" || (authorityIds.has(basePage.data.id) && sourceDeclarationsDiffer(headPage, basePage))) {
      addBody("invariant", basePage.data.id, basePage.path, "merge-base", basePage.raw);
    }
  }
  for (const path of baseAuthorityPaths) {
    const basePage = pageAtRevision(view.root, report.mergeBase, path);
    const headPage = basePage ? currentById.get(basePage.data.id) : undefined;
    if (!basePage || basePage.data.status !== "current" || basePage.data.kind === "invariant" || !headPage || headPage.data.status !== "current") continue;
    if (authorityIds.has(basePage.data.id) && sourceDeclarationsDiffer(headPage, basePage)) {
      addBody("affected_page", basePage.data.id, basePage.path, "merge-base", basePage.raw);
    }
  }
  for (const removed of [...report.removedCurrentPages].sort((a, b) => a.id.localeCompare(b.id))) {
    const raw = git(view.root, ["show", `${report.mergeBase}:${removed.path}`], true);
    if (raw) addBody("removed_page", removed.id, removed.path, "merge-base", raw);
  }
  for (const conflict of [...report.affectedConflicts].sort((a, b) => a.id.localeCompare(b.id))) {
    const page = pages.find((item) => item.data.kind === "conflict" && item.data.conflict_id === conflict.id);
    const raw = page?.raw ?? git(view.root, ["show", `${report.mergeBase}:${conflict.path}`], true);
    if (raw) addBody("conflict", conflict.id, page?.path ?? conflict.path, page ? "head" : "merge-base", raw);
  }
  const bodyBindings = bodyRoles.sort((a, b) => a.role.localeCompare(b.role)
    || a.id.localeCompare(b.id)
    || a.lifecycle.localeCompare(b.lifecycle)
    || a.digest.localeCompare(b.digest)
    || a.wiki_path.localeCompare(b.wiki_path));
  const objectRefs: FocusedBodyObject[] = [...objects.entries()]
    .map(([digest, raw]) => ({ digest, object_path: `objects/${digest}.md`, bytes: Buffer.byteLength(raw, "utf8") }))
    .sort((a, b) => a.digest.localeCompare(b.digest));

  type UndigestedDeclaration = Omit<FocusedSourceDeclaration, "id">;
  const declarations = new Map<string, UndigestedDeclaration[]>();
  const mergeBaseFiles = filesAtRevision(view.root, report.mergeBase);
  const headFiles = new Set(view.listFiles());
  const addDeclarations = (page: WikiPage, authority: boolean, revision: "head" | "merge-base") => {
    for (const rawDeclaration of page.data.sources) {
      const declaration = canonicalSourceDeclaration(rawDeclaration);
      // Exact declarations remain explicit primary inputs.  Broad globs are
      // focused to changed matches; otherwise a recursive publisher glob would
      // reintroduce the unrelated source breadth TE-04 is removing.
      const expanded = revision === "merge-base"
        ? expandSourceAtRevision(view.root, report.mergeBase, rawDeclaration, mergeBaseFiles)
        : expandSource(view, rawDeclaration);
      const paths = "path" in rawDeclaration
        ? expanded
        : expanded.filter((path) => changedSet.has(path) || (revision === "merge-base" && !headFiles.has(path)));
      // Keep an exact declaration even when the file was deleted from HEAD;
      // its merge-base digest remains independently verifiable.
      const candidates = "path" in rawDeclaration && paths.length === 0 ? [rawDeclaration.path] : paths;
      for (const path of candidates) {
        const item: UndigestedDeclaration = {
          page_id: page.data.id,
          declaration,
          matched_via: "path" in rawDeclaration ? "path" : "glob",
          ...( "glob" in rawDeclaration ? { expanded_glob: rawDeclaration.glob } : {}),
        };
        const existing = declarations.get(path) ?? [];
        if (!existing.some((entry) => jsonStable(entry) === jsonStable(item))) existing.push(item);
        declarations.set(path, existing);
      }
    }
    // `authority` is consumed below when role sets are assigned.  Keep the
    // argument explicit so adding a second provenance boundary cannot silently
    // drop the page identity.
    void authority;
  };
  const requiredPageIds = new Set([...report.affectedPages, ...invariants.map((page) => page.data.id)]);
  for (const page of pages.filter((item) => item.data.status === "current" && requiredPageIds.has(item.data.id))) addDeclarations(page, authorityIds.has(page.data.id), "head");
  // The merge-base declaration view is required for every affected current
  // authority page, not only invariants. Keep all merge-base invariants for
  // their independent authority bodies, then add affected product/architecture
  // pages whose globs can still explain a deleted source at HEAD.
  for (const path of baseAuthorityPaths) {
    const basePage = pageAtRevision(view.root, report.mergeBase, path);
    if (basePage?.data.status !== "current") continue;
    if (basePage.data.kind === "invariant" || authorityIds.has(basePage.data.id)) addDeclarations(basePage, authorityIds.has(basePage.data.id), "merge-base");
  }
  for (const conflictPage of pages.filter((item) => item.data.kind === "conflict" && report.affectedConflicts.some((summary) => summary.id === item.data.conflict_id))) addDeclarations(conflictPage, false, "head");
  for (const summary of report.affectedConflicts) {
    if (pages.some((page) => page.data.kind === "conflict" && page.data.conflict_id === summary.id)) continue;
    const basePage = pageAtRevision(view.root, report.mergeBase, summary.path);
    if (basePage?.data.kind === "conflict") addDeclarations(basePage, false, "merge-base");
  }

  // Do not emit a lifecycle record for a stale declaration that is absent
  // from both revisions.  A changed path is retained because the diff itself
  // is the provenance even when an unusual tree state cannot be read here.
  for (const path of [...declarations.keys()]) {
    const baseState = sourceAtRevision(view.root, report.mergeBase, path);
    if (!headFiles.has(path) && !baseState.exists && !changedSet.has(path)) declarations.delete(path);
  }
  const sourceBindings: FocusedSourceBinding[] = [];
  const declarationEntries = [...new Map(
    [...declarations.values()].flat().map((entry) => [jsonStable(entry), entry] as const),
  ).values()]
    .sort((a, b) => jsonStable(a).localeCompare(jsonStable(b)))
    .map((entry, index) => ({ ...entry, id: `D-${String(index + 1).padStart(4, "0")}` }));
  const declarationIds = new Map(declarationEntries.map((entry) => [jsonStable({ ...entry, id: undefined }), entry.id]));
  const sourcePaths = new Set([...declarations.keys(), ...report.changedFiles]);
  for (const path of [...sourcePaths].sort((a, b) => a.localeCompare(b))) {
    const records = (declarations.get(path) ?? []).sort((a, b) => a.page_id.localeCompare(b.page_id) || jsonStable(a.declaration).localeCompare(jsonStable(b.declaration)) || a.matched_via.localeCompare(b.matched_via));
    const declaredBy = [...new Set(records.map((entry) => entry.page_id))].sort((a, b) => a.localeCompare(b));
    const roles = new Set<FocusedSourceRole>();
    if (changedSet.has(path)) roles.add("changed_source");
    if (records.some((entry) => authorityIds.has(entry.page_id))) roles.add("affected_authority_source");
    if (focusedSourcePath(path)) roles.add("relevant_test");
    if (roles.size === 0 || (roles.size === 1 && roles.has("changed_source") && declaredBy.length === 0)) roles.add("supporting_source");
    const headExists = headFiles.has(path);
    const headRaw = headExists ? view.read(path) : "";
    const baseState = sourceAtRevision(view.root, report.mergeBase, path);
    const headDigest = headExists ? hashContent(headRaw) : undefined;
    const baseDigest = baseState.exists ? hashContent(baseState.raw) : undefined;
    // A stale declaration that is absent from both revisions was removed from
    // `declarations` above. Changed files always exist on at least one side,
    // and exact declarations retain their path when one side is deleted.
    if (!headExists && !baseState.exists) continue;
    const lifecycle: FocusedSourceBinding["lifecycle"] = headExists && baseState.exists
      ? headDigest === baseDigest ? "unchanged" : "changed"
      : headExists ? "added" : "removed";
    sourceBindings.push({
      path,
      roles: [...roles].sort((a, b) => a.localeCompare(b)),
      declared_by: declaredBy,
      declaration_ids: records.map((entry) => declarationIds.get(jsonStable(entry))).filter((id): id is string => id != null).sort((a, b) => a.localeCompare(b)),
      ...(headDigest ? { head_digest: headDigest } : {}),
      ...(baseDigest ? { merge_base_digest: baseDigest } : {}),
      lifecycle,
    });
  }

  const manifest: FocusedReviewManifest = {
    version: 1,
    head_sha: headSha,
    merge_base_sha: report.mergeBase,
    diff_digest: hashContent(diff),
    impact_report_digest: hashContent(impact),
    pr_metadata_digest: metadataDigest,
    changed_files: [...report.changedFiles].sort((a, b) => a.localeCompare(b)),
    body_roles: bodyBindings,
    objects: objectRefs,
    source_declarations: declarationEntries,
    source_roles: sourceBindings,
  };
  return { manifest, objects: Object.fromEntries([...objects.entries()].map(([digest, raw]) => [`objects/${digest}.md`, raw])) };
}

function reviewBundleFiles(view: RepoView, pages: WikiPage[], report: ImpactReport, metadata?: PrMetadata): Record<string, string> {
  const files: Record<string, string> = {};
  files["diff.patch"] = git(view.root, ["diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", `${report.mergeBase}..HEAD`], true);
  files["impact.json"] = jsonStable(canonicalImpactReport(report));
  files["pr-metadata.json"] = jsonStable(canonicalPrMetadata(metadata));
  const focused = focusedReviewData(view, pages, report, metadata);
  for (const [path, content] of Object.entries(focused.objects)) files[path] = content;
  const invariants = currentPages(pages).filter((page) => page.data.kind === "invariant");
  const affectedSources = Object.fromEntries([...report.affectedPages].sort((a, b) => a.localeCompare(b)).map((id) => {
    const page = pages.find((item) => item.data.id === id);
    return [id, page?.data.sources ?? []];
  }));
  files["sources.json"] = jsonStable({
    affectedPages: affectedSources,
    affectedConflicts: [...report.affectedConflicts].sort((a, b) => a.id.localeCompare(b.id)),
    removedCurrentPages: [...report.removedCurrentPages].sort((a, b) => a.id.localeCompare(b.id)),
    invariants: invariants.map((page) => page.data.id),
    focusedManifest: "focused-manifest.json",
  });
  files["focused-manifest.json"] = jsonStable(focused.manifest);
  files["PROMPT.md"] = `# Fresh-context wiki reconciliation

Read \`manifest.json\`, \`focused-manifest.json\`, \`impact.json\`, \`pr-metadata.json\`, \`diff.patch\`, \`objects/**\`, and \`sources.json\`. The focused manifest is the single deterministic index of reviewer inputs: body roles point at content-addressed \`objects/<sha256>.md\` files, while source roles carry changed, affected-authority, relevant-test, and supporting provenance. An affected page that is also an invariant intentionally has two role records sharing one object digest. Removed-page and conflict role aliases, when present for compatibility, are filesystem links to those objects rather than second body copies; reviewers should read the object path recorded by the role. Inspect the referenced repository primary sources directly. Verify current behavior, intent, invariants, conflict actions, acceptance criteria, and sources independently. Do not trust the author summary and do not resolve an open decision conflict without an explicit owner decision.

Report every discrepancy as a structured finding described by \`REPORT.md\`, and decide its disposition instead of assuming this candidate must fix it:

- A problem this candidate introduced, or a contract the PR itself declares, has to be fixed here. The engine enforces this: those classifications accept no deferring disposition, only \`fixed\` or \`unresolved\`.
- A mismatch that predates the candidate, an undecidable product intent, or a documentation disagreement may instead be tracked by an open conflict this candidate introduces or already links, with acceptance criteria.
- A real defect outside this change's semantic scope belongs in a named follow-up, not in this diff.

Classify by what you actually found. \`REPORT.md\` lists which dispositions each classification admits, and the engine rejects a pair outside that table. It cannot tell whether the classification itself is honest: a regression relabelled as pre-existing buys deferrals the engine will accept. That judgement is yours alone, which makes it the one that matters.

Return the report as:

- \`PASS\` only when code, tests, metadata, wiki, and conflict lifecycle agree, and every remaining finding is either fixed, named where it is tracked, dismissed with a reason, or a \`recorded\` suggestion. A \`PASS\` may not carry an \`unresolved\` finding.
- \`NEEDS_RECONCILE\` when anything is stale, unsupported, ambiguous, or violates an invariant or conflict resolution contract and is not yet tracked anywhere.

Scope is not permission to be exhaustive about the repository: a finding must bind to this candidate's diff, declared metadata, affected pages, invariants, or conflicts.
`;
  files["REPORT.md"] = `# Fresh-context report contract

Create a JSON report from \`REPORT.example.json\`, or \`REPORT.findings.example.json\` when there is anything to report. Copy the exact \`head_sha\`, \`merge_base_sha\`, and \`bundle_digest\` from \`manifest.json\`. Set \`reviewer\` to the authenticated actor that will publish the attestation. Evidence must identify the files, tests, invariants, or conflict criteria actually checked; PASS without evidence is invalid.

Version 2 findings are structured. Each entry requires:

- \`id\` — unique within the report.
- \`classification\` — \`candidate_regression\`, \`declared_contract_violation\`, \`preexisting_implementation_mismatch\`, \`decision_ambiguity\`, \`documentation_disagreement\`, \`unrelated_defect\`, or \`suggestion\`.
- \`disposition\` — what the reviewed tree already does about it: \`unresolved\` (nothing yet, so the verdict cannot be \`PASS\`), \`fixed\`, \`conflict_introduced\`, \`existing_conflict_linked\`, \`followup_created\`, \`recorded\` (noted without action), or \`dismissed_with_reason\`. This is your observation of the candidate, never the author's claim. \`conflict_introduced\` and \`existing_conflict_linked\` require \`conflict_id\`; \`followup_created\` requires \`followup_ref\`; \`dismissed_with_reason\` requires a 20+ character \`dismissal_reason\`.
- \`scope_refs\` — one or more \`page:\`, \`source:\`, \`invariant:\`, \`conflict:\`, \`test:\`, or \`metadata:\` references binding the finding to this candidate.
- \`discrepancy\`, \`authority\` (\`{kind, ref}\` naming the controlling normative/observed/derived/test/metadata source), \`evidence\`, and \`acceptance_criteria\` (objective and closable; only a \`suggestion\` may omit them).

The engine refuses a \`PASS\` that carries an \`unresolved\` finding, and it adjudicates which disposition may retire which classification:

| classification | may be retired by |
|---|---|
| \`candidate_regression\`, \`declared_contract_violation\` | \`fixed\` |
| \`preexisting_implementation_mismatch\`, \`documentation_disagreement\` | \`fixed\`, \`conflict_introduced\`, \`existing_conflict_linked\`, \`followup_created\`, \`dismissed_with_reason\` |
| \`decision_ambiguity\` | \`fixed\`, \`conflict_introduced\`, \`existing_conflict_linked\` |
| \`unrelated_defect\` | \`fixed\`, \`existing_conflict_linked\`, \`followup_created\`, \`dismissed_with_reason\` |
| \`suggestion\` | \`fixed\`, \`followup_created\`, \`recorded\`, \`dismissed_with_reason\` |

\`unresolved\` stays available everywhere, but it blocks \`PASS\`. So a break this candidate caused, or a contract the PR itself declares, is closed only by fixing it: classify honestly rather than reaching for a classification whose deferrals are wider.

A disposition naming a conflict must name one that is open at the reviewed HEAD, carries the conflict type its classification implies where one is implied, declares \`origin: baseline\` whenever the classification says the problem predates this candidate, and lists at least one of the finding's \`page:\` scope refs among its affected pages. \`unrelated_defect\` implies no conflict type; \`decision_ambiguity\` is exempt from the \`origin\` rule, because this candidate may legitimately raise a new question about its own behaviour. The author writes that \`origin\` and you write the classification independently; the engine only requires that the two agree.

A \`version: 1\` report with free-text \`findings\` is still accepted so an in-flight review is not invalidated, but it cannot express a disposition. Prefer version 2.

Publish the report through the repository's trusted attestation channel. A report in the author's editable PR body is only a status mirror and is not proof of independent review.
`;
  files["REPORT.example.json"] = jsonStable({
    version: 2,
    verdict: "PASS",
    reviewed_head_sha: "<copy manifest.head_sha>",
    merge_base_sha: "<copy manifest.merge_base_sha>",
    bundle_digest: "<copy manifest.bundle_digest>",
    reviewer: "<authenticated reviewer actor>",
    evidence: ["Describe the primary sources, tests, invariants, and conflicts inspected."],
    summary: "Explain why the current implementation and wiki agree.",
  });
  files["REPORT.findings.example.json"] = jsonStable({
    version: 2,
    verdict: "NEEDS_RECONCILE",
    reviewed_head_sha: "<copy manifest.head_sha>",
    merge_base_sha: "<copy manifest.merge_base_sha>",
    bundle_digest: "<copy manifest.bundle_digest>",
    reviewer: "<authenticated reviewer actor>",
    evidence: ["<page, source, test, or conflict actually inspected>"],
    summary: "One finding must be fixed here; the other is already tracked by an open conflict.",
    findings: [
      {
        id: "FC-001",
        classification: "candidate_regression",
        disposition: "unresolved",
        scope_refs: ["source:<path changed by this candidate>", "page:<affected page id>"],
        discrepancy: "<what the candidate broke, stated against the controlling authority>",
        authority: { kind: "normative", ref: "<wiki page or invariant that governs it>" },
        acceptance_criteria: ["<objective, checkable condition that closes this finding>"],
        evidence: ["<file or test that demonstrates the break>"],
      },
      {
        id: "FC-002",
        classification: "preexisting_implementation_mismatch",
        disposition: "existing_conflict_linked",
        conflict_id: "C-000",
        scope_refs: ["page:<affected page id>", "conflict:C-000"],
        discrepancy: "<mismatch that predates this candidate>",
        authority: { kind: "normative", ref: "<wiki page that states the intended contract>" },
        acceptance_criteria: ["<condition recorded in the conflict's resolution.acceptance>"],
        evidence: ["<source read at the merge base showing the mismatch predates the diff>"],
      },
    ],
  });
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

export function buildFocusedReviewManifest(view: RepoView, pages: WikiPage[], report: ImpactReport, metadata?: PrMetadata): FocusedReviewManifest {
  return focusedReviewData(view, pages, report, metadata).manifest;
}

/** Validate focused reviewer inputs and their optional emitted object bytes. */
export function validateFocusedReviewManifest(
  focused: FocusedReviewManifest,
  files: Record<string, string> = {},
  expected?: ReviewManifest,
  enforceRequired = true,
  repositoryRoot?: string,
): Finding[] {
  const findings: Finding[] = [];
  const error = (code: string, message: string, path = "focused-manifest.json") => findings.push({ code, message, path, severity: "error" });
  if (focused == null || typeof focused !== "object") return [{ code: "focused-manifest-shape", message: "focused manifest must be an object", path: "focused-manifest.json", severity: "error" }];
  if (focused.version !== 1) error("focused-manifest-version", "focused manifest version must be 1");
  for (const [field, value, length] of [
    ["head_sha", focused.head_sha, 40],
    ["merge_base_sha", focused.merge_base_sha, 40],
    ["diff_digest", focused.diff_digest, 64],
    ["impact_report_digest", focused.impact_report_digest, 64],
    ["pr_metadata_digest", focused.pr_metadata_digest, 64],
  ] as const) {
    if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) error("focused-manifest-digest", `${field} must be a lowercase digest`, field);
  }
  if (!Array.isArray(focused.changed_files) || focused.changed_files.some((path) => typeof path !== "string" || path.length === 0)) error("focused-manifest-changed-files", "changed_files must be a string array");
  const objects = new Map<string, FocusedBodyObject>();
  if (!Array.isArray(focused.objects)) error("focused-manifest-objects", "objects must be an array");
  for (const [index, object] of (Array.isArray(focused.objects) ? focused.objects : []).entries()) {
    if (object == null || typeof object !== "object" || !/^[0-9a-f]{64}$/.test(object.digest) || object.object_path !== `objects/${object.digest}.md` || !Number.isInteger(object.bytes) || object.bytes < 0) {
      error("focused-manifest-object-malformed", `objects[${index}] must bind a SHA-256 digest to objects/<digest>.md`, `focused-manifest.json:objects[${index}]`);
      continue;
    }
    if (objects.has(object.digest)) error("focused-manifest-object-duplicate", `duplicate body object digest: ${object.digest}`, `focused-manifest.json:objects[${index}]`);
    objects.set(object.digest, object);
    if (Object.keys(files).length > 0) {
      const raw = files[object.object_path];
      if (raw == null) error("focused-manifest-object-missing", `body object is missing from bundle: ${object.object_path}`, object.object_path);
      else {
        if (hashContent(raw) !== object.digest) error("focused-manifest-object-digest", `body object digest does not match bytes: ${object.object_path}`, object.object_path);
        if (Buffer.byteLength(raw, "utf8") !== object.bytes) error("focused-manifest-object-bytes", `body object byte count does not match bytes: ${object.object_path}`, object.object_path);
      }
    }
  }
  const bodyRoles = new Set<string>();
  const validBodyRoles: FocusedBodyBinding[] = [];
  if (!Array.isArray(focused.body_roles)) error("focused-manifest-body-roles", "body_roles must be an array");
  for (const [index, role] of (Array.isArray(focused.body_roles) ? focused.body_roles : []).entries()) {
    const valid = role != null && typeof role === "object"
      && ["affected_page", "invariant", "removed_page", "conflict"].includes(role.role)
      && typeof role.id === "string" && typeof role.wiki_path === "string"
      && ["head", "merge-base"].includes(role.lifecycle)
      && /^[0-9a-f]{64}$/.test(role.digest)
      && objects.has(role.digest);
    if (!valid) {
      error("focused-manifest-body-role", `body_roles[${index}] has an invalid or unbound object role`, `focused-manifest.json:body_roles[${index}]`);
      continue;
    }
    const key = `${role.role}:${role.id}:${role.lifecycle}`;
    if (bodyRoles.has(key)) error("focused-manifest-body-role-duplicate", `duplicate body role: ${key}`, `focused-manifest.json:body_roles[${index}]`);
    bodyRoles.add(key);
    validBodyRoles.push(role);
  }
  if (repositoryRoot) {
    for (const role of validBodyRoles) {
      if (!isContentPage(role.wiki_path)) {
        error("focused-manifest-body-path", `body role path is not a content wiki page: ${role.wiki_path}`, role.wiki_path);
        continue;
      }
      const revision = role.lifecycle === "head" ? focused.head_sha : focused.merge_base_sha;
      if (!/^[0-9a-f]{40}$/.test(revision)) continue;
      const actual = sourceAtRevision(repositoryRoot, revision, role.wiki_path);
      if (!actual.exists) {
        error("focused-manifest-body-revision-missing", `body role path is missing at its declared ${role.lifecycle} revision: ${role.wiki_path}`, role.wiki_path);
      } else if (hashContent(actual.raw) !== role.digest) {
        error("focused-manifest-body-revision-binding", `body role bytes do not match its declared ${role.lifecycle} revision: ${role.wiki_path}`, role.wiki_path);
      } else {
        try {
          const page = parseWikiPage(role.wiki_path, actual.raw);
          const identityMatches = role.role === "conflict"
            ? page.data.kind === "conflict" && page.data.conflict_id === role.id
            : page.data.id === role.id;
          if (!identityMatches) error("focused-manifest-body-revision-identity", `body role identity does not match its ${role.lifecycle} revision: ${role.role}/${role.id}`, role.wiki_path);
        } catch {
          // Page-shape findings remain the responsibility of the normal wiki
          // page validator; this check is limited to exact lifecycle bytes.
        }
      }
    }
  }
  const sourceRoles = new Set<FocusedSourceRole>(["changed_source", "affected_authority_source", "relevant_test", "supporting_source"]);
  const declarationsById = new Map<string, FocusedSourceDeclaration>();
  if (!Array.isArray(focused.source_declarations)) error("focused-manifest-source-declarations", "source_declarations must be an array");
  for (const [index, declaration] of (Array.isArray(focused.source_declarations) ? focused.source_declarations : []).entries()) {
    if (declaration == null || typeof declaration !== "object" || typeof declaration.id !== "string" || typeof declaration.page_id !== "string" || !["path", "glob"].includes(declaration.matched_via) || declaration.declaration == null || typeof declaration.declaration !== "object") {
      error("focused-manifest-declaration", `source_declarations[${index}] is malformed`, `focused-manifest.json:source_declarations[${index}]`);
      continue;
    }
    if (declarationsById.has(declaration.id)) error("focused-manifest-declaration-duplicate", `duplicate source declaration ID: ${declaration.id}`, `focused-manifest.json:source_declarations[${index}]`);
    declarationsById.set(declaration.id, declaration);
  }
  const seenSources = new Set<string>();
  const referencedDeclarationIds = new Set<string>();
  if (!Array.isArray(focused.source_roles)) error("focused-manifest-source-roles", "source_roles must be an array");
  for (const [index, source] of (Array.isArray(focused.source_roles) ? focused.source_roles : []).entries()) {
    const valid = source != null && typeof source === "object" && typeof source.path === "string" && source.path.length > 0
      && Array.isArray(source.roles) && source.roles.length > 0 && source.roles.every((role) => sourceRoles.has(role))
      && Array.isArray(source.declared_by) && source.declared_by.every((id) => typeof id === "string")
      && Array.isArray(source.declaration_ids) && source.declaration_ids.every((id) => typeof id === "string" && declarationsById.has(id))
      && ["head", "merge-base", "added", "removed", "changed", "unchanged"].includes(source.lifecycle)
      && (source.head_digest == null || /^[0-9a-f]{64}$/.test(source.head_digest))
      && (source.merge_base_digest == null || /^[0-9a-f]{64}$/.test(source.merge_base_digest));
    if (!valid) {
      error("focused-manifest-source-role", `source_roles[${index}] is malformed or has an unknown role`, `focused-manifest.json:source_roles[${index}]`);
      continue;
    }
    if (seenSources.has(source.path)) error("focused-manifest-source-duplicate", `source path appears more than once: ${source.path}`, `focused-manifest.json:source_roles[${index}]`);
    seenSources.add(source.path);
    if (source.roles.includes("changed_source") && !(focused.changed_files as string[]).includes(source.path)) error("focused-manifest-changed-source-missing", `changed_source role is not bound to changed_files: ${source.path}`, source.path);
    if (source.roles.includes("relevant_test") && !focusedSourcePath(source.path)) error("focused-manifest-test-misclassified", `relevant_test role is not a test path: ${source.path}`, source.path);
    const hasHead = source.head_digest != null;
    const hasMergeBase = source.merge_base_digest != null;
    const sameDigest = hasHead && hasMergeBase && source.head_digest === source.merge_base_digest;
    const lifecycleConsistent = source.lifecycle === "added" || source.lifecycle === "head"
      ? hasHead && !hasMergeBase
      : source.lifecycle === "removed" || source.lifecycle === "merge-base"
        ? !hasHead && hasMergeBase
        : source.lifecycle === "changed"
          ? hasHead && hasMergeBase && !sameDigest
          : source.lifecycle === "unchanged"
            ? hasHead && hasMergeBase && sameDigest
            : false;
    if (!lifecycleConsistent) error("focused-manifest-lifecycle-binding", `source lifecycle does not match its head/merge-base digests: ${source.path}`, source.path);
    if (repositoryRoot) {
      const headRevision = /^[0-9a-f]{40}$/.test(focused.head_sha) ? sourceAtRevision(repositoryRoot, focused.head_sha, source.path) : { exists: false, raw: "" };
      const mergeBaseRevision = /^[0-9a-f]{40}$/.test(focused.merge_base_sha) ? sourceAtRevision(repositoryRoot, focused.merge_base_sha, source.path) : { exists: false, raw: "" };
      const expectedHeadDigest = headRevision.exists ? hashContent(headRevision.raw) : undefined;
      const expectedMergeBaseDigest = mergeBaseRevision.exists ? hashContent(mergeBaseRevision.raw) : undefined;
      if (source.head_digest !== expectedHeadDigest) error("focused-manifest-source-head-revision-binding", `source head digest does not match repository HEAD bytes: ${source.path}`, source.path);
      if (source.merge_base_digest !== expectedMergeBaseDigest) error("focused-manifest-source-base-revision-binding", `source merge-base digest does not match repository merge-base bytes: ${source.path}`, source.path);
      const expectedLifecycle: FocusedSourceBinding["lifecycle"] = headRevision.exists && mergeBaseRevision.exists
        ? expectedHeadDigest === expectedMergeBaseDigest ? "unchanged" : "changed"
        : headRevision.exists ? "added" : "removed";
      if (source.lifecycle !== expectedLifecycle) error("focused-manifest-source-revision-lifecycle", `source lifecycle does not match repository HEAD/merge-base existence and bytes: ${source.path}`, source.path);
    }
    if (source.roles.includes("affected_authority_source") && (source.declared_by.length === 0 || source.declaration_ids.length === 0)) error("focused-manifest-authority-provenance", `affected_authority_source requires declaring page and declaration provenance: ${source.path}`, source.path);
    const declarationOwners = [...new Set(source.declaration_ids.map((id) => declarationsById.get(id)?.page_id).filter((id): id is string => id != null))].sort((a, b) => a.localeCompare(b));
    const declaredBy = [...new Set(source.declared_by)].sort((a, b) => a.localeCompare(b));
    if (jsonStable(declarationOwners) !== jsonStable(declaredBy)) error("focused-manifest-declared-by", `declared_by does not exactly match source declaration owners: ${source.path}`, source.path);
    for (const declarationId of source.declaration_ids) {
      referencedDeclarationIds.add(declarationId);
      const declaration = declarationsById.get(declarationId);
      if (!declaration) continue;
      if (!source.declared_by.includes(declaration.page_id)) error("focused-manifest-declaration-owner", `source declaration owner is missing from declared_by: ${source.path}`, source.path);
      const declarationValue = declaration.declaration as Record<string, unknown>;
      const exactPath = typeof declarationValue.path === "string" ? declarationValue.path : undefined;
      const globPattern = typeof declarationValue.glob === "string" ? declarationValue.glob : undefined;
      if (declaration.matched_via === "path" && exactPath == null) error("focused-manifest-declaration-shape", `exact source declaration is missing its path provenance: ${source.path}`, source.path);
      if (declaration.matched_via === "glob" && globPattern == null) error("focused-manifest-declaration-shape", `glob source declaration is missing its glob provenance: ${source.path}`, source.path);
      if (declaration.matched_via === "path" && exactPath != null && exactPath !== source.path) error("focused-manifest-declaration-path", `exact source declaration does not bind its source path: ${source.path}`, source.path);
      if (declaration.matched_via === "glob" && (typeof declaration.expanded_glob !== "string" || declaration.expanded_glob.length === 0 || declaration.expanded_glob !== globPattern)) error("focused-manifest-declaration-glob", `glob source declaration is missing or misclassified expanded provenance: ${source.path}`, source.path);
    }
  }
  for (const declarationId of declarationsById.keys()) {
    if (!referencedDeclarationIds.has(declarationId)) error("focused-manifest-declaration-unreferenced", `source declaration is not bound to any source role: ${declarationId}`, `focused-manifest.json:source_declarations`);
  }
  if (expected) {
    if (focused.head_sha !== expected.head_sha) error("focused-manifest-head-binding", "focused manifest HEAD does not match the enclosing ReviewManifest");
    if (focused.merge_base_sha !== expected.merge_base_sha) error("focused-manifest-base-binding", "focused manifest merge base does not match the enclosing ReviewManifest");
    if (focused.diff_digest !== expected.diff_digest) error("focused-manifest-diff-binding", "focused manifest diff digest does not match the enclosing ReviewManifest");
    if (focused.impact_report_digest !== expected.impact_report_digest) error("focused-manifest-impact-binding", "focused manifest impact digest does not match the enclosing ReviewManifest");
    if (focused.pr_metadata_digest !== expected.pr_metadata_digest) error("focused-manifest-metadata-binding", "focused manifest metadata digest does not match the enclosing ReviewManifest");
    for (const [path, digest] of Object.entries(expected.file_digests)) {
      const raw = files[path];
      if (raw == null) error("focused-manifest-file-missing", `enclosing bundle file is missing: ${path}`, path);
      else if (hashContent(raw) !== digest) error("focused-manifest-file-digest", `enclosing bundle file digest does not match manifest: ${path}`, path);
    }
    const core = { ...expected } as Record<string, unknown>;
    delete core.bundle_digest;
    if (hashContent(jsonStable(core)) !== expected.bundle_digest) error("focused-manifest-bundle-binding", "enclosing ReviewManifest bundle digest is not self-consistent", "manifest.json");
    const bodyRoleAt = (role: FocusedBodyRole, id: string, lifecycle: "head" | "merge-base"): FocusedBodyBinding | undefined => validBodyRoles.find((item) => item.role === role && item.id === id && item.lifecycle === lifecycle);
    type RevisionPageEvidence = { exists: boolean; page?: WikiPage };
    const revisionPageCache = new Map<"head" | "merge-base", WikiPage[]>();
    const pagesAtRevision = (lifecycle: "head" | "merge-base"): WikiPage[] => {
      if (!repositoryRoot) return [];
      const cached = revisionPageCache.get(lifecycle);
      if (cached) return cached;
      const revision = lifecycle === "head" ? focused.head_sha : focused.merge_base_sha;
      if (!/^[0-9a-f]{40}$/.test(revision)) return [];
      const pages: WikiPage[] = [];
      for (const path of filesAtRevision(repositoryRoot, revision).filter(isContentPage)) {
        const actual = sourceAtRevision(repositoryRoot, revision, path);
        if (!actual.exists) continue;
        try { pages.push(parseWikiPage(path, actual.raw)); } catch { /* normal page validation reports malformed pages */ }
      }
      revisionPageCache.set(lifecycle, pages);
      return pages;
    };
    const pagesWithIdAtRevision = (lifecycle: "head" | "merge-base", id: string): WikiPage[] => pagesAtRevision(lifecycle).filter((page) => page.data.id === id);
    const conflictsWithIdAtRevision = (lifecycle: "head" | "merge-base", id: string): WikiPage[] => pagesAtRevision(lifecycle).filter((page) => page.data.kind === "conflict" && page.data.conflict_id === id);
    const revisionPageEvidence = (lifecycle: "head" | "merge-base", path: string): RevisionPageEvidence | undefined => {
      if (!repositoryRoot) return undefined;
      const revision = lifecycle === "head" ? focused.head_sha : focused.merge_base_sha;
      if (!/^[0-9a-f]{40}$/.test(revision)) return { exists: false };
      const actual = sourceAtRevision(repositoryRoot, revision, path);
      if (!actual.exists) return { exists: false };
      try {
        return { exists: true, page: parseWikiPage(path, actual.raw) };
      } catch {
        return { exists: true };
      }
    };
    const validRemovedPageException = (id: string, role: FocusedBodyBinding): boolean => {
      if (!repositoryRoot || role.lifecycle !== "merge-base") return false;
      const base = revisionPageEvidence("merge-base", role.wiki_path);
      if (!base?.exists || base.page?.data.id !== id || base.page.data.status !== "current") return false;
      return !pagesWithIdAtRevision("head", id).some((page) => page.data.status === "current");
    };
    const validDemotedInvariantException = (id: string, baseRole: FocusedBodyBinding, headRole: FocusedBodyBinding): boolean => {
      if (!repositoryRoot) return false;
      const base = revisionPageEvidence("merge-base", baseRole.wiki_path);
      const head = revisionPageEvidence("head", headRole.wiki_path);
      const currentHeadPages = pagesWithIdAtRevision("head", id).filter((page) => page.data.status === "current");
      return base?.page?.data.id === id
        && base.page.data.kind === "invariant"
        && base.page.data.status === "current"
        && head?.page?.data.id === id
        && head.page.data.status === "current"
        && currentHeadPages.some((page) => page.data.kind !== "invariant");
    };
    const validRemovedConflictException = (id: string, role: FocusedBodyBinding): boolean => {
      if (!repositoryRoot || role.lifecycle !== "merge-base") return false;
      const base = revisionPageEvidence("merge-base", role.wiki_path);
      if (!base?.page || base.page.data.conflict_id !== id || base.page.data.kind !== "conflict") return false;
      return conflictsWithIdAtRevision("head", id).length === 0;
    };
    const requireAffectedPageBody = (id: string) => {
      // A changed page must be represented by its HEAD body.  A removed or
      // demoted current page is the one exception: its merge-base body is
      // carried under removed_page, which is the historical authority that
      // remains reviewable after the HEAD page disappears.
      if (bodyRoles.has(`affected_page:${id}:head`)) return;
      const removedRole = bodyRoleAt("removed_page", id, "merge-base");
      if (removedRole && (!repositoryRoot || validRemovedPageException(id, removedRole))) return;
      if (removedRole) error("focused-manifest-removed-page-exception", `removed_page role is not supported by exact HEAD/merge-base evidence: ${id}`, removedRole.wiki_path);
      error("focused-manifest-affected_page-missing", `required affected_page HEAD role is missing: ${id}`);
    };
    const headAffectedPageKind = (id: string): WikiFrontmatter["kind"] | undefined => {
      const role = (Array.isArray(focused.body_roles) ? focused.body_roles : []).find((item) => item.role === "affected_page" && item.id === id && item.lifecycle === "head");
      if (!role) return undefined;
      const object = objects.get(role.digest);
      const raw = object ? files[object.object_path] : undefined;
      if (raw == null) return undefined;
      try { return parseWikiPage(role.wiki_path, raw).data.kind; } catch { return undefined; }
    };
    const requireInvariantBody = (id: string) => {
      // Current invariants require their HEAD body.  A demoted/deleted
      // invariant is valid only when both its removed-page marker and its
      // historical invariant body are present; an invariant merge-base body
      // by itself cannot stand in for a required HEAD body.
      if (bodyRoles.has(`invariant:${id}:head`)) return;
      const baseInvariantRole = bodyRoleAt("invariant", id, "merge-base");
      const removedRole = bodyRoleAt("removed_page", id, "merge-base");
      if (baseInvariantRole && removedRole && baseInvariantRole.wiki_path === removedRole.wiki_path
        && (!repositoryRoot || validRemovedPageException(id, removedRole))) return;
      if (baseInvariantRole && removedRole && repositoryRoot) error("focused-manifest-removed-page-exception", `removed_page role is not supported by exact HEAD/merge-base evidence: ${id}`, removedRole.wiki_path);
      // An in-place demotion keeps the page current, so impact reporting does
      // not emit a removed_page marker.  Its affected page HEAD body proves
      // the non-invariant kind while the merge-base invariant is the only
      // valid historical invariant body.
      const headKind = headAffectedPageKind(id);
      const headPageRole = bodyRoleAt("affected_page", id, "head");
      if (baseInvariantRole && headPageRole && headKind != null && headKind !== "invariant"
        && (!repositoryRoot || validDemotedInvariantException(id, baseInvariantRole, headPageRole))) return;
      if (baseInvariantRole && headPageRole && repositoryRoot && headKind != null && headKind !== "invariant") error("focused-manifest-demoted-invariant-exception", `invariant merge-base role is not supported by exact HEAD/merge-base demotion evidence: ${id}`, baseInvariantRole.wiki_path);
      // Preserve compatibility with metadata-only IDs that the impact report
      // records as unknown and for which this focused bundle has no body or
      // authority declaration to bind.
      const hasRelatedBody = bodyRoles.has(`invariant:${id}:head`)
        || bodyRoles.has(`invariant:${id}:merge-base`)
        || bodyRoles.has(`removed_page:${id}:merge-base`)
        || bodyRoles.has(`affected_page:${id}:head`);
      const hasRelatedDeclaration = (Array.isArray(focused.source_roles) ? focused.source_roles : []).some((source) => source.declared_by.includes(id));
      if (!hasRelatedBody && !hasRelatedDeclaration && !expected.affected_page_ids.includes(id)) return;
      error("focused-manifest-invariant-missing", `required invariant HEAD role is missing: ${id}`);
    };
    const requireConflictBody = (id: string) => {
      // Conflicts may be represented by their current body or, when the
      // conflict file was removed from HEAD, by its merge-base body.
      if (bodyRoles.has(`conflict:${id}:head`)) return;
      const baseRole = bodyRoleAt("conflict", id, "merge-base");
      if (baseRole && (!repositoryRoot || validRemovedConflictException(id, baseRole))) return;
      if (baseRole) error("focused-manifest-conflict-exception", `conflict merge-base role is not supported by exact HEAD/merge-base evidence: ${id}`, baseRole.wiki_path);
      error("focused-manifest-conflict-missing", `required conflict role is missing: ${id}`);
    };
    if (enforceRequired) {
      for (const id of expected.affected_page_ids) requireAffectedPageBody(id);
      for (const id of expected.affected_invariant_ids) requireInvariantBody(id);
      for (const id of expected.affected_conflict_ids) requireConflictBody(id);
    }
    const sourceByPath = new Map((Array.isArray(focused.source_roles) ? focused.source_roles : []).map((source) => [source.path, source]));
    if (enforceRequired) {
      for (const path of focused.changed_files) {
        const source = sourceByPath.get(path);
        if (!source || !source.roles.includes("changed_source")) error("focused-manifest-changed-source-required", `changed file is missing changed_source classification: ${path}`, path);
        if (focusedSourcePath(path) && !source?.roles.includes("relevant_test")) error("focused-manifest-relevant-test-required", `changed test is missing relevant_test classification: ${path}`, path);
      }
    }
    if (expected.focused_manifest_digest && Object.keys(files).length > 0 && files["focused-manifest.json"] != null && hashContent(files["focused-manifest.json"]) !== expected.focused_manifest_digest) error("focused-manifest-digest-binding", "focused manifest digest does not match the enclosing ReviewManifest");
    let canonicalChangedFiles: string[] | undefined;
    const impactRaw = files["impact.json"];
    if (impactRaw != null) {
      try {
        const impact = JSON.parse(impactRaw) as { changedFiles?: unknown };
        if (!Array.isArray(impact.changedFiles) || impact.changedFiles.some((path) => typeof path !== "string" || path.length === 0)) {
          error("focused-manifest-impact-changed-files", "bound impact.json changedFiles must be a string array", "impact.json");
        } else {
          canonicalChangedFiles = [...impact.changedFiles].sort((a, b) => a.localeCompare(b));
          if (new Set(canonicalChangedFiles).size !== canonicalChangedFiles.length) error("focused-manifest-impact-changed-files", "bound impact.json changedFiles must not contain duplicates", "impact.json");
          if (!Array.isArray(focused.changed_files) || jsonStable(focused.changed_files) !== jsonStable(canonicalChangedFiles)) error("focused-manifest-changed-files-binding", "focused changed_files must exactly match the digest-bound impact.json changedFiles", "focused-manifest.json:changed_files");
        }
      } catch {
        error("focused-manifest-impact-changed-files", "bound impact.json must be valid JSON with canonical changedFiles", "impact.json");
      }
    }
    const authorityPageIds = new Set([...expected.affected_page_ids, ...expected.affected_invariant_ids]);
    type AuthorityDeclaration = { page_id: string; declaration: WikiSource; matched_via: "path" | "glob" };
    const authorityExact = new Map<string, AuthorityDeclaration[]>();
    const authorityGlobs: AuthorityDeclaration[] = [];
    const authorityBodyKeys = new Set<string>();
    for (const bodyRole of Array.isArray(focused.body_roles) ? focused.body_roles : []) {
      const isAuthorityBody = (bodyRole.role === "affected_page" && expected.affected_page_ids.includes(bodyRole.id))
        || (bodyRole.role === "invariant" && expected.affected_invariant_ids.includes(bodyRole.id));
      if (!isAuthorityBody) continue;
      const bodyObject = objects.get(bodyRole.digest);
      const raw = bodyObject ? files[bodyObject.object_path] : undefined;
      if (raw == null) continue;
      const bodyKey = `${bodyRole.role}:${bodyRole.id}:${bodyRole.digest}`;
      if (authorityBodyKeys.has(bodyKey)) continue;
      authorityBodyKeys.add(bodyKey);
      let authorityPage: WikiPage;
      try {
        authorityPage = parseWikiPage(bodyRole.wiki_path, raw);
      } catch {
        error("focused-manifest-authority-body", `authority body cannot be parsed for ${bodyRole.id}`, bodyRole.wiki_path);
        continue;
      }
      if (authorityPage.data.id !== bodyRole.id) error("focused-manifest-authority-body", `authority body ID does not match its bound role: ${bodyRole.id}`, bodyRole.wiki_path);
      for (const rawDeclaration of authorityPage.data.sources) {
        const declaration: AuthorityDeclaration = {
          page_id: authorityPage.data.id,
          declaration: canonicalSourceDeclaration(rawDeclaration),
          matched_via: "path" in rawDeclaration ? "path" : "glob",
        };
        if ("path" in rawDeclaration) {
          const path = rawDeclaration.path;
          const records = authorityExact.get(path) ?? [];
          if (!records.some((record) => record.page_id === declaration.page_id && jsonStable(record.declaration) === jsonStable(declaration.declaration))) records.push(declaration);
          authorityExact.set(path, records);
        } else {
          if (!authorityGlobs.some((record) => record.page_id === declaration.page_id && jsonStable(record.declaration) === jsonStable(declaration.declaration))) {
            authorityGlobs.push(declaration);
          }
        }
      }
    }
    const declarationMatches = (source: FocusedSourceBinding, requirement: AuthorityDeclaration): boolean => source.declaration_ids.some((id) => {
      const declaration = declarationsById.get(id);
      if (!declaration || declaration.page_id !== requirement.page_id || declaration.matched_via !== requirement.matched_via) return false;
      if (jsonStable(declaration.declaration) !== jsonStable(requirement.declaration)) return false;
      return requirement.matched_via !== "glob" || ("glob" in requirement.declaration && declaration.expanded_glob === requirement.declaration.glob);
    });
    for (const [path, requirements] of authorityExact.entries()) {
      const matches = (Array.isArray(focused.source_roles) ? focused.source_roles : []).filter((source) => source.path === path);
      if (matches.length !== 1) {
        error("focused-manifest-authority-source-required", `exact affected authority source is missing its sole source binding: ${path}`, path);
        continue;
      }
      const source = matches[0];
      if (!source.roles.includes("affected_authority_source")) error("focused-manifest-authority-role-required", `exact affected authority source is missing affected_authority_source: ${path}`, path);
      for (const requirement of requirements) {
        if (!source.declared_by.includes(requirement.page_id)) error("focused-manifest-authority-provenance", `exact authority source is missing declaring page provenance: ${path}`, path);
        if (!declarationMatches(source, requirement)) error("focused-manifest-authority-declaration-required", `exact authority source is missing its canonical declaration ID: ${path}`, path);
      }
    }
    if (canonicalChangedFiles) {
      for (const requirement of authorityGlobs) {
        if (!("glob" in requirement.declaration)) continue;
        const pattern = requirement.declaration.glob;
        let glob: Bun.Glob;
        try {
          glob = new Bun.Glob(pattern);
        } catch {
          error("focused-manifest-authority-glob", `authority source glob is invalid: ${pattern}`);
          continue;
        }
        for (const path of canonicalChangedFiles.filter((candidate) => glob.match(candidate))) {
          const matches = (Array.isArray(focused.source_roles) ? focused.source_roles : []).filter((source) => source.path === path);
          if (matches.length !== 1) {
            error("focused-manifest-authority-source-required", `changed authority glob match is missing its sole source binding: ${path}`, path);
            continue;
          }
          const source = matches[0];
          if (!source.roles.includes("affected_authority_source")) error("focused-manifest-authority-role-required", `changed authority glob match is missing affected_authority_source: ${path}`, path);
          if (!source.declared_by.includes(requirement.page_id)) error("focused-manifest-authority-provenance", `changed authority glob match is missing declaring page provenance: ${path}`, path);
          if (!declarationMatches(source, requirement)) error("focused-manifest-authority-declaration-required", `changed authority glob match is missing its canonical declaration ID: ${path}`, path);
        }
      }
    }
    for (const source of Array.isArray(focused.source_roles) ? focused.source_roles : []) {
      const hasAuthorityDeclaration = source.declaration_ids.some((id) => authorityPageIds.has(declarationsById.get(id)?.page_id ?? ""));
      if (hasAuthorityDeclaration && !source.roles.includes("affected_authority_source")) error("focused-manifest-authority-role-required", `source declaration from an affected authority page is missing affected_authority_source: ${source.path}`, source.path);
      if (!hasAuthorityDeclaration && source.roles.includes("affected_authority_source")) error("focused-manifest-authority-role-misclassified", `affected_authority_source is not backed by an affected authority declaration: ${source.path}`, source.path);
    }
    if (canonicalChangedFiles) {
      for (const path of canonicalChangedFiles) {
        const matches = (Array.isArray(focused.source_roles) ? focused.source_roles : []).filter((source) => source.path === path);
        if (matches.length !== 1) error("focused-manifest-changed-source-binding", `each canonical changed path must have exactly one source binding: ${path}`, path);
        else if (!matches[0].roles.includes("changed_source")) error("focused-manifest-changed-source-binding", `canonical changed path is missing changed_source classification: ${path}`, path);
        if (enforceRequired && focusedSourcePath(path) && matches.length === 1 && !matches[0].roles.includes("relevant_test")) error("focused-manifest-relevant-test-required", `changed test is missing relevant_test classification: ${path}`, path);
      }
    }
    if (enforceRequired && typeof files["diff.patch"] === "string") {
      // A source declaration removed from an affected authority page means
      // the review needs the old page body as well.  This check is derived
      // from the digest-bound patch, rather than from the submitted focused
      // roles/declarations, so deleting all of those submitted records and
      // rebinding their enclosing digests cannot hide the required
      // merge-base body.
      const pagesWithRemovedSourceDeclarations = new Set<string>();
      let diffPath: string | undefined;
      for (const line of files["diff.patch"].split("\n")) {
        const header = line.match(/^diff --git a\/(.+) b\/(.+)$/);
        if (header) {
          diffPath = header[2];
          continue;
        }
        if (diffPath && /^-\s+-\s+(?:path|glob):\s*/.test(line)) pagesWithRemovedSourceDeclarations.add(diffPath);
      }
      for (const bodyRole of Array.isArray(focused.body_roles) ? focused.body_roles : []) {
        if (bodyRole.lifecycle !== "head") continue;
        const isAffectedAuthorityBody = (bodyRole.role === "affected_page" && expected.affected_page_ids.includes(bodyRole.id))
          || (bodyRole.role === "invariant" && expected.affected_invariant_ids.includes(bodyRole.id));
        if (!isAffectedAuthorityBody || !pagesWithRemovedSourceDeclarations.has(bodyRole.wiki_path)) continue;
        if (!bodyRoles.has(`${bodyRole.role}:${bodyRole.id}:merge-base`)) {
          error(`focused-manifest-${bodyRole.role}-merge-base-missing`, `source declarations changed in affected authority page without its merge-base body: ${bodyRole.id}`, bodyRole.wiki_path);
        }
      }
    }
  }
  return findings;
}

/** Alias used by callers that validate the complete bundle envelope. */
export const validateReviewBundleBindings = validateFocusedReviewManifest;

export function buildReviewManifest(view: RepoView, pages: WikiPage[], report: ImpactReport, metadata?: PrMetadata): ReviewManifest {
  const focused = focusedReviewData(view, pages, report, metadata);
  const files = reviewBundleFiles(view, pages, report, metadata);
  const fileDigests = Object.fromEntries(Object.entries(files).map(([path, content]) => [path, hashContent(content)]).sort(([a], [b]) => a.localeCompare(b)));
  const baseInvariantIds = new Set(git(view.root, ["ls-tree", "-r", "--name-only", report.mergeBase, "--", "wiki"], true)
    .split("\n")
    .filter(isContentPage)
    .flatMap((path) => {
      const raw = git(view.root, ["show", `${report.mergeBase}:${path}`], true);
      if (!raw) return [];
      try {
        const page = parseWikiPage(path, raw);
        return page.data.status === "current" && page.data.kind === "invariant" ? [page.data.id] : [];
      } catch {
        return [];
      }
    }));
  const affectedInvariantIds = new Set(metadata?.affected_invariants ?? []);
  for (const id of report.affectedPages) {
    if (baseInvariantIds.has(id) || pages.find((page) => page.data.id === id)?.data.kind === "invariant") affectedInvariantIds.add(id);
  }
  for (const conflict of report.affectedConflicts) for (const id of conflict.affectedInvariants) affectedInvariantIds.add(id);
  const core = {
    version: 1 as const,
    base_ref: report.base.trim().replaceAll("\\", "/"),
    merge_base_sha: report.mergeBase,
    head_sha: git(view.root, ["rev-parse", "--verify", "HEAD^{commit}"]).trim(),
    pr_metadata_digest: hashContent(jsonStable(canonicalPrMetadata(metadata))),
    impact_report_digest: hashContent(files["impact.json"]),
    diff_digest: hashContent(files["diff.patch"]),
    affected_page_ids: [...report.affectedPages].sort((a, b) => a.localeCompare(b)),
    affected_invariant_ids: [...affectedInvariantIds].sort((a, b) => a.localeCompare(b)),
    affected_conflict_ids: report.affectedConflicts.map((conflict) => conflict.id).sort((a, b) => a.localeCompare(b)),
    file_digests: fileDigests,
    focused_manifest_digest: hashContent(files["focused-manifest.json"]),
  };
  const manifest = { ...core, bundle_digest: hashContent(jsonStable(core)) };
  const bindingFindings = validateFocusedReviewManifest(focused.manifest, files, manifest, true, view.root);
  if (bindingFindings.some((finding) => finding.severity === "error")) throw new Error(bindingFindings.map((finding) => finding.message).join("; "));
  return manifest;
}

export function makeReviewBundle(view: RepoView, pages: WikiPage[], report: ImpactReport, output?: string, metadata?: PrMetadata): string {
  const directory = output ? resolve(view.root, output) : mkdtempSync(join(tmpdir(), "wiki-review-"));
  const files: Record<string, string> = { ...reviewBundleFiles(view, pages, report, metadata), "manifest.json": jsonStable(buildReviewManifest(view, pages, report, metadata)) };
  for (const [path, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    Bun.spawnSync(["mkdir", "-p", dirname(join(directory, path))]);
    writeFileSync(join(directory, path), content);
  }
  // Keep the old removed-page/conflict paths as compatibility links only. The
  // body bytes live exactly once under objects/<sha256>.md and the focused
  // manifest remains the authoritative role-to-object index.
  const focused = JSON.parse(files["focused-manifest.json"]) as FocusedReviewManifest;
  for (const role of focused.body_roles.filter((item) => item.role === "removed_page" || item.role === "conflict")) {
    const alias = role.role === "removed_page"
      ? `pages/removed_${role.id.replaceAll("/", "_")}.md`
      : `conflicts/${role.id}.md`;
    const aliasPath = join(directory, alias);
    Bun.spawnSync(["mkdir", "-p", dirname(aliasPath)]);
    rmSync(aliasPath, { force: true });
    symlinkSync(relative(dirname(aliasPath), join(directory, `objects/${role.digest}.md`)), aliasPath);
  }
  return directory;
}



export function recursiveFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) result.push(...recursiveFiles(full));
    else result.push(full);
  }
  return result;
}
