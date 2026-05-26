import TOML from "@iarna/toml";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  Profile,
  HookEntry,
  ToolEntry,
  ToolsConfig,
  RuntimeOverride,
  BackendName,
  PermissionMode,
  OutputFormat,
} from "@delego/types";
import { DEFAULT_MAX_TURNS, DEFAULT_MEMORY_CHAR_LIMIT } from "./defaults";

const KNOWN_RUNTIME_FIELDS = new Set(["default", "model"]);

/**
 * Parse a profile TOML string into a fully defaulted Profile.
 * Unknown keys are ignored; missing required keys fall back to defaults.
 */
export function parseProfile(toml: string, fallbackName: string): Profile {
  const raw = TOML.parse(toml) as Record<string, unknown>;

  const runtimeRaw = (raw.runtime ?? {}) as Record<string, unknown>;
  const runtime = {
    default: ((runtimeRaw.default as BackendName) ?? "claude-code") as BackendName,
    ...(typeof runtimeRaw.model === "string" ? { model: runtimeRaw.model } : {}),
  };

  // Anything under [runtime.<name>] other than KNOWN_RUNTIME_FIELDS becomes an override.
  const runtimeOverrides: Partial<Record<BackendName, RuntimeOverride>> = {};
  for (const [key, value] of Object.entries(runtimeRaw)) {
    if (KNOWN_RUNTIME_FIELDS.has(key)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const ov = value as Record<string, unknown>;
      runtimeOverrides[key as BackendName] = {
        ...(typeof ov.permission_mode_raw === "string"
          ? { permission_mode_raw: ov.permission_mode_raw }
          : {}),
        ...(Array.isArray(ov.extra_args)
          ? { extra_args: (ov.extra_args as unknown[]).filter((s): s is string => typeof s === "string") }
          : {}),
      };
    }
  }

  const soulRaw = (raw.soul ?? {}) as Record<string, unknown>;
  const soul = {
    prompt_file: typeof soulRaw.prompt_file === "string" ? soulRaw.prompt_file : "soul.md",
  };

  const memoryRaw = (raw.memory ?? {}) as Record<string, unknown>;
  const memory = {
    enabled: typeof memoryRaw.enabled === "boolean" ? memoryRaw.enabled : true,
    char_limit:
      typeof memoryRaw.char_limit === "number" ? memoryRaw.char_limit : DEFAULT_MEMORY_CHAR_LIMIT,
    provider: typeof memoryRaw.provider === "string" ? memoryRaw.provider : "",
  };

  const toolsRaw = (raw.tools ?? {}) as Record<string, unknown>;
  const tools: ToolsConfig = {};
  for (const [k, v] of Object.entries(toolsRaw)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const t = v as Record<string, unknown>;
    if (t.type === "mcp" && typeof t.server === "string") {
      const entry: ToolEntry = {
        type: "mcp",
        server: t.server,
        ...(Array.isArray(t.include)
          ? { include: (t.include as unknown[]).filter((s): s is string => typeof s === "string") }
          : {}),
      };
      tools[k] = entry;
    } else if (t.type === "shell" && typeof t.cmd === "string") {
      tools[k] = { type: "shell", cmd: t.cmd };
    } else if (t.type === "http" && typeof t.url === "string") {
      tools[k] = {
        type: "http",
        url: t.url,
        ...(typeof t.method === "string" ? { method: t.method } : {}),
      };
    }
  }

  const hooksRaw = (raw.hooks ?? {}) as Record<string, unknown>;
  const hooks = {
    ...parseHookArray(hooksRaw.pre_run, "pre_run"),
    ...parseHookArray(hooksRaw.post_run, "post_run"),
    ...parseHookArray(hooksRaw.on_error, "on_error"),
    ...parseHookArray(hooksRaw.pre_memory_write, "pre_memory_write"),
  };

  const defaultsRaw = (raw.defaults ?? {}) as Record<string, unknown>;
  const defaults = {
    max_turns: typeof defaultsRaw.max_turns === "number" ? defaultsRaw.max_turns : DEFAULT_MAX_TURNS,
    permission_mode: (typeof defaultsRaw.permission_mode === "string"
      ? defaultsRaw.permission_mode
      : "ask") as PermissionMode,
    output_format: (typeof defaultsRaw.output_format === "string"
      ? defaultsRaw.output_format
      : "text") as OutputFormat,
  };

  return {
    name: typeof raw.name === "string" ? raw.name : fallbackName,
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    runtime,
    soul,
    memory,
    tools,
    hooks,
    defaults,
    runtimeOverrides,
  };
}

function parseHookArray(value: unknown, key: "pre_run" | "post_run" | "on_error" | "pre_memory_write") {
  if (!Array.isArray(value)) return {};
  const entries: HookEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const h = item as Record<string, unknown>;
    const e: HookEntry = {};
    if (typeof h.command === "string") e.command = h.command;
    if (typeof h.script === "string") e.script = h.script;
    if (typeof h.on_success_only === "boolean") e.on_success_only = h.on_success_only;
    if (e.command || e.script) entries.push(e);
  }
  return entries.length > 0 ? { [key]: entries } : {};
}

/**
 * Render a Profile back to TOML.
 * The output is intentionally hand-shaped for readability — `@iarna/toml`'s
 * stringify produces correct but ugly output for our shape.
 */
export function stringifyProfile(p: Profile): string {
  const lines: string[] = [];
  lines.push(`name        = ${JSON.stringify(p.name)}`);
  if (p.description) lines.push(`description = ${JSON.stringify(p.description)}`);
  lines.push("");

  lines.push("[runtime]");
  lines.push(`default = ${JSON.stringify(p.runtime.default)}`);
  if (p.runtime.model) lines.push(`model   = ${JSON.stringify(p.runtime.model)}`);
  lines.push("");

  lines.push("[soul]");
  lines.push(`prompt_file = ${JSON.stringify(p.soul.prompt_file)}`);
  lines.push("");

  lines.push("[memory]");
  lines.push(`enabled    = ${p.memory.enabled}`);
  lines.push(`char_limit = ${p.memory.char_limit}`);
  lines.push(`provider   = ${JSON.stringify(p.memory.provider)}`);
  lines.push("");

  if (Object.keys(p.tools).length > 0) {
    lines.push("[tools]");
    for (const [k, v] of Object.entries(p.tools)) {
      lines.push(`${k} = ${JSON.stringify(v)}`);
    }
    lines.push("");
  }

  const hookKeys: (keyof typeof p.hooks)[] = ["pre_run", "post_run", "on_error", "pre_memory_write"];
  const hasHooks = hookKeys.some((k) => p.hooks[k] && p.hooks[k]!.length > 0);
  if (hasHooks) {
    lines.push("[hooks]");
    for (const key of hookKeys) {
      const arr = p.hooks[key];
      if (arr && arr.length > 0) {
        lines.push(`${key} = ${JSON.stringify(arr)}`);
      }
    }
    lines.push("");
  }

  lines.push("[defaults]");
  lines.push(`max_turns       = ${p.defaults.max_turns}`);
  lines.push(`permission_mode = ${JSON.stringify(p.defaults.permission_mode)}`);
  lines.push(`output_format   = ${JSON.stringify(p.defaults.output_format)}`);

  for (const [name, ov] of Object.entries(p.runtimeOverrides)) {
    if (!ov) continue;
    lines.push("");
    lines.push(`[runtime.${name}]`);
    if (ov.permission_mode_raw) {
      lines.push(`permission_mode_raw = ${JSON.stringify(ov.permission_mode_raw)}`);
    }
    if (ov.extra_args) {
      lines.push(`extra_args = ${JSON.stringify(ov.extra_args)}`);
    }
  }

  return lines.join("\n") + "\n";
}

export async function readProfileFromDisk(path: string, fallbackName: string): Promise<Profile> {
  const content = await readFile(path, "utf8");
  return parseProfile(content, fallbackName);
}

export async function writeProfileToDisk(path: string, profile: Profile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyProfile(profile), "utf8");
}
