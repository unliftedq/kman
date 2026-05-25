import { defineCommand } from "citty";
import { runFromEnv, runStdio } from "@delego/mcp-server";
import { locationsFor } from "@delego/core";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { s, sOpt } from "../arg-helpers";

export const mcpCommand = defineCommand({
  meta: { name: "mcp", description: "Manage the global MCP server registry; run the delego MCP server" },
  subCommands: {
    add: defineCommand({
      meta: { name: "add", description: "Register an MCP server in ~/.delego/mcp.d/" },
      args: {
        name: { type: "positional", required: true },
        type: { type: "string", description: "stdio | sse | streamable-http", default: "stdio" },
        command: { type: "string" },
        args: { type: "string", description: "Space-separated args" },
        url: { type: "string", description: "For sse / http" },
        "env-from": { type: "string", description: "Env var to read from shell (repeatable)" },
        "env-from-keyring": { type: "string", description: "Env var to read from OS keyring (repeatable)" },
      },
      run: ({ args }) => console.log(`[stub] mcp add ${s(args.name)} — global MCP registry deferred to a later milestone`),
    }),
    list: defineCommand({
      meta: { name: "list", description: "List registered MCP servers" },
      run: () => console.log("(global MCP registry not yet implemented — deferred to a later milestone)"),
    }),
    show: defineCommand({
      meta: { name: "show", description: "Show an MCP server's config" },
      args: { name: { type: "positional", required: true } },
      run: ({ args }) => console.log(`[stub] mcp show ${s(args.name)}`),
    }),
    remove: defineCommand({
      meta: { name: "remove", description: "Unregister an MCP server" },
      args: { name: { type: "positional", required: true } },
      run: ({ args }) => console.log(`[stub] mcp remove ${s(args.name)}`),
    }),
    test: defineCommand({
      meta: { name: "test", description: "Spawn an MCP server, list its tools, exit" },
      args: { name: { type: "positional", required: true } },
      run: ({ args }) => console.log(`[stub] mcp test ${s(args.name)}`),
    }),
    serve: defineCommand({
      meta: {
        name: "serve",
        description:
          "Run the delego MCP server (stdio). Usually spawned by the launcher with agent context in env vars (DELEGO_MCP_AGENT, DELEGO_MCP_MEMORY_PATH, DELEGO_MCP_CHAR_LIMIT, DELEGO_MCP_MEMORY_ENABLED). Use --agent for manual invocation.",
      },
      args: {
        agent: { type: "string", description: "Agent name (manual override; otherwise reads DELEGO_MCP_AGENT)" },
      },
      run: async ({ args }) => {
        const manualAgent = sOpt(args.agent);
        if (manualAgent) {
          const loc = locationsFor(manualAgent);
          if (!existsSync(loc.configPath)) {
            console.error(`Agent "${manualAgent}" not found at ${loc.dir}`);
            process.exit(2);
          }
          // Minimal manual mode: load profile to get char_limit, expose memory if enabled.
          const { loadAgent } = await import("@delego/core");
          const profile = await loadAgent(manualAgent);
          await runStdio({
            agentName: manualAgent,
            memoryPath: join(loc.dir, "memories", "MEMORY.md"),
            memoryCharLimit: profile.memory.char_limit,
            memoryEnabled: profile.memory.enabled,
          });
          return;
        }
        await runFromEnv();
      },
    }),
  },
});
