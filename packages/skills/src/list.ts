import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { agentSkillsDir } from '@delego/core';
import { readManifest, type SkillManifest } from './manifest.js';

export interface InstalledSkill {
  name: string;
  dir: string;
  manifest: SkillManifest | null;
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
    out.push({ name: e.name, dir, manifest });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
