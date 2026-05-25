/**
 * `delegate_<peer>` MCP tools — Multi-Agent v2 (M5).
 *
 * For every known peer agent, expose one tool. The calling agent itself, plus
 * any agent already in the run-chain, are excluded from the catalog (cycle
 * detection — Design Decision §11.2).
 *
 * Each tool invokes `delego run <peer> --task ... --output json` as a child
 * process, capturing the JSON summary and returning it as the tool result.
 *
 * Depth and cycle protection:
 *   - `runChain` lists the ancestors (oldest → newest), including the calling
 *     agent at the tail.
 *   - A peer already present in `runChain` is excluded from the catalog
 *     (cannot be invoked).
 *   - If `runChain.length >= maxDepth`, no delegate tools are registered
 *     (further nesting refused at advertise time, not just at call time).
 *   - The spawned child inherits `DELEGO_RUN_CHAIN=<chain>,<peer>` so its
 *     own MCP server applies the same rules transitively.
 */

import { spawn } from "node:child_process";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import type { ToolRegistry } from "./memory";

export interface DelegateContext {
  /** The agent this MCP server is bound to. */
  agentName: string;
  /** All known peers (full registry, before chain/self filtering). */
  peers: readonly string[];
  /** Current run chain, oldest first. The calling agent is at the tail. */
  runChain: readonly string[];
  /** Max chain length. Default 3. */
  maxDepth: number;
  /** Executable used to re-invoke the delego CLI. */
  cliCommand: string;
  /** Leading argv before the subcommand (e.g. `[scriptPath]` in dev; `[]` in compiled). */
  cliLeadArgs: readonly string[];
}

interface DelegateArgs {
  task?: unknown;
  runtime?: unknown;
  cwd?: unknown;
}

interface DelegateResult {
  ok: boolean;
  peer: string;
  message: string;
  result?: unknown;
  session_id?: string;
  exit_code?: number;
  stderr?: string;
}

const DELEGATE_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    task: {
      type: "string",
      description:
        "The task for the peer agent. Be self-contained and include any context the peer needs.",
    },
    runtime: {
      type: "string",
      description: "Optional backend override (claude-code | codex | copilot-cli | gemini).",
    },
    cwd: {
      type: "string",
      description: "Optional working directory for the peer run.",
    },
  },
  required: ["task"],
  additionalProperties: false,
};

/**
 * Register one `delegate_<peer>` tool per eligible peer.
 *
 * Returns the list of peer names actually registered (after chain/self filtering),
 * primarily for logging / introspection in tests.
 */
export function registerDelegateTools(
  server: Server,
  registry: ToolRegistry,
  ctx: DelegateContext,
): string[] {
  // Stop the catalog from growing once depth budget is exhausted.
  if (ctx.runChain.length >= ctx.maxDepth) {
    registry.ensureHandlersInstalled(server);
    return [];
  }

  const chainSet = new Set(ctx.runChain);
  // Defensive: `runChain` is documented to include the calling agent at the
  // tail, but external callers of `createDelegoServer` may pass shorter chains.
  // Explicitly excluding `agentName` keeps self-loop protection independent of
  // that contract.
  chainSet.add(ctx.agentName);

  const eligible: string[] = [];
  for (const peer of ctx.peers) {
    if (chainSet.has(peer)) continue;
    eligible.push(peer);

    const tool: Tool = {
      name: toolNameFor(peer),
      description:
        `Delegate a task to peer agent "${peer}". ` +
        `Runs a one-shot \`delego run ${peer}\` as a sub-process and returns its final output. ` +
        `Use sparingly — each call spawns a new agent run with its own memory and session.`,
      inputSchema: DELEGATE_INPUT_SCHEMA,
    };

    registry.add(tool, async (args) => invokeDelegate(ctx, peer, args as DelegateArgs));
  }

  registry.ensureHandlersInstalled(server);
  return eligible;
}

/** Sanitize peer name into a valid MCP tool identifier. */
export function toolNameFor(peer: string): string {
  return `delegate_${peer.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

async function invokeDelegate(
  ctx: DelegateContext,
  peer: string,
  args: DelegateArgs,
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const task = typeof args.task === "string" ? args.task : "";
  if (!task.trim()) {
    return wrap({ ok: false, peer, message: "task is required and must be a non-empty string" });
  }

  // Belt-and-braces: even though we filtered at advertise time, refuse if the
  // chain has somehow grown since then.
  if (ctx.runChain.length >= ctx.maxDepth) {
    return wrap({
      ok: false,
      peer,
      message: `max_spawn_depth (${ctx.maxDepth}) exceeded; cannot delegate further`,
    });
  }
  if (ctx.runChain.includes(peer) || peer === ctx.agentName) {
    return wrap({
      ok: false,
      peer,
      message: `cycle detected: "${peer}" is already in the run chain [${ctx.runChain.join(" → ")}]`,
    });
  }

  const childArgs: string[] = [
    ...ctx.cliLeadArgs,
    "run",
    peer,
    "--task",
    task,
    "--output",
    "json",
  ];
  if (typeof args.runtime === "string" && args.runtime.length > 0) {
    childArgs.push("--runtime", args.runtime);
  }
  if (typeof args.cwd === "string" && args.cwd.length > 0) {
    childArgs.push("--cwd", args.cwd);
  }

  const nextChain = [...ctx.runChain, peer].join(",");

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(ctx.cliCommand, childArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          DELEGO_RUN_CHAIN: nextChain,
          DELEGO_MAX_SPAWN_DEPTH: String(ctx.maxDepth),
        },
      });
    } catch (err) {
      resolve(
        wrap({
          ok: false,
          peer,
          message: `failed to spawn delego for peer "${peer}": ${
            err instanceof Error ? err.message : String(err)
          }`,
        }),
      );
      return;
    }

    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });

    child.once("error", (err) => {
      resolve(
        wrap({
          ok: false,
          peer,
          message: `delego sub-process error: ${err.message}`,
          stderr: stderr.slice(-2000),
        }),
      );
    });

    child.once("exit", (code) => {
      const exit = code ?? 0;
      // The child writes its JSON summary on stdout for `--output json`.
      let summary: Record<string, unknown> | null = null;
      const trimmed = stdout.trim();
      if (trimmed) {
        try {
          summary = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          // Not JSON — fall through; we'll surface raw stdout in the message.
        }
      }

      if (exit !== 0 || (summary && summary.reason === "error")) {
        resolve(
          wrap({
            ok: false,
            peer,
            message: `peer "${peer}" exited with code ${exit}${
              summary && typeof summary.error === "string" ? `: ${summary.error}` : ""
            }`,
            ...(summary?.session_id ? { session_id: String(summary.session_id) } : {}),
            exit_code: exit,
            ...(stderr ? { stderr: stderr.slice(-2000) } : {}),
            ...(summary ? { result: summary } : {}),
          }),
        );
        return;
      }

      resolve(
        wrap({
          ok: true,
          peer,
          message: `peer "${peer}" completed`,
          ...(summary?.session_id ? { session_id: String(summary.session_id) } : {}),
          exit_code: exit,
          result: summary ?? trimmed,
        }),
      );
    });
  });
}

function wrap(result: DelegateResult) {
  return {
    isError: !result.ok,
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
  };
}
