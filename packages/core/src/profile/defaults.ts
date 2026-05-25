import type { Profile, BackendName } from "@delego/types";

export const DEFAULT_MEMORY_CHAR_LIMIT = 2200;
export const DEFAULT_MAX_TURNS = 50;

export function defaultProfile(name: string, runtime: BackendName = "claude-code", model?: string): Profile {
  return {
    name,
    description: undefined,
    runtime: {
      default: runtime,
      ...(model ? { model } : {}),
    },
    soul: { prompt_file: "soul.md" },
    memory: {
      enabled: true,
      char_limit: DEFAULT_MEMORY_CHAR_LIMIT,
      provider: "",
    },
    skills: { enabled: [] },
    tools: {},
    hooks: {},
    defaults: {
      max_turns: DEFAULT_MAX_TURNS,
      permission_mode: "ask",
      output_format: "text",
    },
    runtimeOverrides: {},
  };
}
