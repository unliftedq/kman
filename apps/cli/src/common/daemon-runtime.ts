import { spawn } from 'node:child_process';
import {
  CoreRunManager,
  IpcClient,
  type DaemonExec,
  type RunManager,
} from '@kman/daemon';
import { UserError, type AgentContext } from '@kman/types';
import { resolveBackend } from './backend-registry.js';
import { attachKmanMcp } from './mcp-inject.js';
import { mcpServerInvocation } from '../commands/mcp.js';

/**
 * Build the RunManager the daemon uses to execute tasks. It runs agents through
 * the exact same path as `kman run`: resolve the backend from the registry and
 * attach the kman MCP server so daemon-launched agents can still reach peers.
 */
export function createRunManager(): RunManager {
  return new CoreRunManager({
    resolveBackend,
    prepareContext: (ctx: AgentContext) => attachKmanMcp(ctx),
  });
}

/**
 * How the OS host / detached launcher should invoke the daemon. Reuses the same
 * self-invocation logic as the MCP server install so it works from the
 * published bin, a bun-global install, or a from-source dev checkout.
 */
export function daemonExec(extraArgs: string[] = []): DaemonExec {
  const inv = mcpServerInvocation();
  return { command: inv.command, args: [...inv.baseArgs, 'daemon', 'run', ...extraArgs] };
}

/**
 * Get a client for the running daemon, or undefined if it isn't running.
 * Centralizes the "is there a daemon?" check so each command gives a clean
 * message instead of a stack trace.
 */
export async function getClient(): Promise<IpcClient | undefined> {
  const client = await IpcClient.fromState();
  if (!client) return undefined;
  return (await client.isRunning()) ? client : undefined;
}

/**
 * Return a client for the daemon, starting it in the background first if it is
 * not already running. This is the front door for `kman run` and any other
 * command that should "just work" without the user manually starting the
 * daemon. Throws a UserError if the daemon fails to become healthy in time.
 */
export async function ensureDaemon(timeoutMs = 5000): Promise<IpcClient> {
  const existing = await getClient();
  if (existing) return existing;

  const exec = daemonExec();
  const child = spawn(exec.command, exec.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const client = await getClient();
    if (client) return client;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new UserError('kman daemon did not become healthy within 5s; check logs.');
}
