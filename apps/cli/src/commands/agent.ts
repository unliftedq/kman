import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import {
  agentDir,
  agentsRoot,
  agentSoulPath,
  defaultProfile,
  readProfile,
  validateAgentName,
  writeProfile,
} from '@kman/core';
import { UserError } from '@kman/types';
import { readStdinLine } from '../common/stdin.js';

export function buildAgentCommand(): Command {
  const cmd = new Command('agent').description('Agent lifecycle: create, list, show, delete, rename.');

  cmd
    .command('create <name>')
    .description('Create a new agent (~/.delego/agents/<name>/).')
    .option('--runtime <backend>', 'Default backend (claude-code | copilot-cli).')
    .option('--model <id>', 'Default model id.')
    .option('--description <text>', 'Free-form description.')
    .option('--soul <text>', 'Initial soul prompt content.')
    .action(async (name: string, opts: { runtime?: string; model?: string; description?: string; soul?: string }) => {
      validateAgentName(name);

      const dir = agentDir(name);
      if (await pathExists(dir)) {
        throw new UserError(`Agent "${name}" already exists at ${dir}.`);
      }

      await mkdir(dir, { recursive: true });
      await mkdir(join(dir, 'skills'), { recursive: true });
      await mkdir(join(dir, 'hooks'), { recursive: true });
      await mkdir(join(dir, 'scripts'), { recursive: true });

      const profileInit: Parameters<typeof defaultProfile>[1] = {};
      if (opts.description) profileInit.description = opts.description;
      if (opts.runtime) profileInit.runtime = { default: opts.runtime };
      if (opts.model) {
        profileInit.runtime = { ...(profileInit.runtime ?? { default: 'claude-code' }), model: opts.model };
      }
      const profile = defaultProfile(name, profileInit);
      await writeProfile(profile);

      const soulContent =
        opts.soul ?? `# ${name}\n\nYou are ${name}. Replace this file with your agent's system prompt.\n`;
      await writeFile(agentSoulPath(name, profile.soul.prompt_file), soulContent, 'utf8');

      await writeFile(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2) + '\n', 'utf8');

      process.stdout.write(`Created agent "${name}" at ${dir}\n`);
    });

  cmd
    .command('list')
    .description('List all agents.')
    .action(async () => {
      const root = agentsRoot();
      let entries;
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          process.stdout.write('(no agents)\n');
          return;
        }
        throw err;
      }
      const names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
      if (names.length === 0) {
        process.stdout.write('(no agents)\n');
        return;
      }
      for (const name of names) process.stdout.write(`${name}\n`);
    });

  cmd
    .command('show <name>')
    .description('Show profile + paths for an agent.')
    .action(async (name: string) => {
      const profile = await readProfile(name);
      process.stdout.write(`name:        ${profile.name}\n`);
      if (profile.description) process.stdout.write(`description: ${profile.description}\n`);
      process.stdout.write(`directory:   ${agentDir(profile.name)}\n`);
      process.stdout.write(`runtime:     ${profile.runtime.default}`);
      if (profile.runtime.model) process.stdout.write(` (model=${profile.runtime.model})`);
      process.stdout.write('\n');
      process.stdout.write(`soul:        ${profile.soul.prompt_file}\n`);
      process.stdout.write(`defaults:    permission=${profile.defaults.permission_mode ?? 'ask'} `);
      process.stdout.write(`output=${profile.defaults.output_format ?? 'text'}`);
      if (profile.defaults.max_turns !== undefined) process.stdout.write(` max_turns=${profile.defaults.max_turns}`);
      process.stdout.write('\n');
      const overrides = Object.keys(profile.runtimeOverrides);
      if (overrides.length > 0) process.stdout.write(`overrides:   ${overrides.join(', ')}\n`);
    });

  cmd
    .command('delete <name>')
    .description('Delete an agent directory.')
    .option('--yes', 'Skip confirmation prompt.')
    .action(async (name: string, opts: { yes?: boolean }) => {
      validateAgentName(name);
      const dir = agentDir(name);
      if (!(await pathExists(dir))) {
        throw new UserError(`Agent "${name}" not found.`);
      }
      if (!opts.yes) {
        if (!process.stdin.isTTY) {
          throw new UserError(`Pass --yes to delete "${name}" non-interactively.`);
        }
        process.stdout.write(`Delete agent "${name}" at ${dir}? [y/N] `);
        const answer = await readStdinLine();
        if (!/^y(es)?$/i.test(answer.trim())) {
          process.stdout.write('Aborted.\n');
          return;
        }
      }
      await rm(dir, { recursive: true, force: true });
      process.stdout.write(`Deleted ${dir}\n`);
    });

  cmd
    .command('rename <from> <to>')
    .description('Rename an agent.')
    .action(async (from: string, to: string) => {
      validateAgentName(from);
      validateAgentName(to);
      const src = agentDir(from);
      const dst = agentDir(to);
      if (!(await pathExists(src))) {
        throw new UserError(`Agent "${from}" not found.`);
      }
      if (await pathExists(dst)) {
        throw new UserError(`Agent "${to}" already exists.`);
      }
      await rename(src, dst);
      const profile = await readProfile(to);
      await writeProfile({ ...profile, name: to });
      process.stdout.write(`Renamed ${from} → ${to}\n`);
    });

  return cmd;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

