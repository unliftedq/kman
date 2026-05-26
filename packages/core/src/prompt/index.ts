import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const SEPARATOR = "═".repeat(60);
const ENTRY_DELIM = "§";

/**
 * Memory file format on disk:
 *   entry one
 *   §
 *   entry two
 *
 * Returns an array of trimmed entries. Empty strings are dropped.
 */
export function parseMemoryEntries(content: string): string[] {
  return content
    .split(ENTRY_DELIM)
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
}

export function serializeMemoryEntries(entries: string[]): string {
  return entries.join(`\n${ENTRY_DELIM}\n`);
}

/** Total character count of joined entries (the budget figure). */
export function memoryUsage(entries: string[]): number {
  return serializeMemoryEntries(entries).length;
}

/** Render the frozen memory snapshot block injected into the system prompt. */
export function renderMemorySnapshot(entries: string[], charLimit: number): string {
  const usage = memoryUsage(entries);
  const pct = charLimit > 0 ? Math.round((usage / charLimit) * 100) : 0;
  const header = `MEMORY (your personal notes) [${pct}% — ${usage}/${charLimit} chars]`;

  const body =
    entries.length > 0
      ? entries.join(`\n${ENTRY_DELIM}\n`)
      : "(empty — use the `memory` tool to add entries)";
  const hint =
    "Manage this list with the `memory` tool (action: add | replace | remove). Keep entries compact and substantive.";
  return [SEPARATOR, header, SEPARATOR, body, "", hint].join("\n");
}

/** Render a brief catalog of enabled skills (name + description), pointing at full SKILL.md paths. */
export async function renderSkillCatalog(skillsDir: string, enabled: readonly string[]): Promise<string> {
  if (enabled.length === 0) return "";
  const lines: string[] = [];
  lines.push(SEPARATOR);
  lines.push(`SKILLS (${enabled.length} enabled)`);
  lines.push(SEPARATOR);
  for (const name of enabled) {
    const dir = join(skillsDir, name);
    const skillMd = join(dir, "SKILL.md");
    if (!existsSync(skillMd)) {
      lines.push(`- ${name}  (missing SKILL.md at ${skillMd})`);
      continue;
    }
    const desc = await readSkillDescription(skillMd);
    if (desc) {
      lines.push(`- ${name}: ${desc}`);
    } else {
      lines.push(`- ${name}`);
    }
    lines.push(`    Use skill_view("${name}") to load full instructions.`);
  }
  return lines.join("\n");
}

async function readSkillDescription(skillMdPath: string): Promise<string | null> {
  try {
    const content = await readFile(skillMdPath, "utf8");
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm || !fm[1]) return null;
    const desc = fm[1].match(/^description:\s*(.+)$/m);
    if (!desc || !desc[1]) return null;
    return desc[1].trim().replace(/^['"]|['"]$/g, "");
  } catch {
    return null;
  }
}

/**
 * Read soul.md + MEMORY.md from disk and produce the full system prompt that
 * gets passed to the backend via --append-system-prompt (or equivalent).
 * If memory is disabled, no snapshot block is added.
 */
export async function renderSystemPrompt(opts: {
  soulPath: string;
  memoryPath: string;
  memoryEnabled: boolean;
  memoryCharLimit: number;
  skillsDir?: string;
  enabledSkills?: readonly string[];
}): Promise<string> {
  const soul = existsSync(opts.soulPath) ? await readFile(opts.soulPath, "utf8") : "";

  const blocks: string[] = [];

  if (opts.memoryEnabled) {
    const memContent = existsSync(opts.memoryPath) ? await readFile(opts.memoryPath, "utf8") : "";
    const entries = parseMemoryEntries(memContent);
    blocks.push(renderMemorySnapshot(entries, opts.memoryCharLimit));
  }

  if (opts.skillsDir && opts.enabledSkills && opts.enabledSkills.length > 0) {
    const catalog = await renderSkillCatalog(opts.skillsDir, opts.enabledSkills);
    if (catalog) blocks.push(catalog);
  }

  blocks.push(soul.trimEnd());
  return blocks.join("\n\n") + "\n";
}
