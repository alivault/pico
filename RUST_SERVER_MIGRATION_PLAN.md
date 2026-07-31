# Native Pico server migration checklist

Goal: ship Pico as a persistent native macOS server and client bundle with no
Node.js runtime requirement. Development may continue to use Node to build the
React SPA and a Pi bridge, but the installed app must run only native executables:

- `pico-server` (Rust)
- the official or Pico-patched standalone Pi executable (Bun-compiled Mach-O)
- `Pico.app` and its menu-bar/login-item helpers (Swift)

The existing browser and Apple HTTP/SSE contracts are compatibility boundaries.
A phase is complete only when its tests pass and the phase is committed.

## 0. Native foundation

- [x] Add a pinned Rust workspace and `pico-server` crate.
- [x] Separate serializable server facts from process runtime handles.
- [x] Implement strict LF-delimited Pi RPC request/event transport.
- [x] Prove the bridge against the official standalone arm64 Pi binary.
- [x] Add native HTTP health/manifest and experimental process routes.
- [x] Validate in the existing Zellij `pico` session.

## 1. Compatibility fixtures and protocol types

- [x] Inventory every HTTP route, SSE event, payload, and error status.
- [x] Add checked-in JSON fixtures for the client manifest, initial state sync,
      patch state sync, sessions, conversation items, Pi RPC events, Git, files,
      terminal events, auth, and extension UI requests.
- [x] Add Rust serde protocol models that decode and re-encode those fixtures.
- [x] Add a JavaScript contract check so both implementations share the same
      compatibility corpus.
- [x] Add explicit Rust server/API/persistence protocol version constants.

## 2. Native server lifecycle, configuration, and security

- [x] Replace preview CLI defaults with production configuration and data paths.
- [x] Enforce one server instance with an owner-only local control socket/lock.
- [x] Detect stale ownership records and live port conflicts safely.
- [x] Bind loopback by default; require explicit configuration for LAN binding.
- [x] Validate Host/Origin for browser requests and bound request body sizes.
- [x] Add structured rotating logs and a machine-readable status snapshot.
- [x] Implement graceful drain/shutdown/restart state and signal handling.
- [x] Persist versioned server facts atomically with migration tests.

## 3. Production Pi process runtime

- [x] Replace arbitrary experimental commands with typed Pi RPC commands/events.
- [x] Bundle/discover architecture-matched standalone Pi binaries with checksums.
- [x] Manage one Pi child per active/draft session with bounded queues.
- [x] Correlate commands without imposing short timeouts on long operations.
- [x] Translate process exit into session status and reconnect-safe errors.
- [x] Resume saved Pi session paths after Pico server restart.
- [x] Preserve Pi cwd, session directory, environment, extensions, skills,
      prompts, settings, and provider credential paths.
- [x] Implement full child cleanup and no-orphan process tests.

## 4. Session index, viewer contexts, and SSE

- [x] Port Pi JSONL session header/entry parsing and append-only tree traversal.
- [x] Port directory session listing, merging, sorting, previews, revisions, and
      unread overlays.
- [x] Port Pico viewer contexts, active/draft entries, request resolution, and
      base-cwd semantics.
- [x] Port render-ready conversation item construction and stable item keys.
- [x] Port initial `state_sync`, patch-friendly follow-up sync, and `itemsPatch`.
- [x] Implement bounded SSE replay IDs, keepalive, reconnect snapshots, and event
      gap recovery.
- [x] Port sessions/status/done/user/error/extension/Git event envelopes.
- [x] Pass browser and Swift full/patch state fixtures unchanged.

## 5. Prompt and session mutation parity

- [x] Port new/select/delete/bulk-delete/move/rename/read-state session routes.
- [x] Port prompt submission, optimistic acceptance, images, steer/follow-up,
      queue reorder/remove/start, abort, and settled completion.
- [x] Port model and thinking selection with available-level projection.
- [x] Port compaction slash command and working/hidden-thinking state.
- [x] Port history pagination.
- [x] Port tree read/navigation/labels, fork, and clone through Pi RPC.
- [x] Port automatic naming with heuristic fallback and error events.
- [x] Add end-to-end tests using a deterministic fake Pi RPC child.

## 6. Resource discovery, project files, and completions

- [x] Port safe project path resolution with symlink escape protection.
- [x] Port directory resolve/search and directory-session cleanup routes.
- [x] Port path and `@file` completions with ordering and result limits.
- [x] Port project file tree/read endpoints and binary/size rejection.
- [x] Surface Pi RPC `get_commands` as slash commands/skills/templates.
- [x] Add adversarial traversal, symlink, Unicode, and large-tree tests.

## 7. Native Git runtime

- [ ] Port repository discovery and all short-lived cache keys/expiry policy.
- [ ] Port status, changes, branches, history graph inputs, unpushed commits,
      working diffs, reviews, commit files/diffs, and remote URLs.
- [ ] Port stage, discard, checkout, commit, push, force-push-with-lease, and pull.
- [ ] Port heuristic and AI commit-message generation.
- [ ] Port Git filesystem watching and debounced scoped `git_changed` events.
- [ ] Run mutation tests only against disposable repositories.

## 8. Native PTY terminal runtime

- [ ] Replace `node-pty` with a Rust PTY runtime (`portable-pty` or equivalent).
- [ ] Preserve shell environment cleanup, cwd, dimensions, backlog limits,
      monotonic output/input sequence IDs, and replay-gap reset behavior.
- [ ] Port create/input/resize/events/close endpoints.
- [ ] Ensure terminals remain server-owned when all UI clients disconnect.
- [ ] Add process-exit, backpressure, UTF-8 boundary, and reconnect tests.

## 9. Syntax highlighting

- [ ] Choose and document a native highlighting implementation that preserves
      Pico's constrained span/CSS-variable response contract.
- [ ] Port language normalization, support detection, and cache behavior.
- [ ] Pass browser and Swift constrained-highlight fixtures.
- [ ] Remove Shiki from the runtime bundle after visual parity is approved.

## 10. Provider auth, usage, extension UI, and Pi SDK gaps

- [ ] Map all current Pi SDK-only operations missing from public Pi RPC.
- [ ] Prefer upstream Pi RPC additions; otherwise build a minimal Pico Pi bridge
      as a standalone native Bun executable rather than bundling Node.
- [ ] Port provider lists, API-key storage, logout, OAuth/device-code flows, and
      model refresh without parallel credential storage.
- [ ] Port extension UI request/response timeouts and fire-and-forget methods.
- [ ] Port provider usage lookups and context-limit projection.
- [ ] Verify auth/settings/session compatibility against existing `~/.pi` data.

## 11. Static browser application

- [ ] Enable TanStack Start SPA mode and generate `/_shell.html` plus assets.
- [ ] Ensure no browser route loader or root component requires runtime SSR.
- [ ] Make Rust serve immutable assets and rewrite non-API 404s to the shell.
- [ ] Keep `/api/*`, `/events`, and terminal SSE routes outside SPA rewriting.
- [ ] Embed release assets in or beside the Rust binary with cache headers.
- [ ] Prove the production browser app works with Node absent from `PATH`.

## 12. macOS service and menu-bar distribution

- [ ] Add a separately signed server launcher/helper to `Pico.app`.
- [ ] Add an app-bundled LaunchAgent plist using `BundleProgram`.
- [ ] Register/control it with `SMAppService` and handle approval states.
- [ ] Add an independent `MenuBarExtra` login-item app that observes the server.
- [ ] Add Open, New Chat, Restart, Logs, Start at Login, and Quit Completely.
- [ ] Make normal `Pico.app` quit leave the menu item and server running.
- [ ] Bundle arm64/x64 Rust and standalone Pi executables.
- [ ] Sign nested code in order, enable Hardened Runtime, notarize, staple, and
      produce drag-to-Applications DMGs.

## 13. Launcher, packaging, and update behavior

- [ ] Make `pico-app` select the native server binary instead of Nitro.
- [ ] Add npm platform packages or downloaded release binaries for CLI users.
- [ ] Add Homebrew formula/headless service and a cask for `Pico.app`.
- [ ] Add server/client protocol compatibility checks before updates.
- [ ] Drain active work before server replacement and reconnect clients after.
- [ ] Ensure updates never silently terminate an active Pi run.

## 14. Cutover and removal

- [ ] Run browser smoke coverage for every route group.
- [ ] Run macOS and iOS native contract and workflow tests.
- [ ] Verify persistence across UI quit, client reconnect, server crash, logout,
      reboot, update, disabled background item, and port conflict.
- [ ] Remove Nitro, Node server routes, Pi SDK server adapter, `node-pty`, and
      runtime Node engine requirements.
- [ ] Keep Node only in development dependencies needed to build the SPA/bridge.
- [ ] Update README, AGENTS, release workflows, and architecture documentation.
- [ ] Verify the shipped app with Node/npm/pnpm unavailable.
- [ ] Delete this temporary checklist and commit the completed migration.
