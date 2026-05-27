import { Command } from 'commander';
import { buildContext, launchRun, readProfile } from '@kman/core';
import { UserError, type OutputFormat, type PermissionLevel } from '@kman/types';
import { requireAgent } from '../common/agent-option.js';
import { resolveBackend } from '../common/backend-registry.js';
import { parseOutputFormat, parsePermission } from '../common/run-args.js';

export function buildRunCommand(): Command {
  return new Command('run')
    .description('One-shot run of an agent.')
    .option('--task <text>', 'Task prompt passed to the backend.')
    .option('--runtime <backend>', 'Override the agent\'s default backend.')
    .option('--model <id>', 'Override model id.')
    .option('--permission <level>', 'ask | auto | yolo')
    .option('--runtime-flag <flag>', 'Raw backend-native flag (repeatable).', collect, [] as string[])
    .option('--output <format>', 'text | json | stream-json')
    .option('--stream', 'Implies --output stream-json.')
    .option('--cwd <path>', 'Working directory for the backend.')
    .action(
      async (opts: {
        task?: string;
        runtime?: string;
        model?: string;
        permission?: string;
        runtimeFlag: string[];
        output?: string;
        stream?: boolean;
        cwd?: string;
      }) => {
        const agent = requireAgent();
        const profile = await readProfile(agent);

        if (opts.stream && opts.output && opts.output !== 'stream-json') {
          throw new UserError('--stream conflicts with --output of a different value.');
        }

        const ctx = await buildContext(profile, {
          ...(opts.runtime ? { backend: opts.runtime } : {}),
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.permission ? { permission: parsePermission(opts.permission) as PermissionLevel } : {}),
          ...(opts.output ? { outputFormat: parseOutputFormat(opts.output) as OutputFormat } : {}),
          ...(opts.stream !== undefined ? { stream: opts.stream === true } : {}),
          ...(opts.cwd ? { cwd: opts.cwd } : {}),
          ...(opts.task !== undefined ? { task: opts.task } : {}),
          runtimeFlags: expandRuntimeFlags(opts.runtimeFlag),
        });

        const backend = resolveBackend(ctx.backend);
        const { exitCode } = await launchRun(backend, ctx);
        process.exit(exitCode);
      },
    );
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function expandRuntimeFlags(values: string[]): string[] {
  const out: string[] = [];
  for (const item of values) {
    if (item.includes('=') && !item.startsWith('--')) {
      const eq = item.indexOf('=');
      const k = item.slice(0, eq);
      const v = item.slice(eq + 1);
      out.push(`--${k}`, v);
    } else {
      out.push(item);
    }
  }
  return out;
}
