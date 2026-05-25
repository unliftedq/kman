import { defineCommand } from "citty";

export const configCommand = defineCommand({
  meta: { name: "config", description: "Read / write delego global config" },
  subCommands: {
    show: defineCommand({
      meta: { name: "show", description: "Show current config" },
      run: () => console.log("[stub] config show"),
    }),
    set: defineCommand({
      meta: { name: "set", description: "Set a config key" },
      args: {
        key: { type: "positional", required: true },
        value: { type: "positional", required: true },
      },
      run: ({ args }) => console.log(`[stub] config set ${args.key} = ${args.value}`),
    }),
  },
});
