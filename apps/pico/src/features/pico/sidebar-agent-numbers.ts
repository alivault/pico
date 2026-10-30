import * as React from "react"

import { isInShownMachineShell } from "@/lib/pico/machine-context"

import { isMacPlatform } from "./keyboard-shortcuts"

// The number of sidebar agents that Mod+1…9 can open.
export const SIDEBAR_AGENT_NUMBER_COUNT = 9

// The agent rows that the sidebar shows, in sidebar order. Rows in a
// collapsed group are not shown, so they are skipped.
export function getShownSidebarAgentItems(root: ParentNode = document) {
  return Array.from(
    root.querySelectorAll<HTMLElement>("[data-sidebar-agent-item]")
  ).filter(
    (element) =>
      isInShownMachineShell(element) && element.getClientRects().length > 0
  )
}

// How long the app modifier must be held before the numbers show. A quick
// chord such as Mod+N is shorter, so it does not make the numbers flash.
const SHOW_NUMBERS_DELAY_MS = 400

const appModifierKey = isMacPlatform ? "Control" : "Alt"

// While the numbers show, the rows that Mod+1…9 open. Empty when they do
// not show. One shared set of window listeners keeps it.
let numberedItems: Array<HTMLElement> = []
let numbersShown = false
let showNumbersTimer: ReturnType<typeof setTimeout> | undefined
const numberedItemsListeners = new Set<() => void>()

function isAppModifierHeld(event: KeyboardEvent) {
  return isMacPlatform ? event.ctrlKey : event.altKey
}

function clearShowNumbersTimer() {
  if (showNumbersTimer === undefined) return
  clearTimeout(showNumbersTimer)
  showNumbersTimer = undefined
}

function updateNumberedItems() {
  setNumberedItems(
    getShownSidebarAgentItems().slice(0, SIDEBAR_AGENT_NUMBER_COUNT)
  )
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
  if (!isAppModifierHeld(event)) {
    handleModifierReset()
    return
  }

  // While the numbers show, keep them in step with the sidebar. For
  // example, Mod+3 can open an agent that moves the rows.
  if (numbersShown) {
    updateNumberedItems()
    return
  }

  if (event.type !== "keydown") return

  // Another key with the modifier is a chord: do not show the numbers
  // until the modifier is pressed again.
  if (event.key !== appModifierKey) {
    clearShowNumbersTimer()
    return
  }

  if (event.repeat || showNumbersTimer !== undefined) return
  showNumbersTimer = setTimeout(() => {
    showNumbersTimer = undefined
    numbersShown = true
    updateNumberedItems()
  }, SHOW_NUMBERS_DELAY_MS)
}

function handleModifierReset() {
  clearShowNumbersTimer()
  numbersShown = false
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
      clearShowNumbersTimer()
      numbersShown = false
      numberedItems = []
    }
  }
}

/**
 * The Mod+1…9 number of the agent row in `rowRef`, while the app modifier
 * is held. 0 when the modifier is not held or the row has no number.
 */
export function useSidebarAgentNumber(
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
