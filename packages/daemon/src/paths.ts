import { join } from 'node:path';
import { kmanHome } from '@kman/core';
import type { IpcEndpoint } from './protocol.js';

/**
 * All daemon state lives under ~/.kman/daemon/ (honoring KMAN_HOME via
 * @kman/core's kmanHome()). Keeping it a sibling of agents/ means the whole
 * kman state tree is still one inspectable, relocatable directory.
 */
export function daemonHome(): string {
  return join(kmanHome(), 'daemon');
}

/** Per-task JSON records: tasks/<id>.json. */
export function tasksDir(): string {
  return join(daemonHome(), 'tasks');
}

export function taskRecordPath(id: string): string {
  return join(tasksDir(), `${id}.json`);
}

/** Captured stdout+stderr per run: logs/<id>.log. */
export function logsDir(): string {
  return join(daemonHome(), 'logs');
}

export function taskLogPath(id: string): string {
  return join(logsDir(), `${id}.log`);
}

/** Daemon meta + auth token. */
export function statePath(): string {
  return join(daemonHome(), 'state.json');
}

/** PID file written by the running daemon. */
export function pidPath(): string {
  return join(daemonHome(), 'daemon.pid');
}

/** Unix-domain socket path used on macOS/Linux. */
export function unixSocketPath(): string {
  return join(daemonHome(), 'sock');
}

/**
 * The endpoint the daemon should bind by default. POSIX uses a Unix socket;
 * Windows uses TCP loopback with an ephemeral port (0 → OS-assigned), because
 * Bun's named pipes leak across restarts. The real port is discovered at bind
 * time and written into state.json for the client to read.
 */
export function defaultBindEndpoint(): IpcEndpoint {
  if (process.platform === 'win32') {
    return { kind: 'tcp', host: '127.0.0.1', port: 0 };
  }
  return { kind: 'unix', path: unixSocketPath() };
}
