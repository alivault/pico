import * as React from "react"
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/pico/storage"

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
