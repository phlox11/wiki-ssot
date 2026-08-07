import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  jsonStable,
  type WorkItem,
} from "../core";

export const temporary: string[] = [];

export function cleanupTemporary(): void {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
}

function run(root: string, command: string[]) {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || result.stdout.toString());
  return result.stdout.toString();
}

function runResult(root: string, command: string[]) {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function metadataBody(changeType = "feature"): string {
  return [
    "```yaml",
    `change_type: ${changeType}`,
    "semantic_change: true",
    "wiki_action: update",
    "affected_pages: [product/test]",
    "affected_invariants: [product/invariant]",
    "touched_conflicts: []",
    "fresh_context:",
    "  verdict: PENDING",
    "  reviewed_head_sha: pending",
    "  bundle_digest: pending",
    "  reviewer: pending",
    "  evidence: []",
    "```",
    "",
  ].join("\n");
}

function put(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "wiki-work-test-"));
  temporary.push(root);
  run(root, ["git", "init", "-q"]);
  run(root, ["git", "config", "user.name", "Wiki Work Test"]);
  run(root, ["git", "config", "user.email", "wiki-work@example.invalid"]);
  return root;
}

function currentPage(id: string, kind = "product", sources = "  - path: source.ts"): string {
  return `---
id: ${id}
summary: Current ${id}.
kind: ${kind}
status: current
authority: normative
owners: ["@owner"]
sources:
${sources}
---

# ${id}

Current contract body.
`;
}

function proposalPage(items: WorkItem[], id = "proposal/work"): string {
  return `---
id: ${id}
summary: Work proposal.
kind: proposal
status: proposed
authority: normative
owners: ["@owner"]
sources: [{path: source.ts}]
work_items: ${JSON.stringify(items)}
---

# Work proposal

Detailed rationale stays with the owning proposal.
`;
}

function conflictPage(): string {
  return `---
id: conflict/C-900
conflict_id: C-900
summary: Owner decision is required.
kind: conflict
status: conflicted
authority: observed
owners: ["@owner"]
conflict_type: decision
severity: high
origin: baseline
opened_at: 2026-07-29
sources: [{path: source.ts}]
affected_pages: [product/test]
affected_invariants: [product/invariant]
resolution:
  state: decision_pending
  decision: null
  acceptance: ["Record the owner decision."]
---

# Decision
`;
}

function resolvedConflictPage(): string {
  return conflictPage()
    .replace("id: conflict/C-900", "id: conflict/C-901")
    .replace("conflict_id: C-900", "conflict_id: C-901")
    .replace("summary: Owner decision is required.", "summary: Resolved owner decision.")
    .replace("status: conflicted", "status: archived")
    .replace("state: decision_pending", "state: verified")
    .replace("decision: null", "decision: Owner selected the documented implementation.")
    .replace('acceptance: ["Record the owner decision."]', 'acceptance: ["Record the owner decision."]\n  evidence: ["source.ts"]');
}

function work(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "WK-01",
    title: "First task",
    state: "not-started",
    priority: "high",
    depends_on: [],
    context_pages: ["product/test"],
    acceptance: ["The task has deterministic evidence."],
    evidence: [],
    ...overrides,
  };
}


export function cliRepo(items: WorkItem[], includeConflict = true): string {
  const root = tempRepo();
  put(root, "source.ts", "export const value = true;\n");
  put(root, "src/a.ts", "export const a = true;\n");
  put(root, "src/z.ts", "export const z = true;\n");
  put(root, "wiki/product/test.md", currentPage("product/test", "product", "  - path: source.ts\n  - glob: src/*.ts"));
  put(root, "wiki/product/invariant.md", currentPage("product/invariant", "invariant"));
  put(root, "wiki/proposals/work.md", proposalPage(items));
  if (includeConflict) put(root, "wiki/conflicts/open/C-900.md", conflictPage());
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "fixture"]);
  return root;
}

export function topicCliRepo(): string {
  const root = tempRepo();
  put(root, "source.ts", "export const value = true;\n");
  put(root, "src/a.ts", "export const a = true;\n");
  put(root, "src/z.ts", "export const z = true;\n");
  put(root, "wiki/product/test.md", currentPage("product/test", "product", "  - path: source.ts\n  - glob: src/*.ts")
    .replace("summary: Current product/test.", "summary: Shared topic current contract.")
    .replace("Current contract body.", "Shared topic current behavior."));
  put(root, "wiki/product/invariant.md", currentPage("product/invariant", "invariant"));
  put(root, "wiki/conflicts/open/C-900.md", conflictPage()
    .replace("summary: Owner decision is required.", "summary: Shared topic owner decision is required."));
  put(root, "wiki/proposals/topic.md", proposalPage([], "proposal/topic")
    .replace("summary: Work proposal.", "summary: Shared topic proposed rationale."));
  put(root, "wiki/product/deprecated-topic.md", currentPage("product/deprecated-topic")
    .replace("summary: Current product/deprecated-topic.", "summary: Shared topic deprecated rationale.")
    .replace("status: current", "status: deprecated"));
  put(root, "wiki/product/archived-topic.md", currentPage("product/archived-topic")
    .replace("summary: Current product/archived-topic.", "summary: Shared topic archived rationale.")
    .replace("status: current", "status: archived"));
  run(root, ["git", "add", "."]);
  run(root, ["git", "commit", "-qm", "topic fixture"]);
  return root;
}

export type { WorkItem };
export { jsonStable, run, runResult, metadataBody, put, tempRepo, currentPage, proposalPage, conflictPage, resolvedConflictPage, work };
