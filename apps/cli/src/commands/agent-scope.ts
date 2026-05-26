import { defineCommand } from "citty";
import {
  buildAgentContext,
  loadAgent,
  locationsFor,
  MemoryStore,
  runAgent,
  stringifyProfile,
  updateAgent,
} from "@delego/core";
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
import type { OutputFormat, PermissionMode } from "@delego/types";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getBackend } from "../backends";
import { b, parseRuntimeFlag, s, sOpt, ss } from "../arg-helpers";

function openInEditor(path: string): void {
  const editor =
    process.env.EDITOR ??
    process.env.VISUAL ??
    (process.platform === "win32" ? "notepad" : "vi");
  const result = spawnSync(editor, [path], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`Editor "${editor}" exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

export function buildAgentScopeCommand(agentName: string) {
  return defineCommand({
    meta: { name: agentName, description: `Agent "${agentName}" — run, chat, show, edit, soul, skill, tool, hook, memory` },
    run: async () => {
      const loc = locationsFor(agentName);
      const profile = await loadAgent(agentName);
      console.log(`# Agent: ${agentName}`);
      console.log(`# Dir:   ${loc.dir}`);
      console.log();
      console.log(stringifyProfile(profile));
    },
    subCommands: {
      show: defineCommand({
        meta: { name: "show", description: "Show agent profile and paths" },
        run: async () => {
          const loc = locationsFor(agentName);
          const profile = await loadAgent(agentName);
          console.log(`# Agent: ${agentName}`);
          console.log(`# Dir:   ${loc.dir}`);
          console.log();
          console.log(stringifyProfile(profile));
        },
      }),

      edit: defineCommand({
        meta: { name: "edit", description: "Open agent.toml in $EDITOR" },
        run: () => {
          const loc = locationsFor(agentName);
          openInEditor(loc.configPath);
        },
      }),

      soul: defineCommand({
        meta: { name: "soul", description: "Manage soul.md" },
        subCommands: {
          edit: defineCommand({
            meta: { name: "edit", description: "Open soul.md in $EDITOR" },
            run: () => {
              const loc = locationsFor(agentName);
              openInEditor(loc.soulPath);
            },
          }),
        },
      }),

      run: defineCommand({
        meta: { name: "run", description: "Run agent against a task (one-shot)" },
        args: {
          task: { type: "string", description: "Task description", required: true },
          runtime: { type: "string", description: "Override the profile's default backend" },
          model: { type: "string", description: "Override the profile's default model" },
          permission: { type: "string", description: "Abstract permission level: ask | auto | yolo" },
          "runtime-flag": { type: "string", description: "Raw key=value passed to backend (repeatable)" },
          output: { type: "string", description: "text | json | stream-json", default: "text" },
          stream: { type: "boolean", description: "Stream events to stdout (implies --output stream-json)", default: false },
          resume: { type: "string", description: "Resume a session" },
          "no-memory": { type: "boolean", description: "Disable memory for this run only", default: false },
          cwd: { type: "string", description: "Working directory for the backend" },
        },
        run: async ({ args }) => {
          const streamFlag = b(args.stream, false);
          const outputFormat: OutputFormat = streamFlag
            ? "stream-json"
            : (s(args.output, "text") as OutputFormat);
          const overrides: Parameters<typeof buildAgentContext>[1] = {
            outputFormat,
            noMemory: b(args["no-memory"]),
            runtimeRawFlags: parseRuntimeFlag(ss(args["runtime-flag"])),
          };
          const runtime = sOpt(args.runtime);
          if (runtime) overrides.runtime = runtime;
          const model = sOpt(args.model);
          if (model) overrides.model = model;
          const permission = sOpt(args.permission);
          if (permission) overrides.permission = permission as PermissionMode;
          const cwd = sOpt(args.cwd);
          if (cwd) overrides.cwd = cwd;
          const ctx = await buildAgentContext(agentName, overrides);
          const backend = getBackend(ctx.runtime);
          const runOpts: Parameters<typeof runAgent>[2] = {
            task: s(args.task),
            output: outputFormat,
            stream: streamFlag,
          };
          const resume = sOpt(args.resume);
          if (resume) runOpts.resume = resume;
          const summary = await runAgent(ctx, backend, runOpts);
          if (summary.exitReason === "error") process.exit(1);
        },
      }),

      chat: defineCommand({
        meta: { name: "chat", description: "Start an interactive REPL" },
        args: {
          runtime: { type: "string", description: "Override default backend" },
          model: { type: "string", description: "Override the profile's default model" },
          permission: { type: "string", description: "Abstract permission level: ask | auto | yolo" },
          "runtime-flag": { type: "string", description: "Raw key=value passed to backend (repeatable)" },
          resume: { type: "string", description: "Resume a session" },
          "no-memory": { type: "boolean", description: "Disable memory for this run only", default: false },
          cwd: { type: "string", description: "Working directory for the backend" },
        },
        run: async ({ args }) => {
          const overrides: Parameters<typeof buildAgentContext>[1] = {
            noMemory: b(args["no-memory"]),
            runtimeRawFlags: parseRuntimeFlag(ss(args["runtime-flag"])),
          };
          const runtime = sOpt(args.runtime);
          if (runtime) overrides.runtime = runtime;
          const model = sOpt(args.model);
          if (model) overrides.model = model;
          const permission = sOpt(args.permission);
          if (permission) overrides.permission = permission as PermissionMode;
          const cwd = sOpt(args.cwd);
          if (cwd) overrides.cwd = cwd;
          const ctx = await buildAgentContext(agentName, overrides);
          const backend = getBackend(ctx.runtime);
          const chatOpts: { resume?: string } = {};
          const resume = sOpt(args.resume);
          if (resume) chatOpts.resume = resume;
          const handle = await backend.chat(ctx, chatOpts);
          process.on("SIGINT", () => handle.kill("SIGINT"));
          const exitCode = await handle.done();
          process.exit(exitCode);
        },
      }),

      skill: defineCommand({
        meta: { name: "skill", description: "Manage vendored skills" },
        subCommands: {
          add: defineCommand({
            meta: { name: "add", description: "Install a skill from local path / agentskills.io / github" },
            args: {
              source: { type: "positional", required: true, description: "local path | name | agentskills:name | github:user/repo | https://...git" },
              name: { type: "string", description: "Override the inferred skill name" },
              force: { type: "boolean", default: false, description: "Overwrite if already installed" },
            },
            run: async ({ args }) => {
              try {
                const installed = await installSkill(agentName, s(args.source), {
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
            meta: { name: "remove", description: "Remove a vendored skill" },
            args: { skill: { type: "positional", required: true } },
            run: async ({ args }) => {
              const skill = s(args.skill);
              await removeSkill(agentName, skill);
              console.log(`Removed "${skill}" from "${agentName}"`);
            },
          }),
          list: defineCommand({
            meta: { name: "list", description: "List vendored skills" },
            run: async () => {
              const list = await listInstalledSkills(agentName);
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
            args: { skill: { type: "positional", required: true } },
            run: async ({ args }) => {
              const sk = await getInstalledSkill(agentName, s(args.skill));
              if (!sk) {
                console.error("Skill not installed");
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
              skill: { type: "positional", description: "Skill name (omit with --all)" },
              all: { type: "boolean", default: false },
              force: { type: "boolean", default: false },
            },
            run: async ({ args }) => {
              const targets: string[] = [];
              if (b(args.all)) {
                const list = await listInstalledSkills(agentName);
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
                  const updated = await updateSkill(agentName, name, { force: b(args.force) });
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
            args: { skill: { type: "positional", required: true } },
            run: async ({ args }) => {
              await detachSkill(agentName, s(args.skill));
              console.log(`Detached "${s(args.skill)}" — now a pure-local skill`);
            },
          }),
          fork: defineCommand({
            meta: { name: "fork", description: "Copy a vendored skill under a new name for local modification" },
            args: {
              skill: { type: "positional", required: true },
              "new-name": { type: "positional", required: true },
            },
            run: async ({ args }) => {
              const forked = await forkSkill(agentName, s(args.skill), s(args["new-name"]));
              console.log(`Forked "${s(args.skill)}" -> "${forked.name}" at ${forked.dir}`);
            },
          }),
        },
      }),

      tool: defineCommand({
        meta: { name: "tool", description: "Manage tools wired into the agent's profile" },
        subCommands: {
          add: defineCommand({
            meta: { name: "add", description: "Add a tool entry to the agent profile" },
            args: {
              name: { type: "positional", required: true },
              type: { type: "string", required: true, description: "mcp | shell | http" },
              server: { type: "string", description: "MCP server name (for type=mcp)" },
              include: { type: "string", description: "Comma-separated tool subset (for type=mcp)" },
              cmd: { type: "string", description: "Shell command template (for type=shell)" },
              url: { type: "string", description: "HTTP endpoint (for type=http)" },
              method: { type: "string", description: "HTTP method", default: "POST" },
            },
            run: ({ args }) => console.log(`[stub] tool add ${agentName} ${args.name} (${args.type})`),
          }),
          remove: defineCommand({
            meta: { name: "remove", description: "Remove a tool entry" },
            args: { name: { type: "positional", required: true } },
            run: ({ args }) => console.log(`[stub] tool remove ${agentName} ${args.name}`),
          }),
          list: defineCommand({
            meta: { name: "list", description: "List tool entries" },
            run: () => console.log(`[stub] tool list ${agentName}`),
          }),
        },
      }),

      hook: defineCommand({
        meta: { name: "hook", description: "Manage agent hooks (pre_run / post_run / on_error / pre_memory_write)" },
        subCommands: {
          list: defineCommand({
            meta: { name: "list", description: "List hooks" },
            run: () => console.log(`[stub] hook list ${agentName}`),
          }),
          add: defineCommand({
            meta: { name: "add", description: "Add a hook for an event" },
            args: {
              event: { type: "positional", required: true, description: "pre_run | post_run | on_error | pre_memory_write" },
              command: { type: "string", description: "Shell command to run" },
              script: { type: "string", description: "Path to script (relative to agent dir)" },
              "on-success-only": { type: "boolean", default: false },
            },
            run: ({ args }) => console.log(`[stub] hook add ${agentName} ${args.event}`),
          }),
          remove: defineCommand({
            meta: { name: "remove", description: "Remove a hook by index" },
            args: {
              event: { type: "positional", required: true },
              index: { type: "positional", required: true },
            },
            run: ({ args }) => console.log(`[stub] hook remove ${agentName} ${args.event}#${args.index}`),
          }),
          test: defineCommand({
            meta: { name: "test", description: "Print the stdin payload that would be sent to hooks of an event" },
            args: { event: { type: "positional", required: true } },
            run: ({ args }) => console.log(`[stub] hook test ${agentName} ${args.event}`),
          }),
        },
      }),

      memory: defineCommand({
        meta: { name: "memory", description: "Manage MEMORY.md" },
        subCommands: {
          enable: defineCommand({
            meta: { name: "enable", description: "Enable memory" },
            run: async () => {
              await updateAgent(agentName, (p) => {
                p.memory.enabled = true;
              });
              console.log(`Memory enabled for "${agentName}"`);
            },
          }),
          disable: defineCommand({
            meta: { name: "disable", description: "Disable memory" },
            run: async () => {
              await updateAgent(agentName, (p) => {
                p.memory.enabled = false;
              });
              console.log(`Memory disabled for "${agentName}"`);
            },
          }),
          show: defineCommand({
            meta: { name: "show", description: "Print MEMORY.md with usage header" },
            run: async () => {
              const profile = await loadAgent(agentName);
              const loc = locationsFor(agentName);
              const store = new MemoryStore({ path: loc.memoryPath, charLimit: profile.memory.char_limit });
              const snap = await store.snapshot();
              const pct = snap.charLimit > 0 ? Math.round((snap.usage / snap.charLimit) * 100) : 0;
              console.log(`# ${agentName} — MEMORY [${pct}% — ${snap.usage}/${snap.charLimit} chars, ${snap.entries.length} entries]`);
              console.log();
              if (snap.entries.length === 0) {
                console.log("(empty)");
                return;
              }
              for (const e of snap.entries) {
                console.log(e);
                console.log("§");
              }
            },
          }),
          edit: defineCommand({
            meta: { name: "edit", description: "Open MEMORY.md in $EDITOR" },
            run: () => {
              const loc = locationsFor(agentName);
              if (!existsSync(loc.memoryPath)) {
                console.error(`Memory file not found: ${loc.memoryPath}`);
                process.exit(2);
              }
              openInEditor(loc.memoryPath);
            },
          }),
          clear: defineCommand({
            meta: { name: "clear", description: "Clear MEMORY.md" },
            args: { yes: { type: "boolean", default: false } },
            run: async ({ args }) => {
              if (!b(args.yes)) {
                console.error(`Refusing to clear memory of "${agentName}" without --yes`);
                process.exit(2);
              }
              const loc = locationsFor(agentName);
              await writeFile(loc.memoryPath, "", "utf8");
              console.log(`Cleared memory for "${agentName}"`);
            },
          }),
        },
      }),
    },
  });
}
