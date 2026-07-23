import type { RepoView } from "./core";

/**
 * Project-owned adapter for code-derived "inventory" pages.
 *
 * The wiki engine is framework-agnostic. Inventories are the one place where a
 * project teaches the engine how to read its own stack (HTTP routes, schema
 * tables, generated clients, …) and emit deterministic `wiki/_generated/**`
 * pages that `wiki:generated --check` then keeps in sync with the code.
 *
 * The default returns `{}` — no inventories. Everything else (frontmatter SSOT,
 * coverage, impact, staleness, conflicts) works without this.
 *
 * To enable inventories, return a map of `{ "wiki/_generated/<name>.md": content }`.
 * `content` MUST begin with `GENERATED_HEADER` (exported from ./core) and must be
 * a pure function of tracked files, read through `view.read(path)` /
 * `view.listFiles()`, so two runs on the same tree produce identical bytes.
 *
 * See `inventories.example.ts` for a real implementation (Hono routes, Zod
 * contracts, Drizzle tables, Expo routes) you can copy and adapt.
 */
export function generateInventories(_view: RepoView): Record<string, string> {
  return {};
}
