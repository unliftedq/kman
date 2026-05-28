/**
 * MCP prompts — reusable templates the host can surface to the user as
 * slash commands. Each prompt expands into a single user-role message
 * pre-loaded with the right kman tool-use guidance, so the LLM doesn't
 * have to rediscover the discovery → delegate pattern every time.
 *
 * Prompts complement the server-level `instructions` (set on initialize):
 * `instructions` shapes the model's default behavior; prompts give the
 * user explicit on-ramps.
 */
import { ErrorCode, RpcError } from './protocol.js';

export interface PromptArg {
  name: string;
  description: string;
  required: boolean;
}

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

const FIND_AGENT: PromptDef = {
  name: 'find-agent',
  description:
    'Find the best kman-managed agent for a task and explain the choice.',
  arguments: [
    { name: 'task', description: 'Short natural-language goal.', required: true },
  ],
};

const LIST_AGENTS: PromptDef = {
  name: 'list-agents',
  description: 'List the available kman-managed agents in a readable summary.',
  arguments: [],
};

const DELEGATE: PromptDef = {
  name: 'delegate-task',
  description:
    'Run a task with a specific kman-managed agent and summarize the result.',
  arguments: [
    { name: 'agent', description: 'Target agent name (lowercase kebab-case).', required: true },
    { name: 'task', description: 'Self-contained task for the peer agent.', required: true },
  ],
};

const SECOND_OPINION: PromptDef = {
  name: 'second-opinion',
  description:
    "Ask a peer agent for an independent take on an analysis, review, or trade-off.",
  arguments: [
    { name: 'agent', description: 'Peer agent name.', required: true },
    { name: 'topic', description: 'Topic plus your current analysis for context.', required: true },
  ],
};

export function listPrompts(): PromptDef[] {
  return [LIST_AGENTS, FIND_AGENT, DELEGATE, SECOND_OPINION];
}

export function getPrompt(name: string, args: Record<string, string>): PromptResult {
  switch (name) {
    case LIST_AGENTS.name:
      return {
        description: LIST_AGENTS.description,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Call kman_list_agents and summarize the available agents in a compact, readable list. ` +
                `Include each agent's name, description, default runtime, and model when present.`,
            },
          },
        ],
      };
    case FIND_AGENT.name: {
      const task = requireArg(args, 'task');
      return {
        description: FIND_AGENT.description,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Task: ${task}\n\n` +
                `Call kman_list_agents, choose the single best-fit agent, and explain the choice ` +
                `in one sentence. If the roster summary is not enough, call kman_describe_agent ` +
                `for the top candidate(s) before deciding. Ask me before dispatching with kman_run_agent.`,
            },
          },
        ],
      };
    }
    case DELEGATE.name: {
      const agent = requireArg(args, 'agent');
      const task = requireArg(args, 'task');
      return {
        description: DELEGATE.description,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Run this task with the kman-managed agent "${agent}":\n\n${task}\n\n` +
                `Call kman_run_agent with agent="${agent}". Summarize the result in your own ` +
                `words and flag anything the agent could not complete.`,
            },
          },
        ],
      };
    }
    case SECOND_OPINION.name: {
      const agent = requireArg(args, 'agent');
      const topic = requireArg(args, 'topic');
      return {
        description: SECOND_OPINION.description,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Get a second opinion from the kman-managed agent "${agent}" on:\n\n${topic}\n\n` +
                `First call kman_describe_agent to confirm the agent is a good fit. If so, call ` +
                `kman_run_agent with enough context for an independent take; do not just forward ` +
                `my wording verbatim. Compare their view to mine and tell me where you net out.`,
            },
          },
        ],
      };
    }
    default:
      throw new RpcError(ErrorCode.InvalidParams, `Unknown prompt: ${name}`);
  }
}

function requireArg(args: Record<string, string>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new RpcError(ErrorCode.InvalidParams, `Missing required argument: "${key}".`);
  }
  return v;
}
