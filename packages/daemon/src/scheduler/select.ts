import type { TaskRecord } from '../protocol.js';

export interface ConcurrencyLimits {
  /** Global cap on simultaneously running tasks. */
  maxConcurrent: number;
  /** Optional per-agent cap. Undefined means unlimited per agent. */
  perAgentMax?: number;
}

export interface RunningSnapshot {
  /** Total tasks currently running. */
  total: number;
  /** Running count keyed by agent name. */
  byAgent: ReadonlyMap<string, number>;
}

/**
 * Pure scheduling decision: given the queued tasks and what is already running,
 * return the tasks that should start *now*, in start order, honoring the global
 * and per-agent concurrency caps. No side effects — the caller performs the
 * starts. Selecting a task counts against the caps for subsequent picks in the
 * same pass, so one call never over-commits a slot.
 */
export function selectRunnable(
  queued: readonly TaskRecord[],
  running: RunningSnapshot,
  limits: ConcurrencyLimits,
): TaskRecord[] {
  const ordered = [...queued].sort(compareQueueOrder);
  const picked: TaskRecord[] = [];
  let total = running.total;
  const byAgent = new Map(running.byAgent);

  for (const rec of ordered) {
    if (total >= limits.maxConcurrent) break;
    const agentRunning = byAgent.get(rec.agent) ?? 0;
    if (limits.perAgentMax !== undefined && agentRunning >= limits.perAgentMax) continue;
    picked.push(rec);
    total += 1;
    byAgent.set(rec.agent, agentRunning + 1);
  }
  return picked;
}

/** Higher priority first; ties broken by insertion sequence (FIFO). */
export function compareQueueOrder(a: TaskRecord, b: TaskRecord): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.seq - b.seq;
}
