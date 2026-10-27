import * as React from "react"

import type { SessionListEntry } from "@/lib/pico/api"

/**
 * A filter of the sidebar sessions by their state. A click on a count in a
 * machine heading turns its state on or off; more than one state can be on.
 * It is window state for each machine, so the heading and the sessions of the
 * machine use it.
 */
export type SessionStatusFilter = "working" | "waiting" | "done"

/** The states that are on, in a fixed order. Never empty. */
export type SessionStatusFilters = ReadonlyArray<SessionStatusFilter>

const FILTER_ORDER: ReadonlyArray<SessionStatusFilter> = [
  "waiting",
  "working",
  "done",
]

let snapshot: Record<string, SessionStatusFilters> = {}
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Turns `filter` on or off in `current`. Returns null when no state is on.
 */
export function toggleStatusFilter(
  current: SessionStatusFilters | null,
  filter: SessionStatusFilter
): SessionStatusFilters | null {
  const on = new Set(current ?? [])
  if (on.has(filter)) on.delete(filter)
  else on.add(filter)
  const next = FILTER_ORDER.filter((item) => on.has(item))
  return next.length > 0 ? next : null
}

export function setSessionStatusFilter(
  machineId: string,
  filters: SessionStatusFilters | null
) {
  const current = snapshot[machineId] ?? null
  if (current === filters) return
  if (current && filters && current.join() === filters.join()) return
  const next = { ...snapshot }
  if (filters && filters.length > 0) next[machineId] = filters
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
    toggleStatusFilter(snapshot[machineId] ?? null, filter)
  )
}

/** The states that are on for the machine, or null when there is no filter. */
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
  filter: SessionStatusFilter | SessionStatusFilters
): boolean {
  if (typeof filter !== "string")
    return filter.some((item) => sessionMatchesStatusFilter(entry, item))
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
 * Keeps only the sessions with a state of the filter, and only the
 * directories that still have sessions outside the pinned group.
 */
export function filterDirectorySessionsByStatus(
  directories: Array<string>,
  sessionsByDirectory: Record<string, Array<SessionListEntry>>,
  filter: SessionStatusFilter | SessionStatusFilters,
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
