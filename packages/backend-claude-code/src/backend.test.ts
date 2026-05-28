import { describe, expect, test } from 'bun:test';
import type { AgentContext } from '@kman/types';
import { ClaudeCodeBackend, createClaudeCodeBackend } from './backend.js';

function mkCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    profile: {
      name: 'coder',
      runtime: { default: 'claude-code' },
      soul: { prompt_file: 'soul.md' },
      defaults: {},
      runtimeOverrides: {},
    },
    agentDir: '/tmp/agents/coder',
    soulPrompt: 'You are coder.',
    backend: 'claude-code',
    permission: 'ask',
    outputFormat: 'text',
    cwd: '/tmp/work',
    extraArgs: [],
    env: {},
    stream: false,
    ...overrides,
  };
}

function argsFor(b: ClaudeCodeBackend, ctx: AgentContext, interactive: boolean): string[] {
  return (b as unknown as { buildArgs: (c: AgentContext, i: boolean) => string[] }).buildArgs(
    ctx,
    interactive,
  );
}

describe('ClaudeCodeBackend metadata', () => {
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

describe('ClaudeCodeBackend argv construction (run mode)', () => {
  test('passes --plugin-dir with the agent directory', () => {
    const b = new ClaudeCodeBackend();
    const args = argsFor(b, mkCtx(), false);
    expect(args).toContain('--plugin-dir');
    expect(args[args.indexOf('--plugin-dir') + 1]).toBe('/tmp/agents/coder');
  });

  test('emits --agent <name>:<name> — plugin-scoped form picks up the soul', () => {
    const b = new ClaudeCodeBackend();
    const args = argsFor(b, mkCtx(), false);
    const idx = args.indexOf('--agent');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('coder:coder');
  });

  test('does NOT emit --append-system-prompt — soul travels via the plugin agent', () => {
    const b = new ClaudeCodeBackend();
    const args = argsFor(b, mkCtx({ soulPrompt: 'You are coder.' }), false);
    expect(args).not.toContain('--append-system-prompt');
    // And the soul body should not appear anywhere in argv.
    expect(args.some((a) => a.includes('You are coder.'))).toBe(false);
  });

  test('--permission-mode comes from the abstract mapping', () => {
    const b = new ClaudeCodeBackend();
    const args = argsFor(b, mkCtx({ permission: 'auto' }), false);
    const idx = args.indexOf('--permission-mode');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('acceptEdits');
  });

  test('permission_mode_raw wins over the abstract mapping', () => {
    const b = new ClaudeCodeBackend();
    const args = argsFor(
      b,
      mkCtx({ permission: 'auto', permissionModeRaw: 'plan' }),
      false,
    );
    const idx = args.indexOf('--permission-mode');
    expect(args[idx + 1]).toBe('plan');
  });

  test('model and max-turns overrides emit the right flags', () => {
    const b = new ClaudeCodeBackend();
    const ctxBase = mkCtx({ model: 'sonnet' });
    const ctx: AgentContext = { ...ctxBase, maxTurns: 12 };
    const args = argsFor(b, ctx, false);
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    expect(args[args.indexOf('--max-turns') + 1]).toBe('12');
  });

  test('non-interactive emits --output-format and -p task', () => {
    const b = new ClaudeCodeBackend();
    const args = argsFor(b, mkCtx({ outputFormat: 'json', task: 'do the thing' }), false);
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    expect(args[args.indexOf('--print') + 1]).toBe('do the thing');
  });

  test('stream-json output adds --include-partial-messages', () => {
    const b = new ClaudeCodeBackend();
    const args = argsFor(
      b,
      mkCtx({ outputFormat: 'stream-json', stream: true }),
      false,
    );
    expect(args).toContain('--include-partial-messages');
  });

  test('extra args pass through verbatim', () => {
    const b = new ClaudeCodeBackend();
    const args = argsFor(b, mkCtx({ extraArgs: ['--debug', '!1p'] }), false);
    expect(args).toContain('--debug');
    expect(args).toContain('!1p');
  });
});

describe('ClaudeCodeBackend argv construction (chat mode)', () => {
  test('still emits --plugin-dir and --agent', () => {
    const b = new ClaudeCodeBackend();
    const args = argsFor(b, mkCtx(), true);
    expect(args).toContain('--plugin-dir');
    expect(args[args.indexOf('--agent') + 1]).toBe('coder:coder');
  });

  test('omits --output-format and --print in interactive mode', () => {
    const b = new ClaudeCodeBackend();
    const args = argsFor(b, mkCtx({ outputFormat: 'json', task: 'ignored' }), true);
    expect(args).not.toContain('--output-format');
    expect(args).not.toContain('--print');
  });

  test('never emits --append-system-prompt even with a non-empty soul', () => {
    const b = new ClaudeCodeBackend();
    const args = argsFor(b, mkCtx({ soulPrompt: 'You are coder.' }), true);
    expect(args).not.toContain('--append-system-prompt');
  });
});
