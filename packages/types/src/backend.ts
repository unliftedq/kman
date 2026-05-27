import type { ChildProcess } from 'node:child_process';
import type { AgentContext } from './context.js';
import type { PermissionLevel } from './profile.js';

export interface BackendCapabilities {
  /** Can load the agent directory as a Claude Code plugin via --plugin-dir. */
  supportClaudeCodePlugin: boolean;
  /** Can accept Delego's rendered soul as an additional system prompt. */
  supportsAppendSystemPrompt: boolean;
  /** Exposes a native --resume / --continue style flag. */
  supportsNativeResume: boolean;
}

export interface RunOptions {
  /** stdio passthrough behavior for the child. */
  stdio?: 'inherit' | 'pipe';
}

export interface ChatOptions {
  stdio?: 'inherit' | 'pipe';
}

export interface Backend {
  readonly name: string;
  readonly capabilities: BackendCapabilities;

  /** Spawn a one-shot run; stdout/stderr pass through to the caller. */
  spawn(ctx: AgentContext, opts?: RunOptions): Promise<ChildProcess>;

  /** Spawn an interactive REPL, passing stdin/stdout through transparently. */
  chat(ctx: AgentContext, opts?: ChatOptions): Promise<ChildProcess>;

  /** Map abstract permission level to backend-native mode. */
  mapPermission(level: PermissionLevel): string;
}
