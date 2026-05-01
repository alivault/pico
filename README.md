# Phi

Phi is the TanStack Start rewrite of the legacy `pi-web` browser app. It keeps the same local Phi workflow—directory-organized session browsing, a live conversation shell, tree navigation, session forking, git inspection, and bundled SDK-backed prompt execution—while moving the app to a TypeScript/TanStack/Vite+ stack.

The legacy browser app is no longer in this repo. It now lives at `~/code/pi-web-legacy` and remains the parity reference until manual sign-off is recorded.

## Stack

- TanStack Start + TanStack Router + TanStack Query
- TanStack Store / React Store for narrow client subscriptions
- TanStack Hotkeys for app-wide shortcuts
- TanStack Pacer for named debounce/throttle/batch controls in high-churn flows
- React 19 + TypeScript
- Vite+ + Nitro
- Tailwind CSS v4
- shadcn-style UI components built on Base UI
- Native bundled-SDK-backed runtime loaded from the `@mariozechner/pi-coding-agent` dependency
- Server-sent events for live session sync

## Current feature snapshot

### Sidebar and session management

- Directory-grouped sidebar with collapse/expand, drag reordering, and off-canvas mobile behavior
- Route-linked session selection via `?session=`
- Session lifecycle actions: new, rename, delete, and fork
- Session search/switching through the sessions dialog
- Multi-select sidebar session deletion
- Delete-old-sessions cleanup flow for sidebar directories
- Unread/live badges and title-bar unread counts
- Recent/current/known directory discovery when adding sidebar directories

### Composer

- Prompt drafting with per-session draft persistence
- Image attachments
- Debounced path completions and `@file` reference completions
- Model picker, reasoning/thinking level picker, and throttled context/provider usage indicator
- Streaming controls: submit, abort, steer, and queued follow-ups
- Pending prompt inspection, removal, and reordering while a response is active
- Slash commands for built-ins like `/compact`, `/delete`, `/fork`, `/tree`, `/rename`, thinking/tool visibility, plus skill shortcuts when skills are available

### Conversation view

- Live SSE-backed session replay/sync
- Markdown rendering with GFM support
- Syntax-highlighted fenced code blocks via `/api/highlight`
- Assistant text, thinking, tool, and compaction block rendering
- TanStack Store-backed narrow subscriptions for conversation items and assistant blocks
- TanStack Pacer throttling for streaming conversation item publications
- Optional hiding of thinking blocks and tool cards
- Scroll jump controls for top, bottom, previous message, and next message
- Session-finished toasts, sound, desktop notifications, and unread tracking

### Tree, fork, and utilities

- Session tree dialog with filters, keyboard shortcuts, label editing, and continue-from-here flows
- Tree navigation with optional summarize-before-continue behavior
- Fork dialog that branches from earlier user messages
- Generic server-driven UI request dialog via `/api/ui/$id`
- Command palette for the main session/sidebar/app actions
- Settings for theme, display toggles, and completion notifications

### Git

- Git tab for repository status, changed files, local/remote branches, recent commits, and unpushed commit highlighting for the active session directory
- Commit dialog with AI/heuristic message generation, include-unstaged toggle, commit, and commit-and-push flows
- Push, pull, and refresh controls in the Git tab
- Native backend git inspection/actions in `src/server/git.ts`, with Pacer-debounced filesystem watching in `src/server/git-watch.ts`
- Batched client-side git query invalidations from `git_changed` SSE bursts

## Project layout

### App shell and UI

Main feature code lives in `src/features/phi`:

- `app-shell.tsx` — top-level shell orchestration, store/controller wiring, commands, tabs, notifications, and focused hook/dialog composition
- `use-app-shell-session-sync.ts` — SSE session/state sync behavior plus batched git invalidations
- `use-app-shell-prompt-mutations.ts` and `use-app-shell-session-mutations.ts` — prompt/session action flows
- `sidebar.tsx` — directory/session sidebar UI
- `composer-panel.tsx` — composer, slash commands, completions, model/thinking pickers, context usage, and pending prompt controls
- `composer-assist-menu.tsx`, `composer-context-usage-indicator.tsx`, `composer-pending-messages.tsx`, `composer-pickers.tsx`, and `use-composer-assist.ts` — focused composer subcomponents and debounced assist logic
- `conversation-view.tsx` — message rendering, markdown/code blocks, tool cards, compaction UI, assistant block subscriptions, and deferred highlighting
- `app-shell-dialogs.tsx` — legacy/minimal UI-request dialog wrapper
- `app-shell-add-directory-dialog.tsx`, `app-shell-session-dialogs.tsx`, `app-shell-sessions-dialog.tsx`, `app-shell-settings-dialog.tsx`, `app-shell-tree-dialog.tsx`, and `app-shell-ui-request-dialog.tsx` — focused dialog implementations
- `app-shell-command-palette.tsx` — command palette
- `use-app-shell-shortcuts.ts` — TanStack Hotkeys-backed shortcut definitions
- `tanstack-store-utils.ts` — TanStack Store helpers used by the shell stores
- `pacer-utils.ts` — small Phi wrappers around TanStack Pacer primitives
- `git-panel.tsx` — git status/files/branches/commits tab plus commit, push, and pull actions
- `session-done-notifications.ts` — sound and desktop notification helpers

### Shared client/server contracts

- `src/lib/phi/index.ts` — UI domain types plus a barrel for storage, sync, and tree helpers
- `src/lib/phi/storage.ts` — storage keys, prompt draft persistence, and settings storage helpers
- `src/lib/phi/sync.ts` — state-sync item construction and message normalization helpers
- `src/lib/phi/tree.ts` — session tree flattening and filtering helpers
- `src/lib/phi/api.ts` — API request/response types and SSE payload contracts

### Routing and providers

- `src/routes/__root.tsx` — root document, CSS, and devtools shell
- `src/routes/index.tsx` — root route and `?session=` wiring
- `src/router.tsx` — router + query integration
- `src/components/app-providers.tsx` — theme, TanStack Hotkeys, tooltip, and toast providers

### Server/runtime

- `src/routes/events.ts` — SSE event stream endpoint
- `src/routes/api.*.ts` — server endpoints for prompts, sessions, tree actions, git, completions, settings, highlighting, and UI callbacks
- `src/server/phi-runtime/index.ts` — runtime bridge between TanStack Start routes and the SDK session model
- `src/server/phi-runtime/*` — focused runtime helpers for contexts, retained conversation windows, session lists, tree/fork, UI requests, and highlighting
- `src/server/pi-sdk.ts`, `src/server/pi-sdk-path.ts`, and `src/server/pi-sdk-types.ts` — SDK loading, package resolution, settings-manager adaptation, and local adapter types
- `src/server/session-naming.ts` — heuristic/LLM-backed automatic session naming helpers
- `src/server/provider-usage.ts` — provider usage lookup for composer context/limit display
- `src/server/git.ts` and `src/server/git-watch.ts` — git inspection/actions, short-lived caches, and Pacer-debounced filesystem watch notifications

## Current TanStack architecture notes

- TanStack Store is the primary client state primitive for shared shell state. The app favors narrow selector subscriptions over broad React state mirrors.
- TanStack Hotkeys owns app-wide keyboard shortcuts through `use-app-shell-shortcuts.ts` and `HotkeysProvider` in `src/components/app-providers.tsx`.
- TanStack Pacer is used for high-churn execution control:
  - streaming conversation item publication throttling
  - path and `@file` completion request debouncing
  - context usage publication throttling
  - client git invalidation batching
  - server git-watch debounce
- TanStack Query remains the server-state/cache layer. Use `src/features/phi/query-keys.ts` for cached query keys and `buildRequestUrl()` for app-aware requests.

## Key HTTP/SSE endpoints

- `GET /events`
- `POST /api/prompt`
- `POST /api/abort`
- `POST /api/session/new`
- `POST /api/session/select`
- `POST /api/session/rename`
- `POST /api/session/delete`
- `POST /api/sessions/delete`
- `GET /api/session/history`
- `GET|POST /api/session/fork`
- `GET|POST /api/session/tree`
- `POST /api/session/tree/label`
- `POST /api/model`
- `POST /api/thinking`
- `POST /api/settings/hide-thinking`
- `POST /api/slash-command`
- `POST /api/path-completions`
- `POST /api/file-completions`
- `GET /api/directory-sessions-index`
- `GET /api/directory-sessions-indexes`
- `GET /api/directory-sessions`
- `POST /api/directory-sessions/cleanup`
- `POST /api/directory/resolve`
- `GET /api/git-status`
- `GET /api/git-changes`
- `POST /api/git-commit-message`
- `POST /api/git-commit`
- `POST /api/git-push`
- `POST /api/git-pull`
- `GET /api/provider-usage`
- `POST /api/pending-message/remove`
- `POST /api/pending-messages/reorder`
- `POST /api/highlight`
- `POST /api/ui/$id`

## Local development

### Install

```bash
pnpm install
```

### Run dev server

```bash
pnpm dev
```

The server prefers the repo-local `@mariozechner/pi-coding-agent` dependency, so a separate global `pi` install is not required. Set `PI_REMOTE_PI_SDK_DIR` only when you intentionally want to test against a different SDK checkout/install.

To refresh the bundled SDK to the current npm `latest` release:

```bash
pnpm update:pi
```

Default dev port from `vite.config.ts`:

- `1618`

### Build

```bash
pnpm build
```

Build output is written to `.output/`.

### Preview the production build

```bash
pnpm preview
```

### Lint

```bash
pnpm lint
```

### Format

```bash
pnpm format
```

### Check

```bash
pnpm check
```

`pnpm check` currently covers formatting, linting, and type checking.

### Check and fix

```bash
pnpm check:fix
```

## Status

Repo snapshot reviewed on 2026-04-30:

- `pnpm check:fix` passing
- legacy parity reference is still `~/code/pi-web-legacy`
- final manual parity sign-off is not recorded in this repo yet

## Notes

- Storage keys use the `phi-*` prefix, including `phi-hide-tools`.
- This repo currently does not include a separate `parity-checklist.md`; use the source layout above plus `~/code/pi-web-legacy` when auditing parity.
