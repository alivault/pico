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

/**
 * The layout of the whole sidebar. "groups": each machine shows its agents
 * in groups (see `SidebarGroupBy`). "split": as in Herdr, the projects of
 * all machines are at the top, and one list of the agents of all machines
 * is at the bottom. It is window state: one value for the browser.
 */
export type SidebarLayout = "groups" | "split"

// Stored name: do not change.
export const SIDEBAR_LAYOUT_STORAGE_KEY = "pico-sidebar-layout"

const layoutListeners = new Set<() => void>()
let sidebarLayout: SidebarLayout | undefined

// "split" when the user did not choose a layout.
function readSidebarLayout(): SidebarLayout {
  return safeLocalStorageGetItem(SIDEBAR_LAYOUT_STORAGE_KEY) === "groups"
    ? "groups"
    : "split"
}

function getSidebarLayout() {
  sidebarLayout ??= readSidebarLayout()
  return sidebarLayout
}

function notifyLayout() {
  for (const listener of layoutListeners) listener()
}

function onLayoutStorage(event: StorageEvent) {
  if (event.key !== SIDEBAR_LAYOUT_STORAGE_KEY) return
  sidebarLayout = readSidebarLayout()
  notifyLayout()
}

function subscribeLayout(listener: () => void) {
  if (layoutListeners.size === 0)
    window.addEventListener("storage", onLayoutStorage)
  layoutListeners.add(listener)
  return () => {
    layoutListeners.delete(listener)
    if (layoutListeners.size === 0)
      window.removeEventListener("storage", onLayoutStorage)
  }
}

/** The layout of the sidebar. Split by default. */
export function useSidebarLayout() {
  return React.useSyncExternalStore(
    subscribeLayout,
    getSidebarLayout,
    () => "split" as const
  )
}

export function setSidebarLayout(layout: SidebarLayout) {
  if (getSidebarLayout() === layout) return
  sidebarLayout = layout
  safeLocalStorageSetItem(SIDEBAR_LAYOUT_STORAGE_KEY, layout)
  notifyLayout()
}

/**
 * The 3 choices of the sidebar view of a machine: its agents by project,
 * by state, or the split layout of the window ("Projects and agents").
 */
export type SidebarView = SidebarGroupBy | "split"

export const SIDEBAR_VIEWS: ReadonlyArray<SidebarView> = [
  "split",
  "project",
  "status",
]

export function sidebarViewLabel(view: SidebarView) {
  switch (view) {
    case "project":
      return "By project"
    case "status":
      return "By state"
    case "split":
      return "Projects and agents"
  }
}

export function useSidebarView(machineId: string): SidebarView {
  const layout = useSidebarLayout()
  const groupBy = useSidebarGroupBy(machineId)
  return layout === "split" ? "split" : groupBy
}

/**
 * "split" sets the layout of the window. The other views set the layout
 * back to groups, and set how this machine groups its agents.
 */
export function setSidebarView(machineId: string, view: SidebarView) {
  if (view === "split") {
    setSidebarLayout("split")
    return
  }
  setSidebarGroupBy(machineId, view)
  setSidebarLayout("groups")
}
