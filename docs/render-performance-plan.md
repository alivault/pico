# Render Performance Refactor Plan

Goal: push the Pi web app toward minimal unnecessary rendering by moving high-churn state out of broad React render paths, narrowing subscriptions, and splitting expensive UI renderers.

## Checklist

- [ ] Composer state stores
  - [ ] Move composer draft/image state to a dedicated external store.
  - [ ] Move pending composer messages/follow-ups to a dedicated external store.
  - [ ] Move submit/awaiting-first-turn state to a dedicated external store.
  - [ ] Feed composer UI from store selectors instead of workspace-owned React state where possible.
- [ ] Ref-based mutation hooks
  - [x] Refactor prompt mutation inputs away from broad render-time values where safe.
  - [x] Refactor session mutation inputs away from broad render-time values where safe.
  - [ ] Keep behavior compatible with draft sessions, pending queues, and optimistic messages.
- [x] Sidebar internals
  - [x] Memoize/split sidebar header, footer, directory groups, and session rows.
  - [x] Avoid rebuilding selection lookup and derived counts in wide render paths where possible.
  - [x] Preserve drag/reorder, collapse, search, and mobile behavior.
- [x] Assistant block-level rendering
  - [x] Split assistant block rendering below the assistant message group.
  - [x] Reuse block descriptors where block identities/signatures are unchanged.
  - [x] Preserve markdown, tool, thinking, and compaction rendering behavior.
- [ ] Command palette command slicing
  - [ ] Move command builder dependencies behind refs/stores where possible.
  - [ ] Keep lazy command construction on palette open.
- [ ] Remaining session-derived slice stores
  - [ ] Identify high-churn `sessionState` reads still performed by `AppShellSessionWorkspace`.
  - [ ] Move safe derived values to selectors/stores or ref-backed hosts.
  - [ ] Keep routing, title, notification, tree/fork, and settings flows intact.

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
- git tab activation
- long streaming assistant response with markdown/tools/thinking
