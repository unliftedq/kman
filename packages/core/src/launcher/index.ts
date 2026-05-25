import type {
  AgentContext,
  Backend,
  DelegoEvent,
  OutputFormat,
  RunOptions,
} from "@delego/types";

import { openSessionWriter, type SessionWriter } from "../sessions";

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
