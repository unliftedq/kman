import {
  CoreRunManager,
  IpcClient,
  type DaemonExec,
  type RunManager,
} from '@kman/daemon';
import type { AgentContext } from '@kman/types';
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
