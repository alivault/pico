# Pico v3

A web workspace for durable Pi coding-agent sessions. The Node server hosts
[`pi-durable`](https://www.npmjs.com/package/@earendil-works/pi-durable) directly.
There is no Rust server, Swift app, or Pi RPC subprocess.

## Requirements

- Node.js 22.19 or later
- pnpm 10.33 for development
- Provider credentials in Pi's `~/.pi/agent/auth.json`, or set them in Pico
- Git and a shell for workspace tools

## Run from source

```sh
pnpm install
pnpm build
pnpm start
```

Pico serves the web app at `http://127.0.0.1:3141`. It tries the next port if the
default is busy. An explicit `--port` must be available.

```sh
pnpm start --no-open --port 3141
pnpm start status
pnpm start stop --wait
```

`stop --wait` drains active runs before closing the database. Ctrl+C stops
without waiting for runs to finish. A crashed run is recovered by durable on
restart. Tools marked replay-safe run again after a crash; Pico's tools with
side effects (commits, pushes, pull requests, notifications, child sessions,
timers) record what they did, so a rerun does not do it twice. Other tools,
such as `bash` and `write`, are not run again: the model gets an
`interrupted` result. MCP tools are not replay-safe unless their server sets
`"replaySafe": true` in `mcp.json`.

## Storage and sessions

The default data directory is `~/.pico`. Use `--data-dir PATH` to change it.
Each server owns one SQLite database and can run many sessions at the same
time. A process lock prevents two servers from opening the same directory.
Pico starts with fresh sessions. Old Pi session files can be imported explicitly.
If a crash leaves `server.lock.guard`, confirm that no Pico process is running,
then move that guard directory to Trash before starting the server again.

Sessions support prompts, steering, follow-ups, abort, model and thinking
selection, compaction, fork, clone, and tree navigation. Session deletion in
the UI archives the session; it does not erase its durable history.

Automatic session names use the first prompt, then refine the name with the
session's model. Names set by the user are not replaced.

Pi skills, prompt templates, project instructions, and provider credentials
are used. Legacy Pi extensions are not loaded. Pico includes coding tools,
web access through `pi-web-access`, MCP through `pi-mcp`, tool search, and
code mode. MCP reads Pi's `mcp.json`; servers that cannot connect are reported
in the health response and in the agent settings. HTTP MCP servers that need
OAuth have a **Sign in** button in the agent settings; tokens go to
`~/.pico/mcp-oauth.json`.

The workspace includes Git changes and diffs, file browsing, syntax
highlighting, and PTY terminals.

## Agent tools

Tools run without approval. Use tool profiles (below) to limit what a session
can do.

| Area                | Tools                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plans and questions | `todo` (a checklist that survives compaction), `ask_user` (a durable question; answer in the card, the Agent panel, or chat)                                      |
| Rich output         | `show` (Mermaid, Vega-Lite charts, tables, sandboxed HTML, markdown, images, diffs)                                                                               |
| Durable work        | `schedule` (in, at, every, cron), `watch` (a command, URL, file, or GitHub CI), `job_start` and the other `job_*` tools (background commands in shared terminals) |
| Large data          | `scratch_put`, `scratch_get`, `scratch_list`, `scratch_delete`                                                                                                    |
| Other sessions      | `spawn_session` (optionally in its own git worktree), `send_to_session`, `read_session`, `list_sessions`, `wait_for_sessions`, `stop_session`                     |
| Development         | `git_*`, `gh_pr`, `gh_issue`, `gh_checks`, `gh_run_log`, `run_tests`, `lsp_*` (TypeScript works out of the box; Python, Rust, and Go use a server from `PATH`)    |
| Web client          | `preview_url`, `preview_screenshot`, `notify`, and the `browser_*` tools (Chrome through Playwright, with cookies and tabs kept per session)                      |
| Memory              | `memory` (project and global facts, shown to every session of the project)                                                                                        |

Timers, watches, child-session reports, and questions are durable: they
continue after a server restart. A background job's process ends with the
server; its record stays, and the session gets one message that it was lost.

The **Agent** tab of the right sidebar shows the session's plan, open
questions, timers and watches, jobs, child sessions, memory, scratchpad, and
tool profile. The **Preview** tab shows a previewed app.

### Worktrees and child sessions

A new session can work in its own git worktree: use the **Worktree** button in
the new-session view (off by default). `spawn_session` can do the same with
`worktree: true`. Worktrees go to `~/.pico/worktrees/<repository>/`, and
ignored files that match the `.env*` pattern are copied into them. Archiving a
worktree session can also remove its worktree when it has no uncommitted
changes; the branch stays. Child sessions show under their parent in the
sidebar. The agent settings limit how many children run at once and how deep
they nest.

### Tool profiles

A profile selects extensions and turns off tools for a session: `full` (the
default), `research` (web, files, browser, notes; no shell), `read-only`, and
`review`. Choose one in the new-session view or the Agent tab. Add your own
profiles as JSON in the agent settings.

### Previews

`preview_url` forwards a local dev server to a Pico port from a range
(default 4100–4199) on the same host as Pico, with WebSockets for hot reload.
This works from a phone over Tailscale. Anyone who can reach Pico can also
reach a previewed dev server. When Pico runs on HTTPS (Tailscale Serve), the
browser does not show the HTTP preview in a frame; open it in a new tab.

### Notifications

Turn on push notifications for a device in **Settings → Agent settings**.
Browsers allow Web Push only on HTTPS or `localhost`; over Tailscale, use
Tailscale Serve. On iOS, add Pico to the home screen first. Pico notifies when
a run finishes and when the agent asks a question, and the agent can call
`notify`. An ntfy topic URL can get the same notifications. Set the Pico
address for links in the same settings.

## Import old Pi sessions

Stop Pico before importing. The importer owns the same database lock and backs
up the database to `~/.pico/backups/` before it writes anything.

```sh
pnpm start stop --wait
pnpm start import-pi
pnpm start
```

The default source is `~/.pi/agent/sessions`. Set `--source-dir PATH` or
`--data-dir PATH` to use other directories. The importer preserves messages,
images, tool results, branches, compaction, context edits, names, model settings,
and labels. It does not run prompts or tools, and does not change source files.
Completed imports are skipped by original session ID on rerun. This is a
one-time snapshot, not a live sync. An import report lists any failed files.

## Remote access

Pico has no app login or access token. Use Tailscale access rules and your
firewall to control who can reach it.

```sh
pnpm start --host 0.0.0.0 --no-open
```

Open `http://<your-tailscale-ip>:3141/`, or use Tailscale Serve for HTTPS.
Binding to `0.0.0.0` also exposes the port on other network interfaces.
To restrict listening to Tailscale, pass your machine's Tailscale IP to
`--host` instead. Do not expose Pico to the public internet.

Anyone who can reach Pico can run commands and access files as the server
user. Local-only servers check the Host header. Browser requests and terminal
connections reject cross-origin access; these checks are not authentication
or a filesystem sandbox.

## Development

```sh
pnpm dev
pnpm check
pnpm build
PICO_SMOKE_URL=http://127.0.0.1:3141/ pnpm check:smoke
```

`pnpm dev` builds the web client and starts two servers on `127.0.0.1`:

- Port 3141: the backend and the production web client. Run `pnpm build:web`
  to update the production client.
- Port 3142: the Vite development web client. It uses the backend on 3141.

Server changes rebuild and restart the backend; Vite reloads the development
client. Development uses your normal data in `~/.pico`, so stop `pnpm start`
first. Set `PICO_DEV_HOST`, `PICO_DEV_PORT`, `PICO_DEV_WEB_PORT`, or
`PICO_DEV_DATA_DIR` to change these defaults. For example,
`PICO_DEV_HOST=0.0.0.0 pnpm dev` allows access from other devices.

The server lives in `server/src`; the React client lives in `src`. Runtime Pi
dependencies are pinned to 1.2.0. Durable is experimental: review its storage
and recovery changes before upgrading. Back up the data directory with Pico
stopped before an upgrade.

`pnpm release VERSION` prepares a local release after checks and builds. It
does not publish, push, or tag. Review the package before publishing.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
