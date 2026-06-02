# Concepts

This page explains the vocabulary and the mental model behind kman.

## kman is a manager, not a runtime

kman is **not** another agent runtime. It is an **agent manager** that sits above
existing runtimes (`claude-code`, `copilot-cli`, and later `codex`, `gemini`, …)
and gives them three things they lack as a system:

1. **Named agent profiles** — each agent has its own soul, plugin files, and default runtime, addressable by name.
2. **A backend-agnostic CLI** — one set of commands, one profile format, regardless of which underlying runtime does the work.
3. **Claude Code plugin compatibility** — every kman agent is materialized into a valid Claude Code / Copilot plugin at launch, so skills / hooks / MCP servers / commands written for the broader ecosystem work unchanged.

kman never calls an LLM API directly. All inference happens inside the chosen
backend.

## The core vocabulary

| Term | Meaning |
|---|---|
| **Agent** | A named profile living at `~/.kman/agents/<name>/`. Its data is a soul prompt, a TOML profile, and per-agent skills, hooks, scripts, and MCP servers. |
| **Soul** | The agent's persona / system prompt, stored in `soul.md`. The file body becomes a real system prompt; YAML frontmatter (`name:`, `description:`) identifies the contributed agent. |
| **Profile** | `agent.toml` — the runtime defaults (backend, model, permissions, output format, max turns). |
| **Backend / runtime** | The underlying agent runtime that actually runs inference (`claude-code`, `copilot-cli`). |
| **AgentContext** | The immutable object kman builds before spawning a backend; the single source of truth for a run. See [Architecture](./architecture.md). |
| **Runtime plugin** | The backend-native plugin layout kman *derives* at launch under `~/.kman/runtime/<name>/`. Not stored in the agent directory. |
| **Skill** | A vendored `SKILL.md` directory installed into an agent's `skills/`. |

## Agent names

Agent names are lowercase kebab-case, matching `^[a-z][a-z0-9-]{0,62}$`. Names
are case-sensitive in CLI input and on disk. Agent-scoped commands select the
target with the global `-a, --agent <name>` option, which may appear before or
after the subcommand.

## Why agent-level isolation

Modern runtimes keep growing in capability — more skills, more MCP servers, more
hooks, more tools. Piling all of that into a single, general-purpose
configuration stops scaling, both for the model and for the human driving it.
kman's answer is **agent-level isolation**: instead of one omniscient assistant,
run a small society of narrow, well-tailored agents (`orchestrator`,
`developer`, `researcher`, …) and dispatch the right one for the mission.

Concretely, that buys you:

- **Context isolation, not skill bloat.** Each agent only sees its own `~/.kman/agents/<name>/` directory. Skills are *not* eagerly merged into one giant catalog, so a `coder` agent doesn't pay tokens for a `researcher`'s web-scraping skills.
- **Focus by construction.** An agent is a single soul prompt plus a curated set of skills/tools. The narrow surface area biases the model toward what it's good at.
- **Blast-radius isolation.** Permissions, MCP servers, and hooks are scoped per agent, not global. A `researcher` that browses the open web doesn't share credentials or write-access with a `release-bot` that can push tags.
- **Backend-agnostic, profile-portable.** The same named agent profile runs on `claude-code` and `copilot-cli`; switching backends doesn't mean re-curating skills, hooks, and prompts.
- **Reproducible and shareable.** Every agent is plain data in a directory, so it is versionable, diffable, and shareable like a linter config.
- **Composable instead of monolithic.** v1 keeps cross-agent composition simple — shell pipes and the kman MCP server — but the isolation boundary is the same one future multi-agent flows will build on.

> In short: don't build one giant agent that knows everything. Build many small
> agents that each know one thing well, and let kman dispatch them.

## v1 scope and non-goals

kman v1 ships only the CLI. To keep the surface honest, several things are
**intentionally out of scope** for v1:

- **No own LLM runtime.** All inference happens inside the chosen backend.
- **No workflow DSL.** Multi-agent composition is shell pipes plus the MCP server (see [Multi-Agent Dispatch](./multi-agent.md)) — there is no `kman flow` command or YAML pipeline.
- **No session management.** v1 relies entirely on each backend's native session storage and resume. kman does not capture, normalize, index, or search sessions.
- **No project-local profiles.** All agents live under `~/.kman/`; there is no `.kman/` inside repositories.
- **No skill template system.** New agents start with an empty skills directory.
- **No shell / HTTP custom tools.** v1 only wires MCP tools through `mcp.json`.
- **No Codex / Gemini adapters yet.** v1 implements `claude-code` and `copilot-cli` first; the adapter shape is in place for the others.
- **No compiled binary distribution yet.** v1 ships as an npm package consumed via Bun/npm. Native binaries and OS packaging are future work.

What *does* ship in v1 beyond the basics: `kman mcp` (cross-agent dispatch),
`kman config` (roster-wide defaults), and a baseline `kman doctor`.

## Status

| Backend | Status | Notes |
|---|---|---|
| `claude-code` | ✅ supported | requires `claude` on `PATH` (or `KMAN_CLAUDE_BIN`) |
| `copilot-cli` | ✅ supported | requires `copilot` on `PATH` (or `KMAN_COPILOT_BIN`) |
| `codex` / `gemini` | future | adapter shape is in place; not implemented |

kman is pre-1.0. The layout and flag surface may still change.
