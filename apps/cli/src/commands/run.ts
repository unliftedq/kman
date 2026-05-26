import { defineCommand } from "citty";
import { buildAgentContext, runAgent } from "@delego/core";
import type { OutputFormat, PermissionMode } from "@delego/types";
import { getBackend } from "../backends";
import { b, parseRuntimeFlag, s, sOpt, ss } from "../arg-helpers";

export const runCommand = defineCommand({
  meta: { name: "run", description: "Run an agent against a task (one-shot)" },
  args: {
    agent: { type: "positional", required: true },
    task: { type: "string", description: "Task description", required: true },
    runtime: { type: "string", description: "Override the profile's default backend" },
    model: { type: "string", description: "Override the profile's default model" },
    permission: { type: "string", description: "Abstract permission level: ask | auto | yolo" },
    "runtime-flag": { type: "string", description: "Raw key=value passed to backend (repeatable)" },
    output: { type: "string", description: "text | json | stream-json", default: "text" },
    stream: { type: "boolean", description: "Stream events to stdout (implies --output stream-json)", default: false },
    resume: { type: "string", description: "Resume a session (most recent if no id given)" },
    "no-memory": { type: "boolean", description: "Disable memory for this run only", default: false },
    cwd: { type: "string", description: "Working directory for the backend" },
  },
  run: async ({ args }) => {
    const streamFlag = b(args.stream, false);
    const outputFormat: OutputFormat = streamFlag
      ? "stream-json"
      : (s(args.output, "text") as OutputFormat);

    const overrides: Parameters<typeof buildAgentContext>[1] = {
      outputFormat,
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

    const runOpts: Parameters<typeof runAgent>[2] = {
      task: s(args.task),
      output: outputFormat,
      stream: streamFlag,
    };
    const resume = sOpt(args.resume);
    if (resume) runOpts.resume = resume;

    const summary = await runAgent(ctx, backend, runOpts);

    if (summary.exitReason === "aborted") {
      // Per DESIGN.md §6.7: exit 3 for "hook aborted run (pre_run non-zero)".
      process.exit(3);
    }
    if (summary.exitReason === "error") {
      process.exit(1);
    }
  },
});
