import {
  AGENT_NAME_PATTERN,
  type Profile,
  UserError,
} from '@delego/types';
import { OUTPUT_FORMATS, PERMISSION_LEVELS } from './schema.js';

export function validateAgentName(name: string): void {
  if (!AGENT_NAME_PATTERN.test(name)) {
    throw new UserError(
      `Invalid agent name "${name}". Must match ${AGENT_NAME_PATTERN.source} (lowercase kebab-case, 1–63 chars).`,
    );
  }
}

export function validateProfile(profile: Profile): void {
  validateAgentName(profile.name);

  if (!profile.runtime || typeof profile.runtime.default !== 'string') {
    throw new UserError(`Profile "${profile.name}" is missing runtime.default.`);
  }

  const pm = profile.defaults.permission_mode;
  if (pm !== undefined && !PERMISSION_LEVELS.includes(pm)) {
    throw new UserError(
      `Profile "${profile.name}" has invalid permission_mode "${pm}". Expected one of: ${PERMISSION_LEVELS.join(', ')}.`,
    );
  }

  const of = profile.defaults.output_format;
  if (of !== undefined && !OUTPUT_FORMATS.includes(of)) {
    throw new UserError(
      `Profile "${profile.name}" has invalid output_format "${of}". Expected one of: ${OUTPUT_FORMATS.join(', ')}.`,
    );
  }

  if (
    profile.defaults.max_turns !== undefined &&
    (!Number.isInteger(profile.defaults.max_turns) || profile.defaults.max_turns <= 0)
  ) {
    throw new UserError(
      `Profile "${profile.name}" has invalid max_turns ${profile.defaults.max_turns}. Expected positive integer.`,
    );
  }
}
