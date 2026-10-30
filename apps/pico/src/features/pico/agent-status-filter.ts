import * as React from "react"

import type { AgentListEntry } from "@/lib/pico/api"

/**
 * A filter of the sidebar agents by their state. A click on a count in a
 * machine heading turns its state on or off; more than one state can be on.
 * It is window state for each machine, so the heading and the agents of the
 * machine use it.
 */
export type AgentStatusFilter = "working" | "waiting" | "done"

/** The states that are on, in a fixed order. Never empty. */
export type AgentStatusFilters = ReadonlyArray<AgentStatusFilter>

const FILTER_ORDER: ReadonlyArray<AgentStatusFilter> = [
  "waiting",
  "working",
  "done",
]

let snapshot: Record<string, AgentStatusFilters> = {}
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
  current: AgentStatusFilters | null,
  filter: AgentStatusFilter
): AgentStatusFilters | null {
  const on = new Set(current ?? [])
  if (on.has(filter)) on.delete(filter)
  else on.add(filter)
  const next = FILTER_ORDER.filter((item) => on.has(item))
  return next.length > 0 ? next : null
}

export function setAgentStatusFilter(
  machineId: string,
  filters: AgentStatusFilters | null
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

export function toggleAgentStatusFilter(
  machineId: string,
  filter: AgentStatusFilter
) {
  setAgentStatusFilter(
    machineId,
    toggleStatusFilter(snapshot[machineId] ?? null, filter)
  )
}

/** The states that are on for the machine, or null when there is no filter. */
export function useAgentStatusFilter(machineId: string) {
  return React.useSyncExternalStore(
    subscribe,
    () => snapshot[machineId] ?? null,
    () => null
  )
}

/** The same rules as the counts in the machine heading. */
export function agentMatchesStatusFilter(
  entry: AgentListEntry,
  filter: AgentStatusFilter | AgentStatusFilters
): boolean {
  if (typeof filter !== "string")
    return filter.some((item) => agentMatchesStatusFilter(entry, item))
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
 * Keeps only the agents with a state of the filter, and only the
 * projects that still have agents outside the pinned group.
 */
export function filterProjectAgentsByStatus(
  projects: Array<string>,
  agentsByProject: Record<string, Array<AgentListEntry>>,
  filter: AgentStatusFilter | AgentStatusFilters,
  isPinned: (entry: AgentListEntry) => boolean
) {
  const visibleProjects: Array<string> = []
  const filteredAgents: Record<string, Array<AgentListEntry>> = {}
  for (const project of projects) {
    const agents = (agentsByProject[project] ?? []).filter((entry) =>
      agentMatchesStatusFilter(entry, filter)
    )
    filteredAgents[project] = agents
    if (agents.some((entry) => !isPinned(entry))) visibleProjects.push(project)
  }
  return { visibleProjects, filteredAgents }
}
