import { defineCommand } from "citty";

export const doctorCommand = defineCommand({
  meta: { name: "doctor", description: "Diagnose backend installs, MCP servers, and keyring access" },
  run: () => {
    console.log("[stub] doctor");
  },
});
