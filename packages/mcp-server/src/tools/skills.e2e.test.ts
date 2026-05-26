/**
 * E2E test: spawns a real MCP server subprocess, communicates via the MCP
 * stdio protocol using the SDK Client, and exercises the skills tools against
 * a real skill bundle on disk.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const SERVER_ENTRY = resolve(import.meta.dirname, "../run.ts");

// ---------------------------------------------------------------------------
// Skill bundle fixture
// ---------------------------------------------------------------------------
function createSkillBundle(skillsDir: string) {
  const mk = (...parts: string[]) => mkdirSync(join(skillsDir, ...parts), { recursive: true });
  const wr = (rel: string, content: string) => writeFileSync(join(skillsDir, rel), content, "utf8");

  mk("alpha");
  wr(
    "alpha/SKILL.md",
    `---\ndescription: "Alpha skill — does alpha things"\n---\n\n# Alpha Instructions\nUse this skill wisely.\n`,
  );
  mk("alpha", "references");
  wr("alpha/references/api.md", "# Alpha API\nGET /alpha/v1/resource\nPOST /alpha/v1/resource\n");
  mk("alpha", "scripts");
  wr("alpha/scripts/setup.sh", "#!/bin/sh\necho 'Alpha setup complete'\n");
  mk("alpha", "templates");
  wr("alpha/templates/prompt.txt", "You are an alpha assistant.\nContext: {{context}}\nTask: {{task}}\n");

  mk("beta");
  // beta has no frontmatter description
  wr("beta/SKILL.md", "# Beta Instructions\nMinimal skill, no frontmatter description.\n");

  mk("hidden");
  wr("hidden/SKILL.md", "---\ndescription: 'Should never be accessible'\n---\n# Hidden\n");
}

// ---------------------------------------------------------------------------
// Shared client / server state
// ---------------------------------------------------------------------------
let tmpDir: string;
let skillsDir: string;
let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "delego-e2e-"));
  skillsDir = join(tmpDir, "skills");
  mkdirSync(skillsDir);
  createSkillBundle(skillsDir);

  transport = new StdioClientTransport({
    command: "bun",
    args: ["--bun", SERVER_ENTRY],
    env: {
      ...process.env,
      DELEGO_MCP_AGENT: "e2e-test-agent",
      DELEGO_MCP_MEMORY_PATH: join(tmpDir, "MEMORY.md"),
      DELEGO_MCP_CHAR_LIMIT: "2200",
      DELEGO_MCP_MEMORY_ENABLED: "0",  // disable memory → only skills tools exposed
      DELEGO_MCP_SKILLS_DIR: skillsDir,
      DELEGO_MCP_SKILLS: "alpha,beta",  // "hidden" intentionally omitted
    },
    stderr: "pipe",
  });

  client = new Client({ name: "e2e-test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client.close().catch(() => {});
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("tools/list", () => {
  test("exposes skills_list and skill_view, not memory", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("skills_list");
    expect(names).toContain("skill_view");
    expect(names).not.toContain("memory");
  });
});

describe("skills_list", () => {
  test("returns enabled skills with descriptions", async () => {
    const result = await client.callTool({ name: "skills_list", arguments: {} });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("alpha: Alpha skill");
    expect(text).toContain("beta");
  });

  test("beta appears without colon (no frontmatter description)", async () => {
    const result = await client.callTool({ name: "skills_list", arguments: {} });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/^- beta$/m);
  });

  test("hidden skill is not listed", async () => {
    const result = await client.callTool({ name: "skills_list", arguments: {} });
    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain("hidden");
  });
});

describe("skill_view — SKILL.md", () => {
  test("loads main SKILL.md by default", async () => {
    const result = await client.callTool({ name: "skill_view", arguments: { name: "alpha" } });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Alpha Instructions");
    expect(result.isError).toBeFalsy();
  });

  test("loads SKILL.md explicitly", async () => {
    const result = await client.callTool({
      name: "skill_view",
      arguments: { name: "alpha", file: "SKILL.md" },
    });
    expect((result.content[0] as { text: string }).text).toContain("Alpha Instructions");
  });
});

describe("skill_view — references/", () => {
  test("loads references/api.md", async () => {
    const result = await client.callTool({
      name: "skill_view",
      arguments: { name: "alpha", file: "references/api.md" },
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Alpha API");
    expect(text).toContain("GET /alpha/v1/resource");
  });
});

describe("skill_view — scripts/", () => {
  test("loads scripts/setup.sh", async () => {
    const result = await client.callTool({
      name: "skill_view",
      arguments: { name: "alpha", file: "scripts/setup.sh" },
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Alpha setup complete");
  });
});

describe("skill_view — templates/", () => {
  test("loads templates/prompt.txt", async () => {
    const result = await client.callTool({
      name: "skill_view",
      arguments: { name: "alpha", file: "templates/prompt.txt" },
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("{{context}}");
    expect(text).toContain("{{task}}");
  });
});

describe("skill_view — error cases", () => {
  test("rejects skill not in enabledSkills", async () => {
    const result = await client.callTool({
      name: "skill_view",
      arguments: { name: "hidden" },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("not enabled");
  });

  test("rejects missing file", async () => {
    const result = await client.callTool({
      name: "skill_view",
      arguments: { name: "alpha", file: "references/nonexistent.md" },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("file not found");
  });

  test("blocks path traversal", async () => {
    const result = await client.callTool({
      name: "skill_view",
      arguments: { name: "alpha", file: "../../etc/passwd" },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("invalid file path");
  });

  test("blocks deep traversal through subdir", async () => {
    const result = await client.callTool({
      name: "skill_view",
      arguments: { name: "alpha", file: "references/../../../etc/passwd" },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("invalid file path");
  });
});
