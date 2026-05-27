import type {
  BackendName,
  OutputFormat,
  PermissionLevel,
  Profile,
} from './profile.js';

/**
 * Immutable per-run context (§3.2). Built once before backend spawn.
 */
export interface AgentContext {
  /** Resolved agent profile, untouched (profile stays immutable on disk). */
  readonly profile: Profile;
  /** Absolute path to the agent directory (~/.delego/agents/<name>). */
  readonly agentDir: string;
  /** Rendered soul prompt content (the file body, not the path). */
  readonly soulPrompt: string;
  /** Selected backend after profile + CLI override merge. */
  readonly backend: BackendName;
  /** Resolved model, possibly undefined → backend default. */
  readonly model?: string;
  /** Effective permission level. */
  readonly permission: PermissionLevel;
  /** Effective output format. */
  readonly outputFormat: OutputFormat;
  /** Effective max turns. */
  readonly maxTurns?: number;
  /** Working directory for the backend process. */
  readonly cwd: string;
  /** Backend-specific extra args (from profile [runtime.<backend>] + CLI runtimeFlags). */
  readonly extraArgs: readonly string[];
  /** Raw permission_mode escape hatch (overrides abstract mapping if set). */
  readonly permissionModeRaw?: string;
  /** Environment to inject into backend process. */
  readonly env: Readonly<Record<string, string>>;
  /** Optional run task (one-shot mode). */
  readonly task?: string;
  /** Stream mode requested. */
  readonly stream: boolean;
}

export interface ContextOverrides {
  backend?: BackendName;
  model?: string;
  permission?: PermissionLevel;
  outputFormat?: OutputFormat;
  runtimeFlags?: string[];
  cwd?: string;
  task?: string;
  stream?: boolean;
  env?: Record<string, string>;
}
