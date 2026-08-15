import { describe, expect, test } from "bun:test";
import {
  AGENT_MANAGED_END,
  AGENT_MANAGED_START,
  AGENT_VERSION_MARKER,
  MANAGED_AGENT_RULES,
  renderManagedAgentBlock,
  validateManagedAgentRules,
} from "./agent-rules";

describe("typed managed AGENTS rules", () => {
  test("renders a stable version and every canonical rule ID", () => {
    const rendered = renderManagedAgentBlock();
    expect(rendered.startsWith(`${AGENT_MANAGED_START}\n${AGENT_VERSION_MARKER}`)).toBe(true);
    expect(rendered.endsWith(`${AGENT_MANAGED_END}\n`)).toBe(true);
    for (const rule of MANAGED_AGENT_RULES) expect(rendered).toContain(`<!-- wiki-ssot:rule id=${rule.id} -->`);
    expect(validateManagedAgentRules(rendered)).toEqual([]);
  });

  test("fails closed for malformed markers, version, missing, duplicate, and unknown IDs", () => {
    expect(validateManagedAgentRules("host prose")).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "agent-managed-structure" }),
    ]));
    expect(validateManagedAgentRules(renderManagedAgentBlock().replace(AGENT_VERSION_MARKER, "<!-- version: 1 -->"))).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "agent-managed-version" }),
    ]));
    const first = `<!-- wiki-ssot:rule id=${MANAGED_AGENT_RULES[0].id} -->`;
    const missing = renderManagedAgentBlock().replace(first, "");
    expect(validateManagedAgentRules(missing)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "agent-managed-rule-missing", message: expect.stringContaining(MANAGED_AGENT_RULES[0].id) }),
    ]));
    const duplicate = renderManagedAgentBlock().replace(AGENT_MANAGED_END, `${first}\n${AGENT_MANAGED_END}`);
    expect(validateManagedAgentRules(duplicate)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "agent-managed-rule-duplicate" }),
    ]));
    const unknown = renderManagedAgentBlock().replace(AGENT_MANAGED_END, "<!-- wiki-ssot:rule id=unknown-rule -->\n<!-- wiki-ssot:managed:end -->");
    expect(validateManagedAgentRules(unknown)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "agent-managed-rule-unknown" }),
    ]));
  });

  test("ignores host prose outside the managed block", () => {
    const rendered = `# Host instructions\nDo not parse this prose.\n\n${renderManagedAgentBlock()}\nHost customization remains untouched.`;
    expect(validateManagedAgentRules(rendered)).toEqual([]);
  });

  test("upgrading the typed block is idempotent and preserves host content", () => {
    const managed = renderManagedAgentBlock();
    const host = `# Host policy\n\n${AGENT_MANAGED_START}\nlegacy\n${AGENT_MANAGED_END}\n\n# Local appendix\n`;
    const install = (existing: string): string => {
      const start = existing.indexOf(AGENT_MANAGED_START);
      const end = existing.indexOf(AGENT_MANAGED_END, start + AGENT_MANAGED_START.length);
      if (start < 0 || end < start) throw new Error("managed block fixture is malformed");
      return `${existing.slice(0, start)}${managed.trimEnd()}${existing.slice(end + AGENT_MANAGED_END.length)}`;
    };
    const first = install(host);
    expect(first).toContain("# Host policy");
    expect(first).toContain("# Local appendix");
    const second = install(first);
    expect(second).toBe(first);
  });
});
