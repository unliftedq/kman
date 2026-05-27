import { cp, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { agentSkillsDir } from '@kman/core';
import { UserError } from '@kman/types';
import type { DiscoveredSkill } from './discover.js';
import { formatSourceString, sourceUrl, writeManifest, type SkillManifest } from './manifest.js';
import type { ParsedSource } from './source-parser.js';

export interface VendorOptions {
  agent: string;
  source: ParsedSource;
  skill: DiscoveredSkill;
  /** Override `name` (default: skill.name). */
  installName?: string;
  /** Overwrite if a skill with this name already exists. */
  force?: boolean;
}

export interface VendorResult {
  installedPath: string;
  manifest: SkillManifest;
}

/**
 * Copy a discovered SKILL.md directory into <agent>/skills/<installName>/
 * and write the .delego-skill.json manifest (§5.4).
 */
export async function vendorSkill(opts: VendorOptions): Promise<VendorResult> {
  const name = opts.installName ?? opts.skill.name;
  const dest = join(agentSkillsDir(opts.agent), name);

  const exists = await pathExists(dest);
  if (exists && !opts.force) {
    throw new UserError(`Skill "${name}" already exists at ${dest}. Use --force to overwrite.`);
  }

  await mkdir(agentSkillsDir(opts.agent), { recursive: true });

  if (exists) {
    // Replace with a fresh copy: remove old, then copy.
    await cp(opts.skill.dir, dest, { recursive: true, force: true });
  } else {
    await cp(opts.skill.dir, dest, { recursive: true });
  }

  const manifest: SkillManifest = {
    source: formatSourceString(opts.source),
    installed_at: new Date().toISOString(),
  };
  const url = sourceUrl(opts.source);
  if (url) manifest.source_url = url;
  if ('ref' in opts.source && opts.source.ref) manifest.ref = opts.source.ref;
  await writeManifest(dest, manifest);

  return { installedPath: dest, manifest };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
