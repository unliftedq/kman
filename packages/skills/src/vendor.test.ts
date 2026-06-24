import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentSkillsDir } from '@kman/core';
import type { DiscoveredSkill } from './discover.js';
import { MANIFEST_FILENAME, type SkillManifest } from './manifest.js';
import type { ParsedSource } from './source-parser.js';
import { vendorSkill } from './vendor.js';

async function mkSkill(name: string): Promise<DiscoveredSkill> {
  const dir = await mkdtemp(join(tmpdir(), 'kman-skill-src-'));
  await writeFile(join(dir, 'SKILL.md'), `# ${name}\n`, 'utf8');
  return { name, dir, relPath: '.' };
}

async function readManifestFile(skillDir: string): Promise<SkillManifest> {
  return JSON.parse(await readFile(join(skillDir, MANIFEST_FILENAME), 'utf8')) as SkillManifest;
}

describe('vendorSkill manifest ref', () => {
  const originalHome = process.env['KMAN_HOME'];
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kman-vendor-'));
    process.env['KMAN_HOME'] = home;
    await mkdir(home, { recursive: true });
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env['KMAN_HOME'];
    else process.env['KMAN_HOME'] = originalHome;
    await rm(home, { recursive: true, force: true });
  });

  test('records the resolved commit hash even when the source has no ref', async () => {
    const skill = await mkSkill('humanizer');
    const source: ParsedSource = { kind: 'github', owner: 'a', repo: 'b' };
    try {
      const { installedPath } = await vendorSkill({
        agent: 'coder',
        source,
        skill,
        resolvedRef: 'deadbeefcafe',
      });
      const manifest = await readManifestFile(installedPath);
      expect(manifest.ref).toBe('deadbeefcafe');
      expect(manifest.source).toBe('a/b');
    } finally {
      await rm(skill.dir, { recursive: true, force: true });
    }
  });

  test('prefers the resolved commit hash over a branch ref from the source', async () => {
    const skill = await mkSkill('humanizer');
    const source: ParsedSource = { kind: 'github', owner: 'a', repo: 'b', ref: 'main' };
    try {
      const { installedPath } = await vendorSkill({
        agent: 'coder',
        source,
        skill,
        resolvedRef: 'abc123def456',
      });
      const manifest = await readManifestFile(installedPath);
      expect(manifest.ref).toBe('abc123def456');
    } finally {
      await rm(skill.dir, { recursive: true, force: true });
    }
  });

  test('falls back to the source ref when no resolved hash is supplied', async () => {
    const skill = await mkSkill('humanizer');
    const source: ParsedSource = { kind: 'github', owner: 'a', repo: 'b', ref: 'v1.2.3' };
    try {
      const { installedPath } = await vendorSkill({ agent: 'coder', source, skill });
      const manifest = await readManifestFile(installedPath);
      expect(manifest.ref).toBe('v1.2.3');
    } finally {
      await rm(skill.dir, { recursive: true, force: true });
    }
  });

  test('omits ref for local sources with no resolved hash', async () => {
    const skill = await mkSkill('humanizer');
    const source: ParsedSource = { kind: 'local', path: '/tmp/x' };
    try {
      const { installedPath } = await vendorSkill({ agent: 'coder', source, skill });
      const manifest = await readManifestFile(installedPath);
      expect(manifest.ref).toBeUndefined();
      expect(join(agentSkillsDir('coder'), 'humanizer')).toBe(installedPath);
    } finally {
      await rm(skill.dir, { recursive: true, force: true });
    }
  });
});
