import { buildReconciliationPlan, reconciliationText } from "./reconciliation";
import { emit, has, type CliContext } from "./cli-runtime";
import { UsageError } from "./verification";

/**
 * Repository-wide planning command.  It intentionally accepts no page ID or
 * query: an operator asking for reconciliation gets the complete current-page
 * universe in one deterministic, read-only plan.
 */
export function handleReconcile(context: CliContext): void {
  if (context.parsed.positional.length > 0 || has(context.parsed, "page") || has(context.parsed, "query")) {
    throw new UsageError("reconcile does not accept a page ID or query; run it without positional arguments");
  }
  const plan = buildReconciliationPlan(context.view, context.loaded.pages, context.loaded.findings);
  if (context.json) emit(context.io, plan, true);
  else emit(context.io, reconciliationText(plan), false);
  if (plan.status === "blocked") process.exitCode = 1;
}

