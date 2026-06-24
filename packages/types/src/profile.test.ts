import { describe, expect, test } from 'vitest';
import { AGENT_NAME_PATTERN } from './profile.js';

describe('AGENT_NAME_PATTERN', () => {
  test('accepts lowercase kebab-case names', () => {
    expect(AGENT_NAME_PATTERN.test('coder')).toBe(true);
    expect(AGENT_NAME_PATTERN.test('release-bot')).toBe(true);
    expect(AGENT_NAME_PATTERN.test('agent-42')).toBe(true);
    expect(AGENT_NAME_PATTERN.test('a')).toBe(true);
  });

  test('rejects uppercase, leading digits/dashes, and forbidden characters', () => {
    expect(AGENT_NAME_PATTERN.test('Coder')).toBe(false);
    expect(AGENT_NAME_PATTERN.test('1bot')).toBe(false);
    expect(AGENT_NAME_PATTERN.test('-bot')).toBe(false);
    expect(AGENT_NAME_PATTERN.test('release_bot')).toBe(false);
    expect(AGENT_NAME_PATTERN.test('release bot')).toBe(false);
    expect(AGENT_NAME_PATTERN.test('')).toBe(false);
  });

  test('caps length at 63 characters', () => {
    const sixtyThree = 'a' + 'b'.repeat(62);
    const sixtyFour = 'a' + 'b'.repeat(63);
    expect(sixtyThree.length).toBe(63);
    expect(AGENT_NAME_PATTERN.test(sixtyThree)).toBe(true);
    expect(AGENT_NAME_PATTERN.test(sixtyFour)).toBe(false);
  });
});
