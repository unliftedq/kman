import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import {
  agentDir,
  agentProfilePath,
  agentsRoot,
  agentSoulPath,
  defaultProfile,
  readConfig,
  readProfile,
  runtimeAgentRoot,
  validateAgentName,
  writeProfile,
} from '@kman/core';
import { UserError } from '@kman/types';
import { readStdinLine } from '../common/stdin.js';

export function buildAgentCommand(): Command {
  const cmd = new Command('agent').description('Agent lifecycle: create, list, show, delete, rename.');

  cmd
    .command('create <name>')
    .description('Create a new agent at ~/.kman/agents/<name>/.')
    .option('--runtime <runtime>', 'Default agent runtime (claude-code | copilot-cli).')
    .option('--model <id>', 'Default model id.')
    .option(
      '--description <text>',
      "What the agent is for or specializes in — a short label, e.g. \"C# code review\".",
    )
    .option(
      '--soul <text>',
      'Initial soul prompt body — how the agent thinks and behaves. Written to soul.md.',
    )
    .action(async (name: string, opts: { runtime?: string; model?: string; description?: string; soul?: string }) => {
      validateAgentName(name);

      const dir = agentDir(name);
      if (await pathExists(dir)) {
        throw new UserError(`Agent "${name}" already exists at ${dir}.`);
      }

      // Read and validate the global config.json *before* creating any files:
      // readConfig() can throw (e.g. malformed config.json), and we must not
      // leave a half-created agent directory behind that blocks future creates.
      const config = await readConfig();

      await mkdir(dir, { recursive: true });
      await mkdir(join(dir, 'skills'), { recursive: true });
      await mkdir(join(dir, 'hooks'), { recursive: true });
      await mkdir(join(dir, 'scripts'), { recursive: true });

      // Seed unspecified fields from the global config.json so a user who lives
      // on one backend doesn't have to repeat --runtime on every create.
      const runtime = opts.runtime ?? config.defaults.runtime;
      const model = opts.model ?? config.defaults.model;

      const profileInit: Parameters<typeof defaultProfile>[1] = {
        runtime: { default: runtime, ...(model !== undefined ? { model } : {}) },
      };
      if (opts.description) profileInit.description = opts.description;
      const seededDefaults = {
        ...(config.defaults.permission_mode !== undefined
          ? { permission_mode: config.defaults.permission_mode }
          : {}),
        ...(config.defaults.output_format !== undefined
          ? { output_format: config.defaults.output_format }
          : {}),
        ...(config.defaults.max_turns !== undefined ? { max_turns: config.defaults.max_turns } : {}),
      };
      if (Object.keys(seededDefaults).length > 0) profileInit.defaults = seededDefaults;
      const profile = defaultProfile(name, profileInit);
      await writeProfile(profile);

      const soulBody =
        opts.soul ?? `# ${name}\n\nYou are ${name}. Replace this file with your agent's system prompt.\n`;
      // soul.md carries the YAML frontmatter (at least `name:`) that both
      // backends' plugin loaders require: at launch kman materializes a runtime
      // plugin under ~/.kman/runtime/<name>/ and exposes soul.md as the
      // contributed `agents/<name>.md`. The agent directory itself stays free of
      // plugin scaffolding. `description:` is only written when supplied.
      const descLine = opts.description ? `description: ${quoteYamlString(opts.description)}\n` : '';
      const soulContent = `---\nname: ${name}\n${descLine}---\n\n${soulBody}`;
      await writeFile(agentSoulPath(name, profile.soul.prompt_file), soulContent, 'utf8');

      await writeFile(join(dir, 'mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2) + '\n', 'utf8');

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
      const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      // Only directories containing an agent.toml are real agents; ignore the rest.
      const checks = await Promise.all(
        dirs.map(async (name) => {
          try {
            return (await stat(agentProfilePath(name))).isFile() ? name : undefined;
          } catch {
            return undefined;
          }
        }),
      );
      const names = checks.filter((name): name is string => name !== undefined).sort();
      if (names.length === 0) {
        process.stdout.write('(no agents)\n');
        return;
      }
      for (const name of names) process.stdout.write(`${name}\n`);
    });

  cmd
    .command('show <name>')
    .description("Show an agent's profile and on-disk paths.")
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
    .description("Delete an agent's directory and all its contents.")
    .option('--yes', 'Skip the confirmation prompt.')
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
      // Drop the derived runtime plugin dir too so it doesn't outlive the agent.
      await rm(runtimeAgentRoot(name), { recursive: true, force: true });
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

      // soul.md's frontmatter `name:` is what the runtime plugin registers the
      // agent under. Drift here means backend selectors fail, so rewrite the
      // frontmatter to agree with the renamed profile.
      await rewriteSoulFrontmatterName(join(dst, profile.soul.prompt_file), to);

      // Derived runtime plugin dirs are keyed by agent name; drop the stale
      // ones so the next launch rematerializes under the new name.
      await rm(runtimeAgentRoot(from), { recursive: true, force: true });
      await rm(runtimeAgentRoot(to), { recursive: true, force: true });

      process.stdout.write(`Renamed ${from} → ${to}\n`);
    });

  return cmd;
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Replace the `name:` line in soul.md's YAML frontmatter without touching the
 * body. If no frontmatter is present, prepend a minimal block.
 */
async function rewriteSoulFrontmatterName(path: string, newName: string): Promise<void> {
  if (!(await pathExists(path))) return;
  const raw = await readFile(path, 'utf8');
  if (!raw.startsWith('---')) {
    const prefix = `---\nname: ${newName}\n---\n\n`;
    await writeFile(path, prefix + raw, 'utf8');
    return;
  }
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return; // malformed frontmatter — leave untouched.
  const frontmatter = raw.slice(0, end);
  const rest = raw.slice(end);
  const rewritten = frontmatter.replace(/^name:.*$/m, `name: ${newName}`);
  // If there was no `name:` line, inject one.
  const withName = /^name:/m.test(rewritten)
    ? rewritten
    : rewritten.replace(/^---\n/, `---\nname: ${newName}\n`);
  await writeFile(path, withName + rest, 'utf8');
}

