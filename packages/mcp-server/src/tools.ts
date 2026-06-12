import { agentExists, describeAgent, listAgents } from './agents.js';
import { getTask, getTaskLogs, submitAgentTask, type TaskSnapshot } from './runner.js';
import { ErrorCode, RpcError } from './protocol.js';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ToolHandlerCtx {
  /**
   * Agent name that the launching backend belongs to (when kman injects the
   * server into a backend it spawned). Excluded from `list_agents` and
   * rejected by `run_agent` to prevent self-call cycles.
   */
  selfAgent?: string;
  /** How to re-shell into the kman CLI from within the server process. */
  invocation: { command: string; baseArgs: readonly string[] };
  /** Hard ceiling on a single `run_agent` invocation. 0 disables. */
  runTimeoutMs: number;
}

const KMAN_LIST_AGENTS: ToolDef = {
  name: 'kman_list_agents',
  description:
    'List kman-managed specialist agents available on this machine. Use first when a task may ' +
    'benefit from delegation. Returns each agent\'s name, description, default runtime, and ' +
    'default model; the local roster may change between conversations.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

const KMAN_DESCRIBE_AGENT: ToolDef = {
  name: 'kman_describe_agent',
  description:
    "Read one agent's full profile and soul prompt. Use after `kman_list_agents` to confirm " +
    'fit when the roster summary is not enough or multiple agents look relevant.',
  inputSchema: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'Agent name (lowercase kebab-case).' },
    },
    required: ['agent'],
    additionalProperties: false,
  },
};

const KMAN_RUN_AGENT: ToolDef = {
  name: 'kman_run_agent',
  description:
    'Submit a one-shot task to a kman-managed peer agent and return a task id immediately ' +
    '(asynchronous). The agent runs on the kman daemon in the background; poll ' +
    '`kman_get_task` with the returned id to read its status and final output. Use after ' +
    'choosing an agent from `kman_list_agents`. The task must be self-contained: the peer ' +
    'receives this text, not your conversation or scratch notes, so include relevant context, ' +
    'file paths, constraints, and done criteria. Sessions are not shared; self-delegation ' +
    'and delegation cycles are rejected.',
  inputSchema: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'Target agent name from `kman_list_agents`.' },
      task: {
        type: 'string',
        description:
          'Self-contained task description with the context, paths, constraints, and done criteria needed.',
      },
      runtime: {
        type: 'string',
        description: "Optional override for the agent's default runtime (claude-code | copilot-cli).",
      },
      model: { type: 'string', description: "Optional override for the agent's default model." },
      permission: {
        type: 'string',
        enum: ['ask', 'auto', 'yolo'],
        description: 'Permission level for the spawned backend.',
      },
      cwd: { type: 'string', description: 'Working directory for the spawned runtime.' },
    },
    required: ['agent', 'task'],
    additionalProperties: false,
  },
};

const KMAN_GET_TASK: ToolDef = {
  name: 'kman_get_task',
  description:
    'Check on a task previously started with `kman_run_agent`. Returns the current status ' +
    '(queued | running | succeeded | failed | canceled) and, once finished, the captured ' +
    "output. Poll this until the status is terminal before using the agent's result.",
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'Task id returned by `kman_run_agent`.' },
      logs: {
        type: 'boolean',
        description: 'Include the captured output. Defaults to true once the task is terminal.',
      },
    },
    required: ['task_id'],
    additionalProperties: false,
  },
};

export function listTools(): ToolDef[] {
  return [KMAN_LIST_AGENTS, KMAN_DESCRIBE_AGENT, KMAN_RUN_AGENT, KMAN_GET_TASK];
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolHandlerCtx,
): Promise<ToolCallResult> {
  switch (name) {
    case KMAN_LIST_AGENTS.name:
      return handleList(ctx);
    case KMAN_DESCRIBE_AGENT.name:
      return handleDescribe(args);
    case KMAN_RUN_AGENT.name:
      return handleRun(args, ctx);
    case KMAN_GET_TASK.name:
      return handleGetTask(args, ctx);
    default:
      throw new RpcError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}

async function handleList(ctx: ToolHandlerCtx): Promise<ToolCallResult> {
  const agents = await listAgents(ctx.selfAgent);
  return {
    content: [
      {
        type: 'text',
        text:
          agents.length === 0
            ? 'No kman agents found at ~/.kman/agents/. Create one with `kman agent create <name>`.'
            : JSON.stringify(agents, null, 2),
      },
    ],
  };
}

async function handleDescribe(args: Record<string, unknown>): Promise<ToolCallResult> {
  const agent = stringArg(args, 'agent');
  if (!(await agentExists(agent))) {
    return errorResult(`Agent "${agent}" not found at ~/.kman/agents/${agent}/.`);
  }
  const detail = await describeAgent(agent);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            name: detail.profile.name,
            description: detail.profile.description,
            runtime: detail.profile.runtime,
            soul: { prompt_file: detail.profile.soul.prompt_file, contents: detail.soul },
            defaults: detail.profile.defaults,
            directory: detail.directory,
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function handleRun(args: Record<string, unknown>, ctx: ToolHandlerCtx): Promise<ToolCallResult> {
  const agent = stringArg(args, 'agent');
  const task = stringArg(args, 'task');

  if (ctx.selfAgent && agent === ctx.selfAgent) {
    return errorResult(
      `Refusing to delegate to "${agent}" — that is the agent currently running this MCP server. ` +
        'Self-delegation would loop the agent forever.',
    );
  }

  if (!(await agentExists(agent))) {
    return errorResult(`Agent "${agent}" not found at ~/.kman/agents/${agent}/.`);
  }

  let result: Awaited<ReturnType<typeof submitAgentTask>>;
  try {
    result = await submitAgentTask(
      ctx.invocation,
      {
        agent,
        task,
        ...(typeof args['runtime'] === 'string' ? { runtime: args['runtime'] as string } : {}),
        ...(typeof args['model'] === 'string' ? { model: args['model'] as string } : {}),
        ...(typeof args['permission'] === 'string'
          ? { permission: args['permission'] as 'ask' | 'auto' | 'yolo' }
          : {}),
        ...(typeof args['cwd'] === 'string' ? { cwd: args['cwd'] as string } : {}),
      },
      ctx.runTimeoutMs,
    );
  } catch (err) {
    return errorResult(
      `Failed to spawn kman subprocess: ${(err as Error).message}. Check that 'kman' is on PATH or set KMAN_BIN.`,
    );
  }

  if ('error' in result) {
    return errorResult(`Agent "${agent}" could not be started: ${result.error}`);
  }

  return {
    content: [
      {
        type: 'text',
        text:
          `Task ${result.taskId} submitted to agent "${agent}" and is running in the background.\n` +
          `Poll \`kman_get_task\` with task_id "${result.taskId}" to check its status and read the result.`,
      },
    ],
  };
}

async function handleGetTask(args: Record<string, unknown>, ctx: ToolHandlerCtx): Promise<ToolCallResult> {
  const taskId = stringArg(args, 'task_id');
  const wantLogs = typeof args['logs'] === 'boolean' ? (args['logs'] as boolean) : undefined;

  let snapshot: Awaited<ReturnType<typeof getTask>>;
  try {
    snapshot = await getTask(ctx.invocation, taskId);
  } catch (err) {
    return errorResult(
      `Failed to spawn kman subprocess: ${(err as Error).message}. Check that 'kman' is on PATH or set KMAN_BIN.`,
    );
  }
  if (!('status' in snapshot)) {
    return errorResult(snapshot.error);
  }

  const terminal = TERMINAL_STATUSES.has(snapshot.status);
  const includeLogs = wantLogs ?? terminal;

  let logs = '';
  if (includeLogs) {
    const logResult = await getTaskLogs(ctx.invocation, taskId);
    if ('error' in logResult) {
      logs = `(could not read logs: ${logResult.error})`;
    } else {
      logs = logResult.logs.trim();
    }
  }

  const lines: string[] = [
    `task:    ${snapshot.id}`,
    `agent:   ${snapshot.agent}`,
    `status:  ${snapshot.status}`,
  ];
  if (snapshot.exitCode !== undefined) lines.push(`exit:    ${snapshot.exitCode}`);
  if (snapshot.error) lines.push(`error:   ${snapshot.error}`);
  if (!terminal) {
    lines.push('', 'Still in progress — poll `kman_get_task` again shortly.');
  }
  if (includeLogs) {
    lines.push('', '--- output ---', logs.length > 0 ? logs : '(no output yet)');
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    ...(snapshot.status === 'failed' ? { isError: true } : {}),
  };
}

const TERMINAL_STATUSES: ReadonlySet<TaskSnapshot['status']> = new Set([
  'succeeded',
  'failed',
  'canceled',
]);

function stringArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new RpcError(ErrorCode.InvalidParams, `Missing or non-string argument: "${key}".`);
  }
  return v;
}

function errorResult(text: string): ToolCallResult {
  return { content: [{ type: 'text', text }], isError: true };
}
