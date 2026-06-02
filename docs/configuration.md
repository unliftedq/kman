# Configuration

kman reads roster-wide defaults from `~/.kman/config.json` and adjusts its
behavior through a small set of environment variables.

## Global config — `~/.kman/config.json`

`config.json` holds **roster-wide defaults**, kept separate from per-agent
`agent.toml`. Its job is to seed new agents created via `kman agent create` when
the matching flag is omitted, so a user who lives on one backend never has to
repeat `--runtime`. The file is JSON (not TOML) so it can be edited by hand or
via `kman config set`.

```json
{
  "defaults": {
    "runtime": "copilot-cli",
    "model": "gpt-5",
    "permission_mode": "ask",
    "output_format": "text",
    "max_turns": 50
  }
}
```

| Key | Values | Notes |
|---|---|---|
| `defaults.runtime` | `claude-code` \| `copilot-cli` | Default backend for new agents. May also name a future backend (forward-compat); `kman doctor` warns. |
| `defaults.model` | model id string | Optional. |
| `defaults.permission_mode` | `ask` \| `auto` \| `yolo` | Optional. |
| `defaults.output_format` | `text` \| `json` \| `stream-json` | Optional. |
| `defaults.max_turns` | positive integer | Optional. |

Behavior:

- **Missing file is not an error.** When `config.json` is absent, kman falls back to a built-in baseline (`defaults.runtime = "claude-code"`), so first-run usage works with zero setup.
- **Precedence at create time.** An explicit `agent create` flag always wins; otherwise the value comes from `config.json`; otherwise the built-in default.
- **Existing agents are never rewritten** when `config.json` changes — only future creations read it.
- **Validated on read/write.** `permission_mode`, `output_format`, and `max_turns` are checked against the same rules as `agent.toml`.

### Managing it

```bash
kman config show [--json]                  # effective config (built-in ⊕ config.json)
kman config path                           # print path to config.json
kman config get  defaults.runtime
kman config set  defaults.runtime copilot-cli
kman config unset defaults.model           # revert to built-in default
```

`kman config` is a non-agent command and rejects `--agent`.

## Environment variables

| Variable | Purpose |
|---|---|
| `KMAN_HOME` | Override the kman root (default `~/.kman`). |
| `KMAN_CLAUDE_BIN` | Path to the `claude` binary if it is not on `PATH`. |
| `KMAN_COPILOT_BIN` | Path to the `copilot` binary if it is not on `PATH`. |
| `KMAN_NO_MCP` | When set to `1`, disable kman MCP auto-injection for the process. |
| `KMAN_BIN` | Executable used for re-shelling inside spawned backends (MCP dispatch). |
| `KMAN_SELF_AGENT` | Set automatically at spawn time so the MCP server can hide the calling agent and refuse self-dispatch. |
| `KMAN_RUN_CHAIN` | Comma-separated delegation stack used for cycle/depth protection. |
| `KMAN_DEBUG` | When set, print stack traces on unexpected errors. |

Most `KMAN_SELF_AGENT` / `KMAN_RUN_CHAIN` values are managed by kman itself; you
normally set only `KMAN_HOME`, the `*_BIN` overrides, `KMAN_NO_MCP`, and
`KMAN_DEBUG`.

## Related

- Per-agent profile fields: [Agents & Profiles](./agents.md).
- Cross-agent dispatch variables in context: [Multi-Agent Dispatch](./multi-agent.md).
