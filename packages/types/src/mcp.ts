/** Resolved MCP server spec passed to backend adapters (in AgentContext). */
export interface McpServerSpec {
  /** Logical name as seen by the backend (e.g. "delego", "github"). */
  name: string;
  /** Transport. v1 supports only stdio. */
  type: "stdio";
  /** Executable to spawn. */
  command: string;
  /** Argv passed to the executable. */
  args: string[];
  /** Environment variables (already resolved from env/keyring). */
  env?: Record<string, string>;
}
