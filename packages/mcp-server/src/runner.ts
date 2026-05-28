import { spawn } from 'node:child_process';

export interface RunAgentParams {
  agent: string;
  task: string;
  runtime?: string;
  model?: string;
  permission?: 'ask' | 'auto' | 'yolo';
  cwd?: string;
  outputFormat?: 'text' | 'json' | 'stream-json';
  /**
   * If true, propagate `KMAN_RUN_CHAIN` so nested invocations can detect
   * cycles in the launching agent's own MCP server.
   */
  appendToRunChain?: string;
}

export interface RunAgentResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Invoke kman as a subprocess to run a peer agent. We re-shell into the same
 * CLI binary (rather than calling `launchRun` in-process) so that the
 * sub-agent's process tree, env, and output are isolated from the MCP
 * server's stdio transport — the server's stdout MUST stay clean JSON-RPC.
 *
 * The command + base args come from `kmanInvocation()` so this works both
 * for the published `kman` binary on PATH and for `bun apps/cli/src/main.ts`
 * dev runs.
 */
export async function runAgent(
  invocation: { command: string; baseArgs: readonly string[] },
  params: RunAgentParams,
  timeoutMs?: number,
): Promise<RunAgentResult> {
  const args: string[] = [...invocation.baseArgs, '-a', params.agent, 'run', '--task', params.task];

  if (params.runtime) args.push('--runtime', params.runtime);
  if (params.model) args.push('--model', params.model);
  if (params.permission) args.push('--permission', params.permission);
  if (params.outputFormat) args.push('--output', params.outputFormat);
  if (params.cwd) args.push('--cwd', params.cwd);

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (params.appendToRunChain) {
    const prior = env['KMAN_RUN_CHAIN'] ?? '';
    env['KMAN_RUN_CHAIN'] = prior ? `${prior},${params.appendToRunChain}` : params.appendToRunChain;
  }

  return new Promise<RunAgentResult>((resolve, reject) => {
    const child = spawn(invocation.command, args, {
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
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (!child.killed) child.kill('SIGTERM');
      }, timeoutMs);
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
