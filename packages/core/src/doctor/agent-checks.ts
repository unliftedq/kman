import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { agentDir, agentSkillsDir, agentSoulPath } from '../paths.js';
import { readProfile } from '../profile/index.js';
import { type Profile } from '@kman/types';
import { checkBackend, DEFAULT_BACKEND_PROBES, type BackendProbe } from './backend.js';
import type { Check } from './types.js';

const SHADOWING_DENYLIST: readonly string[] = [
  'git', 'node', 'npm', 'npx', 'bun', 'sh', 'bash', 'zsh', 'env',
  'rm', 'mv', 'cp', 'ls', 'cat', 'echo', 'kman', 'claude', 'copilot',
  'python', 'python3', 'pip', 'pip3',
];

const IS_WINDOWS = process.platform === 'win32';

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Check the agent profile is readable. Returns the profile on success. */
async function checkProfile(agent: string): Promise<{ checks: Check[]; profile: Profile | null }> {
  try {
    const profile = await readProfile(agent);
    return {
      profile,
      checks: [
        {
          id: 'profile.readable',
          label: 'agent.toml',
          severity: 'ok',
          message: `parsed (runtime=${profile.runtime.default}${profile.runtime.model ? `, model=${profile.runtime.model}` : ''}).`,
        },
      ],
    };
  } catch (err) {
    return {
      profile: null,
      checks: [
        {
          id: 'profile.readable',
          label: 'agent.toml',
          severity: 'error',
          message: (err as Error).message,
        },
      ],
    };
  }
}

async function checkSoul(profile: Profile): Promise<Check> {
  const file = profile.soul.prompt_file;
  const path = isAbsolute(file) ? file : agentSoulPath(profile.name, file);
  try {
    const s = await stat(path);
    if (!s.isFile()) {
      return { id: 'soul.file', label: 'soul prompt', severity: 'error', message: `${path} exists but is not a file.` };
    }
    if (s.size === 0) {
      return { id: 'soul.file', label: 'soul prompt', severity: 'warn', message: `${path} is empty.` };
    }
    return { id: 'soul.file', label: 'soul prompt', severity: 'ok', message: `${path} (${s.size} bytes).` };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      return {
        id: 'soul.file',
        label: 'soul prompt',
        severity: 'warn',
        message: `${path} missing; backend will run with no soul prompt.`,
      };
    }
    return { id: 'soul.file', label: 'soul prompt', severity: 'error', message: e.message };
  }
}

async function checkMcpJson(agent: string): Promise<Check[]> {
  const path = join(agentDir(agent), '.mcp.json');
  if (!(await pathExists(path))) {
    return [
      {
        id: 'mcp.present',
        label: '.mcp.json',
        severity: 'info',
        message: 'not present; MCP servers disabled for this agent.',
      },
    ];
  }
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    return [{ id: 'mcp.readable', label: '.mcp.json', severity: 'error', message: (err as Error).message }];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return [
      {
        id: 'mcp.json',
        label: '.mcp.json',
        severity: 'error',
        message: `invalid JSON: ${(err as Error).message}`,
        detail: `Edit ${path} and ensure it is valid JSON.`,
      },
    ];
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return [{ id: 'mcp.shape', label: '.mcp.json', severity: 'error', message: 'top-level value must be an object.' }];
  }
  const servers = (parsed as Record<string, unknown>)['mcpServers'];
  const checks: Check[] = [];
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) {
    checks.push({
      id: 'mcp.shape',
      label: '.mcp.json',
      severity: 'error',
      message: 'missing "mcpServers" object.',
    });
    return checks;
  }
  const entries = Object.entries(servers as Record<string, unknown>);
  if (entries.length === 0) {
    checks.push({ id: 'mcp.servers', label: '.mcp.json', severity: 'info', message: 'no MCP servers configured.' });
    return checks;
  }

  let errors = 0;
  for (const [name, value] of entries) {
    if (typeof value !== 'object' || value === null) {
      checks.push({
        id: `mcp.server.${name}.shape`,
        label: `mcpServers.${name}`,
        severity: 'error',
        message: 'entry must be an object.',
      });
      errors++;
      continue;
    }
    const cmd = (value as Record<string, unknown>)['command'];
    if (typeof cmd !== 'string' || cmd.length === 0) {
      checks.push({
        id: `mcp.server.${name}.command`,
        label: `mcpServers.${name}`,
        severity: 'error',
        message: '"command" must be a non-empty string.',
      });
      errors++;
    }
  }
  checks.unshift({
    id: 'mcp.servers',
    label: '.mcp.json',
    severity: errors > 0 ? 'error' : 'ok',
    message: `${entries.length} server(s) declared${errors > 0 ? `, ${errors} invalid` : ''}.`,
  });
  return checks;
}

interface HookCommand {
  matcher?: string;
  command: string;
}

function* iterHookCommands(parsed: unknown): Generator<HookCommand> {
  if (typeof parsed !== 'object' || parsed === null) return;
  const events = (parsed as Record<string, unknown>)['hooks'];
  if (typeof events !== 'object' || events === null) return;
  for (const eventList of Object.values(events as Record<string, unknown>)) {
    if (!Array.isArray(eventList)) continue;
    for (const group of eventList) {
      if (typeof group !== 'object' || group === null) continue;
      const matcher =
        typeof (group as Record<string, unknown>)['matcher'] === 'string'
          ? ((group as Record<string, unknown>)['matcher'] as string)
          : undefined;
      const hooks = (group as Record<string, unknown>)['hooks'];
      if (!Array.isArray(hooks)) continue;
      for (const h of hooks) {
        if (typeof h !== 'object' || h === null) continue;
        const command = (h as Record<string, unknown>)['command'];
        if (typeof command === 'string' && command.length > 0) {
          yield matcher === undefined ? { command } : { matcher, command };
        }
      }
    }
  }
}

/**
 * Pull the first script path out of a hook `command` string. We look for the
 * literal `${CLAUDE_PLUGIN_ROOT}` (with or without braces) and return whatever
 * path follows, stripped of leading slashes and quotes. Returns null if no
 * substitution is present.
 */
function extractPluginScript(command: string): string | null {
  const trimmed = command.trim();
  // Match `${CLAUDE_PLUGIN_ROOT}` (braces) or `$CLAUDE_PLUGIN_ROOT` (no braces),
  // optionally followed by a closing quote/backtick, then capture the path
  // portion up to the first whitespace, quote, or shell separator.
  const m = trimmed.match(/(?:\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT)(["'`]?)([^\s"';|&<>]*)/);
  if (!m) return null;
  let rest = m[2] ?? '';
  // Drop one leading separator so we return a relative-looking path.
  rest = rest.replace(/^[\\/]+/, '');
  return rest.length > 0 ? rest : null;
}

async function checkHooks(agent: string): Promise<Check[]> {
  const path = join(agentDir(agent), 'hooks', 'hooks.json');
  if (!(await pathExists(path))) {
    return [{ id: 'hooks.present', label: 'hooks/hooks.json', severity: 'info', message: 'not present.' }];
  }
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    return [{ id: 'hooks.readable', label: 'hooks/hooks.json', severity: 'error', message: (err as Error).message }];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return [
      {
        id: 'hooks.json',
        label: 'hooks/hooks.json',
        severity: 'error',
        message: `invalid JSON: ${(err as Error).message}`,
      },
    ];
  }

  const checks: Check[] = [];
  const dir = agentDir(agent);
  const commands = Array.from(iterHookCommands(parsed));

  if (commands.length === 0) {
    checks.push({
      id: 'hooks.entries',
      label: 'hooks/hooks.json',
      severity: 'info',
      message: 'no command hooks declared.',
    });
    return checks;
  }

  checks.push({
    id: 'hooks.entries',
    label: 'hooks/hooks.json',
    severity: 'ok',
    message: `${commands.length} command hook(s) declared.`,
  });

  for (const [idx, hook] of commands.entries()) {
    const rel = extractPluginScript(hook.command);
    const label = `hook[${idx}]${hook.matcher ? ` matcher=${hook.matcher}` : ''}`;
    if (!rel) {
      checks.push({
        id: `hooks.${idx}.script`,
        label,
        severity: 'info',
        message: `inline command (no ${'${CLAUDE_PLUGIN_ROOT}'} reference); skipped.`,
      });
      continue;
    }
    const scriptPath = resolve(dir, rel);
    try {
      const s = await stat(scriptPath);
      if (!s.isFile()) {
        checks.push({
          id: `hooks.${idx}.script`,
          label,
          severity: 'error',
          message: `${scriptPath} exists but is not a file.`,
        });
        continue;
      }
      if (IS_WINDOWS) {
        checks.push({
          id: `hooks.${idx}.script`,
          label,
          severity: 'ok',
          message: `${rel} present (executable bit not checked on Windows).`,
        });
        continue;
      }
      const executable = (s.mode & 0o111) !== 0;
      if (!executable) {
        checks.push({
          id: `hooks.${idx}.script`,
          label,
          severity: 'error',
          message: `${rel} is not executable.`,
          detail: `Run: chmod +x ${scriptPath}`,
        });
      } else {
        checks.push({ id: `hooks.${idx}.script`, label, severity: 'ok', message: `${rel} executable.` });
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      checks.push({
        id: `hooks.${idx}.script`,
        label,
        severity: 'error',
        message: e.code === 'ENOENT' ? `${rel} missing.` : e.message,
      });
    }
  }
  return checks;
}

async function checkBinShadowing(agent: string): Promise<Check[]> {
  const dir = join(agentDir(agent), 'bin');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      return [{ id: 'bin.present', label: 'bin/', severity: 'info', message: 'not present.' }];
    }
    return [{ id: 'bin.readable', label: 'bin/', severity: 'error', message: e.message }];
  }
  const files = entries.filter((e) => e.isFile() || e.isSymbolicLink()).map((e) => e.name);
  if (files.length === 0) {
    return [{ id: 'bin.entries', label: 'bin/', severity: 'info', message: 'empty.' }];
  }
  const stripExt = (n: string) => n.replace(/\.(sh|bat|cmd|exe|ps1)$/i, '');
  const shadowing = files.filter((f) => SHADOWING_DENYLIST.includes(stripExt(f)));
  const out: Check[] = [
    { id: 'bin.entries', label: 'bin/', severity: 'ok', message: `${files.length} entr${files.length === 1 ? 'y' : 'ies'}.` },
  ];
  if (shadowing.length > 0) {
    out.push({
      id: 'bin.shadowing',
      label: 'bin/ shadowing',
      severity: 'warn',
      message: `may shadow system commands: ${shadowing.join(', ')}.`,
      detail: 'Rename bin/ entries to use an agent-specific prefix (see DESIGN §4.5).',
    });
  }
  return out;
}

async function checkSkills(agent: string): Promise<Check[]> {
  const dir = agentSkillsDir(agent);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      return [{ id: 'skills.present', label: 'skills/', severity: 'info', message: 'not present.' }];
    }
    return [{ id: 'skills.readable', label: 'skills/', severity: 'error', message: e.message }];
  }
  const skills = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  return [
    {
      id: 'skills.count',
      label: 'skills/',
      severity: 'ok',
      message: skills.length === 0 ? 'no skills installed.' : `${skills.length} installed: ${skills.join(', ')}.`,
    },
  ];
}

/**
 * Run every agent-scoped check and return the section checks (excluding the
 * shared backend probe, which lives in the global section).
 */
export async function runAgentChecks(agent: string): Promise<Check[]> {
  const dir = agentDir(agent);
  if (!(await pathExists(dir))) {
    return [
      {
        id: 'agent.exists',
        label: 'agent directory',
        severity: 'error',
        message: `${dir} does not exist.`,
        detail: `Run: kman agent create ${agent}`,
      },
    ];
  }

  const out: Check[] = [];
  const { checks: profileChecks, profile } = await checkProfile(agent);
  out.push(...profileChecks);

  if (profile) {
    out.push(await checkSoul(profile));
  }

  out.push(...(await checkMcpJson(agent)));
  out.push(...(await checkHooks(agent)));
  out.push(...(await checkBinShadowing(agent)));
  out.push(...(await checkSkills(agent)));

  // Specifically confirm the agent's default backend is reachable, with a
  // dedicated row that references the agent's chosen runtime.
  if (profile) {
    const probe = DEFAULT_BACKEND_PROBES.find((p) => p.name === profile.runtime.default);
    if (!probe) {
      out.push({
        id: 'agent.backend.known',
        label: `runtime=${profile.runtime.default}`,
        severity: 'warn',
        message: `no built-in probe for backend "${profile.runtime.default}".`,
      });
    } else {
      const checks = await checkBackend(probe);
      // Re-id so they don't collide with the global backend section.
      for (const c of checks) {
        out.push({ ...c, id: `agent.${c.id}` });
      }
    }
  }
  return out;
}

export { DEFAULT_BACKEND_PROBES, type BackendProbe };
