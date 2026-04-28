# AGENTS.md

This file is the repo-specific guide for coding agents working in Phi.

## What this repo is

This repo contains the current TanStack Start rewrite of the legacy browser app, now branded as Phi.

Important parity/reference note:

- The legacy app is **not** in this repo anymore.
- The parity reference lives at `~/code/pi-web-legacy`.
- When behavior is ambiguous, prefer matching the legacy app unless the user explicitly wants a deliberate change.

## Stack

- TanStack Start
- TanStack Router
- TanStack Query
- React 19
- React Compiler enabled via `reactCompilerPreset()` in `vite.config.ts`
- TypeScript (strict mode)
- Vite+ + Nitro
- Tailwind CSS v4
- Base UI / shadcn-style component patterns
- Pi SDK loaded from the repo-local `@mariozechner/pi-coding-agent` dependency by default

## Pi SDK dependency

This app is intended to be self-contained and uses the repo-local `@mariozechner/pi-coding-agent` dependency by default.

Resolution happens in `src/server/pi-sdk-path.ts` and tries, in order:

1. `PI_REMOTE_PI_SDK_DIR` for explicit SDK override/testing
2. the bundled `@mariozechner/pi-coding-agent` dependency from `node_modules`

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
- If you need to start, restart, or test a dev server / preview build, use the `zellij` `pi` session instead of creating an ad hoc long-lived server process.

## Repo layout

### Main app code

- `src/features/phi/app-shell.tsx`
  - main application shell coordinator
  - composes most UI orchestration, tabs, command palette actions, and focused hooks/dialog coordinators
- `src/features/phi/use-app-shell-session-sync.ts`
  - SSE wiring and session/state sync behavior for the shell
- `src/features/phi/use-app-shell-prompt-mutations.ts`
  - prompt submission / abort / queue-related mutations
- `src/features/phi/use-app-shell-session-mutations.ts`
  - session creation, selection-adjacent mutations, and session action flows
- `src/features/phi/use-app-shell-message-scroll.ts`
  - scroll/jump behavior for the conversation pane
- `src/features/phi/use-app-shell-shortcuts.ts`
  - keyboard shortcut handling for the shell
- `src/features/phi/sidebar.tsx`
  - directory/session sidebar UI
  - uses directory-keyed session/loading subscriptions plus keyed selected/active session stores
- `src/features/phi/composer-panel.tsx`
  - prompt composer, slash commands, completions, model picker, thinking picker, queue/steer UX
- `src/features/phi/conversation-view.tsx`
  - message rendering, markdown, code blocks, tool cards, compaction cards
  - includes assistant block subscriptions and deferred syntax highlighting
- `src/features/phi/app-shell-dialogs.tsx`
  - thin dialog coordinator for add-directory, rename/delete, fork, tree, settings, and generic UI request dialogs
- `src/features/phi/git-panel.tsx`
  - git status and changes tab
  - mounts active git sections lazily to avoid unnecessary query/render work
- `src/features/phi/query-keys.ts`
  - TanStack Query cache keys
- `src/features/phi/app-shell-utils.ts`
  - request URL builder, fetch helper, image conversion, sync-state helpers
- `src/features/phi/composer-utils.ts`
  - slash-command matching and completion parsing logic

### Shared types/contracts

- `src/lib/phi/index.ts`
  - domain types
  - thin barrel that re-exports shared storage/sync/tree helpers
- `src/lib/phi/storage.ts`
  - storage keys, prompt draft persistence, and settings storage helpers
- `src/lib/phi/sync.ts`
  - state-sync item construction and sync/message normalization helpers
- `src/lib/phi/tree.ts`
  - session/tree flattening and filtering helpers
- `src/lib/phi/api.ts`
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

- `src/server/phi-runtime/index.ts`
  - the core server-side runtime coordinator and bridge to the Pi SDK
  - owns the main state machine while delegating focused logic to runtime helper modules
- `src/server/phi-runtime/contexts.ts`
  - SSE payload/client utilities and context/session activation helpers
- `src/server/phi-runtime/session-list.ts`
  - session list/index merging, sorting, serialization, and directory revision helpers
- `src/server/phi-runtime/tree-fork.ts`
  - session tree serialization and fork helper logic
- `src/server/phi-runtime/ui-requests.ts`
  - pending UI request bridge helpers
- `src/server/phi-runtime/highlight.ts`
  - syntax highlight payload helpers
- `src/server/pi-sdk.ts`
  - Pi SDK loading + worker-thread-safe runtime patching + settings manager adaptation
- `src/server/git.ts`
  - native git inspection helpers with short-lived caching
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

The app uses a viewer context id stored in local storage (`phi-context-id`).

Client requests should usually be built with `buildRequestUrl()` from `src/features/phi/app-shell-utils.ts`, which appends:

- `context`
- optionally `session`

If you add new client calls and forget these params, the runtime will often behave incorrectly.

### 3) SSE is the source of truth for live session state

The `/events` endpoint streams:

- `state_sync`
- `sessions`
- request/extension error events
- extension UI request events
- other runtime events

`app-shell.tsx` and its session-sync hook listen to SSE and update session state from streamed payloads. Do not duplicate this logic with ad hoc polling unless there is a very specific reason.

Important current behavior:

- `state_sync` is patch-friendly; follow-up events may omit unchanged fields
- initial session bootstrap sends only the recent message window plus history metadata, not always the full conversation history
- older conversation history is fetched separately from `/api/session/history` when the user scrolls upward
- session data is stored in `sessionStore` plus `sessionStateRef`; there is intentionally no broad React `sessionState` mirror
- if you update `sessionStateRef.current` directly, you must still publish the same state to `sessionStore` with `setSessionState()` or selector-driven UI such as the composer/model picker will stay stale

If you change sync payload semantics, update the shared sync helpers instead of assuming every SSE event contains a complete session snapshot.

### 4) Runtime singleton owns server-side app behavior

Most server routes are intentionally thin. They delegate to `getPhiRuntime()`.

If you are adding session behavior, tree navigation, fork behavior, slash commands, UI request handling, or other app-level stateful flows, the change probably belongs in `src/server/phi-runtime/index.ts` or one of its focused helper modules.

### 5) Shared contracts are important

If you change a runtime payload or route response shape:

- update `src/lib/phi/api.ts`
- update `src/lib/phi/index.ts` if domain/state helpers depend on it
- update relevant renderers and client handlers

Do not change server payloads silently.

### 6) Client state architecture is store/ref based

The app shell has been refactored to minimize broad rerenders. Prefer narrow external stores, refs, and selector-driven host components over adding broad React state to `AppShellSessionWorkspace`.

Current client-side state patterns:

- `sessionStore` + `sessionStateRef` are the source of truth for session data.
  - `setSessionState()` publishes to `sessionStore` and updates the ref.
  - SSE sync may update the ref before publishing; do not add early-return logic that compares only against the ref.
- `appUiStore` owns workspace UI state such as current tab and loading session ids.
- `displaySettingsStore` owns display settings such as tool visibility and message centering.
- `notificationStore` owns notification settings/permission and session-done events.
- `draftFlowStore` owns draft-session loading owner state and stored draft directory.
- `composerStore` holds the composer snapshot consumed by `AppShellComposerController`.
- `conversationItemsStore` owns conversation items and supports per-item subscriptions.
  - Streaming conversation item updates are batched to animation frames.
  - The session-loading state intentionally hides the previous message stack while switching sessions.
- `hiddenThinkingPreviewStore` and `workingStateStore` are narrow stores for footer/loading text.
- `AppShellController` centralizes the active store/ref/action bundle used by imperative shell handles.

When adding new workspace state, first decide whether it belongs in one of these stores or in a new narrow store. Use local React state only for truly local UI concerns.

## Route and endpoint conventions

When adding or editing a route:

1. create/update the route in `src/routes/api.*.ts`
2. keep the route thin
3. parse request JSON with `readRequestJson()` when needed
4. return results with `jsonResponse()`
5. handle failures with `routeErrorResponse()`
6. delegate real logic to `getPhiRuntime()` or another server helper

Existing notable endpoints:

- `/events`
- `/api/prompt`
- `/api/abort`
- `/api/session/new`
- `/api/session/select`
- `/api/session/rename`
- `/api/session/delete`
- `/api/session/fork`
- `/api/session/tree`
- `/api/session/tree/label`
- `/api/session/history`
- `/api/model`
- `/api/thinking`
- `/api/settings/hide-thinking`
- `/api/slash-command`
- `/api/path-completions`
- `/api/file-completions`
- `/api/directory/resolve`
- `/api/directory-sessions`
- `/api/directory-sessions-index`
- `/api/directory-sessions-indexes`
- `/api/git-status`
- `/api/git-changes`
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

Use query keys from `src/features/phi/query-keys.ts` when extending cached data.

### Session selection

The selected session is route-linked via `?session=`.

If you add a flow that creates/selects a session, make sure it stays compatible with:

- route navigation in `src/routes/index.tsx`
- `onSelectSession` in `PhiAppShell`
- runtime request resolution based on `context` + `session`

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

- `src/features/phi/composer-panel.tsx`
- `src/features/phi/composer-utils.ts`

### Conversation history loading

The main conversation view now uses a recent-history bootstrap plus lazy loading for older history.

If you touch conversation/session sync behavior, inspect all of:

- `src/features/phi/app-shell.tsx`
- `src/features/phi/use-app-shell-session-sync.ts`
- `src/features/phi/app-shell-utils.ts`
- `src/lib/phi/sync.ts`
- `src/server/phi-runtime/index.ts`
- `src/routes/api.session.history.ts`

Be careful not to break the distinction between:

- recent session messages delivered over `state_sync`
- separately fetched older history pages
- pending user messages and the current streaming assistant message

Rendering/performance details:

- `conversationItemsStore` supports global, group, and per-item subscriptions; avoid passing whole message arrays through broad React state.
- Assistant rendering uses an assistant block store with per-block subscriptions inside `conversation-view.tsx`.
- Long streaming markdown can temporarily render as plain text and switches back to markdown when streaming stops.
- Code block syntax highlighting is deferred until code blocks are near the viewport and uses `/api/highlight` caching.
- Do not bypass the loading-state path when switching sessions; previous messages should be hidden while `isSessionViewLoading` is true.

### Draft persistence

Prompt drafts are stored in session storage and keyed by session/file/draft target.

If you change draft behavior, update helper logic in `src/lib/phi/storage.ts` (re-exported via `src/lib/phi/index.ts`) instead of adding duplicate storage code.

### Settings/state persistence

Storage keys live in `src/lib/phi/storage.ts` and are re-exported via `src/lib/phi/index.ts`.

Preserve existing key names when possible for backward compatibility, especially:

- `phi-hide-tools`
- other existing `phi-*` keys

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

### Resolve requests correctly

If a route needs the current app context/session or base cwd, use:

- `getPhiRuntime().resolveRequest(request)`
- `getPhiRuntime().getBaseCwd(activeEntry, context)`

Do not manually reconstruct this logic.

### Session tree and fork flows

These are not simple stateless endpoints. They depend on the active session/runtime state.

If changing tree or fork behavior, review:

- `getSessionTreeForRequest`
- `navigateSessionTree`
- `getForkableMessages`
- `forkSession`
- helpers in `src/server/phi-runtime/tree-fork.ts`

with `src/server/phi-runtime/index.ts` remaining the coordinator.

### Slash commands

Built-in slash commands are surfaced in the client and executed in the runtime.

If you add or change a slash command, update both sides:

- UI command descriptors in `app-shell.tsx`
- composer matching behavior if needed
- runtime handling in `runSlashCommand()`

### Generic UI requests

Server-driven UI prompts are handled through `/api/ui/$id`, the runtime UI-request helpers in `src/server/phi-runtime/ui-requests.ts`, and the pending UI request dialog in `app-shell-dialogs.tsx`.

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
- short-lived caches for status/changes

The git panel renders the files, branches, and commits sections together, but the panel itself only mounts while the Git tab is active. Keep detailed git queries scoped to the active Git tab unless there is a deliberate UX reason to fetch them elsewhere; off-tab git fetches should stay limited to lightweight status data used by the session header and Git tab title.

If you extend git UI, update:

- server helper types/logic in `src/server/git.ts`
- shared response types in `src/lib/phi/api.ts`
- rendering in `src/features/phi/git-panel.tsx`

## Common change recipes

### Add a new API-backed action

1. add/update runtime logic in `src/server/phi-runtime/index.ts` or a focused server helper
2. expose it through a route in `src/routes/api.*.ts`
3. add/update response types in `src/lib/phi/api.ts`
4. call it from the client with `buildRequestUrl()` + `fetchJson()`
5. invalidate/query-refresh as needed
6. run `pnpm check:fix`

### Add a new cached query

1. add a key in `src/features/phi/query-keys.ts`
2. fetch through `fetchJson()`
3. include `viewerContextId` and relevant scope keys in the query key
4. invalidate the query when mutations change underlying data

### Add a new command palette action or shortcut

1. update the command list in `app-shell.tsx`
2. update keyboard handling in `app-shell.tsx` if a shortcut is needed
3. wire to existing mutations/actions or add the necessary behavior
4. keep naming/description consistent with the rest of the app

### Add a new persistent setting

1. define storage key + read helper in `src/lib/phi/storage.ts`
2. wire state in `app-shell.tsx`
3. expose controls in `app-shell-dialogs.tsx` if user-facing
4. preserve existing keys when changing behavior rather than renaming casually

### Add a new slash command

1. add the descriptor in `app-shell.tsx`
2. update composer behavior if needed
3. implement runtime handling in `runSlashCommand()`
4. validate both typed entry and UI suggestion flows

## Validation expectations

At minimum after non-trivial changes:

```bash
pnpm check:fix
```

Manual smoke tests are recommended for the touched area. Useful flows:

- create/select a session
- submit a prompt
- abort/queue/steer while streaming
- add/remove/search sidebar directories
- open tree and navigate
- fork from an older message
- rename/delete a session
- open git tab
- toggle settings for thinking/tools/notifications

## Things that are easy to break

Be especially careful around these:

- forgetting `context` / `session` request params
- changing shared payload shapes without updating client contracts
- updating `sessionStateRef.current` without publishing to `sessionStore`
- adding broad React state in `AppShellSessionWorkspace` instead of narrow stores/selectors
- breaking draft-session behavior
- assuming `state_sync` always contains the full conversation history instead of a recent window / patch
- invalidating the wrong TanStack Query keys
- changing storage keys unnecessarily
- bypassing the runtime singleton with ad hoc server state
- altering session tree/fork behavior without testing the dialog flows
- assuming the legacy app is in this repo

## When documenting the app

Keep repo docs aligned with reality:

- legacy app path is `~/code/pi-web-legacy`
- dev port is `3141`
- there is currently no separate `parity-checklist.md` in this repo

If README or future docs drift from the code, update them as part of the same change.
