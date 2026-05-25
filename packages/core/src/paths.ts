import { homedir } from "node:os";
import { join } from "node:path";

/** Filesystem layout helpers. All paths under DELEGO_HOME. */
export function delegoHome(): string {
  return process.env.DELEGO_HOME ?? join(homedir(), ".delego");
}

export function agentsDir(): string {
  return join(delegoHome(), "agents");
}

export function agentDir(name: string): string {
  return join(agentsDir(), name);
}

export function mcpDir(): string {
  return join(delegoHome(), "mcp.d");
}

export function mcpServerPath(name: string): string {
  return join(mcpDir(), `${name}.toml`);
}

export const AGENT_FILES = {
  config: "agent.toml",
  soul: "soul.md",
  memoryDir: "memories",
  memoryFile: "memories/MEMORY.md",
  skillsDir: "skills",
  hooksDir: "hooks",
  sessionsDir: "sessions",
  sessionsIndex: "sessions/index.db",
  logsDir: "logs",
} as const;
