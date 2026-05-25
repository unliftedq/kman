import type { Backend } from "@delego/types";
import claudeCodeBackend from "@delego/backend-claude-code";

const REGISTRY: Record<string, Backend> = {
  "claude-code": claudeCodeBackend,
  // M4: codex, copilot-cli, gemini
};

export function getBackend(name: string): Backend {
  const b = REGISTRY[name];
  if (!b) {
    const known = Object.keys(REGISTRY).join(", ");
    throw new Error(`Backend "${name}" is not registered yet. Available: ${known}`);
  }
  return b;
}

export function listBackends(): string[] {
  return Object.keys(REGISTRY);
}
