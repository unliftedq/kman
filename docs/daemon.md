# Daemon & Task Scheduling

kman can run as a **resident daemon** that manages a queue of agent tasks in the
background and schedules them with a concurrency limit. Instead of one blocking
`kman run` per task, you submit tasks to the daemon and it runs them on your
behalf, capturing each run's output to a log.

The daemon's lifecycle is owned by an OS-native **host**:

| Platform | Host |
|---|---|
| Linux | `systemd --user` service |
| macOS | `launchd` LaunchAgent (+ optional tray) |
| Windows | per-user registry autostart (+ optional tray) |

## Quick start

```bash
kman daemon start            # launch in the background
kman daemon status           # is it running? how many tasks queued/running?

kman -a coder task submit --task "Refactor the auth module."
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

The daemon reuses the exact same run pipeline as `kman run`
(`buildContext` → backend `spawn` → soul injection → kman MCP), so a
daemon-launched run is identical to an interactive one — it just runs detached
with its output captured.

```
kman task submit ──IPC──▶ ┌──────────── kman daemon ─────────────┐
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

## Tray (macOS / Windows)

On desktop platforms the daemon can show a system-tray menu (status, start/stop,
open logs, quit):

```bash
kman daemon start --tray
kman daemon install --tray   # autostart with the tray
```

The tray is driven by a lightweight `systray`-style helper binary over stdio.
Point kman at it with `KMAN_SYSTRAY_BIN=/path/to/helper`. When no helper is
configured the daemon runs headless and the tray is simply skipped.

## Command reference

### `kman daemon`

| Command | Description |
|---|---|
| `run [--tray]` | Run in the foreground (this is what the OS host execs). |
| `start [--tray]` | Spawn the daemon detached and wait for it to become healthy. |
| `stop` | Graceful shutdown. |
| `restart [--tray]` | Stop (if running) then start. |
| `status [--json]` | Show pid, version, concurrency, and task counts. |
| `install [--host …] [--start] [--tray]` | Register the OS autostart host. |
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
