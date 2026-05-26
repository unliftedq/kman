import { defineCommand } from "citty";
import { buildAgentContext } from "@delego/core";
import type { PermissionMode } from "@delego/types";
import { getBackend } from "../backends";
import { b, parseRuntimeFlag, s, sOpt, ss } from "../arg-helpers";

export const chatCommand = defineCommand({
  meta: { name: "chat", description: "Start an interactive REPL with an agent" },
  args: {
    agent: { type: "positional", required: true },
    runtime: { type: "string", description: "Override default backend" },
    model: { type: "string", description: "Override the profile's default model" },
    permission: { type: "string", description: "Abstract permission level: ask | auto | yolo" },
    "runtime-flag": { type: "string", description: "Raw key=value passed to backend (repeatable)" },
    resume: { type: "string", description: "Resume a session" },
    "no-memory": { type: "boolean", description: "Disable memory for this run only", default: false },
    cwd: { type: "string", description: "Working directory for the backend" },
  },
  run: async ({ args }) => {
    const overrides: Parameters<typeof buildAgentContext>[1] = {
      noMemory: b(args["no-memory"]),
      runtimeRawFlags: parseRuntimeFlag(ss(args["runtime-flag"])),
    };
    const runtime = sOpt(args.runtime);
    if (runtime) overrides.runtime = runtime;
    const model = sOpt(args.model);
    if (model) overrides.model = model;
    const permission = sOpt(args.permission);
    if (permission) overrides.permission = permission as PermissionMode;
    const cwd = sOpt(args.cwd);
    if (cwd) overrides.cwd = cwd;

    const ctx = await buildAgentContext(s(args.agent), overrides);
    const backend = getBackend(ctx.runtime);

    const chatOpts: { resume?: string } = {};
    const resume = sOpt(args.resume);
    if (resume) chatOpts.resume = resume;

    const handle = await backend.chat(ctx, chatOpts);

    process.on("SIGINT", () => handle.kill("SIGINT"));

    const exitCode = await handle.done();
    process.exit(exitCode);
  },
});
