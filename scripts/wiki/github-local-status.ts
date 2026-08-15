import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRepoView, git } from "./repository-view";
import { readConfig } from "./verification";
import { parseLocalCheckResult, validateLocalCheckResult, type LocalCheckResult } from "./local-check";
import { UsageError } from "./verification";

export const LOCAL_STATUS_CONTEXT = "wiki-ssot/local";
export const LOCAL_STATUS_MARKER = "<!-- wiki-ssot:local-status -->";

export type GhResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type GhRunner = (args: string[]) => GhResult;

export type PublishLocalStatusOptions = {
  root: string;
  resultPath: string;
  repo?: string;
  pr?: number;
  gh?: GhRunner;
};

export type PublishLocalStatusResult = {
  repo: string;
  pr: number;
  head_sha: string;
  state: "success" | "failure";
  status_context: string;
  comment: "created" | "updated";
  deleted_duplicate_comments: number;
};

type Comment = { id?: unknown; body?: unknown };

export function defaultGhRunner(root: string): GhRunner {
  return (args) => {
    const child = Bun.spawnSync(["gh", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    return {
      exitCode: child.exitCode,
      stdout: child.stdout.toString(),
      stderr: child.stderr.toString(),
    };
  };
}

function runGh(gh: GhRunner, args: string[]): string {
  const result = gh(args);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `gh ${args.join(" ")} failed`;
    throw new UsageError(`GitHub API request failed: ${detail}`);
  }
  return result.stdout;
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new UsageError(`${label} returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function flattenComments(value: unknown): Comment[] {
  if (!Array.isArray(value)) return [];
  return value.flat(Infinity).filter((item): item is Comment => item != null && typeof item === "object" && !Array.isArray(item));
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function currentHead(root: string): string {
  const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  if (!/^[0-9a-f]{40}$/.test(head)) throw new UsageError("current HEAD is not a committed 40-character SHA");
  return head;
}

function candidateDirtyPaths(root: string, resultPath: string): string[] {
  const changed = Bun.spawnSync(["git", "diff", "--name-only", "-z", "HEAD"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const untracked = Bun.spawnSync(["git", "ls-files", "--others", "--exclude-standard", "-z"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (changed.exitCode !== 0 || untracked.exitCode !== 0) throw new UsageError("unable to inspect candidate worktree status");
  const allowed = resolve(resultPath);
  return [...new Set([
    ...changed.stdout.toString().split("\0").filter(Boolean),
    ...untracked.stdout.toString().split("\0").filter(Boolean),
  ])].filter((path) => resolve(root, path) !== allowed).sort((a, b) => a.localeCompare(b));
}

function resultFromFile(root: string, resultPath: string): LocalCheckResult {
  const target = resolve(root, resultPath);
  if (!existsSync(target)) throw new UsageError(`local check result does not exist: ${resultPath}`);
  const raw = readFileSync(target, "utf8");
  // Keep this explicit in the publishing boundary: malformed/tampered result
  // files are rejected before any repository or GitHub write is attempted.
  const parsed = (() => {
    try { return JSON.parse(raw) as unknown; }
    catch (error) { throw new UsageError(`local check result is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  })();
  const shape = validateLocalCheckResult(parsed);
  if (shape.length > 0) throw new UsageError(shape.map((item) => item.message).join("; "));
  return parseLocalCheckResult(raw);
}

function resolveRepo(gh: GhRunner, requested: string | undefined): string {
  const repo = requested?.trim() || oneLine(runGh(gh, ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]));
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new UsageError(`unable to resolve a GitHub repository: ${repo || "(empty)"}`);
  return repo;
}

function resolvePr(gh: GhRunner, repo: string, requested: number | undefined): number {
  if (requested != null) {
    if (!Number.isInteger(requested) || requested <= 0) throw new UsageError("--pr must be a positive pull request number");
    return requested;
  }
  const value = oneLine(runGh(gh, ["pr", "view", "--repo", repo, "--json", "number", "--jq", ".number"]));
  const pr = Number(value);
  if (!Number.isInteger(pr) || pr <= 0) throw new UsageError(`unable to resolve a pull request number: ${value || "(empty)"}`);
  return pr;
}

function remoteHeadSha(gh: GhRunner, repo: string, pr: number): string {
  const sha = oneLine(runGh(gh, ["api", `repos/${repo}/pulls/${pr}`, "--jq", ".head.sha"]));
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new UsageError(`GitHub returned an invalid pull request head SHA: ${sha || "(empty)"}`);
  return sha;
}

function summaryLine(result: LocalCheckResult): string {
  const checks = [
    ["structural", result.checks.structural.ok],
    ["state", result.checks.state.ok],
    ["impact", !result.checks.impact.findings.some((item) => item.severity === "error")],
    ["review", result.checks.review.ok],
    ["tooling", result.checks.tooling.ok],
    ["scope", result.checks.scope.ok],
  ] as const;
  return checks.map(([name, ok]) => `${name}=${ok ? "pass" : "fail"}`).join(", ");
}

function markerBody(result: LocalCheckResult): string {
  const impact = result.checks.impact;
  const scope = result.checks.scope;
  const review = result.checks.review;
  const pages = impact.affected_pages.length > 0 ? impact.affected_pages.join(", ") : "none";
  const conflicts = impact.affected_conflicts.length > 0 ? impact.affected_conflicts.join(", ") : "none";
  const reasons = review.requirement_reasons.length > 0 ? review.requirement_reasons.join("; ") : "none";
  return [
    LOCAL_STATUS_MARKER,
    "## Wiki SSOT local check",
    "",
    `- SHA: \`${result.head_sha}\``,
    `- Checks: ${summaryLine(result)}`,
    `- Warnings: ${result.warnings.length}`,
    `- Impact: ${impact.changed_files.length} changed file(s); pages=${pages}; conflicts=${conflicts}`,
    `- Scope: base=${scope.base}; mandatoryΔ=${scope.base_delta.mandatory_count_delta}; catalogΔ=${scope.base_delta.catalog_count_delta} files/${scope.base_delta.catalog_bytes_delta} bytes; potential=${scope.potential_review.selected_file_count}/${scope.potential_review.tracked_file_count} (${scope.potential_review.selected_ratio})`,
    `- Review: ${review.status}; reasons=${reasons}`,
    `- Result digest: \`${result.result_digest}\``,
    "",
    "Rerun:",
    `\`\`\`sh\n bun run wiki:check -- --base ${result.base_ref} --metadata <pr-body> --output <result.json>\n\`\`\``,
  ].join("\n");
}

function commentsFor(gh: GhRunner, repo: string, pr: number): Comment[] {
  const raw = runGh(gh, ["api", "--paginate", "--slurp", `repos/${repo}/issues/${pr}/comments?per_page=100`]);
  const parsed = parseJson(raw, "GitHub comments API");
  if (!Array.isArray(parsed)) throw new UsageError("GitHub comments API returned a non-array payload");
  return flattenComments(parsed);
}

function postStatus(gh: GhRunner, repo: string, result: LocalCheckResult, statusContext: string): void {
  const state = result.ok ? "success" : "failure";
  const description = oneLine(`local checks ${result.ok ? "passed" : "failed"}; ${summaryLine(result)}; warnings=${result.warnings.length}`);
  runGh(gh, [
    "api", "--method", "POST", `repos/${repo}/statuses/${result.head_sha}`,
    "-f", `state=${state}`,
    "-f", `context=${statusContext}`,
    "-f", `description=${description.slice(0, 140)}`,
  ]);
}

function upsertMarkerComment(gh: GhRunner, repo: string, pr: number, body: string): { action: "created" | "updated"; deleted: number } {
  const matches = commentsFor(gh, repo, pr).filter((comment) => typeof comment.body === "string" && comment.body.includes(LOCAL_STATUS_MARKER));
  const first = matches[0];
  let action: "created" | "updated";
  if (first == null) {
    runGh(gh, ["api", "--method", "POST", `repos/${repo}/issues/${pr}/comments`, "-f", `body=${body}`]);
    action = "created";
  } else {
    const id = String(first.id ?? "");
    if (!/^\d+$/.test(id)) throw new UsageError("existing local status marker comment has no valid numeric id");
    runGh(gh, ["api", "--method", "PATCH", `repos/${repo}/issues/comments/${id}`, "-f", `body=${body}`]);
    action = "updated";
  }
  let deleted = 0;
  for (const duplicate of matches.slice(1)) {
    const id = String(duplicate.id ?? "");
    if (!/^\d+$/.test(id)) throw new UsageError("duplicate local status marker comment has no valid numeric id");
    runGh(gh, ["api", "--method", "DELETE", `repos/${repo}/issues/comments/${id}`]);
    deleted += 1;
  }
  return { action, deleted };
}

/**
 * Publish one already-validated local result. All read-only checks happen
 * before the first write, so stale or wrong-PR results cannot create a status
 * or comment. GitHub failures propagate as non-zero CLI errors.
 */
export function publishLocalStatus(options: PublishLocalStatusOptions): PublishLocalStatusResult {
  const root = resolve(options.root);
  const resultPath = resolve(root, options.resultPath);
  const result = resultFromFile(root, resultPath);
  const head = currentHead(root);
  if (head !== result.head_sha) throw new UsageError(`local check result HEAD ${result.head_sha} does not match current HEAD ${head}`);
  const dirty = candidateDirtyPaths(root, resultPath);
  if (dirty.length > 0) throw new UsageError(`publishing requires a clean worktree; changed files: ${dirty.join(", ")}`);

  const gh = options.gh ?? defaultGhRunner(root);
  const repo = resolveRepo(gh, options.repo);
  const pr = resolvePr(gh, repo, options.pr);
  const remote = remoteHeadSha(gh, repo, pr);
  if (remote !== result.head_sha) throw new UsageError(`pull request head ${remote} does not match local result HEAD ${result.head_sha}`);

  let statusContext = LOCAL_STATUS_CONTEXT;
  try {
    const config = readConfig(createRepoView(root));
    if (config.version === 2) statusContext = config.enforcement.statusContext;
  } catch {
    // The result boundary has already validated the exact result. A malformed
    // local config is reported by the local gate/doctor; preserve the v1
    // default here rather than guessing a custom context.
  }

  // Do not start writes until all candidate/PR identity checks above pass.
  // Upsert the marker first; the required status is deliberately last so an
  // API/comment failure cannot leave this invocation reporting success.
  const comment = upsertMarkerComment(gh, repo, pr, markerBody(result));
  postStatus(gh, repo, result, statusContext);
  return {
    repo,
    pr,
    head_sha: result.head_sha,
    state: result.ok ? "success" : "failure",
    status_context: statusContext,
    comment: comment.action,
    deleted_duplicate_comments: comment.deleted,
  };
}
