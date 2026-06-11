import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { daemonHome } from '../paths.js';
import type { DaemonExec, Host, HostStatus } from './host.js';

const exec = promisify(execFile);

export const LAUNCHD_LABEL = 'me.kman.daemon';

export function launchdPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

/** Render the launchd agent plist. Pure. */
export function launchdPlistText(daemonExec: DaemonExec, label = LAUNCHD_LABEL): string {
  const args = [daemonExec.command, ...daemonExec.args]
    .map((a) => `    <string>${escapeXml(a)}</string>`)
    .join('\n');
  const logDir = daemonHome();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${label}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    args,
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict><key>SuccessfulExit</key><false/></dict>',
    '  <key>StandardOutPath</key>',
    `  <string>${escapeXml(join(logDir, 'launchd.out.log'))}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${escapeXml(join(logDir, 'launchd.err.log'))}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** macOS host backed by a launchd LaunchAgent that runs the daemon at login. */
export class LaunchdHost implements Host {
  readonly name = 'launchd';
  readonly label = 'launchd (LaunchAgent)';
  constructor(private readonly daemonExec: DaemonExec) {}

  async install(): Promise<void> {
    const path = launchdPlistPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, launchdPlistText(this.daemonExec));
    await exec('launchctl', ['load', '-w', path]).catch(() => {});
  }

  async uninstall(): Promise<void> {
    const path = launchdPlistPath();
    await exec('launchctl', ['unload', '-w', path]).catch(() => {});
    await rm(path, { force: true });
  }

  async start(): Promise<void> {
    await exec('launchctl', ['start', LAUNCHD_LABEL]);
  }

  async stop(): Promise<void> {
    await exec('launchctl', ['stop', LAUNCHD_LABEL]);
  }

  async status(): Promise<HostStatus> {
    try {
      const { stdout } = await exec('launchctl', ['list']);
      const line = stdout.split('\n').find((l) => l.includes(LAUNCHD_LABEL));
      const running = !!line && !line.trim().startsWith('-');
      return { installed: !!line, running, ...(line ? { detail: line.trim() } : {}) };
    } catch {
      return { installed: false, running: false };
    }
  }
}
