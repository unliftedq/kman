import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { kmanHome } from '@kman/core';

/**
 * Path to the standalone MCP config the launcher hands to the backend via
 * its native flag (`--mcp-config` for claude-code, `--additional-mcp-config`
 * for copilot-cli). One file, no plugin wrapper — so the host registers
 * the server with its normal namespace (`mcp__kman__<tool>`) instead of the
 * longer plugin-scoped form.
 */
export function kmanMcpConfigPath(): string {
  return join(kmanHome(), 'runtime', 'mcp-config.json');
}

export interface InjectionConfigOptions {
  /** Command to invoke kman from inside the spawned backend. */
  kmanCommand: string;
  /** Extra args to prepend before `mcp` (e.g. the bundled script path in dev). */
  kmanBaseArgs?: readonly string[];
}

/**
 * Materialize the standalone MCP config on disk if missing or stale. Returns
 * the file path so the launcher can pass it to the backend's MCP-config flag.
 * Per-launch self-exclusion is delivered via the `KMAN_SELF_AGENT` env var,
 * substituted into this config at spawn time — the file itself is shared
 * across every agent and never needs to be rewritten per launch.
 */
export async function ensureInjectionConfig(opts: InjectionConfigOptions): Promise<string> {
  const path = kmanMcpConfigPath();
  await mkdir(dirname(path), { recursive: true });

  const args = [...(opts.kmanBaseArgs ?? []), 'mcp', '--self-from-env'];
  // `${VAR}` is the standard substitution syntax both supported backends
  // honor in `mcpServers.<key>.env`. Server-side `--self-from-env` treats an
  // unsubstituted literal (`${...}`) as unset, so the worst-case behavior on a
  // host that skips substitution is "no self-exclusion" rather than a crash.
  const mcpConfig = {
    mcpServers: {
      kman: {
        command: opts.kmanCommand,
        args,
        env: {
          KMAN_SELF_AGENT: '${KMAN_SELF_AGENT}',
          KMAN_TASK_ID: '${KMAN_TASK_ID}',
        },
      },
    },
  };

  await writeIfChanged(path, JSON.stringify(mcpConfig, null, 2) + '\n');
  return path;
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
