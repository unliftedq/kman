import type { ChildProcess } from 'node:child_process';
import { spawnBackend } from '@kman/backend-base';
import type {
  AgentContext,
  Backend,
  BackendCapabilities,
  ChatOptions,
  PermissionLevel,
  RunOptions,
} from '@kman/types';

/**
 * GitHub Copilot CLI adapter. v1 honest capability flags: Copilot CLI does not
 * load Claude Code plugins natively, but accepts a system-prompt override via
 * `--system-prompt` and supports prompt-on-run via `--prompt`.
 *
 * Adapters for plugin features (skills, hooks, MCP) are left to future work;
 * the design doc treats this as the adapter's responsibility (§3.3).
 */
const PERMISSION_MAP: Record<PermissionLevel, string> = {
  ask: 'ask',
  auto: 'auto',
  yolo: 'all',
};

export class CopilotCliBackend implements Backend {
  readonly name = 'copilot-cli';
  readonly capabilities: BackendCapabilities = {
    supportClaudeCodePlugin: false,
    supportsAppendSystemPrompt: true,
    supportsNativeResume: true,
  };

  private readonly binary: string;

  constructor(binary?: string) {
    this.binary = binary ?? process.env['DELEGO_COPILOT_BIN'] ?? 'copilot';
  }

  mapPermission(level: PermissionLevel): string {
    return PERMISSION_MAP[level] ?? 'ask';
  }

  async spawn(ctx: AgentContext, _opts?: RunOptions): Promise<ChildProcess> {
    const args = this.buildArgs(ctx, /* interactive */ false);
    return spawnBackend(ctx, { command: this.binary, args });
  }

  async chat(ctx: AgentContext, _opts?: ChatOptions): Promise<ChildProcess> {
    const args = this.buildArgs(ctx, /* interactive */ true);
    return spawnBackend(ctx, { command: this.binary, args });
  }

  private buildArgs(ctx: AgentContext, interactive: boolean): string[] {
    const args: string[] = [];

    if (ctx.soulPrompt.trim().length > 0) {
      args.push('--system-prompt', ctx.soulPrompt);
    }

    if (ctx.model) {
      args.push('--model', ctx.model);
    }

    const pmode = ctx.permissionModeRaw ?? this.mapPermission(ctx.permission);
    args.push('--approve-mode', pmode);

    for (const extra of ctx.extraArgs) {
      args.push(extra);
    }

    if (!interactive && ctx.task !== undefined) {
      args.push('--prompt', ctx.task);
    }

    return args;
  }
}

export function createCopilotCliBackend(binary?: string): CopilotCliBackend {
  return new CopilotCliBackend(binary);
}
