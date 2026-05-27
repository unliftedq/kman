import { Command, CommanderError } from 'commander';
import { KmanError, ExitCode } from '@kman/types';
import pkg from '../package.json' with { type: 'json' };
import { buildAgentCommand } from './commands/agent.js';
import { buildSkillsCommand } from './commands/skills.js';
import { buildRunCommand } from './commands/run.js';
import { buildChatCommand } from './commands/chat.js';
import { buildVersionCommand } from './commands/version.js';
import { buildDoctorCommand } from './commands/doctor.js';
import { extractAgentOption } from './common/agent-option.js';

function die(err: unknown): never {
  if (err instanceof KmanError) {
    if (err.message) process.stderr.write(`kman: ${err.message}\n`);
    process.exit(err.code);
  }
  // commander throws CommanderError for usage / unknown-command / missing-arg.
  if (err instanceof CommanderError) {
    // commander already prints to stderr for these. Map common ones to our exit codes.
    const code = err.code === 'commander.help' || err.code === 'commander.helpDisplayed' ? 0 : ExitCode.UserError;
    process.exit(code);
  }
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`kman: unexpected error: ${message}\n`);
  if (process.env['KMAN_DEBUG'] && err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  process.exit(ExitCode.AgentError);
}

const program = new Command();
program
  .name('kman')
  .description('Multi-agent orchestration engine (inspired by Kingsman).')
  .version(pkg.version, '-v, --version', 'Print kman CLI version.')
  .helpOption('-h, --help', 'Show help.')
  .showHelpAfterError()
  .exitOverride();

// Global option declared for help-text discoverability. Real parsing happens
// in `extractAgentOption` so that `-a` may appear before *or* after the
// subcommand (§6).
program.option('-a, --agent <name>', 'Target agent name (lowercase kebab-case). Required by agent-scoped subcommands.');

program.addCommand(buildAgentCommand());
program.addCommand(buildSkillsCommand());
program.addCommand(buildRunCommand());
program.addCommand(buildChatCommand());
program.addCommand(buildVersionCommand());
program.addCommand(buildDoctorCommand());

let rawArgs: string[];
try {
  const argv = process.argv.slice(2);
  const { rest, agent } = extractAgentOption(argv);
  if (agent !== undefined) process.env['KMAN_SELECTED_AGENT'] = agent;
  rawArgs = rest;
} catch (err) {
  die(err);
}

if (rawArgs.length === 0) {
  program.outputHelp();
  process.exit(ExitCode.UserError);
}

try {
  await program.parseAsync(rawArgs, { from: 'user' });
} catch (err) {
  die(err);
}
