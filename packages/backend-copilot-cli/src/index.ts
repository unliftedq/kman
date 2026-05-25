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
  supportsStreamJson: true,
  supportsAppendSystemPrompt: true,
};

export const copilotCliBackend: Backend = {
  name: "copilot-cli",
  capabilities,
  resumeStrategy: "replay",

  mapPermission(level: PermissionMode): string {
    switch (level) {
      case "ask": return "strict";
      case "auto": return "default";
      case "yolo": return "yolo";
    }
  },

  async *spawn(_ctx: AgentContext, _opts: RunOptions): AsyncIterable<DelegoEvent> {
    // TODO(M4): spawn copilot-cli with appropriate flags.
    throw new Error("copilot-cli backend: not implemented yet (M4)");
  },

  async chat(_ctx: AgentContext, _opts: ChatOptions): Promise<ChatHandle> {
    throw new Error("copilot-cli backend chat: not implemented yet (M4)");
  },
};

export default copilotCliBackend;
