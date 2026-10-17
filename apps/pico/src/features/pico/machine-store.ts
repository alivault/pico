import * as React from "react"

import {
  activeMachineId,
  apiUrl,
  isRemoteMachine,
  setActiveMachineOffline,
} from "@/lib/pico/machine"

/**
 * The machines of the hub: the local runtime and the SSH machines. The hub
 * sends their states and session summaries on `/api/machines/events`. This
 * page shows one machine (see `lib/pico/machine.ts`); the sidebar shows the
 * other machines from their summaries.
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
  /** The viewer contexts (browsers) that did not see the last run yet. */
  unreadBy?: Array<string>
  parent?: string
  lastMessageAt?: number
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
  source = new EventSource(apiUrl("/api/machines/events"))
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
    const active = data.machines.find(
      (machine) => machine.id === activeMachineId()
    )
    setActiveMachineOffline(
      isRemoteMachine() && active?.state !== "online"
        ? (active?.label ?? "This machine")
        : undefined
    )
    for (const listener of listeners) listener()
  }
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

/** The machine of this page; undefined until the list loads. */
export function useActiveMachine() {
  const { machines } = useMachines()
  return machines.find((machine) => machine.id === activeMachineId())
}

/**
 * The machine of the page is not online. The page shows its last state and
 * turns off the actions that change it: the composer, git actions, and
 * terminal input.
 */
export function useMachineReadOnly() {
  const { loaded, machines } = useMachines()
  if (!isRemoteMachine() || !loaded) return false
  const machine = machines.find((entry) => entry.id === activeMachineId())
  return machine?.state !== "online"
}

/**
 * Whether the server of the page has a feature of its manifest. The local
 * server is the same version as this client. A remote server can be older:
 * the client then hides the controls of features that it does not have.
 */
export function useMachineFeature(feature: string) {
  const { machines } = useMachines()
  if (!isRemoteMachine()) return true
  const features = machines.find(
    (machine) => machine.id === activeMachineId()
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
