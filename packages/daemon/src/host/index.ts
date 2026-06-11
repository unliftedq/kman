import type { DaemonExec, Host } from './host.js';
import { SystemdHost } from './systemd.js';
import { LaunchdHost } from './launchd.js';
import { WindowsHost } from './winsvc.js';

export * from './host.js';
export * from './systemd.js';
export * from './launchd.js';
export * from './winsvc.js';

export type HostKind = 'systemd' | 'launchd' | 'windows';

/** Pick the host implementation for a platform (defaults to the current one). */
export function selectHost(
  daemonExec: DaemonExec,
  platform: NodeJS.Platform = process.platform,
): Host {
  switch (platform) {
    case 'darwin':
      return new LaunchdHost(daemonExec);
    case 'win32':
      return new WindowsHost(daemonExec);
    default:
      // linux and other unixes use systemd --user.
      return new SystemdHost(daemonExec);
  }
}
