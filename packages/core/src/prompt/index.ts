import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

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

/** Render the frozen memory snapshot block injected into the system prompt. */
export async function renderSystemPrompt(opts: {
  soulPath: string;
  memoryPath: string;
  memoryEnabled: boolean;
  memoryCharLimit: number;
}): Promise<string> {
  const soul = existsSync(opts.soulPath) ? await readFile(opts.soulPath, "utf8") : "";

  const blocks: string[] = [];

  if (opts.memoryEnabled) {
    const memContent = existsSync(opts.memoryPath) ? await readFile(opts.memoryPath, "utf8") : "";
    const entries = parseMemoryEntries(memContent);
    blocks.push(renderMemorySnapshot(entries, opts.memoryCharLimit));
  }

  blocks.push(soul.trimEnd());
  return blocks.join("\n\n") + "\n";
}
