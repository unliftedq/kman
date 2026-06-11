import type { OutputFormat, PermissionLevel } from '@kman/types';

/** Lifecycle of a queued task. */
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

/** Persisted, full task record (mirrors tasks/<id>.json on disk). */
export interface TaskRecord {
  id: string;
  /** Monotonic insertion sequence; ties on priority broken by seq ascending (true FIFO). */
  seq: number;
  agent: string;
  task: string;
  status: TaskStatus;
  /** Higher runs first; ties broken by seq ascending. */
  priority: number;
  /** How many times this task has been started. */
  attempts: number;
  /** Stop retrying once attempts reaches this. */
  maxAttempts: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  // Optional per-task overrides forwarded to the run context.
  runtime?: string;
  model?: string;
  permission?: PermissionLevel;
  outputFormat?: OutputFormat;
  cwd?: string;
  /** Relative path (under daemon home) to the captured log. */
  logFile: string;
}

/** Fields a client supplies when submitting a task. */
export interface SubmitTaskRequest {
  agent: string;
  task: string;
  priority?: number;
  maxAttempts?: number;
  runtime?: string;
  model?: string;
  permission?: PermissionLevel;
  outputFormat?: OutputFormat;
  cwd?: string;
}

/** Snapshot returned by GET /status. */
export interface DaemonStatus {
  version: string;
  pid: number;
  startedAt: string;
  /** Effective global concurrency limit. */
  maxConcurrent: number;
  counts: Record<TaskStatus, number>;
  running: number;
  queued: number;
}

export interface ListTasksQuery {
  status?: TaskStatus;
}

/**
 * How the CLI reaches the daemon. Unix-domain socket on macOS/Linux; TCP on
 * loopback for Windows, where Bun's named-pipe support leaks handles across
 * restarts. The daemon records the resolved endpoint in state.json so the
 * client never has to guess (the TCP port is ephemeral).
 */
export type IpcEndpoint =
  | { kind: 'unix'; path: string }
  | { kind: 'tcp'; host: string; port: number };

/** Persisted daemon metadata + how to connect to it (mirrors state.json). */
export interface DaemonState {
  schemaVersion: number;
  version: string;
  pid: number;
  startedAt: string;
  /** Shared secret the client echoes in the token header. */
  token: string;
  /** Resolved control-plane endpoint. */
  endpoint: IpcEndpoint;
}

export interface ErrorResponse {
  error: string;
}

/**
 * Route contract shared by server and client. Centralizing the paths here keeps
 * the two ends honest — a renamed route breaks the type, not just a 404.
 */
export const ROUTES = {
  health: '/health',
  status: '/status',
  tasks: '/tasks',
  task: (id: string) => `/tasks/${id}`,
  taskLogs: (id: string) => `/tasks/${id}/logs`,
  taskCancel: (id: string) => `/tasks/${id}/cancel`,
  shutdown: '/shutdown',
} as const;

/** Header carrying the per-daemon auth token (checked on all routes but /health). */
export const TOKEN_HEADER = 'x-kman-token';

/** Default global concurrency when config does not override it. */
export const DEFAULT_MAX_CONCURRENT = 2;
