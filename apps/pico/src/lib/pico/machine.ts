/**
 * The machine that this page shows. A hub shows its own runtime (`local`)
 * and remote machines over SSH. The page shows one machine at a time: the
 * `machine` search parameter selects it, and a switch loads the page again,
 * so caches and stores never mix IDs of two servers.
 *
 * Requests for a remote machine go to the hub's proxy at `/m/<id>/...`.
 * Global data stays on the hub: highlighting, Web Push, and the machine list.
 */

export const LOCAL_MACHINE_ID = "local"

const MACHINE_ID_PATTERN = /^m_[a-z0-9]{4,32}$/

/** Paths that always go to the hub, whatever the machine. */
const HUB_PATHS = ["/api/highlight", "/api/push/", "/api/machines"]

function readMachineId() {
  if (typeof window === "undefined") return LOCAL_MACHINE_ID
  const value = new URLSearchParams(window.location.search).get("machine")
  return value && MACHINE_ID_PATTERN.test(value) ? value : LOCAL_MACHINE_ID
}

const pageMachineId = readMachineId()

/** The machine of this page. It does not change until the page loads again. */
export function activeMachineId() {
  return pageMachineId
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

/** Open another machine. The page loads again for it. */
export function openMachine(machineId: string, sessionId?: string) {
  window.location.assign(machinePageUrl(machineId, sessionId))
}
