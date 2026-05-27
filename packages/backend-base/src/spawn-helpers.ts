import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { AgentContext } from '@kman/types';

export interface SpawnArgs {
  command: string;
  args: string[];
  /** Mode: 'run' uses stdio inherit; 'chat' uses stdio inherit but you may override. */
  options?: SpawnOptions;
}

/**
 * Spawn a backend binary with stdio inherited so the child speaks directly to the user.
 * Merges the AgentContext env into the spawn env without leaking unrelated parent env.
 */
export function spawnBackend(ctx: AgentContext, args: SpawnArgs): ChildProcess {
  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...ctx.env,
  };
  const opts: SpawnOptions = {
    cwd: ctx.cwd,
    env: baseEnv,
    stdio: 'inherit',
    shell: false,
    ...args.options,
  };
  return spawn(args.command, args.args, opts);
}
