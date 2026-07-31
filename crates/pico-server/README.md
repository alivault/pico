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
cargo run -p pico-server -- pi-smoke --cwd .
cargo run -p pico-server -- serve --port 3142
```

Implemented:

- native Axum HTTP process
- graceful SIGINT/SIGTERM shutdown
- server state/process-runtime separation
- Pi executable discovery and version reporting
- strict LF-delimited Pi RPC transport
- correlated concurrent RPC commands
- Pi event broadcast
- experimental session creation, command, event, and deletion routes
- manifest and health endpoints

The experimental routes are under `/api/rust/*`. The manifest deliberately does
not claim full conversation/session compatibility yet.

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
