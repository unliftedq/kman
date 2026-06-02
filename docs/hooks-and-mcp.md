# Hooks & MCP

kman does not provide `mcp` or `hook` editing subcommands. Instead you edit the
agent-directory files directly. At launch, kman passes those files to the
selected runtime when that runtime supports the feature.

The relevant per-agent files are:

- `~/.kman/agents/<name>/mcp.json` — per-agent MCP servers.
- `~/.kman/agents/<name>/hooks/hooks.json` — hook configuration.
- `~/.kman/agents/<name>/scripts/` — hook / utility scripts referenced by `hooks.json`.

## Per-agent MCP servers — `mcp.json`

Use an `mcpServers` object for per-agent MCP servers:

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

- If the selected runtime supports per-agent MCP servers, it loads this file for the agent. If it does not, the configured servers are not started — but kman still validates the file's shape regardless of runtime support (see next point).
- If `mcp.json` references an invalid server or command shape, kman exits with code `2` before spawning the backend.

> This file configures MCP servers that **the agent uses**. For making agents
> callable by *each other*, see [Multi-Agent Dispatch](./multi-agent.md).

## Hooks — `hooks/hooks.json`

Hook configuration uses the selected runtime's hook format. Scripts live under
`scripts/`; use the path and substitution variables documented by that runtime
to reference them from `hooks.json`. For the currently supported hook format,
see the [Claude Code hooks reference](https://docs.anthropic.com/en/docs/claude-code/hooks).

Supported hook events, types, matcher semantics, and substitution variables are
defined by the selected runtime. Backends that do not implement a given hook
event silently ignore it. A hook that blocks execution causes kman to exit with
code `3`.

## Secrets

Never store secrets in plaintext config. Use the runtime's `userConfig` with
`"sensitive": true`, or supply secrets through the launch environment, then
reference them via `${user_config.KEY}` / `${ENV_VAR}` in `mcp.json` and
`hooks/hooks.json`.

## Related

- Diagnose hook/MCP problems: [Troubleshooting](./troubleshooting.md).
