import {
  ROUTES,
  TOKEN_HEADER,
  type DaemonStatus,
  type IpcEndpoint,
  type ListTasksQuery,
  type SubmitTaskRequest,
  type TaskRecord,
} from '../protocol.js';
import { readState } from '../state.js';

/** Raised when no daemon is reachable. */
export class DaemonUnavailableError extends Error {
  constructor(message = 'kman daemon is not running. Start it with `kman daemon start`.') {
    super(message);
    this.name = 'DaemonUnavailableError';
  }
}

export interface IpcClientOptions {
  endpoint: IpcEndpoint;
  token?: string;
}

/**
 * CLI-side client for the daemon's control plane. Construct it directly with an
 * endpoint (tests) or via `IpcClient.fromState()`, which reads the connection
 * info and token the running daemon recorded in state.json.
 */
export class IpcClient {
  private readonly endpoint: IpcEndpoint;
  private readonly token: string | undefined;

  constructor(opts: IpcClientOptions) {
    this.endpoint = opts.endpoint;
    this.token = opts.token;
  }

  /**
   * Build a client from the daemon's recorded state. Returns undefined when no
   * state.json exists (daemon never started) so callers can give a clean
   * "not running" message instead of a stack trace.
   */
  static async fromState(): Promise<IpcClient | undefined> {
    const state = await readState();
    if (!state) return undefined;
    return new IpcClient({ endpoint: state.endpoint, token: state.token });
  }

  async isRunning(): Promise<boolean> {
    try {
      const res = await this.fetch(ROUTES.health, { method: 'GET' }, /* auth */ false);
      return res.ok;
    } catch {
      return false;
    }
  }

  async status(): Promise<DaemonStatus> {
    return this.getJson<DaemonStatus>(ROUTES.status);
  }

  async submit(req: SubmitTaskRequest): Promise<TaskRecord> {
    const res = await this.fetch(ROUTES.tasks, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    return this.parse<TaskRecord>(res);
  }

  async list(query: ListTasksQuery = {}): Promise<TaskRecord[]> {
    const qs = query.status ? `?status=${encodeURIComponent(query.status)}` : '';
    return this.getJson<TaskRecord[]>(`${ROUTES.tasks}${qs}`);
  }

  async get(id: string): Promise<TaskRecord> {
    return this.getJson<TaskRecord>(ROUTES.task(id));
  }

  async logs(id: string): Promise<string> {
    const res = await this.fetch(ROUTES.taskLogs(id), { method: 'GET' });
    if (!res.ok) throw await this.error(res);
    return res.text();
  }

  async cancel(id: string): Promise<void> {
    const res = await this.fetch(ROUTES.taskCancel(id), { method: 'POST' });
    if (!res.ok) throw await this.error(res);
  }

  async shutdown(): Promise<void> {
    try {
      const res = await this.fetch(ROUTES.shutdown, { method: 'POST' });
      if (!res.ok) throw await this.error(res);
    } catch (err) {
      // The daemon dropping the connection as it exits is the success case, not
      // a failure — only rethrow if it was something other than going away.
      if (!(err instanceof DaemonUnavailableError)) throw err;
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.fetch(path, { method: 'GET' });
    return this.parse<T>(res);
  }

  private async parse<T>(res: Response): Promise<T> {
    if (!res.ok) throw await this.error(res);
    return (await res.json()) as T;
  }

  private async error(res: Response): Promise<Error> {
    let detail = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* non-JSON error body */
    }
    return new Error(`daemon request failed: ${detail}`);
  }

  private async fetch(path: string, init: RequestInit, auth = true): Promise<Response> {
    const headers = new Headers(init.headers);
    if (auth && this.token) headers.set(TOKEN_HEADER, this.token);

    const { url, unix } =
      this.endpoint.kind === 'unix'
        ? { url: `http://localhost${path}`, unix: this.endpoint.path }
        : { url: `http://${this.endpoint.host}:${this.endpoint.port}${path}`, unix: undefined };

    try {
      return await fetch(url, {
        ...init,
        headers,
        ...(unix ? { unix } : {}),
      } as RequestInit & { unix?: string });
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Bun surfaces these when nothing is listening on the socket/port.
      const unreachable = new Set([
        'ENOENT',
        'ECONNREFUSED',
        'ConnectionRefused',
        'FailedToOpenSocket',
        'ECONNRESET',
      ]);
      if (code && unreachable.has(code)) throw new DaemonUnavailableError();
      throw err;
    }
  }
}
