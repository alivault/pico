import * as React from "react"

import type { SessionListEntry } from "@/lib/pico/api"

/**
 * A filter of the sidebar sessions by their state. A click on a count in a
 * machine heading sets it; a second click removes it. It is window state for
 * each machine, so the heading and the sessions of the machine use it.
 */
export type SessionStatusFilter = "working" | "waiting" | "done"

let snapshot: Record<string, SessionStatusFilter> = {}
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setSessionStatusFilter(
  machineId: string,
  filter: SessionStatusFilter | null
) {
  if ((snapshot[machineId] ?? null) === filter) return
  const next = { ...snapshot }
  if (filter) next[machineId] = filter
  else delete next[machineId]
  snapshot = next
  for (const listener of listeners) listener()
}

export function toggleSessionStatusFilter(
  machineId: string,
  filter: SessionStatusFilter
) {
  setSessionStatusFilter(
    machineId,
    snapshot[machineId] === filter ? null : filter
  )
}

export function useSessionStatusFilter(machineId: string) {
  return React.useSyncExternalStore(
    subscribe,
    () => snapshot[machineId] ?? null,
    () => null
  )
}

/** The same rules as the counts in the machine heading. */
export function sessionMatchesStatusFilter(
  entry: SessionListEntry,
  filter: SessionStatusFilter
) {
  switch (filter) {
    case "working":
      return Boolean((entry.streaming || entry.waiting) && !entry.needsInput)
    case "waiting":
      return Boolean(entry.needsInput)
    case "done":
      return Boolean(
        entry.unread && !entry.streaming && !entry.needsInput && !entry.waiting
      )
  }
}

/**
 * Keeps only the sessions with the state of the filter, and only the
 * directories that still have sessions outside the pinned group.
 */
export function filterDirectorySessionsByStatus(
  directories: Array<string>,
  sessionsByDirectory: Record<string, Array<SessionListEntry>>,
  filter: SessionStatusFilter,
  isPinned: (entry: SessionListEntry) => boolean
) {
  const visibleDirectories: Array<string> = []
  const filteredSessions: Record<string, Array<SessionListEntry>> = {}
  for (const directory of directories) {
    const sessions = (sessionsByDirectory[directory] ?? []).filter((entry) =>
      sessionMatchesStatusFilter(entry, filter)
    )
    filteredSessions[directory] = sessions
    if (sessions.some((entry) => !isPinned(entry)))
      visibleDirectories.push(directory)
  }
  return { visibleDirectories, filteredSessions }
}
