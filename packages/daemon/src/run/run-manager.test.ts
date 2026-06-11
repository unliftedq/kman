import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentContext,
  Backend,
  BackendCapabilities,
  PermissionLevel,
  RunOptions,
} from '@kman/types';
import type { TaskRecord } from '../protocol.js';
import { CoreRunManager } from './run-manager.js';

/** Backend that runs an arbitrary snippet of JS via the current runtime (bun). */
class ScriptBackend implements Backend {
  readonly name = 'script';
  readonly capabilities: BackendCapabilities = {
    supportClaudeCodePlugin: false,
    supportsAppendSystemPrompt: true,
    supportsNativeResume: false,
  };
  constructor(private readonly code: string) {}
  async spawn(_ctx: AgentContext, opts?: RunOptions): Promise<ChildProcess> {
    const stdio = opts?.stdio === 'pipe' ? (['ignore', 'pipe', 'pipe'] as const) : 'inherit';
    return spawn(process.execPath, ['-e', this.code], { stdio });
  }
  async chat(): Promise<ChildProcess> {
    throw new Error('not used');
  }
  mapPermission(l: PermissionLevel): string {
    return l;
  }
}

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'kman-run-'));
  process.env['KMAN_HOME'] = home;
  // Minimal agent on disk so readProfile/buildContext succeed.
  const agentDir = join(home, 'agents', 'tester');
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, 'agent.toml'),
    'name = "tester"\n[runtime]\ndefault = "script"\n[soul]\nprompt_file = "soul.md"\n',
  );
  await writeFile(join(agentDir, 'soul.md'), 'You are a test agent.\n');
});
afterEach(async () => {
  delete process.env['KMAN_HOME'];
  await rm(home, { recursive: true, force: true });
});

function record(over: Partial<TaskRecord> = {}): TaskRecord {
  const id = over.id ?? 't_test';
  return {
    id,
    seq: 1,
    agent: 'tester',
    task: 'say hi',
    status: 'running',
    priority: 0,
    attempts: 1,
    maxAttempts: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    logFile: join('logs', `${id}.log`),
    ...over,
  };
}

describe('CoreRunManager', () => {
  test('runs an agent, captures output, and reports exit 0', async () => {
    const mgr = new CoreRunManager({
      resolveBackend: () => new ScriptBackend('process.stdout.write("hello from agent")'),
      baseDir: join(home, 'daemon'),
    });
    const outcome = await mgr.start(record()).done;
    expect(outcome.exitCode).toBe(0);

    const log = await readFile(join(home, 'daemon', 'logs', 't_test.log'), 'utf8');
    expect(log).toContain('hello from agent');
    expect(log).toContain('exited with code 0');
  });

  test('propagates a non-zero exit code', async () => {
    const mgr = new CoreRunManager({
      resolveBackend: () => new ScriptBackend('process.exit(3)'),
      baseDir: join(home, 'daemon'),
    });
    const outcome = await mgr.start(record({ id: 't_fail' })).done;
    expect(outcome.exitCode).toBe(3);
  });

  test('returns a failure outcome (not a throw) when the agent does not exist', async () => {
    const mgr = new CoreRunManager({
      resolveBackend: () => new ScriptBackend('process.exit(0)'),
      baseDir: join(home, 'daemon'),
    });
    const outcome = await mgr.start(record({ id: 't_missing', agent: 'ghost' })).done;
    expect(outcome.exitCode).toBe(1);
    expect(outcome.error).toBeTruthy();
  });

  test('cancel terminates a long-running child', async () => {
    const mgr = new CoreRunManager({
      resolveBackend: () => new ScriptBackend('setInterval(() => {}, 1000)'),
      baseDir: join(home, 'daemon'),
      killGraceMs: 200,
    });
    const handle = mgr.start(record({ id: 't_cancel' }));
    // Give the child a moment to spawn, then cancel.
    await new Promise((r) => setTimeout(r, 150));
    handle.cancel();
    const outcome = await handle.done;
    expect(outcome.exitCode).not.toBe(0);
  });
});
