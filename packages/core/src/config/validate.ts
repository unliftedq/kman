import { type KmanConfig, UserError } from '@kman/types';
import { KNOWN_BACKENDS, OUTPUT_FORMATS, PERMISSION_LEVELS } from '../profile/schema.js';

/**
 * Validate a fully-merged config. `runtime` may name a backend outside the
 * built-in set (forward-compat with future adapters), so an unknown value is a
 * warning surfaced by the caller rather than a hard error here — but the
 * enum-typed fields must match their allowed values.
 */
export function validateConfig(config: KmanConfig): void {
  const d = config.defaults;

  if (typeof d.runtime !== 'string' || d.runtime.length === 0) {
    throw new UserError('config.json: defaults.runtime must be a non-empty string.');
  }

  if (d.permission_mode !== undefined && !PERMISSION_LEVELS.includes(d.permission_mode)) {
    throw new UserError(
      `config.json: invalid defaults.permission_mode "${d.permission_mode}". Expected one of: ${PERMISSION_LEVELS.join(', ')}.`,
    );
  }

  if (d.output_format !== undefined && !OUTPUT_FORMATS.includes(d.output_format)) {
    throw new UserError(
      `config.json: invalid defaults.output_format "${d.output_format}". Expected one of: ${OUTPUT_FORMATS.join(', ')}.`,
    );
  }

  if (d.max_turns !== undefined && (!Number.isInteger(d.max_turns) || d.max_turns <= 0)) {
    throw new UserError(
      `config.json: invalid defaults.max_turns ${d.max_turns}. Expected a positive integer.`,
    );
  }
}

/** True when `runtime` names a backend kman ships an adapter for. */
export function isKnownBackend(runtime: string): boolean {
  return KNOWN_BACKENDS.includes(runtime as (typeof KNOWN_BACKENDS)[number]);
}
