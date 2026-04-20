# Pi to Go rewrite plan

Goal: rebuild `pi-web` natively in this repo with **TanStack Start + Vite+ + shadcn/base-ui + Tailwind v4 + TypeScript**, using `~/code/pi-web` only as a reference source during the rewrite.

## Phase 1 — reset the direction

- [x] Remove vendored legacy `pi-web` files and runtime shims from this repo
- [x] Replace the embedded legacy shell with a native React/TanStack Start app shell
- [x] Add a focused rewrite plan and keep it updated as work lands
- [x] Commit the cleanup baseline

## Phase 2 — shared foundations

- [ ] Keep and expand shared TS domain/types for sessions, messages, directories, tree data, and UI state
- [x] Port reusable server helpers to TypeScript (SDK loading, session naming, JSON/response helpers, filesystem/git helpers)
- [ ] Define the browser/server contract for SSE events and API payloads in TS
- [ ] Commit the shared foundations

## Phase 3 — backend rewrite

- [ ] Rebuild the session runtime in TypeScript around the Pi SDK
- [ ] Implement `/events` with viewer-context replay/sync behavior
- [x] Implement prompt + abort + queued/steered follow-up flows
- [x] Implement session lifecycle routes: new, rename, delete, fork, tree, tree label
- [x] Implement model/thinking/settings/UI bridge routes
- [x] Implement supporting routes: highlight, directory resolve, path/file completions, git status, git changes, directory session indexes
- [ ] Commit backend milestones incrementally

## Phase 4 — frontend rewrite

- [ ] Build the main app shell with responsive sidebar, top bar, session view, git view, and composer
- [ ] Connect route search state (`?session=`) and persistent viewer context
- [ ] Render conversation items: user text/images, assistant text, thinking, tools, compaction summaries
- [ ] Implement session sidebar grouping, search, collapse, multi-select affordances, and draft handling
- [ ] Implement composer flows: slash menu, images, queue/steer, model picker, thinking picker
- [x] Use Sonner for all toast notifications (session done, errors, confirmations that should toast)
- [ ] Implement dialogs: add directory, command palette, shortcuts, tree, fork, rename, delete, settings, status, extension UI requests
- [ ] Commit frontend milestones incrementally

## Phase 5 — verification

- [x] Run `vp check --fix`
- [x] Run `vp build`
- [x] Manually verify in zellij session `pi` on port `3142`
- [ ] Update docs/readme as the rewrite stabilizes

## Progress log

- 2026-04-20: Added this rewrite plan and reset scope away from embedding the legacy app.
- 2026-04-20: Locked toast direction to Sonner for the rewrite.
- 2026-04-20: Removed vendored legacy runtime/assets, replaced the home route with a native TanStack Start shell, and ported initial TS server helpers plus git/path endpoints.
- 2026-04-20: Verified the rewritten shell and initial native endpoints in zellij on `localhost:3142`.
- 2026-04-20: Committed the cleanup reset as `feat: reset to native tanstack rewrite baseline`.
- 2026-04-20: Added shared API response types and a live workspace preview in the native shell using the new git/path endpoints.
- 2026-04-20: Replaced the proxy stubs with a native TypeScript session backend covering `/events`, prompt/abort, session lifecycle, tree, model/thinking, highlight, path completion, git, and extension UI request plumbing.
