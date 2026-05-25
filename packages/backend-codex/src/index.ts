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

const capabilities: BackendCapabilities = {
  supportsResume: true,
  supportsMcp: true,
  supportsStreamJson: true,
  supportsAppendSystemPrompt: true,
};

export const codexBackend: Backend = {
  name: "codex",
  capabilities,
  resumeStrategy: "native",

  mapPermission(level: PermissionMode): string {
    switch (level) {
      case "ask": return "on-request";
      case "auto": return "on-failure";
      case "yolo": return "never";
    }
  },

  async *spawn(_ctx: AgentContext, _opts: RunOptions): AsyncIterable<DelegoEvent> {
    // TODO(M4): spawn `codex exec` with --ask-for-approval mapped from PermissionMode.
    throw new Error("codex backend: not implemented yet (M4)");
  },

  async chat(_ctx: AgentContext, _opts: ChatOptions): Promise<ChatHandle> {
    throw new Error("codex backend chat: not implemented yet (M4)");
  },
};

export default codexBackend;
