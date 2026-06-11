import type {
  DaemonStatus,
  ListTasksQuery,
  SubmitTaskRequest,
  TaskRecord,
} from '../protocol.js';

/**
 * The surface the IPC server exposes. The real daemon implements this over its
 * store + scheduler; tests implement a fake. Keeping the HTTP layer behind this
 * interface lets each be tested in isolation.
 */
export interface DaemonApi {
  /** Shared secret clients must echo in the token header. */
  readonly token: string;
  status(): DaemonStatus;
  submit(req: SubmitTaskRequest): Promise<TaskRecord>;
  list(query: ListTasksQuery): TaskRecord[];
  get(id: string): TaskRecord | undefined;
  /** Read a task's captured log, or undefined if the task/log is unknown. */
  logs(id: string): Promise<string | undefined>;
  cancel(id: string): Promise<boolean>;
  /** Begin a graceful shutdown. Should resolve quickly; actual exit may follow. */
  shutdown(): Promise<void>;
}
