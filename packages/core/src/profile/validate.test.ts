import { describe, expect, test } from 'bun:test';
import { UserError } from '@kman/types';
import { defaultProfile } from './schema.js';
import { validateAgentName, validateProfile } from './validate.js';

describe('validateAgentName', () => {
  test('accepts well-formed names', () => {
    expect(() => validateAgentName('coder')).not.toThrow();
    expect(() => validateAgentName('release-bot')).not.toThrow();
  });

  test('rejects malformed names with a UserError', () => {
    expect(() => validateAgentName('Coder')).toThrow(UserError);
    expect(() => validateAgentName('-bot')).toThrow(UserError);
    expect(() => validateAgentName('')).toThrow(UserError);
  });
});

describe('validateProfile', () => {
  test('accepts a default profile', () => {
    expect(() => validateProfile(defaultProfile('coder'))).not.toThrow();
  });

  test('rejects missing runtime.default', () => {
    const p = defaultProfile('coder');
    // simulate corrupt input
    (p.runtime as { default: unknown }).default = 123 as unknown as string;
    expect(() => validateProfile(p)).toThrow(/runtime\.default/);
  });

  test('rejects unknown permission_mode', () => {
    const p = defaultProfile('coder', {
      defaults: { permission_mode: 'wide-open' as unknown as 'ask' },
    });
    expect(() => validateProfile(p)).toThrow(/permission_mode/);
  });

  test('rejects unknown output_format', () => {
    const p = defaultProfile('coder', {
      defaults: { output_format: 'yaml' as unknown as 'text' },
    });
    expect(() => validateProfile(p)).toThrow(/output_format/);
  });

  test('rejects non-positive or fractional max_turns', () => {
    const p1 = defaultProfile('coder', { defaults: { max_turns: 0 } });
    expect(() => validateProfile(p1)).toThrow(/max_turns/);

    const p2 = defaultProfile('coder', { defaults: { max_turns: 1.5 } });
    expect(() => validateProfile(p2)).toThrow(/max_turns/);

    const p3 = defaultProfile('coder', { defaults: { max_turns: -5 } });
    expect(() => validateProfile(p3)).toThrow(/max_turns/);
  });
});
