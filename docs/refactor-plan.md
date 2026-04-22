# Refactor plan

This is the working plan for breaking up the biggest modules in `pi-web` without changing behavior.

## Goals

- Reduce file size and responsibility count in the largest feature files.
- Preserve current behavior while moving code behind clearer boundaries.
- Keep each refactor small enough to validate with `pnpm check`.

## Current hotspots

- `src/features/pi-web/app-shell.tsx`
- `src/server/pi-web-runtime.ts`
- `src/features/pi-web/app-shell-dialogs.tsx`
- `src/features/pi-web/composer-panel.tsx`
- `src/lib/pi-web.ts`

## To-do

- [x] Audit the largest files and identify split points.
- [x] Break up `src/features/pi-web/app-shell-dialogs.tsx`.
  - [x] Extract add-directory dialog.
  - [x] Extract rename/delete/fork dialogs.
  - [x] Extract settings dialog.
  - [x] Extract generic UI request dialog.
  - [x] Extract tree dialog and its helpers.
- [x] Break up `src/features/pi-web/composer-panel.tsx`.
  - [x] Extract context usage indicator.
  - [x] Extract pending queue UI.
  - [x] Extract picker UI for model/thinking.
  - [x] Extract completion/slash-command state into hooks/helpers.
- [ ] Break up `src/lib/pi-web.ts`.
  - [ ] Move storage keys and storage helpers into a storage-focused module.
  - [ ] Move tree flatten/filter helpers into a tree-focused module.
  - [ ] Move sync/message normalization helpers into a sync-focused module.
- [ ] Break up `src/features/pi-web/app-shell.tsx`.
  - [ ] Extract SSE/session sync behavior into hooks.
  - [ ] Extract prompt/session mutations into hooks.
  - [ ] Extract keyboard shortcut handling into hooks.
  - [ ] Extract scroll/jump behavior into hooks.
- [ ] Break up `src/server/pi-web-runtime.ts`.
  - [ ] Extract SSE/context coordination.
  - [ ] Extract tree/fork behavior.
  - [ ] Extract UI request handling.
  - [ ] Extract highlight helpers.
  - [ ] Extract session list/index helpers.

## Suggested order

1. `app-shell-dialogs.tsx`
2. `composer-panel.tsx`
3. `lib/pi-web.ts`
4. `app-shell.tsx`
5. `server/pi-web-runtime.ts`
