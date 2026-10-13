# Pico v3

A web workspace for durable Pi coding-agent sessions. The Node server hosts
[`pi-durable`](https://www.npmjs.com/package/@earendil-works/pi-durable) directly.
There is no Rust server, Swift app, Pi RPC subprocess, or session importer.

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
restart. This does not guarantee exactly-once external tool side effects.

## Storage and sessions

The default data directory is `~/.pico`. Use `--data-dir PATH` to change it.
Each server owns one SQLite database and can run many sessions at the same
time. A process lock prevents two servers from opening the same directory.
Pico starts with fresh sessions; it does not import Pi session files.
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
in the health response. MCP OAuth setup is not implemented in Pico.

The workspace includes Git changes and diffs, file browsing, syntax
highlighting, and PTY terminals.

## Remote access

Pico can execute shell commands and read files. Do not expose it to an
untrusted network. Non-loopback binding requires `PICO_TOKEN` with at least
24 characters.

```sh
export PICO_TOKEN="$(openssl rand -hex 32)"
pnpm start --host 0.0.0.0 --no-open
```

Use Tailscale Serve with HTTPS in front of the server. Visit `/login` and enter
the token. The browser uses an HTTP-only, same-site cookie for HTTP, events,
and terminal connections. API clients can use `Authorization: Bearer TOKEN`.
Keep the token secret and do not put it in a URL. The token is also required
for the status and stop commands when authentication is enabled.

Local-only servers check the Host header. Browser requests and terminal
connections reject cross-origin access. These controls are not a filesystem
sandbox: authenticated users have the server user's access.

## Development

```sh
pnpm dev
pnpm check
pnpm build
PICO_SMOKE_URL=http://127.0.0.1:3141/ pnpm check:smoke
```

Development uses `~/.pico-dev` and backend port 3142, separate from normal data.
The web development server uses port 5173. Set `PICO_DEV_DATA_DIR`,
`PICO_DEV_PORT`, or `PICO_DEV_WEB_PORT` to change these defaults. Server changes rebuild
and restart the Node process; Vite reloads the web client.

The server lives in `server/src`; the React client lives in `src`. Runtime Pi
dependencies are pinned to 1.2.0. Durable is experimental: review its storage
and recovery changes before upgrading. Back up the data directory with Pico
stopped before an upgrade.

`pnpm release VERSION` prepares a local release after checks and builds. It
does not publish, push, or tag. Review the package before publishing.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
