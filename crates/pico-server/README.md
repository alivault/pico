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

## Current preview

```bash
cargo test --workspace
pnpm fetch:pi-standalone
cargo run -p pico-server -- pi-smoke --cwd .
cargo run -p pico-server -- serve --port 3142
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
- experimental low-level process creation, command, event, and deletion routes
- manifest and health endpoints
- loopback defaults, Host/Origin validation, and request size bounds
- daily structured logs and atomically persisted lifecycle state

Process-control routes remain under `/api/rust/*`. The native server now exposes
session indexes, the primary `/events` stream, and core prompt/session mutations,
but it does not claim auth, terminal, highlighting, or static-app parity yet.

## Migration order

1. Characterize the existing TypeScript API/SSE contract with shared fixtures.
2. Port session indexing and read-only project/Git endpoints.
3. Translate Pi RPC events into Pico `state_sync` and conversation item patches.
4. Port prompt, queue, abort, model, thinking, compaction, and tree flows.
5. Port provider authentication and extension UI request bridging.
6. Replace `node-pty` with a Rust PTY runtime.
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
