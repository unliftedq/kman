import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackendUnavailableError, UserError } from '@kman/types';
import type { ParsedSource } from './source-parser.js';

/**
 * Result of "materializing" a source into a local directory ready for SKILL.md discovery.
 * `cleanup` removes any temporary directory created during fetch.
 */
export interface MaterializedSource {
  rootDir: string;
  /** Optional subpath inside rootDir (relative). */
  subpath: string | undefined;
  cleanup: () => Promise<void>;
}

/**
 * Resolve a parsed source to a local directory. Local paths are used directly;
 * GitHub/GitLab/git sources are cloned (shallow, optionally to a ref) into a tmp dir.
 * Well-known names map to canonical repos.
 */
export async function materialize(source: ParsedSource): Promise<MaterializedSource> {
  switch (source.kind) {
    case 'local':
      return { rootDir: source.path, subpath: source.subpath, cleanup: async () => {} };

    case 'github':
      return cloneGit(`https://github.com/${source.owner}/${source.repo}.git`, source.ref, source.subpath);

    case 'gitlab':
      return cloneGit(`https://gitlab.com/${source.owner}/${source.repo}.git`, source.ref, source.subpath);

    case 'git':
      return cloneGit(source.url, source.ref, source.subpath);

    case 'well-known': {
      const mapping: Record<string, string> = {
        'anthropic-skills': 'https://github.com/anthropics/skills.git',
      };
      const url = mapping[source.name];
      if (!url) throw new UserError(`Unknown well-known skill source "${source.name}".`);
      return cloneGit(url, source.ref, undefined);
    }

    default: {
      const exhaustive: never = source;
      void exhaustive;
      throw new UserError('Unsupported source kind.');
    }
  }
}

async function cloneGit(
  url: string,
  ref: string | undefined,
  subpath: string | undefined,
): Promise<MaterializedSource> {
  const dir = await mkdtemp(join(tmpdir(), 'delego-skill-'));
  // Shallow clone first; if a ref is provided, fetch + checkout it (works for branch/tag/sha).
  await runGit(['clone', '--depth', '1', url, dir]);
  if (ref) {
    try {
      await runGit(['fetch', '--depth', '1', 'origin', ref], dir);
      await runGit(['checkout', 'FETCH_HEAD'], dir);
    } catch {
      // Fallback: full fetch then checkout (covers commit SHAs not reachable via shallow ref fetch).
      await runGit(['fetch', '--unshallow'], dir).catch(() => {});
      await runGit(['checkout', ref], dir);
    }
  }
  return {
    rootDir: dir,
    subpath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

function runGit(args: string[], cwd?: string): Promise<void> {
  return new Promise<void>((res, rej) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        rej(new BackendUnavailableError('git not found on PATH; cannot fetch skill sources.'));
      } else {
        rej(err);
      }
    });
    child.on('exit', (code) => {
      if (code === 0) res();
      else rej(new UserError(`git ${args.join(' ')} failed: ${stderr.trim()}`));
    });
  });
}
