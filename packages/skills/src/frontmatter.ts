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
  } catch {
    return undefined;
  }
  return extractDescription(raw);
}

/** Extract the `description` value from a markdown document's YAML frontmatter. */
export function extractDescription(raw: string): string | undefined {
  const normalized = raw.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---\n')) return undefined;
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) return undefined;
  const frontmatter = normalized.slice(4, end);
  const match = /^description:\s*(.*)$/m.exec(frontmatter);
  if (!match || match[1] === undefined) return undefined;
  let value = match[1].trim();
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
