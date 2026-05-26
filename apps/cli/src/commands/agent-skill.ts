import { defineCommand } from "citty";
import {
  detachSkill,
  forkSkill,
  getInstalledSkill,
  installSkill,
  listInstalledSkills,
  RemoteSourceNotImplementedError,
  removeSkill,
  updateSkill,
} from "@delego/skills";
import { b, s } from "../arg-helpers";

export const skillCommand = defineCommand({
  meta: { name: "skill", description: "Manage an agent's vendored skills" },
  subCommands: {
    add: defineCommand({
      meta: { name: "add", description: "Install a skill from local path / agentskills.io / github" },
      args: {
        agent: { type: "positional", required: true },
        source: { type: "positional", required: true, description: "local path | name | agentskills:name | github:user/repo | https://...git" },
        name: { type: "string", description: "Override the inferred skill name" },
        force: { type: "boolean", default: false, description: "Overwrite if already installed" },
      },
      run: async ({ args }) => {
        const agent = s(args.agent);
        try {
          const installed = await installSkill(agent, s(args.source), {
            name: s(args.name) || undefined,
            force: b(args.force),
          });
          console.log(`Installed "${installed.name}" -> ${installed.dir}`);
          if (installed.description) console.log(`  description: ${installed.description}`);
        } catch (err) {
          if (err instanceof RemoteSourceNotImplementedError) {
            console.error(err.message);
            process.exit(2);
          }
          throw err;
        }
      },
    }),
    remove: defineCommand({
      meta: { name: "remove", description: "Remove a vendored skill from an agent" },
      args: {
        agent: { type: "positional", required: true },
        skill: { type: "positional", required: true },
      },
      run: async ({ args }) => {
        const agent = s(args.agent);
        const skill = s(args.skill);
        await removeSkill(agent, skill);
        console.log(`Removed "${skill}" from "${agent}"`);
      },
    }),
    list: defineCommand({
      meta: { name: "list", description: "List vendored skills for an agent" },
      args: { agent: { type: "positional", required: true } },
      run: async ({ args }) => {
        const list = await listInstalledSkills(s(args.agent));
        if (list.length === 0) {
          console.log("(no skills installed)");
          return;
        }
        for (const sk of list) {
          const src = sk.manifest ? sk.manifest.source : "(detached)";
          console.log(`${sk.name}  ${src}`);
          if (sk.description) console.log(`  ${sk.description}`);
        }
      },
    }),
    show: defineCommand({
      meta: { name: "show", description: "Show metadata of a vendored skill" },
      args: {
        agent: { type: "positional", required: true },
        skill: { type: "positional", required: true },
      },
      run: async ({ args }) => {
        const sk = await getInstalledSkill(s(args.agent), s(args.skill));
        if (!sk) {
          console.error(`Skill not installed`);
          process.exit(2);
        }
        console.log(`name:        ${sk.name}`);
        console.log(`dir:         ${sk.dir}`);
        console.log(`description: ${sk.description ?? "(none)"}`);
        if (sk.manifest) {
          console.log(`source:      ${sk.manifest.source}`);
          console.log(`installed:   ${sk.manifest.installed_at}`);
          console.log(`version:     ${sk.manifest.version}`);
          if (sk.manifest.checksum) console.log(`checksum:    ${sk.manifest.checksum}`);
        } else {
          console.log(`source:      (detached — no manifest)`);
        }
      },
    }),
    update: defineCommand({
      meta: { name: "update", description: "Re-fetch from source (refuses on local edits without --force)" },
      args: {
        agent: { type: "positional", required: true },
        skill: { type: "positional", description: "Skill name (omit with --all)" },
        all: { type: "boolean", default: false },
        force: { type: "boolean", default: false },
      },
      run: async ({ args }) => {
        const agent = s(args.agent);
        const targets: string[] = [];
        if (b(args.all)) {
          const list = await listInstalledSkills(agent);
          for (const sk of list) {
            if (sk.manifest) targets.push(sk.name);
          }
        } else {
          if (!s(args.skill)) {
            console.error("Provide a skill name, or use --all");
            process.exit(2);
          }
          targets.push(s(args.skill));
        }
        for (const name of targets) {
          try {
            const updated = await updateSkill(agent, name, { force: b(args.force) });
            console.log(`Updated "${updated.name}" (${updated.manifest?.source})`);
          } catch (err) {
            console.error(`  ${name}: ${err instanceof Error ? err.message : String(err)}`);
            if (!b(args.all)) process.exit(1);
          }
        }
      },
    }),
    detach: defineCommand({
      meta: { name: "detach", description: "Remove source manifest; treat as local-only" },
      args: {
        agent: { type: "positional", required: true },
        skill: { type: "positional", required: true },
      },
      run: async ({ args }) => {
        await detachSkill(s(args.agent), s(args.skill));
        console.log(`Detached "${s(args.skill)}" — now a pure-local skill`);
      },
    }),
    fork: defineCommand({
      meta: { name: "fork", description: "Copy a vendored skill under a new name for local modification" },
      args: {
        agent: { type: "positional", required: true },
        skill: { type: "positional", required: true },
        "new-name": { type: "positional", required: true },
      },
      run: async ({ args }) => {
        const agent = s(args.agent);
        const forked = await forkSkill(agent, s(args.skill), s(args["new-name"]));
        console.log(`Forked "${s(args.skill)}" -> "${forked.name}" at ${forked.dir}`);
      },
    }),
  },
});
