/**
 * How the OS launches the daemon. `command` is the executable (e.g. `kman` or
 * an absolute path to a launcher) and `args` are appended (typically
 * `['daemon', 'run']`, plus `--tray` on desktop platforms).
 */
export interface DaemonExec {
  command: string;
  args: string[];
}

export interface HostStatus {
  /** The OS-level autostart unit/entry exists. */
  installed: boolean;
  /** The daemon is currently running under this host. */
  running: boolean;
  /** Human-readable extra detail (e.g. raw `systemctl status` summary). */
  detail?: string;
}

/**
 * A platform integration that owns the daemon's lifecycle at the OS level:
 * systemd user service (Linux), launchd agent + tray (macOS), registry
 * autostart + tray (Windows). Each method maps to a `kman daemon install/...`
 * subcommand.
 */
export interface Host {
  /** Stable identifier: 'systemd' | 'launchd' | 'windows'. */
  readonly name: string;
  /** Human label for messages. */
  readonly label: string;
  /** Register autostart so the daemon launches on login. Idempotent. */
  install(): Promise<void>;
  /** Remove the autostart registration. Idempotent. */
  uninstall(): Promise<void>;
  /** Start the daemon now via the host manager. */
  start(): Promise<void>;
  /** Stop the daemon now via the host manager. */
  stop(): Promise<void>;
  status(): Promise<HostStatus>;
}
