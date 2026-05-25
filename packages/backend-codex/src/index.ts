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
  supportsResume: true,
  supportsMcp: true,
  // Codex `exec` does emit JSONL via --json, but its event schema is unstable
  // across releases. v1 captures text output via the shared text runner; a
  // dedicated stream translator can be added without changing this surface.
  supportsStreamJson: false,
  supportsAppendSystemPrompt: true,
};

function mapPermission(level: PermissionMode): string {
  switch (level) {
    case "ask":
      return "on-request";
    case "auto":
      return "on-failure";
    case "yolo":
      return "never";
  }
}

function buildArgs(ctx: AgentContext, opts: RunOptions): string[] {
  const args: string[] = ["exec"];

  // Permission mapping → --ask-for-approval=<mode>
  args.push(`--ask-for-approval=${mapPermission(ctx.permission)}`);

  if (ctx.model) args.push("-m", ctx.model);
  if (opts.resume) args.push("--resume", opts.resume);

  // Profile [runtime.codex] escape hatches
  const override = ctx.profile.runtimeOverrides.codex;
  if (override?.permission_mode_raw) {
    const idx = args.findIndex((a) => a.startsWith("--ask-for-approval="));
    if (idx >= 0) args[idx] = `--ask-for-approval=${override.permission_mode_raw}`;
  }
  if (override?.extra_args) args.push(...override.extra_args);

  // --runtime-flag k=v passthrough
  for (const [k, v] of Object.entries(ctx.runtimeRawFlags)) {
    args.push(`--${k}`, v);
  }

  // Positional prompt last
  args.push(combinePrompt(ctx.systemPrompt, opts.task));
  return args;
}

export const codexBackend: Backend = {
  name: "codex",
  capabilities,
  resumeStrategy: "native",
  mapPermission,

  async *spawn(ctx: AgentContext, opts: RunOptions): AsyncIterable<DelegoEvent> {
    yield* runTextBackend({
      command: "codex",
      args: buildArgs(ctx, opts),
      cwd: ctx.cwd,
      sessionId: ctx.sessionId,
      label: "codex",
    });
  },

  async chat(_ctx: AgentContext, _opts: ChatOptions): Promise<ChatHandle> {
    // Deferred — v1 only requires one-shot run for cross-backend parity.
    throw new Error("codex backend chat: not implemented yet");
  },
};

export default codexBackend;
