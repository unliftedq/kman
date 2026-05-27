import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import TOML from '@iarna/toml';
import type { Profile } from '@delego/types';
import { agentProfilePath } from '../paths.js';
import { validateProfile } from './validate.js';

/** Serialize a Profile to TOML, expanding runtimeOverrides into nested tables. */
export function serializeProfile(profile: Profile): string {
  validateProfile(profile);
  const out: TOML.JsonMap = {
    name: profile.name,
  };
  if (profile.description !== undefined) out['description'] = profile.description;

  const runtime: TOML.JsonMap = { default: profile.runtime.default };
  if (profile.runtime.model !== undefined) runtime['model'] = profile.runtime.model;
  for (const [backend, override] of Object.entries(profile.runtimeOverrides)) {
    const t: TOML.JsonMap = {};
    if (override.permission_mode_raw !== undefined) t['permission_mode_raw'] = override.permission_mode_raw;
    if (override.extra_args !== undefined) t['extra_args'] = [...override.extra_args];
    if (override.model !== undefined) t['model'] = override.model;
    if (Object.keys(t).length > 0) runtime[backend] = t;
  }
  out['runtime'] = runtime;

  out['soul'] = { prompt_file: profile.soul.prompt_file };

  const defaults: TOML.JsonMap = {};
  if (profile.defaults.max_turns !== undefined) defaults['max_turns'] = profile.defaults.max_turns;
  if (profile.defaults.permission_mode !== undefined) defaults['permission_mode'] = profile.defaults.permission_mode;
  if (profile.defaults.output_format !== undefined) defaults['output_format'] = profile.defaults.output_format;
  out['defaults'] = defaults;

  return TOML.stringify(out);
}

export async function writeProfile(profile: Profile): Promise<string> {
  const path = agentProfilePath(profile.name);
  await mkdir(dirname(path), { recursive: true });
  const body = serializeProfile(profile);
  await writeFile(path, body, 'utf8');
  return path;
}
