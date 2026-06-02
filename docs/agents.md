# Agents & Profiles

An **agent** is a named directory at `~/.kman/agents/<name>/`. It holds **only
genuine agent data** — profile, soul, skills, hooks, MCP config. The backend
plugin layout is *not* stored here; it is derived at launch under
`~/.kman/runtime/<name>/` (see [Architecture](./architecture.md)).

## Directory layout

```
~/.kman/
├── config.json                        # global defaults for new agents (see Configuration)
└── agents/
    └── coder/                         # agent directory = agent data only
        ├── agent.toml                 # kman profile (runtime, model, defaults)
        ├── soul.md                    # system prompt + plugin agent frontmatter (name:)
        ├── skills/                    # skills: <name>/SKILL.md
        │   └── humanizer/
        │       ├── SKILL.md
        │       └── .kman-skill.json   # vendoring manifest (source / version / checksum)
        ├── commands/                  # flat slash commands (optional)
        ├── hooks/
        │   └── hooks.json             # hook configuration
        ├── scripts/                   # hook / utility scripts referenced from hooks.json
        ├── mcp.json                   # MCP server configuration (mapped to .mcp.json at launch)
        ├── bin/                       # executables added to the backend Bash PATH
        └── logs/
            └── agent.log              # kman-side diagnostic log (not session data)
```

Notes:

- **kman-specific files** are `agent.toml`, `soul.md`, and `.kman-skill.json` inside each vendored skill. The runtimes ignore top-level fields and files they don't recognize, so these coexist cleanly with the plugin spec.
- **No plugin scaffolding in the agent dir.** Manifest files and `agents/<name>.md` are generated under `~/.kman/runtime/<name>/` at launch, so the agent directory stays a clean, diffable record of intent.
- **`bin/`** follows Claude Code semantics: executables become bare commands inside the backend's Bash tool while the plugin is enabled. It does not mutate kman's own process `PATH`. Prefer an agent-specific prefix to avoid shadowing system commands.
- **No `sessions/` directory.** Sessions live in the backend's own storage; kman does not write a unified session log in v1.

## `agent.toml`

```toml
name        = "coder"
description = "Senior backend engineer agent"

[runtime]
default = "claude-code"                  # claude-code | copilot-cli in v1
model   = "claude-sonnet-4.5"            # passed to backend; backend default if omitted

[soul]
prompt_file = "soul.md"                  # relative to agent dir; default "soul.md"

[defaults]
max_turns       = 50
permission_mode = "ask"                   # ask | auto | yolo
output_format   = "text"                  # text | json | stream-json

# Optional: backend-specific escape hatches
[runtime.claude-code]
permission_mode_raw = "plan"              # bypasses abstract mapping for this backend
extra_args = ["--include-partial-messages"]

[runtime.copilot-cli]
extra_args = ["--some-native-flag"]
```

CLI overrides (`--runtime`, `--model`, `--permission`, …) act on the in-memory
`AgentContext` for a single call; the on-disk profile stays immutable.

## `soul.md`

`soul.md` is the agent's persona. The file **body** becomes the agent's system
prompt; YAML frontmatter identifies the contributed agent. Edit this file
directly to shape how your agent thinks and behaves:

```markdown
---
name: coder
description: Senior backend engineer agent
---

You are a meticulous senior backend engineer. Prefer small, surgical changes…
```

- `claude-code` materializes the soul as `agents/<name>.md`.
- `copilot-cli` materializes it as `agents/<name>.agent.md` and requires a `description:` in the frontmatter.

The soul is delivered through each backend's native agent mechanism, so the
model treats it as a real system prompt rather than a user message. If a selected
backend cannot accept the rendered soul prompt, kman exits with code `4` before
spawning.

## Permission levels

kman exposes an abstract permission level, mapped to each backend's native mode:

| Level | Meaning |
|---|---|
| `ask` | Prompt before tool use (default). |
| `auto` | Auto-approve tool use. |
| `yolo` | No prompts at all. |

Set the default in `agent.toml` (`defaults.permission_mode`) or override per call
with `--permission`. For backend-specific modes that don't map cleanly, use
`runtime.<backend>.permission_mode_raw` or pass `--runtime-flag` directly.

## Secrets

Never store secrets in plaintext config. Use the runtime's `userConfig` with
`"sensitive": true`, or supply secrets through the launch environment, then
reference them via `${user_config.KEY}` / `${ENV_VAR}` in `mcp.json` and
`hooks/hooks.json`. See [Hooks & MCP](./hooks-and-mcp.md).

## Related

- Add capabilities: [Skills](./skills.md), [Hooks & MCP](./hooks-and-mcp.md).
- Command details: [CLI Reference](./cli-reference.md).
