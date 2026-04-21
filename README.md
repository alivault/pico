# Pi to Go

Native rebuild of `pi-web` in this repo using TanStack Start, Vite+, shadcn/base-ui, Tailwind v4, and TypeScript.

The legacy browser app at `~/code/pi-web` is still the parity reference until manual sign-off is complete.

## Stack

- TanStack Start + TanStack Router
- React 19 + TypeScript
- Vite+ toolchain
- shadcn/base-ui primitives
- Tailwind CSS v4
- Native Pi SDK-backed runtime
- Server-sent events for live session sync

## Current architecture

### Frontend shell

Main feature code lives in `src/features/pi-web`:

- `app-shell.tsx` — top-level shell orchestration, SSE sync, session actions, notifications, header, tabs
- `sidebar.tsx` — directory-grouped session list, search, selection, drag reorder, row menus
- `composer-panel.tsx` — composer UX, slash commands, file/path completions, skill/model/thinking pickers, queue/steer controls
- `conversation-view.tsx` — conversation rendering, markdown/code blocks, thinking/tool/compaction UI
- `app-shell-dialogs.tsx` — add-directory, rename/delete, fork, tree, status, shortcuts, settings, extension dialogs
- `app-shell-command-palette.tsx` — command palette
- `app-shell-shortcuts.ts` — shortcut metadata used by the UI
- `session-done-notifications.ts` — sound and desktop-notification helpers

### Shared client/server contracts

- `src/lib/pi-web.ts` — UI domain types, storage helpers, prompt-draft utilities, shared constants
- `src/lib/pi-web-api.ts` — API request/response types and event payload contracts

### Server/runtime

- `src/routes/api.*.ts` — TanStack Start server routes for prompting, sessions, git, completions, highlighting, settings, and tree actions
- `src/routes/events.ts` — SSE event stream endpoint
- `src/server/pi-web-runtime.ts` — runtime bridge between HTTP routes and the Pi SDK session model
- `src/server/pi-sdk.ts` and related server helpers — SDK integration and backend utility code

### Routing

- `src/routes/index.tsx` — root app route with route-linked `?session=` selection

## Local development

### Install

```bash
pnpm install
```

### Run dev server

```bash
pnpm dev
```

Default dev port from `package.json`:
- `3000`

### Build

```bash
pnpm build
```

### Lint

```bash
pnpm lint
```

### Typecheck

```bash
pnpm typecheck
```

## Parity status

### Implemented

The new app already covers the main legacy `pi-web` feature surface:

- Native shell with sidebar + session view + git tab
- Route-linked session selection via `?session=`
- SSE sync and viewer-context replay
- Prompt submission, abort, steer, and queued follow-up flows
- Session lifecycle routes: new, rename, delete, fork
- Session tree browsing and label APIs
- Model and thinking controls
- Sidebar grouping, search, collapse, reorder, multi-select, and row menus
- Draft persistence by session/file/directory
- Conversation rendering for user, assistant, thinking, tool, and compaction blocks
- Syntax-highlighted markdown code blocks via `/api/highlight`
- Image attachments
- Command palette, shortcuts, status, add-directory, fork, tree, rename/delete, and settings dialogs
- Git status and git changes views
- Toasts plus session-finished sound/desktop notifications

### Reference mapping

See `parity-checklist.md` for the detailed mapping from:

- `~/code/pi-web/static/app.js`
- `~/code/pi-web/static/composer.js`
- `~/code/pi-web/static/messages.js`
- `~/code/pi-web/static/dialogs.js`
- `~/code/pi-web/static/shortcuts.js`
- `~/code/pi-web/static/sidebar.js`
- `~/code/pi-web/static/transport.js`
- `~/code/pi-web/static/state.js`

to the new implementation files in this repo.

## Known gaps

These items are still open before final parity sign-off:

- Mobile/off-canvas drawer behavior still needs a dedicated audit against old `pi-web`
- Full manual parity pass is still pending in zellij session `pi` on port `3142`
- Final cleanup commits/milestones have not been cut yet

## Validation snapshot

Current repo snapshot matches the plan status on 2026-04-20:

- `tsgo_diagnostics` clean
- `pnpm build` passing
- lint passing for touched parity files
- manual parity sign-off still pending

## Notes

- Storage keys intentionally preserve old `pi-web` names where useful, including `pi-web-hide-tools`, to keep user-facing behavior aligned.
- Until manual verification is complete, `~/code/pi-web` remains the UX source of truth for parity decisions.
