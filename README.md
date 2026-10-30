# Pico

A web workspace for durable [Pi](https://www.npmjs.com/package/@earendil-works/pi-durable)
coding-agent sessions. One Node server hosts the agent runtime and serves the
React web app.

![Pico workspace where an agent runs two child sessions, each in its own worktree](apps/pico/public/screenshots/pico-workspace.png)

![Pico workspace in light mode with child sessions in the sidebar and the Agent tab](apps/pico/public/screenshots/pico-workspace-alt.png)

| Dark mobile browser                                                               | Light mobile browser                                                                   |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ![Pico mobile browser in dark mode](apps/pico/public/screenshots/pico-mobile.png) | ![Pico mobile browser in light mode](apps/pico/public/screenshots/pico-mobile-alt.png) |

## Requirements

- Node.js 22.19 or later
- pnpm 10.33 (only to run from source)
- Git and a shell
- Provider credentials in `~/.pi/agent/auth.json`, or set them in Pico

## Install

```sh
npm install -g @alivault/pico
pico-app
```

Or try it without a global install: `npx @alivault/pico`.

## Run from source

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
- **Terminals that survive restarts.** Terminals and background jobs run in a
  small `pico-pty-host` process (one for each data directory). When the Pico
  server restarts, it finds them again with their output. The host stops by
  itself when no terminal runs and no server is connected for 10 minutes;
  with no server for 12 hours, it also ends shells that run nothing. To stop
  Pico and the host: `pico-app stop --pty-host` (terminals and jobs end too).
  `pico-app serve --no-pty-host` keeps terminals in the server process.
- **Agent tools.** Todo lists, questions to the user, background jobs that
  report their exit, terminals, child sessions in git worktrees, browser
  automation, code mode, web access, and MCP.
- **Tool profiles.** `full`, `builder`, `researcher`, `reviewer`,
  `read-only`, or your own.
- **Safe child sessions.** A child gets a tool profile from its parent. It has
  no `ask_user` or `spawn_session` unless the parent grants them,
  and its bash refuses `git push` to main, `sudo`, and the commands that the
  parent lists. Each message from a child is a question, done, or waiting
  (its turn ended on a job). Questions and done go into
  the parent's follow-up queue; waiting shows only in the `sessions` list action.
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

## Multiple machines

One Pico can show the sessions of other computers, for example a build
server. Each machine runs its own Pico on its `127.0.0.1`. The Pico that you
open (the hub) connects to them over SSH and shows them in the sidebar.
Sessions, terminals, and jobs run on their own machine and continue when the
hub goes offline.

```sh
pico-app machine add ali@workbox      # SSH target, alias, or Tailscale name
pico-app machine list
pico-app machine reconnect workbox    # after a password, key, or check prompt
pico-app machine remove workbox       # Pico keeps running on workbox
```

`machine add` connects in your terminal, so SSH can ask for a password or a
host key. It finds Node.js 22.19+ and Pico on the remote machine, and asks
before it installs Pico (with npm, into `~/.local`). The hub then uses your
SSH config, keys, and agent with one shared connection. It never asks for
input; when SSH needs you, the machine shows **Attention** and the command to
run. Pico does not store passwords or keys, and it copies no settings or
credentials to other machines.

Tailscale works: use a MagicDNS name or a `100.x` address as the target,
with OpenSSH or Tailscale SSH.

Anyone who can open the hub can run commands on all its machines. Keep the
hub on localhost or your tailnet. Agents on the hub can use the session tools
with a `machine` argument, for example to start a session on `workbox`.

## Development

```sh
pnpm dev     # backend on 3141, Vite client on 3142
pnpm check
pnpm build
```

This is a pnpm monorepo:

- `apps/pico`: the Pico app. Client code is in `apps/pico/src`. Server code
  is in `apps/pico/server/src`.
- `apps/website`: the static site at
  [pico.aliabbas.net](https://pico.aliabbas.net). Deploy it with
  `pnpm website:deploy`.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
