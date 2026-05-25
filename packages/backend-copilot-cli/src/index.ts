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

  async chat(_ctx: AgentContext, _opts: ChatOptions): Promise<ChatHandle> {
    throw new Error("copilot-cli backend chat: not implemented yet");
  },
};

export default copilotCliBackend;
