# AGENTS.md

This file is the repo-specific guide for coding agents working in Pico.

## What this repo is

Pico is a local, keyboard-friendly browser workspace for Pi coding-agent sessions. It is published as the public `@alivault/pico` package and can be run directly with `npx @alivault/pico` or developed from source.

The app provides a persistent session browser, a live conversation shell, project-aware prompt helpers, provider authentication flows, git tooling, and settings around display, theme, and completion notifications.

When behavior is ambiguous, prefer the behavior currently documented in `README.md` and implemented in this repo. Do not rely on private checkouts, machine-local paths, or git history as product references.

## Stack

- TanStack Start
- TanStack Router
- TanStack Query
- TanStack Store / React Store
- TanStack Hotkeys
- TanStack Pacer
- React 19
- React Compiler enabled via `reactCompilerPreset()` in `vite.config.ts`
- TypeScript (strict mode)
- Vite+ + Nitro
- Tailwind CSS v4
- Base UI / shadcn-style component patterns
- Pi SDK loaded from the repo-local `@earendil-works/pi-coding-agent` dependency by default

## Pi SDK dependency

This app is intended to be self-contained and uses the repo-local `@earendil-works/pi-coding-agent` dependency by default.

Resolution happens in `src/server/pi-sdk-path.ts` and tries, in order:

1. `PI_REMOTE_PI_SDK_DIR` for explicit SDK override/testing
2. the bundled `@earendil-works/pi-coding-agent` dependency from `node_modules`

Use `pnpm update:pi` to refresh the bundled SDK to the current npm `latest` release.

If the app fails with a Pi SDK resolution error, check that dependencies are installed before checking the local/global Pi environment.

## Quick commands

Run these from the repo root:

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

Notes:

- Dev server port is `3141` from `vite.config.ts`.
- `pnpm check:fix` is the baseline validation command.
- Avoid leaving ad hoc long-lived dev/preview server processes running. Reuse an existing terminal/session manager if one is already set up by the user.

## Repo layout

### Main app code

- `src/features/pico/app-shell.tsx`
  - main application shell coordinator and store/controller wiring
  - composes tabs, command palette actions, focused hooks, and dialog controllers
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
  - prompt composer, slash commands, completions, model/thinking pickers, queue/steer UX
- `src/features/pico/composer-assist-menu.tsx` and `src/features/pico/use-composer-assist.ts`
  - slash command, path, and `@file` assist menu behavior
- `src/features/pico/composer-context-usage-indicator.tsx`, `src/features/pico/composer-pending-messages.tsx`, and `src/features/pico/composer-pickers.tsx`
  - context/provider usage display, queued prompt controls, and picker subcomponents
- `src/features/pico/conversation-view.tsx`
  - message rendering, markdown, code blocks, tool cards, compaction cards
  - includes assistant block subscriptions and deferred syntax highlighting
- `src/features/pico/app-shell-add-directory-dialog.tsx`, `src/features/pico/app-shell-auth-dialog.tsx`, `src/features/pico/app-shell-session-dialogs.tsx`, `src/features/pico/app-shell-sessions-dialog.tsx`, `src/features/pico/app-shell-settings-dialog.tsx`, `src/features/pico/app-shell-tree-dialog.tsx`, and `src/features/pico/app-shell-ui-request-dialog.tsx`
  - focused dialog implementations hosted by the floating controller section in `app-shell.tsx`
  - auth dialogs are keyboard-first command surfaces on desktop and drawers on mobile
- `src/features/pico/app-shell-dialog-types.ts`
  - shared dialog/controller types for shell-hosted dialogs
- `src/features/pico/app-shell-dialogs.tsx`
  - minimal UI-request dialog wrapper; most current dialog wiring lives in `app-shell.tsx`
- `src/features/pico/app-shell-command-palette.tsx`
  - command palette UI
- `src/features/pico/git-panel.tsx`
  - git status/files/branches/commits tab plus diff, review, commit, push, and pull actions
  - keeps detailed git queries scoped to the active Git tab while lightweight status text can render elsewhere
- `src/features/pico/right-sidebar.tsx`
  - secondary workspace sidebar for session/project-adjacent panels
- `src/features/pico/keyboard-shortcuts.ts`
  - shared shortcut descriptors and labels used by the shell UI
- `src/features/pico/git-toast-utils.ts`, `src/features/pico/relative-time.tsx`, and `src/features/pico/scroll-shadow-utils.ts`
  - focused UI helpers for git toasts, relative timestamps, and scroll affordances
- `src/features/pico/query-keys.ts`
  - TanStack Query cache keys
- `src/features/pico/tanstack-store-utils.ts`
  - shared TanStack Store helpers (`createPicoStore`, `setStoreState`, `useSelector`, `batch`)
- `src/features/pico/pacer-utils.ts`
  - small Pico wrappers around TanStack Pacer primitives for named high-churn controls
- `src/features/pico/app-shell-utils.ts`
  - request URL builder, fetch helper, image conversion, sync-state helpers
- `src/features/pico/composer-utils.ts`
  - slash-command matching and completion parsing logic

### Shared types/contracts

- `src/lib/pico/index.ts`
  - domain types
  - thin barrel that re-exports shared storage/sync/tree helpers
- `src/lib/pico/storage.ts`
  - storage keys, prompt draft persistence, and settings storage helpers
- `src/lib/pico/sync.ts`
  - state-sync item construction and sync/message normalization helpers
- `src/lib/pico/tree.ts`
  - session/tree flattening and filtering helpers
- `src/lib/pico/api.ts`
  - API response types
  - SSE event types
  - shared client/server payload contracts

### Routes

- `src/routes/index.tsx`
  - main route
  - session selection is linked to `?session=`
- `src/routes/events.ts`
  - SSE endpoint
- `src/routes/api.*.ts`
  - thin server routes that delegate to the runtime

### Server/runtime

- `src/server/pico-runtime/index.ts`
  - the core server-side runtime coordinator and bridge to the Pi SDK
  - owns the main state machine while delegating focused logic to runtime helper modules
- `src/server/pico-runtime/contexts.ts`
  - SSE payload/client utilities and context/session activation helpers
- `src/server/pico-runtime/session-list.ts`
  - session list/index merging, sorting, serialization, and directory revision helpers
- `src/server/pico-runtime/tree-fork.ts`
  - session tree serialization and fork helper logic
- `src/server/pico-runtime/ui-requests.ts`
  - pending UI request bridge helpers
- `src/server/pico-runtime/highlight.ts`
  - syntax highlight payload helpers
- `src/server/pico-runtime/conversation-retainer.ts`
  - render-optimized conversation item construction plus streaming conversation item helpers
- `src/server/pi-sdk.ts`
  - Pi SDK loading + worker-thread-safe runtime patching + settings manager adaptation
  - provider auth uses the SDK's `AuthStorage` and `ModelRegistry` rather than browser-local credential storage
- `src/server/pi-sdk-path.ts` and `src/server/pi-sdk-types.ts`
  - SDK package resolution and local SDK adapter types
- `src/server/session-naming.ts`
  - heuristic/LLM-backed automatic session naming helpers
- `src/server/provider-usage.ts`
  - provider usage lookup for composer context/limit display
- `src/server/git.ts`
  - native git inspection, diff/review, and git action helpers with short-lived caching
- `src/server/git-watch.ts`
  - filesystem watcher that emits git refresh events for active directories
  - debounces filesystem bursts with TanStack Pacer
- `src/server/pi-edit-tool.ts`
  - Pico-specific integration/patching for Pi edit-tool behavior
- `src/server/project-paths.ts`
  - safe project path resolution helpers for file/tree APIs
- `src/server/http.ts`
  - JSON/error response helpers
- `src/server/route-helpers.ts`
  - request JSON parsing and route error handling

### UI primitives

- `src/components/ui/*`
  - shared UI components
  - prefer using/extending these over inventing one-off patterns

## Core architecture

### 1) Single shell route + API routes

The user-facing app is the `/` route. Most interaction happens inside the single app shell, backed by API endpoints and SSE.

### 2) Viewer context is required

The app uses a viewer context id stored in local storage (`pico-context-id`).

Client requests should usually be built with `buildRequestUrl()` from `src/features/pico/app-shell-utils.ts`, which appends:

- `context`
- optionally `session`

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

`app-shell.tsx` and its session-sync hook listen to SSE and update session state from streamed payloads. Do not duplicate this logic with ad hoc polling unless there is a very specific reason.

Important current behavior:

- `state_sync` is patch-friendly; follow-up events may omit unchanged fields
- initial session sync sends render-ready conversation items, not the full sanitized message list; do not reintroduce full-history `messages` in live SSE payloads unless there is a deliberate reason
- follow-up conversation updates may use `itemsPatch` rather than full `items`; update `src/features/pico/app-shell-utils.ts`, `src/lib/pico/index.ts`, and runtime patching together if changing this contract
- avoid duplicating large payloads such as base64 images across both `messages` and `items` in `/events`; use `/api/session/history` for paginated raw history needs
- `/api/session/history` still exists as a paginated history endpoint, but the current conversation UI does not lazy-load older messages on scroll
- session data is stored in `sessionStore` plus `sessionStateRef`; there is intentionally no broad React `sessionState` mirror
- if you update `sessionStateRef.current` directly, you must still publish the same state to `sessionStore` with `setSessionState()` or selector-driven UI such as the composer/model picker will stay stale

If you change sync payload semantics, update the shared sync helpers instead of assuming every SSE event contains a complete session snapshot.

### 4) Runtime singleton owns server-side app behavior

Most server routes are intentionally thin. They delegate to `getPicoRuntime()`.

If you are adding session behavior, tree navigation, fork behavior, slash commands, UI request handling, or other app-level stateful flows, the change probably belongs in `src/server/pico-runtime/index.ts` or one of its focused helper modules.

### 5) Shared contracts are important

If you change a runtime payload or route response shape:

- update `src/lib/pico/api.ts`
- update `src/lib/pico/index.ts` if domain/state helpers depend on it
- update relevant renderers and client handlers

Do not change server payloads silently.

### 6) Client state architecture is store/ref based

The app shell has been refactored to minimize broad rerenders. Prefer narrow external stores, refs, and selector-driven host components over adding broad React state to `AppShellSessionWorkspace`.

Notable current client-side state patterns:

- `sessionStore` + `sessionStateRef` are the source of truth for session data.
  - `setSessionState()` publishes to `sessionStore` and updates the ref.
  - SSE sync may update the ref before publishing; do not add early-return logic that compares only against the ref.
- `appUiStore` owns workspace UI state such as current tab and loading session ids.
- `displaySettingsStore` owns display settings such as tool visibility and message centering.
- `notificationStore` owns notification settings/permission and session-done events.
- `draftFlowStore`, `composerDraftSeedStore`, `composerImagesStore`, `awaitingFirstTurnStore`, `pendingDraftPromptStore`, and `pendingDraftFollowUpsStore` own draft/composer setup state.
- `composerStore`, `isSubmittingStore`, and `pendingMessagesStore` hold the composer snapshot, submit status, and queued prompt state consumed by `AppShellComposerController`.
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
- `AppShellController` centralizes the active store/ref/action bundle used by imperative shell handles.

When adding new workspace state, first decide whether it belongs in one of these stores or in a new narrow store. Use local React state only for truly local UI concerns.

## Route and endpoint conventions

When adding or editing a route:

1. create/update the route in `src/routes/api.*.ts`
2. keep the route thin
3. parse request JSON with `readRequestJson()` when needed
4. return results with `jsonResponse()`
5. handle failures with `routeErrorResponse()`
6. delegate real logic to `getPicoRuntime()` or another server helper

Existing notable endpoints:

- `/events`
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
- `/api/git-commit-message`
- `/api/git-commit`
- `/api/git-checkout`
- `/api/git-push`
- `/api/git-pull`
- `/api/provider-usage`
- `/api/pending-message/remove`
- `/api/pending-messages/reorder`
- `/api/highlight`
- `/api/ui/$id`

## Client conventions

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
- Auth routes are thin and delegate to `getPicoRuntime()`:
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
- `src/server/pi-sdk-types.ts` for local SDK adapter type changes
- `src/features/pico/app-shell-auth-dialog.tsx`
- `src/features/pico/app-shell-ui-request-dialog.tsx`
- the relevant `src/routes/api.auth.*.ts` route

### Composer behavior

The composer supports:

- plain prompts
- image attachments
- skill-prefixed drafts via `/skill:...`
- slash commands
- path completions
- `@file` reference completions
- queue/steer while streaming

Composer data flows through `composerStore` as `AppShellComposerSnapshot`, with actions routed through `AppShellComposerController`. The model picker uses the shared `Command` UI and depends on `sessionStore` publishing `availableModels` from `state_sync`; if models look empty, verify the store publish path before changing picker UI.

If you touch composer parsing or submission, inspect both:

- `src/features/pico/composer-panel.tsx`
- `src/features/pico/composer-utils.ts`
- `src/features/pico/use-composer-assist.ts`

Path and `@file` completion requests are debounced with TanStack Pacer while preserving request-id stale-result guards.

### Conversation history and rendering

The main conversation view currently receives full session history through `state_sync` and renders from the `SessionState.items` projection. A paginated `/api/session/history` endpoint exists, but older-history lazy loading is not currently wired into the UI.

If you touch conversation/session sync behavior, inspect all of:

- `src/features/pico/app-shell.tsx`
- `src/features/pico/use-app-shell-session-sync.ts`
- `src/features/pico/app-shell-utils.ts`
- `src/lib/pico/sync.ts`
- `src/server/pico-runtime/index.ts`
- `src/routes/api.session.history.ts`

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
- Long streaming markdown can temporarily render as plain text and switches back to markdown when streaming stops.
- Code block syntax highlighting is deferred until code blocks are near the viewport and uses `/api/highlight` caching.
- Do not bypass the loading-state path when switching sessions; previous messages should be hidden while `isSessionViewLoading` is true.

### Draft persistence

Prompt drafts are stored in session storage and keyed by session/file/draft target.

If you change draft behavior, update helper logic in `src/lib/pico/storage.ts` (re-exported via `src/lib/pico/index.ts`) instead of adding duplicate storage code.

### Settings/state persistence

Storage keys live in `src/lib/pico/storage.ts` and are re-exported via `src/lib/pico/index.ts`.

Preserve existing key names when possible for backward compatibility, especially:

- `pico-hide-tools`
- other existing `pico-*` keys

Display and notification settings are mirrored through external stores in `app-shell.tsx`; persist changes via the storage helpers and publish to the relevant store instead of adding duplicate local state.

## Server/runtime conventions

### Use the runtime, not one-off server state

Do not create parallel global state for sessions in routes. The runtime already manages:

- active entries
- draft entries
- contexts
- unread finished state
- pending UI requests
- session naming
- session tree navigation
- slash command execution
- directory session cleanup / bulk deletion flows
- git watch notifications for active directories

### Resolve requests correctly

If a route needs the current app context/session or base cwd, use:

- `getPicoRuntime().resolveRequest(request)`
- `getPicoRuntime().getBaseCwd(activeEntry, context)`

Do not manually reconstruct this logic.

### Session tree and fork flows

These are not simple stateless endpoints. They depend on the active session/runtime state.

If changing tree or fork behavior, review:

- `getSessionTreeForRequest`
- `navigateSessionTree`
- `getForkableMessages`
- `forkSession`
- helpers in `src/server/pico-runtime/tree-fork.ts`

with `src/server/pico-runtime/index.ts` remaining the coordinator.

### Slash commands

Built-in slash commands are surfaced in the client and executed in the runtime. `/login` and `/logout` are client-handled auth dialog commands; most other built-ins execute runtime behavior.

If you add or change a slash command, update both sides:

- UI command descriptors in `app-shell.tsx`
- composer matching behavior if needed
- runtime handling in `runSlashCommand()`

### Generic UI requests

Server-driven UI prompts are handled through `/api/ui/$id`, the runtime UI-request helpers in `src/server/pico-runtime/ui-requests.ts`, and the pending UI request dialog/controller in `src/features/pico/app-shell-ui-request-dialog.tsx`.

If you touch extension/UI request flows, update both runtime and dialog handling.

## Styling and code style

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
- prefer narrow types and `satisfies` where useful
- keep client/server/shared types explicit rather than using loose `any`
- reuse existing UI primitives and helpers before creating new abstractions

## TanStack / React patterns already in use

- `useQuery` / `useQueries` / `useMutation` for server-backed data and actions
- route-driven app shell via TanStack Router file routes
- TanStack Store + `@tanstack/react-store` selectors for narrow client subscriptions
- TanStack Hotkeys for app-wide shortcuts in `use-app-shell-shortcuts.ts`
- TanStack Pacer for named debounce/throttle/batch behavior in high-churn flows
- local state for view-specific UI state
- minimal route handlers, richer runtime/service layer

When adding new data flows, try to match existing patterns rather than introducing a second architectural style.

## Git feature notes

Git data is read server-side in `src/server/git.ts`.

Current behavior includes:

- repo status summary
- changed files with line counts where available
- local branch info
- remote branch info
- recent commits
- unpushed commit hashes
- changed-file diffs and AI-assisted review
- AI/heuristic commit message generation
- commit, optional commit-and-push, push, and pull actions
- short-lived caches for status/files/branches/commits/diffs
- filesystem git watching that emits debounced `git_changed` SSE notifications

The git panel renders files, branches, commits, diffs, and review affordances when the Git tab is active. Keep detailed git queries scoped to the active Git tab unless there is a deliberate UX reason to fetch them elsewhere; off-tab git fetches should stay limited to lightweight status data used by the session header and Git tab title. Client-side `git_changed` query invalidations are batched by cwd/scope with TanStack Pacer.

If you extend git UI, update:

- server helper types/logic in `src/server/git.ts`
- shared response types in `src/lib/pico/api.ts`
- rendering in `src/features/pico/git-panel.tsx`

## Common change recipes

### Add a new API-backed action

1. add/update runtime logic in `src/server/pico-runtime/index.ts` or a focused server helper
2. expose it through a route in `src/routes/api.*.ts`
3. add/update response types in `src/lib/pico/api.ts`
4. call it from the client with `buildRequestUrl()` + `fetchJson()`
5. invalidate/query-refresh as needed
6. run `pnpm check:fix`

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

### Add a new slash command

1. add the descriptor in `app-shell.tsx`
2. update composer behavior if needed
3. implement runtime handling in `runSlashCommand()`
4. validate both typed entry and UI suggestion flows

## Release workflow

The public package is released through `.github/workflows/release.yml` on pushed `v*.*.*` tags.

Release setup:

- npm Trusted Publishing should be configured for repository `alivault/pico`
- workflow filename: `release.yml`
- GitHub Actions environment: `npm`
- the workflow uses OIDC (`id-token: write`), not an `NPM_TOKEN` secret

Release process for agents:

1. Make sure all intended changes are committed. The release script requires a clean working tree.
2. Choose the semver bump from the committed changes:
   - `patch` for fixes, dependency maintenance, docs, and internal automation
   - `minor` for user-facing features or compatible behavior additions
   - `major` only for breaking changes
3. Run the release script from `main`:

```bash
pnpm release patch # or minor/major
```

The release script fetches `origin/main`, verifies local `main` is based on it (local commits ahead of origin are OK), checks that the target git tag and npm version do not already exist, runs `pnpm check` and `pnpm build`, bumps `package.json` via `pnpm version`, creates the matching `v*.*.*` tag, and pushes the branch plus tags.

Do not run `pnpm version` or push release tags manually unless the release script is unsuitable and the user explicitly asks. The pushed tag must match the `package.json` version. The workflow validates, builds, publishes to npm with provenance via the npm CLI's OIDC support, and creates a GitHub release with generated release notes.

## Validation expectations

At minimum after non-trivial changes:

```bash
pnpm check:fix
```

Manual smoke tests are recommended for the touched area. Useful flows:

- create/select a session
- submit a prompt
- abort/queue/steer while streaming
- add/remove/reorder sidebar directories
- search/select sessions through the sessions dialog
- open tree and navigate
- fork from an older message
- rename/delete a session
- open git tab
- toggle settings for thinking/tools/notifications
- open Settings → Login/Logout, verify Esc/back returns to Settings, then smoke test OAuth/API-key auth dialog substeps

## Things that are easy to break

Be especially careful around these:

- forgetting `context` / `session` request params
- storing provider credentials outside Pi SDK `AuthStorage` / `ModelRegistry`
- changing shared payload shapes without updating client contracts
- updating `sessionStateRef.current` without publishing to `sessionStore`
- adding broad React state in `AppShellSessionWorkspace` instead of narrow stores/selectors
- breaking draft-session behavior
- assuming every `state_sync` event is complete; initial sync currently includes full history, but follow-up patch events may omit unchanged fields
- invalidating the wrong TanStack Query keys
- changing storage keys unnecessarily
- replacing named TanStack Pacer controls with ad hoc debounce/throttle/queue timers in high-churn paths
- bypassing the runtime singleton with ad hoc server state
- altering session tree/fork/clone behavior without testing the dialog flows
- relying on private machine-local paths, unpublished references, or git history for product behavior

## When documenting the app

Keep public repo docs aligned with the implementation:

- dev port is `3141`
- public package name is `@alivault/pico`
- CLI binary is `pico-app`
- bundled Pi SDK updates are handled by `pnpm update:pi`

If README or future docs drift from the code, update them as part of the same change.
