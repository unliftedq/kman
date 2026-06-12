import { Command } from 'commander';
import type { IpcClient, TaskRecord, TaskStatus } from '@kman/daemon';
import { ExitCode, UserError } from '@kman/types';
import { getClient } from '../common/daemon-runtime.js';

const VALID_STATUSES: TaskStatus[] = ['queued', 'running', 'succeeded', 'failed', 'canceled'];

export function buildTaskCommand(): Command {
  const cmd = new Command('task').description('Inspect and manage tasks scheduled on the kman daemon.');

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
