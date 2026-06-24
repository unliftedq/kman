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

export interface UpdateManyOptions {
  agent: string;
  skills: string[];
  /** Bypass mtime > installed_at safety check. */
  force?: boolean;
}

export interface UpdatedSkill {
  skill: string;
  installedPath: string;
}

/**
 * Re-fetch a skill from its recorded source and overwrite its directory.
 * Refuses if a file inside the installed directory has been modified after
 * the manifest was written, unless --force is passed (§5.4).
 */
export async function updateSkill(opts: UpdateOptions): Promise<{ installedPath: string }> {
  const [result] = await updateSkills({
    agent: opts.agent,
    skills: [opts.skill],
    ...(opts.force !== undefined ? { force: opts.force } : {}),
  });
  // updateSkills always returns one entry per requested skill.
  return { installedPath: result!.installedPath };
}

interface PendingUpdate {
  skill: string;
  dir: string;
  manifest: SkillManifest;
}

/**
 * Re-fetch several installed skills from their recorded sources. Skills that
 * share the same source (and ref) are grouped so each source is only
 * materialized — i.e. cloned/fetched — once instead of once per skill (§5.4).
 * Results are returned in the same order as {@link UpdateManyOptions.skills}.
 */
export async function updateSkills(opts: UpdateManyOptions): Promise<UpdatedSkill[]> {
  const pending: PendingUpdate[] = [];
  for (const skill of opts.skills) {
    const dir = join(agentSkillsDir(opts.agent), skill);
    const manifest = await readManifest(dir);
    if (!manifest) {
      throw new UserError(
        `Skill "${skill}" has no .kman-skill.json manifest; cannot update. Use "skills remove" then "skills add".`,
      );
    }

    if (!opts.force) {
      const installedAt = await manifestInstalledAt(dir);
      if (installedAt) {
        const newest = await newestMtime(dir);
        if (newest && newest.getTime() > installedAt.getTime() + 1000) {
          throw new UserError(
            `Skill "${skill}" has local modifications newer than the manifest. ` +
              `Re-running update would overwrite them. Pass --force or "skills remove" first.`,
          );
        }
      }
    }

    pending.push({ skill, dir, manifest });
  }

  // Group skills that resolve to the same source + ref so each underlying
  // source is materialized (cloned/fetched) a single time.
  const groups = new Map<string, PendingUpdate[]>();
  for (const p of pending) {
    const key = `${p.manifest.source}\u0000${p.manifest.ref ?? ''}`;
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  }

  const bySkill = new Map<string, UpdatedSkill>();
  for (const group of groups.values()) {
    const first = group[0]!;
    const source = parseSource(first.manifest.source, first.manifest.ref);
    const mat = await materialize(source);
    try {
      const discovered = await discoverSkills(mat.rootDir, mat.subpath);
      for (const p of group) {
        // Match by installed name; fall back to the sole skill when a
        // single-skill source was installed under a different name.
        const match =
          discovered.find((s) => s.name === p.skill) ??
          (discovered.length === 1 ? discovered[0] : undefined);
        if (!match) {
          throw new UserError(`No skill named "${p.skill}" in source ${p.manifest.source}.`);
        }
        const { installedPath } = await vendorSkill({
          agent: opts.agent,
          source,
          skill: match,
          installName: p.skill,
          ...(mat.resolvedRef !== undefined ? { resolvedRef: mat.resolvedRef } : {}),
          force: true,
        });
        bySkill.set(p.skill, { skill: p.skill, installedPath });
      }
    } finally {
      await mat.cleanup();
    }
  }

  return opts.skills.map((skill) => bySkill.get(skill)!);
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
      if (e.name === '.kman-skill.json') continue;
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
