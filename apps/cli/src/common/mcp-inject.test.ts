import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentContext } from '@kman/types';
import { attachKmanMcp } from './mcp-inject.js';

describe('attachKmanMcp', () => {
  let tmpHome: string;
  let savedKmanHome: string | undefined;
  let savedSelected: string | undefined;
  let savedChain: string | undefined;
  let savedNoMcp: string | undefined;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'kman-attach-test-'));
    savedKmanHome = process.env['KMAN_HOME'];
    savedSelected = process.env['KMAN_SELECTED_AGENT'];
    savedChain = process.env['KMAN_RUN_CHAIN'];
    savedNoMcp = process.env['KMAN_NO_MCP'];
    process.env['KMAN_HOME'] = tmpHome;
    delete process.env['KMAN_NO_MCP'];
  });

  afterEach(async () => {
    restore('KMAN_HOME', savedKmanHome);
    restore('KMAN_SELECTED_AGENT', savedSelected);
    restore('KMAN_RUN_CHAIN', savedChain);
    restore('KMAN_NO_MCP', savedNoMcp);
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('overrides KMAN_SELECTED_AGENT so child kman MCP server does not see -a leakage', async () => {
    // Reproduces the production bug: the outer `kman -a coder chat` sets
    // KMAN_SELECTED_AGENT=coder, which Claude Code inherits and then
    // propagates to the kman MCP subprocess. The subprocess's `kman mcp`
    // action used to call `rejectAgent` and exit before the JSON-RPC loop,
    // surfacing in Claude Code as `-32000 Failed to reconnect`.
    process.env['KMAN_SELECTED_AGENT'] = 'coder';

    const ctx = makeCtx('coder');
    const augmented = await attachKmanMcp(ctx);

    // The merged spawn env in spawnBackend is `{...process.env, ...ctx.env}`,
    // so writing an empty string into ctx.env masks the inherited value.
    expect(augmented.env.KMAN_SELECTED_AGENT).toBe('');
    expect(augmented.env.KMAN_SELF_AGENT).toBe('coder');
  });

  it('puts the injection plugin first in extraArgs and preserves user-supplied ones', async () => {
    const ctx = makeCtx('coder', ['--my-flag', 'value']);
    const augmented = await attachKmanMcp(ctx);
    const [first, second] = augmented.extraArgs;
    expect(first).toBe('--plugin-dir');
    expect(second).toMatch(/mcp-injection$/);
    expect(augmented.extraArgs.slice(2)).toEqual(['--my-flag', 'value']);
  });

  it('initializes KMAN_RUN_CHAIN with the agent name when no chain is set', async () => {
    const augmented = await attachKmanMcp(makeCtx('coder'));
    expect(augmented.env.KMAN_RUN_CHAIN).toBe('coder');
  });

  it('appends to KMAN_RUN_CHAIN when one already exists', async () => {
    process.env['KMAN_RUN_CHAIN'] = 'planner';
    const augmented = await attachKmanMcp(makeCtx('coder'));
    expect(augmented.env.KMAN_RUN_CHAIN).toBe('planner,coder');
  });

  it('is a no-op when KMAN_NO_MCP=1', async () => {
    process.env['KMAN_NO_MCP'] = '1';
    const ctx = makeCtx('coder');
    const augmented = await attachKmanMcp(ctx);
    expect(augmented).toBe(ctx);
  });
});

function restore(key: string, prior: string | undefined): void {
  if (prior === undefined) delete process.env[key];
  else process.env[key] = prior;
}

function makeCtx(name: string, extraArgs: string[] = []): AgentContext {
  return {
    profile: {
      name,
      runtime: { default: 'claude-code' },
      soul: { prompt_file: 'soul.md' },
      defaults: {},
      runtimeOverrides: {},
    },
    agentDir: `/tmp/${name}`,
    soulPrompt: 'soul',
    backend: 'claude-code',
    permission: 'ask',
    outputFormat: 'text',
    cwd: '/tmp',
    extraArgs,
    env: {},
    stream: false,
  } as AgentContext;
}
