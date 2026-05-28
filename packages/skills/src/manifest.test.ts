import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { formatSourceString, manifestPath, sourceUrl } from './manifest.js';

describe('manifestPath', () => {
  test('returns <dir>/.kman-skill.json under the given directory', () => {
    const dir = join('tmp', 'skills', 'x');
    expect(manifestPath(dir)).toBe(join(dir, '.kman-skill.json'));
  });
});

describe('formatSourceString', () => {
  test('local → path', () => {
    expect(formatSourceString({ kind: 'local', path: '/tmp/x' })).toBe('/tmp/x');
  });

  test('github owner/repo or with subpath', () => {
    expect(formatSourceString({ kind: 'github', owner: 'a', repo: 'b' })).toBe('a/b');
    expect(
      formatSourceString({ kind: 'github', owner: 'a', repo: 'b', subpath: 'sub' }),
    ).toBe('a/b/sub');
  });

  test('gitlab is prefixed and respects subpath', () => {
    expect(formatSourceString({ kind: 'gitlab', owner: 'a', repo: 'b' })).toBe('gitlab:a/b');
    expect(
      formatSourceString({ kind: 'gitlab', owner: 'a', repo: 'b', subpath: 'sub' }),
    ).toBe('gitlab:a/b/sub');
  });

  test('generic git returns the raw URL', () => {
    expect(formatSourceString({ kind: 'git', url: 'https://x.git' })).toBe('https://x.git');
  });

  test('well-known returns the name', () => {
    expect(formatSourceString({ kind: 'well-known', name: 'anthropic-skills' })).toBe(
      'anthropic-skills',
    );
  });
});

describe('sourceUrl', () => {
  test('github → https URL', () => {
    expect(sourceUrl({ kind: 'github', owner: 'a', repo: 'b' })).toBe('https://github.com/a/b');
  });

  test('gitlab → https URL', () => {
    expect(sourceUrl({ kind: 'gitlab', owner: 'a', repo: 'b' })).toBe('https://gitlab.com/a/b');
  });

  test('git returns the underlying URL', () => {
    expect(sourceUrl({ kind: 'git', url: 'git@x:y.git' })).toBe('git@x:y.git');
  });

  test('local and well-known have no remote URL', () => {
    expect(sourceUrl({ kind: 'local', path: '/x' })).toBeUndefined();
    expect(sourceUrl({ kind: 'well-known', name: 'anthropic-skills' })).toBeUndefined();
  });
});
