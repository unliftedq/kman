import { writeFile, unlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type {
  AgentContext,
  Backend,
  BackendCapabilities,
  ChatHandle,
  ChatOptions,
  DelegoEvent,
  PermissionMode,
  RunOptions,
} from "@delego/types";

import { LineBuffer, translateClaudeLine } from "./stream-json";

const capabilities: BackendCapabilities = {
  supportsResume: true,
  supportsMcp: true,
  supportsStreamJson: true,
  supportsAppendSystemPrompt: true,
};

function mapPermission(level: PermissionMode): string {
  switch (level) {
    case "ask":
      return "default";
    case "auto":
      return "acceptEdits";
    case "yolo":
      return "bypassPermissions";
  }
}

async function writePromptFile(ctx: AgentContext): Promise<string> {
  const dir = join(tmpdir(), "delego");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `prompt-${ctx.runId}.md`);
  await writeFile(path, ctx.systemPrompt, "utf8");
  return path;
}

async function writeMcpConfig(ctx: AgentContext): Promise<string | null> {
  if (ctx.mcpServers.length === 0) return null;
  const dir = join(tmpdir(), "delego");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `mcp-${ctx.runId}.json`);

  const mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
  for (const s of ctx.mcpServers) {
    mcpServers[s.name] = {
      command: s.command,
      args: s.args,
      ...(s.env ? { env: s.env } : {}),
    };
  }
  await writeFile(path, JSON.stringify({ mcpServers }, null, 2), "utf8");
  return path;
}

export const claudeCodeBackend: Backend = {
  name: "claude-code",
  capabilities,
  resumeStrategy: "native",

  mapPermission,

  async *spawn(ctx: AgentContext, opts: RunOptions): AsyncIterable<DelegoEvent> {
    const promptPath = await writePromptFile(ctx);
    const mcpConfigPath = await writeMcpConfig(ctx);

    const args: string[] = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose", // required for stream-json output
      "--append-system-prompt-file",
      promptPath,
      "--permission-mode",
      mapPermission(ctx.permission),
      "--session-id",
      toUuid(ctx.runId),
    ];

    if (mcpConfigPath) {
      args.push("--mcp-config", mcpConfigPath, "--strict-mcp-config");
    }

    if (ctx.model) args.push("--model", ctx.model);
    if (opts.resume) args.push("--resume", opts.resume);
    // Note: do NOT pass --add-dir here — its <directories...> variadic would
    // greedily consume our positional task argument. ctx.cwd is honored via
    // child_process's `cwd` option below, which is what claude treats as its workspace.

    // Raw escape hatch flags from --runtime-flag, plus profile [runtime.claude-code].extra_args
    const override = ctx.profile.runtimeOverrides["claude-code"];
    if (override?.permission_mode_raw) {
      const idx = args.indexOf("--permission-mode");
      if (idx >= 0) args[idx + 1] = override.permission_mode_raw;
    }
    if (override?.extra_args) args.push(...override.extra_args);
    for (const [k, v] of Object.entries(ctx.runtimeRawFlags)) {
      args.push(`--${k}`, v);
    }

    // Task goes last as positional prompt argument
    args.push(opts.task);

    let proc: ChildProcess;
    try {
      proc = spawn("claude", args, {
        cwd: ctx.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
        // On Windows, claude.exe is a native binary so no shell needed.
        // If a future user has only a .cmd shim, set shell:true here.
      });
    } catch (err) {
      await unlink(promptPath).catch(() => {});
      if (mcpConfigPath) await unlink(mcpConfigPath).catch(() => {});
      yield {
        type: "error",
        message: `Failed to spawn claude: ${err instanceof Error ? err.message : String(err)}`,
        recoverable: false,
      };
      yield { type: "end", reason: "error", session_id: ctx.sessionId };
      return;
    }

    // Capture spawn-time errors (ENOENT etc.) that surface asynchronously.
    let spawnError: Error | null = null;
    await new Promise<void>((resolve) => {
      proc.once("spawn", resolve);
      proc.once("error", (err) => {
        spawnError = err;
        resolve();
      });
    });
    if (spawnError) {
      await unlink(promptPath).catch(() => {});
      if (mcpConfigPath) await unlink(mcpConfigPath).catch(() => {});
      yield {
        type: "error",
        message: `Failed to spawn claude: ${(spawnError as Error).message}`,
        recoverable: false,
      };
      yield { type: "end", reason: "error", session_id: ctx.sessionId };
      return;
    }

    // Drain stderr async without blocking stdout reads
    proc.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    const buf = new LineBuffer();
    try {
      if (proc.stdout) {
        for await (const chunk of proc.stdout as AsyncIterable<Buffer>) {
          for (const line of buf.push(chunk)) {
            for (const ev of translateClaudeLine(line, ctx.sessionId)) {
              yield ev;
            }
          }
        }
      }
      const tail = buf.flush();
      if (tail) {
        for (const ev of translateClaudeLine(tail, ctx.sessionId)) {
          yield ev;
        }
      }

      const exitCode = await new Promise<number>((resolve) => {
        if (proc.exitCode !== null) return resolve(proc.exitCode);
        proc.once("exit", (code) => resolve(code ?? 0));
      });

      if (exitCode !== 0) {
        yield {
          type: "error",
          message: `claude exited with code ${exitCode}`,
          recoverable: false,
        };
        yield { type: "end", reason: "error", session_id: ctx.sessionId };
      }
    } finally {
      await unlink(promptPath).catch(() => {});
      if (mcpConfigPath) await unlink(mcpConfigPath).catch(() => {});
    }
  },

  async chat(_ctx: AgentContext, _opts: ChatOptions): Promise<ChatHandle> {
    // M2: not yet implemented — chat REPL deferred until basic run loop is stable.
    throw new Error("claude-code backend chat: not implemented yet");
  },
};

/** Coerce an arbitrary string to a valid v4-shaped UUID for --session-id. */
function toUuid(runId: string): string {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRe.test(runId) ? runId : randomUUID();
}

export default claudeCodeBackend;
