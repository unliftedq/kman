/** Normalized event stream emitted by backend adapters and consumed by session writer / CLI output. */

export type DelegoEvent =
  | { type: "message"; role: "assistant" | "user"; content: string; ts: string }
  | { type: "tool_use"; tool: string; input: unknown; id: string; ts: string }
  | { type: "tool_result"; tool: string; output: unknown; id: string; ok: boolean; ts: string }
  | { type: "usage"; turns: number; input_tokens: number; output_tokens: number; cost_usd?: number }
  | { type: "error"; message: string; recoverable: boolean }
  | { type: "end"; reason: "completed" | "aborted" | "error"; session_id: string };
