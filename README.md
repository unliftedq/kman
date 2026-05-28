# kman

Multi-agent orchestration engine, *inspired by [Kingsman](https://en.wikipedia.org/wiki/Kingsman:_The_Secret_Service)* — a small society of named, well-tailored agents you can dispatch on a mission. See [docs/DESIGN.md](docs/DESIGN.md) for the architecture.

## Why kman?

Modern coding agents (Claude Code, Copilot CLI, …) keep growing in capability: more skills, more MCP servers, more hooks, more tools. Piling all of that into a single, general-purpose agent quickly stops scaling — both for the model and for the human driving it. kman’s answer is **agent-level isolation**, in the spirit of [Agent-Level Isolation for AI Agents](https://wangqiao.me/posts/agent-level-isolation-for-ai-agents/): instead of one omniscient assistant, run a small society of narrow, well-tailored agents and dispatch the right one for the mission.

Concretely, that buys you:

- **Context isolation, not skill bloat.** Each agent only sees its own `~/.kman/agents/<name>/` plugin directory — its own skills, hooks, MCP servers, and soul prompt. Skills are *not* eagerly merged into one giant catalog shared by every session, so a `coder` agent doesn’t pay tokens for a `researcher`’s web-scraping skills, and vice versa. Smaller context → cheaper runs, faster responses, fewer “lost in the middle” failures.
- **Focus by construction.** An agent is defined by a single `soul.md` plus a curated set of skills/tools. Because the surface area is intentionally narrow, the model is biased toward what it’s actually good at instead of negotiating between dozens of half-relevant capabilities. You get specialists (`coder`, `reviewer`, `researcher`, `release-bot`, …) rather than one overworked generalist.
- **Blast-radius isolation.** Permissions, MCP servers, and hooks are scoped per agent, not global. A `researcher` that browses the open web doesn’t share credentials or write-access with a `release-bot` that can push tags. Misbehavior — accidental `rm -rf`, prompt injection from a fetched page, an over-eager tool call — is contained to the agent that was dispatched, not your whole toolchain.
- **Backend-agnostic, profile-portable.** The same named agent profile runs on top of `claude-code` today and `copilot-cli` / `codex` / `gemini` tomorrow. You isolate *the agent*, not *the vendor*: switching backends doesn’t mean re-curating skills, hooks, and prompts from scratch.
- **Reproducible and shareable.** Because every agent is just a directory (a valid Claude Code plugin layout), agents are versionable, diffable, and shareable. Teams can ship a `frontend-reviewer` the same way they ship a linter config, instead of passing around a 3-page system prompt in Notion.
- **Composable instead of monolithic.** v1 keeps orchestration simple — shell pipes between `kman run --agent ...` invocations — but the isolation boundary is the same one future multi-agent flows, desktop UIs, and remote gateways will build on. You don’t have to re-architect later to get sub-agent delegation; the agents are already separate citizens.

In short: **don’t build one giant agent that knows everything. Build many small agents that each know one thing well, and let kman dispatch them.**

## Layout

```
.
├── apps/cli                       # @unliftedq/kman — the published CLI (binary: kman)
├── packages/                      # all internal, all private (not published)
│   ├── types                      # @kman/types — shared interfaces
│   ├── core                       # @kman/core — profile, context, prompt, launcher
│   ├── skills                     # @kman/skills — fetch + vendor SKILL.md sources
│   ├── backend-base               # @kman/backend-base — spawn helpers
│   ├── backend-claude-code        # @kman/backend-claude-code
│   └── backend-copilot-cli        # @kman/backend-copilot-cli
└── docs/DESIGN.md
```

Only `@unliftedq/kman` is intended for npm publication; every workspace package under `packages/` is marked `"private": true`.

## Toolchain

- Bun ≥ 1.2
- TypeScript 5.9
- Turborepo 2.x
- commander 14.x

## Quick start (dev)

```bash
bun install
bun run kman --help
bun run kman agent create coder
bun run kman agent list
```

Once published and installed globally (`bun install -g @unliftedq/kman`), the binary is just `kman`.

## License

Apache-2.0 — see [LICENSE](LICENSE).
