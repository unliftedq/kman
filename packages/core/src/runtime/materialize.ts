import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { isAbsolute, dirname, join } from 'node:path';
import type { BackendName, Profile } from '@kman/types';
import { agentDir, agentSoulPath } from '../paths.js';
import { promptCommandFiles } from '../mcp-prompts/index.js';
import { KMAN_PLUGIN_NAME, runtimePluginDir, type PluginLayout } from './paths.js';

/**
 * Component directories that, when present in the agent directory, are exposed
 * inside the materialized plugin via a symlink (copy fallback). These are the
 * Claude Code / Copilot plugin component roots the backends understand.
 */
const LINKED_DIRS = ['skills', 'hooks', 'scripts', 'bin', 'commands'] as const;

/**
 * Component files exposed in the materialized plugin the same way as
 * {@link LINKED_DIRS}. The source name (in the agent dir) may differ from the
 * destination name (in the plugin): the agent keeps a plain `mcp.json`, but the
 * backends expect the dotfile `.mcp.json`, so it is mapped on materialization.
 *
 * `legacyFrom` names an older source filename kept for backward compatibility:
 * agents scaffolded by earlier versions stored their MCP config directly as
 * `.mcp.json`, so it is used as a fallback when the current `mcp.json` is
 * absent.
 */
const LINKED_FILES = [{ from: 'mcp.json', legacyFrom: '.mcp.json', to: '.mcp.json' }] as const;

/**
 * Directory (inside the materialized plugin) that holds the kman workflow
 * commands generated from the shared prompt templates. Kept separate from the
 * agent's own `commands/` (which is symlinked through via {@link LINKED_DIRS})
 * so both can coexist; the copilot manifest references both paths.
 */
const KMAN_COMMANDS_DIR = 'kman-commands';

export interface MaterializedPlugin {
  /** Absolute path the backend points `--plugin-dir` at. */
  readonly pluginDir: string;
  /** Selector for the backend's `--agent` flag. */
  readonly pluginAgent: string;
}

/** Map a backend name to the plugin layout it consumes, if any. */
export function pluginLayoutForBackend(backend: BackendName): PluginLayout | undefined {
  switch (backend) {
    case 'claude-code':
      return 'claude';
    case 'copilot-cli':
      return 'copilot';
    default:
      return undefined;
  }
}

/**
 * Project an agent directory (which now holds only genuine agent data:
 * agent.toml, soul.md, skills/, hooks/, ...) into a complete, backend-native
 * plugin directory under ~/.kman/runtime/<name>/.{claude,copilot}.
 *
 * The plugin manifest and the contributed `agents/<name>.md` are generated
 * fresh; the user-owned component dirs and `mcp.json` (mapped to `.mcp.json`)
 * are symlinked back to the agent directory (copied where symlinks are
 * unavailable) so edits stay in sync without duplicating data.
 *
 * To stay safe against concurrent launches of the same agent/backend, the
 * plugin is built in full inside a unique staging directory and then swapped
 * into place with an atomic rename. A reader never observes a partially
 * rebuilt plugin: it sees either the previous complete plugin or the new one.
 * The from-scratch staging build also guarantees deletions in the agent dir
 * never linger as stale links.
 */
export async function materializeRuntimePlugin(
  profile: Profile,
  layout: PluginLayout,
): Promise<MaterializedPlugin> {
  const src = agentDir(profile.name);
  const pluginDir = runtimePluginDir(profile.name, layout);
  const staging = `${pluginDir}.staging-${process.pid}-${randomUUID()}`;

  try {
    await buildPlugin(staging, src, profile, layout);
    await swapIntoPlace(staging, pluginDir);
  } catch (err) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  return {
    pluginDir,
    pluginAgent: `${KMAN_PLUGIN_NAME}:${profile.name}`,
  };
}

/** Build a complete plugin tree under `pluginDir` (expected to be a staging dir). */
async function buildPlugin(
  pluginDir: string,
  src: string,
  profile: Profile,
  layout: PluginLayout,
): Promise<void> {
  await mkdir(pluginDir, { recursive: true });

  await writeManifest(pluginDir, src, profile, layout);

  // soul.md is plain markdown by default. On materialization kman injects the
  // YAML frontmatter each runtime needs into the contributed agent definition;
  // `name:` is what the backend registers the agent under. The materialized
  // plugin name is fixed to `kman`, so backends resolve the scoped selector as
  // `kman:<name>`.
  const soulFile = profile.soul.prompt_file;
  const soulPath = isAbsolute(soulFile) ? soulFile : agentSoulPath(profile.name, soulFile);
  await mkdir(join(pluginDir, 'agents'), { recursive: true });
  if (await pathExists(soulPath)) {
    await materializeAgentFile(soulPath, pluginDir, profile, layout);
  }

  for (const dir of LINKED_DIRS) {
    const from = join(src, dir);
    if (await pathExists(from)) {
      await linkOrCopy(from, join(pluginDir, dir), 'dir');
    }
  }
  for (const file of LINKED_FILES) {
    let from = join(src, file.from);
    if (!(await pathExists(from)) && file.legacyFrom) {
      const legacy = join(src, file.legacyFrom);
      if (await pathExists(legacy)) from = legacy;
    }
    if (await pathExists(from)) {
      await linkOrCopy(from, join(pluginDir, file.to), 'file');
    }
  }

  // copilot-cli does not surface MCP prompts, so render the shared workflow
  // prompt templates as plugin commands (e.g. `/list-agents`) instead. claude
  // already exposes the MCP prompts natively, so it needs none of this.
  if (layout === 'copilot') {
    await writePromptCommands(pluginDir);
  }
}

/** Materialize the shared prompt templates as copilot plugin command files. */
async function writePromptCommands(pluginDir: string): Promise<void> {
  const dir = join(pluginDir, KMAN_COMMANDS_DIR);
  await mkdir(dir, { recursive: true });
  for (const cmd of promptCommandFiles()) {
    await writeFile(join(dir, `${cmd.name}.md`), cmd.content, 'utf8');
  }
}


/**
 * Expose soul.md as the plugin's contributed agent definition.
 *
 * soul.md is plain markdown by default, so kman injects the YAML frontmatter
 * each runtime requires (regenerating the file from scratch on every launch, so
 * edits to the soul are still picked up next time):
 *  - both backends need `name:` to register/resolve the agent. It is forced to
 *    the profile name so the `kman:<name>` selector always resolves, regardless
 *    of any stale `name:` a user may have hand-written into the soul.
 *  - claude-code registers `agents/<name>.md`.
 *  - copilot-cli only recognizes agent files named `<name>.agent.md` and
 *    silently drops any whose frontmatter lacks a `description:`, so a
 *    `description:` line is guaranteed for it.
 */
async function materializeAgentFile(
  soulPath: string,
  pluginDir: string,
  profile: Profile,
  layout: PluginLayout,
): Promise<void> {
  const agentsDir = join(pluginDir, 'agents');

  const raw = await readFile(soulPath, 'utf8');
  let content = ensureName(raw, profile);
  if (layout === 'copilot') content = ensureDescription(content, profile);

  const filename = layout === 'claude' ? `${profile.name}.md` : `${profile.name}.agent.md`;
  await writeFile(join(agentsDir, filename), content, 'utf8');
}

/**
 * Ensure the agent definition's YAML frontmatter carries a `name:` matching the
 * profile. Plain markdown (the default soul) gets a minimal frontmatter block
 * prepended; existing frontmatter has its `name:` rewritten (or inserted) so it
 * always agrees with the profile name the selector is keyed on.
 */
function ensureName(raw: string, profile: Profile): string {
  if (!raw.startsWith('---\n')) {
    return `---\nname: ${profile.name}\n---\n\n${raw}`;
  }

  const end = raw.indexOf('\n---', 4);
  if (end < 0) return raw; // malformed frontmatter — leave untouched.

  const frontmatter = raw.slice(0, end);
  if (/^name:\s*.*$/m.test(frontmatter)) {
    return raw.replace(/^name:\s*.*$/m, `name: ${profile.name}`);
  }
  return raw.replace(/^---\n/, `---\nname: ${profile.name}\n`);
}

/**
 * Ensure the soul's YAML frontmatter carries a `description:` (required by
 * copilot-cli). If one is already present the content is returned unchanged;
 * otherwise a description is inserted, sourced from the profile or derived from
 * the agent name. Content without frontmatter gets a minimal block prepended.
 */
function ensureDescription(raw: string, profile: Profile): string {
  const description = quoteYamlString(profile.description ?? `${profile.name} agent`);

  if (!raw.startsWith('---\n')) {
    return `---\nname: ${profile.name}\ndescription: ${description}\n---\n\n${raw}`;
  }

  const end = raw.indexOf('\n---', 4);
  if (end < 0) return raw; // malformed frontmatter — leave untouched.

  const frontmatter = raw.slice(0, end);
  const existingDescription = /^description:\s*(.*)$/m.exec(frontmatter);
  if (existingDescription) {
    const value = existingDescription[1] ?? '';
    if (isYamlQuotedOrBlockScalar(value)) return raw;
    return raw.replace(/^description:\s*(.*)$/m, (_line, value: string) => {
      return `description: ${quoteYamlString(value.trim())}`;
    });
  }

  return raw.replace(/^---\n/, `---\ndescription: ${description}\n`);
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}

function isYamlQuotedOrBlockScalar(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith('"') || trimmed.startsWith("'") || trimmed.startsWith('|') || trimmed.startsWith('>');
}

/**
 * Atomically replace `pluginDir` with the freshly built `staging` directory.
 * `rename` cannot clobber a non-empty directory, so any existing plugin is
 * first moved aside to a unique trash name (an atomic rename) and the staging
 * dir is renamed into the now-vacant slot. If a concurrent launch repopulates
 * the slot in between, the rename is retried. A reader therefore only ever
 * sees a complete plugin (or, for a sub-rename instant, nothing at all) and
 * never a half-built one.
 */
async function swapIntoPlace(staging: string, pluginDir: string): Promise<void> {
  await mkdir(dirname(pluginDir), { recursive: true });
  for (let attempt = 0; attempt < 100; attempt++) {
    const trash = `${pluginDir}.trash-${process.pid}-${randomUUID()}`;
    let movedAside = false;
    try {
      await rename(pluginDir, trash);
      movedAside = true;
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // Nothing currently occupies the slot.
      } else if (isRetriableSwapError(code)) {
        continue;
      } else {
        throw cause;
      }
    }
    try {
      await rename(staging, pluginDir);
    } catch (cause) {
      if (movedAside) await rm(trash, { recursive: true, force: true }).catch(() => {});
      // A concurrent launch slotted its own plugin in after we cleared the
      // slot. Retry: move the newcomer aside and try to claim it again.
      const code = (cause as NodeJS.ErrnoException).code;
      if (isRetriableSwapError(code)) continue;
      throw cause;
    }
    if (movedAside) await rm(trash, { recursive: true, force: true }).catch(() => {});
    return;
  }
  throw new Error(`materializeRuntimePlugin: could not swap ${staging} into ${pluginDir}`);
}

function isRetriableSwapError(code: string | undefined): boolean {
  return (
    code === 'ENOTEMPTY' ||
    code === 'EEXIST' ||
    (process.platform === 'win32' && code === 'EPERM')
  );
}

async function writeManifest(
  pluginDir: string,
  src: string,
  profile: Profile,
  layout: PluginLayout,
): Promise<void> {
  if (layout === 'claude') {
    const manifest: Record<string, unknown> = {
      name: KMAN_PLUGIN_NAME,
      agents: [`./agents/${profile.name}.md`],
    };
    if (profile.description) manifest['description'] = profile.description;
    await mkdir(join(pluginDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8',
    );
    return;
  }

  // Register both the kman-generated workflow commands and, when present, the
  // agent's own `commands/` directory (symlinked through separately).
  const commands = [`${KMAN_COMMANDS_DIR}/`];
  if (await pathExists(join(src, 'commands'))) commands.unshift('commands/');

  const manifest: Record<string, unknown> = {
    name: KMAN_PLUGIN_NAME,
    agents: 'agents/',
    commands,
  };
  if (profile.description) manifest['description'] = profile.description;
  await writeFile(join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

/**
 * Symlink `target` at `linkPath`, falling back to a recursive copy where the
 * platform/filesystem refuses symlinks (Windows without Developer Mode, some
 * network/overlay filesystems). Directory links use a junction on Windows so
 * no elevation is required.
 */
async function linkOrCopy(target: string, linkPath: string, kind: 'file' | 'dir'): Promise<void> {
  const type = kind === 'dir' ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file';
  try {
    await symlink(target, linkPath, type);
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code === 'EEXIST') return;
    await cp(target, linkPath, { recursive: kind === 'dir' });
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
