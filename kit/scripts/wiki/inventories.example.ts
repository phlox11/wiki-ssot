/**
 * EXAMPLE inventory generators — reference only, NOT wired by default.
 *
 * A reference adapter for a typical Bun monorepo — an HTTP API, a shared
 * contracts package, and a mobile app — showing the shape of a production
 * `generateInventories`. To enable inventories in your repo, copy the pieces you
 * need into `inventories.ts` and rewrite the paths/parsers for your own stack.
 *
 * Read this file where it sits. It is a kit `reference` entry, so it is never
 * delivered into an adopting repository and there is nothing here for an adopter
 * to clean up.
 *
 * A wiki-ssot checkout holds two byte-identical copies of it, and this note is
 * in both, so it names them rather than saying "this one": edit
 * `scripts/wiki/inventories.example.ts`, which is the source; `wiki:kit`
 * regenerates `kit/scripts/wiki/inventories.example.ts` from it, and an edit
 * made there is discarded by the next run.
 *
 * Every returned page is a deterministic function of tracked files and starts
 * with GENERATED_HEADER, so `wiki:generated --check` can detect drift.
 */
import ts from "typescript";
import { GENERATED_HEADER, type RepoView } from "./core";

/** Names of `export const X = …` declarations, optionally filtered by initializer. */
function exportedConstNames(sourcePath: string, raw: string, predicate?: (initializer: ts.Expression | undefined) => boolean): string[] {
  const source = ts.createSourceFile(sourcePath, raw, ts.ScriptTarget.Latest, true);
  const result: string[] = [];
  for (const node of source.statements) {
    if (!ts.isVariableStatement(node)) continue;
    const modifiers = ts.getModifiers(node);
    if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && (!predicate || predicate(declaration.initializer))) result.push(declaration.name.text);
    }
  }
  return result.sort();
}

/** The callee name of `foo(...)` or `obj.foo(...)`, used to detect e.g. `sqliteTable(...)`. */
function callName(expression: ts.Expression | undefined): string | undefined {
  if (!expression || !ts.isCallExpression(expression)) return undefined;
  if (ts.isIdentifier(expression.expression)) return expression.expression.text;
  if (ts.isPropertyAccessExpression(expression.expression)) return expression.expression.name.text;
  return undefined;
}

function mdTable(headers: string[], rows: string[][]): string[] {
  return [`| ${headers.join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`)];
}

export function generateInventories(view: RepoView): Record<string, string> {
  // 1) API routes: read the Hono `.route("/prefix", handler)` mounts, then each
  //    route file's `.get/.post(...)` calls, and join prefix + path.
  const mounts = new Map<string, string>();
  const indexRaw = view.read("apps/api/src/index.ts");
  for (const match of indexRaw.matchAll(/\.route\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) mounts.set(match[2], match[1]);
  const apiRows: string[][] = [];
  for (const path of view.listFiles().filter((item) => /^apps\/api\/src\/routes\/[^/]+\.ts$/.test(item) && !item.endsWith("/util.ts"))) {
    const raw = view.read(path);
    const exportMatch = raw.match(/export const\s+([A-Za-z_$][\w$]*)\s*=/);
    const prefix = exportMatch ? mounts.get(exportMatch[1]) : undefined;
    if (!prefix) continue;
    for (const match of raw.matchAll(/\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g)) {
      if (!match[2].startsWith("/")) continue; // Exclude c.get("userId"), repo.get("slug"), etc.
      const route = `${prefix}${match[2] === "/" ? "" : match[2]}` || "/";
      apiRows.push([match[1].toUpperCase(), route, path]);
    }
  }
  if (/\.get\(\s*["']\/health["']/.test(indexRaw)) apiRows.push(["GET", "/health", "apps/api/src/index.ts"]);
  apiRows.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));

  // 2) Zod contracts: every exported const in the shared contracts module.
  const contractsRaw = view.read("packages/shared/src/contracts.ts");
  const contracts = exportedConstNames("packages/shared/src/contracts.ts", contractsRaw);

  // 3) DB tables: exported consts initialized with `sqliteTable(...)`.
  const dbRaw = view.read("apps/api/src/db/schema.ts");
  const tables = exportedConstNames("apps/api/src/db/schema.ts", dbRaw, (initializer) => callName(initializer) === "sqliteTable");

  // 4) Expo Router routes: file paths under apps/mobile/app, minus layout files and route groups.
  const appFiles = view.listFiles().filter((path) => /^apps\/mobile\/app\/.*\.(ts|tsx)$/.test(path) && !path.endsWith("_layout.tsx") && !path.endsWith("_layout.ts"));
  const appRows = appFiles.map((path) => {
    let route = path.replace(/^apps\/mobile\/app/, "").replace(/\.(ts|tsx)$/, "").replace(/\/index$/, "/").replace(/\/\([^/]+\)/g, "");
    route = route.replace(/\/$/, "") || "/";
    return [route, path];
  }).sort((a, b) => a[0].localeCompare(b[0]));

  const file = (title: string, source: string, rows: string[]) => `${GENERATED_HEADER}\n\n# ${title}\n\nSource: \`${source}\`\n\n${rows.join("\n")}\n`;
  return {
    "wiki/_generated/api-routes.md": file("API route inventory", "apps/api/src/index.ts + apps/api/src/routes/**", mdTable(["Method", "Path", "Source"], apiRows)),
    "wiki/_generated/shared-contracts.md": file("Shared contract inventory", "packages/shared/src/contracts.ts", contracts.map((name) => `- \`${name}\``)),
    "wiki/_generated/db-inventory.md": file("Database table inventory", "apps/api/src/db/schema.ts", tables.map((name) => `- \`${name}\``)),
    "wiki/_generated/app-routes.md": file("Expo route inventory", "apps/mobile/app/**", mdTable(["Route", "Source"], appRows)),
  };
}
