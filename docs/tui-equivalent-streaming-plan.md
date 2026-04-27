# TUI-equivalent streaming conversation rendering plan

## Goal

Make the browser conversation renderer behave like the TUI for live assistant turns:

- keep one retained assistant render identity for a streaming turn
- keep one retained tool render identity per tool call
- update retained blocks in place from lifecycle events instead of rebuilding from overlapping `messages` + `streamingMessage` snapshots
- send already-normalized conversation items to the client so React receives minimal stable updates

## Current root cause

The web client currently reconstructs visible items from state-sync snapshots. During active turns, the runtime can expose the same tool through both committed `messages` and `streamingMessage`. Because those snapshots are not lifecycle events, the client has to guess how to dedupe partial/overlapping data. This causes transient duplicate or disappearing tool cards that clean up only when streaming ends.

The TUI avoids this by retaining mutable state:

- `message_start` creates the assistant component
- `message_update` updates that same component
- `tool_execution_start/update/end` updates `pendingTools[toolCallId]`
- `message_end` finalizes the same component

## Implementation checklist

- [x] Add a retained conversation model on the server side.
  - [x] Initialize retained items from persisted session messages.
  - [x] Process `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, and `agent_end`.
  - [x] Preserve `renderKey` across streaming-to-finalized transitions.
  - [x] Preserve tool block `renderKey` and update blocks by `toolCallId`.
- [x] Make `state_sync` prefer retained `items` over raw `messages` for the active session.
  - [x] Keep history metadata and history endpoint unchanged.
  - [x] Stop emitting `streamingMessage` for active retained item rendering unless needed for legacy fallback.
- [ ] Simplify client-side streaming/tool reconciliation.
  - [ ] Keep generic item reconciliation and render-key preservation.
  - [ ] Remove defensive snapshot-overlap dedupe that becomes redundant.
- [ ] Validate.
  - [ ] Run `pnpm check:fix`.
  - [ ] Manually smoke-test a streaming session with repeated shell/edit tools.

## Commit strategy

Commit after each stable stage:

1. plan document
2. server retained conversation model
3. runtime state-sync integration
4. client cleanup/validation
