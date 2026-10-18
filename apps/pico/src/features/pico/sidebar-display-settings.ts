import * as React from "react"
import {
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
} from "@/lib/pico/storage"
import { machineStorageKey } from "@/lib/pico/machine"

export const SHOW_SESSION_PREVIEWS_STORAGE_KEY = "pico-sidebar-session-previews"

const listeners = new Set<() => void>()

function readShowSessionPreviews() {
  return safeLocalStorageGetItem(SHOW_SESSION_PREVIEWS_STORAGE_KEY) === "1"
}

let showSessionPreviews: boolean | undefined

function getShowSessionPreviews() {
  if (showSessionPreviews === undefined) {
    showSessionPreviews = readShowSessionPreviews()
  }
  return showSessionPreviews
}

function notify() {
  for (const listener of listeners) listener()
}

function onStorage(event: StorageEvent) {
  if (event.key !== machineStorageKey(SHOW_SESSION_PREVIEWS_STORAGE_KEY)) return
  showSessionPreviews = readShowSessionPreviews()
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

/** Show the last message preview line under each sidebar session. Off by default. */
export function useShowSessionPreviews() {
  return React.useSyncExternalStore(
    subscribe,
    getShowSessionPreviews,
    () => false
  )
}

export function setShowSessionPreviews(enabled: boolean) {
  showSessionPreviews = enabled
  safeLocalStorageSetItem(
    SHOW_SESSION_PREVIEWS_STORAGE_KEY,
    enabled ? "1" : "0"
  )
  notify()
}
