# kman

> Multi-agent management tool, *name is inspired by [Kingsman](https://en.wikipedia.org/wiki/Kingsman:_The_Secret_Service)* — a small society of named, well-tailored agents you can dispatch on a mission.

`kman` sits *above* existing agent runtimes (Claude Code, GitHub Copilot CLI, ...) and gives each named agent its own isolated directory, soul prompt, skills, hooks, and MCP servers. One CLI to dispatch them all; one filesystem layout that every supported runtime can load natively.

See [docs/DESIGN.md](docs/DESIGN.md) for the architecture, or jump straight to the published CLI: **[`@unliftedq/kman`](apps/cli/README.md)**.

## Why kman?

Modern agent runtimes (Claude Code, Copilot CLI, …) keep growing in capability: more skills, more MCP servers, more hooks, more tools. Piling all of that into a single, general-purpose configuration quickly stops scaling — both for the model and for the human driving it. kman's answer is **agent-level isolation**, in the spirit of [Agent-Level Isolation for AI Agents](https://wangqiao.me/posts/agent-level-isolation-for-ai-agents/): instead of one omniscient assistant, run a small society of narrow, well-tailored agents — `orchestrator`, `developer`, `researcher`, … — and dispatch the right one for the mission.

Concretely, that buys you:

- **Context isolation, not skill bloat.** Each agent only sees its own `~/.kman/agents/<name>/` directory — its own skills, hooks, MCP servers, and soul prompt. Skills are *not* eagerly merged into one giant catalog shared by every session, so a `coder` agent doesn't pay tokens for a `researcher`'s web-scraping skills, and vice versa. Smaller context → cheaper runs, faster responses, fewer "lost in the middle" failures.
- **Focus by construction.** An agent is defined by a single soul prompt plus a curated set of skills/tools. Because the surface area is intentionally narrow, the model is biased toward what it's actually good at instead of negotiating between dozens of half-relevant capabilities. You get specialists (`coder`, `reviewer`, `researcher`, `release-bot`, …) rather than one overworked generalist.
- **Blast-radius isolation.** Permissions, MCP servers, and hooks are scoped per agent, not global. A `researcher` that browses the open web doesn't share credentials or write-access with a `release-bot` that can push tags. Misbehavior — accidental `rm -rf`, prompt injection from a fetched page, an over-eager tool call — is contained to the agent that was dispatched, not your whole toolchain.
- **Backend-agnostic, profile-portable.** The same named agent profile runs on top of `claude-code` and `copilot-cli` today, with `codex` / `gemini` adapters tractable as future work. You isolate *the agent*, not *the vendor*: switching backends doesn't mean re-curating skills, hooks, and prompts from scratch.
- **Reproducible and shareable.** Because every agent is just a directory — loadable natively by every supported runtime — agents are versionable, diffable, and shareable. Teams can ship a `frontend-reviewer` the same way they ship a linter config, instead of passing around a 3-page system prompt in Notion.
- **Composable instead of monolithic.** v1 keeps cross-agent composition simple — shell pipes between `kman run --agent ...` invocations — but the isolation boundary is the same one future multi-agent flows, desktop UIs, and remote gateways will build on. You don't have to re-architect later to get sub-agent delegation; the agents are already separate citizens.

In short: **don't build one giant agent that knows everything. Build many small agents that each know one thing well, and let kman dispatch them.**

## How it works

Every agent lives at `~/.kman/agents/<name>/` as a self-contained directory: a `soul.md` (the agent's character), an `agent.toml` profile (runtime, model, permissions), and per-agent skills, hooks, and MCP servers. The same directory is loaded natively by both Claude Code and Copilot CLI — kman translates your `kman -a <name> run …` invocation into the right runtime command, and the soul arrives as a real system prompt instead of an ad-hoc injection.

## Status

| Backend | Status | Notes |
|---|---|---|
| `claude-code` | ✅ supported | requires `claude` on PATH (or `KMAN_CLAUDE_BIN`) |
| `copilot-cli` | ✅ supported | requires `copilot` on PATH (or `KMAN_COPILOT_BIN`) |
| `codex` / `gemini` | future | adapter shape is in place; not implemented |

Pre-1.0. Layout and flag surface may still change.

## Quick start (dev)

```bash
bun install
bun run kman --help
bun run kman agent create coder --runtime claude-code
bun run kman -a coder run --task "Refactor the auth module."
```

For end-user install via npm, see [`apps/cli/README.md`](apps/cli/README.md).

## Layout

```
.
├── apps/cli                       # @unliftedq/kman — the published CLI (binary: kman)
├── packages/                      # all internal, all private (not published)
│   ├── types                      # @kman/types — shared interfaces
│   ├── core                       # @kman/core — profile, context, prompt, launcher, doctor
│   ├── skills                     # @kman/skills — fetch + vendor SKILL.md sources
│   ├── backend-base               # @kman/backend-base — spawn helpers
│   ├── backend-claude-code        # @kman/backend-claude-code
│   └── backend-copilot-cli        # @kman/backend-copilot-cli
├── scripts/                       # one-shot migration helpers
└── docs/DESIGN.md
```

## Toolchain

- Bun ≥ 1.2
- TypeScript 5.9
- Turborepo 2.x
- commander 14.x

## License

Apache-2.0 — see [LICENSE](LICENSE).
