import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { agentSkillsDir } from '@delego/core';
import { UserError } from '@delego/types';

export async function removeSkill(agent: string, skill: string): Promise<string> {
  const dir = join(agentSkillsDir(agent), skill);
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) {
      throw new UserError(`Skill path is not a directory: ${dir}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new UserError(`Skill "${skill}" not found for agent "${agent}".`);
    }
    throw err;
  }
  await rm(dir, { recursive: true, force: true });
  return dir;
}
