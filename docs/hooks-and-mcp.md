# Hooks & MCP

kman does not provide `mcp` or `hook` editing subcommands. Instead you edit the
agent-directory files directly; they are mapped into the derived runtime plugin
at launch. Format, events, environment variables, and path substitution all
follow the Claude Code plugin spec.

The relevant per-agent files are:

- `~/.kman/agents/<name>/mcp.json` — per-agent MCP servers.
- `~/.kman/agents/<name>/hooks/hooks.json` — hook configuration.
- `~/.kman/agents/<name>/scripts/` — hook / utility scripts referenced by `hooks.json`.

> The materialized `~/.kman/runtime/<name>/.{claude,copilot}/` plugin is generated
> output, rebuilt on each launch. Do **not** edit files there for persistent
> customization — edit the agent-directory files above.

## Per-agent MCP servers — `mcp.json`

Standard Claude Code plugin MCP configuration. It is materialized as `.mcp.json`
inside the runtime plugin at launch:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${user_config.github_token}" }
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp"]
    }
  }
}
```

- `mcp.json` is loaded by the backend through its Claude Code plugin support. If the backend does not support MCP servers, the file is ignored.
- If `mcp.json` references an invalid server or command shape, kman exits with code `2` before spawning the backend.

> This file configures MCP servers that **the agent uses**. For making agents
> callable by *each other*, see [Multi-Agent Dispatch](./multi-agent.md).

## Hooks — `hooks/hooks.json`

Hook configuration uses the Claude Code plugin hook format. Scripts live under
`scripts/` and are referenced via `${CLAUDE_PLUGIN_ROOT}`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/check-env.sh" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/notify.sh" }
        ]
      }
    ]
  }
}
```

Supported hook events, types, and matcher semantics are exactly those defined by
Claude Code's plugin hook system (see the
[Plugins reference → Hooks](https://code.claude.com/docs/en/plugins-reference)).
Backends that do not implement a given hook event silently ignore it. A hook
that blocks execution causes kman to exit with code `3`.

## Path substitution

Inside plugin files you can use the runtime's substitution variables:

- `${CLAUDE_PLUGIN_ROOT}` — the materialized plugin root.
- `${CLAUDE_PLUGIN_DATA}` — the plugin data directory.
- `${CLAUDE_PROJECT_DIR}` — the working directory of the run.
- `${user_config.KEY}` — a value from the runtime's `userConfig`.
- `${ENV_VAR}` — an environment variable from the launch environment.

## Secrets

Never store secrets in plaintext config. Use the runtime's `userConfig` with
`"sensitive": true`, or supply secrets through the launch environment, then
reference them via `${user_config.KEY}` / `${ENV_VAR}` in `mcp.json` and
`hooks/hooks.json`.

## Related

- Where these files land at launch: [Architecture](./architecture.md).
- Diagnose hook/MCP problems: [Troubleshooting](./troubleshooting.md).
