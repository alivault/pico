# Pi to Go parity plan

Goal: rebuild `pi-web` natively in this repo with **TanStack Start + Vite+ + shadcn/base-ui + Tailwind v4 + TypeScript**, using `~/code/pi-web` as the reference source until the new app reaches user-facing feature parity.

## Reference source of truth

When auditing parity, compare against these old `pi-web` modules first:

- `~/code/pi-web/static/app.js` — shell orchestration, session switching, top-level UX
- `~/code/pi-web/static/composer.js` — composer behavior, slash commands, completions, model/reasoning pickers
- `~/code/pi-web/static/messages.js` — conversation rendering, loading/draft states, scroll controls, tool visibility
- `~/code/pi-web/static/dialogs.js` — command palette, settings, shortcuts, add-directory, fork, tree dialogs
- `~/code/pi-web/static/shortcuts.js` — keyboard behavior and list navigation
- `~/code/pi-web/static/sidebar.js` — viewport/sidebar layout behavior
- `~/code/pi-web/static/transport.js` — SSE/request plumbing expectations
- `~/code/pi-web/static/state.js` — persisted UI state and draft behavior

## Current snapshot — 2026-04-20

### Validation state

- [x] `tsgo_diagnostics` is clean
- [x] `pnpm build` passes
- [x] Lint passes for touched parity files
- [ ] `pnpm test` exits cleanly without the existing Vite/Vitest shutdown warning
- [ ] End-to-end manual parity pass in zellij session `pi` on port `3142`

### What is already working in the new TanStack app

#### Core architecture

- [x] Native TanStack Start shell is in place
- [x] Shared TypeScript domain types and API contracts exist
- [x] Native Pi SDK-backed session runtime is in place
- [x] SSE `/events` streaming with viewer-context replay/sync is wired
- [x] Route-linked session selection via `?session=` works

#### Backend parity already landed

- [x] Prompt submission
- [x] Abort
- [x] Queued follow-up / steer request plumbing
- [x] Session lifecycle routes: new, rename, delete, fork
- [x] Session tree load / navigate / label APIs
- [x] Model and thinking routes
- [x] Extension UI request bridge
- [x] Git status and git changes APIs
- [x] Directory resolve and directory session index APIs
- [x] Path/file completion APIs are available
- [x] Highlight API is available

#### Frontend parity already landed

- [x] Main shell layout with sidebar + main session area + git tab
- [x] shadcn `SidebarProvider` / `SidebarInset` shell integration
- [x] Session sidebar grouping by directory
- [x] Sidebar search
- [x] Sidebar collapse / expand per directory
- [x] Collapse-all / expand-all sidebar control
- [x] Sidebar multi-select and bulk delete affordances
- [x] Draft prompt persistence by session/file/directory
- [x] Conversation rendering for user text + images
- [x] Conversation rendering for assistant text, thinking, tool, and compaction blocks
- [x] Composer image attachments
- [x] Queue / steer controls while streaming
- [x] Git panel
- [x] Command palette dialog
- [x] Shortcuts dialog
- [x] Status dialog
- [x] Add-directory dialog
- [x] Fork dialog
- [x] Tree dialog
- [x] Rename/delete dialogs
- [x] Settings dialog for theme + session-finished notifications
- [x] Sonner toasts for errors / completion / confirmations

## Remaining work to reach old `pi-web` feature parity

### 1) Composer parity — highest priority

Reference: `static/composer.js`

- [x] Replace the current basic textarea workflow with full composer parity
- [x] Restore slash-command suggestion menu behavior
- [x] Restore `@` / file / path completion UX using the existing completion APIs
- [x] Restore skill pill / skill selection / skill clear behavior
- [x] Replace simple model/thinking `<select>` controls with searchable picker/popover parity
- [x] Match old keyboard behavior for composer actions:
  - [x] Cmd/Ctrl+Enter send / steer
  - [x] Alt+Cmd/Ctrl+Enter queue follow-up
  - [x] Up/Down and Ctrl+J/K completion navigation
  - [x] Enter / Tab completion acceptance rules
- [x] Restore pending draft prompt + pending draft follow-up handoff behavior when creating a fresh draft session
- [x] Restore working indicator parity for slash commands, compaction, first-turn, and waiting states
- [x] Add hide/show tool calls UI and persist it via `pi-web-hide-tools`

### 2) Session view and message parity

Reference: `static/messages.js`

- [x] Use the existing `/api/highlight` endpoint for syntax-highlighted code blocks
- [x] Restore draft-session state card parity for fresh drafts (directory + git summary)
- [x] Restore loading-state presentation parity while switching/loading sessions
- [x] Restore scroll affordances:
  - [x] scroll-to-bottom button
  - [x] jump-to-last-message button
- [x] Respect hidden tool-block state in conversation rendering
- [ ] Audit assistant/tool/thinking/compaction block styling against old `pi-web` and close remaining visual gaps
- [ ] Match old streaming/working-state polish where still missing

### 3) Sidebar and navigation parity

Reference: `static/app.js`, `static/sidebar.js`, `static/shortcuts.js`

- [ ] Restore keyboard navigation parity for the sidebar session list
- [ ] Restore keyboard navigation parity for list-style dialogs and pickers
- [ ] Add per-session row action menu parity inside the sidebar
- [ ] Add directory action menu parity inside the sidebar
- [ ] Restore directory drag-reorder / sidebar ordering behavior
- [ ] Restore session-scope / draft-directory selection UX for “new session in …” flows
- [ ] Audit mobile drawer behavior against the old app and close gaps
- [ ] Revisit sidebar search/index-loading behavior if full-index loading diverges too much from old search coverage behavior

### 4) Dialog and command palette parity

Reference: `static/dialogs.js`

- [x] Expand command palette to the full old action set
  - [x] toggle tools
  - [x] cycle reasoning level
  - [x] parity wording / search terms for existing commands
  - [x] selection-aware actions when sidebar multi-select exists
- [ ] Rebuild add-directory dialog parity
  - [ ] searchable results
  - [ ] recent directories
  - [ ] known directories
  - [ ] keyboard navigation / first-result open behavior
- [ ] Rebuild fork dialog parity
  - [ ] filter/search fork points
  - [ ] keyboard navigation
- [ ] Upgrade the tree dialog from MVP to old-browser parity
  - [ ] tree-specific shortcuts/help
  - [ ] branch expand/collapse keyboard controls
  - [ ] filter presets / filter cycling
  - [ ] continue-with-summary options
  - [ ] custom summary instructions
  - [ ] label timestamp toggle
  - [ ] richer status/footer state

### 5) Header, settings, and shell controls parity

Reference: `static/app.js`, `static/dialogs.js`, `static/composer.js`

- [x] Restore the old header session-actions menu parity
  - [x] new session
  - [x] toggle thinking
  - [x] toggle tools
  - [x] rename/delete current session
- [x] Extend settings parity beyond theme + notifications
  - [x] tool visibility toggle
  - [x] any remaining shell/composer toggles that still exist in old `pi-web`
- [x] Align shortcuts dialog with the actual final shortcut map once parity behavior ships
- [ ] Audit document title / completion notifications / unread-finished behavior against old `pi-web`

### 6) Verification, docs, and sign-off

- [ ] Create a parity checklist that maps each old module to its new implementation or explicit removal
- [ ] Manually verify every checklist item in zellij session `pi` on port `3142`
- [ ] Update `README.md` with:
  - [ ] current architecture
  - [ ] local dev / build commands
  - [ ] parity status
  - [ ] known gaps
- [ ] Document or fix the existing Vitest shutdown warning
- [ ] Cut commits in clean milestones once each remaining parity slice lands

## Suggested implementation order

1. Composer parity
2. Message/session-view parity
3. Tool visibility + header/settings parity
4. Sidebar keyboard/menu/reorder parity
5. Add-directory / fork / tree dialog parity
6. Verification checklist + README + cleanup

## Definition of done

Pi to Go is only considered parity-complete when:

- [ ] Every user-visible feature from old `pi-web/static/*.js` is either implemented in this TanStack app or intentionally removed with documentation
- [ ] Build, lint, and `tsgo_diagnostics` are clean
- [ ] Manual parity checklist passes in the zellij `pi` session on port `3142`
- [ ] README reflects the new architecture and final feature set
