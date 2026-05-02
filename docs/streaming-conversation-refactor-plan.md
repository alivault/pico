# Streaming conversation refactor plan

## Goal

Remove the duplicated streaming assistant/tool block reconciliation logic that made
tool rendering easy to break. The server-side retained conversation projection and
the shared client sync path should use one helper for merging partial assistant
updates with already-seen tool lifecycle state.

## Constraints

- Preserve current UI behavior and the existing tool flicker fix.
- Keep `state_sync.items` as the render-ready server projection.
- Do not change SSE payload shapes.
- Keep final committed assistant messages authoritative unless explicitly merging
  in-flight streaming state.

## Steps

1. Extract a shared assistant-block merge helper in `src/lib/phi/sync.ts`.
   - Merge tool blocks by `callId`.
   - Preserve previous tool result/running/render metadata when a newer partial
     message still contains the same tool call.
   - Optionally preserve missing prior tool blocks for partial streaming updates.
   - Optionally preserve same-index non-tool render keys for server retainer use.

2. Rewrite the existing client-side streaming merge path to call the shared
   helper instead of keeping a second private implementation.

3. Rewrite the server conversation retainer to call the same helper.
   - Use missing-tool preservation for streaming `message_start` / `message_update`.
   - Keep final `message_end` merge authoritative for omitted tools.

4. Validate with `pnpm check:fix` after implementation.

5. Delete this plan once the refactor is committed.
