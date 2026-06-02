# @unliftedq/kman

> Multi-agent management tool.

`kman` is a runtime-agnostic CLI that manages a roster of named agent profiles (`orchestrator`, `developer`, `researcher`, …) on top of existing agent runtimes (Claude Code, GitHub Copilot CLI). Each agent is its own self-contained directory — its own soul prompt, skills, hooks, MCP servers, and permissions — and `kman` dispatches the right one for the job.

For the design rationale and full source, see the [project on GitHub](https://github.com/unliftedq/kman).

## Prerequisites

`kman` doesn't bundle a model runtime; it drives whichever backend you already have. Install **at least one** of:

- [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) — `claude` on `PATH` (or set `KMAN_CLAUDE_BIN`).
- [GitHub Copilot CLI](https://docs.github.com/copilot/how-tos/use-copilot-agents/use-copilot-cli) — `copilot` on `PATH` (or set `KMAN_COPILOT_BIN`).

Then verify with `kman doctor` after install.

## Install

```bash
# globally via bun
bun install -g @unliftedq/kman

# or via npm
npm install -g @unliftedq/kman
```

This installs the `kman` binary. Node ≥ 18 is required.

## Quick start

```bash
# 1. Create a specialized agent (claude-code by default).
kman agent create coder

# 2. Edit its soul prompt — the file body becomes the agent's system prompt.
$EDITOR ~/.kman/agents/coder/soul.md

# 3. Run a one-shot task.
kman -a coder run --task "Refactor the auth module to use the new session API."

# 4. Or start an interactive REPL.
kman -a coder chat
```

You can put `-a / --agent` either before the subcommand (`kman -a coder run …`) or after (`kman run -a coder …`).

## Common commands

### Lifecycle

```bash
kman agent create <name> [--runtime claude-code|copilot-cli] [--model <id>] \
                        [--description <text>] [--soul <text>]
kman agent list
kman agent show   <name>
kman agent rename <from> <to>
kman agent delete <name> [--yes]
```

`agent create` writes `~/.kman/agents/<name>/` with agent data only:

- `soul.md` — the agent's system prompt, plain markdown by default (edit this). The runtime injects the `name:`/`description:` frontmatter each backend needs at launch.
- `agent.toml` — kman profile (default backend, model, permissions).
- `skills/`, `hooks/`, `scripts/`, `mcp.json` — empty scaffolding for per-agent extensions.

No plugin files are written into the agent directory. At launch kman materializes a runtime-native plugin (name fixed to `kman`) under `~/.kman/runtime/<name>/.claude` or `.copilot` and points the backend at it; that directory is derived state, rebuilt on each run, and removed by `agent delete` / `agent rename`.

### Running

```bash
# One-shot, non-interactive.
kman -a coder run --task "Add a regression test for issue #421."

# Override the backend and model for a single call.
kman -a coder run --runtime copilot-cli --model gpt-5.2 --task "..."

# Raise permissions (auto = auto-approve tools, yolo = no prompts at all).
kman -a coder run --permission auto --task "..."

# JSON or streaming output for scripts.
kman -a coder run --output json   --task "..."
kman -a coder run --stream        --task "..."

# Pass a backend-native flag straight through.
kman -a coder run --runtime-flag --debug --task "..."
```

### Chat

```bash
kman -a coder chat
kman -a coder chat --permission auto
```

### Diagnostics

```bash
kman doctor                # global: env + backend binaries
kman -a coder doctor       # also checks the agent's directory layout
kman doctor --json         # machine-readable report
```

`doctor` reports `ok` / `info` / `warn` / `error` per check and exits non-zero on `error`.

## Environment variables

| Variable | Purpose |
|---|---|
| `KMAN_HOME` | Override agent root (default `~/.kman`). |
| `KMAN_CLAUDE_BIN` | Path to the `claude` binary if not on `PATH`. |
| `KMAN_COPILOT_BIN` | Path to the `copilot` binary if not on `PATH`. |
| `KMAN_DEBUG` | When set, print stack traces on unexpected errors. |

## Backend support

| Backend | Status | Required binary |
|---|---|---|
| `claude-code` | ✅ | `claude` |
| `copilot-cli` | ✅ | `copilot` |

The soul prompt is delivered through each backend's native agent mechanism, so the model treats it as a real system prompt rather than a user message.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | agent / runtime error |
| 2 | user / usage error |
| 3 | hook blocked |
| 4 | backend binary unavailable |
| 130 | interrupted (SIGINT / SIGTERM) |

## Links

- Source & design docs: <https://github.com/unliftedq/kman>
- Issues: <https://github.com/unliftedq/kman/issues>

## License

Apache-2.0
