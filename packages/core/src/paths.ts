import { homedir } from 'node:os';
import { join } from 'node:path';

/** Root of Delego's per-user state (§4). */
export function delegoHome(): string {
  const override = process.env['DELEGO_HOME'];
  return override && override.length > 0 ? override : join(homedir(), '.delego');
}

export function agentsRoot(): string {
  return join(delegoHome(), 'agents');
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
