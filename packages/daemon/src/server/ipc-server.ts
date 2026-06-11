import type { Server } from 'bun';
import { rm } from 'node:fs/promises';
import {
  ROUTES,
  TOKEN_HEADER,
  type IpcEndpoint,
  type ListTasksQuery,
  type SubmitTaskRequest,
  type TaskStatus,
} from '../protocol.js';
import { defaultBindEndpoint } from '../paths.js';
import type { DaemonApi } from './api.js';

export interface IpcServerOptions {
  api: DaemonApi;
  /** Where to bind. Defaults to the platform default (unix socket / loopback TCP). */
  endpoint?: IpcEndpoint;
}

const VALID_STATUSES: ReadonlySet<string> = new Set<TaskStatus>([
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
]);

/**
 * Local control plane: HTTP/JSON over a Unix-domain socket (named pipe on
 * Windows). Stale socket files are removed before binding so a crashed daemon
 * doesn't block restart. Auth is a single shared token in a header, checked on
 * every route except /health.
 */
export class IpcServer {
  private readonly api: DaemonApi;
  private endpoint: IpcEndpoint;
  private server?: Server;

  constructor(opts: IpcServerOptions) {
    this.api = opts.api;
    this.endpoint = opts.endpoint ?? defaultBindEndpoint();
  }

  /** The resolved endpoint after start() (TCP port 0 is replaced by the assigned port). */
  get resolvedEndpoint(): IpcEndpoint {
    return this.endpoint;
  }

  async start(): Promise<void> {
    if (this.endpoint.kind === 'unix') {
      // A leftover socket file from an unclean exit refuses bind.
      await rm(this.endpoint.path, { force: true });
      this.server = Bun.serve({ unix: this.endpoint.path, fetch: (req) => this.handle(req) });
    } else {
      this.server = Bun.serve({
        hostname: this.endpoint.host,
        port: this.endpoint.port,
        fetch: (req) => this.handle(req),
      });
      // Capture the OS-assigned port when binding to 0.
      this.endpoint = { kind: 'tcp', host: this.endpoint.host, port: this.server.port };
    }
  }

  async stop(): Promise<void> {
    this.server?.stop(true);
    this.server = undefined;
    if (this.endpoint.kind === 'unix') {
      await rm(this.endpoint.path, { force: true });
    }
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();

    if (path === ROUTES.health) return json({ ok: true });

    if (req.headers.get(TOKEN_HEADER) !== this.api.token) {
      return json({ error: 'unauthorized' }, 401);
    }

    try {
      return await this.route(method, path, url, req);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: message }, 400);
    }
  }

  private async route(method: string, path: string, url: URL, req: Request): Promise<Response> {
    if (path === ROUTES.status && method === 'GET') {
      return json(this.api.status());
    }
    if (path === ROUTES.tasks && method === 'GET') {
      const status = url.searchParams.get('status') ?? undefined;
      const query: ListTasksQuery = {};
      if (status) {
        if (!VALID_STATUSES.has(status)) return json({ error: `invalid status: ${status}` }, 400);
        query.status = status as TaskStatus;
      }
      return json(this.api.list(query));
    }
    if (path === ROUTES.tasks && method === 'POST') {
      const body = (await req.json()) as SubmitTaskRequest;
      if (!body || typeof body.agent !== 'string' || typeof body.task !== 'string') {
        return json({ error: 'agent and task are required' }, 400);
      }
      const rec = await this.api.submit(body);
      return json(rec, 201);
    }
    if (path === ROUTES.shutdown && method === 'POST') {
      await this.api.shutdown();
      return json({ ok: true });
    }

    // /tasks/:id, /tasks/:id/logs, /tasks/:id/cancel
    const taskMatch = path.match(/^\/tasks\/([^/]+)(\/logs|\/cancel)?$/);
    if (taskMatch) {
      const id = decodeURIComponent(taskMatch[1]!);
      const sub = taskMatch[2];
      if (sub === '/logs' && method === 'GET') {
        const logs = await this.api.logs(id);
        if (logs === undefined) return json({ error: 'not found' }, 404);
        return new Response(logs, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
      if (sub === '/cancel' && method === 'POST') {
        const ok = await this.api.cancel(id);
        if (!ok) return json({ error: 'not cancelable' }, 409);
        return json({ ok: true });
      }
      if (!sub && method === 'GET') {
        const rec = this.api.get(id);
        if (!rec) return json({ error: 'not found' }, 404);
        return json(rec);
      }
    }

    return json({ error: 'not found' }, 404);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
