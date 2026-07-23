import type {
  BackendName,
  DefaultsConfig,
  OutputFormat,
  PermissionLevel,
  Profile,
} from '@kman/types';

export const KNOWN_BACKENDS: readonly BackendName[] = ['pi', 'claude-code', 'copilot-cli'];
export const PERMISSION_LEVELS: readonly PermissionLevel[] = ['ask', 'auto', 'yolo'];
export const OUTPUT_FORMATS: readonly OutputFormat[] = ['text', 'json', 'stream-json'];

export const DEFAULT_DEFAULTS: Required<Pick<DefaultsConfig, 'permission_mode' | 'output_format'>> = {
  permission_mode: 'ask',
  output_format: 'text',
};

export function defaultProfile(name: string, overrides: Partial<Profile> = {}): Profile {
  return {
    name,
    description: overrides.description,
    runtime: {
      default: overrides.runtime?.default ?? 'pi',
      ...(overrides.runtime?.model !== undefined ? { model: overrides.runtime.model } : {}),
    },
    soul: {
      prompt_file: overrides.soul?.prompt_file ?? 'soul.md',
    },
    defaults: {
      max_turns: overrides.defaults?.max_turns,
      permission_mode: overrides.defaults?.permission_mode ?? DEFAULT_DEFAULTS.permission_mode,
      output_format: overrides.defaults?.output_format ?? DEFAULT_DEFAULTS.output_format,
    },
    runtimeOverrides: overrides.runtimeOverrides ?? {},
  };
}
