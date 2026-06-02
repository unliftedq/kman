# Getting Started

This guide takes you from a clean machine to a running kman agent.

## Prerequisites

kman does **not** bundle a model runtime — it drives whichever backend you already have installed. Install **at least one** supported backend:

| Backend | Required binary | Install |
|---|---|---|
| Claude Code | `claude` on `PATH` (or set `KMAN_CLAUDE_BIN`) | [Claude Code docs](https://docs.claude.com/en/docs/claude-code/overview) |
| GitHub Copilot CLI | `copilot` on `PATH` (or set `KMAN_COPILOT_BIN`) | [Copilot CLI docs](https://docs.github.com/copilot/how-tos/use-copilot-agents/use-copilot-cli) |

You also need **Node ≥ 18** to run the published CLI.

## Install

### End users (npm package)

```bash
# globally via bun
bun install -g @unliftedq/kman

# or via npm
npm install -g @unliftedq/kman
```

This installs the `kman` binary. Verify your setup with:

```bash
kman doctor
```

### From source (development)

The repository is a Bun + Turborepo monorepo.

```bash
bun install
bun run kman --help
```

The build, type-check, and test tasks run through Turbo:

```bash
bun run build       # turbo run build
bun run typecheck   # turbo run typecheck
bun run test        # turbo run test
```

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

You can put the agent selector `-a / --agent` either **before** the subcommand
(`kman -a coder run …`) or **after** it (`kman run -a coder …`).

## What just happened

1. `kman agent create coder` wrote `~/.kman/agents/coder/` containing the agent's editable data — `agent.toml`, `soul.md`, and empty `skills/`, `hooks/`, `scripts/`, and `mcp.json` scaffolding.
2. On `run` / `chat`, kman built an immutable `AgentContext` from the profile and soul, prepared generated launch state under `~/.kman/runtime/coder/`, and started the selected runtime.
3. The backend's stdout/stderr streamed straight back to your terminal. kman never sits in the I/O path, and session state stays in the backend's own storage.

## Next steps

- Learn the model: [Concepts](./concepts.md).
- Author your agent: [Agents & Profiles](./agents.md).
- Add capabilities: [Skills](./skills.md) and [Hooks & MCP](./hooks-and-mcp.md).
- Look up any command: [CLI Reference](./cli-reference.md).

## Example agents

For a curated collection of portable, domain-focused agents you can copy or
dispatch directly, see [unliftedq/agents](https://github.com/unliftedq/agents).
Each agent is a self-contained folder capturing its persona, skills, tools, and
permissions.
