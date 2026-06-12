import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ListTasksQuery, SubmitTaskRequest, TaskRecord, TaskStatus } from '../protocol.js';
import { tasksDir as defaultTasksDir } from '../paths.js';

const TERMINAL: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'succeeded',
  'failed',
  'canceled',
]);

export interface TaskStoreOptions {
  /** Directory holding tasks/<id>.json. Defaults to the daemon home tasks dir. */
  tasksDir?: string;
}

/**
 * Durable task records, backed by one JSON file per task. Reads load the whole
 * set into an in-memory index (the working set is small — these are user tasks,
 * not events), and writes go through a temp-file + rename so a crash never
 * leaves a half-written record on disk.
 */
export class TaskStore {
  private readonly dir: string;
  private readonly index = new Map<string, TaskRecord>();
  private nextSeq = 1;

  constructor(opts: TaskStoreOptions = {}) {
    this.dir = opts.tasksDir ?? defaultTasksDir();
  }

  /** Load every persisted record into memory. Safe to call once at boot. */
  async load(): Promise<void> {
    this.index.clear();
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    let maxSeq = 0;
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(this.dir, name), 'utf8');
        const rec = JSON.parse(raw) as TaskRecord;
        if (!rec || typeof rec.id !== 'string') continue;
        this.index.set(rec.id, rec);
        if (typeof rec.seq === 'number' && rec.seq > maxSeq) maxSeq = rec.seq;
      } catch {
        // Skip unreadable/corrupt files rather than refusing to start.
        continue;
      }
    }
    this.nextSeq = maxSeq + 1;
  }

  async create(input: SubmitTaskRequest): Promise<TaskRecord> {
    const id = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const rec: TaskRecord = {
      id,
      seq: this.nextSeq++,
      agent: input.agent,
      task: input.task,
      status: 'queued',
      priority: input.priority ?? 0,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 1,
      createdAt: new Date().toISOString(),
      logFile: join('logs', `${id}.log`),
      ...(input.runtime !== undefined ? { runtime: input.runtime } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.permission !== undefined ? { permission: input.permission } : {}),
      ...(input.outputFormat !== undefined ? { outputFormat: input.outputFormat } : {}),
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      ...(input.parentTaskId !== undefined ? { parentTaskId: input.parentTaskId } : {}),
    };
    this.index.set(id, rec);
    await this.persist(rec);
    return rec;
  }

  get(id: string): TaskRecord | undefined {
    return this.index.get(id);
  }

  list(query: ListTasksQuery = {}): TaskRecord[] {
    let out = [...this.index.values()];
    if (query.status) out = out.filter((r) => r.status === query.status);
    // Stable, human-friendly ordering: newest-submitted first.
    return out.sort((a, b) => b.seq - a.seq);
  }

  async update(id: string, patch: Partial<TaskRecord>): Promise<TaskRecord> {
    const existing = this.index.get(id);
    if (!existing) throw new Error(`unknown task: ${id}`);
    const next: TaskRecord = { ...existing, ...patch, id: existing.id, seq: existing.seq };
    this.index.set(id, next);
    await this.persist(next);
    return next;
  }

  counts(): Record<TaskStatus, number> {
    const c: Record<TaskStatus, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      canceled: 0,
    };
    for (const r of this.index.values()) c[r.status]++;
    return c;
  }

  /**
   * Boot recovery: a task left `running` means the daemon died mid-flight, so
   * its child is gone. Re-queue it if attempts remain, otherwise mark it failed.
   * Returns the ids that changed.
   */
  async reconcile(): Promise<string[]> {
    const affected: string[] = [];
    for (const rec of this.index.values()) {
      if (rec.status !== 'running') continue;
      affected.push(rec.id);
      if (rec.attempts < rec.maxAttempts) {
        await this.update(rec.id, { status: 'queued' });
      } else {
        await this.update(rec.id, {
          status: 'failed',
          error: 'daemon restarted while task was running',
          finishedAt: new Date().toISOString(),
        });
      }
    }
    return affected;
  }

  /** True if the status is one a task never leaves. */
  static isTerminal(status: TaskStatus): boolean {
    return TERMINAL.has(status);
  }

  private async persist(rec: TaskRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const final = join(this.dir, `${rec.id}.json`);
    const tmp = `${final}.${process.pid}.${this.writeSeq++}.tmp`;
    await writeFile(tmp, JSON.stringify(rec, null, 2));
    await renameWithRetry(tmp, final);
  }

  private writeSeq = 0;
}

/**
 * rename is atomic on POSIX, but on Windows replacing an existing file can throw
 * a transient EPERM/EACCES when an indexer or AV scanner briefly holds a handle.
 * Retry a few times with a short backoff before giving up.
 */
async function renameWithRetry(from: string, to: string, attempts = 10): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code === 'EPERM' || code === 'EACCES') && i < attempts) {
        await new Promise((r) => setTimeout(r, 5 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
}
