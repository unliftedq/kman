#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { version } from "../package.json" with { type: "json" };

import { agentCommand } from "./commands/agent";
import { runCommand } from "./commands/run";
import { chatCommand } from "./commands/chat";
import { mcpCommand } from "./commands/mcp";
import { sessionsCommand } from "./commands/sessions";
import { configCommand } from "./commands/config";
import { doctorCommand } from "./commands/doctor";
import { buildAgentScopeCommand } from "./commands/agent-scope";

function extractProfile(): string | undefined {
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "-p" || arg === "--profile") {
      const name = argv[i + 1];
      if (!name || name.startsWith("-")) {
        console.error("delego: --profile requires an agent name — e.g. `delego -p myagent chat`");
        process.exit(1);
      }
      argv.splice(i, 2);
      return name;
    }
    if (arg.startsWith("--profile=")) {
      const name = arg.slice("--profile=".length);
      if (!name) {
        console.error("delego: --profile= requires an agent name — e.g. `delego --profile=myagent chat`");
        process.exit(1);
      }
      argv.splice(i, 1);
      return name;
    }
  }
  return undefined;
}

const profileName = extractProfile();

if (profileName) {
  runMain(buildAgentScopeCommand(profileName));
} else {
  const main = defineCommand({
    meta: {
      name: "delego",
      version,
      description: [
        "A multi-agent orchestration engine",
        "",
        "  -p, --profile <name>  scope all subcommands to an agent",
        "    delego -p myagent run --task '...'   # one-shot run",
        "    delego -p myagent chat               # interactive REPL",
        "    delego -p myagent skill add ./foo    # manage skills",
        "    delego -p myagent show               # show profile",
      ].join("\n"),
    },
    subCommands: {
      agent: agentCommand,
      run: runCommand,
      chat: chatCommand,
      mcp: mcpCommand,
      sessions: sessionsCommand,
      config: configCommand,
      doctor: doctorCommand,
    },
  });
  runMain(main);
}
