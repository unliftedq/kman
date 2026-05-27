import { UserError } from '@kman/types';

export interface ExtractResult {
  rest: string[];
  agent: string | undefined;
}

/**
 * Pull `-a <name>` / `--agent <name>` / `--agent=<name>` out of argv so it
 * can be placed before *or* after the subcommand. Multiple occurrences error
 * out per §6 ("If --agent appears more than once, Delego exits with code 2").
 */
export function extractAgentOption(argv: string[]): ExtractResult {
  const rest: string[] = [];
  let agent: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok === '-a' || tok === '--agent') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new UserError(`Missing value for ${tok}.`);
      }
      assertSingle(agent);
      agent = next;
      i++;
      continue;
    }
    if (tok.startsWith('--agent=')) {
      assertSingle(agent);
      agent = tok.slice('--agent='.length);
      continue;
    }
    if (tok.startsWith('-a=')) {
      assertSingle(agent);
      agent = tok.slice(3);
      continue;
    }
    rest.push(tok);
  }
  return { rest, agent };
}

function assertSingle(current: string | undefined): void {
  if (current !== undefined) {
    throw new UserError('--agent specified more than once.');
  }
}

export function requireAgent(): string {
  const a = process.env['DELEGO_SELECTED_AGENT'];
  if (!a) {
    throw new UserError('Missing required --agent <name>. Agent-scoped commands need a target agent.');
  }
  return a;
}

export function optionalAgent(): string | undefined {
  return process.env['DELEGO_SELECTED_AGENT'] || undefined;
}

export function rejectAgent(commandName: string): void {
  if (process.env['DELEGO_SELECTED_AGENT']) {
    throw new UserError(`Subcommand "${commandName}" does not accept --agent.`);
  }
}
