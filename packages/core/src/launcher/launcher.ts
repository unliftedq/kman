import type { ChildProcess } from 'node:child_process';
import {
  BackendUnavailableError,
  ExitCode,
  type AgentContext,
  type Backend,
} from '@delego/types';

export interface LaunchResult {
  exitCode: number;
}

/**
 * Spawn the backend and wait for it to exit. stdio is wired straight through.
 * Forwards SIGINT/SIGTERM to the child so the user's Ctrl-C reaches the backend.
 */
export async function launchRun(backend: Backend, ctx: AgentContext): Promise<LaunchResult> {
  return launch(backend, ctx, 'run');
}

export async function launchChat(backend: Backend, ctx: AgentContext): Promise<LaunchResult> {
  return launch(backend, ctx, 'chat');
}

async function launch(
  backend: Backend,
  ctx: AgentContext,
  mode: 'run' | 'chat',
): Promise<LaunchResult> {
  // Fail-fast capability check for soul prompt (§3.3).
  if (ctx.soulPrompt.trim().length > 0 && !backend.capabilities.supportsAppendSystemPrompt) {
    throw new BackendUnavailableError(
      `Backend "${backend.name}" does not support append-system-prompt; cannot inject soul.md.`,
    );
  }

  let child: ChildProcess;
  try {
    child = mode === 'run' ? await backend.spawn(ctx) : await backend.chat(ctx);
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new BackendUnavailableError(
        `Backend "${backend.name}" binary not found on PATH. Install it before running.`,
        { cause },
      );
    }
    throw cause;
  }

  const forward = (sig: NodeJS.Signals) => {
    if (!child.killed) child.kill(sig);
  };
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);

  try {
    return await new Promise<LaunchResult>((resolve, reject) => {
      child.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new BackendUnavailableError(
              `Backend "${backend.name}" binary not found on PATH. Install it before running.`,
              { cause: err },
            ),
          );
        } else {
          reject(err);
        }
      });
      child.on('exit', (code, signal) => {
        if (signal === 'SIGINT' || signal === 'SIGTERM') {
          resolve({ exitCode: ExitCode.Interrupted });
        } else {
          resolve({ exitCode: code ?? 0 });
        }
      });
    });
  } finally {
    process.off('SIGINT', forward);
    process.off('SIGTERM', forward);
  }
}
