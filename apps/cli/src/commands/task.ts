import { Command } from 'commander';
import type { IpcClient, TaskRecord, TaskStatus } from '@kman/daemon';
import { ExitCode, UserError, type PermissionLevel } from '@kman/types';
import { requireAgent } from '../common/agent-option.js';
import { getClient } from '../common/daemon-runtime.js';
import { parsePermission } from '../common/run-args.js';

const VALID_STATUSES: TaskStatus[] = ['queued', 'running', 'succeeded', 'failed', 'canceled'];

export function buildTaskCommand(): Command {
  const cmd = new Command('task').description('Submit and inspect tasks managed by the kman daemon.');

  cmd
    .command('submit')
    .description('Queue a task for an agent on the daemon. Use -a <agent> to target.')
    .requiredOption('--task <text>', 'Task for the agent to perform.')
    .option('--priority <n>', 'Higher runs first (default 0).', parseIntOpt)
    .option('--max-attempts <n>', 'Retry up to N times on failure (default 1).', parseIntOpt)
    .option('--runtime <runtime>', "Override the agent's default runtime.")
    .option('--model <id>', "Override the agent's default model.")
    .option('--permission <level>', 'Permission mode (ask | auto | yolo).')
    .option('--cwd <path>', 'Working directory for the run.')
    .action(
      async (opts: {
        task: string;
        priority?: number;
        maxAttempts?: number;
        runtime?: string;
        model?: string;
        permission?: string;
        cwd?: string;
      }) => {
        const agent = requireAgent();
        const client = await requireClient();
        const rec = await client.submit({
          agent,
          task: opts.task,
          ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
          ...(opts.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
          ...(opts.runtime ? { runtime: opts.runtime } : {}),
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.permission ? { permission: parsePermission(opts.permission) as PermissionLevel } : {}),
          ...(opts.cwd ? { cwd: opts.cwd } : {}),
        });
        process.stdout.write(`${rec.id}\n`);
      },
    );

  cmd
    .command('list')
    .description('List tasks, optionally filtered by status.')
    .option('--status <status>', `Filter: ${VALID_STATUSES.join(' | ')}.`)
    .option('--json', 'Emit as JSON.')
    .action(async (opts: { status?: string; json?: boolean }) => {
      const client = await requireClient();
      const query = opts.status ? { status: validateStatus(opts.status) } : {};
      const tasks = await client.list(query);
      if (opts.json) {
        process.stdout.write(JSON.stringify(tasks, null, 2) + '\n');
      } else {
        process.stdout.write(formatTaskTable(tasks));
      }
    });

  cmd
    .command('get <id>')
    .description('Show one task record.')
    .option('--json', 'Emit as JSON.')
    .action(async (id: string, opts: { json?: boolean }) => {
      const client = await requireClient();
      const rec = await client.get(id);
      if (opts.json) process.stdout.write(JSON.stringify(rec, null, 2) + '\n');
      else process.stdout.write(formatTaskDetail(rec));
    });

  cmd
    .command('logs <id>')
    .description("Print a task's captured output.")
    .option('-f, --follow', 'Follow the log until the task finishes.')
    .action(async (id: string, opts: { follow?: boolean }) => {
      const client = await requireClient();
      if (!opts.follow) {
        process.stdout.write(await client.logs(id));
        return;
      }
      await followLogs(client, id);
    });

  cmd
    .command('cancel <id>')
    .description('Cancel a queued or running task.')
    .action(async (id: string) => {
      const client = await requireClient();
      await client.cancel(id);
      process.stdout.write(`canceled ${id}\n`);
    });

  return cmd;
}

async function requireClient(): Promise<IpcClient> {
  const client = await getClient();
  if (!client) {
    throw new UserError('kman daemon is not running. Start it with `kman daemon start`.');
  }
  return client;
}

function validateStatus(s: string): TaskStatus {
  if (!VALID_STATUSES.includes(s as TaskStatus)) {
    throw new UserError(`Invalid status "${s}". Expected one of: ${VALID_STATUSES.join(', ')}.`);
  }
  return s as TaskStatus;
}

function parseIntOpt(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw new UserError(`Expected an integer, got "${value}".`);
  return n;
}

function formatTaskTable(tasks: TaskRecord[]): string {
  if (tasks.length === 0) return 'no tasks\n';
  const lines = tasks.map((t) => {
    const id = t.id.padEnd(20);
    const status = t.status.padEnd(10);
    const agent = t.agent.padEnd(16);
    return `${id} ${status} ${agent} ${truncate(t.task, 50)}`;
  });
  return lines.join('\n') + '\n';
}

function formatTaskDetail(t: TaskRecord): string {
  const out: string[] = [
    `id:        ${t.id}`,
    `agent:     ${t.agent}`,
    `status:    ${t.status}`,
    `priority:  ${t.priority}`,
    `attempts:  ${t.attempts}/${t.maxAttempts}`,
    `created:   ${t.createdAt}`,
  ];
  if (t.startedAt) out.push(`started:   ${t.startedAt}`);
  if (t.finishedAt) out.push(`finished:  ${t.finishedAt}`);
  if (t.exitCode !== undefined) out.push(`exitCode:  ${t.exitCode}`);
  if (t.error) out.push(`error:     ${t.error}`);
  out.push(`task:      ${t.task}`);
  return out.join('\n') + '\n';
}

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? oneLine.slice(0, n - 1) + '…' : oneLine;
}

const TERMINAL: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['succeeded', 'failed', 'canceled']);

async function followLogs(client: IpcClient, id: string): Promise<void> {
  let printed = 0;
  for (;;) {
    const full = await client.logs(id);
    if (full.length > printed) {
      process.stdout.write(full.slice(printed));
      printed = full.length;
    }
    const rec = await client.get(id);
    if (TERMINAL.has(rec.status)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  process.exit(ExitCode.Success);
}
