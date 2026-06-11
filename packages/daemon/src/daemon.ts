import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type {
  DaemonState,
  DaemonStatus,
  IpcEndpoint,
  ListTasksQuery,
  SubmitTaskRequest,
  TaskRecord,
} from './protocol.js';
import { DEFAULT_MAX_CONCURRENT } from './protocol.js';
import { daemonHome, pidPath } from './paths.js';
import { Scheduler } from './scheduler/scheduler.js';
import { TaskStore } from './store/task-store.js';
import type { RunManager } from './run/types.js';
import type { DaemonApi } from './server/api.js';
import { IpcServer } from './server/ipc-server.js';
import { clearState, STATE_SCHEMA_VERSION, writeState } from './state.js';

export interface DaemonOptions {
  /** How runs are actually executed. The CLI injects a CoreRunManager; tests inject a fake. */
  runManager: RunManager;
  /** kman version string, surfaced in status/state. */
  version: string;
  maxConcurrent?: number;
  perAgentMax?: number;
  /** Bind override (defaults to the platform default endpoint). */
  endpoint?: IpcEndpoint;
  /** Base dir for state/tasks/logs (defaults to ~/.kman/daemon). Tests point this at a temp dir. */
  baseDir?: string;
  /** Auth token override (defaults to a random one). */
  token?: string;
  /** Called after a graceful shutdown completes, e.g. to exit the process. */
  onShutdown?: () => void;
}

/**
 * The resident process: owns the task store, scheduler, run manager, and the
 * IPC control plane, and implements the DaemonApi the server exposes. Start
 * wires everything and recovers interrupted tasks; shutdown tears it down and
 * removes the on-disk pid/state so a fresh start is unobstructed.
 */
export class Daemon implements DaemonApi {
  readonly token: string;
  private readonly version: string;
  private readonly maxConcurrent: number;
  private readonly baseDir: string;
  private readonly store: TaskStore;
  private readonly scheduler: Scheduler;
  private readonly server: IpcServer;
  private readonly onShutdown?: () => void;
  private startedAt = '';
  private shuttingDown = false;

  constructor(opts: DaemonOptions) {
    this.token = opts.token ?? randomUUID().replace(/-/g, '');
    this.version = opts.version;
    this.maxConcurrent = opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.baseDir = opts.baseDir ?? daemonHome();
    this.onShutdown = opts.onShutdown;

    this.store = new TaskStore({ tasksDir: join(this.baseDir, 'tasks') });
    this.scheduler = new Scheduler({
      store: this.store,
      runManager: opts.runManager,
      maxConcurrent: this.maxConcurrent,
      ...(opts.perAgentMax !== undefined ? { perAgentMax: opts.perAgentMax } : {}),
    });
    this.server = new IpcServer({ api: this, ...(opts.endpoint ? { endpoint: opts.endpoint } : {}) });
  }

  /** Resolved control-plane endpoint (valid after start()). */
  get endpoint(): IpcEndpoint {
    return this.server.resolvedEndpoint;
  }

  /** Test-only: resolve once pending scheduler completion-processing has drained. */
  settle(): Promise<void> {
    return this.scheduler.settle();
  }

  async start(): Promise<void> {
    this.startedAt = new Date().toISOString();
    await this.store.load();
    await this.store.reconcile();
    await this.server.start();

    const state: DaemonState = {
      schemaVersion: STATE_SCHEMA_VERSION,
      version: this.version,
      pid: process.pid,
      startedAt: this.startedAt,
      token: this.token,
      endpoint: this.server.resolvedEndpoint,
    };
    await writeState(state, join(this.baseDir, 'state.json'));
    await this.writePid();

    // Resume any reconciled/queued work.
    await this.scheduler.kick();
  }

  // ---- DaemonApi ----------------------------------------------------------

  status(): DaemonStatus {
    const counts = this.store.counts();
    return {
      version: this.version,
      pid: process.pid,
      startedAt: this.startedAt,
      maxConcurrent: this.maxConcurrent,
      counts,
      running: counts.running,
      queued: counts.queued,
    };
  }

  async submit(req: SubmitTaskRequest): Promise<TaskRecord> {
    if (!req.agent || !req.task) {
      throw new Error('agent and task are required');
    }
    const rec = await this.store.create(req);
    await this.scheduler.kick();
    return rec;
  }

  list(query: ListTasksQuery): TaskRecord[] {
    return this.store.list(query);
  }

  get(id: string): TaskRecord | undefined {
    return this.store.get(id);
  }

  async logs(id: string): Promise<string | undefined> {
    const rec = this.store.get(id);
    if (!rec) return undefined;
    const path = isAbsolute(rec.logFile) ? rec.logFile : join(this.baseDir, rec.logFile);
    try {
      return await readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw err;
    }
  }

  async cancel(id: string): Promise<boolean> {
    return this.scheduler.cancel(id);
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.scheduler.stop();
    await this.server.stop();
    await clearState(join(this.baseDir, 'state.json'));
    await this.removePid();
    // Defer the exit hook so the in-flight /shutdown response can flush.
    if (this.onShutdown) setTimeout(() => this.onShutdown!(), 50);
  }

  private async writePid(): Promise<void> {
    const path = this.pidFile();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, String(process.pid));
  }

  private async removePid(): Promise<void> {
    await rm(this.pidFile(), { force: true });
  }

  private pidFile(): string {
    return this.baseDir === daemonHome() ? pidPath() : join(this.baseDir, 'daemon.pid');
  }
}
