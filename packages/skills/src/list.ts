import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { agentSkillsDir } from '@kman/core';
import { readSkillDescription } from './frontmatter.js';
import { readManifest, type SkillManifest } from './manifest.js';

export interface InstalledSkill {
  name: string;
  dir: string;
  manifest: SkillManifest | null;
  /** Description from the SKILL.md frontmatter, if present. */
  description?: string;
}

export async function listInstalledSkills(agent: string): Promise<InstalledSkill[]> {
  const root = agentSkillsDir(agent);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: InstalledSkill[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(root, e.name);
    const manifest = await readManifest(dir);
    const description = await readSkillDescription(dir);
    out.push({ name: e.name, dir, manifest, ...(description !== undefined ? { description } : {}) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
