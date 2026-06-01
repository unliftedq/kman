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
 * GitHub Copilot CLI adapter.
 *
 * Real flag surface (verified against `copilot --help`, 1.0.55):
 *   --plugin-dir <dir>      load a plugin directory (manifest at plugin.json)
 *   --agent <name>          select a custom agent — plugin agents are exposed
 *                           as `<plugin>:<agent>`
 *   --model <id>            override model
 *   -p, --prompt <text>     non-interactive prompt
 *   --output-format <fmt>   text | json (json is JSONL)
 *   --stream on|off         streaming mode
 *   --allow-all-tools       auto-approve every tool call (required for non-interactive)
 *   --yolo                  short for --allow-all-{tools,paths,urls}
 *
 * Soul prompt: delivered as a plugin-contributed agent. kman materializes a
 * runtime plugin under ~/.kman/runtime/<name>/.copilot whose `plugin.json`
 * declares `"agents": "agents/"` and a fixed plugin name `kman`; the soul lives
 * at `agents/<name>.agent.md`, and we invoke `--agent kman:<name>`.
 */
const PERMISSION_FLAG: Record<PermissionLevel, string | null> = {
  ask: null,
  auto: '--allow-all-tools',
  yolo: '--yolo',
};

export class CopilotCliBackend implements Backend {
  readonly name = 'copilot-cli';
  readonly capabilities: BackendCapabilities = {
    supportClaudeCodePlugin: true,
    supportsAppendSystemPrompt: true,
    supportsNativeResume: true,
  };

  private readonly binary: string;

  constructor(binary?: string) {
    this.binary = binary ?? process.env['KMAN_COPILOT_BIN'] ?? 'copilot';
  }

  mapPermission(level: PermissionLevel): string {
    return PERMISSION_FLAG[level] ?? '(default)';
  }

  async spawn(ctx: AgentContext, _opts?: RunOptions): Promise<ChildProcess> {
    const { pluginDir, pluginAgent } = await materializeRuntimePlugin(ctx.profile, 'copilot');
    const args = this.buildArgs(ctx, pluginDir, pluginAgent, /* interactive */ false);
    return spawnBackend(ctx, { command: this.binary, args });
  }

  async chat(ctx: AgentContext, _opts?: ChatOptions): Promise<ChildProcess> {
    const { pluginDir, pluginAgent } = await materializeRuntimePlugin(ctx.profile, 'copilot');
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

    // Load the materialized runtime plugin (skills, hooks, MCP) and pick up its
    // contributed agent definition. Copilot exposes plugin agents as
    // `<plugin>:<agent>`.
    args.push('--plugin-dir', pluginDir);
    args.push('--agent', pluginAgent);

    // Permission mapping. The raw escape hatch suppresses kman's abstract
    // mapping entirely so the user can supply their own --allow-tool /
    // --deny-tool combinations via extra_args.
    if (ctx.permissionModeRaw === undefined) {
      const flag = PERMISSION_FLAG[ctx.permission];
      if (flag) args.push(flag);
    }

    if (ctx.model) {
      args.push('--model', ctx.model);
    }

    if (!interactive) {
      if (ctx.outputFormat === 'stream-json') {
        // Closest analog: JSONL output with streaming enabled.
        args.push('--output-format', 'json', '--stream', 'on');
      } else if (ctx.outputFormat === 'json' || ctx.outputFormat === 'text') {
        args.push('--output-format', ctx.outputFormat);
      }
    }

    for (const extra of ctx.extraArgs) {
      args.push(extra);
    }

    if (!interactive && ctx.task !== undefined) {
      args.push('-p', ctx.task);
    }

    return args;
  }
}

export function createCopilotCliBackend(binary?: string): CopilotCliBackend {
  return new CopilotCliBackend(binary);
}
