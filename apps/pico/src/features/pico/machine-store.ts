import * as React from "react"

import { useMachineId } from "@/lib/pico/machine-context"
import {
  hubUrl,
  isRemoteMachine,
  setMachineOfflineLabels,
} from "@/lib/pico/machine"

/**
 * The machines of the hub: the local runtime and the SSH machines. The hub
 * sends their states and session summaries on `/api/machines/events`. The
 * page shows one machine at a time (see `routes/index.tsx`); the sidebar
 * shows the other machines from their summaries.
 */

export type MachineState =
  | "connecting"
  | "online"
  | "offline"
  | "attention"
  | "disabled"

export type MachineSessionSummary = {
  id: string
  title: string
  cwd: string
  directory: string
  busy: boolean
  needsInput: boolean
  /** What an idle session waits on: timers, watches, or jobs. */
  waiting?: string
  /** Nobody has read the last run yet. The same for all clients. */
  unread?: boolean
  /** Servers before global read state: the viewer contexts that did not see it. */
  unreadBy?: Array<string>
  parent?: string
  lastMessageAt?: number
  lastUserMessageAt?: number
}

export type MachineInfo = {
  id: string
  label: string
  target: string
  dataDir: string | null
  enabled: boolean
  state: MachineState
  since: number
  problem?: {
    kind: "auth" | "stopped" | "update" | "setup" | "error"
    message: string
    detail?: string
    url?: string
  }
  retryAt?: number
  version?: string
  /** The features of the remote server, from its manifest. */
  features?: Array<string>
  summary?: {
    hostname: string
    version: string
    directories: Array<string>
    sessions: Array<MachineSessionSummary>
  }
}

type MachinesSnapshot = {
  loaded: boolean
  machines: Array<MachineInfo>
  fileError?: string
}

let snapshot: MachinesSnapshot = { loaded: false, machines: [] }
const listeners = new Set<() => void>()
let source: EventSource | undefined

function connect() {
  if (source || typeof EventSource === "undefined") return
  source = new EventSource(hubUrl("/api/machines/events"))
  source.onmessage = (event: MessageEvent<string>) => {
    let data: { type?: string } & Partial<MachinesSnapshot>
    try {
      data = JSON.parse(event.data) as typeof data
    } catch {
      return
    }
    if (data.type !== "machines" || !Array.isArray(data.machines)) return
    snapshot = {
      loaded: true,
      machines: data.machines,
      ...(data.fileError ? { fileError: data.fileError } : {}),
    }
    syncMachineOffline()
    for (const listener of listeners) listener()
  }
}

/** Tell `lib/pico/machine.ts` which remote machines are not online. */
function syncMachineOffline() {
  const labels = new Map<string, string>()
  for (const machine of snapshot.machines) {
    if (isRemoteMachine(machine.id) && machine.state !== "online")
      labels.set(machine.id, machine.label || "This machine")
  }
  setMachineOfflineLabels(labels)
}

function subscribe(listener: () => void) {
  connect()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useMachines() {
  return React.useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot
  )
}

/** The machine of this subtree; undefined until the list loads. */
export function useActiveMachine() {
  const { machines } = useMachines()
  const machineId = useMachineId()
  return machines.find((machine) => machine.id === machineId)
}

/**
 * The machine of the page is not online. The page shows its last state and
 * turns off the actions that change it: the composer, git actions, and
 * terminal input.
 */
export function useMachineReadOnly() {
  const { loaded, machines } = useMachines()
  const machineId = useMachineId()
  if (!isRemoteMachine(machineId) || !loaded) return false
  const machine = machines.find((entry) => entry.id === machineId)
  return machine?.state !== "online"
}

/**
 * Whether the server of the page has a feature of its manifest. The local
 * server is the same version as this client. A remote server can be older:
 * the client then hides the controls of features that it does not have.
 */
export function useMachineFeature(feature: string) {
  const { machines } = useMachines()
  const machineId = useMachineId()
  if (!isRemoteMachine(machineId)) return true
  const features = machines.find(
    (machine) => machine.id === machineId
  )?.features
  return !features || features.includes(feature)
}

/** Render `children` only when the server of the page has `feature`. */
export function MachineFeatureGate({
  feature,
  children,
}: {
  feature: string | undefined
  children: React.ReactNode
}) {
  const available = useMachineFeature(feature ?? "")
  return !feature || available ? children : null
}

/** The viewer context of this browser; the same on every machine. */
export function viewerContextIdForSummaries() {
  try {
    return window.localStorage.getItem("pico-context-id") ?? ""
  } catch {
    return ""
  }
}
