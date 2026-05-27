import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { UserError } from '@delego/types';

export interface DiscoveredSkill {
  /** Skill name derived from its directory basename. */
  name: string;
  /** Absolute path to the directory that contains SKILL.md. */
  dir: string;
  /** Path of dir relative to the materialized source root. */
  relPath: string;
}

const COMMON_ROOTS = ['', 'skills', '.claude/skills'];
const MAX_DEPTH = 4;
const IGNORE = new Set(['node_modules', '.git', '.turbo', 'dist', 'build', '.cache']);

/**
 * Discover SKILL.md directories inside a materialized source (§5.4).
 * If `subpath` is provided, search is anchored at <rootDir>/<subpath>.
 */
export async function discoverSkills(rootDir: string, subpath?: string): Promise<DiscoveredSkill[]> {
  const anchor = subpath ? join(rootDir, subpath) : rootDir;
  const anchorStat = await safeStat(anchor);
  if (!anchorStat?.isDirectory()) {
    throw new UserError(`Source path does not exist or is not a directory: ${anchor}`);
  }

  // 1. Direct check on the anchor itself.
  const found: DiscoveredSkill[] = [];
  if (await hasSkillMd(anchor)) {
    found.push({ name: basename(anchor), dir: anchor, relPath: relative(rootDir, anchor) || '.' });
    return found;
  }

  // 2. Common skill roots.
  for (const root of COMMON_ROOTS) {
    const candidate = root ? join(anchor, root) : anchor;
    const s = await safeStat(candidate);
    if (!s?.isDirectory()) continue;
    const direct = await listSkillDirs(candidate);
    for (const d of direct) {
      found.push({ name: basename(d), dir: d, relPath: relative(rootDir, d) });
    }
    if (found.length > 0) return dedupe(found);
  }

  // 3. Bounded recursive search.
  await recurse(anchor, 0, rootDir, found);
  if (found.length === 0) {
    throw new UserError(`No SKILL.md found anywhere under ${anchor}.`);
  }
  return dedupe(found);
}

async function listSkillDirs(parent: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || IGNORE.has(e.name)) continue;
    const child = join(parent, e.name);
    if (await hasSkillMd(child)) out.push(child);
  }
  return out;
}

async function recurse(dir: string, depth: number, rootDir: string, found: DiscoveredSkill[]): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (await hasSkillMd(dir)) {
    found.push({ name: basename(dir), dir, relPath: relative(rootDir, dir) || '.' });
    return; // Don't descend into a skill dir.
  }
  for (const e of entries) {
    if (!e.isDirectory() || IGNORE.has(e.name)) continue;
    await recurse(join(dir, e.name), depth + 1, rootDir, found);
  }
}

async function hasSkillMd(dir: string): Promise<boolean> {
  const s = await safeStat(join(dir, 'SKILL.md'));
  return !!s?.isFile();
}

async function safeStat(p: string) {
  try {
    return await stat(p);
  } catch {
    return null;
  }
}

function dedupe(list: DiscoveredSkill[]): DiscoveredSkill[] {
  const seen = new Set<string>();
  const out: DiscoveredSkill[] = [];
  for (const s of list) {
    if (seen.has(s.dir)) continue;
    seen.add(s.dir);
    out.push(s);
  }
  return out;
}
