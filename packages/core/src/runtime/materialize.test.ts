import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Profile } from '@kman/types';
import { agentDir } from '../paths.js';
import { materializeRuntimePlugin, pluginLayoutForBackend } from './materialize.js';
import { runtimePluginDir } from './paths.js';

function mkProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    name: 'coder',
    runtime: { default: 'claude-code' },
    soul: { prompt_file: 'soul.md' },
    defaults: {},
    runtimeOverrides: {},
    ...overrides,
  };
}

describe('pluginLayoutForBackend', () => {
  test('maps known backends', () => {
    expect(pluginLayoutForBackend('claude-code')).toBe('claude');
    expect(pluginLayoutForBackend('copilot-cli')).toBe('copilot');
  });

  test('returns undefined for unknown backends', () => {
    expect(pluginLayoutForBackend('codex' as 'claude-code')).toBeUndefined();
  });
});

describe('materializeRuntimePlugin', () => {
  const originalHome = process.env['KMAN_HOME'];
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kman-rt-'));
    process.env['KMAN_HOME'] = home;
    // Seed an agent directory with real data and NO plugin scaffolding.
    const dir = agentDir('coder');
    await mkdir(join(dir, 'skills', 'humanizer'), { recursive: true });
    await writeFile(join(dir, 'skills', 'humanizer', 'SKILL.md'), '# skill\n', 'utf8');
    await mkdir(join(dir, 'hooks'), { recursive: true });
    await writeFile(join(dir, 'hooks', 'hooks.json'), '{}\n', 'utf8');
    await writeFile(join(dir, '.mcp.json'), '{"mcpServers":{}}\n', 'utf8');
    await writeFile(join(dir, 'soul.md'), '---\nname: coder\n---\n\nYou are coder.\n', 'utf8');
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env['KMAN_HOME'];
    else process.env['KMAN_HOME'] = originalHome;
    await rm(home, { recursive: true, force: true });
  });

  test('claude layout writes .claude-plugin/plugin.json with name "kman"', async () => {
    const { pluginDir, pluginAgent } = await materializeRuntimePlugin(mkProfile(), 'claude');
    expect(pluginDir).toBe(runtimePluginDir('coder', 'claude'));
    expect(pluginAgent).toBe('kman:coder');

    const manifest = JSON.parse(
      await readFile(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    expect(manifest.name).toBe('kman');
    expect(manifest.agents).toEqual(['./agents/coder.md']);
  });

  test('copilot layout writes plugin.json at the root with name "kman"', async () => {
    const { pluginDir } = await materializeRuntimePlugin(mkProfile(), 'copilot');
    const manifest = JSON.parse(await readFile(join(pluginDir, 'plugin.json'), 'utf8'));
    expect(manifest.name).toBe('kman');
    expect(manifest.agents).toBe('agents/');
  });

  test('exposes the soul as agents/<name>.md', async () => {
    const { pluginDir } = await materializeRuntimePlugin(mkProfile(), 'claude');
    const soul = await readFile(join(pluginDir, 'agents', 'coder.md'), 'utf8');
    expect(soul).toContain('name: coder');
    expect(soul).toContain('You are coder.');
  });

  test('maps component dirs and .mcp.json from the agent dir', async () => {
    const { pluginDir } = await materializeRuntimePlugin(mkProfile(), 'claude');
    expect(await readFile(join(pluginDir, 'skills', 'humanizer', 'SKILL.md'), 'utf8')).toContain(
      '# skill',
    );
    expect(await readFile(join(pluginDir, 'hooks', 'hooks.json'), 'utf8')).toBe('{}\n');
    expect(await readFile(join(pluginDir, '.mcp.json'), 'utf8')).toContain('mcpServers');
  });

  test('links resolve back to the agent dir so edits stay in sync', async () => {
    const { pluginDir } = await materializeRuntimePlugin(mkProfile(), 'claude');
    const link = await lstat(join(pluginDir, 'skills'));
    if (link.isSymbolicLink()) {
      expect(await readlink(join(pluginDir, 'skills'))).toBe(join(agentDir('coder'), 'skills'));
    }
    // Whether linked or copied, the data must be present.
    expect(await readFile(join(pluginDir, 'skills', 'humanizer', 'SKILL.md'), 'utf8')).toContain(
      '# skill',
    );
  });

  test('rebuilds from scratch, dropping stale components', async () => {
    await materializeRuntimePlugin(mkProfile(), 'claude');
    // Remove the skill from the agent dir, then rematerialize.
    await rm(join(agentDir('coder'), 'skills'), { recursive: true, force: true });
    const { pluginDir } = await materializeRuntimePlugin(mkProfile(), 'claude');
    let present = true;
    try {
      await lstat(join(pluginDir, 'skills'));
    } catch {
      present = false;
    }
    expect(present).toBe(false);
  });

  test('omits description when the profile has none, includes it otherwise', async () => {
    const noDesc = await materializeRuntimePlugin(mkProfile(), 'claude');
    const m1 = JSON.parse(
      await readFile(join(noDesc.pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    expect(m1.description).toBeUndefined();

    const withDesc = await materializeRuntimePlugin(
      mkProfile({ description: 'C# review' }),
      'claude',
    );
    const m2 = JSON.parse(
      await readFile(join(withDesc.pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    expect(m2.description).toBe('C# review');
  });

  test('concurrent materializations never expose a partially built plugin', async () => {
    const layout = 'claude' as const;
    const target = runtimePluginDir('coder', layout);
    let observedPartial = false;

    // While many materializations run in parallel, repeatedly check that the
    // manifest, when present, is always complete and valid.
    const watcher = (async () => {
      for (let i = 0; i < 200; i++) {
        try {
          const raw = await readFile(join(target, '.claude-plugin', 'plugin.json'), 'utf8');
          const manifest = JSON.parse(raw);
          if (manifest.name !== 'kman') observedPartial = true;
        } catch (err) {
          // ENOENT during the swap window is expected; malformed JSON is not.
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') observedPartial = true;
        }
      }
    })();

    await Promise.all([
      ...Array.from({ length: 16 }, () => materializeRuntimePlugin(mkProfile(), layout)),
      watcher,
    ]);

    expect(observedPartial).toBe(false);
    // The final state is a single complete plugin with no leftover temp dirs.
    const m = JSON.parse(await readFile(join(target, '.claude-plugin', 'plugin.json'), 'utf8'));
    expect(m.name).toBe('kman');
    const leftovers = (await readdir(join(home, 'runtime', 'coder'))).filter(
      (e) => e.includes('.staging-') || e.includes('.trash-'),
    );
    expect(leftovers).toEqual([]);
  });
});
