import { mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
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

      await mkdir(dir, { recursive: true });
      await mkdir(join(dir, 'agents'), { recursive: true });
      await mkdir(join(dir, 'skills'), { recursive: true });
      await mkdir(join(dir, 'hooks'), { recursive: true });
      await mkdir(join(dir, 'scripts'), { recursive: true });
      await mkdir(join(dir, '.claude-plugin'), { recursive: true });

      const profileInit: Parameters<typeof defaultProfile>[1] = {};
      if (opts.description) profileInit.description = opts.description;
      if (opts.runtime) profileInit.runtime = { default: opts.runtime };
      if (opts.model) {
        profileInit.runtime = { ...(profileInit.runtime ?? { default: 'claude-code' }), model: opts.model };
      }
      const profile = defaultProfile(name, profileInit);
      await writeProfile(profile);

      const soulBody =
        opts.soul ?? `# ${name}\n\nYou are ${name}. Replace this file with your agent's system prompt.\n`;
      // soul.md doubles as the plugin-contributed agent definition picked up
      // by both backends via `agents/<name>.md` (symlinked). Plugin loaders
      // require YAML frontmatter with at least `name:`; `description:` is
      // optional and only written when the user supplies one — avoids the
      // ugly `kman agent: <name>` placeholder appearing in three files.
      const descLine = opts.description ? `description: ${opts.description}\n` : '';
      const soulContent = `---\nname: ${name}\n${descLine}---\n\n${soulBody}`;
      await writeFile(agentSoulPath(name, profile.soul.prompt_file), soulContent, 'utf8');

      // agents/<name>.md is the file both backends' plugin loaders discover.
      // We keep soul.md at the root as the canonical source and symlink the
      // discovered file at it so edits to either stay in sync. On Windows
      // without Developer Mode / admin, symlink fails — fall back to a static
      // copy and warn so the user can fix it up.
      await writeAgentFile(dir, name, soulContent);

      const copilotManifest: Record<string, unknown> = { name, agents: 'agents/' };
      const claudeManifest: Record<string, unknown> = {
        name,
        agents: [`./agents/${name}.md`],
      };
      if (opts.description) {
        copilotManifest['description'] = opts.description;
        claudeManifest['description'] = opts.description;
      }
      await writeFile(
        join(dir, 'plugin.json'),
        JSON.stringify(copilotManifest, null, 2) + '\n',
        'utf8',
      );
      await writeFile(
        join(dir, '.claude-plugin', 'plugin.json'),
        JSON.stringify(claudeManifest, null, 2) + '\n',
        'utf8',
      );

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

      // agents/<from>.md → agents/<to>.md. The symlink target (../soul.md) is
      // independent of the file's own name, so the link stays valid.
      const oldAgentMd = join(dst, 'agents', `${from}.md`);
      const newAgentMd = join(dst, 'agents', `${to}.md`);
      if (await pathExists(oldAgentMd)) {
        await rename(oldAgentMd, newAgentMd);
      }

      // Both plugin manifests embed the agent name; rewrite them in place.
      await rewriteManifestName(join(dst, 'plugin.json'), to);
      await rewriteClaudeManifest(join(dst, '.claude-plugin', 'plugin.json'), to);

      // soul.md's frontmatter `name:` is what Claude registers the agent
      // under (Copilot uses the filename). Drift here means --agent <to>:<to>
      // fails on Claude. Rewrite the frontmatter so both backends agree.
      await rewriteSoulFrontmatterName(join(dst, profile.soul.prompt_file), to);

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

async function rewriteManifestName(path: string, newName: string): Promise<void> {
  if (!(await pathExists(path))) return;
  const raw = await readFile(path, 'utf8');
  const m = JSON.parse(raw) as Record<string, unknown>;
  m['name'] = newName;
  await writeFile(path, JSON.stringify(m, null, 2) + '\n', 'utf8');
}

async function rewriteClaudeManifest(path: string, newName: string): Promise<void> {
  if (!(await pathExists(path))) return;
  const raw = await readFile(path, 'utf8');
  const m = JSON.parse(raw) as Record<string, unknown>;
  m['name'] = newName;
  m['agents'] = [`./agents/${newName}.md`];
  await writeFile(path, JSON.stringify(m, null, 2) + '\n', 'utf8');
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

/**
 * Write `agents/<name>.md` as a relative symlink to `../soul.md`. On Windows
 * machines without symlink permission (no Developer Mode, no admin), the
 * symlink syscall fails with EPERM — fall back to a static copy so the agent
 * is still usable, and surface the loss-of-sync to the operator.
 */
async function writeAgentFile(dir: string, name: string, soulContent: string): Promise<void> {
  const target = join(dir, 'agents', `${name}.md`);
  try {
    await symlink(join('..', 'soul.md'), target, 'file');
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (process.platform === 'win32' && (err.code === 'EPERM' || err.code === 'UNKNOWN')) {
      await writeFile(target, soulContent, 'utf8');
      process.stderr.write(
        `kman: could not create a symlink on Windows (needs Developer Mode or admin); ` +
          `wrote a static copy at agents/${name}.md instead. Edits to soul.md will not ` +
          `propagate — keep them in sync manually, or enable Developer Mode and recreate.\n`,
      );
      return;
    }
    throw cause;
  }
}

