# Pico v2 rewrite — implementation brief

You are rewriting Pico from scratch as a self-contained, standalone coding-agent
product. Read this whole brief before writing code. When this brief and the
existing code disagree, this brief wins. When this brief is silent, prefer the
simplest design that meets the stated goals and record the decision in
`docs/v2/decisions.md`.

## 1. Product goal

Open the app and start working. No Node, no Pi, no npm, no terminal setup.

- One **host** runs the agent. A host is either the Mac app (which embeds and
  manages the engine) or a headless Linux machine running the engine as a
  service.
- **Clients** connect to one or more hosts and stay in real-time sync. Every
  client sees the same sessions, streaming output, queues, and state within
  milliseconds, and can drive any session.
- v1 clients: **macOS** and **iOS/iPadOS** (SwiftUI). A Linux desktop client
  (Quickshell/QML) comes later; design for it now but do not build it.
- v1 has **feature parity with Pi 1.0 (the coding-agent CLI), minus its
  extension system**, plus everything the current Pico apps do.

### Non-goals

- No browser client, web UI, HTTP/SSE API, npm package, or static web assets.
- No compatibility with Pi's session files, RPC protocol, settings files, or
  `auth.json`. No migration from current Pico data. (An optional one-time
  importer for Pi JSONL sessions may be added after v1.)
- No Pi extension API (TypeScript extensions, extension UI, extension-registered
  tools/commands/providers/virtual models, Pi packages, TUI themes).
- No terminal UI. The apps are the UI.
- No Windows host support in v1.

## 2. Architecture

```
                 ┌────────────── host (macOS or Linux) ──────────────┐
                 │ pico-engine (Rust, single binary)                 │
                 │  agent · tools · providers · auth · store · sync  │
                 │  workspace (git, files, terminals, highlighting)  │
                 │  net: iroh (QUIC, NAT traversal, relay) + mDNS    │
                 └──────────────▲──────────────────────▲─────────────┘
                   Unix socket  │                iroh  │ (E2E encrypted)
       ┌────────────────────────┴───┐      ┌───────────┴─────────────────┐
       │ Pico for Mac (SwiftUI)     │      │ Pico for iPhone/iPad        │
       │  + PicoClient (Rust/UniFFI)│      │  + PicoClient (Rust/UniFFI) │
       │  hosts a local engine      │      │  client only                │
       └────────────────────────────┘      └─────────────────────────────┘
```

Principles:

1. **The host is authoritative.** Each session belongs to exactly one host. Only
   the host writes its data. Clients send commands and receive an ordered event
   stream. There is no multi-writer merge and no CRDT.
2. **One protocol and sync implementation, in Rust.** `pico-protocol` defines
   every message. `pico-client` implements connection, resume, state
   application, optimistic commands, and caching once, and is exposed to Swift
   through UniFFI. Swift renders state and sends intents. It does not
   reimplement sync or merge logic.
3. **The engine survives clients.** Closing apps, client crashes, and network
   drops never stop agent work. Updates and shutdown drain active work first.
4. **Bounded everything.** Every queue, buffer, message, blob, and replay window
   has an explicit limit.
5. **Performance is a feature.** See section 10 for budgets.

### Repository layout

Work on a long-lived `v2` branch. The new tree replaces the old one; delete old
code (`src/`, `crates/pico-server`, `native/`, `bin/`, web build tooling,
`apps/apple/PicoMenu` remnants) once the corresponding v2 parts exist.

```
Cargo.toml                      workspace
crates/
  pico-protocol/                wire types, IDs, versioning, limits
  pico-engine/                  host binary + library
  pico-client/                  client core (UniFFI for Swift; later JSON bridge)
  pico-testkit/                 fake providers, scripted sessions, fixtures
apps/apple/
  Pico.xcodeproj                macOS + iOS targets
  Pico/                         SwiftUI app
  PicoClientFFI/                generated Swift bindings + xcframework (built by script)
scripts/
  build-client-xcframework.sh
  package-macos.mjs (or .sh)    universal app with bundled engine, signed/notarized
  package-linux.sh              static musl engine builds + install script
docs/v2/                        architecture, protocol, decisions, parity tracker
```

Existing Rust code worth porting (adapt, don't copy blindly):
`crates/pico-server/src/{git_native.rs, project_files.rs, terminal.rs,
highlight.rs, control.rs, active_work.rs, persistence.rs}` and the macOS
launch/lifecycle code in `apps/apple/Pico/Pico/App/PicoServer*.swift`,
`PicoMacAppDelegate.swift`, `PicoMenuBarView.swift`.

Existing SwiftUI worth keeping: most views under `apps/apple/Pico/Pico/Features`
(conversation rendering, composer, sessions sidebar, Git workspace, settings).
Replace `AppModel`'s networking/sync/merge logic with `PicoClient`.

## 3. pico-engine

Rust, Tokio. One binary with subcommands:

```
pico-engine serve            run the host (foreground; used by launchd/systemd/app)
pico-engine status|stop      control socket; stop drains active work (--wait, --force)
pico-engine pair             show a pairing QR code + one-time code in the terminal
pico-engine devices          list/revoke paired devices
pico-engine install --user   install a systemd user service (Linux) / LaunchAgent opt-in (macOS)
pico-engine auth ...         login/logout/status for providers from a terminal (headless hosts)
```

### 3.1 Actor layout

- **Session actors**: one task per loaded session owns its agent loop, queues,
  and in-memory streaming state. Idle sessions are unloaded; loading is lazy.
- **Store writer**: a single task owns the SQLite write connection. Everyone
  else sends write requests and reads from a reader pool.
- **Sync hub**: assigns global event sequence numbers, fans events out to
  subscribers, and tracks per-subscriber backpressure (drop to snapshot if a
  client falls behind).
- **Workspace services**: Git, files, terminals, search, highlighting, file
  watching.
- **Net**: iroh endpoint, mDNS advertiser, Unix socket listener, pairing.
- **Lifecycle**: control socket, draining, version handoff.

### 3.2 Storage (SQLite, WAL)

Single database per host at the platform data dir
(`~/Library/Application Support/Pico/` on macOS, `$XDG_DATA_HOME/pico/` on
Linux), private permissions.

Sketch (refine as needed, keep it normalized and indexed):

```sql
sessions(id TEXT PK, workspace_id, title, title_source, created_at, updated_at,
         leaf_entry_id, model_provider, model_id, thinking_level,
         archived, pinned, unread, parent_session_id, stats_json)
workspaces(id TEXT PK, path UNIQUE, display_name, sort_order, trust)
entries(id TEXT PK, session_id, parent_id, seq, kind, role, created_at,
        payload BLOB /* zstd(json) */, search_text)
  INDEX(session_id, seq), INDEX(parent_id)
blobs(hash TEXT PK, mime, byte_len, data BLOB)   -- content-addressed, deduped
events(seq INTEGER PK, session_id, kind, payload BLOB, created_at)  -- sync log
devices(id TEXT PK, name, public_key, paired_at, last_seen, revoked)
credentials(provider TEXT PK, kind, encrypted_payload, updated_at)
settings(scope, key, value_json)                 -- global + per-workspace
entries_fts USING fts5(search_text, content='entries')
```

Rules:

- Images and large tool outputs live in `blobs` as raw bytes (never base64 in
  the database). Entries reference blobs by hash. Clients fetch blobs on demand.
- Token streaming is never written per token. Persist completed assistant
  messages, tool calls, and tool results; checkpoint partial streams at most
  once per second for crash recovery.
- The `events` table is the sync log. Retain a bounded window (by count and
  age); older history is served from `entries` via snapshots and pagination.
- Credentials are encrypted at rest: key in macOS Keychain on Mac hosts, a
  `0600` key file on Linux (optionally the Secret Service when available).
- Use migrations from day one (`refinery` or a minimal in-house migrator).

### 3.3 Agent runtime (Pi 1.0 parity)

Study Pi 1.0 before implementing each area. The installed docs are at
`~/.vite-plus/packages/@earendil-works/pi-coding-agent/*/lib/node_modules/@earendil-works/pi-coding-agent/docs/`
and the source is https://github.com/earendil-works/pi (MIT). Match observable
behavior; do not port its extension machinery. `openai/codex` (`codex-rs`) and
`block/goose` (both Apache-2.0, Rust) are useful references for providers,
tools, and sandbox patterns.

**Agent loop**

- A user message is appended to the active branch. A request is built from the
  system prompt, active-branch context, tool declarations, and model settings.
- Streamed assistant output contains text, thinking, and tool calls. Execute
  tool calls, append results, and continue while tool results or queued
  messages require another turn.
- **Steering** messages are delivered after the current assistant turn and its
  tool calls; **follow-up** messages after the run settles. Modes `all` and
  `one-at-a-time` (default) for each. Queues are visible, editable, reorderable,
  and removable from any client. Abort stops the run and returns queued
  messages to the composer.
- Retry transient failures with exponential backoff (defaults: 3 retries,
  2000 ms base, 60 s cap; settings `retry.*`). Never classify rate limits as
  context overflow.
- Context-overflow errors and early `length` stops trigger one
  compact-and-retry recovery attempt.
- Stop reasons: `stop`, `length`, `toolUse`, `error`, `aborted`.

**System prompt** (match Pi's structure)

- Sections: `preamble`, `tools` (one-line snippet per enabled tool), `rules`
  (deduplicated tool guidelines plus "Be concise in your responses" and "Show
  file paths clearly when working with files"), `addendum` (append prompt),
  `project_context` (context files wrapped in
  `<project_instructions path="…">`), `skills`, `cwd`. Each non-preamble
  section is wrapped in `<name>…</name>`.
- `SYSTEM.md` replaces the default prompt; `APPEND_SYSTEM.md` appends. Both
  exist at user level (Pico config dir) and project level (`.pico/` in the
  workspace, trust-gated); project wins over user, files are not combined.
- Persist prompt and tool-set changes as system entries that patch named
  sections and add/remove tools, so context replays deterministically and
  provider prompt caches stay valid.

**Context files**

- Load from the user config dir, the workspace, and its ancestors:
  `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`.
  `AGENTS.override.md` replaces the others only in its own directory. Context
  files do not require project trust. Allow disabling per workspace.

**Tools** (built-in; defaults `read`, `bash`, `edit`, `write`; optional `grep`,
`find`, `ls`; per-workspace and global `defaultTools` with `+name`/`-name`)

- `read(path, offset?, limit?)`: text and images (jpg, png, gif, webp, bmp).
  Truncate to 2000 lines or 50 KB, whichever first; tell the model how to
  continue with offset. Images become image content (resized per section 3.6).
- `bash(command, timeout?)`: run in the workspace with the configured shell
  (`shellPath`, `shellCommandPrefix`). Combined stdout/stderr truncated to the
  last 2000 lines or 50 KB; full output saved to a blob/temp file whose path is
  returned. Expose `PICO_SESSION_ID`, `PICO_PROVIDER`, `PICO_MODEL`,
  `PICO_REASONING_LEVEL` to commands. Abort kills the whole process group.
  Stream partial output to clients live.
- `edit(path, edits[{oldText,newText}])`: multiple disjoint exact replacements
  matched against the original file; each `oldText` must be unique and
  non-overlapping; atomic write; return a unified diff for the UI.
- `write(path, content)`: create or overwrite; create parent dirs; atomic.
- `grep`, `find`, `ls`: respect `.gitignore` (use the `ignore` and `grep-*`
  crates from ripgrep); grep lines capped at 500 chars; outputs bounded.
- Serialize mutations per file (Pi's file-mutation queue) so concurrent tool
  calls cannot interleave writes.
- Tool results include structured `details` for rich UI rendering (diffs,
  exit codes, truncation info) that are not sent to the model.

**User shell commands**: `!cmd` runs a command and adds its output to the
conversation as a bash-execution entry; `!!cmd` runs it without sending output
to the model.

**Input features**: `@file` references (fuzzy file search in the workspace,
inserted as content), path completion, pasted/attached images (up to 8 per
message), prompt templates and skills as slash commands, external-editor
equivalent is not needed (the apps have a real editor).

**Thinking levels**: `off`, `minimal`, `low`, `medium` (default), `high`,
`xhigh`, `max`, clamped to what the selected model supports. Per-model default
levels, configurable thinking budgets for `minimal`–`high`, cycle and set from
any client. Thinking blocks can be hidden per client.

**Skills** (Agent Skills spec, https://agentskills.io/specification)

- Discover directories containing `SKILL.md` recursively in the user skills
  dir, `~/.agents/skills/`, project `.pico/skills/` (trust-gated), and project
  `.agents/skills/` from the workspace up to the repository root.
- Frontmatter: `name` (lowercase, digits, hyphens, ≤64), `description` (≤1024,
  required), `license`, `compatibility`, `metadata`, `allowed-tools`,
  `disable-model-invocation`. Invalid fields warn; missing description skips.
  First discovered name wins on collision (warn).
- Advertise name, description, and path in the `skills` prompt section; the
  model reads full instructions on demand. `/skill:name args` forces loading
  and appends args as the user request.

**Prompt templates**: Markdown files in user and project (`.pico/prompts/`,
trust-gated) prompt dirs become `/name` commands. Frontmatter `description`,
`argument-hint`. Substitutions: `$1…`, `$@`, `$ARGUMENTS`, `${1:-default}`,
`${@:-default}`, `${@:N}`, `${@:N:L}` with shell-like quoting.

**Compaction** (match Pi's algorithm and format)

- Trigger when `contextTokens > contextWindow - reserveTokens` (defaults
  `reserveTokens` 16384, `keepRecentTokens` 20000; per-model overrides). Check
  before a new prompt and between turns after tool results.
- Find the cut point walking back until `keepRecentTokens`; never cut at tool
  results; handle split user-message spans with two summaries merged.
- Summarize with the structured format: Goal, Constraints & Preferences,
  Progress (Done / In Progress / Blocked), Key Decisions, Next Steps, Critical
  Context, plus cumulative `<read-files>` and `<modified-files>` lists.
  Serialize the conversation as `[User]:`, `[Assistant thinking]:`,
  `[Assistant]:`, `[Assistant tool calls]:`, `[Tool result]:` with tool results
  truncated to 2000 chars. Iterate on the previous summary.
- Persist a compaction entry with `firstKeptEntryId`, `tokensBefore`, usage,
  file lists, and a system-prompt checkpoint. Original entries remain.
- Manual `/compact [instructions]`. Auto-compaction can be disabled.

**Sessions and branching**

- Entries form a tree (`parent_id`); the leaf is the active branch. Context is
  rebuilt from the leaf, honoring the latest compaction and context edits.
- Tree navigation: move to any entry; selecting a user message puts its text in
  the composer for editing and resubmission; selecting another entry continues
  after it. Filters: default, no-tools, user-only, labeled-only, all.
- Branch summaries: when leaving a branch, optionally summarize the abandoned
  path (common-ancestor walk, token budget, structured format) and attach it
  to the target branch. Setting to skip the prompt.
- Fork (new session from an earlier user message), clone (copy the active
  branch to a new session), labels on entries, session names (`/name`), and
  automatic naming from the first exchange (Pico behavior).
- Context edits: omit or replace an earlier entry's contribution to future
  context without changing raw history.
- Session list: per workspace and global, searchable (FTS), sortable,
  renameable, deletable (move to trash where available), archivable, pinnable,
  read/unread.
- `/session` stats: entry/message counts, tokens (input, output, cache read,
  cache write), cost per physical model, context usage.
- Export a session as self-contained HTML and as JSONL. Copy last assistant
  response. (Pi's `/share` and `/bug` upload services are out of scope.)

**Models, providers, and auth** (see section 3.4)

**Project trust**: workspaces with `.pico/` settings, skills, prompts, or system
prompt files, or `.agents/skills`, require a trust decision before those load
(`ask` default, `always`, `never`; saved per directory, closest ancestor wins).
Trust prompts are shown on clients as server-driven UI requests.

**MCP** (Pi 1.0 ships this built in; include it)

- Servers from user and project (`.pico/mcp.json`, trust-gated) config, same
  `mcpServers` format as other clients: stdio (`command`, `args`, `env`, `cwd`)
  and streamable HTTP (`url`, `headers`, OAuth with dynamic client
  registration, PKCE, protected-resource and auth-server metadata discovery,
  token refresh). No legacy SSE transport.
- Env/header interpolation `${NAME}` and whole-value `!command`.
- Tools named `mcp__<server>__<tool>`; exposure `direct`, `deferred` (via a
  `tool_search` tool), or `hidden`, per server with per-tool overrides.
  Resource tools: `list_mcp_resources`, `list_mcp_resource_templates`,
  `read_mcp_resource`. Text results over 20 KB are middle-truncated with the
  full text saved to a blob.
- Manage servers from the apps (status, tools, reconnect, sign in/out, enable,
  exposure) and from `pico-engine mcp …`.
- Pi's `codemode` (QuickJS scripting over tools, classifier and image models)
  is a stretch goal after v1 parity; design the tool registry so it can be
  added (e.g. with `rquickjs`).

**Settings** (global and per-workspace; project overrides global; resource
lists combine). Implement at least: default provider/model/thinking level,
per-model thinking levels, thinking budgets, enabled-model scope for cycling,
hide thinking, steering/follow-up modes, tree filter default, double-action
for tree/fork, default project trust, default tools, compaction and branch
summary settings, retry settings, HTTP idle timeout, HTTP proxy, shell path and
prefix, image auto-resize and blocking, prompt-cache retention and cache
warming, resource paths for skills and prompts. Expose all of them in the apps'
Settings UI, not only in files.

### 3.4 Providers, models, and authentication

Implement provider adapters as a trait with streaming normalized to Pico's
message model (text, thinking with signatures, tool calls, usage, stop reason,
response IDs, abort):

1. **Anthropic Messages** (API key, OAuth for Claude Pro/Max, bearer token).
   Prompt caching, thinking budgets/adaptive thinking, signatures, image input.
2. **OpenAI Responses** (API key, OAuth for ChatGPT Plus/Pro "Codex"
   subscription), including WebSocket transport where Pi uses it, encrypted
   reasoning items, prompt cache keys.
3. **OpenAI Chat Completions–compatible** (OpenAI, OpenRouter, Groq, Cerebras,
   xAI, DeepSeek, Mistral, Together, Fireworks, Hugging Face, Vercel AI
   Gateway, Ollama, LM Studio, vLLM, SGLang, llama.cpp router, and other
   compatible endpoints) with per-endpoint compatibility flags.
4. **Google Generative AI** and **Vertex AI** (API key, ADC).
5. **GitHub Copilot** (device-flow OAuth, Copilot headers).
6. **Azure OpenAI**, **Amazon Bedrock Converse** (env/profile credentials),
   **Mistral** native, and the remaining Pi 1.0 providers as follow-ups,
   prioritized by usage. Track coverage in the parity tracker.

Subscription OAuth flows present in Pi 1.0: Anthropic (Claude Pro/Max), OpenAI
(ChatGPT Plus/Pro), GitHub Copilot, xAI (Grok/X subscription), Kimi Code,
Meta (Muse), MiniMax. Implement Anthropic, OpenAI, and Copilot for v1; the rest
as follow-ups. OAuth flows must work for headless Linux hosts: the client
device opens the browser and either the callback is relayed to the host or the
user pastes the redirect URL/code. Device-code flows show the code on clients.

Model catalog:

- Bundle a generated catalog (IDs, names, context window, max output, input
  modalities, reasoning/thinking support, pricing, prompt-cache lifetimes,
  image limits) and refresh it from a remote source at runtime with an offline
  cache. Decide the source (e.g. models.dev or a Pico-hosted JSON) and record it.
- User-defined providers/models (equivalent of Pi's `models.json`): base URL,
  API type, key with `$ENV`, `${ENV}`, or `!command` resolution, headers, model
  list, model overrides, image resize limits, prompt-cache lifetimes. Editable
  from the apps.
- Credential precedence: stored credential, user-config key, environment
  variables / ambient cloud credentials.
- Usage and cost accounting per message and per session, per physical model,
  including cache read/write tokens. Provider quota/usage display for
  subscriptions where the provider exposes it (current Pico feature).
- Prompt-cache warming (Pi `cacheWarming`: off/streaming/idle) when the model
  declares cache lifetimes and estimated savings exceed $0.05; record warm-up
  usage as usage entries.

### 3.5 Workspace services (current Pico features)

Port and extend from the current server:

- Git: status, changed files with line counts, diffs (working tree, staged,
  per commit), stage/unstage/discard, commit with AI-generated message,
  commit-and-push, push, force-push with lease, pull, branches (local/remote,
  checkout, create), history with graph rows and load-more, unpushed commits,
  remote URLs for commits, AI review of changes, diff line comments that attach
  to the composer. Debounced file watching that pushes `git_changed` events.
- Project files: tree, read, search, path and `@file` completions, Markdown
  preview, syntax highlighting (tree-sitter, constrained span output).
- Terminals: server-owned PTYs per workspace with bounded replay, resize,
  multiple attached clients.
- Notifications: session done/error events for clients (section 6).

### 3.6 Images

Resize new image attachments, `read` results, and tool-result images before
storing (defaults: max 2000×2000, ≤4.5 MiB encoded, JPEG quality 80; per-model
overrides). Store once as blobs; never re-encode history. Setting to block
images from being sent to models.

## 4. Sync protocol (`pico-protocol`)

Transport-agnostic, framed, versioned messages encoded with `postcard` (serde).
All IDs are typed. Every message type has a size limit.

Client → host:

- `Hello { protocol_version, device_id, client_kind, capabilities }`
- `Subscribe { scope: Host | Workspace(id) | Session(id), cursor: Option<u64> }`
- `Unsubscribe { scope }`
- `Command { command_id, kind }` for every mutation: prompt (text, images,
  attachments, skill/template invocation), steer, follow_up, abort,
  queue edit/reorder/remove, set model, set thinking, compact, navigate tree,
  fork, clone, label, rename, archive, delete, mark read, context edit,
  workspace add/remove/reorder/trust, git operations, file reads, terminal
  input/resize, settings changes, auth flows, MCP management, device management.
- `FetchBlob { hash, range? }`, `Query { query_id, kind }` for paginated reads
  (session history pages, search, git log, file tree).
- `UiResponse { request_id, value }` for server-driven prompts.

Host → client:

- `Welcome { host_id, host_name, protocol_version, capabilities }`
- `Snapshot { scope, state, cursor }` when the client has no cursor or is
  behind the retained window
- `Events { scope, from_seq, events }` ordered, gap-free per subscription
- `Delta { session_id, stream_id, ops }` ephemeral streaming updates (text and
  thinking appends, tool-call argument streaming, bash output chunks); never
  persisted, superseded by the final event
- `Ack { command_id, result }` and `QueryResult { query_id, page }`
- `UiRequest { request_id, kind }` (trust prompts, OAuth/device-code steps,
  confirmations), scoped and expiring
- `Presence { … }` optional: which devices are viewing/typing in a session
- Blob data frames

Semantics:

- Global monotonically increasing `seq` per host. Reconnect with the last seq;
  the host replays the gap or sends a snapshot. Clients must be able to resume
  in under 100 ms on a LAN.
- Commands are idempotent by `command_id`. Clients render optimistic state and
  reconcile on `Ack` and the resulting events.
- Drafts and composer state sync between devices per session as small
  last-writer-wins registers (so you can start typing on the Mac and finish on
  the phone).
- Version negotiation: incompatible clients get a clear upgrade message.

Write `docs/v2/protocol.md` as the normative spec and keep it in sync.

## 5. pico-client (Rust, UniFFI)

- Manages connections to multiple paired hosts: local Unix socket for the Mac
  app's own engine, iroh for everything else, mDNS discovery of nearby hosts.
- Owns pairing (scan QR / enter code), device keys (stored in the platform
  keychain via a Swift-provided callback), reconnection with backoff, cursors,
  snapshot/event application, optimistic commands, blob cache (on-disk LRU),
  and offline read-only cache of recent sessions.
- Exposes to Swift: host list, per-scope observable state (session list,
  session view model data, queues, git status, etc.) as change notifications
  with immutable snapshots or fine-grained diffs, and async command functions.
  Design the API so SwiftUI updates only what changed (stable IDs, per-item
  change notifications; no full-list re-renders while streaming).
- Also builds as a CLI `pico bridge` exposing the same API as newline-delimited
  JSON over stdio/Unix socket. Build this early: it is the test client and the
  future Quickshell integration point.
- Build script produces an xcframework for macOS (arm64, x86_64) and iOS
  (device, simulator).

## 6. Networking, pairing, security, notifications

- **Transport**: iroh endpoints (QUIC, hole punching, relay fallback). Default
  to iroh's public relays; support configuring a self-hosted relay. LAN
  discovery via mDNS (`mdns-sd`). The Mac app talks to its local engine over a
  Unix socket with owner-only permissions.
- **Identity**: each host and device has an Ed25519 key (iroh node ID). A host
  accepts only paired, non-revoked device keys.
- **Pairing**: host shows a QR code (host node ID, relay hints, one-time code,
  expiry) in the Mac app or `pico-engine pair`. The client scans or types the
  code, both sides confirm, the host stores the device key. Revocation from any
  paired admin device or the host.
- **Notifications**: session done/error/needs-input pushed to iOS even when the
  app is closed. Implement a tiny `pico-push` relay service (Rust) that holds
  the APNs key; hosts send it end-to-end encrypted payloads addressed by device
  token. Self-hostable; the Mac app can also post local notifications directly.
- No unauthenticated network listeners. No wildcard binds.

## 7. Apple apps

Swift 6.2, SwiftUI, Observation, Swift Testing. macOS 15+, iOS 26+. First-party
frameworks only besides the generated PicoClient framework.

**Mac app**

- First run: onboarding → sign in to a provider (OAuth or API key) → pick a
  folder → start working. Under a minute, no terminal.
- Embeds `pico-engine` in the bundle and runs it as a detached background
  process (current behavior): attach if running, otherwise launch; closing the
  window leaves the app in the menu bar without a Dock icon; Quit drains and
  stops the engine it launched; launch at login via `SMAppService.mainApp`.
- Menu bar: host status, active sessions, Open, New Chat, pairing (Add Device),
  network/relay status, Restart Engine, Show Logs, Launch at Login, Quit.
- Can connect to other hosts (e.g. a Linux box) alongside its own; sidebar
  groups sessions by host and workspace.
- Mail-style three-column layout (workspaces, sessions, conversation) with the
  right-side Files/Git/Terminal panel, command palette, keyboard shortcuts for
  everything Pi's keybindings cover (send, steer vs follow-up, abort, cycle
  model/thinking, toggle tool output/thinking, tree, fork, new, resume/search,
  copy last response).

**iOS/iPadOS app**

- Pair with a host by scanning its QR code, or pick a nearby host discovered on
  the LAN. Multiple hosts.
- Full session control: browse, search, create, prompt with images (camera,
  photos, files), steer/follow-up, abort, queue editing, model/thinking,
  tree/fork/clone, compaction, settings, provider auth, Git and files, MCP
  status, terminals (read and type).
- Background notifications via `pico-push`; deep links to sessions; New Chat
  quick action.

**Shared UI rules**

- Render streaming at 60 fps without frame drops on long sessions: virtualized
  lists, incremental Markdown rendering, code blocks highlighted only when
  complete, collapsed tool bodies don't decode payloads, images loaded lazily
  from the blob cache.
- Every icon-only control has an accessibility label; destructive actions
  confirm.

## 8. Feature parity tracker

Create `docs/v2/parity.md` as a checklist covering every item in sections 3–7
plus these Pi 1.0 commands and their app equivalents: `/settings`, `/model`,
`/thinking`, `/scoped-models`, `/login`, `/logout`, `/new`, `/resume`, `/name`,
`/session`, `/tree`, `/fork`, `/clone`, `/compact`, `/copy`, `/export`,
`/trust`, `/reload`, `/hotkeys`, `/mcp`, `/skill:name`, prompt-template
commands, `!`/`!!` shell commands, `@file`, image paste/attach, steering,
follow-up, queue restore on abort. Mark each item: done, partial, deferred
(with reason). v1 ships when every non-deferred item is done.

Explicitly out of scope: Pi extensions and extension UI, virtual models,
Pi packages, TUI themes/keybinding files, `/share`, `/bug`, `/changelog`,
`/import` of Pi sessions, print/JSON/RPC CLI modes, PowerShell tool,
Radius-specific features, classifier/image models via codemode (unless
codemode lands).

## 9. Milestones

Each milestone ends with tests passing, docs updated, and a commit.

1. **Skeleton and sync proof.** Workspace, `pico-protocol`, `pico-engine`
   with SQLite store/events/blobs and a fake scripted agent, `pico-client`
   with resume and state application, `pico bridge`. Two bridge clients stay in
   sync while the fake agent streams; kill/restart engine and clients; resume
   from cursor; snapshot fallback.
2. **Networking and pairing.** iroh + mDNS + Unix socket, QR/code pairing,
   revocation. Bridge on a Linux VM syncs with a Mac engine and vice versa.
3. **Apple client foundation.** xcframework build, SwiftUI app on macOS and
   iOS bound to `pico-client`, pairing UI, session list and conversation view
   mirroring the fake agent in real time on Mac + iPhone.
4. **Real agent (core).** Anthropic + OpenAI Responses + OpenAI-compatible
   providers with API keys, tools (`read`, `bash`, `edit`, `write`, `grep`,
   `find`, `ls`), system prompt, context files, steering/follow-up, abort,
   retries, usage/cost. Real sessions end to end on Mac and Linux hosts.
5. **Sessions depth.** Tree navigation, fork, clone, labels, naming, branch
   summaries, compaction (auto, manual, overflow recovery), context edits,
   search, export, stats.
6. **Auth and models.** Catalog + refresh, custom providers/models, OAuth for
   Anthropic, OpenAI, Copilot (including headless host flows), credential
   encryption, quota display, cache warming.
7. **Workspace parity.** Git, files, highlighting, terminals, diff comments,
   AI commit messages and review.
8. **Resources and MCP.** Skills, prompt templates, project trust, settings
   UI, MCP (stdio, HTTP, OAuth, exposure, resources, tool_search).
9. **Productization.** Mac app embedding/lifecycle/menu bar/onboarding,
   Linux packaging and systemd install, `pico-push`, iOS notifications,
   signing/notarization, update flow with draining, remaining providers and
   OAuth flows, performance pass against section 10, parity tracker complete.

## 10. Quality bar

Performance budgets (measure with benchmarks in CI where feasible):

- Engine cold start to accepting connections: < 150 ms. Idle RSS: < 40 MB.
  Per idle loaded session: < 2 MB.
- Open any session (including 100 MB+ histories) and render the latest page:
  < 50 ms on host, < 150 ms on a LAN client.
- Engine overhead added to provider time-to-first-token: < 5 ms.
- Event fan-out latency host → LAN client: < 30 ms p95; reconnect + resume:
  < 100 ms on LAN.
- Session search across 1,000 sessions: < 50 ms.
- Clients keep 60 fps while three sessions stream concurrently.

Testing:

- Unit tests for every module; property tests for tree/context building,
  compaction cut points, edit application, and event replay.
- Provider tests using recorded fixtures (text, thinking, tool calls, images,
  usage, abort, overflow, malformed streams, Unicode boundaries, cross-provider
  handoff). Live provider tests behind an env flag.
- Deterministic end-to-end tests with `pico-testkit` scripted providers driving
  the engine through `pico bridge`.
- Swift Testing for view models and client binding; UI smoke tests for
  onboarding, pairing, prompting, and tree navigation on macOS and iOS.
- Fuzz the protocol decoder.

Engineering rules:

- `cargo clippy -D warnings`, `cargo fmt`, no `unwrap()` in non-test code paths
  that handle external input, `tracing` for structured logs with redaction of
  secrets and prompt content by default.
- Never block the async runtime; filesystem and process work go through
  dedicated blocking pools.
- Keep dependencies deliberate; justify each new crate in `decisions.md`.
- Use the `trash` command, never `rm`, when deleting files in this repo or on
  the user's machine.
- Commit after each validated step with clear messages.

## 11. Open decisions (choose, record, proceed)

- Model catalog source and refresh endpoint.
- Default relay: iroh public relays vs. a Pico-hosted relay.
- `pico-push` hosting and APNs key ownership.
- Whether the Mac engine runs as a detached child (current) or an
  `SMAppService` LaunchAgent.
- Credential encryption on Linux: key file vs. Secret Service.

Start with milestone 1. Before coding, write `docs/v2/architecture.md`,
`docs/v2/protocol.md` (initial), `docs/v2/decisions.md`, and
`docs/v2/parity.md`, then implement.
