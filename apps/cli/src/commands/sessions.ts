import { defineCommand } from "citty";
import { deleteSession, listSessions, readSession } from "@delego/core";
import type { DelegoEvent } from "@delego/types";
import { copyFile } from "node:fs/promises";
import { s } from "../arg-helpers";

export const sessionsCommand = defineCommand({
  meta: { name: "sessions", description: "Browse and search session logs" },
  subCommands: {
    list: defineCommand({
      meta: { name: "list", description: "List recent sessions for an agent" },
      args: {
        agent: { type: "positional", required: true },
        limit: { type: "string", description: "Max number of sessions", default: "20" },
      },
      run: async ({ args }) => {
        const limit = Number.parseInt(s(args.limit, "20"), 10);
        const records = await listSessions(s(args.agent), { limit });
        if (records.length === 0) {
          console.log("(no sessions)");
          return;
        }
        for (const r of records) {
          console.log(`${r.id}  ${r.startedAt.toISOString()}  ${r.bytes}B`);
        }
      },
    }),
    show: defineCommand({
      meta: { name: "show", description: "Show a session's transcript" },
      args: {
        agent: { type: "positional", required: true },
        id: { type: "positional", required: true },
        format: { type: "string", default: "text", description: "text | json" },
      },
      run: async ({ args }) => {
        const events = await readSession(s(args.agent), s(args.id));
        if (s(args.format, "text") === "json") {
          for (const e of events) console.log(JSON.stringify(e));
          return;
        }
        for (const e of events) renderEventToText(e);
      },
    }),
    search: defineCommand({
      meta: { name: "search", description: "Naive substring search across an agent's sessions" },
      args: {
        agent: { type: "positional", required: true },
        query: { type: "positional", required: true },
      },
      run: async ({ args }) => {
        const agent = s(args.agent);
        const records = await listSessions(agent);
        const q = s(args.query).toLowerCase();
        let hits = 0;
        for (const r of records) {
          try {
            const events = await readSession(agent, r.id);
            for (const e of events) {
              if (e.type === "message" && e.content.toLowerCase().includes(q)) {
                console.log(`${r.id}  ${e.role}  ${e.content.slice(0, 120)}`);
                hits++;
                break;
              }
            }
          } catch {
            /* skip unreadable */
          }
        }
        if (hits === 0) console.log("(no matches)");
      },
    }),
    prune: defineCommand({
      meta: { name: "prune", description: "Delete old sessions" },
      args: {
        agent: { type: "positional", required: true },
        keep: { type: "string", description: "Keep most recent N" },
      },
      run: async ({ args }) => {
        const agent = s(args.agent);
        const records = await listSessions(agent);
        const keepStr = s(args.keep);
        if (!keepStr) {
          console.error("--keep <N> required for v1 prune");
          process.exit(2);
        }
        const keep = Number.parseInt(keepStr, 10);
        const victims = records.slice(keep);
        for (const v of victims) await deleteSession(agent, v.id);
        console.log(`Pruned ${victims.length} session(s); kept ${Math.min(records.length, keep)}.`);
      },
    }),
    export: defineCommand({
      meta: { name: "export", description: "Export a session jsonl to a path" },
      args: {
        agent: { type: "positional", required: true },
        id: { type: "positional", required: true },
        to: { type: "string", required: true },
      },
      run: async ({ args }) => {
        const agent = s(args.agent);
        const id = s(args.id);
        const records = await listSessions(agent);
        const r = records.find((rec) => rec.id === id);
        if (!r) {
          console.error(`Session not found: ${id}`);
          process.exit(2);
        }
        await copyFile(r.path, s(args.to));
        console.log(`Exported to ${s(args.to)}`);
      },
    }),
  },
});

function renderEventToText(e: DelegoEvent): void {
  switch (e.type) {
    case "message":
      console.log(`[${e.role}] ${e.content}`);
      break;
    case "tool_use":
      console.log(`[tool_use] ${e.tool}(${JSON.stringify(e.input).slice(0, 200)})`);
      break;
    case "tool_result":
      console.log(`[tool_result] ${e.tool} ok=${e.ok}`);
      break;
    case "usage":
      console.log(`[usage] turns=${e.turns} in=${e.input_tokens} out=${e.output_tokens}${typeof e.cost_usd === "number" ? ` cost=$${e.cost_usd.toFixed(4)}` : ""}`);
      break;
    case "error":
      console.log(`[error] ${e.message}`);
      break;
    case "end":
      console.log(`[end] reason=${e.reason} session=${e.session_id}`);
      break;
  }
}
