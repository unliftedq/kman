import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { KMAN_PLUGIN_NAME, runtimeAgentRoot, runtimePluginDir, runtimeRoot } from './paths.js';

describe('runtime paths', () => {
  const originalHome = process.env['KMAN_HOME'];
  beforeEach(() => {
    process.env['KMAN_HOME'] = '/k';
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env['KMAN_HOME'];
    else process.env['KMAN_HOME'] = originalHome;
  });

  test('plugin name is fixed to "kman"', () => {
    expect(KMAN_PLUGIN_NAME).toBe('kman');
  });

  test('runtime dirs sit under ~/.kman/runtime', () => {
    expect(runtimeRoot()).toBe(join('/k', 'runtime'));
    expect(runtimeAgentRoot('coder')).toBe(join('/k', 'runtime', 'coder'));
  });

  test('plugin dir is .claude or .copilot per layout', () => {
    expect(runtimePluginDir('coder', 'claude')).toBe(join('/k', 'runtime', 'coder', '.claude'));
    expect(runtimePluginDir('coder', 'copilot')).toBe(join('/k', 'runtime', 'coder', '.copilot'));
  });
});
