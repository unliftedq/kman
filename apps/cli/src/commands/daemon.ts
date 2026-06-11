import { spawn } from 'node:child_process';
import { Command } from 'commander';
import {
  Daemon,
  Tray,
  openLogsFolder,
  selectHost,
  type DaemonStatus,
  type TrayAction,
} from '@kman/daemon';
import { ExitCode, UserError } from '@kman/types';
import pkg from '../../package.json' with { type: 'json' };
import { createRunManager, daemonExec, getClient } from '../common/daemon-runtime.js';

export function buildDaemonCommand(): Command {
  const cmd = new Command('daemon').description(
    'Run and manage the kman daemon — a resident process that schedules agent tasks.',
  );

  cmd
    .command('run')
    .description('Run the daemon in the foreground (used by the OS host).')
    .option('--tray', 'Also show a system-tray menu (desktop platforms).')
    .action(async (opts: { tray?: boolean }) => {
      await runDaemon(opts.tray === true);
    });

  cmd
    .command('start')
    .description('Start the daemon in the background.')
    .option('--tray', 'Launch with a system-tray menu.')
    .action(async (opts: { tray?: boolean }) => {
      const existing = await getClient();
      if (existing) {
        process.stdout.write('kman daemon is already running.\n');
        return;
      }
      const exec = daemonExec(opts.tray ? ['--tray'] : []);
      const child = spawn(exec.command, exec.args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      const ok = await waitForHealth(5000);
      if (!ok) {
        throw new UserError('daemon did not become healthy within 5s; check logs.');
      }
      process.stdout.write('kman daemon started.\n');
    });

  cmd
    .command('stop')
    .description('Stop the running daemon.')
    .action(async () => {
      const client = await getClient();
      if (!client) {
        process.stdout.write('kman daemon is not running.\n');
        return;
      }
      await client.shutdown();
      process.stdout.write('kman daemon stopped.\n');
    });

  cmd
    .command('restart')
    .description('Restart the daemon.')
    .option('--tray', 'Launch with a system-tray menu.')
    .action(async (opts: { tray?: boolean }) => {
      const client = await getClient();
      if (client) {
        await client.shutdown();
        await waitForStopped(5000);
      }
      const exec = daemonExec(opts.tray ? ['--tray'] : []);
      const child = spawn(exec.command, exec.args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      if (!(await waitForHealth(5000))) {
        throw new UserError('daemon did not restart cleanly within 5s.');
      }
      process.stdout.write('kman daemon restarted.\n');
    });

  cmd
    .command('status')
    .description('Show daemon status.')
    .option('--json', 'Emit status as JSON.')
    .action(async (opts: { json?: boolean }) => {
      const client = await getClient();
      if (!client) {
        if (opts.json) process.stdout.write(JSON.stringify({ running: false }) + '\n');
        else process.stdout.write('kman daemon: not running\n');
        process.exit(ExitCode.Success);
      }
      const status = await client!.status();
      if (opts.json) {
        process.stdout.write(JSON.stringify(status, null, 2) + '\n');
      } else {
        process.stdout.write(formatStatus(status));
      }
    });

  cmd
    .command('install')
    .description('Register the daemon to start automatically at login (OS host).')
    .option('--start', 'Also start the daemon now.')
    .option('--tray', 'Use the tray host variant (desktop platforms).')
    .action(async (opts: { start?: boolean; tray?: boolean }) => {
      const host = selectHost(daemonExec(opts.tray ? ['--tray'] : []));
      await host.install();
      process.stdout.write(`Installed kman daemon host: ${host.label}.\n`);
      if (opts.start) {
        await host.start();
        process.stdout.write('Started via host.\n');
      }
    });

  cmd
    .command('uninstall')
    .description('Remove the daemon autostart registration.')
    .action(async () => {
      const host = selectHost(daemonExec());
      await host.uninstall();
      process.stdout.write(`Uninstalled kman daemon host: ${host.label}.\n`);
    });

  return cmd;
}

async function runDaemon(withTray: boolean): Promise<void> {
  const existing = await getClient();
  if (existing) {
    throw new UserError('kman daemon is already running.');
  }

  const daemon = new Daemon({
    runManager: createRunManager(),
    version: pkg.version,
    onShutdown: () => process.exit(0),
  });
  await daemon.start();

  let tray: Tray | undefined;
  if (withTray) {
    tray = new Tray({
      getStatus: async () => daemon.status(),
      onAction: (action: TrayAction) => handleTrayAction(action, daemon),
    });
    const started = await tray.start();
    if (!started) {
      process.stderr.write(
        'kman: tray helper not available (set KMAN_SYSTRAY_BIN); running headless.\n',
      );
    }
  }

  const shutdown = () => void daemon.shutdown();
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const endpoint = daemon.endpoint;
  const where = endpoint.kind === 'unix' ? endpoint.path : `127.0.0.1:${endpoint.port}`;
  process.stdout.write(`kman daemon running (pid ${process.pid}) on ${where}\n`);
}

function handleTrayAction(action: TrayAction, daemon: Daemon): void {
  switch (action) {
    case 'open-logs':
      openLogsFolder();
      break;
    case 'stop':
    case 'quit':
      void daemon.shutdown();
      break;
    default:
      break;
  }
}

function formatStatus(s: DaemonStatus): string {
  const { counts } = s;
  return (
    `kman daemon: running (pid ${s.pid}, v${s.version})\n` +
    `started: ${s.startedAt}\n` +
    `concurrency: ${s.maxConcurrent}\n` +
    `tasks: ${s.running} running, ${s.queued} queued ` +
    `(succeeded=${counts.succeeded} failed=${counts.failed} canceled=${counts.canceled})\n`
  );
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await getClient()) return true;
    await delay(150);
  }
  return false;
}

async function waitForStopped(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await getClient())) return;
    await delay(150);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
