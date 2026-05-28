import { describe, expect, test } from 'bun:test';
import { CopilotCliBackend, createCopilotCliBackend } from './backend.js';

describe('CopilotCliBackend', () => {
  test('exposes the expected capability flags', () => {
    const b = new CopilotCliBackend();
    expect(b.name).toBe('copilot-cli');
    expect(b.capabilities.supportClaudeCodePlugin).toBe(false);
    expect(b.capabilities.supportsAppendSystemPrompt).toBe(true);
    expect(b.capabilities.supportsNativeResume).toBe(true);
  });

  test('mapPermission preserves ask/auto and maps yolo to all', () => {
    const b = new CopilotCliBackend();
    expect(b.mapPermission('ask')).toBe('ask');
    expect(b.mapPermission('auto')).toBe('auto');
    expect(b.mapPermission('yolo')).toBe('all');
  });

  test('mapPermission falls back to ask for unknown levels', () => {
    const b = new CopilotCliBackend();
    expect(b.mapPermission('garbage' as unknown as 'ask')).toBe('ask');
  });

  test('createCopilotCliBackend factory returns a backend instance', () => {
    const b = createCopilotCliBackend('copilot');
    expect(b.name).toBe('copilot-cli');
  });
});
