import { randomUUID } from "node:crypto";
import type {
  AgentContext,
  BackendName,
  McpServerSpec,
  OutputFormat,
  PermissionMode,
  Profile,
} from "@delego/types";

import { listAgentNames, loadAgent, locationsFor } from "../profile";
import { renderSystemPrompt } from "../prompt";
import { selfInvocationArgs } from "../launcher/self-invoke";

export interface CliOverrides {
  runtime?: BackendName;
  model?: string;
  permission?: PermissionMode;
  outputFormat?: OutputFormat;
  maxTurns?: number;
  noMemory?: boolean;
  cwd?: string;
  runtimeRawFlags?: Record<string, string>;
}

function nowSessionId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${stamp}-${randomUUID().slice(0, 6)}`;
}

/**
 * Build an immutable AgentContext from disk + CLI overrides.
 *
 * Workflow (Decision 11):
 *   1. resolve agent name
 *   2. load profile from disk
 *   3. apply CLI overrides ONTO the resulting context (not onto raw profile)
 *   4. render system prompt (soul + memory snapshot)
 *   5. resolve peer agent list (all OTHER registered agents)
 *   6. resolve effective MCP server list (external + auto-injected `delego` server)
 */
export async function buildAgentContext(
  agentName: string,
  overrides: CliOverrides = {},
): Promise<AgentContext> {
  const profile: Profile = await loadAgent(agentName);
  const loc = locationsFor(agentName);

  const runtime: BackendName = overrides.runtime ?? profile.runtime.default;
  const model = overrides.model ?? profile.runtime.model;
  const permission: PermissionMode = overrides.permission ?? profile.defaults.permission_mode;
  const outputFormat: OutputFormat = overrides.outputFormat ?? profile.defaults.output_format;
  const maxTurns = overrides.maxTurns ?? profile.defaults.max_turns;
  const cwd = overrides.cwd ?? process.cwd();

  const memoryEnabled = overrides.noMemory ? false : profile.memory.enabled;

  const systemPrompt = await renderSystemPrompt({
    soulPath: loc.soulPath,
    memoryPath: loc.memoryPath,
    memoryEnabled,
    memoryCharLimit: profile.memory.char_limit,
  });

  const allAgents = await listAgentNames();
  const peerAgents = allAgents.filter((n) => n !== agentName);

  const sessionId = nowSessionId();
  const runId = randomUUID();

  const runChain = currentRunChain(agentName);

  const mcpServers = resolveMcpServers({
    agentName,
    memoryEnabled,
    memoryPath: loc.memoryPath,
    memoryCharLimit: profile.memory.char_limit,
    peerAgents,
    runChain,
  });

  const ctx: AgentContext = {
    agentName,
    runId,
    sessionId,
    agentDir: loc.dir,
    memoryPath: loc.memoryPath,
    sessionsDir: loc.sessionsDir,
    hooksDir: loc.hooksDir,
    runtime,
    ...(model ? { model } : {}),
    permission,
    outputFormat,
    maxTurns,
    cwd,
    memory: {
      enabled: memoryEnabled,
      char_limit: profile.memory.char_limit,
      provider: profile.memory.provider,
      snapshot: systemPrompt, // full prompt; backend gets the same string
    },
    tools: profile.tools,
    hooks: profile.hooks,
    systemPrompt,
    mcpServers,
    peerAgents,
    runtimeRawFlags: overrides.runtimeRawFlags ?? {},
    profile,
  };

  return ctx;
}

interface McpResolveOpts {
  agentName: string;
  memoryEnabled: boolean;
  memoryPath: string;
  memoryCharLimit: number;
  peerAgents: readonly string[];
  runChain: readonly string[];
}

function resolveMcpServers(opts: McpResolveOpts): McpServerSpec[] {
  const servers: McpServerSpec[] = [];

  // Auto-inject the `delego` server (per-run, bound to this agent's context).
  // Hosts the `memory` tool plus one `delegate_<peer>` per eligible peer agent (M5).
  const inv = selfInvocationArgs(["mcp", "serve"]);
  // Compute the *base* invocation (no subcommand) for sub-runs delegated via MCP.
  const baseInv = selfInvocationArgs([]);

  servers.push({
    name: "delego",
    type: "stdio",
    command: inv.command,
    args: inv.args,
    env: {
      DELEGO_MCP_AGENT: opts.agentName,
      DELEGO_MCP_MEMORY_PATH: opts.memoryPath,
      DELEGO_MCP_CHAR_LIMIT: String(opts.memoryCharLimit),
      DELEGO_MCP_MEMORY_ENABLED: opts.memoryEnabled ? "1" : "0",
      DELEGO_MCP_PEERS: opts.peerAgents.join(","),
      DELEGO_MCP_RUN_CHAIN: opts.runChain.join(","),
      DELEGO_MCP_CLI_COMMAND: baseInv.command,
      DELEGO_MCP_CLI_LEAD_ARGS: JSON.stringify(baseInv.args),
      ...(process.env.DELEGO_MAX_SPAWN_DEPTH
        ? { DELEGO_MAX_SPAWN_DEPTH: process.env.DELEGO_MAX_SPAWN_DEPTH }
        : {}),
    },
  });

  // TODO(M3.5+): walk profile.tools, resolve type=mcp entries against ~/.delego/mcp.d/
  // and append them here.

  return servers;
}

/**
 * Read the inherited DELEGO_RUN_CHAIN (set by a parent delego process when this
 * agent is being invoked via a `delegate_<peer>` MCP tool). The current agent
 * name is always appended if missing, so the chain accurately reflects the
 * complete ancestry of this run.
 */
function currentRunChain(agentName: string): string[] {
  const raw = process.env.DELEGO_RUN_CHAIN ?? "";
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return [agentName];
  if (parts[parts.length - 1] !== agentName) parts.push(agentName);
  return parts;
}
