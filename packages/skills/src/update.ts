import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { agentSkillsDir } from '@kman/core';
import { UserError } from '@kman/types';
import { discoverSkills } from './discover.js';
import { materialize } from './fetch.js';
import {
  manifestInstalledAt,
  readManifest,
  type SkillManifest,
} from './manifest.js';
import { parseSource } from './source-parser.js';
import { vendorSkill } from './vendor.js';

export interface UpdateOptions {
  agent: string;
  skill: string;
  /** Bypass mtime > installed_at safety check. */
  force?: boolean;
}

/**
 * Re-fetch a skill from its recorded source and overwrite its directory.
 * Refuses if a file inside the installed directory has been modified after
 * the manifest was written, unless --force is passed (§5.4).
 */
export async function updateSkill(opts: UpdateOptions): Promise<{ installedPath: string }> {
  const dir = join(agentSkillsDir(opts.agent), opts.skill);
  const manifest = await readManifest(dir);
  if (!manifest) {
    throw new UserError(
      `Skill "${opts.skill}" has no .delego-skill.json manifest; cannot update. Use "skills remove" then "skills add".`,
    );
  }

  if (!opts.force) {
    const installedAt = await manifestInstalledAt(dir);
    if (installedAt) {
      const newest = await newestMtime(dir);
      if (newest && newest.getTime() > installedAt.getTime() + 1000) {
        throw new UserError(
          `Skill "${opts.skill}" has local modifications newer than the manifest. ` +
            `Re-running update would overwrite them. Pass --force or "skills remove" first.`,
        );
      }
    }
  }

  const source = parseSource(manifest.source, manifest.ref);
  const mat = await materialize(source);
  try {
    const discovered = await discoverSkills(mat.rootDir, mat.subpath);
    const match = discovered.find((s) => s.name === opts.skill) ?? discovered[0];
    if (!match) throw new UserError(`No skill named "${opts.skill}" in source ${manifest.source}.`);
    const { installedPath } = await vendorSkill({
      agent: opts.agent,
      source,
      skill: match,
      installName: opts.skill,
      force: true,
    });
    return { installedPath };
  } finally {
    await mat.cleanup();
  }
}

async function newestMtime(dir: string): Promise<Date | null> {
  let newest: Date | null = null;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries;
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(cur, e.name);
      // Skip the manifest itself — it's expected to share install time.
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (e.name === '.delego-skill.json') continue;
      try {
        const s = await stat(p);
        if (!newest || s.mtime > newest) newest = s.mtime;
      } catch {
        /* ignore */
      }
    }
  }
  return newest;
}

/** Look up the recorded source for an installed skill. */
export async function recordedSource(agent: string, skill: string): Promise<SkillManifest | null> {
  const dir = join(agentSkillsDir(agent), skill);
  return readManifest(dir);
}
