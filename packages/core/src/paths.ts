import { homedir } from 'node:os';
import { join } from 'node:path';

/** Root of kman's per-user state (§4). */
export function kmanHome(): string {
  const override = process.env['KMAN_HOME'];
  return override && override.length > 0 ? override : join(homedir(), '.kman');
}

export function agentsRoot(): string {
  return join(kmanHome(), 'agents');
}

export function agentDir(name: string): string {
  return join(agentsRoot(), name);
}

export function agentProfilePath(name: string): string {
  return join(agentDir(name), 'agent.toml');
}

export function agentSoulPath(name: string, soulFile = 'soul.md'): string {
  return join(agentDir(name), soulFile);
}

export function agentSkillsDir(name: string): string {
  return join(agentDir(name), 'skills');
}

export function agentLogsDir(name: string): string {
  return join(agentDir(name), 'logs');
}
