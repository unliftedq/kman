import { describe, expect, test } from 'bun:test';
import type { DaemonExec } from './host.js';
import { systemdUnitText, SystemdHost } from './systemd.js';
import { launchdPlistText, LaunchdHost, LAUNCHD_LABEL } from './launchd.js';
import {
  windowsRunCommandValue,
  windowsRegAddArgs,
  WindowsHost,
  WINDOWS_RUN_VALUE,
} from './winsvc.js';
import { selectHost } from './index.js';

const EXEC: DaemonExec = { command: 'kman', args: ['daemon', 'run'] };
const EXEC_SPACED: DaemonExec = { command: '/opt/My Apps/kman', args: ['daemon', 'run', '--tray'] };

describe('systemdUnitText', () => {
  test('produces a valid user unit with the exec line', () => {
    const unit = systemdUnitText(EXEC);
    expect(unit).toContain('[Service]');
    expect(unit).toContain('ExecStart=kman daemon run');
    expect(unit).toContain('WantedBy=default.target');
    expect(unit).toContain('Restart=on-failure');
  });

  test('quotes a command path containing spaces', () => {
    const unit = systemdUnitText(EXEC_SPACED);
    expect(unit).toContain('ExecStart="/opt/My Apps/kman" daemon run --tray');
  });
});

describe('launchdPlistText', () => {
  test('emits ProgramArguments and RunAtLoad', () => {
    const plist = launchdPlistText(EXEC);
    expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<string>kman</string>');
    expect(plist).toContain('<string>daemon</string>');
    expect(plist).toContain('<string>run</string>');
  });

  test('escapes XML metacharacters in args', () => {
    const plist = launchdPlistText({ command: 'kman', args: ['--flag', 'a&b<c>'] });
    expect(plist).toContain('a&amp;b&lt;c&gt;');
  });
});

describe('windows registry autostart', () => {
  test('builds a Run-key command value, quoting spaced args', () => {
    expect(windowsRunCommandValue(EXEC)).toBe('kman daemon run');
    expect(windowsRunCommandValue(EXEC_SPACED)).toBe('"/opt/My Apps/kman" daemon run --tray');
  });

  test('reg add args target the per-user Run key', () => {
    const args = windowsRegAddArgs(EXEC);
    expect(args[0]).toBe('add');
    expect(args).toContain(WINDOWS_RUN_VALUE);
    expect(args).toContain('/f');
  });
});

describe('selectHost', () => {
  test('maps platforms to host implementations', () => {
    expect(selectHost(EXEC, 'linux')).toBeInstanceOf(SystemdHost);
    expect(selectHost(EXEC, 'darwin')).toBeInstanceOf(LaunchdHost);
    expect(selectHost(EXEC, 'win32')).toBeInstanceOf(WindowsHost);
    // Unknown unixes fall back to systemd.
    expect(selectHost(EXEC, 'freebsd')).toBeInstanceOf(SystemdHost);
  });

  test('host names are stable identifiers', () => {
    expect(selectHost(EXEC, 'linux').name).toBe('systemd');
    expect(selectHost(EXEC, 'darwin').name).toBe('launchd');
    expect(selectHost(EXEC, 'win32').name).toBe('windows');
  });
});
