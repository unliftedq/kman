import { defineCommand } from "citty";
import {
  createAgent,
  deleteAgent,
  listAgentNames,
  loadAgent,
  locationsFor,
  renameAgent,
  stringifyProfile,
} from "@delego/core";
import { spawnSync } from "node:child_process";
import { memoryCommand } from "./agent-memory";
import { skillCommand } from "./agent-skill";
import { toolCommand } from "./agent-tool";
import { hookCommand } from "./agent-hook";
import { b, s, sOpt } from "../arg-helpers";

export const agentCommand = defineCommand({
  meta: {
    name: "agent",
    description: "Manage agent profiles (create, list, show, delete, edit)",
  },
  subCommands: {
    create: defineCommand({
      meta: { name: "create", description: "Create a new agent profile" },
      args: {
        name: { type: "positional", description: "Agent name", required: true },
        runtime: { type: "string", description: "Default backend runtime", default: "claude-code" },
        model: { type: "string", description: "Default model id" },
        memory: { type: "boolean", description: "Enable memory", default: true },
        description: { type: "string", description: "Agent description" },
        soul: { type: "string", description: "Path to seed soul.md" },
      },
      run: async ({ args }) => {
        const opts: Parameters<typeof createAgent>[1] = {
          runtime: s(args.runtime, "claude-code"),
          memoryEnabled: b(args.memory, true),
        };
        const model = sOpt(args.model);
        if (model) opts.model = model;
        const description = sOpt(args.description);
        if (description) opts.description = description;
        const soulPath = sOpt(args.soul);
        if (soulPath) {
          const { readFileSync } = await import("node:fs");
          opts.soulContent = readFileSync(soulPath, "utf8");
        }
        const loc = await createAgent(s(args.name), opts);
        console.log(`Created agent "${s(args.name)}" at ${loc.dir}`);
      },
    }),
    list: defineCommand({
      meta: { name: "list", description: "List all agents" },
      run: async () => {
        const names = await listAgentNames();
        if (names.length === 0) {
          console.log("(no agents) — try `delego agent create <name>`");
          return;
        }
        for (const name of names) {
          try {
            const p = await loadAgent(name);
            const desc = p.description ?? "";
            console.log(`${name}  [${p.runtime.default}${p.runtime.model ? ` ${p.runtime.model}` : ""}]  ${desc}`);
          } catch {
            console.log(`${name}  (invalid profile)`);
          }
        }
      },
    }),
    show: defineCommand({
      meta: { name: "show", description: "Show an agent's profile and paths" },
      args: { name: { type: "positional", required: true } },
      run: async ({ args }) => {
        const name = s(args.name);
        const loc = locationsFor(name);
        const profile = await loadAgent(name);
        console.log(`# Agent: ${name}`);
        console.log(`# Dir:   ${loc.dir}`);
        console.log();
        console.log(stringifyProfile(profile));
      },
    }),
    delete: defineCommand({
      meta: { name: "delete", description: "Delete an agent" },
      args: {
        name: { type: "positional", required: true },
        yes: { type: "boolean", description: "Skip confirmation", default: false },
      },
      run: async ({ args }) => {
        const name = s(args.name);
        if (!b(args.yes)) {
          const loc = locationsFor(name);
          console.error(`Refusing to delete ${loc.dir} without --yes`);
          process.exit(2);
        }
        await deleteAgent(name);
        console.log(`Deleted agent "${name}"`);
      },
    }),
    rename: defineCommand({
      meta: { name: "rename", description: "Rename an agent" },
      args: {
        old: { type: "positional", required: true },
        new: { type: "positional", required: true },
      },
      run: async ({ args }) => {
        await renameAgent(s(args.old), s(args.new));
        console.log(`Renamed: ${s(args.old)} -> ${s(args.new)}`);
      },
    }),
    edit: defineCommand({
      meta: { name: "edit", description: "Open the agent's agent.toml in $EDITOR" },
      args: { name: { type: "positional", required: true } },
      run: ({ args }) => {
        const loc = locationsFor(s(args.name));
        openInEditor(loc.configPath);
      },
    }),
    soul: defineCommand({
      meta: { name: "soul", description: "Manage the agent's soul.md" },
      subCommands: {
        edit: defineCommand({
          meta: { name: "edit", description: "Open soul.md in $EDITOR" },
          args: { name: { type: "positional", required: true } },
          run: ({ args }) => {
            const loc = locationsFor(s(args.name));
            openInEditor(loc.soulPath);
          },
        }),
      },
    }),
    memory: memoryCommand,
    skill: skillCommand,
    tool: toolCommand,
    hook: hookCommand,
  },
});

function openInEditor(path: string): void {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? (process.platform === "win32" ? "notepad" : "vi");
  const result = spawnSync(editor, [path], { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`Editor "${editor}" exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}
