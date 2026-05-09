import * as React from "react"

import type { SessionState } from "@/lib/pico"
import type { SessionDoneEvent, SessionListEntry } from "@/lib/pico/api"
import { getSessionTitle, sessionListEntryKey } from "@/lib/pico"
import { picoSessionScopeKey } from "@/features/pico/query-keys"

export function sessionNotificationKey(sessionLike: {
  sessionFile?: string | undefined
  sessionPath?: string | undefined
  path?: string | undefined
  sessionId?: string | undefined
  id?: string | undefined
}) {
  const sessionFile = (
    sessionLike.sessionFile ||
    sessionLike.sessionPath ||
    sessionLike.path ||
    ""
  ).trim()
  if (sessionFile) return `path:${sessionFile}`

  const sessionId = (sessionLike.sessionId || sessionLike.id || "").trim()
  if (sessionId) return `id:${sessionId}`

  return ""
}

export function formatDisplayPath(value: string | undefined) {
  const path = value?.trim() || ""
  if (!path) return ""

  return path
    .replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/home\/[^/]+(?=\/|$)/, "~")
}

export function formatFolderName(value: string | undefined) {
  const path = value?.trim().replace(/\/+$/, "") || ""
  if (!path) return ""
  if (path === "/") return "/"

  const parts = path.split("/").filter(Boolean)
  return parts[parts.length - 1] || path
}

export function finishedSessionLabel(title: string) {
  return title !== "New session"
    ? `Session finished: ${title}`
    : "Session finished"
}

export function doneEventLabel(event: SessionDoneEvent) {
  const title = event.title?.trim() || "New session"
  if (event.reason === "manual_compaction") {
    return title !== "New session"
      ? `Compaction complete: ${title}`
      : "Compaction complete"
  }

  if (event.outcome === "error") {
    return title !== "New session"
      ? `Session stopped: ${title}`
      : "Session stopped"
  }

  return finishedSessionLabel(title)
}

export function sessionScrollKey(sessionState: {
  draft: boolean
  sessionFile?: string
  sessionId?: string
  cwd?: string
}) {
  return picoSessionScopeKey(sessionState)
}

export function sameStringArray(left: Array<string>, right: Array<string>) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }

  return true
}

export function sameMapEntries<K, V>(left: Map<K, V>, right: Map<K, V>) {
  if (left === right) return true
  if (left.size !== right.size) return false

  for (const [key, value] of left) {
    if (right.get(key) !== value) return false
  }
  return true
}

export function useLatestRef<T>(value: T) {
  const ref = React.useRef(value)
  ref.current = value
  return ref
}

export function useStableEvent<Args extends Array<unknown>, Result>(
  handler: (...args: Args) => Result
) {
  const handlerRef = useLatestRef(handler)
  return React.useCallback(
    (...args: Args) => handlerRef.current(...args),
    [handlerRef]
  )
}

export function shallowRecordEqual<T extends Record<string, unknown>>(
  left: T,
  right: T
) {
  if (left === right) return true

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false
  }

  return true
}

export function findSidebarSessionSelectionKey(
  entriesByKey: Map<string, SessionListEntry>,
  sessionLike: {
    sessionId?: string | undefined
    sessionPath?: string | undefined
  }
) {
  const sessionPath = sessionLike.sessionPath?.trim() || ""
  const sessionId = sessionLike.sessionId?.trim() || ""

  if (sessionPath) {
    const pathKey = sessionListEntryKey({ path: sessionPath })
    if (entriesByKey.has(pathKey)) return pathKey
  }

  if (sessionId) {
    const idKey = sessionListEntryKey({ id: sessionId })
    if (entriesByKey.has(idKey)) return idKey
  }

  for (const [key, entry] of entriesByKey) {
    if (
      (sessionPath && entry.path === sessionPath) ||
      (sessionId && entry.id === sessionId)
    ) {
      return key
    }
  }

  return ""
}

export function getCurrentSessionTitleFromState(
  sessionState: Pick<SessionState, "firstMessage" | "sessionName">
) {
  return getSessionTitle({
    title:
      sessionState.sessionName || sessionState.firstMessage || "New session",
    name: sessionState.sessionName,
  })
}
