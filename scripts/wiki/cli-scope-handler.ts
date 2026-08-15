import { emit, one, type CliContext } from "./cli-runtime";
import { scopeReport, scopeText } from "./scope";
import { UsageError } from "./verification";

/** Stable projection for the additive `wiki:scope` command. */
export function handleScope(context: CliContext): void {
  if (context.parsed.positional.length > 0) throw new UsageError("scope does not accept positional arguments; use --base <ref>");
  const report = scopeReport(context.view, context.loaded.pages, { base: one(context.parsed, "base") });
  if (context.json) emit(context.io, report, true);
  else emit(context.io, scopeText(report), false);
  if (report.findings.some((finding) => finding.severity === "error")) process.exitCode = 1;
}
