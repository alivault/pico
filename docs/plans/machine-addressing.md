# Plan: Address machines explicitly in the web client

Status: implemented in four commits (`46cb0ff`, `d5fa1bb`, `f516ae9`, and this note). See "Implementation notes" at the end for the differences from this plan.

## Problem

The web client treats the machine as an ambient global. `pageMachineId` in `lib/pico/machine.ts` is a module variable, and these parts read it implicitly:

- `apiUrl(path, machineId = pageMachineId)` adds `/m/<id>/` to each request. `fetchJson`, `buildRequestUrl`, the `/events` EventSource, and the terminal WebSocket all go through it.
- `machineStorageKey` adds `@<id>` to the keys in `MACHINE_SCOPED_KEYS`.
- `offline-prompt-queue.ts` selects its IndexedDB by `activeMachineId()`.
- `machine-store.ts` sets the global offline flag (`setActiveMachineOffline`) for the active machine only.

Query keys, session IDs, directory paths, and in-memory stores do not hold a machine ID. A path such as `/Users/Ali/code/pico` can exist on two machines. To prevent mixed data, the route gives each machine its own `QueryClient` and mounts a new `PicoAppShell` (`key={machine}`) at each switch. `fetchJson` uses a machine epoch to stop a request that started for the old machine: it never settles.

Results:

1. A switch loses all in-memory UI state: composer text and images, pending follow-ups, scroll position, open dialogs, and the right sidebar.
2. Actions across machines need a handoff: `openMachine(id, { action })` stores a `pendingAction`, and the new shell runs it on mount (`takePendingMachineAction`).
3. Only the active machine has a live `/events` stream. The sidebar shows other machines from hub summaries.
4. Features that cross machines (a machine choice in the new-session composer, a live sidebar for all machines) inherit these problems.

## Goal

Use Herdr's model: each item has a machine in its address. The client keeps one shell and one connection object for each machine. A switch changes only which session the page shows.

Non-goals:

- No server change is necessary. The hub proxy already addresses machines explicitly (`/m/<id>/api/...`, `/m/<id>/events`, terminal WebSocket). The offline cache stays as it is.
- No change to the storage format. Existing local storage and IndexedDB data must stay readable without a migration.

## Target design

### `MachineClient`

One object for each machine, from a registry (`lib/pico/machine-client.ts`):

```ts
type MachineClient = {
  id: string // "local" or "m_..."
  url(path: string): string // apiUrl without a default
  fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T>
  requestUrl(path: string, options: RequestUrlOptions): string
  storageKey(key: string): string // same format as machineStorageKey today
  offline(): string | undefined // label when offline
}

function machineClient(machineId: string): MachineClient
```

- `fetchJson` checks the offline state of its own machine, not of the page.
- No epoch check. A late response for machine A goes into machine A's cache, so it cannot harm the view of machine B. Callers that must stop use an `AbortSignal`.
- React code gets the client from a `MachineProvider` context (`useMachineClient()`). Non-React code gets it as an argument.

### Keys

- Session identity: `SessionRef = { machineId, sessionId }`, with a string form `sessionKey(ref)`. For the local machine, the string form is the plain session ID, so that pinned sessions, drafts, and unread state stay readable.
- Query keys: `["pico", machineId, ...]`. Put all keys in `picoQueryKeys`. There are inline keys today in `profiles.tsx`, `app-shell-auth-dialog.tsx`, `agent-settings-dialog.tsx`, `preview.tsx`, `agent/shared.tsx`, `app-shell.tsx`, and `use-app-shell-session-mutations.ts`.
- Storage: `client.storageKey(key)` gives the same strings as `machineStorageKey` today (plain for local, `key@<id>` for remote).

### Connections

A `MachineConnection` for each machine owns its `/events` EventSource, its last event ID, and its reconnect logic. It sends events to stores keyed by machine. Its lifetime does not depend on the shell. At first, only the shown machine has an open connection, as today. Phase 5 can keep more open.

### Shell

There is one `PicoAppShell`, with no `key={machine}`. The URL (`?machine=&session=`) selects the shown `SessionRef`. Per-machine state (session store, conversation, sidebar data, right sidebar data, terminals) is in stores keyed by machine. Window-level state (layout, dialogs, display settings, composer drafts keyed by `SessionRef`) is global.

## Phases

Each phase can ship alone. Until phase 4, the shell still remounts at each switch, so the behavior does not change and the risk stays low.

### Phase 0: Inventory and guard rails

- List all readers of the ambient machine: `activeMachineId()`, `apiUrl` without a second argument, `apiInput`, `machineStorageKey`, `activeMachineOffline`, `assertMachineWritable`, `currentMachineEpoch`, `onMachineSwitch`, `onBeforeMachineSwitch`. Today, this is 96 `fetchJson`/`buildRequestUrl` call sites, about 100 `queryKey` sites, and 72 storage reads and writes.
- Add a lint rule (`no-restricted-imports` or a grep check in `pnpm check`) that lists the ambient functions. New code must not use them. Remove the functions from the list as the phases replace them.

### Phase 1: Explicit machine in requests

- Add `MachineClient` and `MachineProvider`. The route provides the client of the shown machine.
- Change `fetchJson`, `buildRequestUrl`, and `terminalWebSocketUrl` to take a client, or make them methods of the client. Make the machine argument required, so that the type checker finds each call site.
- Pass the client to the hooks that make requests: `use-app-shell-session-mutations.ts`, `use-app-shell-prompt-mutations.ts`, `use-app-shell-session-sync.ts`, the right-sidebar git and file modules, `terminal-panel.tsx`, `agent/*`, and the dialogs.
- Hub-only paths (`/api/highlight`, `/api/push/`, `/api/machines`) use a separate `hubFetch`, so they cannot go to a machine by mistake.
- Keep the epoch check in this phase. Phase 4 removes it.

Done when: no call site uses `apiUrl` or `apiInput` without a machine.

### Phase 2: Machine in keys and storage

- Add `machineId` to all `picoQueryKeys` and move the inline keys into it.
- Use one shared `QueryClient` for all machines, and remove `queryClientForMachine`. With machine IDs in the keys, the shared cache keeps the data of each machine apart, and a switch back still shows cached data at once.
- Replace `machineStorageKey` with `client.storageKey`. Keep the string format.
- `offline-prompt-queue.ts` takes the machine as an argument. The database names stay the same.
- Add `SessionRef` and `sessionKey`. Use them in pinned sessions, prompt drafts, unread state, and `rememberedToolCollapsibleOpenKeys` (`conversation-view.tsx`).

Done when: `activeMachineId()` has no readers outside the route and the code that selects the view.

### Phase 3: Connections out of the shell

- Move the EventSource lifecycle out of `use-app-shell-session-sync.ts` into `MachineConnection`. The hook subscribes to the connection of the shown machine. Keep the event-handling code. Only its owner changes.
- `machine-store.ts` gives the offline state for each machine (`machineOffline(id)`). Remove `setActiveMachineOffline`.
- Change `sidebar-sync.ts` from module singletons (`started`, `lastRevision`, `dirty`, `generation`, and the rest) to one instance for each machine. Remove `onBeforeMachineSwitch`.
- Terminals: keep one WebSocket for each terminal of each machine. A terminal of a machine that is not shown can stay open or close. Start with close (as today) and keep the tabs in storage.

Done when: nothing calls `onMachineSwitch` or `onBeforeMachineSwitch`.

### Phase 4: One shell

- Move the per-machine stores that `PicoAppShell` creates in refs (`sessionStore`, `rightSidebarStore`, `awaitingFirstTurnStore`, `pendingMessagesStore`, `pendingDraftPromptStore`, `sidebarStore`, and others) into a `MachineWorkspace` record keyed by machine. Make the window-level stores (`appUiStore`, `displaySettingsStore`, composer draft stores keyed by `SessionRef`) global.
- Remove `key={machine}` from the route. A machine switch is now a view change, like a session switch.
- Remove `setPageMachine`, the machine epoch, the never-settle branch in `fetchJson`, `pendingAction`, `takePendingMachineAction`, and `openMachine`'s handoff. `openMachine(id, { sessionId })` becomes a navigation. "New session in a directory of machine X" becomes a direct call to `createSession({ machineId, directory })`.
- Show other machines in the sidebar with the same components as the shown machine, fed by summaries until phase 5.

Done when: a switch keeps the composer text, the right sidebar, and the scroll position of each machine; and the shell does not remount.

`app-shell.tsx` (3834 lines) has the most risk in this phase. Do it in small commits, one store at a time, before the step that removes the `key`.

### Phase 5: Features that this unlocks

- **Machine choice in the new-session composer.** Group the directory picker by machine (only when `useHasMachineGroups()`). Disable offline machines. The draft is keyed by `SessionRef`, so it stays when the user changes the machine.
- **Live sidebar for all machines.** Two options:
  1. Open a `MachineConnection` to each online machine, with a light sidebar-only subscription. This is simple, but it gives N streams through the hub.
  2. The hub already reads each remote `/events` stream for `machine_summary` (`machines/manager.ts`). Add more detail to the summary, or add one hub stream that multiplexes sidebar events for all machines.

  Start with option 2: one stream from the browser. Use it for unread state, working state, and titles.

- **Actions across machines** with no handoff: move a session to another machine's directory, open a child session on another machine from `spawn_session` results.

## Risks

- **Data on the wrong machine.** A store or key that does not have a machine ID can mix data after phase 4 removes the remount. The phase 0 lint list and the "done when" checks find most of these cases. Add a test that opens two machines with the same directory path and the same session ID, and makes sure that their data stays apart.
- **Memory.** One shell that keeps several workspaces holds more data. Remove the workspace of a machine that has not been shown for some time, and keep only its query cache.
- **Offline writes.** Today, a page for an offline machine is read-only because of a global flag. After phase 3, each write checks its own machine. Test a switch from an offline machine to an online machine and back while a prompt waits in the offline queue.
- **Event replay.** The last event ID moves from the shell to the connection. Make sure that a reconnect after a switch does not replay or drop events.

## Tests

- Unit tests for `MachineClient.url`, `storageKey` (same strings as today), and `sessionKey`.
- Server tests already cover the proxy. Add an end-to-end check with the local machine and one fake remote machine (the hub tests can start a second server): switch machines and back, and check that the draft is kept and that no request goes to the wrong `/m/<id>/` prefix.

## Implementation notes

The goal is the same as above: the client has no "current machine" global, each request and storage key names its machine, and a machine switch does not remount or lose state. Three parts differ from the plan.

### One shell for each machine, kept alive (phase 4)

The plan moved about twenty stores of `PicoAppShell` into records keyed by machine, with one shell for all machines. The implementation keeps one `PicoAppShell` for each machine that the page opened, in a React `Activity` (`routes/index.tsx`):

- The URL selects the shown machine. The other shells are in `<Activity mode="hidden">`. They keep all their state (composer text and images, right sidebar, open files, conversation scroll). Their effects stop, so their event streams close and their window listeners go away, as before.
- This is the Herdr model: one pane for each machine, all kept alive, one shown.
- It needed no change to the 3800 lines of `app-shell.tsx` stores, so the risk is much smaller. The "done when" checks of phase 4 pass: a switch keeps the composer text, the right sidebar, and the scroll position, and the shell does not remount.

Things that this needed:

- One `SidebarProvider` above all shells, so the left sidebar state is window state.
- A portal container for each shell (`components/ui/portal-container.tsx`). All floating UI of `components/ui` renders into it. The container is a portal at the top of the `Activity`, so the hidden `Activity` hides it. Without this, a menu that was open when a shell hid stayed on the screen.
- `isInShownMachineShell` for the two `document.querySelectorAll("[data-sidebar-session-item]")` calls.
- `React.useId` for the IDs of the worktree toggle, which is in each shell's composer.
- `usePreservedScrollWhileHidden` in `app-shell-conversation.tsx`. `display: none` loses the scroll position, and the message scroller scrolls to the end when its viewport grows from zero.
- A hidden shell that changes its session (for example when a request ends after the switch) updates its own workspace in the route. It does not navigate, so it cannot take the page back.
- `openMachine` queues an action for the shell of the target machine (`queueMachineAction`). The shell runs the actions when it shows. This replaces the one-shot `pendingAction`.

Window-level preferences that a shell reads from storage on mount (right sidebar and terminal panel open state, display settings) are read again when a shell shows, because its effects run again.

### Per-machine query clients stay (phase 2)

The plan put the machine ID into every query key and used one `QueryClient`. With one shell for each machine, each shell has the `QueryClient` of its machine (`queryClientForMachine`). This isolates the data of each machine at least as well as keys, with no change to the query keys. The machine ID is not in query keys.

### Connections stay in the shell (phase 3)

The plan moved the `/events` stream into a `MachineConnection` with a lifetime of its own. With kept-alive shells, the stream belongs to the shell of its machine and closes while the shell is hidden, as the plan said for a first step. The other parts of phase 3 are done: each machine has its own offline state (`machineOfflineLabel`), sidebar sync (`MachineSidebarSync`), offline prompt queue, and event last ID.

### Phase 5

- **Machine choice in the new-session composer:** done. The directory picker lists the directories of each other machine (from its summary), with offline machines disabled and an "Add directory on <machine>" item. A choice moves the prompt draft and images to that machine's composer (`moveDraftToMachine`, `MachineAction.draft`).
- **Live sidebar for all machines:** the hub already pushes the summary of each machine (titles, working and input state, unread state) on `/api/machines/events`. No change was necessary for this release. A detailed event stream for hidden machines is still open.
- **Actions across machines:** `openSession(ref)` and the action queue replace the handoff. Moving a session to another machine needs server work and is still open.

### Guard rails

`scripts/check-api-urls.mjs` (part of `pnpm check`) fails on a raw `fetch`, `EventSource`, or `WebSocket` with a server path, on `pageMachine(`, and on a direct use of `machineStorageKey(`. `fetchJson` also refuses a relative server path without a machine at run time, and the storage functions refuse a machine key without a machine.

### Known limits

- A menu that is open when its shell hides is still open when the shell shows again. It is hidden while the shell is hidden. A click in the page (the usual way to switch) closes it first.
- Hidden shells re-render at low priority when global stores change (for example the machine list). This costs some CPU with many machines.
