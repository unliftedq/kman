import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { DaemonExec, Host, HostStatus } from './host.js';

const exec = promisify(execFile);

export const WINDOWS_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
export const WINDOWS_RUN_VALUE = 'KmanDaemon';

/**
 * Build the command-line string stored under the registry Run key. Args
 * containing spaces are double-quoted, matching how Windows parses the value.
 */
export function windowsRunCommandValue(daemonExec: DaemonExec): string {
  return [daemonExec.command, ...daemonExec.args]
    .map((a) => (/\s/.test(a) ? `"${a}"` : a))
    .join(' ');
}

/** `reg add` argument vector for registering autostart. */
export function windowsRegAddArgs(daemonExec: DaemonExec): string[] {
  return [
    'add',
    WINDOWS_RUN_KEY,
    '/v',
    WINDOWS_RUN_VALUE,
    '/t',
    'REG_SZ',
    '/d',
    windowsRunCommandValue(daemonExec),
    '/f',
  ];
}

/**
 * Windows host. Autostart is a per-user registry Run-key entry that launches the
 * daemon (with its tray) at login; no admin rights or service wrapper needed.
 * Day-to-day start/stop also go through `kman daemon start|stop`, but start()
 * here spawns the daemon detached so `kman daemon install --start` works too.
 */
export class WindowsHost implements Host {
  readonly name = 'windows';
  readonly label = 'Windows (registry autostart + tray)';
  constructor(private readonly daemonExec: DaemonExec) {}

  async install(): Promise<void> {
    await exec('reg', windowsRegAddArgs(this.daemonExec));
  }

  async uninstall(): Promise<void> {
    await exec('reg', ['delete', WINDOWS_RUN_KEY, '/v', WINDOWS_RUN_VALUE, '/f']).catch(() => {});
  }

  async start(): Promise<void> {
    const child = spawn(this.daemonExec.command, this.daemonExec.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }

  async stop(): Promise<void> {
    // The cross-platform path is `kman daemon stop` (graceful IPC shutdown).
    // Nothing host-specific to do here.
  }

  async status(): Promise<HostStatus> {
    try {
      const { stdout } = await exec('reg', ['query', WINDOWS_RUN_KEY, '/v', WINDOWS_RUN_VALUE]);
      return { installed: stdout.includes(WINDOWS_RUN_VALUE), running: false, detail: 'autostart registered' };
    } catch {
      return { installed: false, running: false };
    }
  }
}
