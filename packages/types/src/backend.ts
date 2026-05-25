import type { AgentContext, ChatOptions, RunOptions } from "./context";
import type { DelegoEvent } from "./events";
import type { PermissionMode } from "./profile";

export interface BackendCapabilities {
  supportsResume: boolean;
  supportsMcp: boolean;
  supportsStreamJson: boolean;
  supportsAppendSystemPrompt: boolean;
}

export interface Backend {
  readonly name: string;
  readonly capabilities: BackendCapabilities;

  /** One-shot run, yields normalized events. */
  spawn(ctx: AgentContext, opts: RunOptions): AsyncIterable<DelegoEvent>;

  /** Interactive REPL. Returns a child process handle so caller can wire stdio. */
  chat(ctx: AgentContext, opts: ChatOptions): Promise<ChatHandle>;

  /** Map abstract permission level to backend-native mode string. */
  mapPermission(level: PermissionMode): string;

  /** How this backend supports resume. */
  readonly resumeStrategy: "native" | "replay" | "unsupported";
}

export interface ChatHandle {
  /** Wait until the child exits. */
  done(): Promise<number>;
  /** Force-kill. */
  kill(signal?: NodeJS.Signals): void;
}
