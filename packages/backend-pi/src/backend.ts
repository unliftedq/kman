import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnBackend } from '@kman/backend-base';
import { materializePiRuntime } from '@kman/core';
import type {
  AgentContext,
  Backend,
  BackendCapabilities,
  ChatOptions,
  PermissionLevel,
  RunOptions,
} from '@kman/types';

/**
 * pi agent adapter (https://pi.dev).
 *
 * Unlike claude-code / copilot-cli, pi is not an external CLI kman shells out
 * to: it is embedded as an SDK (`@earendil-works/pi-coding-agent`) that runs
 * in-process. To keep kman's process-based Backend contract intact — stdio
 * passthrough, SIGINT/SIGTERM forwarding, daemon log piping and cancellation —
 * the SDK is driven from a small runner script (`pi-runner.ts`) that kman
 * launches as a child process. The runner imports pi's SDK directly, so pi
 * runs as embedded library code owned by kman rather than an opaque binary.
 *
 * Permission mapping (abstract → pi): this backend only forwards the abstract
 * level to the runner via KMAN_PI_PERMISSION as an identity string; the actual
 * enforcement — translating the level into pi's tool allowlist (read-only for
 * ask/auto, full coding tools for yolo) — happens in the runner's
 * `toolsForPermission` (pi-runner.ts), because pi's SDK has no per-run approval
 * callback at this embedding layer.
 */
const PERMISSION_MAP: Record<PermissionLevel, string> = {
  ask: 'ask',
  auto: 'auto',
  yolo: 'yolo',
};

/** Absolute path to the compiled/interpreted runner entrypoint. */
function runnerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'pi-runner.js');
}

export class PiBackend implements Backend {
  readonly name = 'pi';
  readonly capabilities: BackendCapabilities = {
    supportClaudeCodePlugin: false,
    supportsAppendSystemPrompt: true,
    supportsNativeResume: true,
  };

  /** Node/Bun interpreter used to launch the SDK runner. */
  private readonly interpreter: string;

  constructor(interpreter?: string) {
    this.interpreter =
      interpreter ?? process.env['KMAN_PI_INTERPRETER'] ?? process.execPath;
  }

  mapPermission(level: PermissionLevel): string {
    return PERMISSION_MAP[level] ?? 'ask';
  }

  async spawn(ctx: AgentContext, opts?: RunOptions): Promise<ChildProcess> {
    const env = await this.buildEnv(ctx, /* interactive */ false);
    const options =
      opts?.stdio === 'pipe'
        ? { stdio: ['ignore', 'pipe', 'pipe'] as ('ignore' | 'pipe')[] }
        : undefined;
    return spawnBackend(
      { ...ctx, env },
      { command: this.interpreter, args: [runnerPath()], ...(options ? { options } : {}) },
    );
  }

  async chat(ctx: AgentContext, _opts?: ChatOptions): Promise<ChildProcess> {
    const env = await this.buildEnv(ctx, /* interactive */ true);
    return spawnBackend(
      { ...ctx, env },
      { command: this.interpreter, args: [runnerPath()] },
    );
  }

  /**
   * Serialize the AgentContext into environment variables the runner reads.
   * Env is used (rather than argv) so the soul prompt and task — which may be
   * large or contain shell metacharacters — never touch a command line.
   */
  private async buildEnv(
    ctx: AgentContext,
    interactive: boolean,
  ): Promise<Record<string, string>> {
    const resourceDir = await materializePiRuntime(ctx.profile);

    const permission = ctx.permissionModeRaw ?? this.mapPermission(ctx.permission);

    const env: Record<string, string> = {
      ...ctx.env,
      KMAN_PI_SOUL: ctx.soulPrompt,
      KMAN_PI_PERMISSION: permission,
      KMAN_PI_CWD: ctx.cwd,
      KMAN_PI_AGENT_DIR: resourceDir,
      KMAN_PI_INTERACTIVE: interactive ? '1' : '0',
    };
    if (ctx.model !== undefined) env['KMAN_PI_MODEL'] = ctx.model;
    if (ctx.task !== undefined) env['KMAN_PI_TASK'] = ctx.task;

    return env;
  }
}

export function createPiBackend(interpreter?: string): PiBackend {
  return new PiBackend(interpreter);
}
