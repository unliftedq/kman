import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentSkillsDir } from '@kman/core';
import * as fetchModule from './fetch.js';
import { writeManifest } from './manifest.js';
import { updateSkills } from './update.js';

/** Build a local source directory containing the given skill names. */
async function makeSource(skills: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kman-update-src-'));
  for (const name of skills) {
    const dir = join(root, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), `# ${name}\n`, 'utf8');
  }
  return root;
}

/** Install a skill into the agent's skills dir with a manifest pointing at source. */
async function installSkill(agent: string, sourceRoot: string, name: string): Promise<void> {
  const dest = join(agentSkillsDir(agent), name);
  await cp(join(sourceRoot, name), dest, { recursive: true });
  await writeManifest(dest, { source: sourceRoot, installed_at: new Date().toISOString() });
}

describe('updateSkills batching', () => {
  const originalHome = process.env['KMAN_HOME'];
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kman-update-home-'));
    process.env['KMAN_HOME'] = home;
    await mkdir(home, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalHome === undefined) delete process.env['KMAN_HOME'];
    else process.env['KMAN_HOME'] = originalHome;
    await rm(home, { recursive: true, force: true });
  });

  test('materializes a shared source only once for multiple skills', async () => {
    const source = await makeSource(['alpha', 'beta', 'gamma']);
    try {
      await installSkill('coder', source, 'alpha');
      await installSkill('coder', source, 'beta');
      await installSkill('coder', source, 'gamma');

      const spy = vi.spyOn(fetchModule, 'materialize');
      const results = await updateSkills({
        agent: 'coder',
        skills: ['alpha', 'beta', 'gamma'],
        force: true,
      });

      // One materialize call for the single shared source, not one per skill.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(results.map((r) => r.skill)).toEqual(['alpha', 'beta', 'gamma']);
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  test('materializes once per distinct source', async () => {
    const sourceA = await makeSource(['alpha', 'beta']);
    const sourceB = await makeSource(['delta']);
    try {
      await installSkill('coder', sourceA, 'alpha');
      await installSkill('coder', sourceA, 'beta');
      await installSkill('coder', sourceB, 'delta');

      const spy = vi.spyOn(fetchModule, 'materialize');
      const results = await updateSkills({
        agent: 'coder',
        skills: ['alpha', 'beta', 'delta'],
        force: true,
      });

      // Two distinct sources → two materialize calls.
      expect(spy).toHaveBeenCalledTimes(2);
      expect(results.map((r) => r.skill)).toEqual(['alpha', 'beta', 'delta']);
    } finally {
      await rm(sourceA, { recursive: true, force: true });
      await rm(sourceB, { recursive: true, force: true });
    }
  });
});
