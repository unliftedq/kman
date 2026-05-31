import { readFile } from 'node:fs/promises';
import { type ConfigDefaults, type KmanConfig, UserError } from '@kman/types';
import { configPath } from '../paths.js';
import { mergeConfig } from './schema.js';
import { validateConfig } from './validate.js';

/** Parse a raw JSON value into a validated, fully-merged config. */
export function parseConfig(raw: unknown): KmanConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new UserError('config.json must contain a JSON object.');
  }
  const obj = raw as Record<string, unknown>;

  const defaultsRaw = (obj['defaults'] as Record<string, unknown> | undefined) ?? {};
  if (typeof defaultsRaw !== 'object' || defaultsRaw === null || Array.isArray(defaultsRaw)) {
    throw new UserError('config.json: "defaults" must be an object.');
  }

  const partial: Partial<ConfigDefaults> = {};
  if (typeof defaultsRaw['runtime'] === 'string') partial.runtime = defaultsRaw['runtime'] as string;
  if (typeof defaultsRaw['model'] === 'string') partial.model = defaultsRaw['model'] as string;
  if (typeof defaultsRaw['permission_mode'] === 'string') {
    partial.permission_mode = defaultsRaw['permission_mode'] as ConfigDefaults['permission_mode'];
  }
  if (typeof defaultsRaw['output_format'] === 'string') {
    partial.output_format = defaultsRaw['output_format'] as ConfigDefaults['output_format'];
  }
  if (typeof defaultsRaw['max_turns'] === 'number') partial.max_turns = defaultsRaw['max_turns'] as number;

  const config = mergeConfig({ defaults: partial as ConfigDefaults });
  validateConfig(config);
  return config;
}

/**
 * Read ~/.kman/config.json. A missing file is not an error — the built-in
 * defaults are returned so first-run usage works without any setup.
 */
export async function readConfig(): Promise<KmanConfig> {
  const path = configPath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return mergeConfig(undefined);
    }
    throw new UserError(`Failed to read ${path}: ${(cause as Error).message}`, { cause });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new UserError(`Failed to parse ${path}: ${(cause as Error).message}`, { cause });
  }
  return parseConfig(parsed);
}
