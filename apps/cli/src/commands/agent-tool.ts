import { defineCommand } from "citty";

export const toolCommand = defineCommand({
  meta: { name: "tool", description: "Manage tools wired into an agent's profile" },
  subCommands: {
    add: defineCommand({
      meta: { name: "add", description: "Add a tool entry to the agent profile" },
      args: {
        agent: { type: "positional", required: true },
        name: { type: "positional", required: true },
        type: { type: "string", required: true, description: "mcp | shell | http" },
        server: { type: "string", description: "MCP server name (for type=mcp)" },
        include: { type: "string", description: "Comma-separated tool subset (for type=mcp)" },
        cmd: { type: "string", description: "Shell command template (for type=shell)" },
        url: { type: "string", description: "HTTP endpoint (for type=http)" },
        method: { type: "string", description: "HTTP method", default: "POST" },
      },
      run: ({ args }) => console.log(`[stub] tool add ${args.agent} ${args.name} (${args.type})`),
    }),
    remove: defineCommand({
      meta: { name: "remove", description: "Remove a tool entry" },
      args: {
        agent: { type: "positional", required: true },
        name: { type: "positional", required: true },
      },
      run: ({ args }) => console.log(`[stub] tool remove ${args.agent} ${args.name}`),
    }),
    list: defineCommand({
      meta: { name: "list", description: "List tool entries of an agent" },
      args: { agent: { type: "positional", required: true } },
      run: ({ args }) => console.log(`[stub] tool list ${args.agent}`),
    }),
  },
});
