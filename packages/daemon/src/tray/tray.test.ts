import { describe, expect, test } from 'bun:test';
import type { DaemonStatus } from '../protocol.js';
import { buildTrayMenu, openLogsCommand, Tray } from './tray.js';

const STATUS: DaemonStatus = {
  version: '1.0.0',
  pid: 4242,
  startedAt: '2026-01-01T00:00:00.000Z',
  maxConcurrent: 2,
  counts: { queued: 3, running: 1, succeeded: 0, failed: 0, canceled: 0 },
  running: 1,
  queued: 3,
};

describe('buildTrayMenu', () => {
  test('running daemon shows status, stop, logs, quit', () => {
    const menu = buildTrayMenu(STATUS);
    const actions = menu.map((m) => m.action);
    expect(actions).toContain('stop');
    expect(actions).toContain('open-logs');
    expect(actions).toContain('quit');
    expect(menu[0]?.title).toContain('pid 4242');
    expect(menu.some((m) => m.title.includes('1 running') && m.title.includes('3 queued'))).toBe(true);
  });

  test('absent daemon offers start instead of stop', () => {
    const menu = buildTrayMenu(undefined);
    const actions = menu.map((m) => m.action);
    expect(actions).toContain('start');
    expect(actions).not.toContain('stop');
    expect(menu[0]?.title).toContain('not running');
  });

  test('status/header rows are disabled, action rows enabled', () => {
    const menu = buildTrayMenu(STATUS);
    const header = menu.find((m) => m.action === 'none');
    const stop = menu.find((m) => m.action === 'stop');
    expect(header?.enabled).toBe(false);
    expect(stop?.enabled).toBe(true);
  });
});

describe('openLogsCommand', () => {
  test('uses the platform file manager', () => {
    expect(openLogsCommand('darwin').command).toBe('open');
    expect(openLogsCommand('win32').command).toBe('explorer');
    expect(openLogsCommand('linux').command).toBe('xdg-open');
  });
});

describe('Tray availability', () => {
  test('is unavailable with no helper binary configured', async () => {
    const tray = new Tray({ getStatus: async () => undefined, onAction: () => {} });
    // No KMAN_SYSTRAY_BIN set in this test context unless the env has it.
    if (!process.env['KMAN_SYSTRAY_BIN']) {
      expect(tray.available).toBe(false);
      expect(await tray.start()).toBe(false);
    }
  });

  test('reports available when a binary is provided', () => {
    const tray = new Tray({ getStatus: async () => undefined, onAction: () => {}, binary: '/bin/true' });
    expect(tray.available).toBe(true);
  });
});
