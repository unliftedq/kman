/**
 * Stream-JSON parser for Claude Code's --output-format stream-json.
 *
 * Each line is a JSON object with a `type` discriminator. We translate
 * these into the normalized DelegoEvent stream.
 *
 * Reference shapes (as observed from Claude Code SDK output):
 *   {"type":"system","subtype":"init", ...}
 *   {"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."},...]}}
 *   {"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"...","content":"..."}]}}
 *   {"type":"result","subtype":"success","result":"...","usage":{...},"total_cost_usd":...,"num_turns":...}
 */

import type { DelegoEvent } from "@delego/types";

interface ClaudeContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface ClaudeMessage {
  role: "assistant" | "user";
  content: ClaudeContentBlock[];
}

interface ClaudeLine {
  type: string;
  subtype?: string;
  message?: ClaudeMessage;
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  total_cost_usd?: number;
  num_turns?: number;
  session_id?: string;
  is_error?: boolean;
}

export function* translateClaudeLine(line: string, sessionId: string): Generator<DelegoEvent> {
  if (!line.trim()) return;
  let parsed: ClaudeLine;
  try {
    parsed = JSON.parse(line) as ClaudeLine;
  } catch {
    return;
  }

  const ts = new Date().toISOString();

  switch (parsed.type) {
    case "system":
      // ignore init / status lines for v1
      return;

    case "assistant":
    case "user": {
      const msg = parsed.message;
      if (!msg) return;
      for (const block of msg.content ?? []) {
        if (block.type === "text" && typeof block.text === "string") {
          yield {
            type: "message",
            role: msg.role,
            content: block.text,
            ts,
          };
        } else if (block.type === "tool_use") {
          yield {
            type: "tool_use",
            tool: block.name ?? "(unknown)",
            input: block.input,
            id: block.id ?? "",
            ts,
          };
        } else if (block.type === "tool_result") {
          yield {
            type: "tool_result",
            tool: "(result)",
            output: block.content,
            id: block.tool_use_id ?? "",
            ok: !block.is_error,
            ts,
          };
        }
      }
      return;
    }

    case "result": {
      const turns = parsed.num_turns ?? 0;
      const inputTokens = parsed.usage?.input_tokens ?? 0;
      const outputTokens = parsed.usage?.output_tokens ?? 0;
      const costUsd = parsed.total_cost_usd;

      yield {
        type: "usage",
        turns,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        ...(typeof costUsd === "number" ? { cost_usd: costUsd } : {}),
      };

      if (parsed.is_error || parsed.subtype === "error") {
        yield {
          type: "end",
          reason: "error",
          session_id: parsed.session_id ?? sessionId,
        };
      } else {
        yield {
          type: "end",
          reason: "completed",
          session_id: parsed.session_id ?? sessionId,
        };
      }
      return;
    }

    default:
      return;
  }
}

/**
 * Line-buffering helper: takes raw chunks from a stdout pipe (Uint8Array),
 * decodes UTF-8, and yields complete lines.
 */
export class LineBuffer {
  private buffer = "";
  private readonly decoder = new TextDecoder("utf-8");

  push(chunk: Uint8Array): string[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    const lines: string[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      lines.push(this.buffer.slice(0, nl));
      this.buffer = this.buffer.slice(nl + 1);
    }
    return lines;
  }

  flush(): string | null {
    const rest = this.buffer + this.decoder.decode();
    this.buffer = "";
    return rest.length > 0 ? rest : null;
  }
}
