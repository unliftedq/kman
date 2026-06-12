import { rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
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
 * every route except /health. Built on `node:http` so the daemon runs under
 * both Node and Bun.
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
    const server = createServer((nodeReq, nodeRes) => {
      void this.handleNode(nodeReq, nodeRes);
    });
    if (this.endpoint.kind === 'unix') {
      // A leftover socket file from an unclean exit refuses bind.
      await rm(this.endpoint.path, { force: true });
      await listen(server, { path: this.endpoint.path });
    } else {
      await listen(server, { host: this.endpoint.host, port: this.endpoint.port });
      // Capture the OS-assigned port when binding to 0.
      const addr = server.address() as AddressInfo;
      this.endpoint = { kind: 'tcp', host: this.endpoint.host, port: addr.port };
    }
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server) {
      // Force-close keep-alive connections so close() resolves promptly.
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (this.endpoint.kind === 'unix') {
      await rm(this.endpoint.path, { force: true });
    }
  }

  private async handleNode(nodeReq: IncomingMessage, nodeRes: ServerResponse): Promise<void> {
    try {
      const req = await toWebRequest(nodeReq);
      const res = await this.handle(req);
      await writeNodeResponse(nodeRes, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!nodeRes.headersSent) {
        nodeRes.statusCode = 500;
        nodeRes.setHeader('content-type', 'application/json');
      }
      nodeRes.end(JSON.stringify({ error: message }));
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
      // Reply first, then tear down: stopping the server inline would kill this
      // very connection before the client could read the response.
      setTimeout(() => void this.api.shutdown(), 10);
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

/** Bind a node:http server, resolving once it's listening or rejecting on error. */
function listen(
  server: Server,
  opts: { path: string } | { host: string; port: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once('error', onError);
    const done = () => {
      server.removeListener('error', onError);
      resolve();
    };
    if ('path' in opts) server.listen(opts.path, done);
    else server.listen(opts.port, opts.host, done);
  });
}

/** Adapt a node:http request into a Web `Request` so the route logic stays runtime-agnostic. */
async function toWebRequest(nodeReq: IncomingMessage): Promise<Request> {
  const method = nodeReq.method ?? 'GET';
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeReq.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }
  const url = `http://localhost${nodeReq.url ?? '/'}`;
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = await readBody(nodeReq);
  }
  return new Request(url, init);
}

/** Collect a node request body into a string. */
function readBody(nodeReq: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    nodeReq.on('data', (chunk: Buffer) => chunks.push(chunk));
    nodeReq.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    nodeReq.on('error', reject);
  });
}

/** Write a Web `Response` out through a node:http response. */
async function writeNodeResponse(nodeRes: ServerResponse, res: Response): Promise<void> {
  nodeRes.statusCode = res.status;
  res.headers.forEach((value, key) => nodeRes.setHeader(key, value));
  const body = Buffer.from(await res.arrayBuffer());
  nodeRes.end(body);
}
