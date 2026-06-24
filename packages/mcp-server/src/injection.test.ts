import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureInjectionConfig, kmanMcpConfigPath } from './injection.js';

describe('ensureInjectionConfig', () => {
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

  it('materializes a single .mcp.json file at the runtime path', async () => {
    const path = await ensureInjectionConfig({ kmanCommand: 'kman', kmanBaseArgs: [] });
    expect(path).toBe(kmanMcpConfigPath());

    const mcp = JSON.parse(await readFile(path, 'utf8'));
    expect(mcp.mcpServers.kman.command).toBe('kman');
    expect(mcp.mcpServers.kman.args).toEqual(['mcp', '--self-from-env']);
    // env block enumerates the keys the server needs at spawn time. Host
    // performs ${VAR} substitution against its own env when handing this
    // to the MCP subprocess.
    expect(mcp.mcpServers.kman.env.KMAN_SELF_AGENT).toBe('${KMAN_SELF_AGENT}');
    expect(mcp.mcpServers.kman.env.KMAN_TASK_ID).toBe('${KMAN_TASK_ID}');
  });

  it('passes through extra base args (dev-mode bun + script path)', async () => {
    const path = await ensureInjectionConfig({
      kmanCommand: '/usr/bin/bun',
      kmanBaseArgs: ['/repo/apps/cli/src/main.ts'],
    });
    const mcp = JSON.parse(await readFile(path, 'utf8'));
    expect(mcp.mcpServers.kman.command).toBe('/usr/bin/bun');
    expect(mcp.mcpServers.kman.args).toEqual(['/repo/apps/cli/src/main.ts', 'mcp', '--self-from-env']);
  });

  it('is idempotent — repeated calls with the same opts do not rewrite the file', async () => {
    await ensureInjectionConfig({ kmanCommand: 'kman' });
    const path = kmanMcpConfigPath();
    const before = await stat(path);
    await new Promise((r) => setTimeout(r, 5));
    await ensureInjectionConfig({ kmanCommand: 'kman' });
    const after = await stat(path);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
});
