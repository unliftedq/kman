import { cp, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
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
 * in sync without duplicating data. The directory is rebuilt from scratch on
 * every call so deletions in the agent dir never linger as stale links.
 */
export async function materializeRuntimePlugin(
  profile: Profile,
  layout: PluginLayout,
): Promise<MaterializedPlugin> {
  const src = agentDir(profile.name);
  const pluginDir = runtimePluginDir(profile.name, layout);

  await rm(pluginDir, { recursive: true, force: true });
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

  return { pluginDir, pluginAgent: `${KMAN_PLUGIN_NAME}:${profile.name}` };
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
