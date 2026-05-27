import { Command } from 'commander';
import { buildContext, launchChat, readProfile } from '@delego/core';
import type { PermissionLevel } from '@delego/types';
import { requireAgent } from '../common/agent-option.js';
import { resolveBackend } from '../common/backend-registry.js';
import { parsePermission } from '../common/run-args.js';

export function buildChatCommand(): Command {
  return new Command('chat')
    .description('Interactive REPL with an agent.')
    .option('--runtime <backend>', 'Override the agent\'s default backend.')
    .option('--model <id>', 'Override model id.')
    .option('--permission <level>', 'ask | auto | yolo')
    .option('--runtime-flag <flag>', 'Raw backend-native flag (repeatable).', collect, [] as string[])
    .option('--cwd <path>', 'Working directory for the backend.')
    .action(
      async (opts: {
        runtime?: string;
        model?: string;
        permission?: string;
        runtimeFlag: string[];
        cwd?: string;
      }) => {
        const agent = requireAgent();
        const profile = await readProfile(agent);

        const ctx = await buildContext(profile, {
          ...(opts.runtime ? { backend: opts.runtime } : {}),
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.permission ? { permission: parsePermission(opts.permission) as PermissionLevel } : {}),
          ...(opts.cwd ? { cwd: opts.cwd } : {}),
          runtimeFlags: expandRuntimeFlags(opts.runtimeFlag),
        });

        const backend = resolveBackend(ctx.backend);
        const { exitCode } = await launchChat(backend, ctx);
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
