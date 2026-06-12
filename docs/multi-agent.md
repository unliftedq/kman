# Multi-Agent Dispatch

kman lets agents discover and call each other through a stdio **MCP server**, and
lets you compose agents with plain shell pipes.

## The kman MCP server

`kman mcp` starts a stdio MCP server (`@kman/mcp-server`). It walks
`~/.kman/agents/` at startup and offers four tools and two resource shapes that
any MCP host can consume:

| Surface | Name | Purpose |
|---|---|---|
| tool | `kman_list_agents` | Roster of every agent, excluding the calling self. |
| tool | `kman_describe_agent` | `agent.toml` + `soul.md` for one agent. |
| tool | `kman_run_agent` | Submit a task to a peer (async) — re-shells `kman -a <name> run --task <task>`, which queues it on the daemon, and returns the new task id. |
| tool | `kman_get_task` | Poll a submitted task's status and, once finished, its captured output. |
| resource | `kman://agents` | Same roster as a JSON resource. |
| resource template | `kman://agents/{name}` | Per-agent profile + soul. |

Dispatch is **asynchronous**: `kman_run_agent` returns immediately with a task
id instead of blocking until the peer finishes. The calling model polls
`kman_get_task` with that id until the status is terminal (`succeeded`,
`failed`, or `canceled`), then reads the result. This lets a coordinating agent
fan out several long-running jobs and collect them as they complete.

On every `initialize`, the server also returns server-level `instructions` (a
short guideline the host can inject as system-prompt context, nudging the model
to call `kman_list_agents` proactively) and exposes four prompt templates via
`prompts/list`: `list-agents`, `find-agent`, `delegate-task`, and
`second-opinion`.

Hosts that surface MCP prompts as slash commands can turn these into
one-keystroke workflows. Where a runtime needs a different mechanism for those
shortcuts, kman keeps the visible command names aligned.

## Two ways to wire it up

### 1. Auto-injection (default)

Every `kman run` / `kman chat` prepares a temporary MCP configuration for the
selected runtime. The host registers the server in its plain namespace
(`mcp__kman__<surface>`). For `kman run` the backend is spawned by the daemon,
which applies the same injection before launch; `kman chat` injects directly
since it runs the backend in the foreground.

The running agent's name flows through the `KMAN_SELF_AGENT` env var, substituted
into the config at spawn time, which the MCP server reads to hide the calling
agent from its own roster and refuse self-dispatch. Set `KMAN_NO_MCP=1` to opt
out per process.

### 2. External runtimes

```bash
kman mcp install   claude-code     # writes user-scope ~/.claude.json
kman mcp install   copilot-cli     # writes user-scope ~/.copilot/mcp-config.json
kman mcp config                    # prints a JSON snippet for any other host
kman mcp uninstall claude-code
kman mcp uninstall copilot-cli
```

`kman mcp install` writes an `mcpServers.kman` entry into the runtime's
user-scope config. `kman mcp config` prints the JSON snippet for hosts that
aren't directly supported.

Both paths produce the same `mcp__kman__<surface>` naming, so prompts, tool
calls, and slash commands look identical whether you opted in via global install
or got auto-injection.

## Cycle and depth protection

The daemon is the single chokepoint every delegation funnels through, so it owns
cycle and depth protection. Each daemon-launched run is told its own task id via
`KMAN_TASK_ID`; when that agent's injected MCP server delegates, it records the
running task as the new task's `parentTaskId`. At submit time the daemon walks
the `parentTaskId` links to reconstruct the chain of agents and rejects any
dispatch whose target already appears in it (preventing `a → b → a` loops, which
also covers self-delegation) or that would exceed depth `8`.

Because the chain is derived from task records the daemon owns rather than a
caller-supplied token, it can't be spoofed, and the guard applies uniformly to
MCP dispatch, direct `kman run`, and retries. The injected MCP server also keeps
a fast local self-dispatch check (via `KMAN_SELF_AGENT`) so an agent calling
straight back to itself fails immediately instead of round-tripping the daemon.

Each `kman_run_agent` re-shells `kman` rather than running in-process, which
keeps the MCP server's stdout transport isolated from peer agents' stdio.

Override the executable used inside spawned backends with `KMAN_BIN` (defaults:
the published `kman` shim, or `node <bundled script>` / `bun <source script>`
when running from source).

## Shell composition

You can also compose agents without MCP, using plain shell pipes:

```bash
# Pipe (linear, text)
kman run --agent extractor --task "extract requirements from spec.md" \
  | kman run --agent designer --task "design API given these requirements" \
  | kman run --agent coder    --task "implement the API"

# Programmatic (structured)
PLAN=$(kman run --agent planner --task "$1" --output json)
kman run --agent coder  --task "$(echo $PLAN | jq -r .step1)"
kman run --agent tester --task "$(echo $PLAN | jq -r .step2)"
```

## Related

- Server command details: [CLI Reference](./cli-reference.md).
- Per-agent MCP servers the agent *uses* (vs. peer dispatch): [Hooks & MCP](./hooks-and-mcp.md).
