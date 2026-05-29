import { join } from 'node:path';
import { kmanHome } from '../paths.js';

/**
 * Plugin name every materialized runtime plugin declares. Fixed to `kman`
 * (rather than the agent name) so the backend selector is always
 * `kman:<agent>` and the on-disk manifest shape is stable across agents.
 */
export const KMAN_PLUGIN_NAME = 'kman';

/**
 * Which native plugin layout a backend consumes. `claude` keeps its manifest
 * under `.claude-plugin/plugin.json`; `copilot` keeps it at the plugin root
 * as `plugin.json`. Both share the same component layout otherwise.
 */
export type PluginLayout = 'claude' | 'copilot';

/** Root of kman's derived, ephemeral runtime state (§4). */
export function runtimeRoot(): string {
  return join(kmanHome(), 'runtime');
}

/** Per-agent runtime directory: ~/.kman/runtime/<name>. */
export function runtimeAgentRoot(name: string): string {
  return join(runtimeRoot(), name);
}

/**
 * The materialized plugin directory a backend points `--plugin-dir` at:
 *   ~/.kman/runtime/<name>/.claude   (claude-code)
 *   ~/.kman/runtime/<name>/.copilot  (copilot-cli)
 */
export function runtimePluginDir(name: string, layout: PluginLayout): string {
  return join(runtimeAgentRoot(name), layout === 'claude' ? '.claude' : '.copilot');
}
