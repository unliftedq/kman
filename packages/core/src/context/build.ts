import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  type AgentContext,
  type ContextOverrides,
  type Profile,
  UserError,
} from '@delego/types';
import { agentDir, agentSoulPath } from '../paths.js';

/**
 * Build an immutable AgentContext (§3.2) from profile + CLI overrides.
 * Soul prompt is read from disk; everything else is computed.
 */
export async function buildContext(
  profile: Profile,
  overrides: ContextOverrides = {},
): Promise<AgentContext> {
  const dir = agentDir(profile.name);

  const soulPath = isAbsolute(profile.soul.prompt_file)
    ? profile.soul.prompt_file
    : join(dir, profile.soul.prompt_file);

  let soul = '';
  try {
    soul = await readFile(soulPath, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      // Permit missing soul file; fall back to empty string. Backend layer decides whether
      // that's acceptable based on `supportsAppendSystemPrompt`.
      soul = '';
    } else {
      throw new UserError(
        `Failed to read soul prompt at ${soulPath}: ${(cause as Error).message}`,
        { cause },
      );
    }
  }

  const backend = overrides.backend ?? profile.runtime.default;
  const backendOverride = profile.runtimeOverrides[backend] ?? {};
  const model = overrides.model ?? backendOverride.model ?? profile.runtime.model;
  const permission = overrides.permission ?? profile.defaults.permission_mode ?? 'ask';
  const outputFormat =
    overrides.outputFormat ?? (overrides.stream ? 'stream-json' : profile.defaults.output_format ?? 'text');
  const stream = overrides.stream === true || outputFormat === 'stream-json';

  const extraArgs: string[] = [
    ...(backendOverride.extra_args ?? []),
    ...(overrides.runtimeFlags ?? []),
  ];

  const env: Record<string, string> = { ...overrides.env };

  const ctx: AgentContext = {
    profile,
    agentDir: dir,
    soulPrompt: soul,
    backend,
    ...(model !== undefined ? { model } : {}),
    permission,
    outputFormat,
    ...(profile.defaults.max_turns !== undefined ? { maxTurns: profile.defaults.max_turns } : {}),
    cwd: overrides.cwd ?? process.cwd(),
    extraArgs,
    ...(backendOverride.permission_mode_raw !== undefined
      ? { permissionModeRaw: backendOverride.permission_mode_raw }
      : {}),
    env,
    ...(overrides.task !== undefined ? { task: overrides.task } : {}),
    stream,
  };

  return ctx;
}
