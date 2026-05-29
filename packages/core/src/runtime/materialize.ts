import { randomUUID } from 'node:crypto';
import { cp, mkdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { isAbsolute, dirname, join } from 'node:path';
import type { BackendName, Profile } from '@kman/types';
import { agentDir, agentSoulPath } from '../paths.js';
import { KMAN_PLUGIN_NAME, runtimePluginDir, type PluginLayout } from './paths.js';

/**
 * Component directories that, when present in the agent directory, are exposed
 * inside the materialized plugin via a symlink (copy fallback). These are the
 * Claude Code / Copilot plugin component roots the backends understand.
 */
const LINKED_DIRS = ['skills', 'hooks', 'scripts', 'bin', 'commands'] as const;

/** Component files mapped the same way as {@link LINKED_DIRS}. */
const LINKED_FILES = ['.mcp.json'] as const;

export interface MaterializedPlugin {
  /** Absolute path the backend points `--plugin-dir` at. */
  readonly pluginDir: string;
  /** `<plugin>:<agent>` selector for the backend's `--agent` flag. */
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
 * fresh; the user-owned component dirs and `.mcp.json` are symlinked back to
 * the agent directory (copied where symlinks are unavailable) so edits stay
 * in sync without duplicating data.
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

  return { pluginDir, pluginAgent: `${KMAN_PLUGIN_NAME}:${profile.name}` };
}

/** Build a complete plugin tree under `pluginDir` (expected to be a staging dir). */
async function buildPlugin(
  pluginDir: string,
  src: string,
  profile: Profile,
  layout: PluginLayout,
): Promise<void> {
  await mkdir(pluginDir, { recursive: true });

  await writeManifest(pluginDir, profile, layout);

  // soul.md doubles as the plugin-contributed agent definition. Its YAML
  // frontmatter `name:` is what the backend registers the agent under, so the
  // selector resolves to `kman:<name>`.
  const soulFile = profile.soul.prompt_file;
  const soulPath = isAbsolute(soulFile) ? soulFile : agentSoulPath(profile.name, soulFile);
  await mkdir(join(pluginDir, 'agents'), { recursive: true });
  if (await pathExists(soulPath)) {
    await linkOrCopy(soulPath, join(pluginDir, 'agents', `${profile.name}.md`), 'file');
  }

  for (const dir of LINKED_DIRS) {
    const from = join(src, dir);
    if (await pathExists(from)) {
      await linkOrCopy(from, join(pluginDir, dir), 'dir');
    }
  }
  for (const file of LINKED_FILES) {
    const from = join(src, file);
    if (await pathExists(from)) {
      await linkOrCopy(from, join(pluginDir, file), 'file');
    }
  }
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
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    }
    try {
      await rename(staging, pluginDir);
    } catch (cause) {
      if (movedAside) await rm(trash, { recursive: true, force: true }).catch(() => {});
      // A concurrent launch slotted its own plugin in after we cleared the
      // slot. Retry: move the newcomer aside and try to claim it again.
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === 'ENOTEMPTY' || code === 'EEXIST') continue;
      throw cause;
    }
    if (movedAside) await rm(trash, { recursive: true, force: true }).catch(() => {});
    return;
  }
  throw new Error(`materializeRuntimePlugin: could not swap ${staging} into ${pluginDir}`);
}

async function writeManifest(
  pluginDir: string,
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

  const manifest: Record<string, unknown> = { name: KMAN_PLUGIN_NAME, agents: 'agents/' };
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
