import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultProfile } from '../profile/schema.js';
import { buildContext } from './build.js';

const originalHome = process.env['KMAN_HOME'];
let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'kman-buildctx-'));
  process.env['KMAN_HOME'] = tmp;
  await mkdir(join(tmp, 'agents', 'coder'), { recursive: true });
  await writeFile(join(tmp, 'agents', 'coder', 'soul.md'), 'soul body\n', 'utf8');
});

afterAll(async () => {
  if (originalHome === undefined) delete process.env['KMAN_HOME'];
  else process.env['KMAN_HOME'] = originalHome;
  await rm(tmp, { recursive: true, force: true });
});

describe('buildContext', () => {
  test('reads the soul file and applies profile defaults', async () => {
    const profile = defaultProfile('coder');
    const ctx = await buildContext(profile);
    expect(ctx.soulPrompt).toBe('soul body\n');
    expect(ctx.backend).toBe('pi');
    expect(ctx.permission).toBe('ask');
    expect(ctx.outputFormat).toBe('text');
    expect(ctx.stream).toBe(false);
    expect(ctx.extraArgs).toEqual([]);
    expect(ctx.agentDir.endsWith(join('agents', 'coder'))).toBe(true);
  });

  test('falls back to an empty soul when the file is missing', async () => {
    const profile = defaultProfile('missing-agent');
    const ctx = await buildContext(profile);
    expect(ctx.soulPrompt).toBe('');
  });

  test('CLI overrides win over profile defaults', async () => {
    const profile = defaultProfile('coder');
    const ctx = await buildContext(profile, {
      backend: 'copilot-cli',
      model: 'gpt-5',
      permission: 'auto',
      outputFormat: 'json',
      runtimeFlags: ['--debug'],
      cwd: '/tmp/work',
      task: 'do the thing',
    });
    expect(ctx.backend).toBe('copilot-cli');
    expect(ctx.model).toBe('gpt-5');
    expect(ctx.permission).toBe('auto');
    expect(ctx.outputFormat).toBe('json');
    expect(ctx.extraArgs).toEqual(['--debug']);
    expect(ctx.cwd).toBe('/tmp/work');
    expect(ctx.task).toBe('do the thing');
  });

  test('stream:true implies stream-json output format', async () => {
    const profile = defaultProfile('coder');
    const ctx = await buildContext(profile, { stream: true });
    expect(ctx.stream).toBe(true);
    expect(ctx.outputFormat).toBe('stream-json');
  });

  test('backend overrides supply extra_args and permission_mode_raw', async () => {
    const profile = defaultProfile('coder', {
      runtimeOverrides: {
        'claude-code': {
          extra_args: ['--from-profile'],
          permission_mode_raw: 'plan',
          model: 'sonnet',
        },
      },
    });
    const ctx = await buildContext(profile, { runtimeFlags: ['--from-cli'] });
    expect(ctx.extraArgs).toEqual(['--from-profile', '--from-cli']);
    expect(ctx.permissionModeRaw).toBe('plan');
    expect(ctx.model).toBe('sonnet');
  });

  test('explicit model override beats the backend override model', async () => {
    const profile = defaultProfile('coder', {
      runtimeOverrides: { 'claude-code': { model: 'sonnet' } },
    });
    const ctx = await buildContext(profile, { model: 'opus' });
    expect(ctx.model).toBe('opus');
  });
});
