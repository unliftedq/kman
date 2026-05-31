import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UserError } from '@kman/types';
import { configPath } from '../paths.js';
import { defaultConfig, mergeConfig } from './schema.js';
import { parseConfig, readConfig } from './read.js';
import { serializeConfig, writeConfig } from './write.js';
import { validateConfig } from './validate.js';

describe('config schema', () => {
  test('defaultConfig falls back to claude-code', () => {
    expect(defaultConfig().defaults.runtime).toBe('claude-code');
  });

  test('mergeConfig overlays partial defaults over built-in', () => {
    const merged = mergeConfig({ defaults: { runtime: 'copilot-cli', model: 'gpt-5' } });
    expect(merged.defaults.runtime).toBe('copilot-cli');
    expect(merged.defaults.model).toBe('gpt-5');
  });

  test('mergeConfig keeps built-in runtime when partial omits it', () => {
    const merged = mergeConfig({ defaults: { max_turns: 10 } as never });
    expect(merged.defaults.runtime).toBe('claude-code');
    expect(merged.defaults.max_turns).toBe(10);
  });
});

describe('config validate', () => {
  test('rejects invalid permission_mode', () => {
    expect(() => validateConfig({ defaults: { runtime: 'claude-code', permission_mode: 'nope' as never } })).toThrow(
      UserError,
    );
  });

  test('rejects non-positive max_turns', () => {
    expect(() => validateConfig({ defaults: { runtime: 'claude-code', max_turns: 0 } })).toThrow(UserError);
  });

  test('accepts an unknown runtime (forward-compat)', () => {
    expect(() => validateConfig({ defaults: { runtime: 'codex' } })).not.toThrow();
  });
});

describe('config parse', () => {
  test('parses a full config object', () => {
    const cfg = parseConfig({
      defaults: { runtime: 'copilot-cli', model: 'gpt-5', permission_mode: 'auto', output_format: 'json', max_turns: 20 },
    });
    expect(cfg.defaults).toEqual({
      runtime: 'copilot-cli',
      model: 'gpt-5',
      permission_mode: 'auto',
      output_format: 'json',
      max_turns: 20,
    });
  });

  test('rejects a non-object root', () => {
    expect(() => parseConfig([1, 2, 3])).toThrow(UserError);
  });

  test('serialize → parse round-trips', () => {
    const cfg = mergeConfig({ defaults: { runtime: 'copilot-cli', model: 'gpt-5' } });
    expect(parseConfig(JSON.parse(serializeConfig(cfg)))).toEqual(cfg);
  });
});

describe('config read/write', () => {
  let home: string;
  const originalHome = process.env['KMAN_HOME'];

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kman-config-'));
    process.env['KMAN_HOME'] = home;
  });
  afterEach(async () => {
    if (originalHome === undefined) delete process.env['KMAN_HOME'];
    else process.env['KMAN_HOME'] = originalHome;
    await rm(home, { recursive: true, force: true });
  });

  test('readConfig returns built-in defaults when the file is missing', async () => {
    const cfg = await readConfig();
    expect(cfg.defaults.runtime).toBe('claude-code');
  });

  test('writeConfig then readConfig round-trips', async () => {
    const written = mergeConfig({ defaults: { runtime: 'copilot-cli', model: 'gpt-5', max_turns: 30 } });
    const path = await writeConfig(written);
    expect(path).toBe(configPath());
    expect(await readConfig()).toEqual(written);
  });

  test('readConfig surfaces malformed JSON as a UserError', async () => {
    await writeFile(configPath(), '{ not json', 'utf8');
    await expect(readConfig()).rejects.toBeInstanceOf(UserError);
  });
});
