import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  agentDir,
  agentLogsDir,
  agentProfilePath,
  agentSkillsDir,
  agentSoulPath,
  agentsRoot,
  kmanHome,
} from './paths.js';

describe('paths', () => {
  const originalHome = process.env['KMAN_HOME'];
  beforeEach(() => {
    delete process.env['KMAN_HOME'];
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env['KMAN_HOME'];
    else process.env['KMAN_HOME'] = originalHome;
  });

  test('kmanHome defaults to ~/.kman', () => {
    expect(kmanHome()).toBe(join(homedir(), '.kman'));
  });

  test('kmanHome honors $KMAN_HOME when set', () => {
    process.env['KMAN_HOME'] = '/tmp/kman-test';
    expect(kmanHome()).toBe('/tmp/kman-test');
  });

  test('kmanHome ignores an empty $KMAN_HOME', () => {
    process.env['KMAN_HOME'] = '';
    expect(kmanHome()).toBe(join(homedir(), '.kman'));
  });

  test('derived paths sit inside the agent directory', () => {
    process.env['KMAN_HOME'] = '/k';
    expect(agentsRoot()).toBe(join('/k', 'agents'));
    expect(agentDir('coder')).toBe(join('/k', 'agents', 'coder'));
    expect(agentProfilePath('coder')).toBe(join('/k', 'agents', 'coder', 'agent.toml'));
    expect(agentSoulPath('coder')).toBe(join('/k', 'agents', 'coder', 'soul.md'));
    expect(agentSoulPath('coder', 'custom.md')).toBe(
      join('/k', 'agents', 'coder', 'custom.md'),
    );
    expect(agentSkillsDir('coder')).toBe(join('/k', 'agents', 'coder', 'skills'));
    expect(agentLogsDir('coder')).toBe(join('/k', 'agents', 'coder', 'logs'));
  });
});
