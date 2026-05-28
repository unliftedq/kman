import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureInjectionPlugin, kmanMcpPluginDir } from './injection.js';

describe('ensureInjectionPlugin', () => {
  let originalHome: string | undefined;
  let tmpHome: string;

  beforeEach(async () => {
    originalHome = process.env['KMAN_HOME'];
    tmpHome = await mkdtemp(join(tmpdir(), 'kman-inject-test-'));
    process.env['KMAN_HOME'] = tmpHome;
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env['KMAN_HOME'];
    else process.env['KMAN_HOME'] = originalHome;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('materializes a plugin directory with .mcp.json + manifests', async () => {
    const dir = await ensureInjectionPlugin({ kmanCommand: 'kman', kmanBaseArgs: [] });
    expect(dir).toBe(kmanMcpPluginDir());

    const mcp = JSON.parse(await readFile(join(dir, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.kman.command).toBe('kman');
    expect(mcp.mcpServers.kman.args).toEqual(['mcp', '--self-from-env']);
    // env block enumerates every key the server needs — most MCP hosts
    // don't inherit arbitrary parent env, so unlisted keys never arrive.
    expect(mcp.mcpServers.kman.env.KMAN_SELF_AGENT).toBe('${KMAN_SELF_AGENT}');
    expect(mcp.mcpServers.kman.env.KMAN_RUN_CHAIN).toBe('${KMAN_RUN_CHAIN}');

    const plugin = JSON.parse(await readFile(join(dir, 'plugin.json'), 'utf8'));
    expect(plugin.name).toBe('kman-mcp');

    const claudePlugin = JSON.parse(await readFile(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'));
    expect(claudePlugin.name).toBe('kman-mcp');
  });

  it('passes through extra base args (dev-mode bun + script path)', async () => {
    const dir = await ensureInjectionPlugin({
      kmanCommand: '/usr/bin/bun',
      kmanBaseArgs: ['/repo/apps/cli/src/main.ts'],
    });
    const mcp = JSON.parse(await readFile(join(dir, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.kman.command).toBe('/usr/bin/bun');
    expect(mcp.mcpServers.kman.args).toEqual(['/repo/apps/cli/src/main.ts', 'mcp', '--self-from-env']);
  });

  it('is idempotent — repeated calls do not rewrite identical files', async () => {
    await ensureInjectionPlugin({ kmanCommand: 'kman' });
    const path = join(kmanMcpPluginDir(), '.mcp.json');
    const before = (await import('node:fs/promises')).stat(path);
    const beforeStat = await before;
    await new Promise((r) => setTimeout(r, 5));
    await ensureInjectionPlugin({ kmanCommand: 'kman' });
    const afterStat = await (await import('node:fs/promises')).stat(path);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
  });
});
