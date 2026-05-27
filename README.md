# kman

Multi-agent orchestration engine, *inspired by [Kingsman](https://en.wikipedia.org/wiki/Kingsman:_The_Secret_Service)* — a small society of named, well-tailored agents you can dispatch on a mission. See [docs/DESIGN.md](docs/DESIGN.md) for the architecture.

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
