import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { Readable, Writable } from 'node:stream';
import {
  ErrorCode,
  RpcError,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest,
} from './protocol.js';
import { callTool, listTools, type ToolHandlerCtx } from './tools.js';
import { listResources, listResourceTemplates, readResource } from './resources.js';
import { getPrompt, listPrompts } from './prompts.js';

const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * Server-level usage guidance returned in the `initialize` response.
 * Per MCP spec the host MAY surface this to its LLM as system-prompt
 * context, which is how we get models to *proactively* consider kman
 * instead of waiting to be told. Kept short to limit token cost.
 */
const KMAN_USAGE_INSTRUCTIONS = `\
This MCP server (kman) exposes locally managed specialist agents. Each agent has its own soul prompt, \
skills, and backend.

When a user request may benefit from a specialist (code review, refactoring, research, test writing, \
doc rewrites, niche-domain analysis), consider delegating:

  1. Call \`kman_list_agents\` to see the current local roster.
  2. If needed, call \`kman_describe_agent\` to confirm fit from the agent's profile and soul prompt.
  3. Call \`kman_run_agent\` with the agent name and a self-contained task. The response is the agent's \
    stdout; incorporate it into your own answer and cite the agent by name.

If no agent fits, do the work yourself. Each \`kman_run_agent\` call is a fresh one-shot run; sessions \
are not shared and the peer cannot see your conversation or scratch notes. Self-delegation and cycles \
are blocked server-side.

For reusable workflows, four prompts are available for hosts to surface as slash commands: \
\`list-agents\` (show the roster), \`find-agent\` (choose a specialist), \`delegate-task\` (hand \
a task off), and \`second-opinion\` (independent review).`;

export interface McpServerOptions {
  /** When set, hide this agent from listings and refuse to dispatch to it. */
  selfAgent?: string;
  /**
   * How to re-invoke the kman CLI from inside the server. Defaults to using
   * the same node binary + script that started the server, which matches the
   * `bin: { kman: dist/main.js }` shape published to npm.
   */
  invocation?: { command: string; baseArgs?: readonly string[] };
  /**
   * Cap on a single `run_agent` call. Default 10 min. Set to 0 to disable.
   */
  runTimeoutMs?: number;
  /** stdin / stdout overrides — mostly useful for tests. */
  input?: Readable;
  output?: Writable;
}

export interface RunningServer {
  /** Resolves when the input stream closes (peer disconnects). */
  done: Promise<void>;
  /** Force the server to stop reading stdin. */
  stop(): void;
}

/**
 * Start an MCP server on the given streams. Defaults to stdio, matching the
 * MCP stdio transport. Each line of input is a single JSON-RPC message; each
 * line of output is a single JSON-RPC message.
 */
export function startMcpServer(opts: McpServerOptions = {}): RunningServer {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const ctx: ToolHandlerCtx = {
    invocation: {
      command: opts.invocation?.command ?? process.execPath,
      baseArgs: opts.invocation?.baseArgs ?? (process.argv[1] ? [process.argv[1]] : []),
    },
    runTimeoutMs: opts.runTimeoutMs ?? 10 * 60 * 1000,
    ...(opts.selfAgent ? { selfAgent: opts.selfAgent } : {}),
  };

  const rl: ReadlineInterface = createInterface({ input, crlfDelay: Infinity });

  const send = (msg: JsonRpcMessage): void => {
    output.write(JSON.stringify(msg) + '\n');
  };

  // Track in-flight handlers so peer disconnect (input EOF) waits for
  // pending dispatches to write their response before `done` resolves.
  // Without this, tests that pipe a single message + EOF race the async
  // dispatch and see an empty output buffer.
  const inflight = new Set<Promise<void>>();

  const done = new Promise<void>((resolve) => {
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const task = handleLine(trimmed, ctx, send).catch(() => undefined);
      inflight.add(task);
      task.finally(() => inflight.delete(task));
    });
    rl.on('close', () => {
      void Promise.allSettled(Array.from(inflight)).then(() => resolve());
    });
  });

  return {
    done,
    stop: () => rl.close(),
  };
}

async function handleLine(
  line: string,
  ctx: ToolHandlerCtx,
  send: (msg: JsonRpcMessage) => void,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: ErrorCode.ParseError, message: 'Invalid JSON.' } });
    return;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    send({ jsonrpc: '2.0', id: null, error: { code: ErrorCode.InvalidRequest, message: 'Not a JSON object.' } });
    return;
  }
  const msg = parsed as JsonRpcRequest;
  const id: JsonRpcId = 'id' in msg ? msg.id : null;
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    if ('id' in msg) {
      send({ jsonrpc: '2.0', id, error: { code: ErrorCode.InvalidRequest, message: 'Not JSON-RPC 2.0.' } });
    }
    return;
  }

  const hasId = 'id' in msg;
  try {
    const result = await dispatch(msg.method, msg.params, ctx);
    if (hasId && result !== undefined) {
      send({ jsonrpc: '2.0', id, result });
    }
  } catch (err) {
    if (!hasId) return; // never reply to a notification
    if (err instanceof RpcError) {
      send({
        jsonrpc: '2.0',
        id,
        error: { code: err.code, message: err.message, ...(err.data !== undefined ? { data: err.data } : {}) },
      });
    } else {
      send({
        jsonrpc: '2.0',
        id,
        error: { code: ErrorCode.InternalError, message: (err as Error).message },
      });
    }
  }
}

async function dispatch(
  method: string,
  params: unknown,
  ctx: ToolHandlerCtx,
): Promise<unknown> {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
          prompts: { listChanged: false },
        },
        serverInfo: { name: 'kman', version: kmanVersion() },
        instructions: KMAN_USAGE_INSTRUCTIONS,
      };
    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/roots/list_changed':
      return undefined;
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: listTools() };
    case 'tools/call': {
      const p = asObject(params);
      const name = typeof p['name'] === 'string' ? p['name'] : '';
      const args = (p['arguments'] as Record<string, unknown>) ?? {};
      if (!name) throw new RpcError(ErrorCode.InvalidParams, 'tools/call requires "name".');
      return callTool(name, args, ctx);
    }
    case 'resources/list':
      return { resources: listResources() };
    case 'resources/templates/list':
      return { resourceTemplates: listResourceTemplates() };
    case 'resources/read': {
      const p = asObject(params);
      const uri = typeof p['uri'] === 'string' ? p['uri'] : '';
      if (!uri) throw new RpcError(ErrorCode.InvalidParams, 'resources/read requires "uri".');
      const content = await readResource(uri, { ...(ctx.selfAgent ? { selfAgent: ctx.selfAgent } : {}) });
      return { contents: [content] };
    }
    case 'prompts/list':
      return { prompts: listPrompts() };
    case 'prompts/get': {
      const p = asObject(params);
      const name = typeof p['name'] === 'string' ? p['name'] : '';
      const args = (p['arguments'] as Record<string, string>) ?? {};
      if (!name) throw new RpcError(ErrorCode.InvalidParams, 'prompts/get requires "name".');
      return getPrompt(name, args);
    }
    default:
      throw new RpcError(ErrorCode.MethodNotFound, `Method not implemented: ${method}`);
  }
}

function asObject(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new RpcError(ErrorCode.InvalidParams, 'params must be an object.');
  }
  return params as Record<string, unknown>;
}

function kmanVersion(): string {
  return process.env['KMAN_VERSION'] ?? '0.0.0';
}
