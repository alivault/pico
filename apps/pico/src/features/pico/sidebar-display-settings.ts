import * as React from "react"
import {
  machineLocalStorageGetItem,
  machineLocalStorageSetItem,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/pico/storage"
import { storageKeyMachine } from "@/lib/pico/machine"

// Stored name: do not change.
export const SHOW_AGENT_PREVIEWS_STORAGE_KEY = "pico-sidebar-session-previews"

const listeners = new Set<() => void>()

function readShowAgentPreviews() {
  return safeLocalStorageGetItem(SHOW_AGENT_PREVIEWS_STORAGE_KEY) === "1"
}

let showAgentPreviews: boolean | undefined

function getShowAgentPreviews() {
  if (showAgentPreviews === undefined) {
    showAgentPreviews = readShowAgentPreviews()
  }
  return showAgentPreviews
}

function notify() {
  for (const listener of listeners) listener()
}

function onStorage(event: StorageEvent) {
  if (event.key !== SHOW_AGENT_PREVIEWS_STORAGE_KEY) return
  showAgentPreviews = readShowAgentPreviews()
  notify()
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener("storage", onStorage)
  }
}

/** Show the last message preview line under each sidebar agent. Off by default. */
export function useShowAgentPreviews() {
  return React.useSyncExternalStore(
    subscribe,
    getShowAgentPreviews,
    () => false
  )
}

export function setShowAgentPreviews(enabled: boolean) {
  showAgentPreviews = enabled
  safeLocalStorageSetItem(SHOW_AGENT_PREVIEWS_STORAGE_KEY, enabled ? "1" : "0")
  notify()
}

/**
 * How the sidebar groups the agents of a machine: in their projects, or in
 * groups by their state (see `agentStatusGroup`). Each machine has its own
 * value.
 */
export type SidebarGroupBy = "project" | "status"

// Stored name: do not change.
export const SIDEBAR_GROUP_BY_STORAGE_KEY = "pico-sidebar-group-by"

const groupByListeners = new Set<() => void>()
const groupByByMachine = new Map<string, SidebarGroupBy>()

function readSidebarGroupBy(machineId: string): SidebarGroupBy {
  return machineLocalStorageGetItem(machineId, SIDEBAR_GROUP_BY_STORAGE_KEY) ===
    "status"
    ? "status"
    : "project"
}

function getSidebarGroupBy(machineId: string) {
  let value = groupByByMachine.get(machineId)
  if (value === undefined) {
    value = readSidebarGroupBy(machineId)
    groupByByMachine.set(machineId, value)
  }
  return value
}

function notifyGroupBy() {
  for (const listener of groupByListeners) listener()
}

function onGroupByStorage(event: StorageEvent) {
  if (!event.key) return
  const scoped = storageKeyMachine(event.key)
  if (scoped?.key !== SIDEBAR_GROUP_BY_STORAGE_KEY) return
  groupByByMachine.set(scoped.machineId, readSidebarGroupBy(scoped.machineId))
  notifyGroupBy()
}

function subscribeGroupBy(listener: () => void) {
  if (groupByListeners.size === 0)
    window.addEventListener("storage", onGroupByStorage)
  groupByListeners.add(listener)
  return () => {
    groupByListeners.delete(listener)
    if (groupByListeners.size === 0)
      window.removeEventListener("storage", onGroupByStorage)
  }
}

/** How the sidebar groups the agents of the machine. Projects by default. */
export function useSidebarGroupBy(machineId: string) {
  return React.useSyncExternalStore(
    subscribeGroupBy,
    () => getSidebarGroupBy(machineId),
    () => "project" as const
  )
}

export function setSidebarGroupBy(machineId: string, groupBy: SidebarGroupBy) {
  if (getSidebarGroupBy(machineId) === groupBy) return
  groupByByMachine.set(machineId, groupBy)
  machineLocalStorageSetItem(machineId, SIDEBAR_GROUP_BY_STORAGE_KEY, groupBy)
  notifyGroupBy()
}
