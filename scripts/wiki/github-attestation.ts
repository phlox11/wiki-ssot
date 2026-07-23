#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

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

function reportFromBody(body: unknown): unknown | undefined {
  if (typeof body !== "string" || !body.includes(GITHUB_ATTESTATION_MARKER)) return undefined;
  const afterMarker = body.slice(body.indexOf(GITHUB_ATTESTATION_MARKER) + GITHUB_ATTESTATION_MARKER.length);
  const fenced = afterMarker.match(/```(?:json|ya?ml)\s*\n([\s\S]*?)```/i);
  if (!fenced) return undefined;
  try {
    return parseYaml(fenced[1]) as unknown;
  } catch {
    return undefined;
  }
}

export function selectGitHubAttestation(commentsInput: unknown, reviewsInput: unknown): GitHubAttestationEnvelope | undefined {
  const candidates: GitHubAttestationEnvelope[] = [];
  for (const raw of flattenApiPages(commentsInput) as GitHubComment[]) {
    const report = reportFromBody(raw.body);
    const actor = typeof raw.user?.login === "string" ? raw.user.login : "";
    if (report == null || !actor) continue;
    candidates.push({
      actor,
      source: "issue_comment",
      sourceId: String(raw.id ?? ""),
      observedAt: String(raw.updated_at ?? raw.created_at ?? ""),
      report,
    });
  }
  for (const raw of flattenApiPages(reviewsInput) as GitHubReview[]) {
    if (String(raw.state ?? "").toUpperCase() === "DISMISSED") continue;
    const report = reportFromBody(raw.body);
    const actor = typeof raw.user?.login === "string" ? raw.user.login : "";
    if (report == null || !actor) continue;
    candidates.push({
      actor,
      source: "pull_request_review",
      sourceId: String(raw.id ?? ""),
      observedAt: String(raw.submitted_at ?? raw.updated_at ?? raw.created_at ?? ""),
      report,
    });
  }
  return candidates.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.sourceId.localeCompare(b.sourceId)).at(-1);
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
