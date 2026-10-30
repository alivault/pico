/**
 * Machines of the hub. A hub shows its own runtime (`local`) and remote
 * machines over SSH. Each request, storage key, and offline check names its
 * machine explicitly: nothing in this module reads a "current" machine.
 *
 * Requests for a remote machine go to the hub's proxy at `/m/<id>/...`.
 * Global data stays on the hub: highlighting, Web Push, and the machine list.
 *
 * The `machine` search parameter selects the machine that the page shows
 * (see `routes/index.tsx`). The page keeps an app shell for each machine
 * that it opened, so a switch keeps the state of each machine. React code
 * gets the machine of its subtree from `useMachineId()`
 * (`machine-context.tsx`).
 */

import type { PromptImage } from "@/lib/pico"

export const LOCAL_MACHINE_ID = "local"

const MACHINE_ID_PATTERN = /^m_[a-z0-9]{4,32}$/

/** Paths that always go to the hub, whatever the machine. */
const HUB_PATHS = ["/api/highlight", "/api/push/", "/api/machines"]

/** A machine ID from the URL; `local` for a missing or bad value. */
export function normalizeMachineId(value: string | null | undefined) {
  return value && MACHINE_ID_PATTERN.test(value) ? value : LOCAL_MACHINE_ID
}

export function isRemoteMachine(machineId: string) {
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

/** Whether a server path is global hub data, the same for every machine. */
export function isHubPath(path: string) {
  return HUB_PATHS.some((prefix) => path.startsWith(prefix))
}

/**
 * The absolute URL of a server path for a machine: the path itself for the
 * local machine and for global hub data, `/m/<id>/...` for a remote machine.
 * The URL is absolute, so that `fetchJson` can tell it from a path that has
 * no machine yet (see `isUnaddressedServerPath`).
 */
export function machineApiUrl(machineId: string, path: string) {
  if (!isServerPath(path)) return path
  const routed =
    machineId === LOCAL_MACHINE_ID || isHubPath(path)
      ? path
      : `/m/${encodeURIComponent(machineId)}${path}`
  return new URL(routed, window.location.origin).toString()
}

/** The URL of global hub data. Throws for a path of a machine. */
export function hubUrl(path: string) {
  if (!isHubPath(path)) {
    throw new Error(`${path} is not hub data. Give the machine of the request.`)
  }
  return path
}

function requestUrl(input: RequestInfo | URL) {
  return typeof input === "string"
    ? new URL(input, window.location.origin)
    : input instanceof URL
      ? input
      : new URL(input.url)
}

/**
 * The machine that a request goes to: from the `/m/<id>/` prefix, `local`
 * for other server paths, undefined for hub data and other URLs.
 */
export function requestMachineId(input: RequestInfo | URL) {
  const url = requestUrl(input)
  if (url.origin !== window.location.origin) return undefined
  const match = /^\/m\/([^/]+)\//.exec(url.pathname)
  if (match) return decodeURIComponent(match[1]!)
  if (!isServerPath(url.pathname) || isHubPath(url.pathname)) return undefined
  return LOCAL_MACHINE_ID
}

/**
 * A request input with a server path that has no machine yet. Such an input
 * would go to the local machine by accident, so `fetchJson` refuses it. Use
 * `buildRequestUrl` or `machineApiUrl`.
 */
export function isUnaddressedServerPath(input: RequestInfo | URL) {
  if (typeof input !== "string") return false
  return input.startsWith("/") && isServerPath(input) && !isHubPath(input)
}

const offlineLabels = new Map<string, string>()

/**
 * The machine store calls this with the label of each remote machine that is
 * not online.
 */
export function setMachineOfflineLabels(labels: Map<string, string>) {
  offlineLabels.clear()
  for (const [id, label] of labels) offlineLabels.set(id, label)
}

/** The label of a machine that is offline; undefined when it is online. */
export function machineOfflineLabel(machineId: string) {
  return offlineLabels.get(machineId)
}

function machineOfflineMessage(label: string) {
  return `${label} is offline. Pico sends nothing until it is back.`
}

/** The messages of each MachineOfflineError that the page made. */
const offlineMessages = new Set<string>()

/**
 * The offline message in text, when text tells of a request that an offline
 * machine did not get. Toasts use it to show one toast for each machine.
 */
export function findMachineOfflineMessage(text: string) {
  for (const label of offlineLabels.values()) {
    const message = machineOfflineMessage(label)
    if (text.includes(message)) return message
  }
  for (const message of offlineMessages) {
    if (text.includes(message)) return message
  }
  return undefined
}

/** A change that the page did not send, because its machine is offline. */
export class MachineOfflineError extends Error {
  constructor(label: string) {
    super(machineOfflineMessage(label))
    offlineMessages.add(this.message)
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
  if (!method || ["GET", "HEAD"].includes(method.toUpperCase())) return
  const machineId = requestMachineId(input)
  if (!machineId) return
  const label = machineOfflineLabel(machineId)
  if (label !== undefined) throw new MachineOfflineError(label)
}

/** Local storage keys whose values belong to one machine. Stored names: do not change. */
const MACHINE_SCOPED_KEYS = new Set([
  "pico-draft-directory",
  "pico-sidebar-directories",
  "pico-collapsed-directories",
  "pico-pinned-sessions",
  "pico-recent-directories",
  "pico-terminal-tabs",
  "pico-job-focus-seen",
  "pico-prompt-drafts",
  "pico-sidebar-state-merged",
])

export function isMachineScopedStorageKey(key: string) {
  return MACHINE_SCOPED_KEYS.has(key)
}

/**
 * The storage key of a machine's value: the plain key for the local machine
 * and for global keys, `key@<id>` for a remote machine.
 */
export function machineStorageKey(machineId: string, key: string) {
  if (machineId === LOCAL_MACHINE_ID || !MACHINE_SCOPED_KEYS.has(key))
    return key
  return `${key}@${machineId}`
}

/** The machine of a scoped storage key, or undefined for a global key. */
export function storageKeyMachine(storageKey: string) {
  const at = storageKey.lastIndexOf("@")
  const key = at < 0 ? storageKey : storageKey.slice(0, at)
  if (!MACHINE_SCOPED_KEYS.has(key)) return undefined
  return {
    key,
    machineId: at < 0 ? LOCAL_MACHINE_ID : storageKey.slice(at + 1),
  }
}

/**
 * An agent with its machine. An agent ID alone is not unique: two machines
 * can have the same ID. Use this type where data of more than one machine
 * meets, for example in the sidebar groups and the agents dialog.
 */
export type AgentRef = { machineId: string; agentId: string }

/**
 * The string form of a `AgentRef`: the plain agent ID for the local
 * machine, so that stored keys stay readable, `<id>@<machine>` otherwise.
 */
export function agentRefKey(ref: AgentRef) {
  return ref.machineId === LOCAL_MACHINE_ID
    ? ref.agentId
    : `${ref.agentId}@${ref.machineId}`
}

export function sameAgentRef(
  left: AgentRef | undefined,
  right: AgentRef | undefined
) {
  return (
    left?.machineId === right?.machineId && left?.agentId === right?.agentId
  )
}

/** The page of a machine, optionally with an agent open. */
export function machinePageUrl(machineId: string, agentId?: string) {
  const query = new URLSearchParams()
  if (machineId !== LOCAL_MACHINE_ID) query.set("machine", machineId)
  if (agentId) query.set("agent", agentId)
  const search = query.toString()
  return search ? `/?${search}` : "/"
}

type MachineNavigator = (machineId: string, agentId?: string) => void

let machineNavigator: MachineNavigator | undefined

/** The route sets how to open a machine without a page load. */
export function setMachineNavigator(navigator: MachineNavigator | undefined) {
  machineNavigator = navigator
}

/**
 * An action for the app shell of a machine: a new agent in a directory
 * (optionally with a prompt draft to put in its composer), or the Add
 * directory dialog.
 */
export type MachineAction =
  | {
      type: "new-agent"
      directory: string
      draft?: { text: string; images: Array<PromptImage> }
    }
  | { type: "add-directory" }

const pendingActions = new Map<string, Array<MachineAction>>()
const actionListeners = new Map<string, Set<() => void>>()

/**
 * Give an action to the app shell of a machine. The shell runs it when it
 * shows: at once when it shows now, else when the page opens that machine.
 */
export function queueMachineAction(machineId: string, action: MachineAction) {
  const queue = pendingActions.get(machineId) ?? []
  queue.push(action)
  pendingActions.set(machineId, queue)
  for (const listener of actionListeners.get(machineId) ?? []) listener()
}

/** The actions that wait for a machine; the queue is empty after the call. */
export function takeMachineActions(machineId: string) {
  const queue = pendingActions.get(machineId) ?? []
  pendingActions.delete(machineId)
  return queue
}

/** True when a new-agent action waits for the app shell of `machineId`. */
export function hasPendingNewAgentAction(machineId: string) {
  return (pendingActions.get(machineId) ?? []).some(
    (action) => action.type === "new-agent"
  )
}

/** Get a call when an action for `machineId` arrives. */
export function onMachineAction(machineId: string, listener: () => void) {
  let listeners = actionListeners.get(machineId)
  if (!listeners) {
    listeners = new Set()
    actionListeners.set(machineId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Show a machine, optionally with an agent open or with an action for its
 * app shell (see `queueMachineAction`).
 */
export function openMachine(
  machineId: string,
  options: { agentId?: string; action?: MachineAction } = {}
) {
  if (options.action) queueMachineAction(machineId, options.action)
  if (machineNavigator) {
    machineNavigator(machineId, options.agentId)
    return
  }
  window.location.assign(machinePageUrl(machineId, options.agentId))
}

/** Show an agent of any machine. */
export function openAgent(ref: AgentRef) {
  openMachine(ref.machineId, { agentId: ref.agentId })
}
