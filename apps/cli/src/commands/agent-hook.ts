import { defineCommand } from "citty";

export const hookCommand = defineCommand({
  meta: { name: "hook", description: "Manage agent hooks (pre_run / post_run / on_error / pre_memory_write)" },
  subCommands: {
    list: defineCommand({
      meta: { name: "list", description: "List hooks for an agent" },
      args: { agent: { type: "positional", required: true } },
      run: ({ args }) => console.log(`[stub] hook list ${args.agent}`),
    }),
    add: defineCommand({
      meta: { name: "add", description: "Add a hook for an event" },
      args: {
        agent: { type: "positional", required: true },
        event: { type: "positional", required: true, description: "pre_run | post_run | on_error | pre_memory_write" },
        command: { type: "string", description: "Shell command to run" },
        script: { type: "string", description: "Path to script (relative to agent dir)" },
        "on-success-only": { type: "boolean", default: false },
      },
      run: ({ args }) => console.log(`[stub] hook add ${args.agent} ${args.event}`),
    }),
    remove: defineCommand({
      meta: { name: "remove", description: "Remove a hook by index" },
      args: {
        agent: { type: "positional", required: true },
        event: { type: "positional", required: true },
        index: { type: "positional", required: true },
      },
      run: ({ args }) => console.log(`[stub] hook remove ${args.agent} ${args.event}#${args.index}`),
    }),
    test: defineCommand({
      meta: { name: "test", description: "Print the stdin payload that would be sent to hooks of an event" },
      args: {
        agent: { type: "positional", required: true },
        event: { type: "positional", required: true },
      },
      run: ({ args }) => console.log(`[stub] hook test ${args.agent} ${args.event}`),
    }),
  },
});
