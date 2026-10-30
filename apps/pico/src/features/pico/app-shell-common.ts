import * as React from "react"

import type { AgentState } from "@/lib/pico"
import type { AgentDoneEvent, AgentListEntry } from "@/lib/pico/api"
import { getAgentTitle, agentListEntryKey } from "@/lib/pico"
import { picoAgentScopeKey } from "@/features/pico/query-keys"

export function agentNotificationKey(agentLike: {
  agentFile?: string | undefined
  agentPath?: string | undefined
  path?: string | undefined
  agentId?: string | undefined
  id?: string | undefined
}) {
  const agentFile = (
    agentLike.agentFile ||
    agentLike.agentPath ||
    agentLike.path ||
    ""
  ).trim()
  if (agentFile) return `path:${agentFile}`

  const agentId = (agentLike.agentId || agentLike.id || "").trim()
  if (agentId) return `id:${agentId}`

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

function finishedAgentLabel(title: string) {
  return title !== "New agent" ? `Agent finished: ${title}` : "Agent finished"
}

export function doneEventLabel(event: AgentDoneEvent) {
  const title = event.title?.trim() || "New agent"
  if (event.reason === "manual_compaction") {
    return title !== "New agent"
      ? `Compaction complete: ${title}`
      : "Compaction complete"
  }

  if (event.outcome === "error") {
    return title !== "New agent" ? `Agent stopped: ${title}` : "Agent stopped"
  }

  return finishedAgentLabel(title)
}

export function agentScrollKey(agentState: {
  draft: boolean
  agentFile?: string
  agentId?: string
  cwd?: string
}) {
  return picoAgentScopeKey(agentState)
}

export function resolveNewAgentCwd(options: {
  cwdOverride?: string | undefined
  defaultDirectory?: string | undefined
  currentCwd?: string | undefined
}) {
  return (
    options.cwdOverride?.trim() ||
    options.defaultDirectory?.trim() ||
    options.currentCwd?.trim() ||
    undefined
  )
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

export function findSidebarAgentSelectionKey(
  entriesByKey: Map<string, AgentListEntry>,
  agentLike: {
    agentId?: string | undefined
    agentPath?: string | undefined
  }
) {
  const agentPath = agentLike.agentPath?.trim() || ""
  const agentId = agentLike.agentId?.trim() || ""

  if (agentPath) {
    const pathKey = agentListEntryKey({ path: agentPath })
    if (entriesByKey.has(pathKey)) return pathKey
  }

  if (agentId) {
    const idKey = agentListEntryKey({ id: agentId })
    if (entriesByKey.has(idKey)) return idKey
  }

  for (const [key, entry] of entriesByKey) {
    if (
      (agentPath && entry.path === agentPath) ||
      (agentId && entry.id === agentId)
    ) {
      return key
    }
  }

  return ""
}

export function getCurrentAgentTitleFromState(
  agentState: Pick<AgentState, "firstMessage" | "agentName">
) {
  return getAgentTitle({
    title: agentState.agentName || agentState.firstMessage || "New agent",
    name: agentState.agentName,
  })
}
