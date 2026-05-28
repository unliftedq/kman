import type { AgentContext } from '@kman/types';
import { ensureInjectionPlugin } from '@kman/mcp-server';
import { mcpServerInvocation } from '../commands/mcp.js';

/**
 * Make the kman MCP server available inside the agent the user is about to
 * launch. We add the injection plugin to the backend's `--plugin-dir` list
 * and set `KMAN_SELF_AGENT` so the server hides the calling agent from its
 * own roster (and refuses to dispatch back to it).
 *
 * Opt-out: setting KMAN_NO_MCP=1 returns the context unchanged so users on
 * locked-down systems or running tests aren't forced through the extra
 * plugin load.
 */
export async function attachKmanMcp(ctx: AgentContext): Promise<AgentContext> {
  if (process.env['KMAN_NO_MCP'] === '1') return ctx;

  const inv = mcpServerInvocation();
  const pluginDir = await ensureInjectionPlugin({ kmanCommand: inv.command, kmanBaseArgs: inv.baseArgs });

  const env: Record<string, string> = {
    ...ctx.env,
    KMAN_SELF_AGENT: ctx.profile.name,
    // Track the delegation chain across nested kman invocations so the MCP
    // server can detect cycles (a → b → a) before spawning the next backend.
    KMAN_RUN_CHAIN: appendChain(process.env['KMAN_RUN_CHAIN'], ctx.profile.name),
    // KMAN_SELECTED_AGENT is how main.ts passes `-a <name>` to subcommands
    // inside *this* kman process. It must NOT leak through the spawned
    // backend to any sub-kman it later spawns — most importantly the
    // injected MCP server, whose `kman mcp` action would otherwise be
    // routed to an agent-scoped path and exit before the JSON-RPC loop
    // ever starts. Spawned env merge is `{ ...process.env, ...ctx.env }`,
    // so writing an empty string here overrides the inherited value.
    KMAN_SELECTED_AGENT: '',
  };

  return {
    ...ctx,
    // The MCP-injection plugin-dir goes *before* user extra args so users
    // can still pass their own `--plugin-dir <override>` later.
    extraArgs: ['--plugin-dir', pluginDir, ...ctx.extraArgs],
    env,
  };
}

function appendChain(prior: string | undefined, name: string): string {
  if (!prior) return name;
  const parts = prior.split(',').filter(Boolean);
  if (parts[parts.length - 1] === name) return prior;
  return [...parts, name].join(',');
}
