import type { TaskRecord } from '../protocol.js';
import type { RunHandle, RunManager, RunOutcome } from '../run/types.js';
import type { TaskStore } from '../store/task-store.js';
import { selectRunnable, type ConcurrencyLimits } from './select.js';

export interface SchedulerOptions extends ConcurrencyLimits {
  store: TaskStore;
  runManager: RunManager;
  /**
   * Delay before a failed-but-retryable task becomes runnable again, by attempt
   * number. Default is linear backoff (attempt * 1s). Inject `() => 0` in tests
   * for immediate retry. The timer is set via `setTimer`.
   */
  backoffMs?: (attempt: number) => number;
  /** Injectable timer (defaults to setTimeout) so retries are testable. */
  setTimer?: (fn: () => void, ms: number) => void;
}

/**
 * The reactive core: watches the queue and keeps `maxConcurrent` tasks running.
 * It reacts to two events — a new submission (`kick`) and a run completing — by
 * re-running a tick. All scheduling *decisions* live in the pure `selectRunnable`;
 * this class only owns the side effects (store updates, starting/cancelling runs).
 */
export class Scheduler {
  private readonly store: TaskStore;
  private readonly runManager: RunManager;
  private readonly limits: ConcurrencyLimits;
  private readonly backoffMs: (attempt: number) => number;
  private readonly setTimer: (fn: () => void, ms: number) => void;

  private readonly running = new Map<string, RunHandle>();
  /** Ids for which cancellation was requested while running. */
  private readonly cancelRequested = new Set<string>();
  /** Queued ids waiting out a retry backoff; excluded from selection until their timer fires. */
  private readonly deferred = new Set<string>();
  /** In-flight completion processing, tracked so tests can deterministically settle. */
  private readonly processing = new Set<Promise<void>>();

  private ticking = false;
  private tickAgain = false;
  private stopped = false;

  constructor(opts: SchedulerOptions) {
    this.store = opts.store;
    this.runManager = opts.runManager;
    this.limits = opts.perAgentMax !== undefined
      ? { maxConcurrent: opts.maxConcurrent, perAgentMax: opts.perAgentMax }
      : { maxConcurrent: opts.maxConcurrent };
    this.backoffMs = opts.backoffMs ?? ((attempt) => attempt * 1000);
    this.setTimer = opts.setTimer ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  /** Number of tasks currently running. */
  get runningCount(): number {
    return this.running.size;
  }

  /** Nudge the scheduler to (re)evaluate the queue. Safe to call repeatedly. */
  async kick(): Promise<void> {
    await this.tick();
  }

  /**
   * Cancel a task. Queued → marked canceled immediately. Running → its child is
   * asked to stop and the task is marked canceled once it exits. Returns false
   * if the id is unknown or already terminal.
   */
  async cancel(id: string): Promise<boolean> {
    const rec = this.store.get(id);
    if (!rec) return false;
    if (rec.status === 'queued') {
      await this.store.update(id, {
        status: 'canceled',
        finishedAt: new Date().toISOString(),
      });
      return true;
    }
    if (rec.status === 'running') {
      this.cancelRequested.add(id);
      this.running.get(id)?.cancel();
      return true;
    }
    return false;
  }

  /** Stop accepting new starts. In-flight runs are left to finish or be cancelled. */
  stop(): void {
    this.stopped = true;
  }

  /**
   * Resolve once all pending completion processing has drained. Test-only helper;
   * does not wait for still-running tasks whose runs haven't finished.
   */
  async settle(): Promise<void> {
    for (let i = 0; i < 10_000; i++) {
      // Let any queued handle.done.then microtasks run so they register processing.
      await Promise.resolve();
      if (this.processing.size === 0) {
        await Promise.resolve();
        if (this.processing.size === 0) return;
      }
      await Promise.all([...this.processing]);
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    if (this.ticking) {
      this.tickAgain = true;
      return;
    }
    this.ticking = true;
    try {
      do {
        this.tickAgain = false;
        const queued = this.store
          .list({ status: 'queued' })
          .filter((r) => !this.deferred.has(r.id));
        const picks = selectRunnable(queued, this.snapshot(), this.limits);
        for (const rec of picks) {
          await this.startOne(rec);
        }
      } while (this.tickAgain && !this.stopped);
    } finally {
      this.ticking = false;
    }
  }

  private snapshot(): { total: number; byAgent: Map<string, number> } {
    const byAgent = new Map<string, number>();
    for (const id of this.running.keys()) {
      const rec = this.store.get(id);
      if (!rec) continue;
      byAgent.set(rec.agent, (byAgent.get(rec.agent) ?? 0) + 1);
    }
    return { total: this.running.size, byAgent };
  }

  private async startOne(rec: TaskRecord): Promise<void> {
    const started = await this.store.update(rec.id, {
      status: 'running',
      attempts: rec.attempts + 1,
      startedAt: new Date().toISOString(),
    });
    const handle = this.runManager.start(started);
    this.running.set(rec.id, handle);
    // Register completion handling synchronously so settle() can observe it.
    handle.done.then(
      (outcome) => this.onComplete(rec.id, outcome),
      (err) => this.onComplete(rec.id, { exitCode: 1, error: String(err) }),
    );
  }

  private onComplete(id: string, outcome: RunOutcome): void {
    const p = this.process(id, outcome).finally(() => this.processing.delete(p));
    this.processing.add(p);
  }

  /** Run a tick whose work is tracked in `processing` (used by fire-and-forget timers). */
  private trackTick(): void {
    const p = this.tick().finally(() => this.processing.delete(p));
    this.processing.add(p);
  }

  private async process(id: string, outcome: RunOutcome): Promise<void> {
    this.running.delete(id);
    const rec = this.store.get(id);
    if (!rec) return;
    const now = new Date().toISOString();

    if (this.cancelRequested.has(id)) {
      this.cancelRequested.delete(id);
      await this.store.update(id, { status: 'canceled', finishedAt: now });
    } else if (outcome.exitCode === 0) {
      await this.store.update(id, { status: 'succeeded', exitCode: 0, finishedAt: now });
    } else if (rec.attempts < rec.maxAttempts) {
      // Retry: requeue but hold it out of selection until the backoff elapses.
      this.deferred.add(id);
      await this.store.update(id, {
        status: 'queued',
        ...(outcome.error !== undefined ? { error: outcome.error } : {}),
      });
      const delay = this.backoffMs(rec.attempts);
      this.setTimer(() => {
        this.deferred.delete(id);
        this.trackTick();
      }, delay);
    } else {
      await this.store.update(id, {
        status: 'failed',
        exitCode: outcome.exitCode,
        ...(outcome.error !== undefined ? { error: outcome.error } : {}),
        finishedAt: now,
      });
    }
    await this.tick();
  }
}
