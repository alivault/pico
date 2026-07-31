# Pico native server migration

This crate is the first executable slice of Pico's Node-to-Rust server
migration. It is intentionally a preview and does not yet implement the full
Pico HTTP/SSE contract.

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
standalone Bun-compiled macOS binaries:

- `pi-darwin-arm64.tar.gz`
- `pi-darwin-x64.tar.gz`

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

## Current preview

```bash
cargo test --workspace
pnpm fetch:pi-standalone
cargo run -p pico-server -- pi-smoke --cwd .
pnpm build:pi-bridge
cargo run -p pico-server -- serve --port 3142 \
  --pi-bridge-bin target/pico-pi-bridge \
  --web-dir .output/public
cargo run -p pico-server -- status
cargo run -p pico-server -- stop
```

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
  `node-pty`
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
- TanStack Start SPA-mode builds with a validated `/_shell.html` and no browser
  route loader/root dependency on the Node server runtime
- bounded in-memory static asset loading from an adjacent `web` directory or
  `PICO_WEB_DIR`, immutable caching for hashed assets, ETags/HEAD, and safe MIME
  handling
- SPA navigation fallback that never rewrites `/api/*`, `/events`, terminal
  transports, or missing file-like asset paths
- headless browser validation against Rust with Node absent from `PATH`
- experimental low-level process creation, command, event, and deletion routes
- manifest and health endpoints
- loopback defaults, Host/Origin validation, and request size bounds
- daily structured logs and atomically persisted lifecycle state

Process-control routes remain under `/api/rust/*`. The native server now exposes
session indexes, the primary `/events` stream, core prompt/session mutations,
provider auth/usage/extension UI parity, and the production browser SPA. It is
still opt-in and is not selected by `pico-app` until packaging and final parity
work is complete.

## Migration order

1. Characterize the existing TypeScript API/SSE contract with shared fixtures.
2. Port session indexing and read-only project/Git endpoints.
3. Translate Pi RPC events into Pico `state_sync` and conversation item patches.
4. Port prompt, queue, abort, model, thinking, compaction, and tree flows.
5. Replace `node-pty` with a Rust PTY runtime.
6. Port native highlighting, provider authentication, and extension UI request
   bridging. The native highlighter uses Inkjet's vendored Tree-sitter grammars;
   its renderer emits only escaped text plus `span.line` and safe
   `color:var(--sh-*)` token spans, never arbitrary grammar-provided HTML.
7. Build the browser client as static assets served by Rust.
8. Bundle the Rust server and architecture-matched standalone Pi binary in the
   signed macOS app.
9. Register the binary as a per-user `SMAppService` LaunchAgent and add the
   separate menu-bar client.
10. Remove the Nitro runtime only after browser, native Apple, and contract
    fixture parity passes.

## Non-goals of the preview

- It is not selected by `pico-app`.
- It does not replace the current production server.
- It does not expose Pico's unauthenticated API beyond the existing loopback
  development assumptions.
- It does not claim that restarting a Pi RPC child preserves in-flight work.
