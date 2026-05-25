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
  supportsResume: false,
  supportsMcp: true,
  supportsStreamJson: false,
  supportsAppendSystemPrompt: true,
};

export const geminiBackend: Backend = {
  name: "gemini",
  capabilities,
  resumeStrategy: "replay",

  mapPermission(level: PermissionMode): string {
    switch (level) {
      case "ask": return "interactive";
      case "auto": return "auto-edit";
      case "yolo": return "yolo";
    }
  },

  async *spawn(_ctx: AgentContext, _opts: RunOptions): AsyncIterable<DelegoEvent> {
    // TODO(M4): spawn gemini-cli with appropriate flags.
    throw new Error("gemini backend: not implemented yet (M4)");
  },

  async chat(_ctx: AgentContext, _opts: ChatOptions): Promise<ChatHandle> {
    throw new Error("gemini backend chat: not implemented yet (M4)");
  },
};

export default geminiBackend;
