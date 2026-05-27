import { readFile } from 'node:fs/promises';
import TOML from '@iarna/toml';
import {
  type BackendOverrideConfig,
  type DefaultsConfig,
  type Profile,
  UserError,
} from '@delego/types';
import { agentProfilePath } from '../paths.js';
import { defaultProfile } from './schema.js';
import { validateProfile } from './validate.js';

/**
 * Parse a raw TOML object into a Profile.
 * The raw object can contain backend-specific tables like
 * `[runtime.claude-code]` which TOML.parse models as nested objects under `runtime`.
 */
export function parseProfileToml(name: string, raw: unknown): Profile {
  if (typeof raw !== 'object' || raw === null) {
    throw new UserError(`Profile "${name}" is not a valid TOML object.`);
  }
  const obj = raw as Record<string, unknown>;

  const description = typeof obj['description'] === 'string' ? (obj['description'] as string) : undefined;

  const runtimeRaw = (obj['runtime'] as Record<string, unknown> | undefined) ?? {};
  // Per design, `default` and `model` are top-level inside [runtime]; backend names map to nested
  // tables (e.g. [runtime.claude-code]). Extract them and treat any object-typed siblings as overrides.
  const runtimeDefault =
    typeof runtimeRaw['default'] === 'string' ? (runtimeRaw['default'] as string) : 'claude-code';
  const runtimeModel =
    typeof runtimeRaw['model'] === 'string' ? (runtimeRaw['model'] as string) : undefined;

  const runtimeOverrides: Record<string, BackendOverrideConfig> = {};
  for (const [key, value] of Object.entries(runtimeRaw)) {
    if (key === 'default' || key === 'model') continue;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const v = value as Record<string, unknown>;
      const override: BackendOverrideConfig = {};
      if (typeof v['permission_mode_raw'] === 'string') {
        override.permission_mode_raw = v['permission_mode_raw'] as string;
      }
      if (Array.isArray(v['extra_args'])) {
        override.extra_args = (v['extra_args'] as unknown[]).filter(
          (x): x is string => typeof x === 'string',
        );
      }
      if (typeof v['model'] === 'string') {
        override.model = v['model'] as string;
      }
      runtimeOverrides[key] = override;
    }
  }

  const soulRaw = (obj['soul'] as Record<string, unknown> | undefined) ?? {};
  const soulFile = typeof soulRaw['prompt_file'] === 'string' ? (soulRaw['prompt_file'] as string) : 'soul.md';

  const defaultsRaw = (obj['defaults'] as Record<string, unknown> | undefined) ?? {};
  const defaults: DefaultsConfig = {
    max_turns:
      typeof defaultsRaw['max_turns'] === 'number' ? (defaultsRaw['max_turns'] as number) : undefined,
    permission_mode:
      typeof defaultsRaw['permission_mode'] === 'string'
        ? (defaultsRaw['permission_mode'] as Profile['defaults']['permission_mode'])
        : undefined,
    output_format:
      typeof defaultsRaw['output_format'] === 'string'
        ? (defaultsRaw['output_format'] as Profile['defaults']['output_format'])
        : undefined,
  };

  const profile = defaultProfile(name, {
    description,
    runtime: {
      default: runtimeDefault,
      ...(runtimeModel !== undefined ? { model: runtimeModel } : {}),
    },
    soul: { prompt_file: soulFile },
    defaults,
    runtimeOverrides,
  });
  validateProfile(profile);
  return profile;
}

export async function readProfile(name: string): Promise<Profile> {
  const path = agentProfilePath(name);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new UserError(`Agent "${name}" not found at ${path}.`);
    }
    throw new UserError(`Failed to read profile for "${name}": ${(cause as Error).message}`, { cause });
  }
  let parsed: TOML.JsonMap;
  try {
    parsed = TOML.parse(raw);
  } catch (cause) {
    throw new UserError(`Failed to parse ${path}: ${(cause as Error).message}`, { cause });
  }

  // Profile.name on disk may not match the directory — directory wins (case-sensitive).
  return parseProfileToml(name, { ...parsed, name });
}
