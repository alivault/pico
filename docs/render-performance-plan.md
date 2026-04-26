# Render Performance Refactor Plan

Goal: continue reducing broad app-shell rerenders by making external stores/controllers the primary state architecture, then target the remaining expensive UI render paths based on stable subscriptions.

The previous render performance checklist was completed. This file now tracks the next phase.

## Checklist

- [x] Remove the `sessionState` React state mirror
  - [x] Make `sessionStore` + `sessionStateRef` the source of truth for session data.
  - [x] Replace remaining workspace render reads of `sessionState` with store selectors or refs.
  - [x] Ensure SSE sync, optimistic messages, draft sessions, and route loading still publish to narrow stores.
  - [x] Preserve session selection, title, notification, tree/fork, rename/delete, and composer behavior.
- [x] Move remaining workspace UI state to stores
  - [x] Move `currentTab`, route/session loading ids, and initial loading state to an app UI store.
  - [x] Move display settings such as tool visibility and message centering to a display settings store.
  - [x] Move notification settings/permission and session-done events to a notification store.
  - [x] Move draft-session loading owner state to a loading/draft flow store.
- [ ] Extract app-shell controller/actions
  - [ ] Centralize refs, stores, mutation actions, and imperative flows in an app-shell controller object.
  - [ ] Keep React components as selector-driven hosts instead of orchestration owners.
  - [ ] Keep prompt/session mutation hooks ref/store-backed with minimal render dependencies.
- [x] Directory-keyed sidebar subscriptions
  - [x] Store directory loading/session slices by directory key.
  - [x] Let each directory row subscribe only to its own sessions/loading/collapse state.
  - [x] Preserve search, drag/reorder, selection, collapse, and mobile sidebar behavior.
- [x] Assistant block store
  - [x] Add assistant block descriptors keyed by block key/signature.
  - [x] Let assistant block views subscribe to individual block snapshots where possible.
  - [x] Preserve text, thinking, tool, explore-group, and compaction rendering.
- [x] Markdown streaming optimization
  - [x] Profile streaming markdown cost before changing UX.
  - [x] Consider plain-text/high-frequency streaming fallback with markdown render after idle.
  - [x] Keep code highlighting/cache behavior intact.
- [x] Git panel active-section splitting
  - [x] Split active git UI into lazy/section-specific render and query boundaries.
  - [x] Avoid mounting expensive git sections until they are visible or requested.

## Validation

Run after each substantial step:

```bash
pnpm check:fix
```

Manual smoke areas:

- create/select sessions
- submit prompt, queue/steer/abort
- sidebar search/select/multi-select/reorder/collapse
- tree/fork/rename/delete/settings dialogs
- git tab activation and refresh
- long streaming assistant response with markdown/tools/thinking
