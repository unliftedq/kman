/**
 * Reusable kman workflow prompt templates.
 *
 * These describe the "discovery → delegate" patterns the host can surface to
 * the user. They are consumed two ways:
 *  - `@kman/mcp-server` exposes them over MCP (`prompts/list`, `prompts/get`)
 *    for hosts that surface MCP prompts as slash commands (e.g. claude-code).
 *  - The runtime-plugin materializer renders them into plugin *commands* for
 *    hosts that do not consume MCP prompts (e.g. copilot-cli), so the same
 *    workflows appear as `/list-agents`, `/find-agent`, … there too.
 *
 * Keeping the definitions here (in core) makes them the single source of truth
 * without `core` depending on `mcp-server` (which already depends on `core`).
 */

export interface PromptArg {
  name: string;
  description: string;
  required: boolean;
}

/** Metadata describing a prompt, mirroring the MCP `prompts/list` shape. */
export interface PromptDef {
  name: string;
  description: string;
  arguments: PromptArg[];
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: { type: 'text'; text: string };
}

export interface PromptResult {
  description: string;
  messages: PromptMessage[];
}

/** Thrown for an unknown prompt name or a missing required argument. */
export class PromptArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptArgumentError';
  }
}

interface PromptTemplate extends PromptDef {
  /** Build the single user-message body from argument values. */
  buildText(args: Record<string, string>): string;
}

const TEMPLATES: PromptTemplate[] = [
  {
    name: 'list-agents',
    description: 'List the available kman-managed agents in a readable summary.',
    arguments: [],
    buildText: () =>
      `Call kman_list_agents and summarize the available agents in a compact, readable list. ` +
      `Include each agent's name, description, default runtime, and model when present.`,
  },
  {
    name: 'find-agent',
    description: 'Find the best kman-managed agent for a task and explain the choice.',
    arguments: [{ name: 'task', description: 'Short natural-language goal.', required: true }],
    buildText: (a) =>
      `Task: ${a['task']}\n\n` +
      `Call kman_list_agents, choose the single best-fit agent, and explain the choice ` +
      `in one sentence. If the roster summary is not enough, call kman_describe_agent ` +
      `for the top candidate(s) before deciding. Ask me before dispatching with kman_run_agent.`,
  },
  {
    name: 'delegate-task',
    description: 'Run a task with a specific kman-managed agent and summarize the result.',
    arguments: [
      { name: 'agent', description: 'Target agent name (lowercase kebab-case).', required: true },
      { name: 'task', description: 'Self-contained task for the peer agent.', required: true },
    ],
    buildText: (a) =>
      `Run this task with the kman-managed agent "${a['agent']}":\n\n${a['task']}\n\n` +
      `Call kman_run_agent with agent="${a['agent']}". Summarize the result in your own ` +
      `words and flag anything the agent could not complete.`,
  },
  {
    name: 'second-opinion',
    description:
      "Ask a peer agent for an independent take on an analysis, review, or trade-off.",
    arguments: [
      { name: 'agent', description: 'Peer agent name.', required: true },
      { name: 'topic', description: 'Topic plus your current analysis for context.', required: true },
    ],
    buildText: (a) =>
      `Get a second opinion from the kman-managed agent "${a['agent']}" on:\n\n${a['topic']}\n\n` +
      `First call kman_describe_agent to confirm the agent is a good fit. If so, call ` +
      `kman_run_agent with enough context for an independent take; do not just forward ` +
      `my wording verbatim. Compare their view to mine and tell me where you net out.`,
  },
];

/** List prompt metadata (name, description, arguments) for `prompts/list`. */
export function listPromptTemplates(): PromptDef[] {
  return TEMPLATES.map(({ name, description, arguments: args }) => ({
    name,
    description,
    arguments: args,
  }));
}

/**
 * Render a prompt template into a single-user-message result. Throws
 * {@link PromptArgumentError} for an unknown name or a missing required arg.
 */
export function renderPromptTemplate(
  name: string,
  args: Record<string, string>,
): PromptResult {
  const template = TEMPLATES.find((t) => t.name === name);
  if (!template) throw new PromptArgumentError(`Unknown prompt: ${name}`);

  for (const arg of template.arguments) {
    const value = args[arg.name];
    if (arg.required && (typeof value !== 'string' || value.length === 0)) {
      throw new PromptArgumentError(`Missing required argument: "${arg.name}".`);
    }
  }

  return {
    description: template.description,
    messages: [
      { role: 'user', content: { type: 'text', text: template.buildText(args) } },
    ],
  };
}

/**
 * Render every prompt template into a plugin *command* file, for hosts that
 * surface plugin commands but not MCP prompts (copilot-cli).
 *
 * The command name is the prompt name (so users type `/list-agents`). Argument
 * values are mapped to the host's command-substitution tokens: a single free
 * argument becomes `$ARGUMENTS` (everything typed after the command); multiple
 * arguments become positional `$1`, `$2`, … A short usage line documents the
 * expected input so the model can also parse free-form text.
 */
export function promptCommandFiles(): { name: string; content: string }[] {
  return TEMPLATES.map((template) => {
    const args = commandArgValues(template.arguments);
    const usage = usageLine(template);
    const body = template.buildText(args);
    const content =
      `---\n` +
      `description: ${template.description}\n` +
      `---\n\n` +
      (usage ? `${usage}\n\n` : '') +
      `${body}\n`;
    return { name: template.name, content };
  });
}

/** Map each argument to its host command-substitution token. */
function commandArgValues(args: PromptArg[]): Record<string, string> {
  const values: Record<string, string> = {};
  if (args.length === 1) {
    values[args[0]!.name] = '$ARGUMENTS';
  } else {
    args.forEach((arg, i) => {
      values[arg.name] = `$${i + 1}`;
    });
  }
  return values;
}

/** A human-readable usage hint describing the command's arguments. */
function usageLine(template: PromptTemplate): string {
  if (template.arguments.length === 0) return '';
  if (template.arguments.length === 1) {
    return `Usage: /${template.name} <${template.arguments[0]!.name}>`;
  }
  const positional = template.arguments.map((a) => `<${a.name}>`).join(' ');
  return `Usage: /${template.name} ${positional}`;
}
