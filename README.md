# Pi

Pi is the TanStack Start rewrite of the legacy `pi-web` browser app. It keeps the same local Pi workflow—directory-organized session browsing, a live conversation shell, tree navigation, session forking, git inspection, and Pi SDK-backed prompt execution—while moving the app to a TypeScript/TanStack/Vite+ stack.

The legacy browser app is no longer in this repo. It now lives at `~/code/pi-web-legacy` and remains the parity reference until manual sign-off is recorded.

## Stack

- TanStack Start + TanStack Router + TanStack Query
- React 19 + TypeScript
- Vite+ + Nitro
- Tailwind CSS v4
- shadcn-style UI components built on Base UI
- Native Pi SDK-backed runtime loaded from the local SDK install
- Server-sent events for live session sync

## Current feature snapshot

### Sidebar and session management

- Directory-grouped sidebar with search, collapse/expand, drag reordering, and off-canvas mobile behavior
- Route-linked session selection via `?session=`
- Session lifecycle actions: new, rename, delete, and fork
- Multi-select sidebar session deletion
- Unread/live badges and title-bar unread counts
- Recent/current/known directory discovery when adding sidebar directories

### Composer

- Prompt drafting with per-session draft persistence
- Image attachments
- Path completions and `@file` reference completions
- Model picker and reasoning/thinking level picker
- Streaming controls: submit, abort, steer, and queued follow-ups
- Pending prompt inspection, removal, and reordering while a response is active
- Slash commands for built-ins like `/compact`, `/delete`, `/fork`, `/tree`, `/rename`, thinking/tool visibility, plus skill shortcuts when skills are available

### Conversation view

- Live SSE-backed session replay/sync
- Markdown rendering with GFM support
- Syntax-highlighted fenced code blocks via `/api/highlight`
- Assistant text, thinking, tool, and compaction block rendering
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

- Git tab for repository status and changed-file summaries for the active session directory
- Native backend git inspection in `src/server/git.ts`

## Project layout

### App shell and UI

Main feature code lives in `src/features/pi-web`:

- `app-shell.tsx` — top-level shell orchestration, SSE sync, mutations, commands, tabs, notifications, and shortcuts
- `sidebar.tsx` — directory/session sidebar UI
- `composer-panel.tsx` — composer, slash commands, completions, model/thinking pickers, and pending prompt controls
- `conversation-view.tsx` — message rendering, markdown/code blocks, tool cards, and compaction UI
- `app-shell-dialogs.tsx` — add-directory, rename/delete, fork, tree, settings, and generic UI request dialogs
- `app-shell-command-palette.tsx` — command palette
- `git-panel.tsx` — git status/changes tab
- `session-done-notifications.ts` — sound and desktop notification helpers

### Shared client/server contracts

- `src/lib/pi-web.ts` — UI domain types, storage helpers, prompt draft utilities, tree flattening helpers, and shared constants
- `src/lib/pi-web-api.ts` — API request/response types and SSE payload contracts

### Routing and providers

- `src/routes/__root.tsx` — root document, CSS, and devtools shell
- `src/routes/index.tsx` — root route and `?session=` wiring
- `src/router.tsx` — router + query integration
- `src/components/app-providers.tsx` — theme, tooltip, and toast providers

### Server/runtime

- `src/routes/events.ts` — SSE event stream endpoint
- `src/routes/api.*.ts` — server endpoints for prompts, sessions, tree actions, git, completions, settings, highlighting, and UI callbacks
- `src/server/pi-web-runtime.ts` — runtime bridge between TanStack Start routes and the Pi SDK session model
- `src/server/pi-sdk.ts` — Pi SDK loading and settings-manager adaptation
- `src/server/git.ts` — git status/change inspection helpers

## Key HTTP/SSE endpoints

- `GET /events`
- `POST /api/prompt`
- `POST /api/abort`
- `POST /api/session/new`
- `POST /api/session/rename`
- `POST /api/session/delete`
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
- `GET /api/directory-sessions`
- `POST /api/directory/resolve`
- `GET /api/git-status`
- `GET /api/git-changes`
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

Default dev port from `vite.config.ts`:

- `3141`

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

Repo snapshot verified on 2026-04-22:

- `pnpm build` passing
- `pnpm check` passing
- legacy parity reference is still `~/code/pi-web-legacy`
- final manual parity sign-off is not recorded in this repo yet

## Notes

- Storage keys intentionally preserve old `pi-web` naming where useful, including `pi-web-hide-tools`.
- This repo currently does not include a separate `parity-checklist.md`; use the source layout above plus `~/code/pi-web-legacy` when auditing parity.
