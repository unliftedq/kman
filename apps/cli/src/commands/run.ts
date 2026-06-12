import { Command } from 'commander';
import { UserError, type PermissionLevel } from '@kman/types';
import { requireAgent } from '../common/agent-option.js';
import { ensureDaemon } from '../common/daemon-runtime.js';
import { parsePermission } from '../common/run-args.js';

export function buildRunCommand(): Command {
  return new Command('run')
    .description(
      'Run an agent on a single task. Submits the task to the kman daemon (starting it if ' +
        'needed) and prints the task id. Use `kman task get <id>` / `kman task logs <id>` to ' +
        'follow it.',
    )
    .option('--task <text>', 'Task for the agent to perform.')
    .option('--priority <n>', 'Higher runs first (default 0).', parseIntOpt)
    .option('--max-attempts <n>', 'Retry up to N times on failure (default 1).', parseIntOpt)
    .option('--runtime <runtime>', "Override the agent's default runtime for this call.")
    .option('--model <id>', "Override the agent's default model for this call.")
    .option('--permission <level>', 'Permission mode (ask | auto | yolo).')
    .option('--cwd <path>', 'Working directory for the runtime process.')
    .action(
      async (opts: {
        task?: string;
        priority?: number;
        maxAttempts?: number;
        runtime?: string;
        model?: string;
        permission?: string;
        cwd?: string;
      }) => {
        const agent = requireAgent();
        if (!opts.task) {
          throw new UserError('Missing required --task <text>.');
        }

        const client = await ensureDaemon();
        const runChain = resolveRunChain();
        const rec = await client.submit({
          agent,
          task: opts.task,
          ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
          ...(opts.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
          ...(opts.runtime ? { runtime: opts.runtime } : {}),
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.permission ? { permission: parsePermission(opts.permission) as PermissionLevel } : {}),
          ...(opts.cwd ? { cwd: opts.cwd } : {}),
          ...(runChain ? { runChain } : {}),
        });
        process.stdout.write(`${rec.id}\n`);
      },
    );
}

function parseIntOpt(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw new UserError(`Expected an integer, got "${value}".`);
  return n;
}

/**
 * The delegation chain that led to this run, carried via KMAN_RUN_CHAIN when an
 * agent's injected MCP server re-shells `kman run`. Forwarded to the daemon on
 * the task so the eventual backend's own MCP server can detect cross-agent
 * cycles. An unsubstituted `${...}` placeholder means the host never set it.
 */
function resolveRunChain(): string | undefined {
  const raw = process.env['KMAN_RUN_CHAIN'];
  return raw && !raw.includes('${') ? raw : undefined;
}
