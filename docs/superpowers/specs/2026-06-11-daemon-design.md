# kman daemon — design

> Status: approved scope (clarifying questions answered 2026-06-11). Adds a
> long-running background process that manages agents and schedules tasks, with
> OS-native hosts: systemd (Linux), launchd + tray (macOS), service + tray
> (Windows).

## 1. Goal

kman today spawns one agent run per CLI invocation and exits. This adds a
**daemon** that stays resident, accepts task submissions over local IPC, and
schedules them onto agents with a concurrency limit. The daemon's lifecycle is
owned by an OS-native **host**: `systemctl --user` on Linux, a tray app on
macOS/Windows (with launchd/registry autostart underneath).

The daemon never re-implements agent spawning — it reuses `buildContext` +
`launchRun` from `@kman/core`, so a daemon-launched run is identical to a
`kman run` run.

## 2. Decisions (from clarifying questions)

| Decision | Choice |
|---|---|
| Scope | Daemon core + CLI + all three hosts (incl. tray) |
| IPC transport | HTTP/JSON over Unix domain socket (mac/Linux) / named pipe (Windows) |
| Scheduler | Concurrency-limited queue: FIFO + priority, retry/backoff, status |
| Persistence | Plain JSON files under `~/.kman/daemon/` |
| Tray tech | Lightweight `systray`-style helper binary driven over stdio |
| Process model | Detached self-spawn (`kman daemon start`) + host-managed autostart |

## 3. Architecture

```
kman task submit ──IPC──▶ ┌──────────── kman daemon (one process) ─────────────┐
kman daemon status        │  IpcServer (UDS / named pipe, HTTP + JSON)          │
                          │     │                                               │
                          │  TaskStore (JSON) ◀─▶ Scheduler (concurrency limit) │
                          │                              │                      │
                          │                        RunManager ─▶ launchRun(core)│
                          └─────────────────────────────────────────────────────┘
   OS host owns lifecycle on login: systemd --user │ launchd + tray │ winsvc + tray
```

## 4. Package layout — `packages/daemon` (`@kman/daemon`)

```
src/
  index.ts                 # public exports
  paths.ts                 # ~/.kman/daemon/{sock, daemon.pid, daemon.lock, state.json, tasks/, logs/}
  protocol.ts              # request/response types + route contract (shared client+server)
  store/task-store.ts      # CRUD over tasks/*.json, atomic writes, in-mem index, boot reconcile
  scheduler/scheduler.ts   # FIFO + priority, global & per-agent concurrency, retry/backoff
  run/run-manager.ts       # spawns runs via core launchRun, captures logs, reports exit
  server/ipc-server.ts     # Bun.serve over unix socket; routes → store/scheduler
  client/ipc-client.ts     # CLI-side client: ping, submit, list, get, cancel, shutdown
  daemon.ts                # wires Store+Scheduler+RunManager+Server; signals; lockfile
  host/host.ts             # Host interface: install/uninstall/start/stop/status
  host/systemd.ts          # Linux unit at ~/.config/systemd/user/kman-daemon.service
  host/launchd.ts          # macOS plist at ~/Library/LaunchAgents/me.kman.daemon.plist
  host/winsvc.ts           # Windows: registry Run-key / schtasks autostart
  host/index.ts            # selectHost() by process.platform
  tray/tray.ts             # systray-binary driver over stdio; menu = status/start/stop/logs/quit
```

Depends on `@kman/core` and `@kman/types`. The CLI's `kman daemon` / `kman task`
command groups import the client and host selector from this package.

## 5. Data model (`~/.kman/daemon/`)

- `state.json` — `{ schemaVersion, version, pid, startedAt, token }`. `token` is
  a random string the client must echo in the `x-kman-token` header.
- `tasks/<id>.json` — one record per task:
  ```jsonc
  {
    "id": "string",
    "agent": "coder",
    "task": "do the thing",
    "status": "queued | running | succeeded | failed | canceled",
    "priority": 0,
    "attempts": 0,
    "maxAttempts": 1,
    "createdAt": "iso",
    "startedAt": "iso?",
    "finishedAt": "iso?",
    "exitCode": 0,
    "error": "string?",
    "runtime": "string?",
    "model": "string?",
    "permission": "ask|auto|yolo?",
    "cwd": "string?",
    "logFile": "logs/<id>.log"
  }
  ```
- `logs/<id>.log` — captured stdout + stderr of that run.

Writes are atomic (temp file + rename). On daemon boot, any task left `running`
(no live child) is reconciled: re-queued if attempts remain, else `failed`.

## 6. Scheduler

Ordering: `(priority desc, createdAt asc)`. A global `maxConcurrent` (default 2,
configurable) and an optional per-agent cap. On a free slot it dequeues, calls
`RunManager.start(task)`, marks `running`. On non-zero exit with
`attempts < maxAttempts`, re-queue with linear backoff; otherwise terminal.
`cancel` drops a queued task or kills a running child (SIGTERM → SIGKILL grace).
`RunManager` is an injectable interface so the scheduler is unit-tested with a
fake runner (no real backends).

## 7. IPC protocol (HTTP/JSON)

`Bun.serve({ unix })` on a socket at `~/.kman/daemon/sock` (mac/Linux);
`\\.\pipe\kman-daemon` on Windows. Routes:

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness (no auth) |
| GET | `/status` | daemon meta + queue/running counts |
| POST | `/tasks` | submit a task → record |
| GET | `/tasks` | list (optional `?status=`) |
| GET | `/tasks/:id` | one record |
| GET | `/tasks/:id/logs` | log file contents |
| POST | `/tasks/:id/cancel` | cancel |
| POST | `/shutdown` | graceful stop |

`protocol.ts` exports the typed request/response shapes shared by client and
server. Access control = socket file perms (0600) + `x-kman-token` header
checked against `state.json` (skipped for `/health`).

## 8. CLI surface

- `kman daemon run` — foreground entrypoint (what hosts exec). `--tray` adds the
  tray on mac/Windows.
- `kman daemon start` — detached self-spawn of `daemon run`, writes pid/lock.
- `kman daemon stop | restart | status`.
- `kman daemon install [--host systemd|launchd|tray|auto] [--start]` / `uninstall`
  — register the OS host for login autostart.
- `kman task submit -a <agent> --task <text> [--priority N] [--max-attempts N] [--cwd p] [--runtime r] [--model m]`
- `kman task list [--status s] [--json]`
- `kman task get <id> [--json]`
- `kman task logs <id> [-f]`
- `kman task cancel <id>`

All commands print a clear, actionable message (not a stack trace) when no
daemon is running.

## 9. Hosts & tray

`Host` interface: `install()`, `uninstall()`, `start()`, `stop()`, `status()`.
One implementation per platform generates the native unit/plist/registry entry
that execs `kman daemon run` and shells to `systemctl --user` / `launchctl` /
registry. `selectHost()` picks by `process.platform`.

The **tray** (mac/Windows) is a `systray`-style helper binary driven over stdio
from `kman daemon run --tray`; menu: status line, Start/Stop, Open logs dir,
Quit. Tray and host reuse the IPC client. The native widget cannot be exercised
in a headless CI environment — only its pure logic (menu-state mapping, unit/
plist text generation) is unit-tested. This limitation is called out explicitly
rather than faked.

## 10. Testing

`bun test`, matching the existing `*.test.ts` convention:

- TaskStore: CRUD, atomic write, boot reconciliation.
- Scheduler: ordering, concurrency cap, retry/backoff (fake RunManager).
- protocol: request/response round-trip.
- Host: snapshot the generated systemd unit / launchd plist text.
- IPC: server + client integration over a temp socket.

## 11. Out of scope (v1)

Cron/recurring schedules, remote/networked daemon, multi-user, web dashboard,
live output streaming beyond `task logs -f` tailing.
