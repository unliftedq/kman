import { defineCommand } from "citty";

export const chatCommand = defineCommand({
  meta: { name: "chat", description: "Start an interactive REPL with an agent" },
  args: {
    agent: { type: "positional", required: true },
    runtime: { type: "string", description: "Override default backend" },
    resume: { type: "string", description: "Resume a session" },
  },
  run: ({ args }) => {
    console.log(`[stub] chat ${args.agent}`);
  },
});
