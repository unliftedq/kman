import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IpcEndpoint, TaskRecord } from './protocol.js';
import type { RunHandle, RunManager, RunOutcome } from './run/types.js';
import { Daemon } from './daemon.js';

/** Fake runner whose runs complete only when the test resolves them. */
class FakeRunManager implements RunManager {
  readonly started: string[] = [];
  private readonly resolvers = new Map<string, (o: RunOutcome) => void>();
  start(rec: TaskRecord): RunHandle {
    this.started.push(rec.id);
    let resolve!: (o: RunOutcome) => void;
    const done = new Promise<RunOutcome>((r) => (resolve = r));
    this.resolvers.set(rec.id, resolve);
    return { done, cancel: () => this.resolvers.get(rec.id)?.({ exitCode: 130 }) };
  }
  finish(id: string, o: RunOutcome): void {
    this.resolvers.get(id)?.(o);
    this.resolvers.delete(id);
  }
}

let dir: string;
let endpoint: IpcEndpoint;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kman-daemon-'));
  endpoint =
    process.platform === 'win32'
      ? { kind: 'tcp', host: '127.0.0.1', port: 0 }
      : { kind: 'unix', path: join(dir, 'sock') };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeDaemon(run: RunManager): Daemon {
  return new Daemon({ runManager: run, version: '9.9.9', endpoint, baseDir: dir, maxConcurrent: 1 });
}

describe('Daemon lifecycle', () => {
  test('start writes state.json and a pid file, shutdown removes them', async () => {
    const run = new FakeRunManager();
    const d = makeDaemon(run);
    await d.start();

    const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
    expect(state.version).toBe('9.9.9');
    expect(state.token).toBe(d.token);
    expect(state.endpoint.kind).toBe(endpoint.kind);
    expect((await stat(join(dir, 'daemon.pid'))).isFile()).toBe(true);

    await d.shutdown();
    await expect(stat(join(dir, 'state.json'))).rejects.toThrow();
    await expect(stat(join(dir, 'daemon.pid'))).rejects.toThrow();
  });

  test('submit enqueues, schedules, and status reflects counts', async () => {
    const run = new FakeRunManager();
    const d = makeDaemon(run);
    await d.start();

    const a = await d.submit({ agent: 'coder', task: 'one' });
    const b = await d.submit({ agent: 'coder', task: 'two' });

    // maxConcurrent 1 → a runs, b queued.
    expect(run.started).toEqual([a.id]);
    let s = d.status();
    expect(s.running).toBe(1);
    expect(s.queued).toBe(1);

    run.finish(a.id, { exitCode: 0 });
    await d.settle();
    expect(run.started).toEqual([a.id, b.id]);
    expect(d.get(a.id)?.status).toBe('succeeded');

    await d.shutdown();
  });

  test('logs returns empty string for a task with no log yet', async () => {
    const run = new FakeRunManager();
    const d = makeDaemon(run);
    await d.start();
    const a = await d.submit({ agent: 'coder', task: 'one' });
    expect(await d.logs(a.id)).toBe('');
    expect(await d.logs('unknown')).toBeUndefined();
    await d.shutdown();
  });

  test('reconcile re-queues a task left running by a previous daemon', async () => {
    // Seed a store under dir with a running task, then start a fresh daemon.
    const { TaskStore } = await import('./store/task-store.js');
    const store = new TaskStore({ tasksDir: join(dir, 'tasks') });
    await store.load();
    const rec = await store.create({ agent: 'coder', task: 'orphan', maxAttempts: 2 });
    await store.update(rec.id, { status: 'running', attempts: 1 });

    const run = new FakeRunManager();
    const d = makeDaemon(run);
    await d.start();
    // It should have been recovered and re-run.
    expect(run.started).toContain(rec.id);
    await d.shutdown();
  });
});
