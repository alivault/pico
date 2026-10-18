/**
 * The machine that this page shows. A hub shows its own runtime (`local`)
 * and remote machines over SSH. The page shows one machine at a time: the
 * `machine` search parameter selects it. A switch does not load the page
 * again. The route mounts a new app shell for the machine, with its own query
 * cache, so caches and stores never mix IDs of two servers (see
 * `routes/index.tsx`).
 *
 * Requests for a remote machine go to the hub's proxy at `/m/<id>/...`.
 * Global data stays on the hub: highlighting, Web Push, and the machine list.
 */

export const LOCAL_MACHINE_ID = "local"

const MACHINE_ID_PATTERN = /^m_[a-z0-9]{4,32}$/

/** Paths that always go to the hub, whatever the machine. */
const HUB_PATHS = ["/api/highlight", "/api/push/", "/api/machines"]

/** A machine ID from the URL; `local` for a missing or bad value. */
export function normalizeMachineId(value: string | null | undefined) {
  return value && MACHINE_ID_PATTERN.test(value) ? value : LOCAL_MACHINE_ID
}

function readMachineId() {
  if (typeof window === "undefined") return LOCAL_MACHINE_ID
  return normalizeMachineId(
    new URLSearchParams(window.location.search).get("machine")
  )
}

let pageMachineId = readMachineId()
/** Goes up at each switch. Requests of an older machine use it to stop. */
let machineEpoch = 0
const beforeSwitchListeners = new Set<() => void>()
const switchListeners = new Set<(machineId: string) => void>()

/** The machine of this page. It changes only in `setPageMachine`. */
export function activeMachineId() {
  return pageMachineId
}

export function currentMachineEpoch() {
  return machineEpoch
}

/**
 * Make `machineId` the machine of the page. The route calls this before it
 * mounts the app shell of the new machine. Modules with state for one machine
 * reset it in `onMachineSwitch`.
 */
export function setPageMachine(machineId: string) {
  if (machineId === pageMachineId) return
  for (const listener of beforeSwitchListeners) listener()
  pageMachineId = machineId
  machineEpoch += 1
  for (const listener of switchListeners) listener(machineId)
}

/** Run `listener` while the old machine is still the machine of the page. */
export function onBeforeMachineSwitch(listener: () => void) {
  beforeSwitchListeners.add(listener)
  return () => {
    beforeSwitchListeners.delete(listener)
  }
}

export function onMachineSwitch(listener: (machineId: string) => void) {
  switchListeners.add(listener)
  return () => {
    switchListeners.delete(listener)
  }
}

export function isRemoteMachine(machineId = pageMachineId) {
  return machineId !== LOCAL_MACHINE_ID
}

/** Whether a path is a server route (`/api/...` or `/events`). */
export function isServerPath(path: string) {
  return (
    path.startsWith("/api/") ||
    path === "/events" ||
    path.startsWith("/events?")
  )
}

/**
 * The URL of a server path for a machine: unchanged for the local machine
 * and for global hub data, `/m/<id>/...` for a remote machine.
 */
export function apiUrl(path: string, machineId = pageMachineId) {
  if (!isServerPath(path) || machineId === LOCAL_MACHINE_ID) return path
  if (HUB_PATHS.some((prefix) => path.startsWith(prefix))) return path
  return `/m/${encodeURIComponent(machineId)}${path}`
}

let offlineLabel: string | undefined

/**
 * The machine store calls this when the machine of the page goes offline
 * (a label) or comes back (undefined).
 */
export function setActiveMachineOffline(label: string | undefined) {
  offlineLabel = label
}

/** The machine of the page is offline: the page is read-only. */
export function activeMachineOffline() {
  return offlineLabel !== undefined
}

/** A change that the page did not send, because its machine is offline. */
export class MachineOfflineError extends Error {
  constructor(label: string) {
    super(`${label} is offline. Pico sends nothing until it is back.`)
    this.name = "MachineOfflineError"
  }
}

/**
 * Throw for a change (any method but GET or HEAD) to an offline machine.
 * Reads still go to the hub, which answers from its offline copies.
 */
export function assertMachineWritable(
  input: RequestInfo | URL,
  method: string | undefined
) {
  if (offlineLabel === undefined) return
  if (!method || ["GET", "HEAD"].includes(method.toUpperCase())) return
  const url =
    typeof input === "string"
      ? new URL(input, window.location.origin)
      : input instanceof URL
        ? input
        : new URL(input.url)
  if (url.pathname.startsWith("/m/"))
    throw new MachineOfflineError(offlineLabel)
}

/** Whether a fetch input goes to a machine, not to global hub data. */
export function isMachineRequest(input: RequestInfo | URL) {
  const url =
    typeof input === "string"
      ? new URL(input, window.location.origin)
      : input instanceof URL
        ? input
        : new URL(input.url)
  if (url.origin !== window.location.origin) return false
  if (url.pathname.startsWith("/m/")) return true
  return (
    isServerPath(url.pathname) &&
    !HUB_PATHS.some((prefix) => url.pathname.startsWith(prefix))
  )
}

/** Apply `apiUrl` to a fetch input when it is a server path. */
export function apiInput(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === "string") return apiUrl(input)
  if (input instanceof URL && input.origin === window.location.origin) {
    const path = `${input.pathname}${input.search}`
    const next = apiUrl(path)
    return next === path ? input : new URL(next, window.location.origin)
  }
  return input
}

/** Local storage keys whose values belong to one machine. */
const MACHINE_SCOPED_KEYS = new Set([
  "pico-draft-directory",
  "pico-sidebar-directories",
  "pico-collapsed-directories",
  "pico-pinned-sessions",
  "pico-recent-directories",
  "pico-terminal-tabs",
  "pico-prompt-drafts",
  "pico-sidebar-state-merged",
])

/** A storage key for the machine of this page. */
export function machineStorageKey(key: string) {
  if (pageMachineId === LOCAL_MACHINE_ID || !MACHINE_SCOPED_KEYS.has(key))
    return key
  return `${key}@${pageMachineId}`
}

/** The page of a machine, optionally with a session open. */
export function machinePageUrl(machineId: string, sessionId?: string) {
  const query = new URLSearchParams()
  if (machineId !== LOCAL_MACHINE_ID) query.set("machine", machineId)
  if (sessionId) query.set("session", sessionId)
  const search = query.toString()
  return search ? `/?${search}` : "/"
}

type MachineNavigator = (machineId: string, sessionId?: string) => void

let machineNavigator: MachineNavigator | undefined

/** The route sets how to open a machine without a page load. */
export function setMachineNavigator(navigator: MachineNavigator | undefined) {
  machineNavigator = navigator
}

/** An action for the app shell of a machine to run when it mounts. */
export type PendingMachineAction =
  | { type: "new-session"; directory: string }
  | { type: "add-directory" }

let pendingAction:
  | { machineId: string; action: PendingMachineAction }
  | undefined

/**
 * Open a machine, optionally with a session or with an action: a new session
 * in a directory, or the Add directory dialog. The app shell of that machine
 * runs the action when it mounts (see `takePendingMachineAction`).
 */
export function openMachine(
  machineId: string,
  options: { sessionId?: string; action?: PendingMachineAction } = {}
) {
  pendingAction = options.action
    ? { machineId, action: options.action }
    : undefined
  if (machineNavigator) {
    machineNavigator(machineId, options.sessionId)
    return
  }
  window.location.assign(machinePageUrl(machineId, options.sessionId))
}

/** The action that waits for the machine of the page, once. */
export function takePendingMachineAction() {
  const pending = pendingAction
  pendingAction = undefined
  return pending?.machineId === pageMachineId ? pending.action : undefined
}
