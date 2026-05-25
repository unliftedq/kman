/**
 * Generic text-mode backend helper.
 *
 * Most backend CLIs (codex, copilot-cli, gemini-cli) have a non-interactive "print
 * the assistant reply on stdout" mode that doesn't ship a normalized event stream
 * the way claude-code does. This helper spawns such a process, captures stdout,
 * and emits the minimal sequence of normalized DelegoEvents the launcher / session
 * writer expect:
 *
 *   - one `message` event (role=assistant) containing the captured stdout text
 *   - one `usage`   event (turns=1, tokens=0 — backend doesn't report them)
 *   - one `end`     event (reason=completed | error)
 *
 * On spawn / non-zero exit, an `error` event is emitted before `end`.
 *
 * This intentionally stays minimal: backends that gain native stream-json support
 * later can swap to their own translator and still satisfy the Backend interface.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { DelegoEvent } from "@delego/types";

export interface TextRunOptions {
  /** Executable to spawn (e.g. "codex"). */
  command: string;
  /** Argv. */
  args: string[];
  /** Working directory. */
  cwd?: string;
  /** Extra env merged onto process.env. */
  env?: Record<string, string>;
  /** Session id stamped into `end` events. */
  sessionId: string;
  /**
   * Human-readable backend label, used in error messages
   * (e.g. "codex exited with code 2").
   */
  label: string;
}

/**
 * Run a one-shot text-mode backend and yield normalized events.
 *
 * Stderr is forwarded to the parent process's stderr so the user sees
 * backend-side diagnostics live.
 */
export async function* runTextBackend(opts: TextRunOptions): AsyncIterable<DelegoEvent> {
  let proc: ChildProcess;
  try {
    proc = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(opts.env ?? {}) },
    });
  } catch (err) {
    yield {
      type: "error",
      message: `Failed to spawn ${opts.label}: ${err instanceof Error ? err.message : String(err)}`,
      recoverable: false,
    };
    yield { type: "end", reason: "error", session_id: opts.sessionId };
    return;
  }

  // Surface async spawn errors (ENOENT, EACCES, …)
  let spawnError: Error | null = null;
  await new Promise<void>((resolve) => {
    proc.once("spawn", resolve);
    proc.once("error", (err) => {
      spawnError = err;
      resolve();
    });
  });
  if (spawnError) {
    yield {
      type: "error",
      message: `Failed to spawn ${opts.label}: ${(spawnError as Error).message}`,
      recoverable: false,
    };
    yield { type: "end", reason: "error", session_id: opts.sessionId };
    return;
  }

  proc.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });

  const decoder = new TextDecoder("utf-8");
  let collected = "";
  if (proc.stdout) {
    for await (const chunk of proc.stdout as AsyncIterable<Buffer>) {
      collected += decoder.decode(chunk, { stream: true });
    }
    collected += decoder.decode();
  }

  const exitCode = await new Promise<number>((resolve) => {
    if (proc.exitCode !== null) return resolve(proc.exitCode);
    proc.once("exit", (code) => resolve(code ?? 0));
  });

  const ts = new Date().toISOString();
  const text = collected.trimEnd();
  if (text.length > 0) {
    yield { type: "message", role: "assistant", content: text, ts };
  }

  yield {
    type: "usage",
    turns: 1,
    input_tokens: 0,
    output_tokens: 0,
  };

  if (exitCode !== 0) {
    yield {
      type: "error",
      message: `${opts.label} exited with code ${exitCode}`,
      recoverable: false,
    };
    yield { type: "end", reason: "error", session_id: opts.sessionId };
    return;
  }

  yield { type: "end", reason: "completed", session_id: opts.sessionId };
}
