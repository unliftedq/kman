import type { ChildProcess } from 'node:child_process';
import { spawnBackend } from '@kman/backend-base';
import { materializeRuntimePlugin } from '@kman/core';
import type {
  AgentContext,
  Backend,
  BackendCapabilities,
  ChatOptions,
  PermissionLevel,
  RunOptions,
} from '@kman/types';

/**
 * Claude Code adapter (§3.3). Loads the agent as a Claude Code plugin
 * materialized under ~/.kman/runtime/<name>/.claude and selected via
 * --plugin-dir. The agent directory itself holds only agent data.
 *
 * Permission mapping (abstract → claude-code's --permission-mode):
 *   ask    → default
 *   auto   → acceptEdits
 *   yolo   → bypassPermissions
 */
const PERMISSION_MAP: Record<PermissionLevel, string> = {
  ask: 'default',
  auto: 'acceptEdits',
  yolo: 'bypassPermissions',
};

export class ClaudeCodeBackend implements Backend {
  readonly name = 'claude-code';
  readonly capabilities: BackendCapabilities = {
    supportClaudeCodePlugin: true,
    supportsAppendSystemPrompt: true,
    supportsNativeResume: true,
  };

  private readonly binary: string;

  constructor(binary?: string) {
    this.binary = binary ?? process.env['KMAN_CLAUDE_BIN'] ?? 'claude';
  }

  mapPermission(level: PermissionLevel): string {
    return PERMISSION_MAP[level] ?? 'default';
  }

  async spawn(ctx: AgentContext, _opts?: RunOptions): Promise<ChildProcess> {
    const { pluginDir, pluginAgent } = await materializeRuntimePlugin(ctx.profile, 'claude');
    const args = this.buildArgs(ctx, pluginDir, pluginAgent, /* interactive */ false);
    return spawnBackend(ctx, { command: this.binary, args });
  }

  async chat(ctx: AgentContext, _opts?: ChatOptions): Promise<ChildProcess> {
    const { pluginDir, pluginAgent } = await materializeRuntimePlugin(ctx.profile, 'claude');
    const args = this.buildArgs(ctx, pluginDir, pluginAgent, /* interactive */ true);
    return spawnBackend(ctx, { command: this.binary, args });
  }

  private buildArgs(
    ctx: AgentContext,
    pluginDir: string,
    pluginAgent: string,
    interactive: boolean,
  ): string[] {
    const args: string[] = [];

    // Plugin directory — load the materialized runtime plugin (§4, §3.3).
    args.push('--plugin-dir', pluginDir);

    // Soul prompt arrives via the plugin-contributed agent. The plugin name is
    // fixed to `kman`, so the scoped selector Claude resolves at startup is
    // `kman:<agent>` (frontmatter `name:` in agents/<name>.md).
    args.push('--agent', pluginAgent);

    // Model override.
    if (ctx.model) {
      args.push('--model', ctx.model);
    }

    // Permission mode: raw escape hatch wins over abstract.
    const pmode = ctx.permissionModeRaw ?? this.mapPermission(ctx.permission);
    args.push('--permission-mode', pmode);

    // Max turns.
    if (ctx.maxTurns !== undefined) {
      args.push('--max-turns', String(ctx.maxTurns));
    }

    // Output format — only meaningful in non-interactive mode.
    if (!interactive) {
      args.push('--output-format', ctx.outputFormat);
      if (ctx.stream && ctx.outputFormat === 'stream-json') {
        args.push('--include-partial-messages');
      }
    }

    // Extra backend-native args from profile + --runtime-flag.
    for (const extra of ctx.extraArgs) {
      args.push(extra);
    }

    // Task: passed via -p/--print in non-interactive mode.
    if (!interactive && ctx.task !== undefined) {
      args.push('--print', ctx.task);
    }

    return args;
  }
}

export function createClaudeCodeBackend(binary?: string): ClaudeCodeBackend {
  return new ClaudeCodeBackend(binary);
}
