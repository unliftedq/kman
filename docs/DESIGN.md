# kman — Design Document

> A multi-agent management tool. v1 ships as a CLI; future surfaces (desktop / web / gateway) reuse the same core.

---

## 1. Vision

kman is **not** another agent runtime. It is an **agent manager** that sits above existing agent runtimes (`claude-code`, `copilot-cli`, and later `codex`, `gemini`, ...) and gives them three things they currently lack as a system:

1. **Named agent profiles** — each agent has its own soul, plugin files, and default runtime, addressable by name.
2. **Backend-agnostic CLI** — one set of commands, one profile format, regardless of which underlying runtime does the work.
3. **Claude Code plugin compatibility** — every kman agent is materialized into a valid Claude Code / Copilot plugin at launch (under `~/.kman/runtime/<name>/`), so skills / hooks / MCP servers / commands written for the broader ecosystem work unchanged.

Long-term, the same core powers a desktop app, a web UI, and a remote gateway. v1 deliberately ships only the CLI.

---

## 2. Non-Goals (v1)

- **No own LLM runtime.** kman never calls an LLM API directly. All inference happens inside the chosen backend.
- **No workflow DSL.** No `kman flow` command, no YAML pipelines. Multi-agent composition in v1 is shell pipes only.
- **No session management.** v1 relies entirely on each backend's native session storage and resume. kman does not capture, normalize, index, or search sessions, and ships no `sessions` subcommands. Cross-backend session UX is a [TODO](#10-roadmap).
- ~~**No agent-to-agent invocation.**~~ Agent-to-agent invocation now ships as `kman mcp` — a stdio MCP server that exposes the agent roster as MCP tools (`kman_list_agents`, `kman_describe_agent`, `kman_run_agent`) and resources (`kman://agents`, `kman://agents/<name>`). `kman run` and `kman chat` auto-inject the server into the spawned backend; external runtimes register it via `kman mcp install claude-code | copilot-cli`. Cycle and depth protection are handled via the `KMAN_RUN_CHAIN` env var (§3.4).
- **No `doctor` command.** ~~Environment / backend / plugin diagnostics are deferred.~~ As of v1, `kman doctor` ships a minimal version: global backend-binary probes, plus agent-scoped checks for `agent.toml`, `soul`, `.mcp.json` shape, hook script presence/executability, `bin/` shadowing, and installed skills. Deeper integrations (`claude plugin validate`, `userConfig` ↔ env reconciliation) remain a [TODO](#10-roadmap).
- **No project-local profiles.** All agents live at `~/.kman/`. No `.kman/` in repos.
- **No skill template system.** New agents start with an empty skills directory.
- **No shell / HTTP custom tools.** v1 only wires MCP tools through `.mcp.json`. Shell / HTTP tool adapters need a separate schema, timeout, quoting, and safety design.
- **No Codex / Gemini adapters in v1.** v1 implements `claude-code` and `copilot-cli` first.
- **No config command in v1.** Global configuration commands are deferred until concrete global settings exist.
- **No compiled binary distribution in v1.** v1 ships as an npm package consumed via `bun install -g @kman/cli`. Single-file native binaries (Bun `--compile`), Homebrew / Scoop / AUR packaging, and Docker images are [TODO](#10-roadmap).

---

## 3. Architecture

### 3.1 High-level

```mermaid
flowchart LR
    user[User / CLI] -->|kman run --agent coder --task| cli[apps/cli<br/>citty]
    cli --> core[packages/core<br/>profile + context + launcher]
    core -->|build| ctx[AgentContext]
    ctx --> backend[Backend Adapter<br/>claude-code / copilot-cli]
    backend -.materializes + loads as plugin.-> dir[~/.kman/runtime/coder/.claude<br/>derived plugin layout]
    backend -->|stdout / stderr| user
```

kman does not interpose on the backend's I/O stream. Backend output (text, JSON, or backend-native stream) goes directly to the user's terminal. Session state stays inside the backend's own storage.

### 3.2 The `AgentContext` — pipeline center

Every `kman run` invocation builds an immutable `AgentContext` object **before** the backend is spawned. All downstream components — backend launcher, hook runner via the plugin — read from this single source of truth.

```mermaid
flowchart TB
    A[1. Resolve agent name from --agent] --> B[2. Load profile from<br/>~/.kman/agents/coder/agent.toml]
    B --> C[3. Read soul prompt from soul.md]
    C --> D[4. Build AgentContext<br/>profile + soul + runtime + defaults]
    D --> E[5. Apply CLI overrides onto context<br/>--runtime / --permission / --model / ...]
    E --> F[6. Materialize runtime plugin under ~/.kman/runtime/name<br/>then spawn backend with --plugin-dir + rendered soul]
    F --> G[7. Backend stdout/stderr stream to the user]
```

CLI overrides act on the **context**, not on the raw profile. Profile stays immutable on disk.

Agent names are lowercase kebab-case: `^[a-z][a-z0-9-]{0,62}$`. Names are case-sensitive in CLI input and on disk.

### 3.3 Backend adapter interface

Each backend lives in its own package (`packages/backend-<name>/`). v1 ships `claude-code` and `copilot-cli` adapters. Adapters implement a common `Backend` interface:

```ts
interface Backend {
  readonly name: string;
  readonly capabilities: BackendCapabilities;

  /** Spawn a one-shot run; stdout/stderr are passed through to the caller. */
  spawn(ctx: AgentContext, opts: RunOptions): Promise<ChildProcess>;

  /** Spawn an interactive REPL, passing stdin/stdout through transparently. */
  chat(ctx: AgentContext, opts: ChatOptions): Promise<ChildProcess>;

  /** Map abstract permission level to backend-native mode. */
  mapPermission(level: 'ask' | 'auto' | 'yolo'): string;
}

interface BackendCapabilities {
  /** Can load the agent directory as a Claude Code plugin via --plugin-dir. */
  supportClaudeCodePlugin: boolean;
  /** Can accept kman's rendered soul as an additional system prompt. */
  supportsAppendSystemPrompt: boolean;
  /** Exposes a native --resume / --continue style flag. */
  supportsNativeResume: boolean;
}
```

Capability handling is fail-fast for required launch behavior: if a selected backend cannot accept the rendered soul prompt, kman exits with code 4 before spawning.

For backends with `supportClaudeCodePlugin = true` (claude-code and copilot-cli in v1), kman materializes the agent into a backend-native plugin under `~/.kman/runtime/<name>/` (§4.1) and points the backend's `--plugin-dir` at it, selecting the contributed agent via `--agent kman:<name>`. The agent directory itself is never passed to the backend. For other backends (future codex/gemini), the adapter is responsible for translating the relevant subset of the layout (skills, hooks, MCP servers) into the backend's native concepts, or declaring those features unsupported.

### 3.4 Multi-agent invocation (via `kman mcp`)

kman ships a stdio MCP server (`@kman/mcp-server`) exposed through `kman mcp`. The server walks `~/.kman/agents/` at startup and offers three tools and two resource shapes that any MCP host can consume:

| Surface | Name | Purpose |
|---|---|---|
| tool | `kman_list_agents` | Roster of every agent, sans the calling self. |
| tool | `kman_describe_agent` | `agent.toml` + `soul.md` for one agent. |
| tool | `kman_run_agent` | Dispatch a task — re-shells `kman -a <name> run --task <task>` as a subprocess. |
| resource | `kman://agents` | Same roster as a JSON resource. |
| resource template | `kman://agents/{name}` | Per-agent profile + soul. |

Two distribution paths:

1. **Auto-injection.** `kman run` and `kman chat` materialize a single standalone MCP config at `~/.kman/runtime/mcp-config.json` and hand it to the backend through its native flag — `--mcp-config` for claude-code, `--additional-mcp-config` for copilot-cli. No plugin wrapper involved, so the host registers the server in its plain namespace (`mcp__kman__<surface>`) instead of a longer plugin-scoped form. The running agent's name flows through the `KMAN_SELF_AGENT` env var, substituted into the config at spawn time, which the MCP server reads to hide the calling agent from its own roster and refuse self-dispatch. Setting `KMAN_NO_MCP=1` opts out per process.
2. **External runtimes.** `kman mcp install claude-code | copilot-cli` writes a `mcpServers.kman` entry into the runtime's user-scope config. `kman mcp config` prints the JSON snippet for hosts that aren't directly supported.

Both paths produce the same `mcp__kman__<surface>` naming, so prompts, tool calls, and slash commands look identical whether the user opted in via global install or got the auto-injection.

Beyond raw tools, the server returns server-level usage `instructions` on every `initialize` (a short guideline the host can inject as system-prompt context, nudging the model to call `kman_list_agents` proactively) and exposes four prompt templates via `prompts/list`: `list-agents`, `find-agent`, `delegate-task`, and `second-opinion`. Hosts that surface MCP prompts as slash commands turn these into one-keystroke workflows.

Cycle and depth protection are carried through `KMAN_RUN_CHAIN` — a comma-separated list of agents in the current delegation stack. The MCP server rejects any dispatch whose target is already in the chain, and refuses to spawn beyond depth 8. The subprocess invariant (each `kman_run_agent` re-shells `kman` rather than running in-process) keeps the MCP server's stdout transport isolated from peer agents' stdio.

Deferred for future work:

- One MCP tool *per peer agent* (`kman_agent_<name>`) instead of a single generic `kman_run_agent`. The generic form is simpler and lets external hosts discover the roster dynamically; per-agent tools may follow once `notifications/tools/list_changed` lands in the server.
- A long-lived TCP / HTTP transport (vs. the per-spawn stdio transport).
- Streaming peer output back through `tools/call` progress notifications instead of collecting stdout to completion.

---

## 4. Storage Layout

An agent directory holds **only genuine agent data** — profile, soul, skills, hooks, MCP config. The Claude Code / Copilot **plugin layout is not stored here**; it is *derived* at launch into `~/.kman/runtime/<name>/` (see §4.1). Backends never point at the agent directory directly — they load the materialized runtime plugin.

```
~/.kman/
└── agents/
  └── coder/                          # agent directory = agent data only
    ├── agent.toml                  # kman profile (runtime, model, defaults)
    ├── soul.md                     # kman system prompt + plugin agent frontmatter (name:)
    ├── skills/                     # Claude Code skills: <name>/SKILL.md
    │   └── humanizer/
    │       ├── SKILL.md
    │       └── .kman-skill.json  # vendoring manifest (source / version / checksum)
    ├── commands/                   # Claude Code flat slash commands (optional)
    ├── hooks/
    │   └── hooks.json              # Claude Code hook configuration
    ├── scripts/                    # Hook / utility scripts referenced from hooks.json
    │   ├── check-env.sh
    │   └── notify.sh
    ├── .mcp.json                   # Claude Code MCP server configuration
    ├── bin/                        # Executables added to backend Bash PATH
    └── logs/
      └── agent.log               # kman-side diagnostic log (not session data)
```

Notes on the layout:

- **kman-specific files** are `agent.toml`, `soul.md`, and `.kman-skill.json` inside each vendored skill. Claude Code ignores top-level fields and files it does not recognize, so these coexist cleanly with the plugin spec.
- **No plugin scaffolding in the agent dir.** `.claude-plugin/plugin.json`, `plugin.json`, and `agents/<name>.md` are **not** written here. They are generated under `~/.kman/runtime/<name>/` at launch (§4.1), so the agent directory stays a clean, diffable record of intent.
- **Path substitution** inside plugin files uses Claude Code's variables: `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}`, `${user_config.KEY}`, and `${ENV_VAR}`.
- **Secrets** are never stored in plain config. Use Claude Code's `userConfig` with `"sensitive": true`, or supply secrets through the launch environment, then reference them via `${user_config.KEY}` / `${ENV_VAR}` in `.mcp.json` and `hooks/hooks.json`.
- **`bin/`** follows Claude Code semantics: executables become bare commands inside the backend's Bash tool while the plugin is enabled. It does not mutate kman's own process `PATH`.
- **No `sessions/` directory.** Sessions live in the backend's own storage. kman does not write a unified session log in v1.

### 4.1 Runtime plugin materialization

Plugin layout is a *backend implementation detail*, not agent data — so kman keeps it out of the agent directory and materializes it on demand under `~/.kman/runtime/<name>/`:

```
~/.kman/runtime/
├── mcp-config.json                    # shared kman-MCP injection config (§3.4)
└── coder/
  ├── .claude/                       # complete Claude Code plugin (claude-code)
  │   ├── .claude-plugin/plugin.json #   { "name": "kman", "agents": ["./agents/coder.md"] }
  │   ├── agents/coder.md            #   → soul.md
  │   ├── skills/ hooks/ scripts/ bin/ commands/   # → agent dir (symlink, copy fallback)
  │   └── .mcp.json                  #   → agent dir
  └── .copilot/                      # complete Copilot plugin (copilot-cli)
    ├── plugin.json                  #   { "name": "kman", "agents": "agents/" }
    ├── agents/coder.md              #   → soul.md
    ├── skills/ hooks/ scripts/ bin/ commands/
    └── .mcp.json
```

- **Fixed plugin name.** Every materialized plugin declares `"name": "kman"`, so the backend selector is always `kman:<agent>` (`--agent kman:coder`). The contributed agent's own name comes from `soul.md`'s YAML frontmatter `name:`.
- **Mapped, not copied.** Component dirs (`skills/`, `hooks/`, `scripts/`, `bin/`, `commands/`) and `.mcp.json` are symlinked back to the agent directory so edits stay in sync without duplication; on platforms/filesystems without symlink support kman falls back to a recursive copy. The manifest and `agents/<name>.md` are generated fresh.
- **Rebuilt every launch.** The per-layout directory is removed and recreated on each spawn, so removed skills/hooks never linger as stale entries. The directory is derived state and safe to delete at any time. `kman agent rename` / `delete` drop the matching `~/.kman/runtime/<name>/` tree.
- **Loaded via `--plugin-dir`.** The backend points `--plugin-dir` at `~/.kman/runtime/<name>/.claude` (claude-code) or `.copilot` (copilot-cli).

---

## 5. Profile Schema

### 5.1 `~/.kman/agents/<name>/agent.toml`

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

### 5.2 `~/.kman/agents/<name>/.mcp.json`

Standard Claude Code plugin MCP configuration:

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

`.mcp.json` is loaded by the backend through its Claude Code plugin support. If the backend does not support MCP servers, the file is ignored.

If `.mcp.json` references an invalid server or command shape, kman exits with code 2 before spawning the backend.

### 5.3 `~/.kman/agents/<name>/hooks/hooks.json`

Hook configuration uses the Claude Code plugin hook format. Scripts live under `scripts/` and are referenced via `${CLAUDE_PLUGIN_ROOT}`:

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

Supported hook events, types, and matcher semantics are exactly those defined by Claude Code's plugin hook system (see [Plugins reference → Hooks](https://code.claude.com/docs/en/plugins-reference)). Backends that do not implement a given hook event silently ignore it.

### 5.4 Vendored skill manifest — `<agent>/skills/<skill>/.kman-skill.json`

```json
{
  "source": "vercel-labs/agent-skills",
  "source_url": "https://github.com/vercel-labs/agent-skills",
  "ref": "v1.3.2",
  "installed_at": "2026-05-25T09:12:47Z",
  "version": "git-sha-abc123",
  "checksum": "sha256:..."
}
```

`detach` removes this manifest (skill becomes pure local). `update` refuses if local mtime > manifest install time (use `--force` or detach first).

Installed skill directories are the source of truth. A skill is active when `<agent>/skills/<skill>/` exists. `agent.toml` does not duplicate the installed skill list. v1 installs skills by copying directly into the target agent's `skills/` directory; no canonical cache or symlink mode is used.

Skill source parsing follows the `vercel-labs/skills` model: parse the source first, then discover skill directories by finding `SKILL.md` files. Sources may be local paths, GitHub/GitLab URLs, GitHub shorthand (`owner/repo`, `owner/repo/path`, `owner/repo@ref`), direct git URLs, branch/ref selectors, or well-known skill endpoints. Subpaths must be sanitized so they cannot escape the cloned repository. Discovery checks direct skill paths first, then common skill roots such as `skills/`, `.claude/skills/`, and other agent-specific skills directories, and finally bounded recursive search.

When a source resolves to multiple skills and the user did not pass `--skill` or `--all`, kman opens an interactive multi-select picker so the user can choose exactly which skills to install. Interactivity is detected with stdin/stdout TTY checks. In non-interactive mode, kman exits with code 2 and prints the discovered skill names, instructing the user to pass one or more `--skill` options or `--all`.

---

## 6. CLI Reference

All commands follow strict noun-verb grammar. No dynamic agent-as-subcommand. Agent management commands may use positional agent names for readability; other user-provided values are passed through options.

Agent-scoped commands select the target agent with the global `-a, --agent <name>` option. `--agent` is accepted before or after subcommands. If `--agent` appears more than once, kman exits with code 2. Agent-scoped commands require `--agent`; non-agent commands reject it unless explicitly documented.

```bash
kman skills list --agent coder
kman -a coder skills list
kman --agent coder run --task "..."
```

### 6.1 Agent lifecycle

```bash
kman agent create coder [flags]
  --runtime <backend>          # default backend (claude-code, copilot-cli)
  --model <id>                 # default model
  --description "<text>"
  --soul "<text>"

kman agent list                                       # all agents
kman agent show coder                                 # profile + paths
kman agent delete coder [--yes]
kman agent rename coder reviewer
```

`kman agent create` scaffolds an agent directory with **agent data only** (`agent.toml`, `soul.md` with its `name:` frontmatter, `skills/`, `hooks/`, `scripts/`, `.mcp.json`). It does **not** write plugin scaffolding — `.claude-plugin/plugin.json`, `plugin.json`, and `agents/<name>.md` are derived at launch under `~/.kman/runtime/<name>/` (§4.1). `agent delete` / `agent rename` also drop the matching runtime directory.

### 6.2 Skills

```bash
kman skills add    --agent coder --source vercel-labs/agent-skills [--ref <branch|tag|sha>]
kman skills add    --agent coder --source vercel-labs/agent-skills --skill humanizer
kman skills add    --agent coder --source vercel-labs/agent-skills --all
kman skills list   --agent coder
kman skills show   --agent coder --skill humanizer
kman skills update --agent coder --skill humanizer [--force]
kman skills update --agent coder --all
kman skills remove --agent coder --skill humanizer
```

`skills add` discovers all candidate `SKILL.md` directories from `--source`. If there is exactly one candidate, it installs it. If there are multiple candidates, `--skill` filters by skill name, `--all` installs every candidate, and the interactive picker is used only when neither option is provided.

### 6.3 Plugin files

kman does not provide `mcp` or `hook` subcommands. Users edit agent files directly:

- `~/.kman/agents/<name>/.mcp.json` for per-agent MCP servers.
- `~/.kman/agents/<name>/hooks/hooks.json` for hook configuration.
- `~/.kman/agents/<name>/scripts/` for hook / utility scripts referenced by `hooks.json`.

These files live in the agent directory and are mapped into the derived runtime plugin at launch (§4.1). Format, events, environment variables, and path substitution all follow the Claude Code plugin spec. To override the generated manifest (e.g. add `version` or `userConfig`), edit it in the materialized `~/.kman/runtime/<name>/.{claude,copilot}/` plugin — but note the directory is rebuilt on each launch.

### 6.4 Run / chat

```bash
kman run --agent coder --task "..." [flags]
  --runtime <backend>                # override profile default
  --model <id>                       # override
  --permission ask|auto|yolo         # abstract level
  --runtime-flag key=value           # raw escape hatch for backend-native flags
  --output text|json|stream-json     # default text; passed through to backend
  --stream                           # implies --output stream-json if not set; mutually exclusive with --output of a different value
  --cwd <path>                       # working directory for backend

kman chat --agent coder [--runtime <backend>]
```

Resuming a previous conversation uses the backend's native mechanism, exposed via `--runtime-flag`:

```bash
# claude-code:
kman run --agent coder --runtime-flag --continue --task "next step"
kman chat --agent coder --runtime-flag --resume=<id>
```

A first-class, backend-neutral resume UX is a [TODO](#10-roadmap).

Exit codes:

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | agent error (LLM / tool / backend reported) |
| 2 | user error (bad CLI args, missing agent) |
| 3 | hook blocked execution |
| 4 | backend not installed or unreachable |
| 130 | interrupted (SIGINT) |

### 6.5 Sessions (deferred — TODO)

Session capture, listing, search, export, prune, and unified resume are deferred. v1 relies entirely on each backend's native session storage; use the backend's own tooling to inspect or replay past runs.

### 6.6 MCP server

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

Auto-injection during `kman run` / `kman chat` is on by default; set `KMAN_NO_MCP=1` in the parent shell to disable. Override the executable used inside spawned backends with `KMAN_BIN` (defaults: the published `kman` shim, or `node <bundled script>` / `bun <source script>` when running from source).

### 6.7 Diagnostics

```bash
kman version
kman --help
```

A dedicated `kman doctor` (backend / MCP / hook script / `userConfig` checks) ships in v1 with the checks listed in [§10 TODO](#10-roadmap); deeper `userConfig` ↔ env reconciliation remains deferred.

---

## 7. Multi-Agent Composition (v1)

v1 supports multi-agent flows only through shell composition. Sub-agent invocation via an auto-injected kman MCP server (`delegate_<peer>`) is deferred (§3.4, §10).

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

---

## 8. Planned Repo Layout

This is the intended implementation layout, not the current repository state.

```
kman/
├── apps/
│   ├── cli/                          # @kman/cli — the only v1 app
│   │   ├── src/
│   │   │   ├── main.ts               # citty entry
│   │   │   └── commands/
│   │   │       ├── agent.ts          # agent {create,list,show,delete,rename}
│   │   │       ├── skills.ts         # skills {add,list,show,update,remove}
│   │   │       ├── run.ts
│   │   │       └── chat.ts
│   │   └── package.json
│   ├── desktop/                      # placeholder (empty)
│   ├── web/                          # placeholder (empty)
│   └── gateway/                      # placeholder (empty)
├── packages/
│   ├── types/                        # @kman/types — lingua franca
│   │   └── src/
│   │       ├── profile.ts            # Profile, RuntimeConfig, DefaultsConfig
│   │       ├── context.ts            # AgentContext
│   │       ├── backend.ts            # Backend interface + Capabilities
│   │       └── index.ts
│   ├── core/                         # @kman/core
│   │   └── src/
│   │       ├── profile/              # TOML read/write/validate
│   │       ├── context/              # AgentContext builder
│   │       ├── runtime/             # materializes ~/.kman/runtime/<name>/.{claude,copilot} plugins
│   │       ├── secrets/              # launch env helpers
│   │       ├── launcher/             # spawns backend, passes stdio through
│   │       └── prompt/               # render soul prompt
│   ├── skills/                       # @kman/skills
│   │   └── src/
│   │       ├── source-parser.ts      # local / git / GitHub / GitLab / well-known sources
│   │       ├── discover.ts           # SKILL.md discovery + multi-skill selection
│   │       ├── vendor.ts             # direct copy + write manifest
│   │       ├── manifest.ts           # .kman-skill.json
│   │       └── update.ts             # diff + conflict detection
│   ├── backend-base/                 # @kman/backend-base — interface + shared helpers
│   │   └── src/backend.ts
│   ├── backend-claude-code/
│   ├── backend-copilot-cli/
│   └── mcp-server/                   # @kman/mcp-server — stdio MCP server + auto-injection config
│       └── src/
│           ├── server.ts             # JSON-RPC dispatch over stdio, initialize instructions
│           ├── tools.ts              # kman_list_agents / kman_describe_agent / kman_run_agent
│           ├── resources.ts          # kman://agents and kman://agents/{name}
│           ├── prompts.ts            # list-agents / find-agent / delegate-task / second-opinion templates
│           ├── agents.ts             # roster discovery + per-agent read
│           ├── runner.ts             # re-shells `kman -a <name> run --task ...`
│           ├── injection.ts          # materializes ~/.kman/runtime/mcp-config.json
│           └── protocol.ts           # JSON-RPC types + error codes
├── docs/
│   └── DESIGN.md                     # this file
├── turbo.json
├── package.json                      # workspace root
├── bun.lockb
└── tsconfig.base.json
```

`packages/mcp-server/` ships in v1 — see §3.4 for the surface and §6.6 for the CLI.

---

## 9. Distribution

v1 ships exclusively as an npm-published package consumed via the Bun toolchain:

```bash
bun install -g @kman/cli
kman --help
```

Compiled binaries, OS package managers, and container images are deferred — see [TODOs](#10-roadmap).

---

## 10. Roadmap

| Milestone | Scope | Acceptance |
|---|---|---|
| **M1 — walking skeleton** | Monorepo bootstrapped. `kman --help` / `kman version` work. `kman agent create/list/show/delete/rename` round-trip on disk. | `bun run kman agent create foo && bun run kman agent list` round-trips. |
| **M2 — single backend** | Claude-code adapter only. `kman run` and `kman chat` work end-to-end; backend stdout/stderr passes through unchanged. Soul prompt injected as append-system-prompt; agent directory loaded via `--plugin-dir`. | `kman run --agent foo --task "say hi"` returns assistant text. `--runtime-flag --continue` resumes the backend's native session. |
| **M3 — plugin ecosystem** | `skills add/list/show/update/remove` for local, git, GitHub/GitLab, and well-known sources, with `--ref` pinning and interactive multi-select. Hand-edited `.mcp.json` and `hooks/hooks.json` load through the plugin during runs. | A `skills add` from a multi-skill source installs the user-selected subset; a hand-written hook fires during `kman run`. |
| **M4 — backend parity** | Copilot CLI adapter. Permission abstraction mapping across both backends. `--runtime` flag works. | The same agent profile runs through both v1 backends (modulo declared capability gaps). |
| **M5 — polish** | Bug-fix pass, docs, examples, error-message quality, npm publish pipeline. | `bun install -g @kman/cli` from a clean machine yields a working `kman` end-to-end. |

### TODOs (post-v1, intentionally deferred)

- **Session layer.** Unified session capture, listing, search, export, prune, and cross-backend resume. v1 uses backend-native sessions only.
- ~~**Agent-to-agent invocation.**~~ Shipped — see §3.4. Generic `kman_run_agent` tool plus `kman mcp install` for external runtime registration; cycle and depth protection via `KMAN_RUN_CHAIN`. Per-agent tool variants (`kman_agent_<name>`) and long-lived HTTP transport remain follow-ups.
- **`kman doctor` deepening.** v1 ships a baseline `doctor` (backend binaries + version, `.mcp.json` JSON validity, hook script presence/executability, `bin/` shadowing warning, agent profile sanity). Deferred extensions: `userConfig` ↔ launch-env reconciliation, deeper `.mcp.json` semantic validation, and `claude plugin validate` integration.
- **Standalone distribution.** Compiled single-file binaries via `bun build --compile` for macOS / Linux / Windows; Homebrew tap, Scoop bucket, AUR; Docker images for CI / serverless.
- **Codex and Gemini adapters.**
- **Workflow DSL.**
- **Desktop / web / gateway surfaces.**

---

## 11. Open Risks

1. **Backend stability.** claude-code and copilot-cli change their CLI surface over time. Adapter packages will need active maintenance. Each adapter pins minimum required version and probes capabilities at startup.
2. **Claude Code plugin spec drift.** The plugin layout and `${CLAUDE_PLUGIN_*}` substitution variables may evolve. Because kman does not author plugin files itself (manifest, hooks, MCP config are all hand-authored or vendored), the blast radius is limited to documentation and adapter capability flags.
3. **Skill update conflicts.** `.kman-skill.json` checksum diverging from current files indicates local edits. We refuse, require explicit `--force` or `detach`. Acceptable UX cost.
4. **Secret availability.** MCP servers may require credentials via `userConfig` or environment. Until `kman doctor` lands, missing credentials surface only as backend-side runtime errors.
5. **`bin/` namespace collisions.** Plugin executables become bare commands in the backend's Bash tool and can shadow system commands. Recommend naming `bin/` entries with an agent-specific prefix.

---

## 12. Design Decision Index

| # | Decision | Reference |
|---|---|---|
| 1 | Strict noun-verb CLI grammar; agent management may use positional names, other values use options | §6 |
| 2 | Global-only agent storage (`~/.kman/agents/`) | §4 |
| 3 | Manager mode (no own runtime), pluggable backends | §3.3 |
| 4 | TOML profile + standalone `soul.md` (passed as append-system-prompt) | §5.1 |
| 5 | Agent directory IS a Claude Code plugin; layout, manifest, hooks, MCP servers all follow the Claude Code plugin spec | §4, §5 |
| 6 | v1 ships shell-pipe composition only; sub-agent invocation deferred | §3.4, §7, §10 |
| 7 | v1 has no session layer; native backend sessions only; `sessions` subcommands deferred | §2, §6.5, §10 |
| 8 | `AgentContext` is the pipeline center; CLI overrides act on it | §3.2 |
| 9 | Skills: direct-copy installed directories are the source of truth; source parsing follows SKILL.md discovery with interactive multi-select; installs support `--ref` pinning | §5.4, §6.2 |
| 10 | Secrets via Claude Code `userConfig` or launch env; never plaintext config files | §4, §5.2 |
| 11 | Permission: abstract (ask / auto / yolo) + `--runtime-flag` raw escape hatch | §6.4, §5.1 |
| 12 | Hooks live in `hooks/hooks.json` per Claude Code plugin spec; scripts in `scripts/` referenced via `${CLAUDE_PLUGIN_ROOT}` | §5.3, §6.3 |
| 13 | TypeScript + Bun + Turborepo + citty | §8 |
| 14 | Agent names are lowercase kebab-case; agent-scoped CLI option is `-a, --agent` | §3.2, §6 |
| 15 | Resume uses backend-native flags via `--runtime-flag`; unified resume is a TODO | §6.4, §10 |
| 16 | No `config` command in v1 | §2, §6.6 |
