import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MemoryStore } from "@delego/core";

import { registerMemoryTool, ToolRegistry } from "./tools/memory";
import { registerDelegateTools } from "./tools/delegate";
import { registerSkillsTool } from "./tools/skills";

export interface DelegoServerOptions {
  /** Agent identity this server instance is bound to. */
  agentName: string;
  /** Absolute path to this agent's MEMORY.md. */
  memoryPath: string;
  /** Memory char limit (defaults to 2200). */
  memoryCharLimit: number;
  /** Whether memory tool should be exposed (off when agent has memory disabled). */
  memoryEnabled: boolean;

  // ----- Skills -----
  /** Absolute path to the agent's skills directory. */
  skillsDir?: string;
  /** Names of skills enabled for this agent. */
  enabledSkills?: readonly string[];

  // ----- Multi-agent (M5) -----
  /** Peer agents available for `delegate_<peer>` tools. */
  peers?: readonly string[];
  /** Current run-chain (oldest → newest), including the calling agent at the tail. */
  runChain?: readonly string[];
  /** Max chain length. Defaults to 3. */
  maxSpawnDepth?: number;
  /** Executable used to re-invoke the delego CLI for sub-runs. */
  cliCommand?: string;
  /** Leading argv before the subcommand (script path in dev; empty in compiled binary). */
  cliLeadArgs?: readonly string[];
}

export const DEFAULT_MAX_SPAWN_DEPTH = 3;

/** Construct a per-agent-context delego MCP server (no transport attached yet). */
export function createDelegoServer(opts: DelegoServerOptions): Server {
  const server = new Server(
    {
      name: "delego",
      version: "0.0.0",
    },
    {
      capabilities: { tools: {} },
    },
  );

  const registry = new ToolRegistry();

  if (opts.memoryEnabled) {
    const store = new MemoryStore({ path: opts.memoryPath, charLimit: opts.memoryCharLimit });
    registerMemoryTool(server, { store }, registry);
  }

  const enabledSkills = opts.enabledSkills ?? [];
  if (opts.skillsDir && enabledSkills.length > 0) {
    registerSkillsTool(server, { skillsDir: opts.skillsDir, enabledSkills }, registry);
  }

  // delegate_<peer> tools (M5). Only register when we know how to re-invoke
  // the CLI; otherwise silently skip — the memory tool path still works.
  const peers = opts.peers ?? [];
  if (peers.length > 0 && opts.cliCommand) {
    registerDelegateTools(server, registry, {
      agentName: opts.agentName,
      peers,
      runChain: opts.runChain ?? [opts.agentName],
      maxDepth: opts.maxSpawnDepth ?? DEFAULT_MAX_SPAWN_DEPTH,
      cliCommand: opts.cliCommand,
      cliLeadArgs: opts.cliLeadArgs ?? [],
    });
  }

  // Always ensure list_tools / call_tools handlers respond even when no tools
  // are registered (otherwise clients see "Method not found").
  registry.ensureHandlersInstalled(server);

  return server;
}

/** Run the delego MCP server as a long-lived stdio process. */
export async function runStdio(opts: DelegoServerOptions): Promise<void> {
  const server = createDelegoServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server now runs until the parent process closes our stdio.
}

/**
 * Entry point used by `delego mcp serve`. Reads its agent binding from env
 * (set by the launcher before spawn), or from --flag args parsed by the caller.
 */
export async function runFromEnv(): Promise<void> {
  const agentName = required("DELEGO_MCP_AGENT");
  const memoryPath = required("DELEGO_MCP_MEMORY_PATH");
  const memoryCharLimit = Number.parseInt(process.env.DELEGO_MCP_CHAR_LIMIT ?? "2200", 10);
  const memoryEnabled = (process.env.DELEGO_MCP_MEMORY_ENABLED ?? "1") !== "0";

  const peers = splitCsv(process.env.DELEGO_MCP_PEERS);
  const runChain = splitCsv(process.env.DELEGO_MCP_RUN_CHAIN);
  const maxSpawnDepth = Number.parseInt(
    process.env.DELEGO_MAX_SPAWN_DEPTH ?? String(DEFAULT_MAX_SPAWN_DEPTH),
    10,
  );
  const cliCommand = process.env.DELEGO_MCP_CLI_COMMAND;
  const cliLeadArgs = parseJsonArray(process.env.DELEGO_MCP_CLI_LEAD_ARGS);

  const skillsDir = process.env.DELEGO_MCP_SKILLS_DIR;
  const enabledSkills = splitCsv(process.env.DELEGO_MCP_SKILLS);

  const opts: DelegoServerOptions = {
    agentName,
    memoryPath,
    memoryCharLimit,
    memoryEnabled,
    ...(skillsDir ? { skillsDir, enabledSkills } : {}),
    peers,
    runChain: runChain.length > 0 ? runChain : [agentName],
    maxSpawnDepth: Number.isFinite(maxSpawnDepth) ? maxSpawnDepth : DEFAULT_MAX_SPAWN_DEPTH,
    ...(cliCommand ? { cliCommand } : {}),
    cliLeadArgs,
  };

  await runStdio(opts);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. The delego MCP server expects to be launched with agent context bound.`,
    );
  }
  return v;
}

function splitCsv(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseJsonArray(v: string | undefined): string[] {
  if (!v) return [];
  try {
    const parsed = JSON.parse(v) as unknown;
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed as string[];
    }
  } catch {
    // fall through
  }
  return [];
}
