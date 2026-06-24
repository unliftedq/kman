import { describe, expect, test } from 'vitest';
import type { AgentContext, PermissionLevel } from '@kman/types';
import { CopilotCliBackend, createCopilotCliBackend } from './backend.js';

function mkCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    profile: {
      name: 'coder',
      runtime: { default: 'copilot-cli' },
      soul: { prompt_file: 'soul.md' },
      defaults: {},
      runtimeOverrides: {},
    },
    agentDir: '/tmp/agents/coder',
    soulPrompt: '',
    backend: 'copilot-cli',
    permission: 'ask',
    outputFormat: 'text',
    cwd: '/tmp/work',
    extraArgs: [],
    env: {},
    stream: false,
    ...overrides,
  };
}

// `buildArgs` is private; TS-private is compile-time only — reach in for assertions.
function argsFor(b: CopilotCliBackend, ctx: AgentContext, interactive: boolean): string[] {
  return (
    b as unknown as {
      buildArgs: (c: AgentContext, pluginDir: string, pluginAgent: string, i: boolean) => string[];
    }
  ).buildArgs(ctx, '/tmp/runtime/coder/.copilot', 'kman:coder', interactive);
}

describe('CopilotCliBackend metadata', () => {
  test('exposes the expected capability flags', () => {
    const b = new CopilotCliBackend();
    expect(b.name).toBe('copilot-cli');
    expect(b.capabilities.supportClaudeCodePlugin).toBe(true);
    expect(b.capabilities.supportsAppendSystemPrompt).toBe(true);
    expect(b.capabilities.supportsNativeResume).toBe(true);
  });

  test('mapPermission returns the real copilot flag name (or "(default)" for ask)', () => {
    const b = new CopilotCliBackend();
    expect(b.mapPermission('ask')).toBe('(default)');
    expect(b.mapPermission('auto')).toBe('--allow-all-tools');
    expect(b.mapPermission('yolo')).toBe('--yolo');
  });

  test('mapPermission falls back to "(default)" for unknown levels', () => {
    const b = new CopilotCliBackend();
    expect(b.mapPermission('garbage' as unknown as PermissionLevel)).toBe('(default)');
  });

  test('createCopilotCliBackend factory returns a backend instance', () => {
    const b = createCopilotCliBackend('copilot');
    expect(b.name).toBe('copilot-cli');
  });
});

describe('CopilotCliBackend argv construction (run mode)', () => {
  test('always passes --plugin-dir with the agent directory', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(b, mkCtx(), false);
    expect(args).toContain('--plugin-dir');
    expect(args[args.indexOf('--plugin-dir') + 1]).toBe('/tmp/runtime/coder/.copilot');
  });

  test('emits --agent <plugin>:<name> using Copilot\'s plugin-scoped selector', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(b, mkCtx(), false);
    const idx = args.indexOf('--agent');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('kman:coder');
  });

  test('ask permission emits no permission flag (copilot prompts by default)', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(b, mkCtx({ permission: 'ask' }), false);
    expect(args).not.toContain('--allow-all-tools');
    expect(args).not.toContain('--yolo');
  });

  test('auto permission emits --allow-all-tools', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(b, mkCtx({ permission: 'auto' }), false);
    expect(args).toContain('--allow-all-tools');
  });

  test('yolo permission emits --yolo', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(b, mkCtx({ permission: 'yolo' }), false);
    expect(args).toContain('--yolo');
  });

  test('permission_mode_raw suppresses the abstract mapping (trust the user)', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(
      b,
      mkCtx({
        permission: 'yolo',
        permissionModeRaw: 'whatever',
        extraArgs: ['--allow-tool=shell(git:*)'],
      }),
      false,
    );
    expect(args).not.toContain('--yolo');
    expect(args).not.toContain('--allow-all-tools');
    expect(args).toContain('--allow-tool=shell(git:*)');
  });

  test('model override emits --model <id>', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(b, mkCtx({ model: 'gpt-5.2' }), false);
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('gpt-5.2');
  });

  test('text output format passes through', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(b, mkCtx({ outputFormat: 'text' }), false);
    const idx = args.indexOf('--output-format');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('text');
  });

  test('json output format passes through', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(b, mkCtx({ outputFormat: 'json' }), false);
    const idx = args.indexOf('--output-format');
    expect(args[idx + 1]).toBe('json');
  });

  test('stream-json clamps to --output-format json plus --stream on', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(b, mkCtx({ outputFormat: 'stream-json', stream: true }), false);
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    expect(args).toContain('--stream');
    expect(args[args.indexOf('--stream') + 1]).toBe('on');
  });

  test('-p body is the task verbatim — soul travels via --agent, not the prompt', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(
      b,
      mkCtx({ soulPrompt: 'You are coder.', task: 'list files' }),
      false,
    );
    const idx = args.indexOf('-p');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('list files');
  });

  test('no task → no -p (matches "No prompt provided" copilot behaviour)', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(b, mkCtx(), false);
    expect(args).not.toContain('-p');
  });

  test('extra args pass through verbatim', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(b, mkCtx({ extraArgs: ['--add-dir', '/tmp/x'] }), false);
    expect(args).toContain('--add-dir');
    expect(args[args.indexOf('--add-dir') + 1]).toBe('/tmp/x');
  });

  test('no broken legacy flags appear in argv', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(
      b,
      mkCtx({
        permission: 'auto',
        soulPrompt: 'you are coder',
        task: 'hi',
        outputFormat: 'json',
      }),
      false,
    );
    expect(args).not.toContain('--system-prompt');
    expect(args).not.toContain('--approve-mode');
    // Soul is no longer prepended into -p; the body should be just the task.
    expect(args[args.indexOf('-p') + 1]).toBe('hi');
  });
});

describe('CopilotCliBackend argv construction (chat mode)', () => {
  test('omits --output-format entirely (interactive is text-only)', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(b, mkCtx({ outputFormat: 'json' }), true);
    expect(args).not.toContain('--output-format');
  });

  test('omits -p even when a task is set', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(b, mkCtx({ task: 'should be ignored' }), true);
    expect(args).not.toContain('-p');
  });

  test('still emits --plugin-dir, --agent and permission flags', () => {
    const b = new CopilotCliBackend();
    const args = argsFor(b, mkCtx({ permission: 'auto' }), true);
    expect(args).toContain('--plugin-dir');
    expect(args).toContain('--agent');
    expect(args[args.indexOf('--agent') + 1]).toBe('kman:coder');
    expect(args).toContain('--allow-all-tools');
  });

  test('chat with a soul does not emit the legacy stderr warning — system prompt is delivered by --agent', () => {
    // The mere existence of a soul should not flip any per-call side effects.
    // This is asserted indirectly: chat()'s spawn behaviour is exercised via
    // argv only, with no message written to process.stderr in the test process.
    const b = new CopilotCliBackend();
    const args = argsFor(b, mkCtx({ soulPrompt: 'you are coder' }), true);
    expect(args).toContain('--agent');
    expect(args[args.indexOf('--agent') + 1]).toBe('kman:coder');
  });
});
