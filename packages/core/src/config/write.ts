import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { KmanConfig } from '@kman/types';
import { configPath } from '../paths.js';
import { validateConfig } from './validate.js';

/** Serialize a config to the canonical, stable-key JSON form written on disk. */
export function serializeConfig(config: KmanConfig): string {
  validateConfig(config);
  const defaults: Record<string, unknown> = { runtime: config.defaults.runtime };
  if (config.defaults.model !== undefined) defaults['model'] = config.defaults.model;
  if (config.defaults.permission_mode !== undefined) {
    defaults['permission_mode'] = config.defaults.permission_mode;
  }
  if (config.defaults.output_format !== undefined) {
    defaults['output_format'] = config.defaults.output_format;
  }
  if (config.defaults.max_turns !== undefined) defaults['max_turns'] = config.defaults.max_turns;
  return JSON.stringify({ defaults }, null, 2) + '\n';
}

export async function writeConfig(config: KmanConfig): Promise<string> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeConfig(config), 'utf8');
  return path;
}
