import { createClaudeCodeBackend } from '@kman/backend-claude-code';
import { createCopilotCliBackend } from '@kman/backend-copilot-cli';
import { createPiBackend } from '@kman/backend-pi';
import { UserError, type Backend, type BackendName } from '@kman/types';

const BACKENDS: Record<string, () => Backend> = {
  pi: createPiBackend,
  'claude-code': createClaudeCodeBackend,
  'copilot-cli': createCopilotCliBackend,
};

export function resolveBackend(name: BackendName): Backend {
  const factory = BACKENDS[name];
  if (!factory) {
    throw new UserError(
      `Unknown backend "${name}". Built-in backends: ${Object.keys(BACKENDS).join(', ')}.`,
    );
  }
  return factory();
}

export function listBackends(): string[] {
  return Object.keys(BACKENDS);
}
