import { describe, expect, test } from 'vitest';
import type { AgentContext } from '@kman/types';
import { renderSoul } from './index.js';

function mkCtx(soul: string): AgentContext {
  return {
    profile: {
      name: 'coder',
      runtime: { default: 'claude-code' },
      soul: { prompt_file: 'soul.md' },
      defaults: {},
      runtimeOverrides: {},
    },
    agentDir: '/tmp/agent',
    soulPrompt: soul,
    backend: 'claude-code',
    permission: 'ask',
    outputFormat: 'text',
    cwd: '/tmp/cwd',
    extraArgs: [],
    env: {},
    stream: false,
  };
}

describe('renderSoul', () => {
  test('returns the soul prompt verbatim', () => {
    const ctx = mkCtx('You are a careful coder.');
    expect(renderSoul(ctx)).toBe('You are a careful coder.');
  });

  test('handles empty soul without throwing', () => {
    expect(renderSoul(mkCtx(''))).toBe('');
  });
});
