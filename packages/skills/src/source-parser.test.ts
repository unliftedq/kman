import { describe, expect, test } from 'bun:test';
import { isAbsolute, resolve } from 'node:path';
import { UserError } from '@kman/types';
import { parseSource, sanitizeSubpath } from './source-parser.js';

describe('parseSource — github', () => {
  test('parses owner/repo shorthand', () => {
    const r = parseSource('vercel-labs/skills');
    expect(r.kind).toBe('github');
    if (r.kind === 'github') {
      expect(r.owner).toBe('vercel-labs');
      expect(r.repo).toBe('skills');
      expect(r.subpath).toBeUndefined();
      expect(r.ref).toBeUndefined();
    }
  });

  test('parses owner/repo/path@ref shorthand', () => {
    const r = parseSource('vercel-labs/skills/javascript@v1.2.3');
    expect(r.kind).toBe('github');
    if (r.kind === 'github') {
      expect(r.subpath).toBe('javascript');
      expect(r.ref).toBe('v1.2.3');
    }
  });

  test('parses a github.com URL with /tree/<ref>/<subpath>', () => {
    const r = parseSource('https://github.com/owner/repo/tree/main/skills/x');
    expect(r.kind).toBe('github');
    if (r.kind === 'github') {
      expect(r.owner).toBe('owner');
      expect(r.repo).toBe('repo');
      expect(r.ref).toBe('main');
      expect(r.subpath).toBe('skills/x');
    }
  });

  test('refOverride wins over the ref baked into the URL', () => {
    const r = parseSource('https://github.com/owner/repo/tree/main', 'feature');
    if (r.kind === 'github') expect(r.ref).toBe('feature');
  });
});

describe('parseSource — gitlab', () => {
  test('parses gitlab URL with /-/tree/<ref>/<subpath>', () => {
    const r = parseSource('https://gitlab.com/owner/repo/-/tree/main/skills/y');
    expect(r.kind).toBe('gitlab');
    if (r.kind === 'gitlab') {
      expect(r.ref).toBe('main');
      expect(r.subpath).toBe('skills/y');
    }
  });
});

describe('parseSource — generic git', () => {
  test('parses git+https URL and strips the git+ prefix', () => {
    const r = parseSource('git+https://example.com/x.git');
    expect(r.kind).toBe('git');
    if (r.kind === 'git') expect(r.url).toBe('https://example.com/x.git');
  });

  test('parses ssh URL', () => {
    const r = parseSource('git@example.com:owner/repo.git');
    expect(r.kind).toBe('git');
  });
});

describe('parseSource — local paths', () => {
  test('parses ./relative as a local source', () => {
    const r = parseSource('./local/skill');
    expect(r.kind).toBe('local');
    if (r.kind === 'local') {
      expect(isAbsolute(r.path)).toBe(true);
      expect(r.path).toBe(resolve('./local/skill'));
    }
  });

  test('parses an absolute POSIX path as local', () => {
    const r = parseSource('/tmp/skill');
    expect(r.kind).toBe('local');
  });

  test('parses a Windows-style drive path as local', () => {
    const r = parseSource('C:\\projects\\skill');
    expect(r.kind).toBe('local');
  });
});

describe('parseSource — well-known', () => {
  test('accepts the anthropic-skills shortcut', () => {
    const r = parseSource('anthropic-skills');
    expect(r.kind).toBe('well-known');
  });
});

describe('parseSource — errors', () => {
  test('rejects empty input', () => {
    expect(() => parseSource('   ')).toThrow(UserError);
  });

  test('rejects unrecognized single-token input', () => {
    expect(() => parseSource('not-a-known-thing')).toThrow(UserError);
  });
});

describe('sanitizeSubpath', () => {
  test('strips leading/trailing slashes and converts backslashes', () => {
    expect(sanitizeSubpath('/a\\b/c/')).toBe('a/b/c');
  });

  test('rejects parent traversal', () => {
    expect(() => sanitizeSubpath('a/../b')).toThrow(UserError);
  });

  test('rejects dot segments', () => {
    expect(() => sanitizeSubpath('a/./b')).toThrow(UserError);
  });

  test('rejects an empty result', () => {
    expect(() => sanitizeSubpath('/')).toThrow(UserError);
  });
});
