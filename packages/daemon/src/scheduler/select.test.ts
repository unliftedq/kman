import { describe, expect, test } from 'vitest';
import type { TaskRecord } from '../protocol.js';
import { selectRunnable, compareQueueOrder } from './select.js';

function rec(over: Partial<TaskRecord> & { id: string; seq: number }): TaskRecord {
  return {
    agent: 'a',
    task: 't',
    status: 'queued',
    priority: 0,
    attempts: 0,
    maxAttempts: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    logFile: `logs/${over.id}.log`,
    ...over,
  };
}

const noneRunning = { total: 0, byAgent: new Map<string, number>() };

describe('compareQueueOrder', () => {
  test('higher priority first, then lower seq', () => {
    const a = rec({ id: 'a', seq: 1, priority: 0 });
    const b = rec({ id: 'b', seq: 2, priority: 5 });
    const c = rec({ id: 'c', seq: 3, priority: 5 });
    const sorted = [a, b, c].sort(compareQueueOrder).map((r) => r.id);
    expect(sorted).toEqual(['b', 'c', 'a']);
  });
});

describe('selectRunnable', () => {
  test('respects the global concurrency cap', () => {
    const q = [rec({ id: 'a', seq: 1 }), rec({ id: 'b', seq: 2 }), rec({ id: 'c', seq: 3 })];
    const picked = selectRunnable(q, noneRunning, { maxConcurrent: 2 });
    expect(picked.map((r) => r.id)).toEqual(['a', 'b']);
  });

  test('accounts for already-running tasks against the cap', () => {
    const q = [rec({ id: 'a', seq: 1 }), rec({ id: 'b', seq: 2 })];
    const picked = selectRunnable(q, { total: 1, byAgent: new Map([['x', 1]]) }, { maxConcurrent: 2 });
    expect(picked.map((r) => r.id)).toEqual(['a']);
  });

  test('orders by priority then seq before picking', () => {
    const q = [
      rec({ id: 'low', seq: 1, priority: 0 }),
      rec({ id: 'high', seq: 2, priority: 9 }),
    ];
    const picked = selectRunnable(q, noneRunning, { maxConcurrent: 1 });
    expect(picked.map((r) => r.id)).toEqual(['high']);
  });

  test('enforces per-agent cap, skipping over-committed agents to other agents', () => {
    const q = [
      rec({ id: 'a1', seq: 1, agent: 'a' }),
      rec({ id: 'a2', seq: 2, agent: 'a' }),
      rec({ id: 'b1', seq: 3, agent: 'b' }),
    ];
    const picked = selectRunnable(q, noneRunning, { maxConcurrent: 5, perAgentMax: 1 });
    expect(picked.map((r) => r.id)).toEqual(['a1', 'b1']);
  });

  test('does not over-commit a single pass beyond the cap counting its own picks', () => {
    const q = [
      rec({ id: 'a', seq: 1 }),
      rec({ id: 'b', seq: 2 }),
      rec({ id: 'c', seq: 3 }),
    ];
    const picked = selectRunnable(q, noneRunning, { maxConcurrent: 3 });
    expect(picked.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  test('returns nothing when already at capacity', () => {
    const q = [rec({ id: 'a', seq: 1 })];
    const picked = selectRunnable(q, { total: 2, byAgent: new Map() }, { maxConcurrent: 2 });
    expect(picked).toEqual([]);
  });
});
