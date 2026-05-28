import { agentExists, describeAgent, listAgents } from './agents.js';
import { runAgent, type RunAgentResult } from './runner.js';
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
    'List every agent managed by kman on this machine. Returns one entry per ' +
    '`~/.kman/agents/<name>/` directory, with the agent name, description, default ' +
    'runtime, and default model. Use this first to discover what specialist agents ' +
    'are available before delegating work with `kman_run_agent`.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

const KMAN_DESCRIBE_AGENT: ToolDef = {
  name: 'kman_describe_agent',
  description:
    "Fetch a single agent's profile and soul prompt so the caller can decide " +
    'whether the agent is the right specialist for a task. Returns the parsed ' +
    '`agent.toml` plus the contents of `soul.md`.',
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
    "Dispatch a task to a kman-managed agent. Runs `kman -a <agent> run --task " +
    '<task>` as a subprocess and returns the assistant\'s stdout. Use this when ' +
    'the current agent needs help from a peer specialist — pick the agent name ' +
    'from `kman_list_agents`. Each call is a fresh one-shot run; sessions are not ' +
    'preserved across calls.',
  inputSchema: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'Target agent (must exist on disk).' },
      task: { type: 'string', description: 'Task description handed to the peer.' },
      runtime: {
        type: 'string',
        description: "Override the agent's default runtime (claude-code | copilot-cli).",
      },
      model: { type: 'string', description: "Override the agent's default model." },
      permission: { enum: ['ask', 'auto', 'yolo'] },
      cwd: { type: 'string', description: 'Working directory for the spawned runtime.' },
    },
    required: ['agent', 'task'],
    additionalProperties: false,
  },
};

export function listTools(): ToolDef[] {
  return [KMAN_LIST_AGENTS, KMAN_DESCRIBE_AGENT, KMAN_RUN_AGENT];
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

  // KMAN_RUN_CHAIN is a comma-separated list of agents in the current
  // delegation stack. Cycles of any depth (a → b → a) get rejected here
  // before we spawn another backend. Strip an unsubstituted `${...}`
  // placeholder — that means the host never set the var.
  const rawChain = process.env['KMAN_RUN_CHAIN'];
  const chain = rawChain && !rawChain.includes('${') ? rawChain.split(',').filter(Boolean) : [];
  if (chain.includes(agent)) {
    return errorResult(
      `Refusing to delegate to "${agent}" — cycle detected (chain so far: ${chain.join(' → ')}).`,
    );
  }
  if (chain.length >= 8) {
    return errorResult(`Delegation depth limit reached (chain: ${chain.join(' → ')}).`);
  }

  if (!(await agentExists(agent))) {
    return errorResult(`Agent "${agent}" not found at ~/.kman/agents/${agent}/.`);
  }

  let result: RunAgentResult;
  try {
    result = await runAgent(
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
        appendToRunChain: ctx.selfAgent ?? agent,
      },
      ctx.runTimeoutMs,
    );
  } catch (err) {
    return errorResult(
      `Failed to spawn kman subprocess: ${(err as Error).message}. Check that 'kman' is on PATH or set KMAN_BIN.`,
    );
  }

  const text = result.stdout.trim();
  if (result.exitCode === 0) {
    return {
      content: [{ type: 'text', text: text.length > 0 ? text : '(agent produced no output)' }],
    };
  }
  return errorResult(
    `Agent "${agent}" exited with code ${result.exitCode}.\n` +
      (result.stderr ? `stderr:\n${result.stderr.trim()}\n` : '') +
      (text ? `stdout:\n${text}` : ''),
  );
}

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
