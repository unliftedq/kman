import type { AgentContext, BackendName } from '@kman/types';
import { ensureInjectionConfig } from '@kman/mcp-server';
import { isKmanInstalledIn, mcpServerInvocation } from '../commands/mcp.js';

/**
 * Make the kman MCP server available inside the agent the user is about to
 * launch. Writes a standalone MCP config to ~/.kman/runtime/mcp-config.json
 * and hands the backend its native MCP-config flag — so the host registers
 * the server under its plain namespace (`mcp__kman__<surface>`) rather than
 * a longer plugin-scoped form.
 *
 * `KMAN_SELF_AGENT` carries the calling agent's name through so the server
 * hides it from its own roster and refuses to dispatch back to it; the
 * placeholder is substituted at spawn time against the env we set here.
 *
 * Opt-out: setting KMAN_NO_MCP=1 returns the context unchanged so users on
 * locked-down systems or running tests aren't forced through the extra
 * config load.
 */
export async function attachKmanMcp(ctx: AgentContext): Promise<AgentContext> {
  if (process.env['KMAN_NO_MCP'] === '1') return ctx;

  const flagSpec = mcpConfigFlagFor(ctx.backend);
  if (!flagSpec) return ctx; // unknown backend — fail open rather than block the run

  // If the user already opted in via `kman mcp install`, the backend has
  // `kman` in its user-scope config. Adding the same key via `--mcp-config`
  // would re-register it with undefined precedence (host warnings, silent
  // shadowing, or duplicate-name errors depending on the backend). Skip the
  // flag entirely in that case — but still write env vars below, because
  // the installed entry uses the same `${KMAN_SELF_AGENT}` placeholder and
  // relies on us setting it in the backend's process env.
  const alreadyInstalled = await isKmanInstalledIn(ctx.backend);

  const env: Record<string, string> = {
    ...ctx.env,
    KMAN_SELF_AGENT: ctx.profile.name,
    // Track the delegation chain across nested kman invocations so the MCP
    // server can detect cycles (a → b → a) before spawning the next backend.
    // Prefer a chain seeded onto the context (daemon-routed runs carry it on
    // the task record) and fall back to this process's own env (in-process
    // `kman chat` runs).
    KMAN_RUN_CHAIN: appendChain(ctx.env['KMAN_RUN_CHAIN'] ?? process.env['KMAN_RUN_CHAIN'], ctx.profile.name),
    // KMAN_SELECTED_AGENT is how main.ts passes `-a <name>` to subcommands
    // inside *this* kman process. It must NOT leak through the spawned
    // backend to any sub-kman it later spawns — most importantly the
    // injected MCP server, whose `kman mcp` action would otherwise be
    // routed to an agent-scoped path and exit before the JSON-RPC loop
    // ever starts. Spawned env merge is `{ ...process.env, ...ctx.env }`,
    // so writing an empty string here overrides the inherited value.
    KMAN_SELECTED_AGENT: '',
  };

  if (alreadyInstalled) {
    return { ...ctx, env };
  }

  const inv = mcpServerInvocation();
  const configPath = await ensureInjectionConfig({ kmanCommand: inv.command, kmanBaseArgs: inv.baseArgs });

  // copilot-cli's --additional-mcp-config treats a bare value as inline JSON
  // and only reads a file when the path is prefixed with `@`. claude-code's
  // --mcp-config takes the path directly.
  const configArg = flagSpec.pathPrefix ? `${flagSpec.pathPrefix}${configPath}` : configPath;

  return {
    ...ctx,
    // The MCP-config flag goes *before* user extra args so users can still
    // override or extend with their own flags downstream.
    extraArgs: [flagSpec.flag, configArg, ...ctx.extraArgs],
    env,
  };
}

interface McpConfigFlagSpec {
  /** The flag the backend accepts for adding an MCP config. */
  flag: string;
  /** Prefix required before the file path (e.g. `@` for copilot-cli). */
  pathPrefix?: string;
}

/**
 * Map a backend name to the flag it accepts for adding an MCP config
 * without going through plugin wrapping. Returns undefined for unknown
 * backends so we skip injection rather than break the launch.
 */
function mcpConfigFlagFor(backend: BackendName): McpConfigFlagSpec | undefined {
  switch (backend) {
    case 'claude-code':
      return { flag: '--mcp-config' };
    case 'copilot-cli':
      return { flag: '--additional-mcp-config', pathPrefix: '@' };
    default:
      return undefined;
  }
}

function appendChain(prior: string | undefined, name: string): string {
  if (!prior) return name;
  const parts = prior.split(',').filter(Boolean);
  if (parts[parts.length - 1] === name) return prior;
  return [...parts, name].join(',');
}
