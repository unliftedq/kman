# Daemon & Task Scheduling

kman can run as a **resident daemon** that manages a queue of agent tasks in the
background and schedules them with a concurrency limit. You submit tasks to the
daemon and it runs them on your behalf, capturing each run's output to a log.

`kman run` is the front door for queueing a task: it auto-starts the daemon if
needed, submits the task, and prints its id. The `kman task` subcommands then
inspect and manage those tasks.

The daemon's lifecycle is owned by an OS-native **host**:

| Platform | Host |
|---|---|
| Linux | `systemd --user` service |
| macOS | `launchd` LaunchAgent |
| Windows | per-user registry autostart (silent, no console window) |

## Quick start

```bash
kman daemon start            # launch in the background
kman daemon status           # is it running? how many tasks queued/running?

kman -a coder run --task "Refactor the auth module."   # auto-starts daemon, prints task id
kman task list               # see all tasks and their status
kman task logs <id> -f       # follow a task's output
kman task get <id>           # full record (status, attempts, error, timings)

kman daemon stop             # graceful shutdown
```

To have the daemon start automatically at login:

```bash
kman daemon install          # register the OS host (systemd / launchd / registry)
kman daemon install --start  # …and start it now
kman daemon uninstall        # remove autostart
```

## How it works

The daemon reuses the exact same run pipeline as an interactive launch
(`buildContext` → backend `spawn` → soul injection → kman MCP), so a
daemon-launched run is identical — it just runs detached with its output
captured.

```
kman run ───────────IPC▶  ┌──────────── kman daemon ─────────────┐
kman daemon status        │  IPC server (control plane)          │
                          │     │                                │
                          │  TaskStore ◀─▶ Scheduler (concurrency)│
                          │                    │                 │
                          │              RunManager ─▶ agent run  │
                          └───────────────────────────────────────┘
```

- **TaskStore** — every task is a JSON file under `~/.kman/daemon/tasks/`, with
  captured output in `~/.kman/daemon/logs/<id>.log`. Plain, inspectable data.
- **Scheduler** — orders the queue by `(priority desc, submission order)`, keeps
  at most `maxConcurrent` (default 2) tasks running, retries failed tasks up to
  `--max-attempts` with a backoff, and supports cancellation.
- **Boot recovery** — if the daemon is killed mid-run, tasks left `running` are
  re-queued (if attempts remain) or marked `failed` on the next start.

## IPC transport

The CLI talks to the daemon over a local control plane:

- **macOS / Linux** — HTTP/JSON over a Unix-domain socket at `~/.kman/daemon/sock`.
- **Windows** — HTTP/JSON over loopback TCP (`127.0.0.1`, ephemeral port). Bun's
  named-pipe support leaks handles across restarts, so TCP is used instead.

Either way the resolved endpoint and a per-daemon auth token are recorded in
`~/.kman/daemon/state.json`; the CLI reads it to connect. The socket file
permissions and the token gate access — the daemon is local-only.

## Windows autostart (silent)

On Windows, `kman daemon install` registers a per-user `HKCU\…\Run` entry that
launches the daemon at login through a generated hidden VBScript shim
(`~/.kman/daemon/autostart.vbs`) via `wscript.exe`. The daemon starts in the
background with no console window. `kman daemon uninstall` removes both the
registry entry and the shim.

## Command reference

### `kman daemon`

| Command | Description |
|---|---|
| `run` | Run in the foreground (this is what the OS host execs). |
| `start` | Spawn the daemon detached and wait for it to become healthy. |
| `stop` | Graceful shutdown. |
| `restart` | Stop (if running) then start. |
| `status [--json]` | Show pid, version, concurrency, and task counts. |
| `install [--start]` | Register the OS autostart host. |
| `uninstall` | Remove the autostart registration. |

### `kman task`

| Command | Description |
|---|---|
| `submit -a <agent> --task <text> [--priority N] [--max-attempts N] [--runtime r] [--model m] [--permission ask\|auto\|yolo] [--cwd p]` | Queue a task. Prints its id. |
| `list [--status s] [--json]` | List tasks (optionally filtered). |
| `get <id> [--json]` | Show one task record. |
| `logs <id> [-f]` | Print (or follow) a task's captured output. |
| `cancel <id>` | Cancel a queued or running task. |

All `task` commands and `daemon stop/status` print a clean "not running"
message when no daemon is up, rather than failing with a stack trace.

## State layout

```
~/.kman/daemon/
├── state.json        # version, pid, token, resolved IPC endpoint
├── daemon.pid        # pid of the running daemon
├── sock              # Unix socket (macOS/Linux only)
├── tasks/<id>.json   # one record per task
└── logs/<id>.log     # captured stdout+stderr per run
```

## Out of scope (today)

Cron/recurring schedules, remote/networked daemons, multi-user operation, and a
web dashboard are not implemented yet — the concurrency-limited queue is the
foundation those would build on.
