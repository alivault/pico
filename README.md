# Pico

Pico is a local, keyboard-friendly workspace for Pi coding-agent sessions, available in the browser and as a native SwiftUI app for macOS and iOS.

It gives you a persistent session browser, a live conversation shell, git tools, and project-aware prompt helpers in one app.

## Browser workspace

![Pico workspace showing the session browser, conversation shell, composer, and git tools](public/screenshots/pico-workspace.png)

![Pico workspace showing project-aware context and coding-agent workflow](public/screenshots/pico-workspace-alt.png)

| Dark mobile browser                                                     | Light mobile browser                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| ![Pico mobile browser in dark mode](public/screenshots/pico-mobile.png) | ![Pico mobile browser in light mode](public/screenshots/pico-mobile-alt.png) |

## Native Apple clients

Pico also includes a shared SwiftUI client with platform-native layouts for macOS and iOS. Both clients connect to the same local Pico server, stream live session updates, manage conversations, and provide native Git and project-file workflows.

| macOS dark                                                                       | macOS light                                                                        |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| ![Pico native macOS client in dark mode](public/screenshots/pico-macos-dark.jpg) | ![Pico native macOS client in light mode](public/screenshots/pico-macos-light.jpg) |

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
bundles include Pi `0.80.6` and the compiled Pi authentication bridge, so normal
use does not require a global Pi installation or a Node server runtime.

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

## Developing the native macOS and iOS app

The native SwiftUI client lives in `apps/apple/Pico` and builds for both macOS and iOS. During development it connects to an already-running Pico server over HTTP JSON and SSE. The macOS distribution bundles the native Rust server and standalone Pi executables; iOS remains a remote companion client.

Open the shared project in Xcode:

```bash
open apps/apple/Pico/Pico.xcodeproj
```

Select the `Pico` scheme and a macOS, iPhone, or iPad destination.

Build and launch the macOS app:

```bash
xcodebuild \
  -project apps/apple/Pico/Pico.xcodeproj \
  -scheme Pico \
  -destination 'platform=macOS' \
  -derivedDataPath /tmp/pico-macos-build \
  build

open /tmp/pico-macos-build/Build/Products/Debug/Pico.app
```

The macOS client defaults to `localhost`, which resolves to
`http://localhost:3141`.

### Dogfooding Pico safely

Keep the signed app and persistent server in `/Applications/Pico.app` as the
known-good control environment. Build and launch the separately identified,
client-only **Pico Dev** app with:

```bash
pnpm dogfood:macos
```

The command verifies the client-only bundle, replaces
`~/Applications/Pico Dev.app`, and relaunches it. Pico Dev uses bundle identifier
`com.alivault.pico.macos.dev`, the purple development icon, a `pico-dev://` URL
scheme, and separate preferences. It cannot register or update Pico's
production server or menu-bar services. It can connect to the stable server on
`localhost:3141`, so server-owned Pi work keeps running while Pico Dev is
rebuilt or crashes.

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

Pico Dev offers Stable (`3141`) and Development (`4142`) connection buttons.
Viewer context, SSE cursor, and sidebar directories are persisted per server
URL, so switching does not replay one server's state against the other.

To expose only the target server to a trusted private or VPN interface, set one
exact address and restart it:

```bash
pnpm dogfood:server:network -- 100.64.0.10
pnpm dogfood:server:restart
```

Never point the target at a wildcard listener or at the stable server's data or
session directory. Package a release candidate only after the isolated client
and server pass validation; do not replace `/Applications/Pico.app` while it is
the control environment for active work.

### Connecting over a trusted private network

The macOS distribution includes the **Pico Server** menu-bar app. To let another
Pico client connect without SSH or CLI setup:

1. Open Pico Server from the menu bar.
2. Enable **Allow remote connections**.
3. Enter one specific private or VPN interface IP address.
4. Apply the setting and allow the server to drain and restart.
5. Enter that IP address or a hostname that resolves to it in Pico on the other
   Mac, iPhone, or iPad.

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

Run the shared native tests on macOS:

```bash
xcodebuild \
  -project apps/apple/Pico/Pico.xcodeproj \
  -scheme Pico \
  -destination 'platform=macOS' \
  test
```

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
configuration. When macOS signing/notarization is enabled for the repository,
the release also publishes the native DMG and generated Homebrew cask. Formula
and cask templates live under `packaging/homebrew`.

### Packaging the macOS app

The native packaging command builds universal arm64/x86_64 copies of Pico,
`pico-server`, Pi, the standalone Pi bridge, and the independent `PicoMenu.app`
menu-bar login item. It assembles the bundled `SMAppService` LaunchAgent, signs
nested code in order, verifies the app, and creates a drag-to-Applications DMG.
Without a signing identity it produces an ad-hoc-signed build for inspecting the
app and DMG; macOS background-service registration remains disabled in that
artifact:

```bash
pnpm package:macos
```

For distribution, configure a Developer ID identity and a `notarytool` keychain
profile. The command then notarizes and staples both the app and DMG:

```bash
MACOS_SIGN_IDENTITY='Developer ID Application: Example (TEAMID)' \
MACOS_NOTARY_PROFILE='Pico Notary' \
pnpm package:macos
```

Developer ID-signed packaged builds expose Start at Login and approval state in
Pico Settings. The separate **Pico Server** menu-bar app keeps the server
available when the main app quits and provides trusted-network listener
configuration, Open, New Chat, Restart Server, Show Logs, Start at Login
settings, and Quit Completely actions.

## Development commands

```bash
pnpm dev        # start Rust plus the Vite browser client
pnpm dogfood:macos # build and launch the isolated Pico Dev client
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
- Native SwiftUI for macOS and iOS
- React 19 and TypeScript
- Vite+ static SPA builds
- Tailwind CSS v4
- Base UI / shadcn-style components

## License

Pico is licensed under AGPL-3.0-only. See [LICENSE](./LICENSE).
