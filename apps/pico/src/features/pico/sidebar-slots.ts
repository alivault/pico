import * as React from "react"

/**
 * The left sidebar is window UI: the page draws it one time, with a heading
 * for each machine (see `window-sidebar.tsx`). The app shell of the machine
 * that shows puts its own parts into the sidebar through portals: the search
 * button ("top"), its projects ("content"), and its footer ("bottom").
 *
 * The window draws the slots of the shown machine only. The shell of a
 * hidden machine finds no slot and draws nothing, so the sidebar never has
 * the rows of two shells.
 */
export type SidebarSlotKind = "top" | "content" | "bottom"

function slotKey(kind: SidebarSlotKind, machineId: string) {
  return `${kind}:${machineId}`
}

const slots = new Map<string, HTMLElement>()
const listeners = new Set<() => void>()
const refCallbacks = new Map<string, (element: HTMLElement | null) => void>()

function setSlot(key: string, element: HTMLElement | null) {
  if (element) {
    if (slots.get(key) === element) return
    slots.set(key, element)
  } else {
    if (!slots.has(key)) return
    slots.delete(key)
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** A stable ref callback for the element of a slot. */
export function sidebarSlotRef(kind: SidebarSlotKind, machineId: string) {
  const key = slotKey(kind, machineId)
  let callback = refCallbacks.get(key)
  if (!callback) {
    callback = (element) => setSlot(key, element)
    refCallbacks.set(key, callback)
  }
  return callback
}

/** The element of a slot, or null when the window does not draw it. */
export function useSidebarSlot(kind: SidebarSlotKind, machineId: string) {
  const key = slotKey(kind, machineId)
  return React.useSyncExternalStore(
    subscribe,
    () => slots.get(key) ?? null,
    () => null
  )
}
