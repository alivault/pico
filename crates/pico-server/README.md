# Pico native server

This crate is Pico's production persistent server. It implements the shared
browser, macOS, and iOS HTTP/SSE/WebSocket contracts, owns long-lived Pi and PTY
processes, and serves the static browser application without a Node runtime.

## Why this architecture

Herdr's open-source server establishes useful boundaries for a persistent local
runtime:

- server-owned facts are separate from process/PTY handles
- clients attach to a long-lived runtime instead of owning it
- protocols are versioned and bounded
- bootstrap snapshots and incremental events are separate concepts
- stale endpoints are detected rather than blindly replaced
- process restore is not misrepresented as process continuity

Pico applies the same principles in `AppState`, `RuntimeRegistry`, the HTTP
manifest, and the Pi RPC bridge.

## Pi without a bundled Node runtime

Pico cannot replace the Pi SDK with Rust without also reimplementing providers,
authentication, tools, extensions, compaction, session trees, and model
behavior. Pi already exposes a language-neutral strict-JSONL RPC mode and ships
standalone Bun-compiled macOS and Linux binaries:

- `pi-darwin-arm64.tar.gz`
- `pi-darwin-x64.tar.gz`
- `pi-linux-arm64.tar.gz`
- `pi-linux-x64.tar.gz`

The production DMG can therefore bundle a standalone Pi executable rather than
Node and `node_modules`. The Rust server owns one or more `pi --mode rpc`
processes and translates their commands/events into Pico's HTTP/SSE contracts.

This keeps Pi as the compatibility authority while making the persistent Pico
server a native binary.

Pi's public RPC protocol covers session and agent behavior but does not expose
credential listing/mutation, OAuth callbacks, model-registry refresh, or
provider quota lookup. Pico keeps those SDK-only operations in
`native/pi-bridge.ts`, compiled by Bun into a separate native executable. The
bridge uses Pi's existing `AuthStorage` and `ModelRegistry`; it does not create a
second credential store. Rust communicates with it over bounded JSONL, forwards
OAuth/device-code UI over Pico's existing SSE contract, and owns its lifecycle.

## Development commands

```bash
cargo test --workspace
pnpm fetch:pi-standalone
cargo run -p pico-server -- pi-smoke --cwd .
pnpm build:pi-bridge
cargo run -p pico-server -- serve --port 3142 \
  --pi-bridge-bin target/pico-pi-bridge \
  --web-dir .output/public
cargo run -p pico-server -- serve --port 4142 \
  --data-dir "$HOME/Library/Application Support/Pico Development" \
  --session-dir "$HOME/Library/Application Support/Pico Development/sessions" \
  --pi-bridge-bin target/pico-pi-bridge
cargo run -p pico-server -- status
cargo run -p pico-server -- network status
cargo run -p pico-server -- network set 100.64.0.10
cargo run -p pico-server -- network disable
cargo run -p pico-server -- stop --wait
```

`--session-dir` (or `PI_CODING_AGENT_SESSION_DIR`) separates Pi JSONL session
ownership from `PI_CODING_AGENT_DIR`. This lets an isolated development server
reuse the canonical Pi configuration and `AuthStorage` without seeing or
spawning the stable server's sessions. `pnpm dogfood:server` wraps this in an
on-demand, drain-safe macOS `launchd` lifecycle.

Implemented:

- native Axum HTTP process
- production macOS/XDG data paths and owner-only files
- owner-only local control socket with status and graceful stop commands
- stale-instance and duplicate-server protection
- graceful SIGINT/SIGTERM/control-socket shutdown
- server state/process-runtime separation
- adjacent bundled-Pi discovery, version reporting, and checksum-verified downloads
- strict LF-delimited typed Pi RPC transport
- correlated bounded concurrent RPC commands without unsafe global timeouts
- Pi event broadcast and unexpected-exit reporting
- persisted Pi session paths and process restoration after server restart
- Pi JSONL indexing with active-branch traversal and render-ready conversation items
- directory session indexes, deterministic revisions, viewer selection, and unread overlays
- `/events` bootstrap snapshots, patch-friendly item updates, bounded replay IDs,
  reconnect resynchronization, keepalive, and translated Pi status/error events
- native prompt, image, steer/follow-up queue, abort, model, thinking, compaction,
  history, session mutation, tree, fork, clone, and heuristic naming routes
- server-owned reorderable pending prompts drained at Pi turn/settled boundaries
- model/thinking/context-usage projection from typed Pi RPC state
- deterministic fake-Pi end-to-end route coverage
- safe native directory discovery, path and `@file` completions, project file
  trees/reads, cleanup, and Pi command/skill projection
- traversal, symlink-escape, binary, large-file, and Unicode path tests
- native Git status/files/branches/history/diff/review/remote URL queries with
  short-lived caches, disposable-repository mutation tests, AI/heuristic commit
  messages, safe argument validation, and polling `git_changed` events
- stage/discard/checkout/commit/push/force-with-lease/pull and commit actions
- server-owned native PTYs with scoped reuse, cleaned shell environments,
  dimensions, bounded replay, monotonic output/input sequencing, SSE and browser
  WebSocket transports, reconnect reset signaling, and exit cleanup
- terminal create/input/resize/events/WebSocket/close route parity without
  Node addons
- native Tree-sitter highlighting through Inkjet with Shiki-compatible Pico CSS
  variables, constrained line/span HTML, language aliases, Markdown/ANSI
  handling, strict input bounds, blocking-worker isolation, and a bounded LRU
  response cache
- shared browser/Rust/Swift highlight fixtures that reject arbitrary HTML while
  preserving highlighted text and token colors
- standalone Bun-compiled Pi bridge for provider lists, API-key mutation,
  logout, OAuth/device-code flows, model refresh, and Anthropic/Codex usage
- bounded correlated bridge JSONL, server-owned bridge lifecycle, and existing
  `~/.pi/agent/auth.json` compatibility without parallel credential storage
- extension UI request routing over scoped SSE with timeout, cancellation,
  select/input/confirm/auth responses, and fire-and-forget notifications
- direct public Pi RPC extension UI response forwarding for session extensions
- TanStack Router/Vite SPA builds with a validated `/_shell.html` and no
  production Node server output
- bounded in-memory static asset loading from an adjacent `web` directory or
  `PICO_WEB_DIR`, immutable caching for hashed assets, ETags/HEAD, and safe MIME
  handling
- SPA navigation fallback that never rewrites `/api/*`, `/events`, terminal
  transports, or missing file-like asset paths
- headless browser validation against Rust with Node absent from `PATH`
- universal arm64/x86_64 macOS packaging with the Rust server, standalone Pi,
  Pi bridge, static web assets, and an app-bundled `SMAppService` LaunchAgent
- an independent SwiftUI `MenuBarExtra` login item named Pico Server with
  server health, exact-address remote listener settings, open/new chat, restart,
  logs, Login Items settings, and complete-quit controls
- nested-code Hardened Runtime signing, Developer ID notarization/stapling, and
  drag-to-Applications DMG automation in `pnpm package:macos`
- checksum-verified macOS/Linux native CLI bundles selected by `pico-app`, plus
  generated Homebrew formula/service and signed-app cask metadata
- versioned control/API compatibility checks and update draining that rejects
  new prompts while allowing active Pi runs and queued follow-ups to settle
- experimental low-level process creation, command, event, and deletion routes
- manifest and health endpoints
- loopback defaults, exact-address optional remote listeners, valid hostname
  authorities, same-origin/explicit Origin validation, and request size bounds
- private persistent network configuration with CLI and Pico Server menu-bar
  controls
- daily structured logs and atomically persisted lifecycle state

Process-control routes remain under `/api/rust/*`. The npm `pico-app` launcher
selects this server, downloads an architecture-matched checksum-verified bundle
when necessary, and attaches to a compatible persistent instance instead of
starting a duplicate.

## Runtime boundaries

- Pico's unauthenticated API defaults to loopback. An optional second listener
  must use one explicit private or VPN interface address; wildcard and loopback
  remote settings are rejected. Do not expose it to an untrusted network or the
  public internet without a future authentication layer.
- Pi session files remain Pi's compatibility format and source of durable
  conversation history.
- Runtime process handles are never serialized as if they could survive a
  reboot. Restored sessions are reattached to newly launched Pi RPC children.
- Restarting a Pi RPC child cannot preserve in-flight work. Update draining
  rejects new prompts and waits for active Pi work before server replacement.
- The native highlighter emits only escaped text plus `span.line` and safe
  `color:var(--sh-*)` token spans; it never accepts grammar-provided HTML.
