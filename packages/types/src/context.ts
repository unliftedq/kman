import type {
  BackendName,
  HooksConfig,
  MemoryConfig,
  OutputFormat,
  PermissionMode,
  Profile,
  ToolsConfig,
} from "./profile";
import type { McpServerSpec } from "./mcp";

/** Immutable runtime view assembled before every backend launch. */
export interface AgentContext {
  /** Identity */
  readonly agentName: string;
  readonly runId: string;
  readonly sessionId: string;

  /** Filesystem */
  readonly agentDir: string;
  readonly memoryPath: string;
  readonly sessionsDir: string;
  readonly hooksDir: string;

  /** Effective runtime selection (after CLI overrides) */
  readonly runtime: BackendName;
  readonly model?: string;
  readonly permission: PermissionMode;
  readonly outputFormat: OutputFormat;
  readonly maxTurns: number;
  readonly cwd: string;

  /** Effective behavioral config */
  readonly memory: MemoryConfig & { snapshot: string };
  readonly tools: ToolsConfig;
  readonly hooks: HooksConfig;

  /** Rendered system prompt = soul.md + frozen memory snapshot block */
  readonly systemPrompt: string;

  /**
   * Effective MCP server list the backend should attach to.
   * Includes the auto-injected `delego` server (per-run, bound to this context)
   * plus any external servers referenced via [tools] in the profile.
   */
  readonly mcpServers: readonly McpServerSpec[];

  /** Other agents available for `delegate_<peer>` MCP tools */
  readonly peerAgents: readonly string[];

  /** Raw flags passed via --runtime-flag, after profile overrides applied */
  readonly runtimeRawFlags: Readonly<Record<string, string>>;

  /** Source profile (debugging / introspection only — do not mutate) */
  readonly profile: Profile;
}

export interface RunOptions {
  task: string;
  resume?: string;
  stream?: boolean;
}

export interface ChatOptions {
  resume?: string;
}
