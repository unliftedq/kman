import { defineCommand } from "citty";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  loadAgent,
  locationsFor,
  MemoryStore,
  updateAgent,
} from "@delego/core";
import { b, s } from "../arg-helpers";

export const memoryCommand = defineCommand({
  meta: { name: "memory", description: "Manage an agent's MEMORY.md" },
  subCommands: {
    enable: defineCommand({
      meta: { name: "enable", description: "Enable memory for this agent" },
      args: { name: { type: "positional", required: true } },
      run: async ({ args }) => {
        await updateAgent(s(args.name), (p) => {
          p.memory.enabled = true;
        });
        console.log(`Memory enabled for "${s(args.name)}"`);
      },
    }),
    disable: defineCommand({
      meta: { name: "disable", description: "Disable memory for this agent" },
      args: { name: { type: "positional", required: true } },
      run: async ({ args }) => {
        await updateAgent(s(args.name), (p) => {
          p.memory.enabled = false;
        });
        console.log(`Memory disabled for "${s(args.name)}"`);
      },
    }),
    show: defineCommand({
      meta: { name: "show", description: "Print MEMORY.md with usage header" },
      args: { name: { type: "positional", required: true } },
      run: async ({ args }) => {
        const name = s(args.name);
        const profile = await loadAgent(name);
        const loc = locationsFor(name);
        const store = new MemoryStore({ path: loc.memoryPath, charLimit: profile.memory.char_limit });
        const snap = await store.snapshot();
        const pct = snap.charLimit > 0 ? Math.round((snap.usage / snap.charLimit) * 100) : 0;
        console.log(`# ${name} — MEMORY [${pct}% — ${snap.usage}/${snap.charLimit} chars, ${snap.entries.length} entries]`);
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
      args: { name: { type: "positional", required: true } },
      run: ({ args }) => {
        const loc = locationsFor(s(args.name));
        if (!existsSync(loc.memoryPath)) {
          console.error(`Memory file not found: ${loc.memoryPath}`);
          process.exit(2);
        }
        const editor = process.env.EDITOR ?? process.env.VISUAL ?? (process.platform === "win32" ? "notepad" : "vi");
        const result = spawnSync(editor, [loc.memoryPath], {
          stdio: "inherit",
          shell: process.platform === "win32",
        });
        if (result.status !== 0) process.exit(result.status ?? 1);
      },
    }),
    clear: defineCommand({
      meta: { name: "clear", description: "Clear MEMORY.md" },
      args: {
        name: { type: "positional", required: true },
        yes: { type: "boolean", default: false },
      },
      run: async ({ args }) => {
        const name = s(args.name);
        if (!b(args.yes)) {
          console.error(`Refusing to clear memory of "${name}" without --yes`);
          process.exit(2);
        }
        const loc = locationsFor(name);
        await writeFile(loc.memoryPath, "", "utf8");
        console.log(`Cleared memory for "${name}"`);
      },
    }),
  },
});
