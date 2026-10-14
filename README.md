# Pico

A web workspace for durable [Pi](https://www.npmjs.com/package/@earendil-works/pi-durable)
coding-agent sessions. One Node server hosts the agent runtime and serves the
React web app.

## Requirements

- Node.js 22.19 or later
- pnpm 10.33
- Git and a shell
- Provider credentials in `~/.pi/agent/auth.json`, or set them in Pico

## Run

```sh
pnpm install
pnpm build
pnpm start
```

Open `http://127.0.0.1:3141`. Useful commands:

```sh
pnpm start --no-open --port 3141
pnpm start --data-dir PATH   # default: ~/.pico
pnpm start status
pnpm start stop --wait       # let active runs finish first
pnpm start import-pi         # import old Pi sessions (stop Pico first)
```

## What it does

- **Durable sessions.** Sessions live in one SQLite database. Runs continue
  after a crash or restart. Tools with side effects do not run twice.
- **Workspace.** Git changes and diffs, file browser, syntax highlighting, and
  terminals.
- **Agent tools.** Todo lists, questions to the user, rich output (charts,
  diagrams, tables), timers and watches, background jobs, child sessions in
  git worktrees, Git and GitHub, LSP, browser automation, app previews,
  memory, web access, and MCP.
- **Tool profiles.** `full`, `research`, `read-only`, `review`, or your own.
- **Notifications.** Web Push and ntfy when a run finishes or the agent asks
  a question.

Pi skills, prompt templates, project instructions, and credentials are used.
Legacy Pi extensions are not loaded.

## Remote access

Pico has no login. Anyone who can reach it can run commands as your user.
Use Tailscale and never expose it to the public internet.

```sh
pnpm start --host <tailscale-ip> --no-open
```

Use Tailscale Serve for HTTPS (needed for push notifications).

## Development

```sh
pnpm dev     # backend on 3141, Vite client on 3142
pnpm check
pnpm build
```

Server code is in `server/src`. Client code is in `src`.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
