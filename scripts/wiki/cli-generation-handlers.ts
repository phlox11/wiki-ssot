import { compareGenerated, generatedCoreFiles, readConfig, writeGenerated } from "./core";
import { compareKit, kitFiles, writeKit } from "./kit-packaging";
import { generateInventories } from "./inventories";
import { emit, has, printFindings, type CliContext } from "./cli-runtime";
import { UsageError } from "./verification";

export function handleInventory(context: CliContext): void {
  if (context.staged) throw new UsageError("inventory does not write in --staged mode");
  const files = generateInventories(context.view);
  writeGenerated(context.view.root, files);
  emit(context.io, context.json ? { written: Object.keys(files).sort() } : `wrote ${Object.keys(files).length} inventory files`, context.json);
}

export function handleIndex(context: CliContext): void {
  if (context.staged) throw new UsageError("index does not write in --staged mode");
  const files = generatedCoreFiles(context.loaded.pages, readConfig(context.view).name);
  writeGenerated(context.view.root, files);
  emit(context.io, context.json ? { written: Object.keys(files).sort() } : `wrote ${Object.keys(files).length} index files`, context.json);
}

export function handleGenerated(context: CliContext): void {
  const expected = { ...generatedCoreFiles(context.loaded.pages, readConfig(context.view).name), ...generateInventories(context.view) };
  if (has(context.parsed, "check") || context.staged) {
    const findings = compareGenerated(context.view, expected);
    if (context.json) emit(context.io, { ok: findings.length === 0, findings }, true);
    else printFindings(context.io, findings);
    process.exitCode = findings.length > 0 ? 1 : 0;
  } else {
    writeGenerated(context.view.root, expected);
    emit(context.io, context.json ? { written: Object.keys(expected).sort() } : `wrote ${Object.keys(expected).length} generated files`, context.json);
  }
}

export function handleKit(context: CliContext): void {
  if (!readConfig(context.view).publishesKit) {
    throw new UsageError('kit generation is only for the repository that publishes the distribution; set "publishesKit": true in .wiki/config.json to enable it');
  }
  const { files, findings: sourceFindings } = kitFiles(context.view);
  if (has(context.parsed, "check") || context.staged) {
    const findings = [...sourceFindings, ...compareKit(context.view, files)];
    if (context.json) emit(context.io, { ok: findings.length === 0, findings }, true);
    else printFindings(context.io, findings);
    process.exitCode = findings.length > 0 ? 1 : 0;
    return;
  }
  if (sourceFindings.length > 0) {
    if (context.json) emit(context.io, { ok: false, findings: sourceFindings }, true);
    else printFindings(context.io, sourceFindings);
    process.exitCode = 1;
    return;
  }
  const result = writeKit(context.view, files);
  emit(context.io, context.json ? result : `wrote ${result.written.length} kit files${result.removed.length > 0 ? `, removed ${result.removed.length}` : ""}`, context.json);
}

export type GenerationHandler = (context: CliContext) => void;

export const generationHandlers: Record<string, GenerationHandler> = {
  inventory: handleInventory,
  index: handleIndex,
  generated: handleGenerated,
  kit: handleKit,
};
