# `apps/` — future surfaces

v1 ships only `cli/`. The directories below are reserved for future workspace packages — see `docs/DESIGN.md` §1.

- `desktop/` — likely Tauri (Rust shell) wrapping `@delego/core`
- `web/` — likely Next/Nuxt UI talking to `@delego/core` via a thin HTTP layer
- `gateway/` — long-running daemon exposing Telegram/Discord/Slack adapters

These directories intentionally don't exist yet; they will be added when the work begins.
