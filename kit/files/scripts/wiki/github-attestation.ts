#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { Finding, RepoView } from "./core";

export const GITHUB_ATTESTATION_MARKER = "<!-- wiki-ssot:fresh-context-attestation -->";

type GitHubActor = { login?: unknown };
type GitHubComment = {
  id?: unknown;
  body?: unknown;
  user?: GitHubActor | null;
  created_at?: unknown;
  updated_at?: unknown;
};
type GitHubReview = GitHubComment & {
  submitted_at?: unknown;
  state?: unknown;
};
export type GitHubAttestationEnvelope = {
  actor: string;
  source: "issue_comment" | "pull_request_review";
  sourceId: string;
  observedAt: string;
  report: unknown;
};

function flattenApiPages(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flat(Infinity).filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item));
}

function reportFromBody(body: unknown): { report: unknown } | undefined {
  if (typeof body !== "string" || !body.includes(GITHUB_ATTESTATION_MARKER)) return undefined;
  const afterMarker = body.slice(body.indexOf(GITHUB_ATTESTATION_MARKER) + GITHUB_ATTESTATION_MARKER.length);
  const fenced = afterMarker.match(/```(?:json|ya?ml)\s*\n([\s\S]*?)```/i);
  if (!fenced) return { report: "marked attestation is missing a fenced JSON or YAML report" };
  try {
    const report = parseYaml(fenced[1]) as unknown;
    return { report: report ?? "marked attestation report is empty" };
  } catch {
    return { report: "marked attestation contains malformed JSON or YAML" };
  }
}

export function selectGitHubAttestation(commentsInput: unknown, reviewsInput: unknown): GitHubAttestationEnvelope | undefined {
  const candidates: GitHubAttestationEnvelope[] = [];
  for (const raw of flattenApiPages(commentsInput) as GitHubComment[]) {
    const parsed = reportFromBody(raw.body);
    const actor = typeof raw.user?.login === "string" ? raw.user.login : "";
    if (!parsed) continue;
    candidates.push({
      actor,
      source: "issue_comment",
      sourceId: String(raw.id ?? ""),
      observedAt: String(raw.updated_at ?? raw.created_at ?? ""),
      report: parsed.report,
    });
  }
  for (const raw of flattenApiPages(reviewsInput) as GitHubReview[]) {
    if (String(raw.state ?? "").toUpperCase() === "DISMISSED") continue;
    const parsed = reportFromBody(raw.body);
    const actor = typeof raw.user?.login === "string" ? raw.user.login : "";
    if (!parsed) continue;
    candidates.push({
      actor,
      source: "pull_request_review",
      sourceId: String(raw.id ?? ""),
      observedAt: String(raw.updated_at ?? raw.submitted_at ?? raw.created_at ?? ""),
      report: parsed.report,
    });
  }
  return candidates.sort((a, b) => a.observedAt.localeCompare(b.observedAt)
    || a.sourceId.localeCompare(b.sourceId, "en", { numeric: true })
    || a.source.localeCompare(b.source)).at(-1);
}

export function validateGitHubIntegrationSeams(view: RepoView): Finding[] {
  const findings: Finding[] = [];
  const templatePath = ".github/pull_request_template.md";
  const template = view.exists(templatePath) ? view.read(templatePath) : "";
  if (!["fresh_context:", "verdict:", "reviewed_head_sha:", "bundle_digest:", "reviewer:", "evidence:"].every((token) => template.includes(token))) {
    findings.push({ code: "fresh-context-template-missing", message: "PR template must include the structured fresh_context metadata contract", path: templatePath, severity: "error" });
  }

  const workflowPath = ".github/workflows/wiki-ssot.yml";
  const workflow = view.exists(workflowPath) ? view.read(workflowPath) : "";
  let workflowValid = false;
  try {
    const parsed = parseYaml(workflow) as unknown;
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const root = parsed as Record<string, unknown>;
      const triggers = root.on;
      const pullRequest = triggers != null && typeof triggers === "object" && !Array.isArray(triggers)
        ? (triggers as Record<string, unknown>).pull_request
        : undefined;
      const activityTypes = pullRequest != null && typeof pullRequest === "object" && !Array.isArray(pullRequest)
        ? (pullRequest as Record<string, unknown>).types
        : undefined;
      const requiredActivities = ["opened", "synchronize", "reopened", "edited", "ready_for_review", "converted_to_draft"];
      const jobs = root.jobs;
      const reviewAttestationJob = jobs != null && typeof jobs === "object" && !Array.isArray(jobs)
        ? (jobs as Record<string, unknown>)["wiki-review-attestation"]
        : undefined;
      const job = reviewAttestationJob != null && typeof reviewAttestationJob === "object" && !Array.isArray(reviewAttestationJob)
        ? reviewAttestationJob as Record<string, unknown>
        : undefined;
      const steps = Array.isArray(job?.steps)
        ? job.steps.filter((step): step is Record<string, unknown> => step != null && typeof step === "object" && !Array.isArray(step))
        : [];
      const stepNamed = (name: string) => steps.find((step) => step.name === name);
      const checkout = steps.find((step) => step.uses === "actions/checkout@v4");
      const checkoutWith = checkout?.with != null && typeof checkout.with === "object" && !Array.isArray(checkout.with)
        ? checkout.with as Record<string, unknown>
        : undefined;
      const materialize = stepNamed("Materialize PR head as data without executing it");
      const readAttestations = stepNamed("Read authenticated GitHub attestations");
      const validate = stepNamed("Deterministically validate Fresh-context attestation");
      const executableLines = (step: Record<string, unknown> | undefined) => typeof step?.run === "string"
        ? step.run.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#"))
        : [];
      const materializeLines = executableLines(materialize);
      const attestationLines = executableLines(readAttestations);
      const validationLines = executableLines(validate);
      const includesLine = (lines: string[], value: string) => lines.includes(value);
      workflowValid = Array.isArray(activityTypes)
        && requiredActivities.every((event) => activityTypes.includes(event))
        && job?.name === "wiki-review-attestation"
        && job?.if === "github.event_name == 'pull_request' && github.event.pull_request.draft == false"
        && checkoutWith?.ref === "${{ github.event.pull_request.base.sha }}"
        && checkoutWith?.path === "trusted"
        && includesLine(materializeLines, 'git -C trusted worktree add --detach "${RUNNER_TEMP}/wiki-pr-head" "${HEAD_SHA}"')
        && includesLine(materializeLines, 'echo "REVIEW_ROOT=${RUNNER_TEMP}/wiki-pr-head" >> "$GITHUB_ENV"')
        && includesLine(attestationLines, 'gh api --paginate --slurp "repos/${REPOSITORY}/issues/${PR_NUMBER}/comments?per_page=100" > "${RUNNER_TEMP}/issue-comments.json"')
        && includesLine(attestationLines, 'gh api --paginate --slurp "repos/${REPOSITORY}/pulls/${PR_NUMBER}/reviews?per_page=100" > "${RUNNER_TEMP}/pull-request-reviews.json"')
        && includesLine(attestationLines, 'bun "${TRUSTED_ROOT}/scripts/wiki/github-attestation.ts" \\')
        && includesLine(attestationLines, '--comments "${RUNNER_TEMP}/issue-comments.json" \\')
        && includesLine(attestationLines, '--reviews "${RUNNER_TEMP}/pull-request-reviews.json" \\')
        && includesLine(attestationLines, '--actor-output "${RUNNER_TEMP}/fresh-context-actor.txt" \\')
        && validate?.["working-directory"] === "trusted"
        && includesLine(validationLines, "bun scripts/wiki/cli.ts review-check \\")
        && includesLine(validationLines, '--root "${REVIEW_ROOT}" \\')
        && includesLine(validationLines, '--policy-file "${TRUSTED_ROOT}/.wiki/config.json" \\')
        && includesLine(validationLines, '--reviewer-actor "${WIKI_REVIEWER_ACTOR}" \\')
        && includesLine(validationLines, '--pr-author "${PR_AUTHOR}" \\')
        && !validationLines.some((line) => /^cd\s/.test(line));
    }
  } catch {
    workflowValid = false;
  }
  if (!workflowValid) {
    findings.push({ code: "fresh-context-workflow-missing", message: "wiki-ssot workflow must expose the stable wiki-review-attestation job and required PR activity triggers", path: workflowPath, severity: "error" });
  }
  return findings;
}

type Args = { comments?: string; reviews?: string; output?: string; actorOutput?: string; envelopeOutput?: string };

function args(input: string[]): Args {
  const parsed: Args = {};
  for (let index = 0; index < input.length; index++) {
    const key = input[index];
    const value = input[index + 1];
    if (!key.startsWith("--") || value == null) continue;
    index += 1;
    if (key === "--comments") parsed.comments = value;
    else if (key === "--reviews") parsed.reviews = value;
    else if (key === "--output") parsed.output = value;
    else if (key === "--actor-output") parsed.actorOutput = value;
    else if (key === "--envelope-output") parsed.envelopeOutput = value;
  }
  return parsed;
}

if (import.meta.main) {
  const parsed = args(process.argv.slice(2));
  if (!parsed.comments || !parsed.reviews || !parsed.output || !parsed.actorOutput) {
    console.error("usage: github-attestation.ts --comments <json> --reviews <json> --output <report> --actor-output <actor> [--envelope-output <json>]");
    process.exit(2);
  }
  const comments = JSON.parse(readFileSync(parsed.comments, "utf8")) as unknown;
  const reviews = JSON.parse(readFileSync(parsed.reviews, "utf8")) as unknown;
  const selected = selectGitHubAttestation(comments, reviews);
  if (selected) {
    writeFileSync(parsed.output, `${JSON.stringify(selected.report, null, 2)}\n`);
    writeFileSync(parsed.actorOutput, `${selected.actor}\n`);
    if (parsed.envelopeOutput) writeFileSync(parsed.envelopeOutput, `${JSON.stringify(selected, null, 2)}\n`);
  }
}
