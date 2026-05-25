# delego

A multi-agent orchestration engine. v1 ships as a CLI; future surfaces (desktop / web / gateway) reuse the same core.

See [docs/DESIGN.md](docs/DESIGN.md) for the full design.

## Status

🚧 Early skeleton — not yet usable. See the milestone roadmap in DESIGN.md §10.

## Development

```bash
bun install
bun run delego --help
```

## Layout

- `apps/cli/` — the CLI entry point (only v1 app)
- `packages/core/` — `AgentContext`, profile, launcher, sessions, hooks, secrets
- `packages/mcp-server/` — the in-process / standalone `delego` MCP server (memory + delegate tools)
- `packages/backend-*/` — one package per supported runtime backend
- `packages/skills/` — skill install / vendor / manifest
- `packages/types/` — shared TypeScript types
- `apps/{desktop,web,gateway}/` — future surfaces (empty placeholders)
