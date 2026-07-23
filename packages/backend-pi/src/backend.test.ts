import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentContext } from '@kman/types';
import { agentDir } from '@kman/core';
import { PiBackend, createPiBackend } from './backend.js';
import { toolsForPermission } from './pi-runner.js';

function mkCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    profile: {
      name: 'coder',
      runtime: { default: 'pi' },
      soul: { prompt_file: 'soul.md' },
      defaults: {},
      runtimeOverrides: {},
    },
    agentDir: '/tmp/agents/coder',
    soulPrompt: 'You are coder.',
    backend: 'pi',
    permission: 'ask',
    outputFormat: 'text',
    cwd: '/tmp/work',
    extraArgs: [],
    env: {},
    stream: false,
    ...overrides,
  };
}

/** Reach the private buildEnv for argv/env assertions without spawning. */
function envFor(b: PiBackend, ctx: AgentContext, interactive: boolean): Promise<Record<string, string>> {
  return (
    b as unknown as {
      buildEnv: (c: AgentContext, i: boolean) => Promise<Record<string, string>>;
    }
  ).buildEnv(ctx, interactive);
}

describe('PiBackend metadata', () => {
  test('exposes the expected capability flags', () => {
    const b = new PiBackend();
    expect(b.name).toBe('pi');
    expect(b.capabilities.supportClaudeCodePlugin).toBe(false);
    expect(b.capabilities.supportsAppendSystemPrompt).toBe(true);
    expect(b.capabilities.supportsNativeResume).toBe(true);
  });

  test('mapPermission passes abstract levels through to pi', () => {
    const b = new PiBackend();
    expect(b.mapPermission('ask')).toBe('ask');
    expect(b.mapPermission('auto')).toBe('auto');
    expect(b.mapPermission('yolo')).toBe('yolo');
  });

  test('mapPermission falls back to ask for unknown levels', () => {
    const b = new PiBackend();
    expect(b.mapPermission('garbage' as unknown as 'ask')).toBe('ask');
  });

  test('createPiBackend factory returns a backend instance', () => {
    const b = createPiBackend('node');
    expect(b.name).toBe('pi');
  });
});

describe('PiBackend env serialization', () => {
  const originalHome = process.env['KMAN_HOME'];
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kman-pi-be-'));
    process.env['KMAN_HOME'] = home;
    const dir = agentDir('coder');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'soul.md'), 'You are coder.\n', 'utf8');
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env['KMAN_HOME'];
    else process.env['KMAN_HOME'] = originalHome;
    await rm(home, { recursive: true, force: true });
  });

  test('serializes core context fields into KMAN_PI_* env vars', async () => {
    const b = new PiBackend();
    const env = await envFor(b, mkCtx({ soulPrompt: 'You are coder.' }), false);
    expect(env['KMAN_PI_SOUL']).toBe('You are coder.');
    expect(env['KMAN_PI_PERMISSION']).toBe('ask');
    expect(env['KMAN_PI_CWD']).toBe('/tmp/work');
    expect(env['KMAN_PI_INTERACTIVE']).toBe('0');
    // AGENT_DIR points at the materialized .pi resource dir.
    expect(env['KMAN_PI_AGENT_DIR']).toMatch(/\.pi$/);
  });

  test('interactive chat flips KMAN_PI_INTERACTIVE', async () => {
    const b = new PiBackend();
    const env = await envFor(b, mkCtx(), true);
    expect(env['KMAN_PI_INTERACTIVE']).toBe('1');
  });

  test('permissionModeRaw overrides the abstract mapping', async () => {
    const b = new PiBackend();
    const env = await envFor(b, mkCtx({ permission: 'auto', permissionModeRaw: 'custom' }), false);
    expect(env['KMAN_PI_PERMISSION']).toBe('custom');
  });

  test('optional fields only appear when set', async () => {
    const b = new PiBackend();
    const bare = await envFor(b, mkCtx(), false);
    expect(bare['KMAN_PI_MODEL']).toBeUndefined();
    expect(bare['KMAN_PI_TASK']).toBeUndefined();

    const full = await envFor(
      b,
      mkCtx({ model: 'gpt-5', task: 'do it' }),
      false,
    );
    expect(full['KMAN_PI_MODEL']).toBe('gpt-5');
    expect(full['KMAN_PI_TASK']).toBe('do it');
  });

  test('inherited ctx.env is preserved alongside KMAN_PI_* vars', async () => {
    const b = new PiBackend();
    const env = await envFor(b, mkCtx({ env: { KMAN_TASK_ID: 't_1' } }), false);
    expect(env['KMAN_TASK_ID']).toBe('t_1');
    expect(env['KMAN_PI_SOUL']).toBe('You are coder.');
  });
});

describe('toolsForPermission', () => {
  test('yolo grants the full mutating coding tool set', () => {
    expect(toolsForPermission('yolo')).toEqual([
      'read',
      'write',
      'edit',
      'bash',
      'grep',
      'find',
      'ls',
    ]);
  });

  test('ask and auto are read-only — no write/edit/bash', () => {
    for (const level of ['ask', 'auto']) {
      const tools = toolsForPermission(level);
      expect(tools).toEqual(['read', 'grep', 'find', 'ls']);
      expect(tools).not.toContain('write');
      expect(tools).not.toContain('edit');
      expect(tools).not.toContain('bash');
    }
  });

  test('unknown permission strings fall back to read-only', () => {
    expect(toolsForPermission('garbage')).toEqual(['read', 'grep', 'find', 'ls']);
  });
});
