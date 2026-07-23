/**
 * pi SDK runner — the in-process embedding of pi (https://pi.dev).
 *
 * kman's PiBackend launches this script as a child process (see backend.ts).
 * It imports pi's SDK (`@earendil-works/pi-coding-agent`) directly and drives
 * an AgentSession from the AgentContext that PiBackend serialized into env
 * vars. Running the SDK inside a child keeps kman's process-based Backend
 * contract intact (stdio passthrough, signal forwarding, daemon log capture)
 * while still integrating pi as an embedded library rather than an opaque CLI.
 *
 * Env contract (all set by PiBackend.buildEnv):
 *   KMAN_PI_SOUL           system prompt (soul.md body); may be empty
 *   KMAN_PI_PERMISSION     ask | auto | yolo | <raw>
 *   KMAN_PI_CWD            working directory for tools
 *   KMAN_PI_AGENT_DIR      pi resource/agent dir (skills, prompts, AGENTS.md)
 *   KMAN_PI_INTERACTIVE    "1" for chat, "0" for one-shot run
 *   KMAN_PI_MODEL          optional "provider/id" or "id"
 *   KMAN_PI_TASK           one-shot prompt (run mode)
 */

import { pathToFileURL } from 'node:url';

interface RunnerEnv {
  soul: string;
  permission: string;
  cwd: string;
  agentDir: string;
  interactive: boolean;
  model?: string;
  task?: string;
}

function readEnv(): RunnerEnv {
  const env = process.env;
  return {
    soul: env['KMAN_PI_SOUL'] ?? '',
    permission: env['KMAN_PI_PERMISSION'] ?? 'ask',
    cwd: env['KMAN_PI_CWD'] ?? process.cwd(),
    agentDir: env['KMAN_PI_AGENT_DIR'] ?? '',
    interactive: env['KMAN_PI_INTERACTIVE'] === '1',
    ...(env['KMAN_PI_MODEL'] ? { model: env['KMAN_PI_MODEL'] } : {}),
    ...(env['KMAN_PI_TASK'] !== undefined ? { task: env['KMAN_PI_TASK'] } : {}),
  };
}

/**
 * Translate kman's abstract permission level into pi's tool allowlist. pi's SDK
 * has no interactive per-tool approval callback exposed at this embedding layer,
 * so the enforceable lever is which built-in tools the session may call:
 *
 *   yolo          → full coding tools (read/write/edit/bash + search).
 *   ask / auto /  → read-only tools (read/grep/find/ls) only; the mutating
 *   anything else   tools (write/edit/bash) are withheld so an unattended run
 *                   cannot make un-approved changes.
 */
export function toolsForPermission(permission: string): string[] {
  if (permission === 'yolo') {
    return ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'];
  }
  return ['read', 'grep', 'find', 'ls'];
}

/**
 * Import pi's SDK lazily so a missing/incompatible install produces a clear,
 * actionable message on stderr (and a non-zero exit) instead of an unhandled
 * module-resolution crash. This is the graceful-fallback surface kman relies
 * on when pi is the default runtime but not usable in the environment.
 */
async function loadPiSdk(): Promise<typeof import('@earendil-works/pi-coding-agent')> {
  try {
    return await import('@earendil-works/pi-coding-agent');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      'pi runtime unavailable: failed to load @earendil-works/pi-coding-agent. ' +
        'Install the pi SDK, or select another runtime with `--runtime claude-code` / ' +
        '`--runtime copilot-cli`.\n' +
        `Underlying error: ${message}`,
    );
  }
}

async function main(): Promise<number> {
  const cfg = readEnv();
  const sdk = await loadPiSdk();
  const {
    createAgentSession,
    DefaultResourceLoader,
    ModelRuntime,
    SessionManager,
    resolveCliModel,
    getAgentDir,
  } = sdk;

  const agentDir = cfg.agentDir || getAgentDir();

  const modelRuntime = await ModelRuntime.create();

  // Resolve the model, if the profile pinned one. Left undefined otherwise so
  // pi falls back to its own default/available model.
  let model: unknown;
  if (cfg.model) {
    const resolved = resolveCliModel({ cliModel: cfg.model, modelRuntime });
    if (resolved.error) {
      process.stderr.write(`pi: ${resolved.error}\n`);
      return 1;
    }
    if (resolved.warning) process.stderr.write(`pi: ${resolved.warning}\n`);
    model = resolved.model;
  }

  // Deliver the soul as the system prompt via a ResourceLoader override, and
  // let pi discover skills / prompts / AGENTS.md from the materialized agent
  // resource dir.
  const loader = new DefaultResourceLoader({
    cwd: cfg.cwd,
    agentDir,
    ...(cfg.soul.trim().length > 0 ? { systemPromptOverride: () => cfg.soul } : {}),
  });
  await loader.reload();

  const sessionManager = cfg.interactive
    ? SessionManager.create(cfg.cwd)
    : SessionManager.inMemory(cfg.cwd);

  const { session } = await createAgentSession({
    cwd: cfg.cwd,
    agentDir,
    ...(model ? { model: model as never } : {}),
    resourceLoader: loader,
    sessionManager,
    tools: toolsForPermission(cfg.permission),
  });

  // Stream assistant text to stdout so the launcher / daemon log capture it.
  const unsubscribe = session.subscribe((event) => {
    if (
      event.type === 'message_update' &&
      event.assistantMessageEvent.type === 'text_delta'
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
    if (event.type === 'tool_execution_end' && event.isError) {
      // Best-effort enrichment: read the tool name / error detail if the SDK
      // event carries them. These fields are accessed defensively (rather than
      // via the typed event) because their exact names are not guaranteed
      // across pi SDK versions; a missing field degrades to a generic message
      // rather than a crash.
      const e = event as Record<string, unknown>;
      const tool = typeof e['toolName'] === 'string' ? e['toolName'] : 'unknown';
      const raw = e['error'];
      const detail = raw instanceof Error ? raw.message : raw != null ? String(raw) : '';
      process.stderr.write(`\npi: tool error [${tool}]${detail ? `: ${detail}` : ''}\n`);
    }
  });

  try {
    if (cfg.interactive) {
      // Interactive REPL: drive prompts from stdin, one line per turn.
      await runInteractive(session);
    } else {
      await session.prompt(cfg.task ?? '');
      process.stdout.write('\n');
    }
    return 0;
  } finally {
    unsubscribe();
    session.dispose();
  }
}

/** Minimal line-oriented REPL: read stdin lines and prompt pi with each. */
async function runInteractive(session: {
  prompt(text: string): Promise<void>;
}): Promise<void> {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('› ');
  rl.prompt();
  for await (const line of rl) {
    const text = line.trim();
    if (text.length === 0) {
      rl.prompt();
      continue;
    }
    if (text === '/exit' || text === '/quit') break;
    await session.prompt(text);
    process.stdout.write('\n');
    rl.prompt();
  }
  rl.close();
}

// Auto-run only when launched as the entry script (PiBackend spawns it as a
// child process). Guarding this lets tests import the module — e.g. to unit
// test `toolsForPermission` — without executing the SDK path or calling
// process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    });
}
