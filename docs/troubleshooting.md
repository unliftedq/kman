# Troubleshooting

Start with `kman doctor`, then map any failure to the exit-code table below.

## `kman doctor`

```bash
kman doctor                # global: env + backend binaries
kman -a coder doctor       # also checks the agent's directory layout
kman doctor --json         # machine-readable report
```

`doctor` reports `ok` / `info` / `warn` / `error` per check and exits non-zero on
`error`.

The v1 `doctor` runs:

- **Global checks** — backend binary probes (`claude`, `copilot`) and their versions.
- **Agent-scoped checks** (when `-a <name>` is given):
  - `agent.toml` presence and validity,
  - `soul` prompt presence,
  - `mcp.json` JSON shape,
  - hook script presence and executability,
  - `bin/` shadowing warnings,
  - the set of installed skills.

Deeper integrations — `claude plugin validate`, `userConfig` ↔ env
reconciliation, and deeper `mcp.json` semantic validation — are future work.

## Exit codes

| Code | Meaning | Typical cause |
|---|---|---|
| 0 | success | — |
| 1 | agent / runtime error | the LLM / a tool / the backend reported a failure |
| 2 | user error | bad CLI args, missing agent, invalid `mcp.json` shape, duplicate `--agent` |
| 3 | hook blocked execution | a `PreToolUse` / other hook rejected the action |
| 4 | backend not installed or unreachable | `claude` / `copilot` missing, or the backend can't accept the soul prompt |
| 130 | interrupted | SIGINT / SIGTERM |

## Common problems

### "backend not installed or unreachable" (exit 4)

The selected backend binary isn't on `PATH`. Install it, or point kman at it:

```bash
export KMAN_CLAUDE_BIN=/path/to/claude
export KMAN_COPILOT_BIN=/path/to/copilot
kman doctor
```

This also fires if the backend can't accept kman's rendered soul prompt — kman
fails fast before spawning.

### Invalid `mcp.json` (exit 2)

If `mcp.json` references an invalid server or command shape, kman exits before
spawning the backend. Validate the JSON and the `mcpServers` entries; see
[Hooks & MCP](./hooks-and-mcp.md).

### A hook blocked the run (exit 3)

A configured hook returned a blocking result. Inspect `hooks/hooks.json` and the
referenced `scripts/`. Remember scripts are referenced via
`${CLAUDE_PLUGIN_ROOT}` and must be executable (a `doctor` check flags
non-executable hook scripts).

### Skill update refused

`kman skills update` refuses when your local copy is newer than the manifest
install time (you edited the skill locally). Re-run with `--force` to overwrite,
or detach the skill first to make it a pure local copy. See [Skills](./skills.md).

### `bin/` command shadowing

Executables in an agent's `bin/` become bare commands inside the backend's Bash
tool and can shadow system commands. `doctor` warns about this; prefer an
agent-specific prefix for `bin/` entries.

### Stale runtime plugin

The `~/.kman/runtime/<name>/` tree is derived state, rebuilt on each launch and
safe to delete at any time. If something looks stale, delete it and re-run.

### Seeing stack traces

Set `KMAN_DEBUG=1` to print stack traces on unexpected errors.

## Related

- Environment variables: [Configuration](./configuration.md).
- Command and flag details: [CLI Reference](./cli-reference.md).
