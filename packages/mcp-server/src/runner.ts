import { spawn } from 'node:child_process';

export interface SubmitAgentParams {
  agent: string;
  task: string;
  runtime?: string;
  model?: string;
  permission?: 'ask' | 'auto' | 'yolo';
  cwd?: string;
  /**
   * If set, propagate `KMAN_RUN_CHAIN` so the daemon-launched backend's own
   * MCP server can detect delegation cycles in the launching agent's chain.
   */
  appendToRunChain?: string;
}

export interface KmanExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * One-shot task record as returned by `kman task get <id> --json`. Only the
 * fields the MCP layer reports back to the caller are typed here.
 */
export interface TaskSnapshot {
  id: string;
  agent: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  exitCode?: number;
  error?: string;
}

/**
 * Re-shell into the kman CLI. We invoke kman as a subprocess (rather than
 * calling into @kman/daemon in-process) so the MCP server's stdout stays clean
 * JSON-RPC and the package stays decoupled from the daemon implementation.
 *
 * The command + base args come from `mcpServerInvocation()` so this works both
 * for the published `kman` binary on PATH and for `bun apps/cli/src/main.ts`
 * dev runs.
 */
function runKman(
  invocation: { command: string; baseArgs: readonly string[] },
  args: string[],
  opts: { appendToRunChain?: string; timeoutMs?: number } = {},
): Promise<KmanExecResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.appendToRunChain) {
    const prior = env['KMAN_RUN_CHAIN'] ?? '';
    env['KMAN_RUN_CHAIN'] = prior ? `${prior},${opts.appendToRunChain}` : opts.appendToRunChain;
  }

  return new Promise<KmanExecResult>((resolve, reject) => {
    const child = spawn(invocation.command, [...invocation.baseArgs, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });

    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        if (!child.killed) child.kill('SIGTERM');
      }, opts.timeoutMs);
    }

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
  });
}

/**
 * Submit a task to the kman daemon via `kman run`, which starts the daemon if
 * needed and prints the new task id. Returns the parsed task id so the caller
 * can hand it back to the model for async status polling.
 */
export async function submitAgentTask(
  invocation: { command: string; baseArgs: readonly string[] },
  params: SubmitAgentParams,
  timeoutMs?: number,
): Promise<{ taskId: string } | { error: string }> {
  const args: string[] = ['-a', params.agent, 'run', '--task', params.task];
  if (params.runtime) args.push('--runtime', params.runtime);
  if (params.model) args.push('--model', params.model);
  if (params.permission) args.push('--permission', params.permission);
  if (params.cwd) args.push('--cwd', params.cwd);

  const result = await runKman(invocation, args, {
    ...(params.appendToRunChain ? { appendToRunChain: params.appendToRunChain } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

  if (result.exitCode !== 0) {
    return {
      error:
        `Failed to submit task (exit ${result.exitCode}).` +
        (result.stderr ? `\nstderr:\n${result.stderr.trim()}` : ''),
    };
  }
  const taskId = result.stdout.trim().split(/\s+/).pop() ?? '';
  if (!taskId) {
    return { error: 'kman run did not return a task id.' };
  }
  return { taskId };
}

/** Fetch a task record via `kman task get <id> --json`. */
export async function getTask(
  invocation: { command: string; baseArgs: readonly string[] },
  id: string,
  timeoutMs?: number,
): Promise<TaskSnapshot | { error: string }> {
  const result = await runKman(invocation, ['task', 'get', id, '--json'], {
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  if (result.exitCode !== 0) {
    return {
      error:
        `Failed to read task "${id}" (exit ${result.exitCode}).` +
        (result.stderr ? `\nstderr:\n${result.stderr.trim()}` : ''),
    };
  }
  try {
    return JSON.parse(result.stdout) as TaskSnapshot;
  } catch {
    return { error: `Could not parse task record for "${id}".` };
  }
}

/** Fetch a task's captured output via `kman task logs <id>`. */
export async function getTaskLogs(
  invocation: { command: string; baseArgs: readonly string[] },
  id: string,
  timeoutMs?: number,
): Promise<{ logs: string } | { error: string }> {
  const result = await runKman(invocation, ['task', 'logs', id], {
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  if (result.exitCode !== 0) {
    return {
      error:
        `Failed to read logs for task "${id}" (exit ${result.exitCode}).` +
        (result.stderr ? `\nstderr:\n${result.stderr.trim()}` : ''),
    };
  }
  return { logs: result.stdout };
}

