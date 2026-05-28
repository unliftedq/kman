import { describe, expect, test } from 'bun:test';
import { UserError } from '@kman/types';
import { extractAgentOption } from './agent-option.js';

describe('extractAgentOption', () => {
  test('returns undefined agent when not present', () => {
    const r = extractAgentOption(['run', '--task', 'hi']);
    expect(r.agent).toBeUndefined();
    expect(r.rest).toEqual(['run', '--task', 'hi']);
  });

  test('parses -a <name>', () => {
    const r = extractAgentOption(['-a', 'coder', 'run']);
    expect(r.agent).toBe('coder');
    expect(r.rest).toEqual(['run']);
  });

  test('parses --agent <name>', () => {
    const r = extractAgentOption(['run', '--agent', 'coder']);
    expect(r.agent).toBe('coder');
    expect(r.rest).toEqual(['run']);
  });

  test('parses --agent=<name>', () => {
    const r = extractAgentOption(['--agent=coder', 'run']);
    expect(r.agent).toBe('coder');
    expect(r.rest).toEqual(['run']);
  });

  test('parses -a=<name>', () => {
    const r = extractAgentOption(['-a=coder', 'run']);
    expect(r.agent).toBe('coder');
    expect(r.rest).toEqual(['run']);
  });

  test('rejects a missing value after -a', () => {
    expect(() => extractAgentOption(['-a'])).toThrow(UserError);
    expect(() => extractAgentOption(['-a', '--other'])).toThrow(UserError);
  });

  test('rejects duplicate --agent occurrences', () => {
    expect(() => extractAgentOption(['-a', 'x', '--agent', 'y'])).toThrow(UserError);
    expect(() => extractAgentOption(['--agent=x', '-a=y'])).toThrow(UserError);
  });
});
