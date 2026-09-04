# Pico

Pico is a local, keyboard-friendly workspace for Pi coding-agent sessions, available in the browser, as a native GPUI desktop app, and as a SwiftUI app for iPhone and iPad.

It gives you a persistent session browser, a live conversation shell, git tools, and project-aware prompt helpers in one app.

## Browser workspace

![Pico workspace showing the session browser, conversation shell, composer, and git tools](public/screenshots/pico-workspace.png)

![Pico workspace showing project-aware context and coding-agent workflow](public/screenshots/pico-workspace-alt.png)

| Dark mobile browser                                                     | Light mobile browser                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| ![Pico mobile browser in dark mode](public/screenshots/pico-mobile.png) | ![Pico mobile browser in light mode](public/screenshots/pico-mobile-alt.png) |

## Native clients

The native desktop client is written in Rust with GPUI and
[GPUI Component](https://github.com/longbridge/gpui-component). It follows the
web workspace's three-pane session, conversation, and files layout while using
the same HTTP JSON and SSE server contracts. Its integrated terminal uses
libghostty's terminal core with a native GPUI renderer.

The SwiftUI client is now focused on iPhone and iPad instead of sharing its UI
with macOS.

| iOS dark                                                                     | iOS light                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| ![Pico native iOS client in dark mode](public/screenshots/pico-ios-dark.png) | ![Pico native iOS client in light mode](public/screenshots/pico-ios-light.png) |

## What Pico gives you

- A fast conversation shell for Pi sessions
- Directory-organized session browsing
- Session search, rename, delete, fork, and tree navigation
- Streaming responses with abort, steer, and queued follow-ups
- Prompt drafts, image attachments, slash commands, path completions, and `@file` references
- Model and thinking-level controls
- Optional hiding of thinking/tool output
- Git status, changed files, commits, branches, pull, push, and commit flows
- Desktop notifications, sound, and unread/live session indicators
- Settings for theme, display, auth, and completion notifications

## Built on Pi

The native Pico server runs the standalone Pi RPC executable and keeps Pi
sessions alive independently of browser and desktop clients. Native release
bundles include Pi `0.84.4` and the compiled Pi authentication bridge, so normal
use does not require a global Pi installation or a Node server runtime.

Pico also bundles pinned versions of
[`pi-codex-conversion`](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/main/packages/pi-codex-conversion)
and
[`pi-codex-web-run`](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/main/packages/pi-codex-web-run).
The Codex tool adapter applies to Codex-like GPT models, and Pico exposes the
`web_run` search and browsing tool only while an `openai-codex` model is active.
Set `PICO_DISABLE_DEFAULT_PI_EXTENSIONS=1` to opt out, or
`PICO_PI_EXTENSIONS=/path/to/extension` to replace Pico's default extension
bundle. Pi extensions execute with the same system access as Pi itself.

The repository still pins `@earendil-works/pi-coding-agent` to the same version
for building Pi release artifacts and the authentication bridge. Refresh it
with:

```bash
pnpm update:pi
```

## Getting started

Run Pico without cloning the repo (Node.js 22.19.0 or newer is required):

```bash
npx @alivault/pico
```

Or install it globally:

```bash
npm install -g @alivault/pico
pico-app
```

On first launch, the npm command downloads the matching release bundle for
macOS or Linux, verifies its SHA-256 checksum, and starts the native Rust
server. If a compatible persistent server is already running, `pico-app`
attaches to it instead of starting a duplicate.

Pico starts locally and opens:

```text
http://localhost:3141
```

You can choose a different port with:

```bash
pico-app --port 3000
```

Update a global install with:

```bash
pico-app update
```

Updates verify the server/API protocol first, stop accepting new prompt work,
wait for active Pi runs and queued follow-ups to finish, replace the package,
and restart the server so SSE clients reconnect. A protocol-changing release is
never installed automatically.

## Developing from source

Install dependencies:

```bash
pnpm install
```

Start Pico in development mode. This builds and launches the Rust backend on
port 3142, launches Vite on port 3141, and proxies API, SSE, and terminal
WebSocket traffic to Rust:

```bash
pnpm dev
```

Then open:

```text
http://localhost:3141
```

## Developing the native GPUI desktop app

The GPUI client lives in `crates/pico-desktop`. Start a Pico server first, then
run the desktop client from the repository root:

```bash
pnpm desktop
```

The desktop client uses the same server contracts as the web workspace and
includes live session sync, global session search and management, persistent
drafts, image prompts, skills, steer/follow-up queues, model and thinking
controls, provider authentication, extension UI requests, project files,
working-tree and commit diffs, Git mutations, session tree/fork tools, a
server-owned terminal, completion notifications, settings, and keyboard
commands. Press `⌘K` to open the command palette.

It defaults to `http://127.0.0.1:3141` and the current working directory. You
can override either value:

```bash
PICO_SERVER_URL=http://127.0.0.1:4142 \
PICO_DIRECTORY=/path/to/project \
pnpm desktop
```

For UI development, use the watch mode:

```bash
pnpm desktop:dev
```

The watcher rebuilds and relaunches the GPUI process when files under
`crates/pico-desktop` or the root `Cargo.toml` change. It is process-level hot
reload rather than state-preserving in-process patching; the stable viewer
context reconnects to the existing server session after each relaunch.

The first desktop build downloads the pinned Zig compiler required by
libghostty into the ignored `.pico-dev` directory. Pico verifies the download's
SHA-256 checksum. Set `ZIG=/path/to/zig` to use an existing Zig 0.14.1 binary.

Check the desktop crate without launching it:

```bash
pnpm desktop:check
```

## Developing the native iOS app

The iPhone and iPad SwiftUI client lives in `apps/apple/Pico` and connects to
an already-running Pico server over HTTP JSON and SSE.

```bash
open apps/apple/Pico/Pico.xcodeproj
```

Select the `Pico` scheme and an iPhone or iPad destination.

### Dogfooding Pico safely

Keep the stable server on port `3141` as the known-good control environment.
The GPUI client is client-only during development, so rebuilding or crashing it
does not terminate server-owned Pi work.

For full-stack server work, launch an isolated target server on port `4142`:

```bash
pnpm dogfood:server
pnpm dogfood:server:status
pnpm dogfood:server:stop
```

The target is managed as an on-demand `launchd` job. Restart builds the
candidate first, lets the currently deployed development server drain active Pi
work, atomically deploys the candidate, and then starts it. Its state, control
socket, logs, and Pi sessions live under
`~/Library/Application Support/Pico Development`. It uses Pi's existing
`~/.pi/agent` configuration and `AuthStorage` while passing an independent
session directory to Pi, preventing the stable and development servers from
owning the same session process.

Point the GPUI client at the isolated server with
`PICO_SERVER_URL=http://127.0.0.1:4142 pnpm desktop:dev`.

To expose only the target server to a trusted private or VPN interface, set one
exact address and restart it:

```bash
pnpm dogfood:server:network -- 100.64.0.10
pnpm dogfood:server:restart
```

Never point the target at a wildcard listener or at the stable server's data or
session directory. Validate a release candidate against the isolated server
without disturbing the stable server that owns active work.

### Connecting over a trusted private network

Configure the Pico server with one specific private or VPN interface address,
then enter that server URL in the iOS client or pass it through
`PICO_SERVER_URL` to the desktop client.

Pico continues listening on `127.0.0.1:3141` and adds the configured address on
port `3141`. Browser clients can open `http://<address>:3141` or a resolvable
hostname such as `http://macbook-pro:3141`. If the configured interface is
unavailable, local Pico access remains available and the menu app reports that
the remote listener could not start.

This mode intentionally has no Pico-level authentication and accepts any valid
HTTP hostname on its exact listeners. Use only an address protected by a private
network you trust, such as a VPN interface, and treat every device and browser
on that network as trusted. Never use `0.0.0.0` or expose port `3141` to the
public internet.

Run the iOS tests with an installed simulator:

```bash
xcodebuild \
  -project apps/apple/Pico/Pico.xcodeproj \
  -scheme Pico \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  test
```

### Packaging native CLI releases

Build one downloadable CLI bundle with the Rust server, standalone Pi, compiled
Pi bridge, and browser assets:

```bash
pnpm package:native -- --target darwin-arm64
# darwin-x64, linux-arm64, and linux-x64 are also supported
```

Tagged releases publish all four checksum-protected bundles plus generated
Homebrew formula metadata. The formula includes a headless `brew services`
configuration. GPUI desktop application packaging is a separate release flow.
Formula templates live under `packaging/homebrew`.

## Development commands

```bash
pnpm dev          # start Rust plus the Vite browser client
pnpm desktop      # build and launch the GPUI desktop client
pnpm desktop:dev  # rebuild and relaunch GPUI after desktop source changes
pnpm desktop:check # typecheck the GPUI desktop crate
pnpm dogfood:server # safely rebuild/restart the isolated target server on 4142
pnpm build      # build the static browser application
pnpm preview    # preview the static browser build (Rust remains on 3142)
pnpm check      # format/lint/typecheck
pnpm check:fix  # format/lint/typecheck with fixes
pnpm release patch # check, build, version, tag, and push a release
```

## Releasing

After committing changes, run one of:

```bash
pnpm release patch
pnpm release minor
pnpm release major
```

The release script verifies a clean, up-to-date `main`, runs checks and build,
keeps the npm and Rust server versions aligned, creates the matching `v*.*.*`
tag, and pushes the branch plus tags. The GitHub release workflow publishes the
four native bundles, generated Homebrew metadata, and npm launcher from the
pushed tag.

## Tech stack

Pico is built with:

- Rust, Tokio, Axum, portable-pty, and Inkjet for the persistent server
- Standalone Pi RPC and a compiled Pi SDK authentication bridge
- TanStack Router, Query, Store, Hotkeys, and Pacer
- GPUI and GPUI Component for the native desktop client
- Native SwiftUI for iPhone and iPad
- React 19 and TypeScript
- Vite+ static SPA builds
- Tailwind CSS v4
- Base UI / shadcn-style components

## License

Pico is licensed under AGPL-3.0-only. See [LICENSE](./LICENSE).
