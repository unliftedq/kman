import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DaemonStatus,
  IpcEndpoint,
  ListTasksQuery,
  SubmitTaskRequest,
  TaskRecord,
} from '../protocol.js';
import { IpcClient, DaemonUnavailableError } from '../client/ipc-client.js';
import type { DaemonApi } from './api.js';
import { IpcServer } from './ipc-server.js';

const TOKEN = 'secret-token';

class FakeApi implements DaemonApi {
  readonly token = TOKEN;
  shutdownCalled = false;
  private readonly tasks = new Map<string, TaskRecord>();
  private seq = 0;

  status(): DaemonStatus {
    return {
      version: '0.0.0',
      pid: 123,
      startedAt: '2026-01-01T00:00:00.000Z',
      maxConcurrent: 2,
      counts: { queued: 0, running: 0, succeeded: 0, failed: 0, canceled: 0 },
      running: 0,
      queued: this.tasks.size,
    };
  }
  async submit(req: SubmitTaskRequest): Promise<TaskRecord> {
    const id = `t_${++this.seq}`;
    const rec: TaskRecord = {
      id,
      seq: this.seq,
      agent: req.agent,
      task: req.task,
      status: 'queued',
      priority: req.priority ?? 0,
      attempts: 0,
      maxAttempts: req.maxAttempts ?? 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      logFile: `logs/${id}.log`,
    };
    this.tasks.set(id, rec);
    return rec;
  }
  list(query: ListTasksQuery): TaskRecord[] {
    let out = [...this.tasks.values()];
    if (query.status) out = out.filter((r) => r.status === query.status);
    return out;
  }
  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }
  async logs(id: string): Promise<string | undefined> {
    return this.tasks.has(id) ? `log for ${id}` : undefined;
  }
  async cancel(id: string): Promise<boolean> {
    const rec = this.tasks.get(id);
    if (!rec) return false;
    rec.status = 'canceled';
    return true;
  }
  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
  }
}

let dir: string;
let bindEndpoint: IpcEndpoint;
let endpoint: IpcEndpoint;
let server: IpcServer;
let api: FakeApi;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kman-ipc-'));
  // Windows: loopback TCP (Bun named pipes leak). POSIX: unix socket.
  bindEndpoint =
    process.platform === 'win32'
      ? { kind: 'tcp', host: '127.0.0.1', port: 0 }
      : { kind: 'unix', path: join(dir, 'sock') };
  api = new FakeApi();
  server = new IpcServer({ api, endpoint: bindEndpoint });
  await server.start();
  endpoint = server.resolvedEndpoint; // real port for TCP
});
afterEach(async () => {
  await server.stop();
  await rm(dir, { recursive: true, force: true });
});

function client(token: string | undefined = TOKEN): IpcClient {
  return new IpcClient(token !== undefined ? { endpoint, token } : { endpoint });
}

describe('IPC server + client', () => {
  test('health check needs no token', async () => {
    expect(await client(undefined).isRunning()).toBe(true);
  });

  test('submit returns a created record and list reflects it', async () => {
    const c = client();
    const rec = await c.submit({ agent: 'coder', task: 'do it', priority: 3 });
    expect(rec.id).toBeTruthy();
    expect(rec.agent).toBe('coder');
    expect(rec.priority).toBe(3);

    const all = await c.list();
    expect(all.map((r) => r.id)).toEqual([rec.id]);
  });

  test('get / logs / cancel round-trip', async () => {
    const c = client();
    const rec = await c.submit({ agent: 'coder', task: 'do it' });
    expect((await c.get(rec.id)).id).toBe(rec.id);
    expect(await c.logs(rec.id)).toContain(rec.id);
    await c.cancel(rec.id);
    expect((await c.get(rec.id)).status).toBe('canceled');
  });

  test('list filters by status', async () => {
    const c = client();
    const a = await c.submit({ agent: 'x', task: 't' });
    await c.cancel(a.id);
    await c.submit({ agent: 'y', task: 't' });
    expect((await c.list({ status: 'canceled' })).map((r) => r.id)).toEqual([a.id]);
    expect((await c.list({ status: 'queued' })).length).toBe(1);
  });

  test('rejects requests with a bad token', async () => {
    await expect(client('wrong').status()).rejects.toThrow(/unauthorized/i);
  });

  test('get of unknown id throws not found', async () => {
    await expect(client().get('nope')).rejects.toThrow(/not found/i);
  });

  test('shutdown is forwarded to the api', async () => {
    await client().shutdown();
    expect(api.shutdownCalled).toBe(true);
  });

  test('client reports DaemonUnavailable when nothing is listening', async () => {
    const dead: IpcEndpoint =
      process.platform === 'win32'
        ? { kind: 'tcp', host: '127.0.0.1', port: 59999 }
        : { kind: 'unix', path: join(dir, 'nope.sock') };
    const c = new IpcClient({ endpoint: dead, token: TOKEN });
    expect(await c.isRunning()).toBe(false);
    await expect(c.status()).rejects.toBeInstanceOf(DaemonUnavailableError);
  });
});
