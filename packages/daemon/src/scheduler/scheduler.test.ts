import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore } from '../store/task-store.js';
import type { RunHandle, RunManager, RunOutcome } from '../run/types.js';
import type { TaskRecord } from '../protocol.js';
import { Scheduler } from './scheduler.js';

/**
 * A RunManager whose runs only finish when the test says so. Records start order
 * and whether each run was asked to cancel.
 */
class FakeRunManager implements RunManager {
  readonly started: string[] = [];
  readonly canceled = new Set<string>();
  private readonly resolvers = new Map<string, (o: RunOutcome) => void>();

  start(rec: TaskRecord): RunHandle {
    this.started.push(rec.id);
    let resolve!: (o: RunOutcome) => void;
    const done = new Promise<RunOutcome>((r) => {
      resolve = r;
    });
    this.resolvers.set(rec.id, resolve);
    return {
      done,
      cancel: () => {
        this.canceled.add(rec.id);
      },
    };
  }

  finish(id: string, outcome: RunOutcome): void {
    const r = this.resolvers.get(id);
    if (!r) throw new Error(`no running task ${id}`);
    this.resolvers.delete(id);
    r(outcome);
  }
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kman-sched-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function setup(opts: { maxConcurrent: number; perAgentMax?: number }) {
  const store = new TaskStore({ tasksDir: join(dir, 'tasks') });
  await store.load();
  const runManager = new FakeRunManager();
  const scheduler = new Scheduler({
    store,
    runManager,
    maxConcurrent: opts.maxConcurrent,
    ...(opts.perAgentMax !== undefined ? { perAgentMax: opts.perAgentMax } : {}),
    backoffMs: () => 0,
    setTimer: (fn) => fn(), // immediate retry
  });
  return { store, runManager, scheduler };
}

describe('Scheduler', () => {
  test('starts only up to maxConcurrent and queues the rest', async () => {
    const { store, runManager, scheduler } = await setup({ maxConcurrent: 2 });
    const a = await store.create({ agent: 'x', task: 't' });
    const b = await store.create({ agent: 'x', task: 't' });
    const c = await store.create({ agent: 'x', task: 't' });

    await scheduler.kick();

    expect(runManager.started).toEqual([a.id, b.id]);
    expect(store.get(c.id)?.status).toBe('queued');
    expect(store.get(a.id)?.status).toBe('running');
    expect(store.get(a.id)?.attempts).toBe(1);
  });

  test('dequeues the next task when a running one succeeds', async () => {
    const { store, runManager, scheduler } = await setup({ maxConcurrent: 1 });
    const a = await store.create({ agent: 'x', task: 't' });
    const b = await store.create({ agent: 'x', task: 't' });

    await scheduler.kick();
    expect(runManager.started).toEqual([a.id]);

    runManager.finish(a.id, { exitCode: 0 });
    await scheduler.settle();

    expect(store.get(a.id)?.status).toBe('succeeded');
    expect(runManager.started).toEqual([a.id, b.id]);
    expect(store.get(b.id)?.status).toBe('running');
  });

  test('respects priority ordering when selecting', async () => {
    const { store, runManager, scheduler } = await setup({ maxConcurrent: 1 });
    const normal = await store.create({ agent: 'x', task: 't' }); // seq 1, priority 0
    const low = await store.create({ agent: 'x', task: 't', priority: 0 }); // seq 2
    const high = await store.create({ agent: 'x', task: 't', priority: 9 }); // seq 3

    // Highest priority runs first, even though it was submitted last.
    await scheduler.kick();
    expect(runManager.started).toEqual([high.id]);

    runManager.finish(high.id, { exitCode: 0 });
    await scheduler.settle();
    // Then FIFO among equal priority: the earlier-submitted one.
    expect(runManager.started).toEqual([high.id, normal.id]);

    runManager.finish(normal.id, { exitCode: 0 });
    await scheduler.settle();
    expect(runManager.started).toEqual([high.id, normal.id, low.id]);
  });

  test('retries a failed task until maxAttempts then fails', async () => {
    const { store, runManager, scheduler } = await setup({ maxConcurrent: 1 });
    const a = await store.create({ agent: 'x', task: 't', maxAttempts: 2 });

    await scheduler.kick();
    expect(store.get(a.id)?.attempts).toBe(1);

    runManager.finish(a.id, { exitCode: 1, error: 'boom' });
    await scheduler.settle();
    // Retried: started again, attempts now 2, still running.
    expect(store.get(a.id)?.attempts).toBe(2);
    expect(store.get(a.id)?.status).toBe('running');
    expect(runManager.started.filter((x) => x === a.id).length).toBe(2);

    runManager.finish(a.id, { exitCode: 1, error: 'boom again' });
    await scheduler.settle();
    expect(store.get(a.id)?.status).toBe('failed');
    expect(store.get(a.id)?.exitCode).toBe(1);
  });

  test('cancel removes a queued task without starting it', async () => {
    const { store, runManager, scheduler } = await setup({ maxConcurrent: 1 });
    const a = await store.create({ agent: 'x', task: 't' });
    const b = await store.create({ agent: 'x', task: 't' });
    await scheduler.kick();

    const ok = await scheduler.cancel(b.id);
    expect(ok).toBe(true);
    expect(store.get(b.id)?.status).toBe('canceled');
    expect(runManager.started).toEqual([a.id]);
  });

  test('cancel asks a running task to stop and marks it canceled (no retry)', async () => {
    const { store, runManager, scheduler } = await setup({ maxConcurrent: 1 });
    const a = await store.create({ agent: 'x', task: 't', maxAttempts: 3 });
    await scheduler.kick();

    await scheduler.cancel(a.id);
    expect(runManager.canceled.has(a.id)).toBe(true);

    // The child exits non-zero due to the signal; must NOT be retried.
    runManager.finish(a.id, { exitCode: 130, error: 'SIGTERM' });
    await scheduler.settle();
    expect(store.get(a.id)?.status).toBe('canceled');
  });

  test('per-agent cap lets a second agent run while one agent is busy', async () => {
    const { store, runManager, scheduler } = await setup({ maxConcurrent: 5, perAgentMax: 1 });
    const a1 = await store.create({ agent: 'a', task: 't' });
    await store.create({ agent: 'a', task: 't' });
    const b1 = await store.create({ agent: 'b', task: 't' });

    await scheduler.kick();
    expect(new Set(runManager.started)).toEqual(new Set([a1.id, b1.id]));
  });
});
