import { describe, expect, test } from 'vitest';
import TOML from '@iarna/toml';
import { parseProfileToml } from './read.js';
import { defaultProfile } from './schema.js';
import { serializeProfile } from './write.js';

describe('serializeProfile', () => {
  test('round-trips through TOML for a minimal profile', () => {
    const p = defaultProfile('coder');
    const body = serializeProfile(p);
    const parsed = parseProfileToml('coder', TOML.parse(body));
    expect(parsed.name).toBe('coder');
    expect(parsed.runtime.default).toBe('pi');
    expect(parsed.soul.prompt_file).toBe('soul.md');
    expect(parsed.defaults.permission_mode).toBe('ask');
    expect(parsed.defaults.output_format).toBe('text');
  });

  test('expands runtimeOverrides into nested tables', () => {
    const p = defaultProfile('coder', {
      runtime: { default: 'claude-code', model: 'opus' },
      defaults: { max_turns: 8 },
      runtimeOverrides: {
        'claude-code': {
          extra_args: ['--debug'],
          permission_mode_raw: 'acceptEdits',
          model: 'haiku',
        },
      },
    });
    const body = serializeProfile(p);
    expect(body).toContain('[runtime.claude-code]');
    expect(body).toContain('permission_mode_raw');
    expect(body).toContain('extra_args');
    expect(body).toContain('max_turns');

    const parsed = parseProfileToml('coder', TOML.parse(body));
    expect(parsed.runtime.model).toBe('opus');
    expect(parsed.defaults.max_turns).toBe(8);
    expect(parsed.runtimeOverrides['claude-code']).toEqual({
      extra_args: ['--debug'],
      permission_mode_raw: 'acceptEdits',
      model: 'haiku',
    });
  });

  test('throws when serializing an invalid profile', () => {
    const p = defaultProfile('coder', {
      defaults: { permission_mode: 'bogus' as unknown as 'ask' },
    });
    expect(() => serializeProfile(p)).toThrow();
  });
});

describe('parseProfileToml', () => {
  test('rejects non-object input', () => {
    expect(() => parseProfileToml('coder', 'a string' as unknown)).toThrow();
    expect(() => parseProfileToml('coder', null as unknown)).toThrow();
  });

  test('forces directory-derived name over TOML body name', () => {
    const raw = {
      name: 'mismatched',
      runtime: { default: 'claude-code' },
      soul: { prompt_file: 'soul.md' },
      defaults: {},
    };
    const parsed = parseProfileToml('coder', raw);
    expect(parsed.name).toBe('coder');
  });

  test('captures backend override tables as runtimeOverrides', () => {
    const raw = {
      runtime: {
        default: 'claude-code',
        'claude-code': {
          permission_mode_raw: 'plan',
          extra_args: ['--verbose'],
        },
      },
      soul: { prompt_file: 'soul.md' },
      defaults: {},
    };
    const parsed = parseProfileToml('coder', raw);
    expect(parsed.runtimeOverrides['claude-code']).toEqual({
      permission_mode_raw: 'plan',
      extra_args: ['--verbose'],
    });
  });

  test('drops non-string entries from extra_args', () => {
    const raw = {
      runtime: {
        default: 'claude-code',
        'claude-code': { extra_args: ['--ok', 42, true] },
      },
      soul: { prompt_file: 'soul.md' },
      defaults: {},
    };
    const parsed = parseProfileToml('coder', raw);
    expect(parsed.runtimeOverrides['claude-code']?.extra_args).toEqual(['--ok']);
  });
});
