import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentContext } from '@kman/types';
import { attachKmanMcp } from './mcp-inject.js';

describe('attachKmanMcp', () => {
  let tmpHome: string;
  let savedKmanHome: string | undefined;
  let savedHome: string | undefined;
  let savedUserprofile: string | undefined;
  let savedSelected: string | undefined;
  let savedChain: string | undefined;
  let savedNoMcp: string | undefined;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'kman-attach-test-'));
    savedKmanHome = process.env['KMAN_HOME'];
    savedHome = process.env['HOME'];
    savedUserprofile = process.env['USERPROFILE'];
    savedSelected = process.env['KMAN_SELECTED_AGENT'];
    savedChain = process.env['KMAN_RUN_CHAIN'];
    savedNoMcp = process.env['KMAN_NO_MCP'];
    process.env['KMAN_HOME'] = tmpHome;
    // Redirect homedir() so isKmanInstalledIn() reads our scratch config,
    // not the real ~/.claude.json on the developer's machine.
    process.env['HOME'] = tmpHome;
    process.env['USERPROFILE'] = tmpHome;
    delete process.env['KMAN_NO_MCP'];
  });

  afterEach(async () => {
    restore('KMAN_HOME', savedKmanHome);
    restore('HOME', savedHome);
    restore('USERPROFILE', savedUserprofile);
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

  it('uses --mcp-config for claude-code and puts it before user extra args', async () => {
    const ctx = makeCtx('coder', ['--my-flag', 'value'], 'claude-code');
    const augmented = await attachKmanMcp(ctx);
    const [first, second] = augmented.extraArgs;
    expect(first).toBe('--mcp-config');
    expect(second).toMatch(/mcp-config\.json$/);
    expect(augmented.extraArgs.slice(2)).toEqual(['--my-flag', 'value']);
  });

  it('uses --additional-mcp-config for copilot-cli', async () => {
    const ctx = makeCtx('coder', [], 'copilot-cli');
    const augmented = await attachKmanMcp(ctx);
    expect(augmented.extraArgs[0]).toBe('--additional-mcp-config');
    expect(augmented.extraArgs[1]).toMatch(/mcp-config\.json$/);
  });

  it('skips injection for unknown backends rather than breaking the launch', async () => {
    const ctx = makeCtx('coder', ['--keep'], 'fictional-backend');
    const augmented = await attachKmanMcp(ctx);
    expect(augmented).toBe(ctx);
  });

  it('skips --mcp-config when `kman` is already installed in ~/.claude.json — but still sets env', async () => {
    // Reproduces the install-vs-inject collision: if both paths register
    // `kman`, hosts merge them with undefined precedence. We let the
    // explicit install win and skip the auto-inject flag, but still set
    // KMAN_SELF_AGENT so the globally-installed entry's placeholder
    // resolves correctly at spawn time.
    await writeFile(
      join(tmpHome, '.claude.json'),
      JSON.stringify({ mcpServers: { kman: { command: 'kman', args: ['mcp'] } } }, null, 2),
      'utf8',
    );

    const ctx = makeCtx('coder', ['--user-flag'], 'claude-code');
    const augmented = await attachKmanMcp(ctx);

    expect(augmented.extraArgs).toEqual(['--user-flag']);
    expect(augmented.env.KMAN_SELF_AGENT).toBe('coder');
    expect(augmented.env.KMAN_RUN_CHAIN).toBe('coder');
    expect(augmented.env.KMAN_SELECTED_AGENT).toBe('');
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

function makeCtx(name: string, extraArgs: string[] = [], backend = 'claude-code'): AgentContext {
  return {
    profile: {
      name,
      runtime: { default: backend },
      soul: { prompt_file: 'soul.md' },
      defaults: {},
      runtimeOverrides: {},
    },
    agentDir: `/tmp/${name}`,
    soulPrompt: 'soul',
    backend,
    permission: 'ask',
    outputFormat: 'text',
    cwd: '/tmp',
    extraArgs,
    env: {},
    stream: false,
  } as AgentContext;
}
