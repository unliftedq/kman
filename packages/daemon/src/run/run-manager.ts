import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { buildContext, readProfile } from '@kman/core';
import type { AgentContext, Backend, BackendName } from '@kman/types';
import type { TaskRecord } from '../protocol.js';
import { daemonHome } from '../paths.js';
import type { RunHandle, RunManager, RunOutcome } from './types.js';

export interface CoreRunManagerOptions {
  /** Resolve a backend by name. Injected by the CLI so the daemon need not depend on backend packages. */
  resolveBackend: (name: BackendName) => Backend;
  /** Optional hook to enrich the context before spawn (e.g. attach the kman MCP server). */
  prepareContext?: (ctx: AgentContext) => Promise<AgentContext>;
  /** Base directory for resolving each task's relative logFile. Defaults to the daemon home. */
  baseDir?: string;
  /** Grace period before escalating SIGTERM to SIGKILL on cancel. Default 5s. */
  killGraceMs?: number;
}

/**
 * The production RunManager: turns a TaskRecord into a real agent run via
 * @kman/core (the exact same context-building path as `kman run`), with stdout
 * and stderr captured to the task's log file. Cancellation sends SIGTERM and,
 * if the child lingers, escalates to SIGKILL.
 */
export class CoreRunManager implements RunManager {
  private readonly resolveBackend: (name: BackendName) => Backend;
  private readonly prepareContext?: (ctx: AgentContext) => Promise<AgentContext>;
  private readonly baseDir: string;
  private readonly killGraceMs: number;

  constructor(opts: CoreRunManagerOptions) {
    this.resolveBackend = opts.resolveBackend;
    if (opts.prepareContext) this.prepareContext = opts.prepareContext;
    this.baseDir = opts.baseDir ?? daemonHome();
    this.killGraceMs = opts.killGraceMs ?? 5000;
  }

  start(rec: TaskRecord): RunHandle {
    let child: ChildProcess | undefined;
    let canceled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const done: Promise<RunOutcome> = (async () => {
      const logPath = isAbsolute(rec.logFile) ? rec.logFile : join(this.baseDir, rec.logFile);
      await mkdir(dirname(logPath), { recursive: true });
      const log = createWriteStream(logPath, { flags: 'a' });
      writeHeader(log, rec);

      let ctx: AgentContext;
      try {
        const profile = await readProfile(rec.agent);
        ctx = await buildContext(profile, {
          task: rec.task,
          ...(rec.runtime ? { backend: rec.runtime } : {}),
          ...(rec.model ? { model: rec.model } : {}),
          ...(rec.permission ? { permission: rec.permission } : {}),
          ...(rec.outputFormat ? { outputFormat: rec.outputFormat } : {}),
          ...(rec.cwd ? { cwd: rec.cwd } : {}),
        });
        if (this.prepareContext) ctx = await this.prepareContext(ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.write(`\n[kman] failed to prepare run: ${message}\n`);
        await endStream(log);
        return { exitCode: 1, error: message };
      }

      const backend = this.resolveBackend(ctx.backend);
      try {
        child = await backend.spawn(ctx, { stdio: 'pipe' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.write(`\n[kman] failed to spawn backend "${backend.name}": ${message}\n`);
        await endStream(log);
        return { exitCode: 1, error: message };
      }

      child.stdout?.pipe(log, { end: false });
      child.stderr?.pipe(log, { end: false });

      // If cancel() was requested before the child existed, kill it now.
      if (canceled) requestKill(child, this.killGraceMs, (t) => (killTimer = t));

      const outcome = await new Promise<RunOutcome>((resolve) => {
        child!.on('error', (err) => {
          resolve({ exitCode: 1, error: err.message });
        });
        child!.on('exit', (code, signal) => {
          if (signal && (signal === 'SIGTERM' || signal === 'SIGKILL')) {
            resolve({ exitCode: 130, error: `terminated by ${signal}` });
          } else {
            resolve({ exitCode: code ?? 0 });
          }
        });
      });

      if (killTimer) clearTimeout(killTimer);
      log.write(`\n[kman] exited with code ${outcome.exitCode}\n`);
      await endStream(log);
      return outcome;
    })();

    return {
      done,
      cancel: () => {
        canceled = true;
        if (child) requestKill(child, this.killGraceMs, (t) => (killTimer = t));
      },
    };
  }
}

function requestKill(
  child: ChildProcess,
  graceMs: number,
  setTimer: (t: ReturnType<typeof setTimeout>) => void,
): void {
  if (child.killed) return;
  child.kill('SIGTERM');
  const t = setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL');
  }, graceMs);
  // Don't keep the daemon event loop alive solely for this timer.
  t.unref?.();
  setTimer(t);
}

function writeHeader(log: WriteStream, rec: TaskRecord): void {
  log.write(
    `[kman] task ${rec.id} agent=${rec.agent} attempt=${rec.attempts} at ${new Date().toISOString()}\n` +
      `[kman] task: ${rec.task}\n\n`,
  );
}

function endStream(log: WriteStream): Promise<void> {
  return new Promise((resolve) => log.end(resolve));
}
