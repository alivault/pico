# TanStack Store Refactor Checklist

Plan for migrating Phi's client-side external-store state to TanStack Store while preserving current render isolation and session-switch behavior.

## Goals

- Replace bespoke simple external stores with `@tanstack/store` / `@tanstack/react-store`.
- Keep narrow selector-driven rendering and avoid broad `AppShellSessionWorkspace` rerenders.
- Preserve canonical `sessionStateRef` + published session snapshot semantics.
- Preserve specialized keyed subscriptions for high-churn conversation/sidebar rendering unless an equivalent TanStack Store design is proven.
- Use TanStack Store `batch()` for multi-store updates where session switching or SSE currently emits several synchronous notifications.

## Non-goals

- Do not replace TanStack Query server-state flows.
- Do not change API/SSE payload contracts.
- Do not rename persisted storage keys.
- Do not accidentally reintroduce or remove history-window behavior; current UI receives full session history through `state_sync`, while `/api/session/history` remains available but unused by the conversation view.
- Do not merge all app state into one broad global store.

## Reference docs checked

- `tanstack --help`
- `tanstack libraries`
- `tanstack doc store quick-start`
- `tanstack doc store framework/react/quick-start`
- `tanstack doc store framework/react/reference/functions/useSelector`
- `tanstack doc store framework/react/reference/interfaces/UseSelectorOptions`
- `tanstack doc store reference/functions/createStore`
- `tanstack doc store reference/functions/batch`
- `tanstack doc store reference/functions/shallow`

## Phase 0 — Prep

- [ ] Add dependencies:
  - [ ] `@tanstack/store`
  - [ ] `@tanstack/react-store`
- [ ] Confirm package versions in `pnpm-lock.yaml`.
- [ ] Run `pnpm check:fix` with no source changes.
- [ ] Add a small local wrapper module, e.g. `src/features/phi/tanstack-store-utils.ts`, for:
  - [ ] store creation conventions
  - [ ] selector compare helpers
  - [ ] set-state action helper equivalent to `React.SetStateAction<T>`
  - [ ] optional `batch()` re-export
- [ ] Document preferred patterns in this checklist before touching app state.

## Phase 1 — Establish compatibility helpers

- [ ] Implement `applyStoreAction<T>(current, action)` for `React.SetStateAction<T>`-style updates.
- [ ] Implement `setStoreField<T, K extends keyof T>(store, key, action)`.
- [ ] Implement or re-export compare helpers:
  - [ ] `Object.is`
  - [ ] `shallow` from `@tanstack/store`
  - [ ] existing domain comparators where needed (`sameStringArray`, `shallowRecordEqual`, etc.)
- [ ] Decide on naming conventions:
  - [ ] `store.state` / `store.get()` for reads
  - [ ] `store.setState((current) => next)` for writes
  - [ ] `useSelector(store, selector, { compare })` for component reads
- [ ] Verify TanStack Store `subscribe` return shape works with existing imperative uses.

## Phase 2 — Migrate simplest `ValueStore`s

Target stores in `src/features/phi/app-shell.tsx` that do not need keyed subscriptions.

- [ ] `appUiStore`
  - [ ] Replace `createValueStore<AppShellUiState>` with `createStore<AppShellUiState>`.
  - [ ] Replace `useSelectedValueStore(appUiStore, ...)` with `useSelector(..., { compare })`.
  - [ ] Preserve `setCurrentTab`, `setGitPanelOpen`, `setLoadingSessionId`, `setInitialLoadingSessionId` behavior.
  - [ ] Smoke test session/git tab switching.
- [ ] `displaySettingsStore`
  - [ ] Preserve `displaySettingsRef` and `hideToolBlocksRef` updates.
  - [ ] Preserve storage writes for hide-tools/center-messages.
  - [ ] Smoke test settings toggles.
- [ ] `notificationStore`
  - [ ] Preserve session-done event consumption.
  - [ ] Smoke test sound/desktop-notification settings.
- [ ] `draftFlowStore`
  - [ ] Preserve draft-session loading owner behavior.
  - [ ] Smoke test create new draft session.
- [ ] `recentDirectoriesStore`
  - [ ] Preserve storage writes and uniqueness normalization.

## Phase 3 — Migrate small scalar/snapshot stores

- [ ] `awaitingFirstTurnStore`
  - [ ] Preserve mirrored composer snapshot updates.
  - [ ] Preserve working-state side effects.
- [ ] `isSubmittingStore`
  - [ ] Preserve mirrored composer snapshot updates.
- [ ] `workingStateStore`
  - [ ] Use `sameWorkingState` compare in selectors or update guard.
- [ ] `contextUsageStore`
  - [ ] Preserve composer indicator updates.
- [ ] `hiddenThinkingPreviewStore`
  - [ ] Replace `TextValueStore` only if no regressions in streaming hidden-thinking preview.
- [ ] `composerImagesStore`
  - [ ] Preserve `composerImagesRef` synchronization.
- [ ] `pendingDraftPromptStore`
  - [ ] Preserve waiting-for-new-session working state.
- [ ] `pendingDraftFollowUpsStore`
  - [ ] Preserve pending composer message refresh.
- [ ] `pendingMessagesStore`
  - [ ] Preserve pending composer message refresh.

## Phase 4 — Migrate composer snapshot store carefully

The previous maximum-update-depth issue came from unstable empty arrays in composer snapshots. Do not regress this.

- [ ] Keep `EMPTY_COMPOSER_IMAGES` and `EMPTY_COMPOSER_PENDING_MESSAGES`.
- [ ] Keep or port `sameAppShellComposerSnapshot`.
- [ ] Replace `composerStore` with TanStack Store.
- [ ] Use `useSelector(composerStore, (state) => state, { compare: sameAppShellComposerSnapshot })` or ensure updates are guarded before `setState`.
- [ ] Preserve immediate mirrored updates from:
  - [ ] `setComposerDraftSeed`
  - [ ] `setComposerImages`
  - [ ] `setComposerStreaming`
  - [ ] `setAwaitingFirstTurn`
  - [ ] `setIsSubmitting`
  - [ ] `refreshComposerPendingMessages`
- [ ] Batch composer-related multi-store updates where appropriate.
- [ ] Stress test rapid session switching.
- [ ] Stress test queue/steer while streaming.

## Phase 5 — Migrate `sessionStore` without breaking refs

`sessionStore` and `sessionStateRef` are canonical and must remain synchronized.

- [ ] Replace `sessionStore` with TanStack Store only after prior phases are stable.
- [ ] Preserve `setSessionState()` semantics:
  - [ ] compute from `sessionStateRef.current`
  - [ ] update `sessionStateRef.current`
  - [ ] publish to store even when the ref was already mutated if the store is stale
- [ ] Replace all `sessionStore.getSnapshot()` reads with `sessionStore.state` or `sessionStore.get()`.
- [ ] Replace all `sessionStore.setSnapshot(next)` writes with guarded `setState`.
- [ ] Replace all selectors with `useSelector(..., { compare })`.
- [ ] Preserve model/thinking picker updates from `state_sync`.
- [ ] Preserve route-linked selection via `?session=`.
- [ ] Preserve loading state that hides previous message stack while switching sessions.
- [ ] Verify full conversation history is present after session switch.
- [ ] Verify `/api/session/history` remains functional if touched, even though the current UI does not lazy-load older messages.
- [ ] Test session tree/fork dialogs after migration.

## Phase 6 — Revisit sidebar stores

`AppShellSidebarStore` currently caches derived workspace snapshots and exposes custom selectors.

- [ ] Decide whether to keep `AppShellSidebarStore` custom or split into TanStack stores.
- [ ] If migrating:
  - [ ] Create a base sidebar state TanStack Store.
  - [ ] Create derived workspace state via derived store or cached selector.
  - [ ] Preserve `workspaceVersion` behavior or replace all consumers safely.
  - [ ] Preserve equality checks for large derived objects/maps.
  - [ ] Preserve directory index loading and cleanup flows.
- [ ] Keep these specialized stores unless a benchmark/prototype proves parity:
  - [ ] `DirectorySessionsStore`
  - [ ] `SelectedSessionKeyStore`
  - [ ] `ActiveSidebarSessionStore`
  - [ ] `CollapsedDirectoryStore`
- [ ] Stress test sidebar search, directory indexing, multi-select, drag reorder.

## Phase 7 — Revisit conversation/render stores last

These are performance-critical and use keyed subscriptions not directly matched by basic TanStack Store selectors.

- [ ] Do not migrate `conversationItemsStore` in the initial refactor.
- [ ] Do not migrate `AssistantMessagesStore` / `AssistantBlockStore` in the initial refactor.
- [ ] If attempting a later migration, prototype first with:
  - [ ] per-item selectors
  - [ ] assistant group selectors
  - [ ] block-level selectors
  - [ ] stable group descriptor reconciliation
  - [ ] streaming batched updates
- [ ] Compare render counts before/after with long streaming markdown and many tool calls.
- [ ] Preserve deferred syntax highlighting behavior.
- [ ] Preserve full-history rendering behavior, or deliberately design/test a lazy-history reintroduction.

## Phase 8 — Batch high-churn update paths

Use `batch()` only where multiple TanStack stores update synchronously and subscribers can safely observe only the final state.

- [ ] SSE `state_sync` handling in `use-app-shell-session-sync.ts`.
- [ ] Session selection/session switch setup.
- [ ] Create draft session optimistic flow.
- [ ] Submit prompt optimistic flow.
- [ ] Abort/session-done cleanup flow.
- [ ] Settings changes that update storage + multiple stores.
- [ ] Verify batching does not hide required intermediate loading states.

## Phase 9 — Remove old infrastructure

- [ ] Remove `ValueStore<T>` type if no longer used.
- [ ] Remove `createValueStore` if no longer used.
- [ ] Remove `useValueStore` if no longer used.
- [ ] Remove `useSelectedValueStore` if no longer used.
- [ ] Remove `setValueStoreField` if replaced.
- [ ] Remove obsolete selector caches after all consumers use `useSelector`.
- [ ] Keep domain equality helpers that are still needed by TanStack selector `compare` options.

## Validation checklist per phase

Run after each phase:

- [ ] `pnpm check:fix`
- [ ] App boots on port `1618`.
- [ ] Select existing session from sidebar.
- [ ] Rapidly switch between multiple sessions.
- [ ] Switch from a long session to an empty/draft session.
- [ ] Submit a prompt.
- [ ] Queue/steer while streaming.
- [ ] Abort while streaming.
- [ ] Toggle hide thinking/tools.
- [ ] Open model/thinking pickers and verify values are populated.
- [ ] Open sessions dialog.
- [ ] Rename/delete a session.
- [ ] Open tree dialog and navigate/fork.
- [ ] Open git tab and verify status/files/branches load only when expected.
- [ ] Reload page and verify persisted settings/directories/drafts.

## Regression watchlist

- [ ] Maximum update depth exceeded during session switch.
- [ ] `useSyncExternalStore` / selector snapshots returning fresh objects every render.
- [ ] Composer disabled state creating fresh empty arrays.
- [ ] `sessionStateRef.current` updated without publishing store state.
- [ ] Store state published without updating refs used by imperative handlers.
- [ ] Broad rerenders of `AppShellSessionWorkspace`.
- [ ] Previous session messages visible during loading.
- [ ] Empty model/thinking pickers after `state_sync`.
- [ ] Sidebar active/selected row not updating.
- [ ] Streaming assistant messages lagging or rerendering too broadly.

## Suggested commit structure

- [ ] Commit 1: add dependencies and helper wrappers.
- [ ] Commit 2: migrate app/display/notification/draft simple stores.
- [ ] Commit 3: migrate scalar auxiliary stores.
- [ ] Commit 4: migrate composer snapshot store with equality safeguards.
- [ ] Commit 5: migrate session store.
- [ ] Commit 6: optional sidebar base store migration.
- [ ] Commit 7: cleanup old store helpers.

## Decision log

- [ ] Decide whether TanStack Store v0 stability is acceptable for all client stores.
- [ ] Decide whether specialized conversation/sidebar keyed stores remain custom permanently.
- [ ] Decide whether to centralize all TanStack Store helpers under `src/features/phi/` or `src/lib/`.
- [ ] Decide whether to add render-count/debug instrumentation before Phase 7.
