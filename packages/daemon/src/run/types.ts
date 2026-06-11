import type { TaskRecord } from '../protocol.js';

/** Result of a finished run. exitCode 0 means success. */
export interface RunOutcome {
  exitCode: number;
  error?: string;
}

/** A started run the scheduler can await and cancel. */
export interface RunHandle {
  /**
   * Resolves when the run finishes. A rejection is treated as a crashed run
   * (exitCode 1) by the scheduler, so implementations may simply reject.
   */
  readonly done: Promise<RunOutcome>;
  /** Request cancellation (SIGTERM, escalating to SIGKILL). Idempotent. */
  cancel(): void;
}

/**
 * Abstraction over "actually run an agent". The real implementation bridges to
 * @kman/core's launchRun; tests inject a controllable fake. Keeping this an
 * interface is what lets the scheduler be unit-tested without spawning backends.
 */
export interface RunManager {
  start(rec: TaskRecord): RunHandle;
}
