import * as React from "react"

import { isInShownMachineShell } from "@/lib/pico/machine-context"

import { isMacPlatform } from "./keyboard-shortcuts"

// The number of sidebar sessions that Mod+1…9 can open.
export const SIDEBAR_SESSION_NUMBER_COUNT = 9

// The session rows that the sidebar shows, in sidebar order. Rows in a
// collapsed group are not shown, so they are skipped.
export function getShownSidebarSessionItems(root: ParentNode = document) {
  return Array.from(
    root.querySelectorAll<HTMLElement>("[data-sidebar-session-item]")
  ).filter(
    (element) =>
      isInShownMachineShell(element) && element.getClientRects().length > 0
  )
}

// While the app modifier is held, the rows that Mod+1…9 open. Empty when
// the modifier is not held. One shared set of window listeners keeps it.
let numberedItems: Array<HTMLElement> = []
const numberedItemsListeners = new Set<() => void>()

function isAppModifierHeld(event: KeyboardEvent) {
  return isMacPlatform ? event.ctrlKey : event.altKey
}

function setNumberedItems(next: Array<HTMLElement>) {
  if (
    next.length === numberedItems.length &&
    next.every((item, index) => item === numberedItems[index])
  ) {
    return
  }
  numberedItems = next
  for (const listener of numberedItemsListeners) listener()
}

function handleModifierKeyEvent(event: KeyboardEvent) {
  setNumberedItems(
    isAppModifierHeld(event)
      ? getShownSidebarSessionItems().slice(0, SIDEBAR_SESSION_NUMBER_COUNT)
      : []
  )
}

function handleModifierReset() {
  setNumberedItems([])
}

function subscribeNumberedItems(listener: () => void) {
  if (numberedItemsListeners.size === 0) {
    window.addEventListener("keydown", handleModifierKeyEvent)
    window.addEventListener("keyup", handleModifierKeyEvent)
    window.addEventListener("blur", handleModifierReset)
  }
  numberedItemsListeners.add(listener)
  return () => {
    numberedItemsListeners.delete(listener)
    if (numberedItemsListeners.size === 0) {
      window.removeEventListener("keydown", handleModifierKeyEvent)
      window.removeEventListener("keyup", handleModifierKeyEvent)
      window.removeEventListener("blur", handleModifierReset)
      numberedItems = []
    }
  }
}

/**
 * The Mod+1…9 number of the session row in `rowRef`, while the app modifier
 * is held. 0 when the modifier is not held or the row has no number.
 */
export function useSidebarSessionNumber(
  rowRef: React.RefObject<HTMLElement | null>
) {
  return React.useSyncExternalStore(
    subscribeNumberedItems,
    () => {
      const row = rowRef.current
      if (!row) return 0
      return numberedItems.findIndex((item) => row.contains(item)) + 1
    },
    () => 0
  )
}
