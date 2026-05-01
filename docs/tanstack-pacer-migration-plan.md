# TanStack Pacer migration plan

TanStack Pacer is beta, so this migration should be incremental and easy to
revert. Prefer core `@tanstack/pacer` utilities unless a React hook materially
simplifies a component.

Docs consulted:

- `tanstack doc pacer overview`
- `tanstack doc pacer guides/which-pacer-utility-should-i-choose`
- `tanstack doc pacer reference/classes/Batcher`
- `tanstack doc pacer reference/classes/Debouncer`
- `tanstack doc pacer reference/classes/Throttler`
- `tanstack doc pacer reference/functions/asyncDebounce`

## Checklist

- [x] Create a feature branch for the migration.
- [x] Add `@tanstack/pacer` as an app dependency.
- [x] Introduce small Phi-named Pacer helpers for common high-churn patterns.
- [x] Replace streaming conversation `requestAnimationFrame` item coalescing with
      a named Pacer throttler.
- [x] Debounce server-side git watch bursts with a Pacer debouncer.
- [x] Batch/throttle client git refresh invalidations from SSE `git_changed`
      bursts.
- [x] Debounce path/file completion requests while preserving stale-result
      guards.
- [x] Throttle context usage store publications during streaming bursts.
- [x] Audit sidebar directory indexing/search for custom debounce/throttle/queue
      code and migrate suitable pieces.
- [x] Run `pnpm check:fix`.
- [ ] Smoke test: streaming prompt, path/file completions, git tab refresh, and
      sidebar session dialog.

## Sidebar directory indexing/search audit

Files audited:

- `src/features/phi/app-shell.tsx`
- `src/features/phi/sidebar.tsx`
- `src/features/phi/app-shell-sessions-dialog.tsx`
- `src/server/phi-runtime/index.ts`
- `src/routes/api.directory-sessions*.ts`

Findings:

- Sidebar indexing already batches each missing/refresh directory set into one
  `/api/directory-sessions-indexes` request. The request-id maps in
  `app-shell.tsx` are stale-response guards, not an execution queue, so Pacer
  would not simplify them without adding indirection.
- Sidebar revision refresh is event-driven from `sessions` SSE payloads. It skips
  refreshes while the active sidebar session is streaming and coalesces the
  current `directoriesToRefresh` set before fetching. No ad hoc debounce or
  throttle was found in that path.
- The persistent inline sidebar search input has been removed. `sessionSearch`
  remains in sidebar state for legacy/derived filtering, but the visible search
  affordance opens `AppShellSessionsDialog`; there is no high-churn sidebar
  input handler to debounce.
- `AppShellSessionsDialog` search is local `Command` filtering over already
  loaded session arrays. It fetches missing directory indexes once per dialog
  scope, not per keystroke, so Pacer would not reduce network churn there.
- The `setTimeout` usages in `sidebar.tsx` are UI timers: spinner delay and
  relative-time label refresh. They are not directory indexing/search churn and
  are better left as explicit timers.
- Server-side directory index collection uses `Promise.all` across requested
  directories and no custom queue/debounce/throttle. It is request-scoped and
  does not need Pacer for the current UI flow.

Audit conclusion: no additional sidebar directory indexing/search migration is
recommended in this branch. A future change that reintroduces live sidebar
search or hover/prefetch indexing should use a named `Debouncer`/`Batcher` at the
new call site.

## Utility mapping

- SSE event bursts: `Batcher` for keyed fan-in where order does not matter;
  direct handling remains for state-sensitive events.
- Streaming conversation updates: `Throttler`, applying the latest item snapshot
  at frame-like intervals while streaming continues.
- Sidebar directory indexing/search: `Debouncer` for search-like input and
  `Batcher` for bulk index prefetches if reintroduced.
- Git refresh invalidations: `Batcher` keyed by `cwd + scopes` to collapse
  duplicate invalidations.
- Path/file completions: `AsyncDebouncer`/`asyncDebounce` with existing request
  ids as stale-result guards.
- Context usage refreshes: `Throttler` with leading/trailing publication so the
  UI gets an immediate update and a final settled update.
