import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractDescription, readSkillDescription, truncate } from './frontmatter.js';

describe('extractDescription', () => {
  test('reads a plain description value', () => {
    expect(extractDescription('---\nname: x\ndescription: Hello world\n---\n# x\n')).toBe('Hello world');
  });

  test('strips surrounding double quotes', () => {
    expect(extractDescription('---\ndescription: "Quoted value"\n---\n')).toBe('Quoted value');
  });

  test('strips surrounding single quotes', () => {
    expect(extractDescription("---\ndescription: 'Quoted value'\n---\n")).toBe('Quoted value');
  });

  test('returns undefined without frontmatter', () => {
    expect(extractDescription('# Just a heading\n')).toBeUndefined();
  });

  test('returns undefined when description key is absent', () => {
    expect(extractDescription('---\nname: x\n---\n')).toBeUndefined();
  });

  test('returns undefined for an empty description', () => {
    expect(extractDescription('---\ndescription: \n---\n')).toBeUndefined();
  });

  test('reads block scalar descriptions', () => {
    expect(extractDescription('---\ndescription: |\n  multi-line\n  text\n---\n')).toBe('multi-line text');
    expect(extractDescription('---\ndescription: >-\n  folded\n  value\n---\n')).toBe('folded value');
  });

  test('tolerates CRLF line endings', () => {
    expect(extractDescription('---\r\ndescription: Hello world\r\n---\r\n')).toBe('Hello world');
    expect(extractDescription('---\r\ndescription: |\r\n  multi-line\r\n  text\r\n---\r\n')).toBe(
      'multi-line text',
    );
  });

  test('tolerates a leading BOM', () => {
    expect(extractDescription('\uFEFF---\ndescription: BOM ok\n---\n')).toBe('BOM ok');
  });
});

describe('truncate', () => {
  test('leaves short text unchanged', () => {
    expect(truncate('short', 80)).toBe('short');
  });

  test('appends an ellipsis when over the limit', () => {
    const out = truncate('abcdefghij', 5);
    expect(out).toBe('abcd…');
    expect(out.length).toBe(5);
  });

  test('collapses internal whitespace', () => {
    expect(truncate('a   b\n c', 80)).toBe('a b c');
  });
});

describe('readSkillDescription', () => {
  test('reads description from SKILL.md', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kman-fm-'));
    try {
      await writeFile(join(dir, 'SKILL.md'), '---\ndescription: From file\n---\n# body\n', 'utf8');
      expect(await readSkillDescription(dir)).toBe('From file');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns undefined when SKILL.md is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kman-fm-'));
    try {
      expect(await readSkillDescription(dir)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rethrows non-ENOENT read errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kman-fm-'));
    try {
      await mkdir(join(dir, 'SKILL.md'));
      await expect(readSkillDescription(dir)).rejects.toHaveProperty('code', 'EISDIR');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
