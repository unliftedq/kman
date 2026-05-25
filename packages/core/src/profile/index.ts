import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { BackendName, Profile } from "@delego/types";

import { agentDir, agentsDir, AGENT_FILES } from "../paths";
import { defaultProfile } from "./defaults";
import { readProfileFromDisk, writeProfileToDisk } from "./toml";

export * from "./defaults";
export * from "./toml";

export interface CreateAgentOptions {
  runtime?: BackendName;
  model?: string;
  memoryEnabled?: boolean;
  description?: string;
  soulContent?: string;
}

export interface AgentLocations {
  dir: string;
  configPath: string;
  soulPath: string;
  memoryPath: string;
  sessionsDir: string;
  skillsDir: string;
  hooksDir: string;
  logsDir: string;
}

export function locationsFor(name: string): AgentLocations {
  const dir = agentDir(name);
  return {
    dir,
    configPath: join(dir, AGENT_FILES.config),
    soulPath: join(dir, AGENT_FILES.soul),
    memoryPath: join(dir, AGENT_FILES.memoryFile),
    sessionsDir: join(dir, AGENT_FILES.sessionsDir),
    skillsDir: join(dir, AGENT_FILES.skillsDir),
    hooksDir: join(dir, AGENT_FILES.hooksDir),
    logsDir: join(dir, AGENT_FILES.logsDir),
  };
}

export function agentExists(name: string): boolean {
  return existsSync(locationsFor(name).configPath);
}

export async function listAgentNames(): Promise<string[]> {
  const root = agentsDir();
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => existsSync(join(root, n, AGENT_FILES.config)))
    .sort();
}

export async function loadAgent(name: string): Promise<Profile> {
  const loc = locationsFor(name);
  if (!existsSync(loc.configPath)) {
    throw new Error(`Agent "${name}" not found at ${loc.configPath}`);
  }
  return readProfileFromDisk(loc.configPath, name);
}

export async function createAgent(name: string, options: CreateAgentOptions = {}): Promise<AgentLocations> {
  const loc = locationsFor(name);
  if (existsSync(loc.configPath)) {
    throw new Error(`Agent "${name}" already exists at ${loc.dir}`);
  }

  await mkdir(loc.dir, { recursive: true });
  await mkdir(join(loc.dir, AGENT_FILES.memoryDir), { recursive: true });
  await mkdir(loc.sessionsDir, { recursive: true });
  await mkdir(loc.skillsDir, { recursive: true });
  await mkdir(loc.hooksDir, { recursive: true });
  await mkdir(loc.logsDir, { recursive: true });

  const profile = defaultProfile(name, options.runtime, options.model);
  if (options.memoryEnabled === false) profile.memory.enabled = false;
  if (options.description) profile.description = options.description;

  await writeProfileToDisk(loc.configPath, profile);

  const soul =
    options.soulContent ??
    `# ${name}\n\nYou are an agent named "${name}".\n\nDescribe this agent's role, expertise, and behavior here.\n`;
  await writeFile(loc.soulPath, soul, "utf8");

  await writeFile(loc.memoryPath, "", "utf8");

  return loc;
}

export async function deleteAgent(name: string): Promise<void> {
  const loc = locationsFor(name);
  if (!existsSync(loc.configPath)) {
    throw new Error(`Agent "${name}" not found`);
  }
  await rm(loc.dir, { recursive: true, force: true });
}

export async function renameAgent(oldName: string, newName: string): Promise<void> {
  const oldLoc = locationsFor(oldName);
  const newLoc = locationsFor(newName);
  if (!existsSync(oldLoc.configPath)) {
    throw new Error(`Agent "${oldName}" not found`);
  }
  if (existsSync(newLoc.configPath)) {
    throw new Error(`Agent "${newName}" already exists`);
  }
  await rename(oldLoc.dir, newLoc.dir);

  // Update the name field inside the moved config.
  const profile = await readProfileFromDisk(newLoc.configPath, newName);
  profile.name = newName;
  await writeProfileToDisk(newLoc.configPath, profile);
}

export async function updateAgent(name: string, patch: (p: Profile) => void): Promise<Profile> {
  const profile = await loadAgent(name);
  patch(profile);
  await writeProfileToDisk(locationsFor(name).configPath, profile);
  return profile;
}
