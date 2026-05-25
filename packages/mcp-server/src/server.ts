import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MemoryStore } from "@delego/core";

import { registerMemoryTool, ToolRegistry } from "./tools/memory";

export interface DelegoServerOptions {
  /** Agent identity this server instance is bound to. */
  agentName: string;
  /** Absolute path to this agent's MEMORY.md. */
  memoryPath: string;
  /** Memory char limit (defaults to 2200). */
  memoryCharLimit: number;
  /** Whether memory tool should be exposed (off when agent has memory disabled). */
  memoryEnabled: boolean;
}

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
  } else {
    // Even with memory disabled, install handlers so list_tools returns an empty array
    // (otherwise clients see a "Method not found" error on list_tools).
    registry.ensureHandlersInstalled(server);
  }

  // TODO(M5): registerDelegateTools(server, registry, opts.peerAgents);

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
  await runStdio({ agentName, memoryPath, memoryCharLimit, memoryEnabled });
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
