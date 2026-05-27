# Delego

Multi-agent orchestration engine — see [docs/DESIGN.md](docs/DESIGN.md).

## Layout

```
delego/
├── apps/cli                     # @delego/cli — citty-based CLI
├── packages/
│   ├── types                    # @delego/types — interfaces
│   ├── core                     # @delego/core — profile, context, prompt, launcher
│   ├── skills                   # @delego/skills — fetch + vendor SKILL.md sources
│   ├── backend-base             # @delego/backend-base — spawn helpers
│   ├── backend-claude-code      # @delego/backend-claude-code
│   └── backend-copilot-cli      # @delego/backend-copilot-cli
└── docs/DESIGN.md
```

## Toolchain

- Bun ≥ 1.2
- TypeScript 5.6
- Turborepo 2.x

## Quick start (dev)

```bash
bun install
bun run --filter @delego/cli start -- --help
bun run --filter @delego/cli start -- agent create foo
bun run --filter @delego/cli start -- agent list
```

When installed globally (`bun install -g @delego/cli`), the binary is just `delego`.
