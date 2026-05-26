/**
 * Hook runner.
 *
 * Each profile may declare a list of {@link HookEntry} for each of the four
 * lifecycle events: `pre_run`, `post_run`, `on_error`, `pre_memory_write`.
 * A hook is a small subprocess invoked by delego at the right moment:
 *
 *   - `command` runs as a shell command (`/bin/sh -c <cmd>` on POSIX, the
 *     equivalent on Windows via {@link spawn} `shell: true`).
 *   - `script` is the path to an executable file, resolved relative to the
 *     agent's `hooks/` directory.
 *
 * The hook receives:
 *   - a JSON payload on stdin (the event-specific context)
 *   - a small set of `DELEGO_*` env vars describing the run
 *   - inherited stderr (so users see the hook's diagnostics live)
 *
 * Pre-run / pre-memory-write hooks are *gating*: if any one exits non-zero,
 * the batch is aborted and `aborted = true` is returned. Post-run / on-error
 * hooks are *advisory*: failures are recorded but never abort.
 *
 * Entries marked `on_success_only: true` are skipped when `success: false`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { isAbsolute, join } from "node:path";
import type { HookEntry } from "@delego/types";

export type HookEvent = "pre_run" | "post_run" | "on_error" | "pre_memory_write";

/** Default per-hook timeout in milliseconds. */
export const DEFAULT_HOOK_TIMEOUT_MS = 30_000;

export interface HookInvocation {
  /** Lifecycle event name; surfaced via `DELEGO_HOOK_EVENT`. */
  event: HookEvent;
  /** JSON-serializable payload piped to the hook's stdin. */
  payload: unknown;
  /** Working directory passed to the spawned child. */
  cwd: string;
  /** Directory where `script:` paths are resolved from. */
  hooksDir: string;
  /** Extra env vars merged on top of `process.env`. */
  env?: Record<string, string>;
  /**
   * If true, the batch stops on the first non-zero exit code.
   * Defaults: true for `pre_run` and `pre_memory_write`, false otherwise.
   */
  abortOnFailure?: boolean;
  /** Per-hook timeout. Defaults to {@link DEFAULT_HOOK_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Whether the operation being hooked succeeded.
   * Only relevant for `post_run` / `on_error` filtering of
   * `on_success_only: true` entries. Defaults to `true`.
   */
  success?: boolean;
}

export interface HookRunResult {
  entry: HookEntry;
  /** -1 if the hook could not be spawned or timed out. */
  exitCode: number;
  durationMs: number;
  /** Captured stdout (UTF-8). */
  stdout: string;
  /** Captured stderr (UTF-8) — also live-forwarded to the parent's stderr. */
  stderr: string;
  /** True if the entry was filtered out (e.g. on_success_only with success=false). */
  skipped: boolean;
  skipReason?: string;
  /** True if the hook could not be spawned, timed out, or exited non-zero. */
  failed: boolean;
  /** Set when the hook ran past `timeoutMs`. */
  timedOut?: boolean;
  /** Message describing a spawn failure (ENOENT, EACCES, etc.). */
  spawnError?: string;
}

export interface HookBatchResult {
  /** True iff `abortOnFailure` was active and a hook failed. */
  aborted: boolean;
  /** The first failing hook (only set when `aborted` is true). */
  abortedBy?: HookRunResult;
  results: HookRunResult[];
}

function defaultAbort(event: HookEvent): boolean {
  return event === "pre_run" || event === "pre_memory_write";
}

/** Run a batch of hooks for one lifecycle event. Never throws on hook failure. */
export async function runHooks(
  entries: readonly HookEntry[] | undefined,
  inv: HookInvocation,
): Promise<HookBatchResult> {
  const results: HookRunResult[] = [];
  if (!entries || entries.length === 0) {
    return { aborted: false, results };
  }

  const abortOnFailure = inv.abortOnFailure ?? defaultAbort(inv.event);
  const success = inv.success ?? true;
  const timeoutMs = inv.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
  const payloadJson = safeStringify(inv.payload);

  const baseEnv: Record<string, string> = {
    ...filterEnv(process.env),
    DELEGO_HOOK_EVENT: inv.event,
    ...(inv.env ?? {}),
  };

  for (const entry of entries) {
    if (entry.on_success_only && !success) {
      results.push({
        entry,
        exitCode: 0,
        durationMs: 0,
        stdout: "",
        stderr: "",
        skipped: true,
        skipReason: "on_success_only and run did not succeed",
        failed: false,
      });
      continue;
    }

    const result = await runOne(entry, inv.hooksDir, inv.cwd, baseEnv, payloadJson, timeoutMs);
    results.push(result);

    if (result.failed && abortOnFailure) {
      return { aborted: true, abortedBy: result, results };
    }
  }

  return { aborted: false, results };
}

async function runOne(
  entry: HookEntry,
  hooksDir: string,
  cwd: string,
  env: Record<string, string>,
  payload: string,
  timeoutMs: number,
): Promise<HookRunResult> {
  const start = Date.now();

  let proc: ChildProcess;
  try {
    proc = spawnHook(entry, hooksDir, cwd, env);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      entry,
      exitCode: -1,
      durationMs: Date.now() - start,
      stdout: "",
      stderr: "",
      skipped: false,
      failed: true,
      spawnError: message,
    };
  }

  // Surface async spawn errors (ENOENT, EACCES, ...).
  let spawnError: Error | null = null;
  await new Promise<void>((resolve) => {
    proc.once("spawn", resolve);
    proc.once("error", (err) => {
      spawnError = err;
      resolve();
    });
  });
  if (spawnError) {
    return {
      entry,
      exitCode: -1,
      durationMs: Date.now() - start,
      stdout: "",
      stderr: "",
      skipped: false,
      failed: true,
      spawnError: (spawnError as Error).message,
    };
  }

  // stdin: JSON payload (best-effort; ignore EPIPE if the hook closed stdin early).
  if (proc.stdin) {
    proc.stdin.on("error", () => {});
    try {
      proc.stdin.write(payload);
    } catch {
      /* ignore */
    }
    proc.stdin.end();
  }

  let stdout = "";
  let stderr = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    process.stderr.write(chunk);
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
    // Escalate after a short grace period in case SIGTERM is ignored.
    setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGKILL");
      }
    }, 2_000).unref();
  }, timeoutMs);
  timer.unref();

  const exitCode = await new Promise<number>((resolve) => {
    if (proc.exitCode !== null) return resolve(proc.exitCode);
    proc.once("exit", (code) => resolve(code ?? -1));
  });
  clearTimeout(timer);

  const failed = timedOut || exitCode !== 0;
  const result: HookRunResult = {
    entry,
    exitCode,
    durationMs: Date.now() - start,
    stdout,
    stderr,
    skipped: false,
    failed,
  };
  if (timedOut) result.timedOut = true;
  return result;
}

function spawnHook(
  entry: HookEntry,
  hooksDir: string,
  cwd: string,
  env: Record<string, string>,
): ChildProcess {
  if (entry.command) {
    return spawn(entry.command, {
      cwd,
      env,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  if (entry.script) {
    const path = isAbsolute(entry.script) ? entry.script : join(hooksDir, entry.script);
    return spawn(path, [], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  throw new Error("hook entry has neither `command` nor `script`");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

/** Drop env entries whose value is undefined so `spawn` doesn't complain. */
function filterEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}
