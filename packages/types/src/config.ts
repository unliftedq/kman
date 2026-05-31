/**
 * Global kman configuration — mirrors ~/.kman/config.json (§4).
 *
 * config.json holds user-level defaults that apply across the whole roster.
 * Today its sole job is to seed new agents created via `kman agent create`
 * when the corresponding flag is omitted, so a user who lives on one backend
 * doesn't have to repeat `--runtime` every time.
 */

import type { BackendName, OutputFormat, PermissionLevel } from './profile.js';

/** Defaults seeded into a freshly created agent profile when its flag is absent. */
export interface ConfigDefaults {
  /** Default backend for new agents (claude-code | copilot-cli in v1). */
  runtime: BackendName;
  /** Default model id for new agents; backend default when omitted. */
  model?: string;
  /** Default permission mode for new agents. */
  permission_mode?: PermissionLevel;
  /** Default output format for new agents. */
  output_format?: OutputFormat;
  /** Default max turns for new agents. */
  max_turns?: number;
}

export interface KmanConfig {
  defaults: ConfigDefaults;
}
