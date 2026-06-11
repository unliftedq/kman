# kman Documentation

> A multi-agent management tool. v1 ships as a CLI; the same core is designed to power future desktop / web / gateway surfaces.

`kman` sits *above* existing agent runtimes (Claude Code, GitHub Copilot CLI, …) and gives each **named agent** its own isolated directory: a soul prompt, skills, hooks, MCP servers, and permissions. One CLI dispatches them all while keeping each agent's files separate and portable.

These docs describe how to install, configure, and operate kman, plus the architecture behind it.

## Where to start

| If you want to… | Read |
|---|---|
| Install kman and run your first agent | [Getting Started](./getting-started.md) |
| Understand what an "agent" is and why isolation matters | [Concepts](./concepts.md) |
| See how a run is assembled and launched | [Architecture](./architecture.md) |
| Look up a command or flag | [CLI Reference](./cli-reference.md) |
| Author an agent's profile and soul | [Agents & Profiles](./agents.md) |
| Add or update skills | [Skills](./skills.md) |
| Wire hooks and per-agent MCP servers | [Hooks & MCP](./hooks-and-mcp.md) |
| Let agents call each other | [Multi-Agent Dispatch](./multi-agent.md) |
| Run tasks in the background on a schedule | [Daemon & Task Scheduling](./daemon.md) |
| Set global defaults and environment variables | [Configuration](./configuration.md) |
| Diagnose a problem | [Troubleshooting](./troubleshooting.md) |

## Table of contents

1. [Getting Started](./getting-started.md) — prerequisites, install, quick start.
2. [Concepts](./concepts.md) — agents, souls, profiles, backends, agent-level isolation.
3. [Architecture](./architecture.md) — the `AgentContext` pipeline, runtime handoff, and repository layout.
4. [CLI Reference](./cli-reference.md) — every command, flag, and exit code.
5. [Agents & Profiles](./agents.md) — the agent directory, `agent.toml`, and `soul.md`.
6. [Skills](./skills.md) — discovering, installing, pinning, and updating skills.
7. [Hooks & MCP](./hooks-and-mcp.md) — per-agent `hooks/hooks.json`, `scripts/`, and `mcp.json`.
8. [Multi-Agent Dispatch](./multi-agent.md) — cross-agent invocation via the kman MCP server and shell composition.
9. [Daemon & Task Scheduling](./daemon.md) — the resident daemon, task queue, OS hosts, and tray.
10. [Configuration](./configuration.md) — `~/.kman/config.json` defaults and environment variables.
11. [Troubleshooting](./troubleshooting.md) — `kman doctor`, exit codes, and common failures.

## Project at a glance

- **Manager, not a runtime.** kman never calls an LLM API directly — all inference happens inside the chosen backend (Claude Code or Copilot CLI in v1).
- **Agent-level isolation.** Each agent only sees its own `~/.kman/agents/<name>/` directory, so permissions, skills, hooks, and MCP servers are scoped per agent instead of piled into one global config.
- **Backend-agnostic, profile-portable.** The same named agent runs on `claude-code` and `copilot-cli` today, with `codex` / `gemini` adapters as future work.

For installation and end-user CLI usage, see also the published package docs in [`apps/cli/README.md`](../apps/cli/README.md).
