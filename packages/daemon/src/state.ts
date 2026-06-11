import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DaemonState } from './protocol.js';
import { statePath } from './paths.js';

export const STATE_SCHEMA_VERSION = 1;

/** Write the daemon's connection + identity info atomically. */
export async function writeState(state: DaemonState, path = statePath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  const { rename } = await import('node:fs/promises');
  await rename(tmp, path);
}

/** Read state.json, or undefined if the daemon has never written one. */
export async function readState(path = statePath()): Promise<DaemonState | undefined> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as DaemonState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/** Remove state.json (called on clean shutdown). */
export async function clearState(path = statePath()): Promise<void> {
  await rm(path, { force: true });
}
