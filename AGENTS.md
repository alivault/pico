# AGENTS.md

This file is the repo-specific guide for coding agents working in Pico.

## What this repo is

Pico is a local, keyboard-friendly workspace for Pi coding-agent sessions. The repo now contains two first-party clients that share the same Pico server/runtime contracts:

- the browser app published as the public `@alivault/pico` package and runnable with `npx @alivault/pico`
- the native SwiftUI app in `apps/apple/Pico`; macOS bundles and manages the persistent Rust server, while iOS connects as a companion over HTTP JSON + SSE

The product provides a persistent session browser, live conversation shell, project-aware prompt helpers, provider authentication flows, git tooling, project file browsing, and settings around display, thinking/tools visibility, and completion notifications.

When behavior is ambiguous, prefer the behavior currently implemented in this repo and documented in `README.md`. For native iOS behavior, prefer the implementation under `apps/apple/Pico` over the historical plan in `apps/apple/SWIFTUI_CLIENT_PLAN.md` when they differ. Do not rely on private checkouts, machine-local paths, or git history as product references.

## Stack

### Browser/server stack

- Native Rust server in `crates/pico-server`
- Tokio + Axum for HTTP, SSE, WebSocket, lifecycle, and control sockets
- `portable-pty` for server-owned terminals and Inkjet for native highlighting
- Standalone Pi JSONL RPC executable for agent/session behavior
- Bun-compiled `native/pi-bridge.ts` executable for Pi SDK-only authentication and provider usage
- TanStack Router (client-only Vite SPA)
- TanStack Query
- TanStack Store / React Store
- TanStack Hotkeys
- TanStack Pacer
- React 19
- React Compiler enabled via `reactCompilerPreset()` in `vite.config.ts`
- TypeScript (strict mode)
- Vite+ static builds; there is no production Node/Nitro server
- Tailwind CSS v4
- Base UI / shadcn-style component patterns
- next-themes for persisted theme class management
- Shiki-compatible code/theme variables rendered from constrained Rust highlight output
- @pierre/diffs / @pierre/trees plus @dnd-kit for git diffs and project file trees

### Native Apple stack

- Native SwiftUI app under `apps/apple/Pico`, built from one multiplatform `Pico` target
- Swift 6.2, iOS 26 and macOS 15 deployment targets
- Observation (`@Observable`, `@Bindable`) with `@MainActor` app state
- Swift Concurrency (`async`/`await`, `Task`, actor-backed API/SSE clients)
- First-party Apple frameworks only by default: SwiftUI, Foundation, PhotosUI, UserNotifications, UniformTypeIdentifiers, Security/Keychain when pairing is implemented, and limited UIKit bridges for app delegate, keyboard, pasteboard, camera, and system colors
- Swift Testing for unit tests
- Limited AppKit adapters for macOS pasteboard, URL opening, colors/images, and the native code text view
- No React Native, Expo, WebView shell, or new third-party Swift packages unless explicitly approved

## Pi runtime dependencies

The production server does not load the Pi SDK or Node. It owns an architecture-matched standalone `pi --mode rpc` process. Provider credential listing/mutation, OAuth/device-code flows, model registry refresh, and provider quota lookup run in the separate compiled `pico-pi-bridge` executable. Both are bundled in native releases.

The repo-local `@earendil-works/pi-coding-agent` package is a development-only dependency used to compile `native/pi-bridge.ts` and to determine the matching standalone Pi release. Use `pnpm update:pi` to update that pinned build dependency, then rebuild and validate both native artifacts. Provider credentials remain in Pi's `AuthStorage`; never add a second credential store.

## Quick commands

Run these from the repo root for the browser/server app:

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
pnpm lint
pnpm format
pnpm check
pnpm check:fix
```

Run native Apple checks from the repo root with Xcode installed:

```bash
xcodebuild -list -project apps/apple/Pico/Pico.xcodeproj
xcodebuild -project apps/apple/Pico/Pico.xcodeproj -scheme Pico -destination 'platform=macOS' test
xcodebuild -project apps/apple/Pico/Pico.xcodeproj -scheme Pico -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test
```

Build and launch the native macOS app:

```bash
xcodebuild -project apps/apple/Pico/Pico.xcodeproj -scheme Pico -destination 'platform=macOS' -derivedDataPath /tmp/pico-macos-build build
open /tmp/pico-macos-build/Build/Products/Debug/Pico.app
```

Use any available simulator from `xcrun simctl list devices available` if `iPhone 16 Pro` is not installed.

When the user asks to launch a new iOS build on their iPhone, use the physical device id `00008150-00110C2A1A88401C` and run this from the repo root:

```bash
DEVICE_ID="00008150-00110C2A1A88401C"
DERIVED_DATA="/tmp/pico-ios-device-build"
APP_PATH="$DERIVED_DATA/Build/Products/Debug-iphoneos/Pico.app"

xcodebuild \
  -project apps/apple/Pico/Pico.xcodeproj \
  -scheme Pico \
  -destination "platform=iOS,id=$DEVICE_ID" \
  -derivedDataPath "$DERIVED_DATA" \
  build

xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"
xcrun devicectl device process launch --device "$DEVICE_ID" com.alivault.pico.ios
```

This builds, installs, and launches the app on the connected iPhone.

Notes:

- `pnpm dev` starts Rust on port `3142` and Vite on port `3141`; Vite proxies API/SSE/WebSocket traffic to Rust.
- `pnpm check:fix` is the baseline browser/server validation command.
- Do not build or run the native app to validate small, localized changes. Reserve platform builds/tests for native changes, and test both macOS and iOS after broad shared changes.
- For simulator-to-Mac testing, the default iOS server URL is `http://localhost:3141`; physical devices need a trusted host-reachable Pico server URL.
- `npx -y react-doctor@latest` is useful for architecture/performance/dead-code checks, but has known intentional false positives listed under Validation expectations.
- Avoid leaving ad hoc long-lived dev/preview server processes running. Reuse an existing terminal/session manager if one is already set up by the user.

## Repo layout

### Main app code

- `src/features/pico/app-shell.tsx`
  - main application shell workspace coordinator and top-level store/controller wiring
  - wires extracted shell controllers, window effects, command actions, mutations, shortcuts, and root layout
- `src/features/pico/app-shell-common.ts`, `src/features/pico/app-shell-types.ts`, and `src/features/pico/app-shell-working-state.ts`
  - shared app-shell helpers, cross-module shell types, and compaction/working-state labels/comparators
- `src/features/pico/app-shell-composer-state.ts` and `src/features/pico/app-shell-composer-controller.tsx`
  - composer snapshot types/comparators, optimistic prompt helpers, diff line comment state, new-session branch/directory selectors, and composer panel controller
- `src/features/pico/app-shell-conversation-store.ts` and `src/features/pico/app-shell-conversation.tsx`
  - render-optimized conversation item store, group subscriptions, conversation frame, empty/loading states, and working footer
- `src/features/pico/app-shell-session-content.tsx`, `src/features/pico/app-shell-desktop-layout.tsx`, and `src/features/pico/app-shell-session-header.tsx`
  - session/composer composition, desktop right-sidebar resizing/layout, mobile tabs, and sticky session header UI
- `src/features/pico/app-shell-floating-controllers.tsx` and `src/features/pico/app-shell-sidebar-controller.tsx`
  - dialog/controller host wiring and session sidebar synchronization/selection behavior
- `src/features/pico/app-shell-sidebar-store.ts`
  - directory/session sidebar store, derived sidebar snapshots, directory index merging, and sidebar session status overlays
- `src/features/pico/app-shell-right-sidebar-state.ts`
  - right-sidebar tab/file/open-file state helpers used by the app shell
- `src/features/pico/app-shell-window-effects.tsx`
  - document-title/unread effects, session-done toasts, desktop notifications, and completion sound triggers
- `src/features/pico/use-app-shell-session-sync.ts`
  - SSE wiring and session/state sync behavior for the shell
- `src/features/pico/use-app-shell-prompt-mutations.ts`
  - prompt submission / abort / queue-related mutations
- `src/features/pico/use-app-shell-session-mutations.ts`
  - session creation, selection-adjacent mutations, and session action flows
- `src/features/pico/use-app-shell-message-scroll.ts`
  - scroll/jump behavior for the conversation pane
- `src/features/pico/use-app-shell-shortcuts.ts`
  - TanStack Hotkeys-backed keyboard shortcut handling for the shell
- `src/features/pico/sidebar.tsx`
  - directory/session sidebar UI
  - uses directory-keyed session/loading subscriptions plus keyed selected/active session stores
  - inline sidebar search has been removed; the sidebar search affordance opens the sessions dialog
- `src/features/pico/composer-panel.tsx`
  - prompt composer, slash commands, completions, model/thinking pickers, diff line comments, queue/steer UX
- `src/features/pico/composer-assist-menu.tsx` and `src/features/pico/use-composer-assist.ts`
  - slash command, path, and `@file` assist menu behavior
- `src/features/pico/composer-context-usage-indicator.tsx`, `src/features/pico/composer-pending-messages.tsx`, and `src/features/pico/composer-pickers.tsx`
  - context/provider usage display, queued prompt controls, and picker subcomponents
- `src/features/pico/conversation-view.tsx`
  - message rendering, assistant block subscriptions, tool cards, thinking cards, and compaction cards
- `src/features/pico/markdown-renderer.tsx` and `src/features/pico/highlighted-code.tsx`
  - markdown rendering, code-block copy/highlight UX, and the safe renderer for server-generated Shiki highlight spans; prefer this over `dangerouslySetInnerHTML` for highlighted code
- `src/features/pico/app-shell-add-directory-dialog.tsx`, `src/features/pico/app-shell-auth-dialog.tsx`, `src/features/pico/app-shell-session-dialogs.tsx`, `src/features/pico/app-shell-sessions-dialog.tsx`, `src/features/pico/app-shell-settings-dialog.tsx`, `src/features/pico/app-shell-tree-dialog.tsx`, and `src/features/pico/app-shell-ui-request-dialog.tsx`
  - focused dialog implementations hosted by `app-shell-floating-controllers.tsx`
  - auth dialogs are keyboard-first command surfaces on desktop and drawers on mobile
- `src/features/pico/app-shell-dialog-types.ts`
  - shared dialog/controller types for shell-hosted dialogs
- `src/features/pico/app-shell-command-palette.tsx`
  - command palette UI
- `src/features/pico/right-sidebar.tsx`
  - secondary workspace/sidebar coordinator for project files, Git review/history, and commit diff tabs
- `src/features/pico/right-sidebar-project-files.tsx` and `src/features/pico/right-sidebar-file-icons.tsx`
  - project file tree powered by `@pierre/trees`, file tab strip with drag/reorder, file viewer/open-file dialog, file icons, markdown preview/source, and syntax-highlighted file preview
- `src/features/pico/right-sidebar-git-data.ts`, `src/features/pico/right-sidebar-git-toolbar.tsx`, `src/features/pico/right-sidebar-git-header-actions.tsx`, `src/features/pico/right-sidebar-git-commit-dialog.tsx`, `src/features/pico/right-sidebar-git-branch-dialog.tsx`, `src/features/pico/right-sidebar-git-review.tsx`, and `src/features/pico/right-sidebar-git-commits.tsx`
  - git query options/helpers, toolbar/header actions, commit and branch dialogs, working-tree diff/review UI, commit history graph rendering, commit diff tabs, diff line annotations/comments, commit actions, and history/review layout behavior
- `src/features/pico/right-sidebar-types.ts`, `src/features/pico/right-sidebar-shared.ts`, `src/features/pico/right-sidebar-section-note.tsx`, and `src/features/pico/right-sidebar-git-section.tsx`
  - shared right-sidebar types, path/error helpers, section note UI, and git section card UI used across right-sidebar modules
- `src/features/pico/pico-diff-theme.ts`
  - @pierre/diffs theme registration/selection that keeps Git diffs aligned with Pico/Shiki theme variables
- `src/features/pico/keyboard-shortcuts.ts`
  - shared shortcut descriptors and labels used by the shell UI
- `src/features/pico/session-done-notifications.ts`, `src/features/pico/use-pico-theme.ts`, `src/features/pico/git-toast-utils.ts`, and `src/features/pico/scroll-shadow-utils.ts`
  - focused UI helpers for completion notification audio/desktop permission, theme persistence, git toasts, and scroll affordances
- `src/features/pico/query-keys.ts`
  - TanStack Query cache keys
- `src/features/pico/tanstack-store-utils.ts`
  - shared TanStack Store helpers (`createPicoStore`, `setStoreState`, `useSelector`, `batch`)
- `src/features/pico/pacer-utils.ts`
  - small Pico wrappers around TanStack Pacer primitives for named high-churn controls
- `src/features/pico/app-shell-utils.ts`
  - request URL builder, fetch helper, image conversion, sync-state helpers
- `src/features/pico/composer-utils.ts`
  - slash-command matching, skill serialization, completion parsing, and diff line comment prompt formatting

### Shared types/contracts

- `src/lib/pico/index.ts`
  - domain types
  - thin barrel that re-exports shared storage/sync/tree/theme helpers
- `src/lib/pico/storage.ts`
  - storage keys, prompt draft persistence, and settings/theme storage helpers
- `src/lib/pico/sync.ts`
  - state-sync item construction and sync/message normalization helpers
- `src/lib/pico/tree.ts`
  - session/tree flattening helpers
- `src/lib/pico/themes.ts` and `src/lib/pico/shiki-bundled-themes.ts`
  - Pico theme definitions, applied theme classes, Shiki theme metadata, and theme helper functions
  - keep these in sync with `src/styles/themes/*` and next-themes wiring when changing themes
- `src/lib/pico/tool-classification.ts`
  - shared tool categorization helpers used by conversation rendering
- `src/lib/pico/api.ts`
  - API response types
  - SSE event types
  - shared client/server payload contracts

### Browser routes and entry

- `index.html` and `src/main.tsx`
  - static browser document and React/Query/Router bootstrap
- `src/routes/__root.tsx`
  - app providers, not-found UI, and TanStack Devtools
- `src/routes/index.tsx`
  - main client route; session selection is linked to `?session=`
- `src/routeTree.gen.ts`
  - generated by the TanStack Router Vite plugin

There are intentionally no TypeScript server routes. Browser API calls use same-origin `/api/*`, `/events`, and terminal WebSockets; Vite proxies them during development and Rust serves them in production.

### Native Rust server/runtime

- `crates/pico-server/src/api.rs`
  - Axum router, browser/Apple HTTP and SSE contracts, session coordination, and static SPA fallback
- `crates/pico-server/src/pi_rpc.rs`, `pi_protocol.rs`, and `session_store.rs`
  - bounded strict-JSONL Pi process transport, typed commands/events, and Pi JSONL session indexing
- `crates/pico-server/src/terminal.rs`
  - server-owned PTYs, bounded replay, and reconnect behavior
- `crates/pico-server/src/git_native.rs` and `project_files.rs`
  - native Git, file tree/read, path validation, and completion logic
- `crates/pico-server/src/highlight.rs`
  - Inkjet/Tree-sitter highlighting with constrained Shiki-compatible span output
- `crates/pico-server/src/auth_bridge.rs` and `native/pi-bridge.ts`
  - bounded compiled bridge for Pi `AuthStorage`, `ModelRegistry`, OAuth, and usage operations
- `crates/pico-server/src/control.rs`, `active_work.rs`, `persistence.rs`, and `runtime.rs`
  - owner-only control socket, protocol compatibility, drain-safe updates, atomic lifecycle persistence, and server-owned runtime handles
- `crates/pico-server/src/network_config.rs`
  - private persistent configuration for one optional exact-address remote listener while preserving loopback access
- `crates/pico-server/src/static_assets.rs` and `security.rs`
  - safe static SPA serving, cache/ETag/HEAD behavior, permissive valid Host names with same-origin/explicit Origin checks, and loopback defaults
- `bin/pico.mjs` and `bin/native-runtime.mjs`
  - npm launcher, architecture-specific checksum-verified native download, compatible attachment, and safe updates

### UI primitives, providers, hooks, and styles

- `src/components/ui/*`
  - shared UI components
  - prefer using/extending these over inventing one-off patterns
- `src/components/app-providers.tsx`
  - HotkeysProvider, next-themes ThemeProvider, TooltipProvider, and Sonner toaster wiring
- `src/hooks/use-mobile.ts` and `src/hooks/use-sidebar-resize.ts`
  - viewport and resize/cursor helpers used by responsive shell/right-sidebar layouts
- `src/styles.css` and `src/styles/themes/*`
  - Tailwind entrypoint, design tokens, theme class variables, and Shiki/Pico code color variables

### Native Apple app (iOS and macOS)

- `apps/apple/SWIFTUI_CLIENT_PLAN.md`
  - historical design/roadmap for the SwiftUI client; useful context, but the implementation under `apps/apple/Pico` is authoritative when it has moved ahead of the plan
- `apps/apple/Pico/Pico.xcodeproj`
  - Xcode project with `Pico` and `PicoTests` targets and shared `Pico` scheme
- `apps/apple/Pico/Pico/PicoApp.swift`
  - SwiftUI entry point, UIKit app/scene delegates for quick actions and deep links, and root `AppModel` ownership
- `apps/apple/Pico/Pico/App/*`
  - `RootView` connection/workspace switcher, adaptive `WorkspaceView`, `AppModel` orchestration, Git extension methods, alerts, and connection status
- `apps/apple/Pico/Pico/Core/API/*`
  - `PicoEndpoint` centralized route/query builder and actor-backed `PicoAPIClient`
- `apps/apple/Pico/Pico/Core/Events/*`
  - SSE parser, stream actor, and decoded stream event wrapper
- `apps/apple/Pico/Pico/Core/Models/*`
  - Swift mirrors of shared API/SSE contracts, patchable session state, conversation items, auth, Git, files, and UI request models
- `apps/apple/Pico/Pico/Core/Persistence/*`
  - `ConnectionStore` (`pico.ios.*` UserDefaults keys), `DraftStore`, and placeholder `CredentialStore` reserved for a future authenticated transport
- `apps/apple/Pico/Pico/Features/Connections/*`
  - server host entry, URL normalization, and connection hero/form UI
- `apps/apple/Pico/Pico/Features/Sessions/*`
  - directory-organized session sidebar, session rows, new-session flow, directory search/browse/manage/purge UI
- `apps/apple/Pico/Pico/Features/Conversation/*`
  - conversation screen, native markdown renderer, assistant/user/tool/thinking/compaction rendering, model/thinking menus, and scroll behavior
- `apps/apple/Pico/Pico/Features/Composer/*`
  - prompt composer, image attachments, queue/steer controls, pending-message reorder UI, and Git comment chips
- `apps/apple/Pico/Pico/Features/Settings/*`
  - settings, provider auth lists, API-key sheet, and server-driven UI request sheets
- `apps/apple/Pico/Pico/Features/Git/*`
  - mobile files/Git workspace, project tree/read-only file viewer, Shiki highlight parsing, working-tree diffs/review, branch/commit sheets, commit history, and native commit graph rendering
- `apps/apple/Pico/Pico/Resources/Info.plist`
  - app metadata, `pico://` URL scheme, quick action, local-network/photos/camera/notification usage strings, and local-network ATS allowance
- `apps/apple/Pico/PicoTests/*` and `apps/apple/Fixtures/*`
  - Swift Testing coverage for SSE parsing, event decoding, session-state merge/patch behavior, Git formatting/tree/highlight helpers, host normalization, and shared JSON fixtures
- `apps/apple/PicoMenu/*`
  - independently launched Pico Server menu-bar UI for health, exact-address remote listener configuration, restart/log controls, and complete quit

## Core architecture

### 1) Static browser shell + native API runtime

The browser-facing app is a client-only `/` route built into `.output/public` and served by Rust with SPA fallback. Browser interaction happens inside the single app shell, backed by Rust API endpoints, SSE, and terminal WebSockets.

### 2) Viewer context is required

The browser uses a viewer context id stored in local storage (`pico-context-id`). The native app uses `ConnectionStore.contextId`, persisted under `pico.ios.contextId` on iOS and `pico.macos.contextId` on macOS.

Browser requests should usually be built with `buildRequestUrl()` from `src/features/pico/app-shell-utils.ts`, which appends:

- `context`
- optionally `session`

Native iOS requests should go through `PicoEndpoint.url()` and `PicoAPIClient`, which append:

- `context`
- optionally `session`
- optionally `sessionKey` for draft/path-backed session selections

If you add new client calls and forget these params, the runtime will often behave incorrectly.

### 3) SSE is the source of truth for live session state

The `/events` endpoint streams:

- `state_sync`
- `sessions`
- `session_status` and `session_done`
- `user_message`
- request/extension error events
- extension UI request events
- auto session naming errors
- `git_changed` refresh notifications
- other runtime events

`app-shell.tsx` and its session-sync hook listen to SSE and update browser session state from streamed payloads. Native iOS does the same through `AppModel.startEvents()`, `PicoEventStream`, and `AppModel.apply(_:)`. Do not duplicate this logic with ad hoc polling unless there is a very specific reason.

Important current behavior:

- `state_sync` is patch-friendly; follow-up events may omit unchanged fields
- initial session sync sends render-ready conversation items, not the full sanitized message list; do not reintroduce full-history `messages` in live SSE payloads unless there is a deliberate reason
- follow-up conversation updates may use `itemsPatch` rather than full `items`; update `src/features/pico/app-shell-utils.ts`, `src/lib/pico/index.ts`, `src/lib/pico/sync.ts`, Swift `SessionState.apply(_:)`, `ConversationItemsPatch`, fixtures/tests, and runtime patching together if changing this contract
- avoid duplicating large payloads such as base64 images across both `messages` and `items` in `/events`; use `/api/session/history` for paginated raw history needs
- `/api/session/history` still exists as a paginated history endpoint, but the current conversation UI does not lazy-load older messages on scroll
- session data is stored in `sessionStore` plus `sessionStateRef`; there is intentionally no broad React `sessionState` mirror
- if you update `sessionStateRef.current` directly, you must still publish the same state to `sessionStore` with `setSessionState()` or selector-driven UI such as the composer/model picker will stay stale

If you change sync payload semantics, update the shared sync helpers instead of assuming every SSE event contains a complete session snapshot.

### 4) The Rust runtime owns server-side app behavior

`crates/pico-server/src/api.rs` coordinates client contracts while focused Rust modules own Pi RPC, session indexing, terminals, Git/files, highlighting, auth bridging, persistence, and control behavior. Do not add TypeScript server routes or parallel Node state. Keep serializable server facts separate from live process/PTY handles.

### 5) Shared contracts are important

If you change a runtime payload or route response shape:

- update `src/lib/pico/api.ts`
- update `src/lib/pico/index.ts` if domain/state helpers depend on it
- update relevant browser renderers and client handlers
- update the matching Swift model(s) under `apps/apple/Pico/Pico/Core/Models`
- update `PicoEndpoint`/`PicoAPIClient` when route paths, query params, methods, or bodies change
- update `apps/apple/Fixtures/*` and Swift tests when SSE/API contract behavior changes
- update `/api/client/manifest` capabilities when native-client compatibility depends on a new endpoint/event/feature

Do not change server payloads silently.

### 6) Client state architecture is store/ref based

The app shell has been refactored to minimize broad rerenders. Prefer narrow external stores, refs, and selector-driven host components over adding broad React state to `AppShellSessionWorkspace`.

Notable current client-side state patterns:

- `sessionStore` + `sessionStateRef` are the source of truth for session data.
  - `setSessionState()` publishes to `sessionStore` and updates the ref.
  - SSE sync may update the ref before publishing; do not add early-return logic that compares only against the ref.
- `appUiStore` owns workspace UI state such as current tab and loading session ids.
- `displaySettingsStore` owns display settings such as tool visibility, message centering, and auto-scroll.
- `notificationStore` owns completion notification settings, desktop permission state, and session-done events consumed by `AppShellWindowEffectsHost`.
- `draftFlowStore`, `composerDraftSeedStore`, `composerImagesStore`, `awaitingFirstTurnStore`, `pendingDraftPromptStore`, and `pendingDraftFollowUpsStore` own draft/composer setup state.
- `composerStore`, `isSubmittingStore`, and `pendingMessagesStore` hold the composer snapshot, submit status, diff line comments, and queued prompt state consumed by `AppShellComposerController`.
- `contextUsageStore` feeds the composer context/provider usage indicator.
  - high-frequency context-usage publications are throttled with TanStack Pacer and reset on session switches.
- `conversationItemsStore` owns the render-optimized projection of `SessionState.items`.
  - `sessionStore`/`sessionStateRef` still hold the canonical session snapshot, including `items`; the conversation store exists to avoid broad rerenders.
  - It supports global revision subscriptions, render-group subscriptions, assistant-group item-key subscriptions, and per-item subscriptions.
  - Streaming conversation item updates are throttled with TanStack Pacer before publishing to the conversation store.
  - Assistant rendering bridges through a per-assistant-group `AssistantMessagesStore`, then an `AssistantBlockStore` in `conversation-view.tsx` with per-block and tool-derived subscriptions.
  - The session-loading state intentionally hides the previous message stack while switching sessions.
- `hiddenThinkingPreviewStore` and `workingStateStore` are narrow stores for footer/loading text.
- `sidebarStore` keeps directory-keyed sidebar snapshots independent of the main workspace renders.
  - Its store construction and sidebar session/index helpers live in `src/features/pico/app-shell-sidebar-store.ts` rather than inline in `app-shell.tsx`.
- `rightSidebarStore` owns the right-sidebar active tab plus open file tabs, preview path, active file path, and file-tree collapsed state.
  - Mutations for opening/closing/reordering right-sidebar files live in `src/features/pico/app-shell-right-sidebar-state.ts`.
- `AppShellController` centralizes the active store/ref/action bundle used by imperative shell handles.

When adding new workspace state, first decide whether it belongs in one of these stores or in a new narrow store. Use local React state only for truly local UI concerns.

### 7) Native Apple client architecture

The iOS/macOS app is a native companion client for an existing Pico server. It does not embed the Pi SDK runtime, spawn shell/git tools, or read arbitrary project files locally. Keep Pi SDK, filesystem, git, auth storage, and session runtime behavior on the server.

Current native architecture:

- `PicoApp` owns one `@State` `AppModel`; iOS bridges home-screen quick actions through UIKit delegates, while both platforms support `pico://` deep links.
- `RootView` switches between `ConnectionView` and `WorkspaceView` based on `model.isConnected`, restores saved connections on task startup, tracks scene phase, and hosts global alert/UI-request sheets.
- macOS uses a Mail-style three-column `NavigationSplitView` (directories, selected-directory sessions, conversation), native app commands and Settings scene, platform persistence keys, AppKit pasteboard/URL/image adapters, an `NSTextView` code viewer, and a native SwiftUI pending-queue editor.
- `WorkspaceView` is adaptive: compact width uses `NavigationStack`; regular width uses `NavigationSplitView` with `SessionSidebarView` and `ConversationScreen`.
- `AppModel` is `@MainActor @Observable` and is the single native app coordinator for connection state, active `SessionState`, directory/session snapshots, composer state, auth/UI requests, notifications, Git status, and event application.
- `PicoAPIClient` is an actor for JSON requests and response/error decoding. Add API calls there instead of creating ad hoc `URLSession` calls from views.
- `PicoEventStream` is an actor for `URLSession` SSE byte streaming, `SSEEventParser` dispatch, `lastEventId`, and decoded `PicoServerEvent` values.
- `ConnectionStore` persists server URL, iOS context id, last event id, sidebar directories, and local hide-tools preference under `pico.ios.*` UserDefaults keys.
- `DraftStore` persists prompt drafts by context/session key. `CredentialStore` is currently a no-op placeholder for future client pairing/bearer tokens.
- `SessionState.apply(_:)` owns Swift state-sync merge semantics, including patch-friendly fields, `itemsPatch`, optimistic local user-message carry/deduplication, and hidden-thinking preview derivation.
- Native views may keep local presentation state (`@State`, sheets, navigation paths, search text), but long-lived app/session/server state should stay in `AppModel` or focused persistence/model helpers.

When changing shared live-session behavior, keep browser `updateStateFromSync()`/conversation store semantics and Swift `SessionState.apply(_:)` aligned through fixtures and tests.

## Route and endpoint conventions

When adding or editing a server route:

1. add it to the Axum router in `crates/pico-server/src/api.rs`
2. keep protocol/request/response types explicit and bounded
3. put focused filesystem, Git, PTY, auth bridge, or Pi RPC behavior in the matching Rust module
4. preserve `context`, `session`, and `sessionKey` resolution semantics
5. update `src/lib/pico/api.ts`, Swift models/endpoints, manifest capabilities, shared fixtures, and tests
6. run `node scripts/update-route-inventory.mjs` when the public client route set changes

Do not create `src/routes/api.*` files; `src/routes` is browser-only.

Existing notable endpoints:

- `/events`
- `/api/client/manifest`
- `/api/prompt`
- `/api/abort`
- `/api/auth/providers`
- `/api/auth/api-key`
- `/api/auth/oauth`
- `/api/auth/logout`
- `/api/session/new`
- `/api/session/select`
- `/api/session/rename`
- `/api/session/delete`
- `/api/session/clone`
- `/api/session/fork`
- `/api/session/tree`
- `/api/session/tree/label`
- `/api/session/history`
- `/api/session/move`
- `/api/session/read-state`
- `/api/sessions/delete`
- `/api/model`
- `/api/thinking`
- `/api/settings/hide-thinking`
- `/api/slash-command`
- `/api/path-completions`
- `/api/file-completions`
- `/api/files/read`
- `/api/files/tree`
- `/api/directory/resolve`
- `/api/directory-search`
- `/api/directory-sessions`
- `/api/directory-sessions/cleanup`
- `/api/directory-sessions-index`
- `/api/directory-sessions-indexes`
- `/api/git-status`
- `/api/git-changes`
- `/api/git-diff`
- `/api/git-review`
- `/api/git-commit-files`
- `/api/git-commit-diff`
- `/api/git-commit-remote-url`
- `/api/git-commit-action`
- `/api/git-commit-message`
- `/api/git-commit`
- `/api/git-stage`
- `/api/git-discard`
- `/api/git-checkout`
- `/api/git-push`
- `/api/git-pull`
- `/api/provider-usage`
- `/api/pending-message/remove`
- `/api/pending-messages/reorder`
- `/api/highlight`
- `/api/ui/$id`

## Browser client conventions

### Data fetching

Prefer these existing helpers/patterns:

- `buildRequestUrl()` for app-aware URLs
- `fetchJson()` for JSON requests that should throw on API errors
- TanStack Query for cached server data
- local React state for transient UI-only state

Use query keys from `src/features/pico/query-keys.ts` when extending cached data. Git SSE refresh invalidations are batched with TanStack Pacer in `use-app-shell-session-sync.ts`; prefer extending that batching path over adding one invalidation per event.

### Session selection

The selected session is route-linked via `?session=`.

If you add a flow that creates/selects a session, make sure it stays compatible with:

- route navigation in `src/routes/index.tsx`
- `onSelectSession` in `PicoAppShell`
- runtime request resolution based on `context` + `session`

### Provider authentication

Provider auth is exposed through `/login` and `/logout`, command palette actions, and the Provider authentication section in Settings.

Important behavior:

- Credentials are managed by the Pi SDK `AuthStorage` / `ModelRegistry`; do not add parallel browser credential storage.
- Auth routes are implemented by Rust through the compiled Pi bridge:
  - `/api/auth/providers`
  - `/api/auth/api-key`
  - `/api/auth/oauth`
  - `/api/auth/logout`
- Auth UI lives in `src/features/pico/app-shell-auth-dialog.tsx`; server-driven OAuth/device-code prompts flow through `src/features/pico/app-shell-ui-request-dialog.tsx` and `/api/ui/$id`.
- Desktop auth flows should remain keyboard-first `CommandDialog` surfaces; mobile flows should use `Drawer` with explicit buttons for actions such as cancel/continue/save.
- OAuth URLs should be opened or copied via command actions, not shown raw in toasts or inline visible text unless there is an explicit UX reason.
- When auth is opened from Settings, closing the top-level login/logout dialog should return to Settings; substeps such as API-key entry should first go back to their provider list.
- After login/logout/API-key changes, refresh model/provider state through the runtime/model registry path and invalidate provider queries as needed.

If you change auth contracts, update:

- `src/lib/pico/api.ts`
- `src/lib/pico/index.ts` for UI-request shape changes
- `crates/pico-server/src/auth_bridge.rs` and `native/pi-bridge.ts`
- `src/features/pico/app-shell-auth-dialog.tsx`
- `src/features/pico/app-shell-ui-request-dialog.tsx`
- iOS auth/UI-request models and views in `apps/apple/Pico/Pico/Core/Models` and `apps/apple/Pico/Pico/Features/Settings`
- the relevant Axum route/handler in `crates/pico-server/src/api.rs`

### Composer behavior

The composer supports:

- plain prompts
- image attachments
- skill-prefixed drafts via `/skill:...`
- slash commands
- path completions
- `@file` reference completions
- queue/steer while streaming
- Git diff line comments from the right sidebar, serialized into the submitted prompt

Composer data flows through `composerStore` as `AppShellComposerSnapshot`, with actions routed through `AppShellComposerController`. The model picker uses the shared `Command` UI and depends on `sessionStore` publishing `availableModels` from `state_sync`; if models look empty, verify the store publish path before changing picker UI.

If you touch composer parsing or submission, inspect all of:

- `src/features/pico/composer-panel.tsx`
- `src/features/pico/composer-utils.ts`
- `src/features/pico/use-composer-assist.ts`
- `src/features/pico/use-app-shell-prompt-mutations.ts`
- `src/features/pico/app-shell-composer-state.ts`

Path and `@file` completion requests are debounced with TanStack Pacer while preserving request-id stale-result guards.

### Conversation history and rendering

The main conversation view currently receives full session history through `state_sync` and renders from the `SessionState.items` projection. A paginated `/api/session/history` endpoint exists, but older-history lazy loading is not currently wired into the UI.

If you touch conversation/session sync behavior, inspect all of:

- `src/features/pico/app-shell.tsx`
- `src/features/pico/use-app-shell-session-sync.ts`
- `src/features/pico/app-shell-utils.ts`
- `src/features/pico/conversation-view.tsx`
- `src/features/pico/markdown-renderer.tsx`
- `src/lib/pico/sync.ts`
- `crates/pico-server/src/api.rs`
- `crates/pico-server/src/session_store.rs`
- `apps/apple/Pico/Pico/Core/Models/SessionState.swift`
- `apps/apple/Pico/Pico/Core/Models/StateSyncPayload.swift`
- `apps/apple/Pico/Pico/Core/Models/ConversationItem.swift`
- `apps/apple/Pico/Pico/App/AppModel.swift`
- `apps/apple/Pico/Pico/Features/Conversation/*`
- `apps/apple/Fixtures/*` and `apps/apple/Pico/PicoTests/*`

Be careful not to break the distinction between:

- full session messages/items delivered over the initial `state_sync`
- patch-friendly follow-up `state_sync` events that may omit unchanged fields
- the still-available paginated `/api/session/history` endpoint
- pending user messages and the current streaming assistant message

Rendering/performance details:

- Treat `sessionStore`/`sessionStateRef` as the canonical session snapshot, but use `conversationItemsStore` as the render-optimized projection of `SessionState.items`.
- `conversationItemsStore` supports global revision subscriptions, render-group subscriptions, assistant-group item-key subscriptions, and per-item subscriptions; avoid passing whole message arrays through broad React state.
- Conversation rendering is layered: `ConversationItemsStore` → per-assistant-group `AssistantMessagesStore` → `AssistantBlockStore` in `conversation-view.tsx` → per-block and tool-derived subscriptions.
- Streaming conversation item updates are throttled with TanStack Pacer before publishing to the conversation store.
- Assistant block rendering subscribes narrowly: text/thinking/compaction blocks subscribe by block key, while tool cards derive separate header/body snapshots so collapsed bodies do not subscribe to full tool payloads.
- Markdown/code block rendering lives in `src/features/pico/markdown-renderer.tsx`; streaming fenced code blocks render unhighlighted until the fence is complete.
- Code block syntax highlighting uses `/api/highlight` caching and only runs for complete, non-streaming code blocks with a supported language.
- Do not bypass the loading-state path when switching sessions; previous messages should be hidden while `isSessionViewLoading` is true.

### Syntax highlighting

Server-side code highlighting uses Inkjet/Tree-sitter via `/api/highlight` in `crates/pico-server/src/highlight.rs` and emits Shiki-compatible Pico CSS variables. Browser rendering should use `src/features/pico/highlighted-code.tsx` for constrained highlighted spans instead of `dangerouslySetInnerHTML`. Native rendering should use `ShikiHighlightedHTMLParser`, `CodeAttributedStringBuilder`, and `CodeSyntaxPalette`. Both clients intentionally preserve only constrained `<span>` output, the `line` class, and safe CSS-variable `color` declarations.

### Draft persistence

Browser prompt drafts are stored in session storage and keyed by session/file/draft target. Native prompt drafts are stored by `DraftStore` under `pico.ios.draft.<context>.<sessionKey-or-draft>` on iOS and `pico.macos.draft.<context>.<sessionKey-or-draft>` on macOS.

If you change browser draft behavior, update helper logic in `src/lib/pico/storage.ts` (re-exported via `src/lib/pico/index.ts`) instead of adding duplicate storage code. If you change server draft ownership/session-key semantics, update `DraftStore`, `AppModel.currentPromptDraftOwnerKey`, Swift fixtures/tests, and browser draft helpers together.

### Settings/state persistence

Storage keys live in `src/lib/pico/storage.ts` and are re-exported via `src/lib/pico/index.ts`.

Preserve existing key names when possible for backward compatibility, especially:

- `pico-hide-tools`
- other existing `pico-*` keys

Display and notification settings are mirrored through external stores in `app-shell.tsx`; persist changes via the storage helpers and publish to the relevant store instead of adding duplicate local state.

Theme family/color-mode state flows through `src/features/pico/use-pico-theme.ts`, next-themes, `APPLIED_THEME_STORAGE_KEY`, and the theme helpers in `src/lib/pico/themes.ts`. Keep theme storage keys, `src/styles/themes/*`, and `APPLIED_THEME_CLASSES` in sync when changing theme behavior.

## Native Apple client conventions

### Data fetching and request construction

- Use `PicoAPIClient` methods from `AppModel` or focused model extensions; do not issue one-off `URLSession` requests from SwiftUI views.
- Add route cases to `PicoEndpoint` so paths and query construction stay centralized.
- Always pass `ConnectionStore.contextId`. Pass `sessionId` for normal selected sessions and `sessionKey` for draft/path-backed selections and new-session flows.
- Decode `{ ok: false, error }` and non-2xx responses through `PicoAPIClient`'s central response handling; keep error messages user-readable through `PicoAPIError` and `AppAlert`.
- `GET /api/client/manifest` is the native compatibility gate. Keep its TypeScript response type, Rust payload, Swift model, and client validation in sync when changing contract version/capabilities.

### SSE and session state

- SSE is the native client's live source of truth just as it is for the browser.
- `AppModel.startEvents()` owns stream lifecycle. It includes sidebar directories in the `/events` query, cancels stale streams on session switches, persists `lastEventId`, and reconnects with backoff.
- Apply decoded events only through `AppModel.apply(_:)` and specialized helpers. Do not update `sessionState` from feature views in ways that bypass the central event/optimistic paths.
- `state_sync` is patch-friendly. Missing Swift `StateSyncPayload` fields mean “keep previous value”; `itemsPatch` must be applied against the current item list.
- If you add event types, update `PicoServerEvent`, add resilient models, add fixtures/tests, and update browser/shared event types where applicable.

### Native state and navigation

- Keep `AppModel` `@MainActor`; mutate observable app state on the main actor.
- Use actors for networking/streaming and `Task` cancellation for view-owned async work.
- Regular-width iPad-style layouts belong in `NavigationSplitView`; compact iPhone flows belong in `NavigationStack`.
- Keep native presentation state local to views. Promote state to `AppModel` only when it is shared, persisted, server-backed, or needed by multiple features.
- Avoid long-running work in SwiftUI `body`; trigger async work from `.task(id:)`, explicit actions, or model methods.

### Provider auth and UI requests

- Provider credentials live on the Pico server through the Pi SDK auth storage. The iOS app should not store provider API keys locally.
- `ApiKeyAuthSheetView` submits keys to `/api/auth/api-key`; its footer intentionally tells users keys are stored by the server.
- OAuth/login/device-code prompts flow through provider endpoints plus `extension_ui_request` events and `AuthUiRequestSheetView`.
- `CredentialStore` is reserved for future Pico client pairing/bearer tokens only; do not use it for provider credentials.

### Composer, sessions, and drafts

- `ComposerView` supports text, PhotosUI/camera/file image attachments, queued prompt controls, abort, and Git comment chips. Preserve the 8-image limit and `PromptImage` MIME/base64 contract.
- `submitComposerPrompt()` owns model/directory checks, new-session creation, optimistic local user messages, Git comment prompt serialization, and rollback.
- New-session and directory flows use server-side directory resolve/search/list endpoints; the iOS app never accesses Mac project directories directly.
- Drafts are stored through `DraftStore` and keyed by iOS context/session key; do not add duplicate draft storage in views.

### Git, files, and highlighting

- Git and file data come from server endpoints. Native Git mutations should go through `AppModel+Git` so `gitRefreshRevision`, conversation header status, branch lists, and alerts stay coherent.
- After staging/discarding/committing/pushing/pulling/checking out branches, refresh via `refreshFilesGitStateAfterMutation()` or the existing Git workspace refresh paths.
- Project file browsing uses `/api/files/tree` and `/api/files/read`; keep it read-only unless a deliberate mobile editing flow is designed.
- Code highlighting uses `/api/highlight`, `ShikiHighlightedHTMLParser`, `CodeAttributedStringBuilder`, and `CodeSyntaxPalette`. Keep the parser constrained to Shiki span/line/color-variable output; do not render arbitrary HTML.
- Git diff comments attached from mobile serialize into the composer prompt through `promptMessageWithGitComments()`; keep this compatible with the browser right-sidebar comment format.

### Native UX, security, and privacy

- Prefer SwiftUI and first-party frameworks. UIKit bridges are acceptable only for capabilities SwiftUI does not cover well in this app (delegate hooks, keyboard notifications, pasteboard, camera picker, system colors).
- Preserve accessibility labels/hints for icon-only buttons, Dynamic Type-friendly text, native `List`/`Form`/`Navigation*` patterns, and confirmation dialogs for destructive Git/session actions.
- The app allows unauthenticated HTTP on loopback and on one explicitly configured private or VPN interface address. Never bind remote access to a wildcard address or expose it to an untrusted network/public internet; add pairing/token auth before broad network exposure.
- Keep `Info.plist` privacy strings, URL scheme, quick actions, and ATS/local-network settings aligned with any feature that uses photos, camera, notifications, deep links, or network discovery.

## Server/runtime conventions

### Preserve server ownership and explicit lifecycle

The Rust server owns Pi RPC children, PTYs, auth bridge processes, replay buffers, Git watches, and persisted lifecycle state. Clients attach and detach without owning those processes. Never terminate active Pi work on client disconnect, ordinary app quit, or automatic update. Update/shutdown paths must begin draining, reject new prompt work, and wait for active session chains unless the user explicitly chooses a destructive recovery path.

Keep serializable state separate from `RuntimeRegistry`/process handles. Persist atomically through `persistence.rs`, bound all wire records and replay queues, and retain owner-only control socket/data permissions.

### Resolve viewer/session scope consistently

Axum handlers use the shared request resolution in `api.rs` and context/session helpers. Do not manually reinterpret `context`, `session`, `sessionKey`, cwd, or draft ownership in one route. Pi session history remains Pi JSONL under `PI_CODING_AGENT_DIR` or `~/.pi/agent`.

### Session trees, slash commands, and UI requests

Tree/fork/clone and slash-command flows are stateful. Review `api.rs`, `session_store.rs`, and typed Pi commands together. Built-in client commands remain in `app-shell.tsx`/`composer-utils.ts`; server-executed commands belong in Rust and typed Pi RPC.

Server-driven prompts flow through `/api/ui/$id`, scoped SSE events, `auth_bridge.rs`, and `native/pi-bridge.ts`. Update the browser dialog, Swift UI request models/views, fixtures, and bounded bridge transport together.

## Styling and code style

### Browser/server TypeScript

Formatting is enforced by Vite+ config in `vite.config.ts`.

Follow the existing style:

- 2-space indentation
- no semicolons
- double quotes
- trailing commas where formatter expects them
- `printWidth: 80`
- Tailwind class sorting via formatter config

Code style conventions already used in the repo:

- use `import * as React from "react"`
- do not add `React.memo`, `useMemo`, or `useCallback` just for render-performance optimization; React Compiler should handle routine memoization, so prefer state locality and simpler component boundaries first
- prefer `@/*` imports over deep relative imports
- avoid adding feature-level barrel/re-export modules for extracted code; import directly from the focused module instead (the existing `src/lib/pico/index.ts` public contract is an exception)
- prefer narrow types and `satisfies` where useful
- keep client/server/shared types explicit rather than using loose `any`
- reuse existing UI primitives and helpers before creating new abstractions

### Native Swift/SwiftUI

Follow the style already used under `apps/apple/Pico`:

- 2-space indentation
- one primary type per Swift file when practical; keep large model/feature helpers split by domain
- prefer `struct View` composition and focused private subviews over large view bodies
- use `@Observable`/`@Bindable` for shared model state and local `@State` for presentation-only state
- keep `AppModel` as the main coordinator until a deliberate extraction is made; if extracting, keep server/event semantics centralized rather than scattering them into views
- use `async`/`await` and cancellation-aware `Task` work; avoid callback-style networking wrappers
- prefer SwiftUI APIs; limit UIKit imports to necessary bridges and keep those uses obvious
- keep models `Sendable`, `Hashable`, `Identifiable`, and resilient to unknown fields where they mirror server contracts
- add accessibility labels/hints for icon-only controls and confirmation dialogs for destructive actions
- do not add third-party Swift packages or WebView/React Native dependencies without asking first

## TanStack / React patterns already in use

- `useQuery` / `useQueries` / `useMutation` for server-backed data and actions
- route-driven app shell via TanStack Router file routes
- TanStack Store + `@tanstack/react-store` selectors for narrow client subscriptions
- TanStack Hotkeys for app-wide shortcuts in `use-app-shell-shortcuts.ts`
- TanStack Pacer for named debounce/throttle/batch behavior in high-churn flows
- local state for view-specific UI state
- browser-only file routes with all API/runtime behavior in Rust

When adding new data flows, try to match existing patterns rather than introducing a second architectural style.

## Git feature notes

Git data is read server-side in `crates/pico-server/src/git_native.rs`.

Current behavior includes:

- repo status summary
- changed files with line counts where available
- local branch info
- remote branch info
- recent commits with load-more history and commit graph rows
- commit diff tabs, commit file lists, commit remote URLs, and commit-row actions
- unpushed commit hashes
- changed-file diffs and AI-assisted review
- diff line annotations/comments that can be attached to the composer prompt
- stage/discard actions for changed files
- AI/heuristic commit message generation
- commit, optional commit-and-push, push, force-push with `--force-with-lease`, and pull actions
- short-lived caches for status/files/branches/commits/diffs
- filesystem git watching that emits debounced `git_changed` SSE notifications

The right-sidebar Git workspace renders files, branches, commits, diffs, history, and review affordances when the Git tab/right sidebar is active. Keep detailed git queries scoped to the active Git view unless there is a deliberate UX reason to fetch them elsewhere; off-tab git fetches should stay limited to lightweight status data used by the session header and Git tab title. Client-side `git_changed` query invalidations are batched by cwd/scope with TanStack Pacer.

The right-sidebar Git workspace can show review and history areas together; the history tab/sidebar visibility is persisted. Preserve commit diff tabs across Git tab/history/review changes unless the user explicitly closes them.

The iOS Git/files workspace (`apps/apple/Pico/Pico/Features/Git`) uses the same server endpoints for status, changes, diffs, reviews, branches, commits, project tree/file reads, and `/api/highlight`. It keeps local view data in `GitWorkspaceView`/focused views and routes mutations through `AppModel+Git` so refresh revisions and header status stay coherent.

If you extend git UI, update:

- server helper types/logic in `crates/pico-server/src/git_native.rs` and Axum handlers in `api.rs`
- shared response types in `src/lib/pico/api.ts`
- browser rendering in `src/features/pico/right-sidebar.tsx` and the focused right-sidebar Git modules
- Swift response/request models in `apps/apple/Pico/Pico/Core/Models`
- native Git/file UI and helpers in `apps/apple/Pico/Pico/Features/Git`
- Swift Git tests/fixtures when formatting, graph, tree, diff, or highlight behavior changes

## Common change recipes

### Add a new API-backed action

1. add/update focused Rust runtime logic and the Axum handler/router in `crates/pico-server/src`
2. add/update response types in `src/lib/pico/api.ts`
3. call it from the browser client with `buildRequestUrl()` + `fetchJson()`
4. invalidate/query-refresh as needed
5. if native iOS needs the action, add it to `PicoEndpoint`, `PicoAPIClient`, Swift models, and `AppModel`/feature views
6. update the manifest, route inventory, fixtures, and Rust/Swift tests as applicable
7. run `pnpm check:fix` and, for broad Apple changes, both macOS and iOS tests

### Change a shared API/SSE contract

1. update the Rust server/runtime payload or route response
2. update TypeScript contracts in `src/lib/pico/api.ts` and domain helpers in `src/lib/pico/*`
3. update browser handlers/renderers that consume the contract
4. update Swift models under `apps/apple/Pico/Pico/Core/Models`
5. update Swift merge/decoder logic such as `PicoServerEvent`, `SessionState.apply(_:)`, or `ConversationItem`/`AssistantBlock` as needed
6. update `apps/apple/Fixtures/*` and Swift tests for representative full and patch payloads
7. update `/api/client/manifest` if native compatibility/capability reporting changes

### Add a native iOS feature

1. decide whether state belongs in `AppModel`, `AppModel+Git`, persistence, or local view `@State`
2. add API calls to `PicoAPIClient`/`PicoEndpoint` instead of calling `URLSession` directly from views
3. add/update Swift models and resilient decoders
4. build UI under the relevant `Features/*` folder using SwiftUI-native navigation/sheets/forms/lists
5. add privacy strings or `Info.plist` capabilities when using photos, camera, notifications, local network, URL schemes, or similar APIs
6. add Swift tests/fixtures for reducers/decoders/formatters and run `xcodebuild ... test`

### Add a new cached query

1. add a key in `src/features/pico/query-keys.ts`
2. fetch through `fetchJson()`
3. include `viewerContextId` and relevant scope keys in the query key
4. invalidate the query when mutations change underlying data

### Add a new command palette action or shortcut

1. update the command list in `app-shell.tsx`
2. update keyboard handling in `src/features/pico/use-app-shell-shortcuts.ts` if a shortcut is needed
3. wire to existing mutations/actions or add the necessary behavior
4. keep naming/description consistent with the rest of the app

### Add a new persistent setting

1. define storage key + read helper in `src/lib/pico/storage.ts`
2. wire state in `app-shell.tsx`
3. expose controls in `app-shell-settings-dialog.tsx` if user-facing
4. preserve existing keys when changing behavior rather than renaming casually

### Add or change a theme

1. update theme definitions/helpers in `src/lib/pico/themes.ts`
2. update bundled theme metadata in `src/lib/pico/shiki-bundled-themes.ts` when adding/removing Shiki-backed themes
3. update CSS variables/classes in `src/styles/themes/*`
4. verify next-themes wiring in `src/components/app-providers.tsx` and `src/features/pico/use-pico-theme.ts`
5. keep code/diff highlighting variables aligned through `crates/pico-server/src/highlight.rs`, `src/features/pico/highlighted-code.tsx`, and `src/features/pico/pico-diff-theme.ts`

### Add a new slash command

1. add the descriptor in `app-shell.tsx`
2. update `runBuiltinSlashCommand()` in `app-shell.tsx` for client-handled commands
3. update composer behavior/search in `composer-utils.ts` and assist UI if needed
4. implement server-executed runtime handling with typed Pi commands in Rust
5. validate both typed entry and UI suggestion flows

## Release workflow

Releases run through `.github/workflows/release.yml` on pushed `v*.*.*` tags. The workflow publishes four architecture-specific native server bundles, checksums/manifests, generated Homebrew formula metadata, the lightweight npm launcher/static browser package, and—when signing secrets are enabled—a notarized macOS DMG plus cask. iOS distribution remains a separate TestFlight/App Store flow.

Release setup:

- npm Trusted Publishing should be configured for repository `alivault/pico`
- workflow filename: `release.yml`
- GitHub Actions environment: `npm`
- the workflow uses OIDC (`id-token: write`), not an `NPM_TOKEN` secret
- GitHub release notes are generated automatically by `softprops/action-gh-release` with `generate_release_notes: true`

Release-note/changelog quality:

- Prefer merging release-worthy work through pull requests instead of direct commits when possible; GitHub generated release notes are best when they can summarize merged PRs.
- Keep PR titles user-facing and changelog-ready, for example `Add git commit history diff tabs` or `Fix provider login returning to Settings`; avoid vague titles like `updates`, `fixes`, or `wip`.
- Apply release-note labels consistently so GitHub can group changes well:
  - `feature` or `enhancement` for user-facing additions
  - `bug` or `fix` for fixes
  - `documentation` for docs
  - `dependencies` for dependency updates
  - `chore` or `maintenance` for internal/release automation
  - `ignore-for-release` for changes that should not appear in release notes
- If the user asks for nicer generated changelog categories, add or update `.github/release.yml` rather than replacing the existing release workflow. Keep it aligned with the labels above.
- Before releasing, review the commits/PRs since the previous tag and tell the user the likely generated release-note highlights plus the chosen semver bump.

Release process for agents:

1. Make sure all intended changes are committed. The release script requires a clean working tree.
2. Inspect changes since the previous tag and choose the semver bump from the committed changes:
   - `patch` for fixes, dependency maintenance, docs, and internal automation
   - `minor` for user-facing features or compatible behavior additions
   - `major` only for breaking changes
3. Confirm the bump and release-note highlights with the user unless they explicitly asked to release with a specific bump.
4. Run the release script from `main` (or set `RELEASE_BRANCH=<branch>` only if intentionally releasing from another branch):

```bash
pnpm release patch # or minor/major
```

The release script fetches `origin/main`, verifies local `main` is based on it (local commits ahead of origin are OK), checks that the target git tag and npm version do not already exist, runs `pnpm check` and `pnpm build`, updates both `package.json` and `crates/pico-server/Cargo.toml` plus `Cargo.lock`, creates the matching `v*.*.*` commit/tag, and pushes the branch plus tags.

Do not run `pnpm version` or push release tags manually unless the release script is unsuitable and the user explicitly asks. The pushed tag must match both npm and Rust versions. The workflow validates, builds, publishes checksum-verified native assets and npm with provenance/OIDC, and creates a GitHub release with generated notes. Do not hand-write a separate GitHub release body unless the user explicitly wants to override generated notes.

## Validation expectations

At minimum after non-trivial browser/server changes:

```bash
pnpm check:fix
```

Do not build or run the native iOS app to validate small, localized changes. Only run the full iOS test build after large or broad native changes:

```bash
xcodebuild -project apps/apple/Pico/Pico.xcodeproj -scheme Pico -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test
```

Use another installed simulator if needed.

Manual smoke tests are recommended for the touched area. Useful browser flows:

- create/select a session
- submit a prompt
- abort/queue/steer while streaming
- add/remove/reorder sidebar directories
- search/select sessions through the sessions dialog
- mark sessions read/unread from the sidebar
- open tree and navigate
- fork from an older message
- rename/delete a session
- open the Git/right-sidebar tab
- open commit history, commit diff tabs, and review/history split panes
- toggle settings for theme/thinking/tools/auto-scroll/notifications
- open Settings → Login/Logout, verify Esc/back returns to Settings, then smoke test OAuth/API-key auth dialog substeps

Useful native iOS flows:

- connect to a running Pico server and verify `/api/client/manifest` details in Settings
- reconnect/foreground the app and verify SSE resumes without stale session state
- add/reorder/remove sidebar directories and search sessions
- create/select/rename/delete a session from the native sidebar/conversation UI
- submit a text prompt, attach images, abort, queue follow-up/steer prompts, and reorder the pending queue
- change model and thinking level for a draft/new session
- edit a previous user message or branch from an assistant response
- open Settings → provider auth, smoke test API-key and OAuth/UI-request sheets
- open the Files/Git drawer, browse project files, view highlighted files/Markdown, inspect diffs, attach Git comments to the composer
- stage/discard/commit/push/pull/checkout from the Git workspace only when working against a disposable test repo
- tap a session-complete notification/deep link and use the New Chat quick action

React Doctor/Knip known intentional false positives:

- `src/react-scan-dev.ts` is dynamically imported by `src/main.tsx` only when `VITE_REACT_SCAN=true`; do not make it a production static import just to satisfy dead-code detection.
- `vendor/node-domexception/index.js` is a development-time package-resolution shim used through the `node-domexception` override while compiling Pi artifacts; it is not imported by browser source or published in the npm launcher.
- Unused `src/components/ui/*` exports may be intentionally retained as reusable shadcn-style primitives. Do not delete or unexport them solely because React Doctor/Knip reports them as unused.

## Things that are easy to break

Be especially careful around these:

- forgetting `context` / `session` / native `sessionKey` request params
- storing provider credentials outside Pi SDK `AuthStorage` / `ModelRegistry`, including accidentally saving provider API keys in iOS Keychain/UserDefaults
- changing shared payload shapes without updating browser contracts, Swift models, fixtures, and tests
- updating `sessionStateRef.current` without publishing to `sessionStore`
- mutating native `sessionState` outside `AppModel.apply(_:)`, `SessionState.apply(_:)`, or deliberate optimistic paths
- adding broad React state in `AppShellSessionWorkspace` instead of narrow stores/selectors
- moving long-lived native app/server state into SwiftUI views instead of `AppModel`/focused stores
- breaking draft-session behavior or native draft owner/session-key behavior
- assuming every `state_sync` event is complete; initial sync currently includes full history, but follow-up patch events may omit unchanged fields
- invalidating the wrong TanStack Query keys or failing to bump native `gitRefreshRevision` after Git mutations
- changing storage keys or theme class names without migration/syncing CSS and helpers
- changing `pico.ios.*` UserDefaults keys or `Info.plist` capabilities without migration/privacy review
- bypassing `HighlightedCode` or accepting broader highlight HTML than the constrained Shiki span shape
- bypassing `ShikiHighlightedHTMLParser` constraints or rendering arbitrary highlighted HTML in SwiftUI
- replacing named TanStack Pacer controls with ad hoc debounce/throttle/queue timers in high-churn paths
- adding ad hoc Node/server state or serializing live Rust process handles instead of using the native runtime registries
- attempting to run Pi SDK/git/filesystem runtime behavior on iOS instead of calling the Pico server
- exposing the unauthenticated Pico server through a wildcard, untrusted LAN, or public address instead of one explicitly configured trusted private/VPN interface
- altering session tree/fork/clone behavior without testing the browser dialogs and native edit/branch flows
- fetching detailed Git data outside the active Git/right-sidebar or native Git/files workspace without a deliberate UX reason
- adding third-party Swift packages, WebView wrappers, React Native, or Expo without explicit approval
- relying on private machine-local paths, unpublished references, or git history for product behavior

## When documenting the app

Keep public repo docs aligned with the implementation:

- dev port is `3141`
- public package name is `@alivault/pico`
- CLI binary is `pico-app`
- standalone Pi and compiled bridge build versions are pinned through the development Pi SDK dependency and updated with `pnpm update:pi`
- native Apple app path is `apps/apple/Pico`
- iOS bundle identifier is `com.alivault.pico.ios`; macOS bundle identifier is `com.alivault.pico.macos`
- native client/server topology is SwiftUI/browser ↔ Rust Pico HTTP JSON/SSE/WebSocket server ↔ standalone Pi RPC/git/filesystem runtime
- iOS currently targets Swift 6.2 and iOS 26, with a local-network HTTP development allowance

If README, `apps/apple/SWIFTUI_CLIENT_PLAN.md`, or future docs drift from the code, update them as part of the same change or explicitly note that a plan document is historical.
