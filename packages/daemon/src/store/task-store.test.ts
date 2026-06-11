import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore } from './task-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kman-store-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function newStore(): TaskStore {
  return new TaskStore({ tasksDir: join(dir, 'tasks') });
}

describe('TaskStore.create', () => {
  test('assigns id, seq, queued status, timestamps, and persists to disk', async () => {
    const store = newStore();
    await store.load();
    const rec = await store.create({ agent: 'coder', task: 'do it' });

    expect(rec.id).toBeTruthy();
    expect(rec.seq).toBe(1);
    expect(rec.status).toBe('queued');
    expect(rec.attempts).toBe(0);
    expect(rec.maxAttempts).toBe(1);
    expect(rec.priority).toBe(0);
    expect(rec.createdAt).toBeTruthy();
    expect(rec.logFile).toContain(rec.id);

    const onDisk = JSON.parse(await readFile(join(dir, 'tasks', `${rec.id}.json`), 'utf8'));
    expect(onDisk.id).toBe(rec.id);
    expect(onDisk.task).toBe('do it');
  });

  test('seq increases monotonically across creates', async () => {
    const store = newStore();
    await store.load();
    const a = await store.create({ agent: 'a', task: 't' });
    const b = await store.create({ agent: 'b', task: 't' });
    expect(b.seq).toBe(a.seq + 1);
  });

  test('honors supplied priority and maxAttempts', async () => {
    const store = newStore();
    await store.load();
    const rec = await store.create({ agent: 'a', task: 't', priority: 5, maxAttempts: 3 });
    expect(rec.priority).toBe(5);
    expect(rec.maxAttempts).toBe(3);
  });
});

describe('TaskStore.get / list', () => {
  test('get returns a record; list filters by status', async () => {
    const store = newStore();
    await store.load();
    const a = await store.create({ agent: 'a', task: 't' });
    const b = await store.create({ agent: 'b', task: 't' });
    await store.update(b.id, { status: 'succeeded' });

    expect(store.get(a.id)?.id).toBe(a.id);
    expect(store.get('nope')).toBeUndefined();
    expect(store.list().length).toBe(2);
    expect(store.list({ status: 'queued' }).map((r) => r.id)).toEqual([a.id]);
    expect(store.list({ status: 'succeeded' }).map((r) => r.id)).toEqual([b.id]);
  });
});

describe('TaskStore.update', () => {
  test('merges patch, persists, and keeps index in sync', async () => {
    const store = newStore();
    await store.load();
    const rec = await store.create({ agent: 'a', task: 't' });
    const updated = await store.update(rec.id, { status: 'running', attempts: 1 });
    expect(updated.status).toBe('running');
    expect(updated.attempts).toBe(1);

    const onDisk = JSON.parse(await readFile(join(dir, 'tasks', `${rec.id}.json`), 'utf8'));
    expect(onDisk.status).toBe('running');
  });

  test('throws for unknown id', async () => {
    const store = newStore();
    await store.load();
    await expect(store.update('missing', { status: 'failed' })).rejects.toThrow();
  });
});

describe('TaskStore.load', () => {
  test('rehydrates records from disk and continues seq from the max', async () => {
    const s1 = newStore();
    await s1.load();
    const a = await s1.create({ agent: 'a', task: 't' });

    const s2 = newStore();
    await s2.load();
    expect(s2.get(a.id)?.id).toBe(a.id);
    const b = await s2.create({ agent: 'b', task: 't' });
    expect(b.seq).toBe(a.seq + 1);
  });

  test('ignores non-json and malformed files without throwing', async () => {
    await mkdir(join(dir, 'tasks'), { recursive: true });
    await writeFile(join(dir, 'tasks', 'note.txt'), 'hello');
    await writeFile(join(dir, 'tasks', 'broken.json'), '{not json');
    const store = newStore();
    await store.load();
    expect(store.list().length).toBe(0);
  });
});

describe('TaskStore.reconcile', () => {
  test('re-queues running tasks that still have attempts left', async () => {
    const store = newStore();
    await store.load();
    const rec = await store.create({ agent: 'a', task: 't', maxAttempts: 3 });
    await store.update(rec.id, { status: 'running', attempts: 1 });

    const affected = await store.reconcile();
    expect(affected).toEqual([rec.id]);
    expect(store.get(rec.id)?.status).toBe('queued');
  });

  test('fails running tasks that have exhausted attempts', async () => {
    const store = newStore();
    await store.load();
    const rec = await store.create({ agent: 'a', task: 't', maxAttempts: 1 });
    await store.update(rec.id, { status: 'running', attempts: 1 });

    await store.reconcile();
    const after = store.get(rec.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toBeTruthy();
  });

  test('leaves terminal and queued tasks untouched', async () => {
    const store = newStore();
    await store.load();
    const done = await store.create({ agent: 'a', task: 't' });
    await store.update(done.id, { status: 'succeeded' });
    const queued = await store.create({ agent: 'b', task: 't' });

    const affected = await store.reconcile();
    expect(affected).toEqual([]);
    expect(store.get(done.id)?.status).toBe('succeeded');
    expect(store.get(queued.id)?.status).toBe('queued');
  });
});
