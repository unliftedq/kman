import { Command } from 'commander';
import {
  discoverSkills,
  listInstalledSkills,
  materialize,
  parseSource,
  removeSkill,
  updateSkill,
  vendorSkill,
  type DiscoveredSkill,
} from '@kman/skills';
import { UserError } from '@kman/types';
import { requireAgent } from '../common/agent-option.js';
import { multiSelectInteractive } from '../common/multiselect.js';

export function buildSkillsCommand(): Command {
  const cmd = new Command('skills').description(
    'Per-agent skills management (add | list | show | update | remove).',
  );

  cmd
    .command('add')
    .description('Install one or more skills from a source.')
    .requiredOption('--source <source>', 'Source (path, owner/repo[/path][@ref], URL, or well-known name).')
    .option('--skill <name>', 'Skill name to install (repeatable).', collect, [] as string[])
    .option('--all', 'Install every skill discovered in the source.')
    .option('--ref <ref>', 'Pin a branch, tag, or commit.')
    .option('--force', 'Overwrite an existing skill of the same name.')
    .action(async (opts: { source: string; skill: string[]; all?: boolean; ref?: string; force?: boolean }) => {
      const agent = requireAgent();
      const source = parseSource(opts.source, opts.ref);
      const mat = await materialize(source);
      try {
        const discovered = await discoverSkills(mat.rootDir, mat.subpath);
        const selection = await selectSkills(discovered, opts.skill.length > 0 ? opts.skill : undefined, opts.all === true);
        for (const skill of selection) {
          const res = await vendorSkill({
            agent,
            source,
            skill,
            ...(mat.resolvedRef !== undefined ? { resolvedRef: mat.resolvedRef } : {}),
            force: opts.force === true,
          });
          process.stdout.write(`Installed ${skill.name} → ${res.installedPath}\n`);
        }
      } finally {
        await mat.cleanup();
      }
    });

  cmd
    .command('list')
    .description('List installed skills for an agent.')
    .action(async () => {
      const agent = requireAgent();
      const skills = await listInstalledSkills(agent);
      if (skills.length === 0) {
        process.stdout.write(`(no skills installed for ${agent})\n`);
        return;
      }
      for (const s of skills) {
        const src = s.manifest?.source ?? 'local';
        const ref = s.manifest?.ref ? `@${s.manifest.ref}` : '';
        process.stdout.write(`${s.name}\t${src}${ref}\n`);
      }
    });

  cmd
    .command('show')
    .description('Show details for an installed skill.')
    .requiredOption('--skill <name>', 'Skill name.')
    .action(async (opts: { skill: string }) => {
      const agent = requireAgent();
      const installed = await listInstalledSkills(agent);
      const match = installed.find((s) => s.name === opts.skill);
      if (!match) {
        throw new UserError(`Skill "${opts.skill}" not installed for agent "${agent}".`);
      }
      process.stdout.write(`name:         ${match.name}\n`);
      process.stdout.write(`directory:    ${match.dir}\n`);
      if (match.manifest) {
        process.stdout.write(`source:       ${match.manifest.source}\n`);
        if (match.manifest.source_url) process.stdout.write(`source_url:   ${match.manifest.source_url}\n`);
        if (match.manifest.ref) process.stdout.write(`ref:          ${match.manifest.ref}\n`);
        process.stdout.write(`installed_at: ${match.manifest.installed_at}\n`);
      } else {
        process.stdout.write('(no manifest — local skill, detached)\n');
      }
    });

  cmd
    .command('update')
    .description('Re-fetch an installed skill from its recorded source.')
    .option('--skill <name>', 'Skill name to update.')
    .option('--all', 'Update every installed skill.')
    .option('--force', 'Bypass local-modification safety check.')
    .action(async (opts: { skill?: string; all?: boolean; force?: boolean }) => {
      const agent = requireAgent();
      if (!opts.skill && !opts.all) {
        throw new UserError('Pass --skill <name> or --all.');
      }
      const targets = opts.all
        ? (await listInstalledSkills(agent)).filter((s) => !!s.manifest).map((s) => s.name)
        : [opts.skill as string];
      for (const skill of targets) {
        const res = await updateSkill({ agent, skill, force: opts.force === true });
        process.stdout.write(`Updated ${skill} → ${res.installedPath}\n`);
      }
    });

  cmd
    .command('remove')
    .description('Remove an installed skill.')
    .requiredOption('--skill <name>', 'Skill name.')
    .action(async (opts: { skill: string }) => {
      const agent = requireAgent();
      const removed = await removeSkill(agent, opts.skill);
      process.stdout.write(`Removed ${removed}\n`);
    });

  return cmd;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function selectSkills(
  discovered: DiscoveredSkill[],
  filter: string[] | undefined,
  all: boolean,
): Promise<DiscoveredSkill[]> {
  if (discovered.length === 0) {
    throw new UserError('No SKILL.md found in source.');
  }
  if (filter && filter.length > 0) {
    const out = discovered.filter((s) => filter.includes(s.name));
    if (out.length === 0) {
      throw new UserError(
        `Requested skills not found in source. Available: ${discovered.map((s) => s.name).join(', ')}.`,
      );
    }
    return out;
  }
  if (all) return discovered;
  if (discovered.length === 1) return discovered;

  if (process.stdin.isTTY && process.stdout.isTTY) {
    return pickInteractive(discovered);
  }
  throw new UserError(
    `Source contains multiple skills. Pass --skill <name> (repeatable) or --all. Discovered: ${discovered
      .map((s) => s.name)
      .join(', ')}.`,
  );
}

async function pickInteractive(discovered: DiscoveredSkill[]): Promise<DiscoveredSkill[]> {
  return multiSelectInteractive<DiscoveredSkill>({
    message: `Select skills to install (${discovered.length} discovered)`,
    items: discovered.map((s) => ({ value: s, label: s.name, hint: s.relPath })),
  });
}

