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

const main = defineCommand({
  meta: {
    name: "delego",
    version,
    description: "A multi-agent orchestration engine",
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
