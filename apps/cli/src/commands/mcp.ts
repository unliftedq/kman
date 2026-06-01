import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Command } from 'commander';
import { startMcpServer } from '@kman/mcp-server';
import { UserError } from '@kman/types';
import pkg from '../../package.json' with { type: 'json' };

/**
 * Canonical key the kman MCP server registers under, both via the install
 * path and via auto-injection. Anything that touches a host's `mcpServers`
 * map for kman MUST go through this constant so the two paths never disagree
 * on the name (and so they detect each other's presence to avoid duplicate
 * registration).
 */
export const SERVER_KEY = 'kman';

/**
 * The standard `mcpServers.<key>` value kman writes — same shape whether
 * the user opted in via `kman mcp install` or auto-injection materialized
 * it. The env block ships the placeholders the per-launch self-exclusion
 * mechanism needs; hosts that perform `${VAR}` substitution forward them
 * to the spawned server, and the server tolerates literals as "unset".
 */
export function kmanServerEntry(inv: KmanInvocation, extras: { copilotType?: boolean } = {}): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    command: inv.command,
    args: [...inv.baseArgs, 'mcp'],
    env: {
      KMAN_SELF_AGENT: '${KMAN_SELF_AGENT}',
      KMAN_RUN_CHAIN: '${KMAN_RUN_CHAIN}',
    },
  };
  if (extras.copilotType) entry['type'] = 'local';
  return entry;
}

/**
 * Read the user-scope config for a backend and report whether it already
 * registers the kman MCP server. Used by auto-injection to avoid writing a
 * second registration for the same key when the user opted in globally —
 * MCP hosts merge `--mcp-config` additively, and a duplicate key produces
 * undefined precedence (sometimes warnings, sometimes silent shadowing).
 *
 * Returns `false` on any read / parse error: better to inject (and risk a
 * benign collision the host will warn about) than to silently disable
 * delegation because we couldn't read a config file we don't own.
 */
export async function isKmanInstalledIn(backend: string): Promise<boolean> {
  let configPath: string;
  if (backend === 'claude-code' || backend === 'claude') {
    configPath = claudeUserConfigPath('user');
  } else if (backend === 'copilot-cli' || backend === 'copilot') {
    configPath = copilotConfigPath();
  } else {
    return false;
  }
  try {
    const parsed = await readJsonOrEmpty(configPath);
    const servers = parsed['mcpServers'];
    if (typeof servers !== 'object' || servers === null) return false;
    return Object.prototype.hasOwnProperty.call(servers, SERVER_KEY);
  } catch {
    return false;
  }
}

export function buildMcpCommand(): Command {
  const cmd = new Command('mcp').description(
    'Expose kman-managed agents to other agent runtimes over the Model Context Protocol.',
  );

  // Default: `kman mcp` (no subcommand) runs the stdio MCP server. This is
  // the command shape both `claude mcp add` and `copilot --mcp-config`
  // expect to spawn — keep it stable, do not nest behind a `serve` verb.
  cmd
    .option('--self <name>', 'Hide this agent from listings (used by kman during auto-injection).')
    .option(
      '--self-from-env',
      "Read the agent name to hide from the KMAN_SELF_AGENT env var. Used by the injected plugin so a single on-disk MCP config works for every agent.",
    )
    .option('--run-timeout <ms>', 'Per-tool-call timeout in milliseconds (default 600000, 0 disables).', (v) =>
      Number.parseInt(v, 10),
    )
    .action(async (opts: { self?: string; selfFromEnv?: boolean; runTimeout?: number }) => {
      // Do NOT call rejectAgent here. KMAN_SELECTED_AGENT can leak through
      // env inheritance when a parent kman process spawns claude.exe which
      // then spawns this kman as an MCP server. Rejecting in that path
      // kills the server before the JSON-RPC loop, which the host reports
      // as `-32000 Failed to reconnect` with no useful detail. mcp doesn't
      // care which agent the host belongs to anyway — `--self` /
      // `--self-from-env` carry that information.
      // If the MCP host didn't expand `${KMAN_SELF_AGENT}` (some hosts
      // skip variable substitution in the `env` block), the placeholder
      // arrives literal. Treat it as unset rather than poisoning the
      // selfAgent guard with a bogus value.
      const rawSelf = opts.selfFromEnv ? process.env['KMAN_SELF_AGENT'] : opts.self;
      const self = rawSelf && !rawSelf.includes('${') ? rawSelf : undefined;
      process.env['KMAN_VERSION'] = pkg.version;
      // Resolve how *this* process should re-invoke itself for `kman_run_agent`
      // subprocess calls. Same logic as `kman mcp config` advertises, so the
      // in-process runner and the externally-installed registration always
      // spawn kman the same way (KMAN_BIN wins, then bin-on-PATH, then
      // node/bun + script path).
      const inv = mcpServerInvocation();
      const server = startMcpServer({
        invocation: { command: inv.command, baseArgs: inv.baseArgs },
        ...(self ? { selfAgent: self } : {}),
        ...(opts.runTimeout !== undefined ? { runTimeoutMs: opts.runTimeout } : {}),
      });
      await server.done;
    });

  cmd
    .command('install <runtime>')
    .description(
      'Register the kman MCP server in an external runtime config (claude-code | copilot-cli).',
    )
    .option('--scope <scope>', 'user | project (claude-code only; default user).', 'user')
    .option('--force', 'Overwrite an existing "kman" entry if present.')
    .action(async (runtime: string, opts: { scope?: string; force?: boolean }) => {
      const invocation = mcpServerInvocation();
      if (runtime === 'claude-code' || runtime === 'claude') {
        await installClaudeCode(invocation, opts.scope === 'project' ? 'project' : 'user', opts.force === true);
      } else if (runtime === 'copilot-cli' || runtime === 'copilot') {
        await installCopilotCli(invocation, opts.force === true);
      } else {
        throw new UserError(`Unknown runtime "${runtime}". Use claude-code or copilot-cli.`);
      }
    });

  cmd
    .command('config')
    .description('Print a JSON snippet that registers the kman MCP server (paste into any MCP host).')
    .action(() => {
      const inv = mcpServerInvocation();
      const snippet = {
        mcpServers: {
          [SERVER_KEY]: kmanServerEntry(inv),
        },
      };
      process.stdout.write(JSON.stringify(snippet, null, 2) + '\n');
    });

  cmd
    .command('uninstall <runtime>')
    .description('Remove the kman MCP server from an external runtime config.')
    .option('--scope <scope>', 'user | project (claude-code only; default user).', 'user')
    .action(async (runtime: string, opts: { scope?: string }) => {
      if (runtime === 'claude-code' || runtime === 'claude') {
        await uninstallClaudeCode(opts.scope === 'project' ? 'project' : 'user');
      } else if (runtime === 'copilot-cli' || runtime === 'copilot') {
        await uninstallCopilotCli();
      } else {
        throw new UserError(`Unknown runtime "${runtime}". Use claude-code or copilot-cli.`);
      }
    });

  return cmd;
}

interface KmanInvocation {
  command: string;
  baseArgs: string[];
}

/**
 * Compute how an external runtime should re-invoke the kman CLI as an MCP
 * server. When kman runs from the published bin (`dist/main.js` with a
 * shebang), we can just call `kman` directly — but if the user installed
 * with bun, or is running from source via `bun apps/cli/src/main.ts`, we
 * need to preserve the node binary + script path, otherwise the spawned
 * MCP server cannot find itself.
 *
 * Override priority: KMAN_BIN env > "kman" on PATH (when this process was
 * launched from a bin entry) > absolute path back to the running script.
 */
export function mcpServerInvocation(): KmanInvocation {
  const override = process.env['KMAN_BIN'];
  if (override && override.length > 0) {
    return { command: override, baseArgs: [] };
  }
  const script = process.argv[1];
  // Heuristic: if argv[1] looks like a bundled `kman` bin (basename starts
  // with `kman` and has no `.ts` source), prefer the bare `kman` command —
  // it's more portable across machines than an absolute path inside the
  // current home dir.
  if (script && /[\\/]kman(\.(?:js|cjs|mjs))?$/.test(script) && !script.endsWith('.ts')) {
    return { command: 'kman', baseArgs: [] };
  }
  if (!script) {
    return { command: 'kman', baseArgs: [] };
  }
  return { command: process.execPath, baseArgs: [resolve(script)] };
}

async function installClaudeCode(inv: KmanInvocation, scope: 'user' | 'project', force: boolean): Promise<void> {
  const configPath = claudeUserConfigPath(scope);
  const parsed = await readJsonOrEmpty(configPath);
  const servers = ((parsed['mcpServers'] as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  if (servers[SERVER_KEY] && !force) {
    throw new UserError(
      `Claude Code config already has an MCP server named "${SERVER_KEY}". Re-run with --force to overwrite.`,
    );
  }
  servers[SERVER_KEY] = kmanServerEntry(inv);
  parsed['mcpServers'] = servers;
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  process.stdout.write(`Registered "${SERVER_KEY}" MCP server in ${configPath}\n`);
}

async function uninstallClaudeCode(scope: 'user' | 'project'): Promise<void> {
  const configPath = claudeUserConfigPath(scope);
  const parsed = await readJsonOrEmpty(configPath);
  const servers = (parsed['mcpServers'] as Record<string, unknown> | undefined) ?? {};
  if (!servers[SERVER_KEY]) {
    process.stdout.write(`No "${SERVER_KEY}" entry in ${configPath}.\n`);
    return;
  }
  delete servers[SERVER_KEY];
  parsed['mcpServers'] = servers;
  await writeFile(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  process.stdout.write(`Removed "${SERVER_KEY}" from ${configPath}\n`);
}

async function installCopilotCli(inv: KmanInvocation, force: boolean): Promise<void> {
  const configPath = copilotConfigPath();
  const parsed = await readJsonOrEmpty(configPath);
  const servers = ((parsed['mcpServers'] as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  if (servers[SERVER_KEY] && !force) {
    throw new UserError(
      `Copilot CLI config already has an MCP server named "${SERVER_KEY}". Re-run with --force to overwrite.`,
    );
  }
  servers[SERVER_KEY] = kmanServerEntry(inv, { copilotType: true });
  parsed['mcpServers'] = servers;
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  process.stdout.write(`Registered "${SERVER_KEY}" MCP server in ${configPath}\n`);
}

async function uninstallCopilotCli(): Promise<void> {
  const configPath = copilotConfigPath();
  const parsed = await readJsonOrEmpty(configPath);
  const servers = (parsed['mcpServers'] as Record<string, unknown> | undefined) ?? {};
  if (!servers[SERVER_KEY]) {
    process.stdout.write(`No "${SERVER_KEY}" entry in ${configPath}.\n`);
    return;
  }
  delete servers[SERVER_KEY];
  parsed['mcpServers'] = servers;
  await writeFile(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  process.stdout.write(`Removed "${SERVER_KEY}" from ${configPath}\n`);
}

/**
 * Resolve the user's home directory, preferring the `HOME` / `USERPROFILE`
 * env vars over `os.homedir()`. Node's `homedir()` re-reads `HOME` on every
 * call, but Bun caches it at process start, so tests that redirect HOME at
 * runtime are otherwise ignored. Reading the env first keeps both runtimes
 * (and the tests that patch these vars) consistent.
 */
function userHome(): string {
  return process.env['HOME'] ?? process.env['USERPROFILE'] ?? homedir();
}

/**
 * Path Claude Code reads for user-scope MCP servers. The CLI also accepts
 * a project-local `.claude.json` in `cwd` for project scope.
 */
function claudeUserConfigPath(scope: 'user' | 'project'): string {
  if (scope === 'project') return resolve(process.cwd(), '.claude.json');
  return join(userHome(), '.claude.json');
}

function copilotConfigPath(): string {
  // Copilot CLI stores user-level MCP servers in `mcp-config.json` inside its
  // config directory, which defaults to `~/.copilot` (i.e. `$HOME/.copilot`)
  // on every platform and can be relocated via the COPILOT_HOME env var.
  // See https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
  const base = process.env['COPILOT_HOME'] ?? join(userHome(), '.copilot');
  return join(base, 'mcp-config.json');
}

async function readJsonOrEmpty(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, 'utf8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new UserError(`${path} is not a JSON object — refusing to edit.`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    if (err instanceof UserError) throw err;
    if (err instanceof SyntaxError) {
      throw new UserError(`${path} contains invalid JSON — refusing to edit: ${err.message}`);
    }
    throw err;
  }
}
