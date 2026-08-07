#!/usr/bin/env bun
import { discoveryHandlers } from "./cli-discovery-handlers";
import { generationHandlers } from "./cli-generation-handlers";
import { reviewHandlers } from "./cli-review-handlers";
import {
  CLI_COMMANDS,
  createCliContext,
  emit,
  has,
  printFindings,
  processIo,
  usage,
  type CliContext,
  type CliContextOptions,
  type CliIo,
  type ParsedArgs,
} from "./cli-runtime";
import { validationHandlers } from "./cli-validation-handlers";
import { UsageError } from "./verification";

export type { CliContext, CliContextOptions, CliIo };

const BOOLEAN_FLAGS = new Set(["json", "staged", "check", "enforce", "enforce-conflicts", "all", "full"]);

/** Preserve the permissive parser contract in the executable entrypoint. */
export function parseArgs(input: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let index = 0; index < input.length; index++) {
    const token = input[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equal = token.indexOf("=");
    const key = equal === -1 ? token.slice(2) : token.slice(2, equal);
    let value = equal === -1 ? undefined : token.slice(equal + 1);
    if (value == null && !BOOLEAN_FLAGS.has(key) && input[index + 1] != null && !input[index + 1].startsWith("--")) value = input[++index];
    flags.set(key, [...(flags.get(key) ?? []), value ?? "true"]);
  }
  return { positional, flags };
}

function bootstrap(input: string[], options: CliContextOptions): CliContext {
  const parsed = parseArgs(input);
  const command = parsed.positional.shift() ?? usage();
  return createCliContext(parsed, command, options);
}

type CliHandler = (context: CliContext) => void;

/** Registration order is frozen; command implementations live in bounded groups. */
export const CLI_HANDLERS: Readonly<Record<string, CliHandler>> = Object.freeze({
  lint: validationHandlers.lint,
  inventory: generationHandlers.inventory,
  index: generationHandlers.index,
  generated: generationHandlers.generated,
  kit: generationHandlers.kit,
  work: discoveryHandlers.work,
  search: discoveryHandlers.search,
  conflicts: discoveryHandlers.conflicts,
  context: discoveryHandlers.context,
  impact: validationHandlers.impact,
  verify: validationHandlers.verify,
  "review-preflight": reviewHandlers["review-preflight"],
  "review-bundle": reviewHandlers["review-bundle"],
  "review-check": reviewHandlers["review-check"],
  doctor: validationHandlers.doctor,
  check: validationHandlers.check,
  audit: validationHandlers.audit,
});

/** Dispatch an already-created context, retaining the historical short-circuit order. */
export function dispatchCommand(context: CliContext): void {
  const handler = CLI_HANDLERS[context.command];

  // Work/context own their help surfaces. They must remain usable even when a
  // page cannot be loaded, so help is dispatched before loaded-page findings.
  if ((context.command === "work" || context.command === "context") && has(context.parsed, "help")) {
    handler?.(context);
    return;
  }

  // Lint and doctor diagnose malformed repositories themselves and therefore
  // run before the generic loaded-page error short-circuit.
  if (context.command === "lint" || context.command === "doctor") {
    handler?.(context);
    return;
  }

  if (context.loaded.findings.some((finding) => finding.severity === "error")) {
    if (context.json) emit(context.io, { ok: false, findings: context.loaded.findings }, true);
    else printFindings(context.io, context.loaded.findings);
    process.exitCode = 1;
    return;
  }

  if (!handler) {
    // Keep the exact usage payload for unknown commands after a valid load.
    throw new UsageError(`usage: bun scripts/wiki/cli.ts <${CLI_COMMANDS.join("|")}> [options]`);
  }
  handler(context);
}

/** Direct, injectable dispatch entrypoint used by focused handler tests. */
export function dispatch(input: string[] | CliContext, options: CliContextOptions = {}): number {
  process.exitCode = 0;
  const context = Array.isArray(input) ? bootstrap(input, options) : input;
  dispatchCommand(context);
  const code = typeof process.exitCode === "number" ? process.exitCode : Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return code;
}

/** Run the executable contract with injectable IO and return its exit code. */
export function runCli(input: string[], options: CliContextOptions = {}): number {
  process.exitCode = undefined;
  const io = options.io ?? processIo;
  try {
    const context = bootstrap(input, { ...options, io });
    dispatchCommand(context);
    const code = typeof process.exitCode === "number" ? process.exitCode : Number(process.exitCode ?? 0);
    process.exitCode = 0;
    return code;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`${error.message}\n`);
      process.exitCode = 2;
    } else {
      io.stderr(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
    const code = typeof process.exitCode === "number" ? process.exitCode : Number(process.exitCode ?? 1);
    process.exitCode = 0;
    return code;
  }
}

if (import.meta.main) process.exitCode = runCli(process.argv.slice(2));
