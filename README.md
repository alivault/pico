# Smith

Smith (formerly Pico) is a web workspace for durable [Pi](https://www.npmjs.com/package/@earendil-works/pi-durable)
coding agents. One Node server hosts the agent runtime and serves the
React web app.

![Smith workspace where an agent runs two subagents, each in its own worktree](https://smith.aliabbas.net/screenshots/smith-workspace.png)

![Smith workspace in light mode with subagents in the sidebar and the Agent tab](https://smith.aliabbas.net/screenshots/smith-workspace-alt.png)

| Dark mobile browser                                                                           | Light mobile browser                                                                               |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ![Smith mobile browser in dark mode](https://smith.aliabbas.net/screenshots/smith-mobile.png) | ![Smith mobile browser in light mode](https://smith.aliabbas.net/screenshots/smith-mobile-alt.png) |

## Requirements

- Node.js 22.19 or later
- pnpm 10.33 (only to run from source)
- Git and a shell
- Provider credentials in `~/.pi/agent/auth.json`, or set them in Smith

## Install

```sh
npm install -g @alivault/smith
smith
```

Or try it without a global install: `npx @alivault/smith`.

### Run Smith

`smith` runs Smith in this terminal and opens
`http://127.0.0.1:3141`. Smith stops when you close the terminal. To keep it
running in the background, use `--detach`:

```sh
smith serve --detach       # output goes to ~/.smith/server.log
smith status               # is Smith running? --json for scripts
smith stop --wait          # stop after active turns finish
smith stop --pty-host      # also end terminals and jobs
smith restart              # restart at once; cut-off turns continue
smith --port 3141 --no-open
smith --data-dir PATH      # default: ~/.smith
smith import-pi            # import Pi sessions as agents (stop Smith first)
smith move-project OLD NEW # after you move a project folder
```

Smith does not start again after a reboot. Run `smith serve --detach`
again, or start it from a service manager without `--detach`.

### Update

```sh
smith update
```

This installs the newest version where Smith is installed (the same npm
prefix, for example `~/.local`), and restarts Smith.
`smith update --check` only looks, `--no-restart` leaves the restart to
you, and `smith update 2.8.0` installs a given version.

Smith also looks for a new version every six hours. The sidebar shows it, and
Settings, Server can install it. There you can also turn on preview releases
(`smith channel set preview`, the npm tag `next`) or turn off the check.
Smith that runs from source, or that pnpm or npx installed, shows the command to
run instead.

### Upgrade from Pico

Smith was called Pico (the npm package `@alivault/pico`, the command
`pico-app`). Smith 3 is a new package with a new command:

```sh
pico-app stop --wait
npm uninstall -g @alivault/pico
npm install -g @alivault/smith
smith
```

The first start of `smith` moves your data from `~/.pico` to `~/.smith`. It
renames the folder (it does not copy it, so both must be on the same disk),
renames the database to `smith.sqlite`, changes the stored paths under
`~/.pico` to `~/.smith`, and runs `git worktree repair` for the agent
worktrees. The server log (`~/.smith/server.log`) lists each step. The move
happens only when `~/.smith` does not exist yet and you did not set
`--data-dir` or `SMITH_HOME`. Old terminals and jobs end; settings in the
browser (theme, sidebar layout, drafts) start again from the defaults.
Environment variables are now `SMITH_*`, not `PICO_*`.

### Move a project folder

Smith stores the folder of each project and agent. After you move or rename
a project folder, tell Smith:

```sh
mv ~/code/old-name ~/code/new-name
smith move-project ~/code/old-name ~/code/new-name
```

It changes the stored paths that start with the old path (agents, the
sidebar, settings), and repairs the project's agent worktrees in
`~/.smith/worktrees` with `git worktree repair`. When Smith runs, it
restarts to make the change; turns that the restart cuts off continue.

## Run from source

```sh
pnpm install
pnpm build
pnpm start
```

Open `http://127.0.0.1:3141`. Useful commands:

```sh
pnpm start --no-open --port 3141
pnpm start --data-dir PATH   # default: ~/.smith
pnpm start status
pnpm start stop --wait       # let active turns finish first
pnpm start restart           # load a new build at once
pnpm start import-pi         # import Pi sessions as agents (stop Smith first)
```

## What it does

- **Durable agents.** Agents and their conversations live in one SQLite
  database. Turns continue after a crash or restart. Tools with side effects do not run twice.
- **Workspace.** Git changes and diffs, file browser, syntax highlighting, and
  terminals.
- **Terminals that survive restarts.** Terminals and background jobs run in a
  small `smith-pty-host` process (one for each data directory). When the Smith
  server restarts, it finds them again with their output. The host stops by
  itself when no terminal runs and no server is connected for 10 minutes;
  with no server for 12 hours, it also ends shells that run nothing. To stop
  Smith and the host: `smith stop --pty-host` (terminals and jobs end too).
  `smith serve --no-pty-host` keeps terminals in the server process.
- **Agent tools.** Todo lists, questions to the user, background jobs that
  report their exit, terminals, subagents in git worktrees, browser
  automation, code mode, web access, and MCP.
- **Tool profiles.** `full`, `builder`, `researcher`, `reviewer`,
  `read-only`, or your own. In `reviewer` and `read-only`, bash runs in a
  bubblewrap sandbox (Linux): the filesystem is read-only and there is no
  network, so the agent cannot change files with a script.
- **Safe subagents.** A subagent gets a tool profile from its parent. It has
  no `ask_user` or `spawn_subagent` unless the parent grants them, and its
  bash refuses `git push` to main, `sudo`, and the commands that the parent
  lists. Each message from a subagent is a question, done, or waiting (its
  turn ended on a job). Questions and done go into the parent's follow-up
  queue; waiting shows only in the `agents` list action.
- **Notifications.** Web Push and ntfy when a turn finishes or the agent asks
  a question.
- **Search across agents.** The agents dialog also finds messages: the text
  of every agent, also archived ones, on all machines. Agents search past
  work with the `agents` tool (`search`, then `read` with `entry`). The index
  is `~/.smith/search.sqlite`. Smith builds it in the background, and you can
  delete it at any time.

Pi skills, prompt templates, project instructions, and credentials are used.
Legacy Pi extensions are not loaded.

## Remote access

Smith has no login. Anyone who can reach it can run commands as your user.
Use Tailscale and never expose it to the public internet.

```sh
smith --host <tailscale-ip> --no-open
```

Use Tailscale Serve for HTTPS (needed for push notifications).

## Multiple machines

One Smith can show the agents of other computers, for example a build
server. Each machine runs its own Smith on its `127.0.0.1`. The Smith that you
open (the hub) connects to them over SSH and shows them in the sidebar.
Agents, terminals, and jobs run on their own machine and continue when the
hub goes offline.

```sh
smith machine add ali@workbox      # SSH target, alias, or Tailscale name
smith machine list
smith machine status workbox
smith machine reconnect workbox    # after a password, key, or check prompt
smith machine disable workbox      # stop connecting; enable connects again
smith machine remove workbox       # Smith keeps running on workbox
```

`machine add` connects in your terminal, so SSH can ask for a password or a
host key. It finds Node.js 22.19+ and Smith on the remote machine, and asks
before it installs Smith (with npm, into `~/.local`). The hub then uses your
SSH config, keys, and agent with one shared connection. It never asks for
input; when SSH needs you, the machine shows **Attention** and the command to
run. Smith does not store passwords or keys, and it copies no settings or
credentials to other machines.

Tailscale works: use a MagicDNS name or a `100.x` address as the target,
with OpenSSH or Tailscale SSH.

Anyone who can open the hub can run commands on all its machines. Keep the
hub on localhost or your tailnet. Agents on the hub can use the agent tools
(`spawn_subagent`, `agents`) with a `machine` argument, for example to start
a subagent on `workbox`.

## Control Smith from scripts and other agents

`smith agent` starts, messages, and waits for agents of a running Smith:

```sh
id=$(smith agent start . "Find why the tests are slow")
smith agent send "$id" "Now fix it" --wait
smith agent show "$id"
smith agent list
smith agent search "websocket reconnect"   # the messages of all agents
```

`.` is the directory; without it, the agent works in the current directory.
`start` takes `--model`, `--profile`, `--worktree`, and `--machine` (a machine
of the hub; an ID such as `workbox:s12` names one too). `send` never
interrupts: a busy agent gets the message after its current turn, unless you
add `--steer`. A goal or message of `-` comes from stdin. With `--wait`,
`send` and `start` print the answer; the exit code is 0 when the agent is
done, 1 when it failed or stopped, 2 when it waits for you, and 3 when
`--timeout` passes first. `--json` prints JSON. `smith agent wait ID`
waits for an agent, and `smith agent stop ID` stops its current turn. Run
`smith agent help` for all options.

Smith is also an MCP server, at `/mcp`. Agents outside Smith, such as Claude
Code and Codex, can then list, start, message, read, wait for, and stop Smith
agents, and search their messages. `smith mcp` prints the address and the commands to add it:

```sh
claude mcp add --transport http smith http://127.0.0.1:3141/mcp
codex mcp add smith --url http://127.0.0.1:3141/mcp
```

The MCP server has no sign-in, like the rest of Smith: anyone who can reach
Smith can use it.

## Development

```sh
pnpm dev     # backend on 3141, Vite client on 3142
pnpm check
pnpm build
```

This is a pnpm monorepo:

- `apps/smith`: the Smith app. Client code is in `apps/smith/src`. Server code
  is in `apps/smith/server/src`.
- `apps/website`: the static site at
  [smith.aliabbas.net](https://smith.aliabbas.net). Deploy it with
  `pnpm website:deploy`.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
