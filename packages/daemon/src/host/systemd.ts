import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { DaemonExec, Host, HostStatus } from './host.js';

const exec = promisify(execFile);

export const SYSTEMD_UNIT_NAME = 'kman-daemon.service';

/** Path to the per-user systemd unit. */
export function systemdUnitPath(): string {
  const base = process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config');
  return join(base, 'systemd', 'user', SYSTEMD_UNIT_NAME);
}

/** Render the systemd user unit. Pure — the actual exec line is quoted from `daemonExec`. */
export function systemdUnitText(daemonExec: DaemonExec): string {
  const cmd = [daemonExec.command, ...daemonExec.args].map(quoteArg).join(' ');
  return [
    '[Unit]',
    'Description=kman agent daemon',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${cmd}`,
    'Restart=on-failure',
    'RestartSec=2',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

/** Quote an arg for a systemd ExecStart line if it contains whitespace. */
function quoteArg(arg: string): string {
  return /\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

/** Linux host backed by a systemd --user service. */
export class SystemdHost implements Host {
  readonly name = 'systemd';
  readonly label = 'systemd (user service)';
  constructor(private readonly daemonExec: DaemonExec) {}

  async install(): Promise<void> {
    const path = systemdUnitPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, systemdUnitText(this.daemonExec));
    await this.systemctl('daemon-reload');
    await this.systemctl('enable', SYSTEMD_UNIT_NAME);
  }

  async uninstall(): Promise<void> {
    await this.systemctl('disable', SYSTEMD_UNIT_NAME).catch(() => {});
    await this.systemctl('stop', SYSTEMD_UNIT_NAME).catch(() => {});
    await rm(systemdUnitPath(), { force: true });
    await this.systemctl('daemon-reload').catch(() => {});
  }

  async start(): Promise<void> {
    await this.systemctl('start', SYSTEMD_UNIT_NAME);
  }

  async stop(): Promise<void> {
    await this.systemctl('stop', SYSTEMD_UNIT_NAME);
  }

  async status(): Promise<HostStatus> {
    const active = await this.systemctl('is-active', SYSTEMD_UNIT_NAME)
      .then((r) => r.stdout.trim())
      .catch((e: { stdout?: string }) => (e.stdout ?? 'inactive').trim());
    const enabled = await this.systemctl('is-enabled', SYSTEMD_UNIT_NAME)
      .then((r) => r.stdout.trim())
      .catch((e: { stdout?: string }) => (e.stdout ?? 'disabled').trim());
    return {
      installed: enabled === 'enabled' || enabled === 'static',
      running: active === 'active',
      detail: `is-active=${active} is-enabled=${enabled}`,
    };
  }

  private systemctl(...args: string[]): Promise<{ stdout: string; stderr: string }> {
    return exec('systemctl', ['--user', ...args]);
  }
}
