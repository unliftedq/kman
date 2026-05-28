import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { kmanHome } from '@kman/core';

/**
 * Path to the synthetic "plugin" we hand to the backend's `--plugin-dir` so
 * the spawned agent picks up the kman MCP server alongside its own plugin.
 *
 * It lives outside `~/.kman/agents/` so it's never mistaken for an agent.
 */
export function kmanMcpPluginDir(): string {
  return join(kmanHome(), 'runtime', 'mcp-injection');
}

export interface InjectionPluginOptions {
  /** Command to invoke kman from inside the spawned backend. */
  kmanCommand: string;
  /** Extra args to prepend before `mcp` (e.g. the bundled script path in dev). */
  kmanBaseArgs?: readonly string[];
}

/**
 * Materialize the injection plugin on disk if it doesn't exist or is out of
 * date. Returns the directory path so the launcher can pass it to the
 * backend via `--plugin-dir`. The directory is reused across runs — the
 * per-agent self-exclusion is delivered via the `KMAN_SELF_AGENT` env var,
 * not by rewriting the plugin every spawn.
 */
export async function ensureInjectionPlugin(opts: InjectionPluginOptions): Promise<string> {
  const dir = kmanMcpPluginDir();
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, '.claude-plugin'), { recursive: true });

  const args = [...(opts.kmanBaseArgs ?? []), 'mcp', '--self-from-env'];
  // Most MCP hosts (Claude Code, Copilot CLI) do NOT inherit arbitrary
  // parent env into spawned MCP servers — they forward only the keys
  // explicitly listed in this block. Anything the server depends on must
  // be enumerated here. `${VAR}` substitution happens at spawn time
  // against the host's own env (claude.exe's env), which the launcher
  // populates via attachKmanMcp. Unsubstituted literals (`${...}`) are
  // tolerated by `--self-from-env` and the cycle-chain parser.
  const mcpConfig = {
    mcpServers: {
      kman: {
        command: opts.kmanCommand,
        args,
        env: {
          KMAN_SELF_AGENT: '${KMAN_SELF_AGENT}',
          KMAN_RUN_CHAIN: '${KMAN_RUN_CHAIN}',
        },
      },
    },
  };

  const pluginManifest = {
    name: 'kman-mcp',
    description: 'kman-managed peer agents exposed via MCP. Injected automatically by `kman run/chat`.',
  };

  await writeIfChanged(join(dir, '.mcp.json'), JSON.stringify(mcpConfig, null, 2) + '\n');
  await writeIfChanged(join(dir, 'plugin.json'), JSON.stringify(pluginManifest, null, 2) + '\n');
  await writeIfChanged(
    join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify(pluginManifest, null, 2) + '\n',
  );

  return dir;
}

async function writeIfChanged(path: string, contents: string): Promise<void> {
  try {
    const existing = await readFile(path, 'utf8');
    if (existing === contents) return;
  } catch {
    // file missing — fall through to write
  }
  await writeFile(path, contents, 'utf8');
}
