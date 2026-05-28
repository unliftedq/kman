/**
 * Minimal JSON-RPC 2.0 over a line-delimited stream — matches the wire format
 * the MCP stdio transport uses. We implement directly instead of pulling in
 * `@modelcontextprotocol/sdk` because the surface we need is small and the
 * dependency would multiply the published CLI's install size.
 *
 * Stdio framing: each message is a single line of UTF-8 JSON terminated by
 * `\n`. Messages MUST NOT contain embedded newlines (the MCP spec requires
 * this; `JSON.stringify` already guarantees it).
 */

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

export class RpcError extends Error {
  public readonly code: number;
  public readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'method' in msg && 'id' in msg;
}

export function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return 'method' in msg && !('id' in msg);
}
