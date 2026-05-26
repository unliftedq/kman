import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolRegistry } from "./memory.js";

export interface SkillsToolContext {
  skillsDir: string;
  enabledSkills: readonly string[];
}

const skillsListDefinition: Tool = {
  name: "skills_list",
  description:
    "List all enabled skills with their name and description. " +
    "Use this to discover what skills are available before loading one with skill_view.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

const skillViewDefinition: Tool = {
  name: "skill_view",
  description:
    "Load the full content of an enabled skill. " +
    "Call with just `name` to get the main SKILL.md instructions. " +
    "Optionally pass `file` (e.g. \"references/api.md\") to read a supporting file within the skill bundle.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Skill name (as listed in the SKILLS catalog in your system prompt).",
      },
      file: {
        type: "string",
        description: "Relative path within the skill directory. Defaults to SKILL.md.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
};

export function registerSkillsTool(server: Server, ctx: SkillsToolContext, registry: ToolRegistry): void {
  registry.add(skillsListDefinition, async () => callSkillsList(ctx));
  registry.add(skillViewDefinition, async (args) => callSkillView(ctx, args as { name?: string; file?: string }));
  registry.ensureHandlersInstalled(server);
}

async function callSkillsList(ctx: SkillsToolContext) {
  if (ctx.enabledSkills.length === 0) {
    return ok("No skills enabled for this agent.");
  }
  const lines: string[] = [];
  for (const name of ctx.enabledSkills) {
    const skillMd = join(ctx.skillsDir, name, "SKILL.md");
    const desc = await readSkillDescription(skillMd);
    lines.push(desc ? `- ${name}: ${desc}` : `- ${name}`);
  }
  return ok(lines.join("\n"));
}

async function callSkillView(ctx: SkillsToolContext, args: { name?: string; file?: string }) {
  const name = args.name?.trim();
  if (!name) {
    return err("name is required");
  }

  if (!ctx.enabledSkills.includes(name)) {
    return err(`skill "${name}" is not enabled for this agent. Enabled: ${ctx.enabledSkills.join(", ") || "(none)"}`);
  }

  const file = args.file?.trim() || "SKILL.md";

  const skillDir = resolve(ctx.skillsDir, name);
  const target = resolve(skillDir, file);

  // Path traversal guard: target must be inside skillDir
  const rel = relative(skillDir, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return err("invalid file path");
  }

  if (!existsSync(target)) {
    return err(`file not found: ${name}/${file}`);
  }

  try {
    const content = await readFile(target, "utf8");
    return ok(content);
  } catch (e) {
    return err(`failed to read ${name}/${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function readSkillDescription(skillMdPath: string): Promise<string | null> {
  try {
    const content = await readFile(skillMdPath, "utf8");
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm?.[1]) return null;
    const desc = fm[1].match(/^description:\s*(.+)$/m);
    if (!desc?.[1]) return null;
    return desc[1].trim().replace(/^['"]|['"]$/g, "");
  } catch {
    return null;
  }
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
