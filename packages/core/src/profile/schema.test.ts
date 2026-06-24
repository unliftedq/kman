import { describe, expect, test } from 'vitest';
import {
  DEFAULT_DEFAULTS,
  KNOWN_BACKENDS,
  OUTPUT_FORMATS,
  PERMISSION_LEVELS,
  defaultProfile,
} from './schema.js';

describe('schema constants', () => {
  test('KNOWN_BACKENDS lists v1 adapters', () => {
    expect(KNOWN_BACKENDS).toEqual(['claude-code', 'copilot-cli']);
  });

  test('PERMISSION_LEVELS lists the abstract levels', () => {
    expect(PERMISSION_LEVELS).toEqual(['ask', 'auto', 'yolo']);
  });

  test('OUTPUT_FORMATS lists the supported formats', () => {
    expect(OUTPUT_FORMATS).toEqual(['text', 'json', 'stream-json']);
  });

  test('DEFAULT_DEFAULTS resolves to ask + text', () => {
    expect(DEFAULT_DEFAULTS).toEqual({ permission_mode: 'ask', output_format: 'text' });
  });
});

describe('defaultProfile', () => {
  test('fills in safe defaults when no overrides are passed', () => {
    const p = defaultProfile('coder');
    expect(p.name).toBe('coder');
    expect(p.runtime.default).toBe('claude-code');
    expect(p.runtime.model).toBeUndefined();
    expect(p.soul.prompt_file).toBe('soul.md');
    expect(p.defaults.permission_mode).toBe('ask');
    expect(p.defaults.output_format).toBe('text');
    expect(p.runtimeOverrides).toEqual({});
  });

  test('applies overrides without leaking undefined runtime.model', () => {
    const p = defaultProfile('coder', {
      runtime: { default: 'copilot-cli', model: 'gpt-5' },
      soul: { prompt_file: 'custom.md' },
      defaults: { permission_mode: 'auto', output_format: 'json', max_turns: 12 },
      description: 'a description',
    });
    expect(p.runtime.default).toBe('copilot-cli');
    expect(p.runtime.model).toBe('gpt-5');
    expect(p.soul.prompt_file).toBe('custom.md');
    expect(p.defaults.permission_mode).toBe('auto');
    expect(p.defaults.output_format).toBe('json');
    expect(p.defaults.max_turns).toBe(12);
    expect(p.description).toBe('a description');
  });

  test('falls back to claude-code when runtime override omits default', () => {
    const p = defaultProfile('x', { runtime: { default: undefined as unknown as string } });
    expect(p.runtime.default).toBe('claude-code');
  });

  test('preserves runtimeOverrides when supplied', () => {
    const p = defaultProfile('x', {
      runtimeOverrides: {
        'claude-code': { extra_args: ['--foo', '--bar'] },
      },
    });
    expect(p.runtimeOverrides['claude-code']?.extra_args).toEqual(['--foo', '--bar']);
  });
});
