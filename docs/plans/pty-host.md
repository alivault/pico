# Design: a pty-host, so terminals and jobs survive a server restart

Status: proposal (Phase 4, item 5). Nothing here is built yet.

## Problem

Every terminal and job is a child of the Pico server. When the server stops
(a release, a crash, `pnpm dev` after each server rebuild), node-pty closes
the pty masters, the shells get SIGHUP, and the jobs die. Pico marks them
`lost`. During development of Pico itself this happens many times each hour.

## Goal

Terminals and jobs keep running while the server restarts. The new server
finds them again, with their output, their input sequence state, and their
exit codes. Nothing else changes for the client or the agent.

## Process model

- **One pty-host for each data directory.** It owns all ptys of that data
  directory. The data directory identifies a Pico instance (`~/.pico`,
  `/tmp/pico-test-data`, a remote machine's own `~/.pico`), so test instances
  and the live instance never share a pty-host.
- **The server starts it, on demand.** At startup the server connects to
  `<dataDir>/pty-host/socket`. If nothing answers, it spawns
  `node <dist>/pty-host.mjs --data-dir <dataDir>` with `detached: true`,
  `stdio` to `<dataDir>/pty-host/log`, and `unref()`, then connects again
  (retry for about 3 s). The pty-host is then not a child in the server's
  process group, so a server stop (SIGTERM to the group in `scripts/dev.mjs`,
  or a crash) does not stop it.
- **A lock against two hosts.** The pty-host takes `<dataDir>/pty-host/lock`
  (an `O_EXCL` pid file, checked with `kill(pid, 0)` when it exists). A second
  pty-host that finds a live pid exits at once. A stale lock (dead pid) is
  removed.
- **It stops itself when it has no work.** When no pty runs and no server is
  connected for 10 minutes, the pty-host exits. So it does not stay after
  the user stops using Pico.
- **The server is the only client.** The pty-host does not know sessions,
  documents, or the web client.

## Versions and upgrades

- The pty-host is a small separate bundle (`dist/pty-host.mjs`) with its own
  `PTY_HOST_PROTOCOL` number. The hello message carries the protocol number,
  the Pico version, and the pid.
- **Same protocol:** the server uses the running pty-host, also when the
  Pico version is different. The protocol changes rarely, as the pty-host
  does little.
- **Different protocol:** the server does not use the old pty-host for new
  terminals. It asks the old one to `drain`: it takes no new ptys, keeps its
  running ones, and exits when the last one ends. The server starts a new
  pty-host on a new socket name (`socket-<protocol>`). The server talks to
  the old one only to list, read, write, and stop the ptys that it still has,
  if the old protocol is one that the server still reads (we keep the N-1
  protocol). If the server cannot read the old protocol, those jobs show as
  `lost` (as today), but their processes still end normally.
- `pnpm dev` rebuilds of the server do not restart the pty-host. A change to
  the pty-host code itself shows as a new protocol number only when the
  messages change. For other changes the developer stops it with a command
  (`pico-app pty-host restart`, which drains it).

## Transport and protocol

- A Unix domain socket: `<dataDir>/pty-host/socket`. The directory is mode
  0700 and the socket 0600, as for the SSH control sockets in
  `machines/ssh.ts`. Only the user can connect. No TCP port.
- Windows: a named pipe with the same protocol. (Pico's terminals already
  depend on node-pty; Windows support stays as it is now.)
- Messages: one JSON object for each line (NDJSON). Output data is a string
  (node-pty gives strings). It is simple to debug with `socat`.
- Requests carry an `id`; replies carry the same `id`. Events have no `id`.

| Request                                                          | Reply                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| `hello {protocol, version}`                                      | `{protocol, version, pid, ptys: [...]}`                               |
| `spawn {key, command?, shell, args, cwd, env, cols, rows, kind}` | `{ptyId, pid, device}`                                                |
| `list`                                                           | `[{ptyId, key, kind, pid, cols, rows, exited?, nextSeq, viewerSeqs}]` |
| `attach {ptyId, fromSeq}`                                        | the output after `fromSeq`, or `reset` and the backlog                |
| `detach {ptyId}`                                                 | `{}`                                                                  |
| `write {ptyId, data, viewer?, inputSeq?}`                        | `{written: boolean}` (dedupe in the host)                             |
| `resize {ptyId, cols, rows}`                                     | `{}`                                                                  |
| `signal {ptyId, signal, group?: boolean}`                        | `{}`                                                                  |
| `mode {ptyId}`                                                   | `{echo, icanon}` (the host runs `stty`)                               |
| `forget {ptyId}`                                                 | `{}` (drop an exited pty)                                             |
| `drain`                                                          | `{}`                                                                  |

Events: `output {ptyId, seq, data}`, `exit {ptyId, exitCode, signal}`.

## What moves into the pty-host, and what stays

Into the pty-host (the minimum that must live while the server is down):

- The pty processes (node-pty).
- The output sequence numbers and the bounded backlog (512 KB / 500 chunks),
  so a new server and its viewers can attach again without a gap.
- The **job log writer**: the pty-host appends to `<dataDir>/jobs/<id>.log`
  (the same `JobLogWriter` with its 10 MB parts). Without this, output that a
  job writes while the server is down is lost.
- The per-viewer input sequence numbers, so a retry after a reconnect is
  still written one time.
- An **exit journal**: on exit, the pty-host appends `{key, exitCode,
signal, endedAt}` to `<dataDir>/pty-host/exits.jsonl` (fsync) and keeps the
  exited pty for 30 minutes.

Stays in the server (it needs documents, sessions, and the agent):

- Job records (`pico.jobs`), the job index, steers, notifications, focus.
- The input-wait watcher. It needs only the output stream and `mode`, which
  the server gets through the socket. After a reconnect it starts again from
  "quiet now".
- The headless screen. It is made lazily from the backlog, as now; after a
  reconnect the next read makes it again.
- Scopes, labels, viewer sizes, and WebSockets to the browsers.

The server's `Terminals` class keeps its public API. Inside, each terminal
is a proxy to a pty in the pty-host instead of an `IPty`. This is why the
change is contained: `jobs.ts`, `api.ts`, `server.ts`, and the client do not
change.

## Jobs whose exit happens while the server is down

At startup the server sends `hello` and gets the list of ptys:

1. A job in the job index whose pty is still running: attach to it. The job
   record stays `running`. (Today it becomes `lost`.)
2. A job in the index whose pty has exited: read the exit from the list (or
   from `exits.jsonl` when the pty-host restarted). Record `exited` with the
   real exit code and the end time, and send the usual `[Job finished]` or
   `[Job failed]` steer, with "(it ended while Pico restarted)".
3. A job in the index with no pty and no exit entry: `lost`, as today. This
   happens only when the pty-host itself died.

After the server records an exit, it sends `forget`, and removes the line
from the journal (the journal is rewritten when it grows over 1 MB).

User shells (terminal panel tabs) work the same way: their key is the scope
key and the client key, so a browser that reconnects gets its tab back with
its history.

## Security

- Socket 0600 in a 0700 directory, owned by the user. The pty-host checks
  the peer's uid with `SO_PEERCRED` where Node can see it; in practice the
  file permissions are the control, as for the SSH sockets.
- No new network surface. The pty-host never listens on TCP.
- The pty-host runs commands only from `spawn` requests of the server, which
  already applies the child-session command rules (`childCommandRefusal`).

## Resource limits

- One process (about 40–60 MB RSS for Node with node-pty).
- Backlogs are bounded as now: 512 KB for each pty, and running ptys are
  bounded by `MAX_RUNNING_PER_SESSION` in the server.
- Item 2 (cgroup scopes with `systemd-run --user --scope`) moves into
  `spawn`: the pty-host wraps the command. Whole-tree kill (`signal` with
  `group: true`) also lives there.
- Item 4 (idle shells after 12 h) is a timer in the server, which sends
  `signal` through the socket; the pty-host gives `lastInput`/`lastOutput`.

## Remote machines

Nothing changes in the hub. A remote machine runs its own Pico server with
its own data directory, and that server starts its own pty-host on the remote
machine. The hub still talks only to the remote server through the SSH
forward. A remote server restart (for an update through the hub) now keeps
the remote jobs too.

## `pnpm dev`

`scripts/dev.mjs` stops its children by process group. The pty-host is
detached into its own session (`setsid` through `detached: true`), so it
stays. Each server rebuild reconnects in about 100 ms. Test instances with
their own `PICO_DEV_DATA_DIR` get their own pty-host. A `--no-pty-host` flag
(and the tests) keep the in-process mode, so the server tests stay simple.

## Failure modes

| Failure                                        | Result                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| The pty-host crashes                           | Its ptys get SIGHUP and end. The server sees the socket close, marks running jobs `lost` (as today), and starts a new pty-host for new terminals. |
| The server crashes                             | Nothing happens to the ptys. The next server attaches.                                                                                            |
| A stale socket (no process)                    | `connect` fails with `ECONNREFUSED`: the server checks the lock pid, removes the socket and the lock, and starts a new pty-host.                  |
| Two servers on one data directory              | Both can connect; each keeps its own attachments. This is not a supported setup today either; the lock on the server side stays as it is.         |
| The socket path is too long (macOS: 104 bytes) | Use `<tmpdir>/pico-<hash of dataDir>/socket`, as `machines/ssh.ts` does.                                                                          |
| A slow server (backpressure)                   | The pty-host keeps the bounded backlog; it drops the oldest chunks, and the server gets a `reset` on attach, as a browser does now.               |
| Version mismatch                               | See "Versions and upgrades".                                                                                                                      |

## Size of the change

- New `server/src/pty-host/` (host main, socket server, protocol types):
  about 600 lines.
- `services/terminal.ts`: replace `IPty` with a small `PtyHandle` interface,
  with two implementations (in-process and pty-host client): about 300 lines
  changed, 250 new.
- `extensions/jobs.ts`: recovery reads the pty list and the exit journal; log
  writing moves into the host: about 150 lines.
- `build.mjs` (second entry point), `main.ts` (`pty-host` command), tests
  (a real pty-host in a temp dir: spawn, kill the server side, reconnect,
  exit while disconnected): about 400 lines.
- Total about 1,500–1,800 lines, and 3–5 days of focused work with tests.
  Most of the risk is in reconnect and upgrade edge cases.

## Alternative with less work

**Only jobs survive, with no new protocol: run each job under a detached
supervisor and keep its log as the source of truth.**

- Run each job as `setsid` + `script -qfc '<command>' /dev/null` (Linux) or
  `dtach -n <dataDir>/jobs/<id>.sock <command>` (if `dtach` is installed),
  detached, with its output to the log file, and the exit code to
  `<dataDir>/jobs/<id>.exit`.
- The server shows a job by tailing the log, and sends input through the
  dtach socket (or a FIFO).
- After a restart, the server finds running jobs by pid and the `.exit`
  files.
- Work: about 400–600 lines. Shells in the terminal panel still die on a
  restart.
- Costs: there is no real pty for the viewers after a restart (resize and
  full-screen programs do not work well through `script`/FIFO), `dtach` is
  an extra dependency and is not on macOS by default, and there are two
  code paths for jobs. Input dedupe and the waiting-for-input check (`stty`
  on the pty device) need extra work for each path.

## Recommendation

Build the pty-host as designed, but in two steps:

1. **Step A (most of the value):** the pty-host with `spawn`, `attach`,
   `write`, `resize`, `signal`, `list`, the log writer, and the exit journal.
   Jobs and shells survive server restarts on the same protocol. Version
   mismatch: drain, and mark the old jobs `lost` (no N-1 support yet).
2. **Step B:** N-1 protocol support, `mode` through the host, cgroup scopes
   in `spawn`, and `pico-app pty-host restart`.

The alternative saves perhaps half of the work, but it gives a second job
path with weaker terminals, and shells still die. For Pico developing itself
with `pnpm dev`, both jobs and shells must survive, so the pty-host is
worth it.
