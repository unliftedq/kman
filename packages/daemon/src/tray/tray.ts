import { spawn, type ChildProcess } from 'node:child_process';
import type { DaemonStatus } from '../protocol.js';
import { logsDir } from '../paths.js';

/** What a menu click maps to. The daemon's tray loop dispatches on this. */
export type TrayAction = 'none' | 'status' | 'open-logs' | 'start' | 'stop' | 'quit';

export interface TrayMenuItem {
  title: string;
  enabled: boolean;
  action: TrayAction;
}

/**
 * Pure mapping from daemon status to the tray menu. Kept separate from any
 * native widget so it can be unit-tested; the systray driver just renders
 * whatever this returns. `undefined` status means the daemon isn't reachable.
 */
export function buildTrayMenu(status: DaemonStatus | undefined): TrayMenuItem[] {
  if (!status) {
    return [
      { title: 'kman daemon: not running', enabled: false, action: 'none' },
      { title: 'Start daemon', enabled: true, action: 'start' },
      { title: 'Open logs folder', enabled: true, action: 'open-logs' },
      { title: 'Quit tray', enabled: true, action: 'quit' },
    ];
  }
  return [
    { title: `kman daemon: running (pid ${status.pid})`, enabled: false, action: 'none' },
    {
      title: `Tasks: ${status.running} running · ${status.queued} queued`,
      enabled: false,
      action: 'status',
    },
    { title: 'Open logs folder', enabled: true, action: 'open-logs' },
    { title: 'Stop daemon', enabled: true, action: 'stop' },
    { title: 'Quit tray', enabled: true, action: 'quit' },
  ];
}

/** Command used to reveal the logs folder in the OS file manager. */
export function openLogsCommand(platform: NodeJS.Platform = process.platform): {
  command: string;
  args: string[];
} {
  const dir = logsDir();
  switch (platform) {
    case 'darwin':
      return { command: 'open', args: [dir] };
    case 'win32':
      return { command: 'explorer', args: [dir] };
    default:
      return { command: 'xdg-open', args: [dir] };
  }
}

/** Reveal the logs folder using the platform file manager (best-effort). */
export function openLogsFolder(platform: NodeJS.Platform = process.platform): void {
  const { command, args } = openLogsCommand(platform);
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    /* best-effort: a missing file manager shouldn't crash the tray */
  }
}

/** Resolve the systray helper binary, or undefined if none is configured/available. */
export function resolveSystrayBinary(): string | undefined {
  const explicit = process.env['KMAN_SYSTRAY_BIN'];
  return explicit && explicit.length > 0 ? explicit : undefined;
}

export interface TrayOptions {
  getStatus: () => Promise<DaemonStatus | undefined>;
  onAction: (action: TrayAction) => void | Promise<void>;
  /** Override the systray binary (tests). */
  binary?: string;
}

/**
 * Thin driver for a `systray`-style helper binary spoken over stdio (JSON lines).
 * When no helper binary is configured the tray is unavailable and the daemon
 * simply runs headless — `start()` returns false rather than throwing. The
 * native rendering path cannot be exercised in a headless CI environment; the
 * tested surface is `buildTrayMenu` and the action/command mappings above.
 */
export class Tray {
  private child?: ChildProcess;
  private readonly opts: TrayOptions;
  private readonly binary?: string;

  constructor(opts: TrayOptions) {
    this.opts = opts;
    const bin = opts.binary ?? resolveSystrayBinary();
    if (bin) this.binary = bin;
  }

  /** True if a systray helper is available to drive. */
  get available(): boolean {
    return this.binary !== undefined;
  }

  /** Launch the helper and render the initial menu. Returns false if unavailable. */
  async start(): Promise<boolean> {
    if (!this.binary) return false;
    this.child = spawn(this.binary, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    await this.render();
    this.child.stdout?.on('data', (buf: Buffer) => this.onMessage(buf));
    return true;
  }

  stop(): void {
    this.child?.kill();
    this.child = undefined;
  }

  /** Re-query status and push an updated menu to the helper. */
  async render(): Promise<void> {
    if (!this.child?.stdin) return;
    const status = await this.opts.getStatus();
    const menu = buildTrayMenu(status);
    this.lastMenu = menu;
    this.child.stdin.write(JSON.stringify({ type: 'menu', items: menu }) + '\n');
  }

  private onMessage(buf: Buffer): void {
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as { type?: string; index?: number };
        if (msg.type === 'click' && typeof msg.index === 'number') {
          const items = this.lastMenu;
          const item = items?.[msg.index];
          if (item) void this.opts.onAction(item.action);
        }
      } catch {
        /* ignore malformed helper output */
      }
    }
  }

  // Cache of the last rendered menu so a click index can be mapped to an action.
  private lastMenu: TrayMenuItem[] | undefined;
}
