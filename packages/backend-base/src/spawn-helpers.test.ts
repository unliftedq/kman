import { describe, expect, test } from 'bun:test';
import type { AgentContext } from '@kman/types';
import { spawnBackend } from './spawn-helpers.js';

function mkCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    profile: {
      name: 'coder',
      runtime: { default: 'claude-code' },
      soul: { prompt_file: 'soul.md' },
      defaults: {},
      runtimeOverrides: {},
    },
    agentDir: process.cwd(),
    soulPrompt: '',
    backend: 'claude-code',
    permission: 'ask',
    outputFormat: 'text',
    cwd: process.cwd(),
    extraArgs: [],
    env: {},
    stream: false,
    ...overrides,
  };
}

describe('spawnBackend', () => {
  test('spawns the requested binary with stdio piped when overridden', async () => {
    // Pipe stdio so we can capture exit cleanly rather than inherit the test runner's stdio.
    const ctx = mkCtx({ env: { KMAN_TEST_VAR: 'present' } });
    const child = spawnBackend(ctx, {
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      options: { stdio: 'ignore' },
    });
    expect(child.pid).toBeGreaterThan(0);
    const code = await new Promise<number | null>((resolve) => {
      child.on('exit', (c) => resolve(c));
    });
    expect(code).toBe(0);
  });

  test('returns a ChildProcess even when the command is missing (error emitted async)', async () => {
    const child = spawnBackend(mkCtx(), {
      command: 'definitely-not-a-real-binary-kman-test',
      args: [],
      options: { stdio: 'ignore' },
    });
    const err = await new Promise<NodeJS.ErrnoException>((resolve) => {
      child.on('error', (e) => resolve(e as NodeJS.ErrnoException));
    });
    expect(err.code).toBe('ENOENT');
  });
});
