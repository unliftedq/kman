import type { Backend } from "@delego/types";
import claudeCodeBackend from "@delego/backend-claude-code";
import codexBackend from "@delego/backend-codex";
import copilotCliBackend from "@delego/backend-copilot-cli";
import geminiBackend from "@delego/backend-gemini";

const REGISTRY: Record<string, Backend> = {
  "claude-code": claudeCodeBackend,
  codex: codexBackend,
  "copilot-cli": copilotCliBackend,
  gemini: geminiBackend,
};

export function getBackend(name: string): Backend {
  const b = REGISTRY[name];
  if (!b) {
    const known = Object.keys(REGISTRY).join(", ");
    throw new Error(`Backend "${name}" is not registered. Available: ${known}`);
  }
  return b;
}

export function listBackends(): string[] {
  return Object.keys(REGISTRY);
}
