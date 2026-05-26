/** Profile schema (mirror of agent.toml). */

export type BackendName = "claude-code" | "codex" | "copilot-cli" | "gemini" | (string & {});

export type PermissionMode = "ask" | "auto" | "yolo";

export type OutputFormat = "text" | "json" | "stream-json";

export interface RuntimeConfig {
  default: BackendName;
  model?: string;
}

export interface SoulConfig {
  prompt_file: string;
}

export interface MemoryConfig {
  enabled: boolean;
  char_limit: number;
  provider: string;
}

export type ToolEntry =
  | { type: "mcp"; server: string; include?: string[] }
  | { type: "shell"; cmd: string }
  | { type: "http"; url: string; method?: string };

export type ToolsConfig = Record<string, ToolEntry>;

export interface HookEntry {
  command?: string;
  script?: string;
  on_success_only?: boolean;
}

export interface HooksConfig {
  pre_run?: HookEntry[];
  post_run?: HookEntry[];
  on_error?: HookEntry[];
  pre_memory_write?: HookEntry[];
}

export interface DefaultsConfig {
  max_turns: number;
  permission_mode: PermissionMode;
  output_format: OutputFormat;
}

export interface RuntimeOverride {
  permission_mode_raw?: string;
  extra_args?: string[];
}

export interface Profile {
  name: string;
  description?: string;
  runtime: RuntimeConfig;
  soul: SoulConfig;
  memory: MemoryConfig;
  tools: ToolsConfig;
  hooks: HooksConfig;
  defaults: DefaultsConfig;
  /** Backend-specific escape hatches: [runtime.claude-code], [runtime.codex], ... */
  runtimeOverrides: Partial<Record<BackendName, RuntimeOverride>>;
}
