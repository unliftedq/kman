import type { ConfigDefaults, KmanConfig } from '@kman/types';

/** Built-in fallback used when config.json is absent or a field is unset. */
export const BUILTIN_CONFIG: KmanConfig = {
  defaults: {
    runtime: 'claude-code',
  },
};

/**
 * Merge a partial (possibly empty) config over the built-in baseline so callers
 * always receive a fully-populated `defaults.runtime`.
 */
export function mergeConfig(partial: Partial<KmanConfig> | undefined): KmanConfig {
  const defaults: ConfigDefaults = {
    runtime: partial?.defaults?.runtime ?? BUILTIN_CONFIG.defaults.runtime,
  };
  if (partial?.defaults?.model !== undefined) defaults.model = partial.defaults.model;
  if (partial?.defaults?.permission_mode !== undefined) {
    defaults.permission_mode = partial.defaults.permission_mode;
  }
  if (partial?.defaults?.output_format !== undefined) {
    defaults.output_format = partial.defaults.output_format;
  }
  if (partial?.defaults?.max_turns !== undefined) defaults.max_turns = partial.defaults.max_turns;
  return { defaults };
}

/** A complete config seeded entirely from built-in defaults. */
export function defaultConfig(): KmanConfig {
  return mergeConfig(undefined);
}
