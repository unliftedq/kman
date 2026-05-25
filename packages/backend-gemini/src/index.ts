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
  // gemini-cli `-p` prints plain text; no normalized event stream is exposed.
  // Captured via the shared text runner.
  supportsStreamJson: false,
  supportsAppendSystemPrompt: true,
};

function mapPermission(level: PermissionMode): string {
  switch (level) {
    case "ask":
      return "interactive";
    case "auto":
      return "auto-edit";
    case "yolo":
      return "yolo";
  }
}

function buildArgs(ctx: AgentContext, opts: RunOptions): string[] {
  const args: string[] = [];

  // Permission mapping → gemini-cli flags
  switch (ctx.permission) {
    case "ask":
      // default behavior; no flag needed (gemini prompts before tool use)
      break;
    case "auto":
      // gemini-cli uses --approval-mode=auto_edit for edits without prompt
      args.push("--approval-mode=auto_edit");
      break;
    case "yolo":
      args.push("--yolo");
      break;
  }

  if (ctx.model) args.push("-m", ctx.model);

  // Profile [runtime.gemini] escape hatches
  const override = ctx.profile.runtimeOverrides.gemini;
  if (override?.permission_mode_raw) {
    args.push(`--approval-mode=${override.permission_mode_raw}`);
  }
  if (override?.extra_args) args.push(...override.extra_args);

  // --runtime-flag k=v passthrough
  for (const [k, v] of Object.entries(ctx.runtimeRawFlags)) {
    args.push(`--${k}`, v);
  }

  // -p / --prompt for non-interactive single-shot mode
  args.push("-p", combinePrompt(ctx.systemPrompt, opts.task));
  return args;
}

export const geminiBackend: Backend = {
  name: "gemini",
  capabilities,
  resumeStrategy: "replay",
  mapPermission,

  async *spawn(ctx: AgentContext, opts: RunOptions): AsyncIterable<DelegoEvent> {
    yield* runTextBackend({
      command: "gemini",
      args: buildArgs(ctx, opts),
      cwd: ctx.cwd,
      sessionId: ctx.sessionId,
      label: "gemini",
    });
  },

  async chat(_ctx: AgentContext, _opts: ChatOptions): Promise<ChatHandle> {
    throw new Error("gemini backend chat: not implemented yet");
  },
};

export default geminiBackend;
