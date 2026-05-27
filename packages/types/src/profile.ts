/**
 * Profile schema — mirrors agent.toml on disk (§5.1).
 */

export type BackendName = 'claude-code' | 'copilot-cli' | (string & {});

export type PermissionLevel = 'ask' | 'auto' | 'yolo';

export type OutputFormat = 'text' | 'json' | 'stream-json';

export interface RuntimeConfig {
  default: BackendName;
  model?: string;
}

export interface SoulConfig {
  prompt_file: string;
}

export interface DefaultsConfig {
  max_turns?: number;
  permission_mode?: PermissionLevel;
  output_format?: OutputFormat;
}

export interface BackendOverrideConfig {
  permission_mode_raw?: string;
  extra_args?: string[];
  model?: string;
}

export interface Profile {
  name: string;
  description?: string;
  runtime: RuntimeConfig;
  soul: SoulConfig;
  defaults: DefaultsConfig;
  /** Backend-specific escape hatches keyed by backend name. */
  runtimeOverrides: Record<string, BackendOverrideConfig>;
}

export const AGENT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
