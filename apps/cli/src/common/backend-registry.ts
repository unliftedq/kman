import { createClaudeCodeBackend } from '@delego/backend-claude-code';
import { createCopilotCliBackend } from '@delego/backend-copilot-cli';
import { UserError, type Backend, type BackendName } from '@delego/types';

const BACKENDS: Record<string, () => Backend> = {
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
