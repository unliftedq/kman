import { spawn, type ChildProcess } from "node:child_process";
import type {
  AgentContext,
  Backend,
  BackendCapabilities,
  ChatHandle,
  ChatOptions,
  DelegoEvent,
  PermissionMode,
  RunOptions,
} from "@delego/types";
import { combinePrompt, runTextBackend } from "@delego/backend-base";

const capabilities: BackendCapabilities = {
  supportsResume: false,
  supportsMcp: true,
  // copilot-cli's non-interactive `-p` mode prints plain text; no stable
  // jsonl event stream exposed yet. Captured via the shared text runner.
  supportsStreamJson: false,
  supportsAppendSystemPrompt: true,
};

function mapPermission(level: PermissionMode): string {
  switch (level) {
    case "ask":
      return "strict";
    case "auto":
      return "default";
    case "yolo":
      return "yolo";
  }
}

function buildArgs(ctx: AgentContext, opts: RunOptions): string[] {
  const args: string[] = [];

  // Permission mapping
  const mode = mapPermission(ctx.permission);
  // copilot-cli uses different flags per mode. Approximate v1 mapping:
  //   yolo  → --allow-all-tools
  //   default/strict → no implicit allow-list (user prompted)
  if (mode === "yolo") args.push("--allow-all-tools");

  if (ctx.model) args.push("--model", ctx.model);

  // Profile [runtime.copilot-cli] escape hatches
  const override = ctx.profile.runtimeOverrides["copilot-cli"];
  if (override?.extra_args) args.push(...override.extra_args);

  // --runtime-flag k=v passthrough
  for (const [k, v] of Object.entries(ctx.runtimeRawFlags)) {
    args.push(`--${k}`, v);
  }

  // Prompt via -p (non-interactive)
  args.push("-p", combinePrompt(ctx.systemPrompt, opts.task));
  return args;
}

export const copilotCliBackend: Backend = {
  name: "copilot-cli",
  capabilities,
  // Native resume not exposed by copilot-cli; transcript replay is the only path.
  resumeStrategy: "replay",
  mapPermission,

  async *spawn(ctx: AgentContext, opts: RunOptions): AsyncIterable<DelegoEvent> {
    yield* runTextBackend({
      command: "copilot",
      args: buildArgs(ctx, opts),
      cwd: ctx.cwd,
      sessionId: ctx.sessionId,
      label: "copilot",
    });
  },

  async chat(ctx: AgentContext, opts: ChatOptions): Promise<ChatHandle> {
    const args: string[] = [];

    // Permission mapping (mirrors spawn(): yolo → --allow-all-tools)
    if (mapPermission(ctx.permission) === "yolo") {
      args.push("--allow-all-tools");
    }

    if (ctx.model) args.push("--model", ctx.model);

    // Profile [runtime.copilot-cli] escape hatches
    const override = ctx.profile.runtimeOverrides["copilot-cli"];
    if (override?.extra_args) args.push(...override.extra_args);

    // --runtime-flag k=v passthrough
    for (const [k, v] of Object.entries(ctx.runtimeRawFlags)) {
      args.push(`--${k}`, v);
    }

    if (opts.resume) {
      // copilot-cli does not currently expose a native resume flag; transcript
      // replay is the documented strategy. Surface a heads-up rather than
      // silently dropping the user's intent.
      process.stderr.write(
        `[copilot-cli] --resume requested but not natively supported; ignoring.\n`,
      );
    }

    // copilot-cli has no equivalent of claude's --append-system-prompt-file,
    // so soul.md + memory cannot be injected into the interactive REPL. Make
    // this explicit so users aren't surprised that the agent appears generic.
    if (ctx.systemPrompt.trim().length > 0) {
      process.stderr.write(
        `[copilot-cli] interactive chat does not support system-prompt injection; ` +
          `soul.md and memory will not be visible to the model.\n`,
      );
    }

    let proc: ChildProcess;
    try {
      proc = spawn("copilot", args, {
        cwd: ctx.cwd,
        stdio: "inherit",
        env: { ...process.env },
      });
    } catch (err) {
      throw new Error(
        `Failed to spawn copilot: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await new Promise<void>((resolve, reject) => {
      proc.once("spawn", resolve);
      proc.once("error", reject);
    }).catch((err: Error) => {
      throw new Error(`Failed to spawn copilot: ${err.message}`);
    });

    return {
      done: async () =>
        new Promise<number>((resolve) => {
          if (proc.exitCode !== null) return resolve(proc.exitCode);
          proc.once("exit", (code) => resolve(code ?? 0));
        }),
      kill: (signal) => {
        proc.kill(signal);
      },
    };
  },
};

export default copilotCliBackend;
