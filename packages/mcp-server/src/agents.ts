import { readFile, readdir, stat } from 'node:fs/promises';
import { agentDir, agentSoulPath, agentsRoot, readProfile } from '@kman/core';
import type { Profile } from '@kman/types';

export interface AgentSummary {
  name: string;
  description: string | undefined;
  runtime: string;
  model: string | undefined;
}

/**
 * Walk ~/.kman/agents and return one summary per agent directory. Agents that
 * fail to parse are skipped — the MCP server should keep working even if a
 * single agent.toml is malformed (the user can fix it via `kman doctor`).
 *
 * `exclude` lets the launcher hide the agent that's currently launching, so
 * an agent cannot call itself via the MCP tool and create a fork bomb.
 */
export async function listAgents(exclude?: string): Promise<AgentSummary[]> {
  const root = agentsRoot();
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const out: AgentSummary[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (exclude && ent.name === exclude) continue;
    try {
      const profile = await readProfile(ent.name);
      out.push({
        name: profile.name,
        description: profile.description,
        runtime: profile.runtime.default,
        model: profile.runtime.model,
      });
    } catch {
      // Skip unreadable agents — surfaced separately via `kman doctor`.
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export interface AgentDetail {
  profile: Profile;
  soul: string;
  directory: string;
}

export async function describeAgent(name: string): Promise<AgentDetail> {
  const profile = await readProfile(name);
  let soul = '';
  try {
    soul = await readFile(agentSoulPath(profile.name, profile.soul.prompt_file), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return { profile, soul, directory: agentDir(profile.name) };
}

export async function agentExists(name: string): Promise<boolean> {
  try {
    const s = await stat(agentDir(name));
    return s.isDirectory();
  } catch {
    return false;
  }
}
