import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SKILL_FILENAME = 'SKILL.md';

/**
 * Read the `description` field from a skill's SKILL.md YAML frontmatter.
 * Returns `undefined` when the file is missing, has no frontmatter, or the
 * frontmatter lacks a `description:` key.
 */
export async function readSkillDescription(skillDir: string): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(skillDir, SKILL_FILENAME), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  return extractDescription(raw);
}

/** Extract the `description` value from a markdown document's YAML frontmatter. */
export function extractDescription(raw: string): string | undefined {
  // Normalize line endings so CRLF (common on Windows) parses identically.
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return undefined;
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) return undefined;
  const frontmatter = normalized.slice(4, end);
  const lines = frontmatter.split('\n');
  const idx = lines.findIndex((line) => /^description:/.test(line));
  if (idx < 0) return undefined;

  const inline = /^description:\s*(.*)$/.exec(lines[idx] ?? '')?.[1] ?? '';
  let value = inline.trim();

  // Block scalar (`|`, `>`, with optional chomping/indent indicators): the
  // value lives on the following indented lines.
  if (/^[|>][+-]?\d*$/.test(value)) {
    const block: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (line.trim() !== '' && !/^\s/.test(line)) break; // de-dented: end of block.
      block.push(line);
    }
    value = block.join(' ').replace(/\s+/g, ' ').trim();
    return value.length > 0 ? value : undefined;
  }

  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }
  value = value.trim();
  return value.length > 0 ? value : undefined;
}

/** Truncate `text` to `max` characters, appending an ellipsis when shortened. */
export function truncate(text: string, max = 80): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
