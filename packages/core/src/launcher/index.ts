import type {
  AgentContext,
  Backend,
  DelegoEvent,
  OutputFormat,
  RunOptions,
} from "@delego/types";

import { openSessionWriter, type SessionWriter } from "../sessions";
import { runHooks, type HookBatchResult } from "../hooks";

export * from "./self-invoke";

export interface RunSummary {
  sessionId: string;
  sessionPath: string;
  exitReason: "completed" | "aborted" | "error";
  turns: number;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  errorMessage?: string;
}

function hookEnv(ctx: AgentContext, extra: Record<string, string> = {}): Record<string, string> {
  return {
    DELEGO_AGENT_NAME: ctx.agentName,
    DELEGO_RUN_ID: ctx.runId,
    DELEGO_SESSION_ID: ctx.sessionId,
    DELEGO_AGENT_DIR: ctx.agentDir,
    DELEGO_RUNTIME: ctx.runtime,
    DELEGO_CWD: ctx.cwd,
    ...extra,
  };
}

function describeHookFailure(batch: HookBatchResult): string {
  const f = batch.abortedBy;
  if (!f) return "hook aborted run";
  const which = f.entry.command ? `command: ${f.entry.command}` : `script: ${f.entry.script}`;
  if (f.spawnError) return `pre_run hook failed to spawn (${which}): ${f.spawnError}`;
  if (f.timedOut) return `pre_run hook timed out (${which})`;
  return `pre_run hook exited with code ${f.exitCode} (${which})`;
}

export interface RunAgentOptions extends RunOptions {
  output: OutputFormat;
}

/**
 * Drive a backend through a single one-shot run, persisting events to the
 * session log and streaming them to the chosen output sink.
 */
export async function runAgent(
  ctx: AgentContext,
  backend: Backend,
  opts: RunAgentOptions,
  out: NodeJS.WritableStream = process.stdout,
): Promise<RunSummary> {
  const writer: SessionWriter = await openSessionWriter({
    agentName: ctx.agentName,
    sessionId: ctx.sessionId,
  });

  const collected: DelegoEvent[] = [];
  let turns = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd: number | undefined;
  let exitReason: RunSummary["exitReason"] = "completed";
  let errorMessage: string | undefined;

  // pre_run hooks: gate the run. Non-zero exit aborts before backend spawn.
  const preRunBatch = await runHooks(ctx.hooks.pre_run, {
    event: "pre_run",
    payload: {
      agent: ctx.agentName,
      run_id: ctx.runId,
      session_id: ctx.sessionId,
      task: opts.task,
      runtime: ctx.runtime,
      ...(ctx.model ? { model: ctx.model } : {}),
      permission: ctx.permission,
      cwd: ctx.cwd,
      ...(opts.resume ? { resume: opts.resume } : {}),
    },
    cwd: ctx.cwd,
    hooksDir: ctx.hooksDir,
    env: hookEnv(ctx),
  });
  if (preRunBatch.aborted) {
    exitReason = "aborted";
    errorMessage = describeHookFailure(preRunBatch);
    const errEvent: DelegoEvent = { type: "error", message: errorMessage, recoverable: false };
    await writer.write(errEvent);
    if (opts.output === "stream-json") {
      out.write(JSON.stringify(errEvent) + "\n");
    } else if (opts.output === "text") {
      process.stderr.write(`\n[error] ${errorMessage}\n`);
    }
    await writer.close();
    return {
      sessionId: ctx.sessionId,
      sessionPath: writer.path,
      exitReason,
      turns,
      inputTokens,
      outputTokens,
      errorMessage,
    };
  }

  try {
    for await (const event of backend.spawn(ctx, opts)) {
      await writer.write(event);

      // Format-specific output to stdout (or other sink)
      if (opts.output === "stream-json") {
        out.write(JSON.stringify(event) + "\n");
      } else if (opts.output === "text") {
        if (event.type === "message" && event.role === "assistant") {
          out.write(event.content);
        } else if (event.type === "error") {
          process.stderr.write(`\n[error] ${event.message}\n`);
        }
      } else {
        // "json": buffer; emit at end
        collected.push(event);
      }

      // Aggregate stats
      if (event.type === "usage") {
        turns = event.turns;
        inputTokens = event.input_tokens;
        outputTokens = event.output_tokens;
        if (typeof event.cost_usd === "number") costUsd = event.cost_usd;
      } else if (event.type === "error") {
        errorMessage = event.message;
        if (!event.recoverable) exitReason = "error";
      } else if (event.type === "end") {
        exitReason = event.reason;
      }
    }
  } catch (err) {
    exitReason = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    const errEvent: DelegoEvent = {
      type: "error",
      message: errorMessage,
      recoverable: false,
    };
    await writer.write(errEvent);
    if (opts.output === "stream-json") {
      out.write(JSON.stringify(errEvent) + "\n");
    } else if (opts.output === "text") {
      process.stderr.write(`\n[error] ${errorMessage}\n`);
    }
  } finally {
    await writer.close();
  }

  // post_run / on_error hooks fire after the backend stream is fully drained.
  // Failures here are recorded to stderr but never change the run's exit status.
  const success = exitReason === "completed";
  const postEnv = hookEnv(ctx, {
    DELEGO_EXIT_REASON: exitReason,
    DELEGO_SUCCESS: success ? "1" : "0",
  });
  const postPayload = {
    agent: ctx.agentName,
    run_id: ctx.runId,
    session_id: ctx.sessionId,
    session_path: writer.path,
    exit_reason: exitReason,
    success,
    turns,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    ...(typeof costUsd === "number" ? { cost_usd: costUsd } : {}),
    ...(errorMessage ? { error: errorMessage } : {}),
  };
  await runHooks(ctx.hooks.post_run, {
    event: "post_run",
    payload: postPayload,
    cwd: ctx.cwd,
    hooksDir: ctx.hooksDir,
    env: postEnv,
    success,
  });
  if (!success) {
    await runHooks(ctx.hooks.on_error, {
      event: "on_error",
      payload: postPayload,
      cwd: ctx.cwd,
      hooksDir: ctx.hooksDir,
      env: postEnv,
      success: false,
    });
  }

  if (opts.output === "text") {
    out.write("\n");
  } else if (opts.output === "json") {
    const summary = {
      session_id: ctx.sessionId,
      session_path: writer.path,
      reason: exitReason,
      turns,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
      error: errorMessage,
      result: extractFinalAssistantText(collected),
    };
    out.write(JSON.stringify(summary) + "\n");
  }

  return {
    sessionId: ctx.sessionId,
    sessionPath: writer.path,
    exitReason,
    turns,
    inputTokens,
    outputTokens,
    ...(typeof costUsd === "number" ? { costUsd } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  };
}

function extractFinalAssistantText(events: DelegoEvent[]): string {
  const chunks: string[] = [];
  for (const e of events) {
    if (e.type === "message" && e.role === "assistant") chunks.push(e.content);
  }
  return chunks.join("");
}
