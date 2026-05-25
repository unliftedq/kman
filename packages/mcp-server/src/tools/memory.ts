import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type ListToolsRequest,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { MemoryStore } from "@delego/core";

export interface MemoryToolContext {
  store: MemoryStore;
  /** Optional pre-write hook — return true to allow, string/false to reject (string becomes the reason). */
  preWrite?: (
    action: "add" | "replace" | "remove",
    payload: { content?: string; old_text?: string },
  ) => Promise<boolean | string>;
}

const MEMORY_DESCRIPTION =
  "Manage your bounded persistent memory entries.\n" +
  "Use `add` to append a new compact fact, `replace` to update an existing entry (substring match on old_text), or `remove` to drop one.\n" +
  "There is no read action — your current memory snapshot is already shown in the system prompt.";

const memoryToolDefinition: Tool = {
  name: "memory",
  description: MEMORY_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "replace", "remove"],
        description: "Operation to perform.",
      },
      content: {
        type: "string",
        description: "New entry text (required for add and replace).",
      },
      old_text: {
        type: "string",
        description: "Unique substring identifying the entry (required for replace and remove).",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
};

interface MemoryArgs {
  action?: string;
  content?: string;
  old_text?: string;
}

/**
 * Wires the `memory` tool into the lower-level Server.
 *
 * We use the lower-level handlers (`setRequestHandler` on the underlying
 * Server) rather than `McpServer.tool()`/`registerTool()` because the SDK's
 * high-level wrappers trigger TS2589 "Type instantiation excessively deep"
 * when the zod schema has more than a couple of fields.
 *
 * Multiple registrations on the same server must coexist — this helper composes
 * with `registerDelegateTools` (M5) via a small shared registry pattern.
 */
export function registerMemoryTool(server: Server, ctx: MemoryToolContext, registry: ToolRegistry): void {
  registry.add(memoryToolDefinition, async (args) => callMemory(ctx, args as MemoryArgs));
  registry.ensureHandlersInstalled(server);
}

/** Shared per-server registry so multiple tool packs (memory + delegate) can share one Server. */
export class ToolRegistry {
  private readonly entries = new Map<string, { def: Tool; handler: (args: unknown) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> }>();
  private handlersInstalled = false;

  add(def: Tool, handler: (args: unknown) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>): void {
    this.entries.set(def.name, { def, handler });
  }

  ensureHandlersInstalled(server: Server): void {
    if (this.handlersInstalled) return;
    this.handlersInstalled = true;

    server.setRequestHandler(ListToolsRequestSchema, async (_req: ListToolsRequest) => ({
      tools: Array.from(this.entries.values()).map((e) => e.def),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (req: CallToolRequest) => {
      const entry = this.entries.get(req.params.name);
      if (!entry) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `unknown tool: ${req.params.name}` }],
        };
      }
      return entry.handler(req.params.arguments ?? {});
    });
  }
}

async function callMemory(ctx: MemoryToolContext, args: MemoryArgs) {
  const action = args.action;
  if (action !== "add" && action !== "replace" && action !== "remove") {
    return wrap({ ok: false, message: `invalid action: ${String(action)}` });
  }
  const result = await runAction(ctx, { action, content: args.content, old_text: args.old_text });
  return wrap(result);
}

function wrap(result: { ok: boolean; message: string; [k: string]: unknown }) {
  return {
    isError: !result.ok,
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
  };
}

async function runAction(
  ctx: MemoryToolContext,
  args: { action: "add" | "replace" | "remove"; content?: string; old_text?: string },
) {
  if (args.action === "add") {
    if (!args.content) return { ok: false, message: "add requires `content`" };
    if (ctx.preWrite) {
      const ok = await ctx.preWrite("add", { content: args.content });
      if (ok !== true) {
        return {
          ok: false,
          message: typeof ok === "string" ? ok : "rejected by pre_memory_write hook",
        };
      }
    }
    return ctx.store.add(args.content);
  }
  if (args.action === "replace") {
    if (!args.old_text || !args.content) {
      return { ok: false, message: "replace requires both `old_text` and `content`" };
    }
    if (ctx.preWrite) {
      const ok = await ctx.preWrite("replace", {
        content: args.content,
        old_text: args.old_text,
      });
      if (ok !== true) {
        return {
          ok: false,
          message: typeof ok === "string" ? ok : "rejected by pre_memory_write hook",
        };
      }
    }
    return ctx.store.replace(args.old_text, args.content);
  }
  // remove
  if (!args.old_text) return { ok: false, message: "remove requires `old_text`" };
  if (ctx.preWrite) {
    const ok = await ctx.preWrite("remove", { old_text: args.old_text });
    if (ok !== true) {
      return {
        ok: false,
        message: typeof ok === "string" ? ok : "rejected by pre_memory_write hook",
      };
    }
  }
  return ctx.store.remove(args.old_text);
}
