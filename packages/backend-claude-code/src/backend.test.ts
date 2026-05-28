import { describe, expect, test } from 'bun:test';
import { ClaudeCodeBackend, createClaudeCodeBackend } from './backend.js';

describe('ClaudeCodeBackend', () => {
  test('exposes the expected capability flags', () => {
    const b = new ClaudeCodeBackend();
    expect(b.name).toBe('claude-code');
    expect(b.capabilities.supportClaudeCodePlugin).toBe(true);
    expect(b.capabilities.supportsAppendSystemPrompt).toBe(true);
    expect(b.capabilities.supportsNativeResume).toBe(true);
  });

  test('mapPermission converts abstract levels to --permission-mode values', () => {
    const b = new ClaudeCodeBackend();
    expect(b.mapPermission('ask')).toBe('default');
    expect(b.mapPermission('auto')).toBe('acceptEdits');
    expect(b.mapPermission('yolo')).toBe('bypassPermissions');
  });

  test('mapPermission falls back to default for unknown levels', () => {
    const b = new ClaudeCodeBackend();
    expect(b.mapPermission('garbage' as unknown as 'ask')).toBe('default');
  });

  test('createClaudeCodeBackend factory returns a backend instance', () => {
    const b = createClaudeCodeBackend('claude');
    expect(b.name).toBe('claude-code');
  });
});
