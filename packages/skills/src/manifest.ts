import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ParsedSource } from './source-parser.js';

export interface SkillManifest {
  source: string;
  source_url?: string;
  ref?: string;
  installed_at: string;
  version?: string;
  checksum?: string;
}

export const MANIFEST_FILENAME = '.kman-skill.json';

export function manifestPath(skillDir: string): string {
  return join(skillDir, MANIFEST_FILENAME);
}

export async function readManifest(skillDir: string): Promise<SkillManifest | null> {
  try {
    const raw = await readFile(manifestPath(skillDir), 'utf8');
    return JSON.parse(raw) as SkillManifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeManifest(skillDir: string, manifest: SkillManifest): Promise<void> {
  await writeFile(manifestPath(skillDir), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

export async function manifestInstalledAt(skillDir: string): Promise<Date | null> {
  try {
    const s = await stat(manifestPath(skillDir));
    return s.mtime;
  } catch {
    return null;
  }
}

/** Format the source descriptor as the persisted `source` string. */
export function formatSourceString(source: ParsedSource): string {
  switch (source.kind) {
    case 'local':
      return source.path;
    case 'github':
      return source.subpath ? `${source.owner}/${source.repo}/${source.subpath}` : `${source.owner}/${source.repo}`;
    case 'gitlab':
      return source.subpath
        ? `gitlab:${source.owner}/${source.repo}/${source.subpath}`
        : `gitlab:${source.owner}/${source.repo}`;
    case 'git':
      return source.url;
    case 'well-known':
      return source.name;
  }
}

export function sourceUrl(source: ParsedSource): string | undefined {
  switch (source.kind) {
    case 'github':
      return `https://github.com/${source.owner}/${source.repo}`;
    case 'gitlab':
      return `https://gitlab.com/${source.owner}/${source.repo}`;
    case 'git':
      return source.url;
    default:
      return undefined;
  }
}
