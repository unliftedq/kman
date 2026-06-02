# CLI Reference

All commands follow strict noun-verb grammar. There is no dynamic
agent-as-subcommand form. Agent management commands may use positional agent
names for readability; other user-provided values are passed through options.

## Agent selection

Agent-scoped commands select the target agent with the global `-a, --agent
<name>` option, accepted **before or after** the subcommand:

```bash
kman skills list --agent coder
kman -a coder skills list
kman --agent coder run --task "..."
```

If `--agent` appears more than once, kman exits with code `2`. Agent-scoped
commands require `--agent`; non-agent commands (like `config`) reject it.

## `kman agent` — lifecycle

```bash
kman agent create <name> [flags]
  --runtime <backend>          # default backend (claude-code | copilot-cli)
  --model <id>                 # default model
  --description "<text>"       # short label for what the agent is for
  --soul "<text>"              # initial soul prompt body (written to soul.md)

kman agent list                # all agents
kman agent show <name>         # profile + paths
kman agent rename <from> <to>
kman agent delete <name> [--yes]
```

`agent create` scaffolds an agent directory with **agent data only**
(`agent.toml`, `soul.md` with its `name:` frontmatter, `skills/`, `hooks/`,
`scripts/`, `mcp.json`). Runtime-specific launch state is generated separately
under `~/.kman/runtime/<name>/`. `agent delete` / `agent rename` also drop the
matching runtime directory.

When `--runtime` / `--model` (and the `defaults.*` fields) are omitted, the new
profile is seeded from `~/.kman/config.json` (see [Configuration](./configuration.md)),
falling back to the built-in defaults.

## `kman config` — global defaults

```bash
kman config show [--json]                  # effective config (built-in ⊕ config.json)
kman config path                           # print path to config.json
kman config get  defaults.runtime
kman config set  defaults.runtime copilot-cli   # writes ~/.kman/config.json
kman config unset defaults.model           # revert to built-in default
```

Settable keys: `defaults.runtime`, `defaults.model`, `defaults.permission_mode`,
`defaults.output_format`, `defaults.max_turns`. `kman config` is a non-agent
command and rejects `--agent`. See [Configuration](./configuration.md) for details.

## `kman skills` — per-agent skills

```bash
kman skills add    --agent coder --source <source> [--ref <branch|tag|sha>]
kman skills add    --agent coder --source <source> --skill <name>   # repeatable
kman skills add    --agent coder --source <source> --all
kman skills add    --agent coder --source <source> --force           # overwrite existing
kman skills list   --agent coder
kman skills show   --agent coder --skill <name>
kman skills update --agent coder --skill <name> [--force]
kman skills update --agent coder --all
kman skills remove --agent coder --skill <name>
```

`skills add` discovers all candidate `SKILL.md` directories from `--source`. With
exactly one candidate it installs it; with multiple, `--skill` filters by name,
`--all` installs every candidate, and an interactive picker is shown only when
neither option is provided. See [Skills](./skills.md).

## `kman run` — one-shot task

```bash
kman run --agent coder --task "..." [flags]
  --runtime <backend>                # override profile default for this call
  --model <id>                       # override
  --permission ask|auto|yolo         # abstract permission level
  --runtime-flag <flag>              # pass a backend-native flag through (repeatable)
  --output text|json|stream-json     # default text; passed through to backend
  --stream                           # implies --output stream-json
  --cwd <path>                       # working directory for the backend process
```

`--stream` conflicts with `--output` of a different value.

## `kman chat` — interactive session

```bash
kman chat --agent coder [flags]
  --runtime <backend>
  --model <id>
  --permission ask|auto|yolo
  --runtime-flag <flag>              # repeatable
  --cwd <path>
```

## Resuming a previous conversation

Resume uses the backend's native mechanism, exposed via `--runtime-flag`:

```bash
# claude-code:
kman run  --agent coder --runtime-flag --continue --task "next step"
kman chat --agent coder --runtime-flag --resume=<id>
```

A first-class, backend-neutral resume UX is future work.

## `kman mcp` — cross-agent dispatch

```bash
# Stdio MCP server — what an external runtime spawns.
kman mcp [--self <name>] [--self-from-env] [--run-timeout <ms>]

# Register / unregister with an external runtime's user-scope config.
kman mcp install   claude-code  [--scope user|project] [--force]
kman mcp install   copilot-cli                          [--force]
kman mcp uninstall claude-code  [--scope user|project]
kman mcp uninstall copilot-cli

# Print a paste-ready JSON snippet for hosts that aren't directly supported.
kman mcp config
```

Auto-injection during `kman run` / `kman chat` is on by default; set
`KMAN_NO_MCP=1` in the parent shell to disable it. See [Multi-Agent Dispatch](./multi-agent.md).

## `kman doctor` — diagnostics

```bash
kman doctor                # global: env + backend binaries
kman -a coder doctor       # also checks the agent's directory layout
kman doctor --json         # machine-readable report
```

`doctor` reports `ok` / `info` / `warn` / `error` per check and exits non-zero on
`error`. See [Troubleshooting](./troubleshooting.md).

## `kman version` / help

```bash
kman version
kman --version    # -v
kman --help       # -h
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | agent / runtime error (LLM / tool / backend reported) |
| 2 | user error (bad CLI args, missing agent) |
| 3 | hook blocked execution |
| 4 | backend not installed or unreachable |
| 130 | interrupted (SIGINT / SIGTERM) |
