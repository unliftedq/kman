import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ToolRegistry } from "./memory.js";
import { registerSkillsTool } from "./skills.js";

// ---------------------------------------------------------------------------
// Minimal mock server — only needs setRequestHandler to satisfy ToolRegistry
// ---------------------------------------------------------------------------
type Handler = (req: unknown) => Promise<unknown>;

class MockServer {
  private handlers = new Map<unknown, Handler>();

  setRequestHandler(schema: unknown, handler: Handler): void {
    this.handlers.set(schema, handler);
  }

  async callTool(name: string, args: Record<string, unknown> = {}) {
    const h = this.handlers.get(CallToolRequestSchema);
    if (!h) throw new Error("no CallTool handler installed");
    return h({ method: "tools/call", params: { name, arguments: args } }) as Promise<{
      isError?: boolean;
      content: { type: string; text: string }[];
    }>;
  }

  async listTools() {
    const h = this.handlers.get(ListToolsRequestSchema);
    if (!h) throw new Error("no ListTools handler installed");
    return h({ method: "tools/list" }) as Promise<{ tools: { name: string }[] }>;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function skillMd(description: string, body = "# Instructions\nDo the thing."): string {
  return `---\ndescription: "${description}"\n---\n\n${body}`;
}

function setupSkillBundle(skillsDir: string): void {
  const mk = (rel: string) => mkdirSync(join(skillsDir, rel), { recursive: true });
  const wr = (rel: string, content: string) => writeFileSync(join(skillsDir, rel), content, "utf8");

  // main-skill: full bundle with references, scripts, templates
  mk("main-skill");
  wr("main-skill/SKILL.md", skillMd("A fully featured skill", "# Main Instructions\nUse me well."));
  mk("main-skill/references");
  wr("main-skill/references/api.md", "# API Reference\nendpoint: /v1/foo");
  mk("main-skill/scripts");
  wr("main-skill/scripts/setup.sh", "#!/bin/sh\necho 'setup'");
  mk("main-skill/templates");
  wr("main-skill/templates/prompt.txt", "You are a helpful assistant.\n{{context}}");

  // nodesc-skill: valid SKILL.md but no description frontmatter
  mk("nodesc-skill");
  wr("nodesc-skill/SKILL.md", "# No Description\nJust instructions.");

  // disabled-skill: exists on disk but not in the enabledSkills list
  mk("disabled-skill");
  wr("disabled-skill/SKILL.md", skillMd("Should not be accessible"));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("skills tools", () => {
  let skillsDir: string;
  let server: MockServer;
  let registry: ToolRegistry;

  beforeEach(() => {
    skillsDir = mkdtempSync(join(tmpdir(), "delego-skills-test-"));
    setupSkillBundle(skillsDir);

    server = new MockServer();
    registry = new ToolRegistry();
    registerSkillsTool(
      server as unknown as Server,
      { skillsDir, enabledSkills: ["main-skill", "nodesc-skill"] },
      registry,
    );
  });

  afterEach(() => {
    rmSync(skillsDir, { recursive: true, force: true });
  });

  // ── tools/list ────────────────────────────────────────────────────────────

  describe("tools/list", () => {
    test("exposes skills_list and skill_view", async () => {
      const { tools } = await server.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("skills_list");
      expect(names).toContain("skill_view");
    });
  });

  // ── skills_list ───────────────────────────────────────────────────────────

  describe("skills_list", () => {
    test("returns all enabled skills with descriptions", async () => {
      const result = await server.callTool("skills_list");
      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain("main-skill: A fully featured skill");
      expect(text).toContain("nodesc-skill");
    });

    test("skill without description appears without colon", async () => {
      const result = await server.callTool("skills_list");
      const text = result.content[0].text;
      // nodesc-skill has no frontmatter description → line is just "- nodesc-skill"
      expect(text).toMatch(/^- nodesc-skill$/m);
    });

    test("disabled skill is not listed", async () => {
      const result = await server.callTool("skills_list");
      expect(result.content[0].text).not.toContain("disabled-skill");
    });

    test("returns message when no skills enabled", async () => {
      const emptyRegistry = new ToolRegistry();
      const emptyServer = new MockServer();
      registerSkillsTool(
        emptyServer as unknown as Server,
        { skillsDir, enabledSkills: [] },
        emptyRegistry,
      );
      const result = await emptyServer.callTool("skills_list");
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("No skills enabled");
    });
  });

  // ── skill_view — SKILL.md ─────────────────────────────────────────────────

  describe("skill_view — SKILL.md", () => {
    test("loads main SKILL.md when no file param given", async () => {
      const result = await server.callTool("skill_view", { name: "main-skill" });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Main Instructions");
    });

    test("loads SKILL.md explicitly", async () => {
      const result = await server.callTool("skill_view", { name: "main-skill", file: "SKILL.md" });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Main Instructions");
    });
  });

  // ── skill_view — references ───────────────────────────────────────────────

  describe("skill_view — references/", () => {
    test("loads references/api.md", async () => {
      const result = await server.callTool("skill_view", {
        name: "main-skill",
        file: "references/api.md",
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("API Reference");
      expect(result.content[0].text).toContain("/v1/foo");
    });
  });

  // ── skill_view — scripts ──────────────────────────────────────────────────

  describe("skill_view — scripts/", () => {
    test("loads scripts/setup.sh", async () => {
      const result = await server.callTool("skill_view", {
        name: "main-skill",
        file: "scripts/setup.sh",
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("echo 'setup'");
    });
  });

  // ── skill_view — templates ────────────────────────────────────────────────

  describe("skill_view — templates/", () => {
    test("loads templates/prompt.txt", async () => {
      const result = await server.callTool("skill_view", {
        name: "main-skill",
        file: "templates/prompt.txt",
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("{{context}}");
    });
  });

  // ── skill_view — error cases ──────────────────────────────────────────────

  describe("skill_view — error cases", () => {
    test("error when name is missing", async () => {
      const result = await server.callTool("skill_view", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("name is required");
    });

    test("error when skill is not in enabledSkills", async () => {
      const result = await server.callTool("skill_view", { name: "disabled-skill" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not enabled");
    });

    test("error when file does not exist", async () => {
      const result = await server.callTool("skill_view", {
        name: "main-skill",
        file: "references/nonexistent.md",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("file not found");
    });

    test("path traversal blocked — relative escape", async () => {
      const result = await server.callTool("skill_view", {
        name: "main-skill",
        file: "../../etc/passwd",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("invalid file path");
    });

    test("path traversal blocked — encoded-style escape attempt", async () => {
      const result = await server.callTool("skill_view", {
        name: "main-skill",
        file: "references/../../../etc/passwd",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("invalid file path");
    });

    test("unknown tool returns error", async () => {
      const result = await server.callTool("nonexistent_tool");
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("unknown tool");
    });
  });
});
