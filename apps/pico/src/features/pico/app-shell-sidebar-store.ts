import * as React from "react"

import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  applyStoreAction,
  createPicoStore,
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import type { DirectoryState } from "@/lib/pico"
import { normalizeStoredDirectoryList, agentListEntryKey } from "@/lib/pico"
import type {
  DirectoryAgentsIndexSnapshot,
  DirectoryAgentsIndexesResponse,
  AgentListEntry,
  AgentStatusEvent,
  AgentsEvent,
} from "@/lib/pico/api"
import { isInShownMachineShell } from "@/lib/pico/machine-context"

export type DirectoryAgentsIndexData = DirectoryAgentsIndexSnapshot
type DirectoryAgentsIndexesData = Extract<
  DirectoryAgentsIndexesResponse,
  { ok: true }
>

function sidebarTextContains(text: string, query: string) {
  return text.indexOf(query) >= 0
}

type AppShellSidebarSnapshot = {
  baseSidebarDirectories: Array<string>
  directoryStateByPath: Map<string, DirectoryState>
  directoryIndexes: Record<string, Array<AgentListEntry>>
  sidebarAgents: Array<AgentListEntry>
  pinnedSidebarAgents: Array<AgentListEntry>
  selectedSidebarAgents: Array<AgentListEntry>
  sidebarAgentEntriesByKey: Map<string, AgentListEntry>
}

type AppShellSidebarState = {
  agentsEvent: AgentsEvent | null
  activeSidebarAgentId: string
  activeSidebarAgentKey: string
  activeSidebarAgentPath: string
  sidebarDirectories: Array<string>
  initialSidebarBootstrapDirectories: Array<string>
  directoryIndexDataByPath: Record<string, DirectoryAgentsIndexData>
  directoryIndexLoading: Record<string, boolean>
  sidebarAgentStatusByKey: SidebarAgentStatusMap
  sidebarDeferredDirectoryLoadingReady: boolean
  agentSearch: string
  pinnedSidebarAgentKeys: Array<string>
  selectedSidebarAgentKeys: Array<string>
  sidebarAgentSelectionAnchor: string
}

type AppShellSidebarDerived = AppShellSidebarSnapshot & {
  sidebarDirectoryIndexes: Record<string, Array<AgentListEntry>>
  visibleDirectories: Array<string>
  filteredDirectoryAgents: Record<string, Array<AgentListEntry>>
  emptySidebarStateText: string
  workspaceVersion: string
}

export type AppShellSidebarStoreSnapshot = {
  state: AppShellSidebarState
  derived: AppShellSidebarDerived
  revision: number
}

type AppShellSidebarStateUpdate =
  | Partial<AppShellSidebarState>
  | ((
      current: AppShellSidebarState
    ) => Partial<AppShellSidebarState> | AppShellSidebarState)

export type AppShellSidebarStore = PicoStore<AppShellSidebarStoreSnapshot> & {
  getWorkspaceSnapshot: () => AppShellSidebarSnapshot
  getWorkspaceVersion: () => string
  setSidebarState: (update: AppShellSidebarStateUpdate) => void
  setAgentsEvent: React.Dispatch<React.SetStateAction<AgentsEvent | null>>
  setSidebarDirectories: React.Dispatch<React.SetStateAction<Array<string>>>
  setDirectoryIndexDataByPath: React.Dispatch<
    React.SetStateAction<Record<string, DirectoryAgentsIndexData>>
  >
  setDirectoryIndexLoading: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >
  setSidebarAgentStatusByKey: React.Dispatch<
    React.SetStateAction<SidebarAgentStatusMap>
  >
  setSidebarDeferredDirectoryLoadingReady: React.Dispatch<
    React.SetStateAction<boolean>
  >
  setAgentSearch: React.Dispatch<React.SetStateAction<string>>
  setPinnedSidebarAgentKeys: React.Dispatch<React.SetStateAction<Array<string>>>
  setSelectedSidebarAgentKeys: React.Dispatch<
    React.SetStateAction<Array<string>>
  >
  setSidebarAgentSelectionAnchor: React.Dispatch<React.SetStateAction<string>>
}

function sameStringArray(left: Array<string>, right: Array<string>) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }

  return true
}

function sameReferenceArray<T>(left: Array<T>, right: Array<T>) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }

  return true
}

export async function fetchDirectoryAgentsIndexes(options: {
  machineId: string
  viewerContextId: string
  directories: Array<string>
}) {
  const directories = normalizeStoredDirectoryList(options.directories)
  if (directories.length === 0) {
    return {
      ok: true,
      directories: [],
      directoryIndexes: {},
    } satisfies DirectoryAgentsIndexesData
  }

  return await fetchJson<DirectoryAgentsIndexesData>(
    buildRequestUrl("/api/project-agents-indexes", {
      machineId: options.machineId,
      contextId: options.viewerContextId,
      searchParams: {
        directory: directories,
      },
    })
  )
}

export function mergeDirectoryIndexData(
  current: Record<string, DirectoryAgentsIndexData>,
  next: Record<string, DirectoryAgentsIndexData>
) {
  let changed = false
  const merged = { ...current }

  for (const [directory, payload] of Object.entries(next)) {
    if (JSON.stringify(current[directory]) === JSON.stringify(payload)) {
      continue
    }

    merged[directory] = payload
    changed = true
  }

  return changed ? merged : current
}

export function sameDirectoryIndexDataRecord(
  left: Record<string, DirectoryAgentsIndexData>,
  right: Record<string, DirectoryAgentsIndexData>
) {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (!sameStringArray(leftKeys, rightKeys)) return false

  for (const key of leftKeys) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false
  }

  return true
}

export function updateDirectoryIndexLoadingState(
  current: Record<string, boolean>,
  directories: Array<string>,
  loading: boolean
) {
  let changed = false
  const next = { ...current }

  for (const directory of directories) {
    if (Boolean(current[directory]) === loading) continue
    next[directory] = loading
    changed = true
  }

  return changed ? next : current
}

function normalizeOptimisticSidebarPreview(value: string) {
  const text = value.replace(/\s+/g, " ").trim()
  if (!text) return ""
  if (text.length <= 240) return text
  return `${text.slice(0, 239).trimEnd()}…`
}

function sidebarEntryMatchesIdentity(
  entry: AgentListEntry,
  identity: { agentId?: string; agentPath?: string }
) {
  const agentId = identity.agentId?.trim() || ""
  const agentPath = identity.agentPath?.trim() || ""

  return Boolean(
    (agentPath && entry.path === agentPath) || (agentId && entry.id === agentId)
  )
}

export function upsertOptimisticSidebarAgentEntry(
  current: Record<string, DirectoryAgentsIndexData>,
  entry: AgentListEntry & { cwd: string; id: string }
) {
  const directory = entry.cwd.trim()
  const optimisticId = entry.id.trim()
  if (!directory || !optimisticId) return current

  const currentSnapshot = current[directory]
  const currentAgents = currentSnapshot?.agents || []
  const existingEntry = currentAgents.find((agent) => agent.id === optimisticId)
  const nextEntry = {
    ...existingEntry,
    ...entry,
    id: optimisticId,
    cwd: directory,
    optimistic: true,
  } satisfies AgentListEntry
  const nextAgents = [
    nextEntry,
    ...currentAgents.filter((agent) => agent.id !== optimisticId),
  ]
  const totalCountBaseline = Math.max(
    currentSnapshot?.totalCount ?? 0,
    currentAgents.length
  )

  return {
    ...current,
    [directory]: {
      directory,
      totalCount: existingEntry ? totalCountBaseline : totalCountBaseline + 1,
      revision: `optimistic:${optimisticId}:${
        currentSnapshot?.revision || "initial"
      }:${entry.modified || ""}`,
      agents: nextAgents,
    },
  }
}

export function updateOptimisticSidebarAgentPreviewEntry(
  current: Record<string, DirectoryAgentsIndexData>,
  options: {
    agentId?: string
    agentPath?: string
    preview: string
    modified: string
  }
) {
  const preview = normalizeOptimisticSidebarPreview(options.preview)
  if (!preview) return current

  let changed = false
  const next: Record<string, DirectoryAgentsIndexData> = { ...current }

  for (const [directory, snapshot] of Object.entries(current)) {
    const updatedEntries: Array<AgentListEntry> = []
    let agentsChanged = false

    const agents = snapshot.agents.map((entry) => {
      if (!sidebarEntryMatchesIdentity(entry, options)) return entry

      const nextEntry = {
        ...entry,
        modified: options.modified,
        lastUserMessageAt: options.modified,
        lastMessageAt: options.modified,
        lastMessagePreview: preview,
        streaming: true,
        unread: false,
      } satisfies AgentListEntry

      updatedEntries.push(nextEntry)
      agentsChanged ||= nextEntry !== entry
      return nextEntry
    })

    if (!agentsChanged) continue

    const updatedKeys = new Set(updatedEntries.map(agentListEntryKey))
    next[directory] = {
      ...snapshot,
      revision: `optimistic-preview:${options.modified}:${snapshot.revision}`,
      agents: [
        ...updatedEntries,
        ...agents.filter((entry) => !updatedKeys.has(agentListEntryKey(entry))),
      ],
    }
    changed = true
  }

  return changed ? next : current
}

export function removeOptimisticSidebarAgentEntry(
  current: Record<string, DirectoryAgentsIndexData>,
  optimisticId: string | undefined
) {
  const targetId = optimisticId?.trim() || ""
  if (!targetId) return current

  let changed = false
  const next: Record<string, DirectoryAgentsIndexData> = { ...current }

  for (const [directory, snapshot] of Object.entries(current)) {
    const nextAgents = snapshot.agents.filter((entry) => entry.id !== targetId)
    if (nextAgents.length === snapshot.agents.length) continue

    changed = true
    next[directory] = {
      ...snapshot,
      totalCount: Math.max(0, snapshot.totalCount - 1),
      revision: `remove-optimistic:${targetId}:${snapshot.revision}`,
      agents: nextAgents,
    }
  }

  return changed ? next : current
}

/**
 * Give the optimistic entries of a directory the identity of the agent that
 * the server made for the draft. A directory index fetch keeps optimistic
 * entries until the server lists their ID. Without this step, the draft ID
 * never shows in the index, and the sidebar shows the placeholder next to the
 * real agent.
 */
export function bindOptimisticSidebarAgentEntries(
  current: Record<string, DirectoryAgentsIndexData>,
  agent: { cwd?: string; agentId?: string; agentPath?: string }
) {
  const directory = agent.cwd?.trim() || ""
  const agentId = agent.agentId?.trim() || ""
  const agentPath = agent.agentPath?.trim() || ""
  const snapshot = directory ? current[directory] : undefined
  if (!snapshot || !agentId) return current

  const pending = snapshot.agents.filter(
    (entry) => isOptimisticSidebarAgentEntry(entry) && !entry.path
  )
  if (pending.length === 0) return current

  const listed = snapshot.agents.some(
    (entry) =>
      !isOptimisticSidebarAgentEntry(entry) &&
      (entry.id === agentId || (agentPath && entry.path === agentPath))
  )
  const [first] = pending
  const agents = snapshot.agents.flatMap((entry) => {
    if (!pending.includes(entry)) return [entry]
    if (listed || entry !== first) return []
    return [
      {
        ...entry,
        id: agentId,
        ...(agentPath ? { path: agentPath } : {}),
        optimistic: true,
      } satisfies AgentListEntry,
    ]
  })
  const removed = snapshot.agents.length - agents.length

  return {
    ...current,
    [directory]: {
      ...snapshot,
      totalCount: Math.max(0, snapshot.totalCount - removed),
      revision: `bind-optimistic:${agentId}:${snapshot.revision}`,
      agents,
    },
  }
}

/**
 * Give one optimistic entry the identity of the agent that the server made
 * for it. The prompt response names this agent, so this step does not
 * depend on a state sync that shows the draft change into an agent. If the
 * directory already lists the real agent, remove the placeholder.
 */
export function bindOptimisticSidebarAgentEntryById(
  current: Record<string, DirectoryAgentsIndexData>,
  optimisticId: string | undefined,
  agent: { agentId?: string; agentPath?: string }
) {
  const targetId = optimisticId?.trim() || ""
  const agentId = agent.agentId?.trim() || ""
  const agentPath = agent.agentPath?.trim() || ""
  if (!targetId || !agentId || targetId === agentId) return current

  let changed = false
  const next: Record<string, DirectoryAgentsIndexData> = { ...current }

  for (const [directory, snapshot] of Object.entries(current)) {
    const placeholder = snapshot.agents.find(
      (entry) => entry.id === targetId && isOptimisticSidebarAgentEntry(entry)
    )
    if (!placeholder) continue

    const listed = snapshot.agents.some(
      (entry) =>
        entry !== placeholder &&
        (entry.id === agentId || (agentPath && entry.path === agentPath))
    )
    const agents = snapshot.agents.flatMap((entry) => {
      if (entry !== placeholder) return [entry]
      if (listed) return []
      return [
        {
          ...entry,
          id: agentId,
          ...(agentPath ? { path: agentPath } : {}),
          optimistic: true,
        } satisfies AgentListEntry,
      ]
    })

    changed = true
    next[directory] = {
      ...snapshot,
      totalCount: listed
        ? Math.max(0, snapshot.totalCount - 1)
        : snapshot.totalCount,
      revision: `bind-optimistic:${agentId}:${snapshot.revision}`,
      agents,
    }
  }

  return changed ? next : current
}

export function isOptimisticSidebarAgentEntry(entry: AgentListEntry) {
  return Boolean(
    entry.optimistic || (entry.id?.startsWith("optimistic:") && !entry.path)
  )
}

export function mergeDirectoryIndexDataPreservingOptimistic(
  current: Record<string, DirectoryAgentsIndexData>,
  next: Record<string, DirectoryAgentsIndexData>
) {
  let merged = mergeDirectoryIndexData(current, next)

  for (const [directory, snapshot] of Object.entries(current)) {
    const optimisticAgents = snapshot.agents.filter(
      isOptimisticSidebarAgentEntry
    )
    if (optimisticAgents.length === 0) continue

    const targetSnapshot = merged[directory]
    if (!targetSnapshot) continue

    const targetIds = new Set(
      targetSnapshot.agents.flatMap((entry) => (entry.id ? [entry.id] : []))
    )
    const missingOptimisticAgents = optimisticAgents.filter(
      (entry) => entry.id && !targetIds.has(entry.id)
    )
    if (missingOptimisticAgents.length === 0) continue

    merged = {
      ...merged,
      [directory]: {
        ...targetSnapshot,
        totalCount: targetSnapshot.totalCount + missingOptimisticAgents.length,
        revision: `preserve-optimistic:${targetSnapshot.revision}`,
        agents: [...missingOptimisticAgents, ...targetSnapshot.agents],
      },
    }
  }

  return merged
}

export function sameAgentEntryRecord(
  left: Record<string, Array<AgentListEntry>>,
  right: Record<string, Array<AgentListEntry>>
) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (!sameStringArray(leftKeys.sort(), rightKeys.sort())) return false

  for (const key of leftKeys) {
    if (!sameReferenceArray(left[key] || [], right[key] || [])) return false
  }

  return true
}

export function getRenderedSidebarAgentKeys() {
  if (typeof document === "undefined") return []

  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-sidebar-agent-item]")
  ).flatMap((element) => {
    if (!isInShownMachineShell(element)) return []
    const key = element.dataset.agentKey?.trim() || ""
    return key.length > 0 ? [key] : []
  })
}

export function clearUnreadForActiveSidebarAgent(
  current: Record<string, DirectoryAgentsIndexData>,
  activeAgent: {
    agentId?: string
    agentPath?: string
  }
) {
  const activeAgentId = activeAgent.agentId?.trim() || ""
  const activeAgentPath = activeAgent.agentPath?.trim() || ""
  if (!activeAgentId && !activeAgentPath) {
    return current
  }

  let changed = false
  const next: Record<string, DirectoryAgentsIndexData> = { ...current }

  for (const [directory, snapshot] of Object.entries(current)) {
    let agentsChanged = false
    const agents = snapshot.agents.map((entry) => {
      const matchesActiveAgent =
        (activeAgentId && entry.id === activeAgentId) ||
        (activeAgentPath && entry.path === activeAgentPath)
      if (!matchesActiveAgent || !entry.unread) {
        return entry
      }

      agentsChanged = true
      changed = true
      return {
        ...entry,
        unread: false,
      }
    })

    if (agentsChanged) {
      next[directory] = {
        ...snapshot,
        agents,
      }
    }
  }

  return changed ? next : current
}

type SidebarAgentStatus = Omit<AgentStatusEvent, "type">
type SidebarAgentStatusMap = Record<string, SidebarAgentStatus>

function sidebarAgentStatusKeys(status: SidebarAgentStatus) {
  const keys: Array<string> = []
  const agentPath = status.agentPath?.trim() || ""
  const agentId = status.agentId?.trim() || ""
  const agentKey = status.agentKey?.trim() || ""

  if (agentPath) keys.push(`path:${agentPath}`)
  if (agentId) keys.push(`id:${agentId}`)
  if (agentKey) keys.push(`key:${agentKey}`)

  return keys
}

function sameSidebarAgentStatus(
  left: SidebarAgentStatus | undefined,
  right: SidebarAgentStatus
) {
  return (
    left?.agentKey === right.agentKey &&
    left?.agentId === right.agentId &&
    left?.agentPath === right.agentPath &&
    left?.streaming === right.streaming &&
    left?.unread === right.unread &&
    left?.needsInput === right.needsInput &&
    left?.waiting === right.waiting
  )
}

export function mergeSidebarAgentStatusMap(
  current: SidebarAgentStatusMap,
  event: AgentStatusEvent
) {
  const keys = sidebarAgentStatusKeys(event)
  if (keys.length === 0) return current

  let changed = false
  const next: SidebarAgentStatusMap = { ...current }

  for (const key of keys) {
    const previous = current[key]
    const status: SidebarAgentStatus = {
      agentKey: event.agentKey ?? previous?.agentKey,
      agentId: event.agentId ?? previous?.agentId,
      agentPath: event.agentPath ?? previous?.agentPath,
      streaming:
        typeof event.streaming === "boolean"
          ? event.streaming
          : previous?.streaming,
      unread:
        typeof event.unread === "boolean" ? event.unread : previous?.unread,
      needsInput:
        typeof event.needsInput === "boolean"
          ? event.needsInput
          : previous?.needsInput,
      waiting:
        typeof event.waiting === "string" ? event.waiting : previous?.waiting,
    }

    if (sameSidebarAgentStatus(previous, status)) continue
    next[key] = status
    changed = true
  }

  return changed ? next : current
}

function sidebarStatusForEntry(
  entry: AgentListEntry,
  statuses: SidebarAgentStatusMap
) {
  const pathKey = entry.path ? `path:${entry.path}` : ""
  const idKey = entry.id ? `id:${entry.id}` : ""
  return (
    (pathKey ? statuses[pathKey] : undefined) ||
    (idKey ? statuses[idKey] : undefined)
  )
}

function applySidebarAgentStatus(
  entry: AgentListEntry,
  status: SidebarAgentStatus | undefined
) {
  if (!status) return entry

  const nextStreaming =
    typeof status.streaming === "boolean" ? status.streaming : entry.streaming
  const nextUnread =
    typeof status.unread === "boolean" ? status.unread : entry.unread
  const nextNeedsInput =
    typeof status.needsInput === "boolean"
      ? status.needsInput
      : entry.needsInput
  // An empty string: the agent waits on nothing.
  const nextWaiting =
    (typeof status.waiting === "string" ? status.waiting : entry.waiting) ||
    undefined

  if (
    Boolean(entry.streaming) === Boolean(nextStreaming) &&
    Boolean(entry.unread) === Boolean(nextUnread) &&
    Boolean(entry.needsInput) === Boolean(nextNeedsInput) &&
    entry.waiting === nextWaiting
  ) {
    return entry
  }

  const { waiting: _waiting, ...rest } = entry
  return {
    ...rest,
    streaming: nextStreaming,
    unread: nextUnread,
    needsInput: nextNeedsInput,
    ...(nextWaiting ? { waiting: nextWaiting } : {}),
  }
}

function applySidebarAgentStatusOverlay(
  indexes: Record<string, Array<AgentListEntry>>,
  statuses: SidebarAgentStatusMap
) {
  if (Object.keys(statuses).length === 0) return indexes

  let changed = false
  const nextIndexes: Record<string, Array<AgentListEntry>> = {}

  for (const [directory, agents] of Object.entries(indexes)) {
    let agentsChanged = false
    const nextAgents = agents.map((entry) => {
      const nextEntry = applySidebarAgentStatus(
        entry,
        sidebarStatusForEntry(entry, statuses)
      )
      if (nextEntry !== entry) {
        agentsChanged = true
        changed = true
      }
      return nextEntry
    })

    nextIndexes[directory] = agentsChanged ? nextAgents : agents
  }

  return changed ? nextIndexes : indexes
}

function createInitialSidebarState(): AppShellSidebarState {
  return {
    agentsEvent: null,
    activeSidebarAgentId: "",
    activeSidebarAgentKey: "",
    activeSidebarAgentPath: "",
    sidebarDirectories: [],
    initialSidebarBootstrapDirectories: [],
    directoryIndexDataByPath: {},
    directoryIndexLoading: {},
    sidebarAgentStatusByKey: {},
    sidebarDeferredDirectoryLoadingReady: false,
    agentSearch: "",
    pinnedSidebarAgentKeys: [],
    selectedSidebarAgentKeys: [],
    sidebarAgentSelectionAnchor: "",
  }
}

function computeAppShellSidebarDerived(
  state: AppShellSidebarState
): AppShellSidebarDerived {
  const directoryStates = state.agentsEvent?.directoryStates || []
  const directoryStateByPath = new Map(
    directoryStates.map((directoryState) => [
      directoryState.path,
      directoryState,
    ])
  )
  const baseSidebarDirectories = normalizeStoredDirectoryList(
    state.sidebarDirectories
  )
  const directoryIndexes: Record<string, Array<AgentListEntry>> = {}

  for (const directory of baseSidebarDirectories) {
    directoryIndexes[directory] =
      state.directoryIndexDataByPath[directory]?.agents || []
  }

  const sidebarDirectoryIndexes = applySidebarAgentStatusOverlay(
    directoryIndexes,
    state.sidebarAgentStatusByKey
  )
  const query = state.agentSearch.trim().toLowerCase()
  const sidebarSearchPending = query
    ? baseSidebarDirectories.some((directory) => {
        const totalCount = directoryStateByPath.get(directory)?.totalCount ?? 0
        const loadedCount = Object.prototype.hasOwnProperty.call(
          directoryIndexes,
          directory
        )
          ? directoryIndexes[directory].length
          : 0
        const loading = Boolean(state.directoryIndexLoading[directory])
        return loading || (!loadedCount && totalCount > 0)
      })
    : false
  const visibleDirectories: Array<string> = []
  const filteredDirectoryAgents: Record<string, Array<AgentListEntry>> = {}

  for (const directory of baseSidebarDirectories) {
    const agents = Object.prototype.hasOwnProperty.call(
      sidebarDirectoryIndexes,
      directory
    )
      ? sidebarDirectoryIndexes[directory]
      : []

    if (!query) {
      visibleDirectories.push(directory)
      filteredDirectoryAgents[directory] = agents
      continue
    }

    const directoryMatches = sidebarTextContains(directory.toLowerCase(), query)
    const filteredAgents = directoryMatches
      ? agents
      : agents.filter((entry) => {
          const haystack = [entry.title, entry.name, entry.path, entry.cwd]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
          return sidebarTextContains(haystack, query)
        })

    if (directoryMatches || filteredAgents.length > 0) {
      visibleDirectories.push(directory)
      filteredDirectoryAgents[directory] = filteredAgents
    }
  }

  const sidebarAgentEntriesByKey = new Map<string, AgentListEntry>()
  for (const directory of baseSidebarDirectories) {
    const entries = Object.prototype.hasOwnProperty.call(
      sidebarDirectoryIndexes,
      directory
    )
      ? sidebarDirectoryIndexes[directory]
      : []

    for (const entry of entries) {
      const key = agentListEntryKey(entry)
      if (!key || sidebarAgentEntriesByKey.has(key)) continue
      sidebarAgentEntriesByKey.set(key, entry)
    }
  }

  const sidebarAgents = Array.from(sidebarAgentEntriesByKey.values())
  const pinnedSidebarAgents = state.pinnedSidebarAgentKeys.flatMap((key) => {
    const entry = sidebarAgentEntriesByKey.get(key)
    return entry?.path || (entry?.id && !isOptimisticSidebarAgentEntry(entry))
      ? [entry]
      : []
  })
  const selectedSidebarAgents = state.selectedSidebarAgentKeys.flatMap(
    (key) => {
      const entry = sidebarAgentEntriesByKey.get(key)
      return entry?.path || (entry?.id && !isOptimisticSidebarAgentEntry(entry))
        ? [entry]
        : []
    }
  )
  const workspaceVersion = [
    baseSidebarDirectories.join("\n"),
    state.pinnedSidebarAgentKeys.join("\n"),
    state.selectedSidebarAgentKeys.join("\n"),
  ].join("\0")

  return {
    baseSidebarDirectories,
    directoryStateByPath,
    directoryIndexes: sidebarDirectoryIndexes,
    sidebarDirectoryIndexes,
    sidebarAgents,
    pinnedSidebarAgents,
    selectedSidebarAgents,
    sidebarAgentEntriesByKey,
    visibleDirectories,
    filteredDirectoryAgents,
    emptySidebarStateText: query
      ? sidebarSearchPending
        ? "Searching agents…"
        : "No agents or directories match your search."
      : baseSidebarDirectories.length > 0
        ? "No directories match this view."
        : "No directories added yet.",
    workspaceVersion,
  }
}

export function createAppShellSidebarStore(): AppShellSidebarStore {
  const initialState = createInitialSidebarState()
  const store = createPicoStore<AppShellSidebarStoreSnapshot>({
    state: initialState,
    derived: computeAppShellSidebarDerived(initialState),
    revision: 0,
  }) as AppShellSidebarStore

  const setSidebarState = (update: AppShellSidebarStateUpdate) => {
    const currentState = store.state.state
    const partial = typeof update === "function" ? update(currentState) : update
    if (partial === currentState) return

    const entries = Object.entries(partial) as Array<
      [
        keyof AppShellSidebarState,
        AppShellSidebarState[keyof AppShellSidebarState],
      ]
    >
    if (entries.every(([key, value]) => Object.is(currentState[key], value))) {
      return
    }

    const nextState = {
      ...currentState,
      ...partial,
    }

    store.setState((current) => ({
      state: nextState,
      derived: computeAppShellSidebarDerived(nextState),
      revision: current.revision + 1,
    }))
  }

  Object.assign(store, {
    getWorkspaceSnapshot: () => store.state.derived,
    getWorkspaceVersion: () => store.state.derived.workspaceVersion,
    setSidebarState,
    setAgentsEvent: (action) => {
      const agentsEvent = applyStoreAction(
        store.state.state.agentsEvent,
        action
      )
      if (agentsEvent === store.state.state.agentsEvent) return
      setSidebarState({ agentsEvent })
    },
    setSidebarDirectories: (action) => {
      const sidebarDirectories = applyStoreAction(
        store.state.state.sidebarDirectories,
        action
      )
      if (sidebarDirectories === store.state.state.sidebarDirectories) return
      setSidebarState({ sidebarDirectories })
    },
    setDirectoryIndexDataByPath: (action) => {
      const directoryIndexDataByPath = applyStoreAction(
        store.state.state.directoryIndexDataByPath,
        action
      )
      if (
        directoryIndexDataByPath === store.state.state.directoryIndexDataByPath
      ) {
        return
      }
      setSidebarState({ directoryIndexDataByPath })
    },
    setDirectoryIndexLoading: (action) => {
      const directoryIndexLoading = applyStoreAction(
        store.state.state.directoryIndexLoading,
        action
      )
      if (directoryIndexLoading === store.state.state.directoryIndexLoading)
        return
      setSidebarState({ directoryIndexLoading })
    },
    setSidebarAgentStatusByKey: (action) => {
      const sidebarAgentStatusByKey = applyStoreAction(
        store.state.state.sidebarAgentStatusByKey,
        action
      )
      if (
        sidebarAgentStatusByKey === store.state.state.sidebarAgentStatusByKey
      ) {
        return
      }
      setSidebarState({ sidebarAgentStatusByKey })
    },
    setSidebarDeferredDirectoryLoadingReady: (action) => {
      const sidebarDeferredDirectoryLoadingReady = applyStoreAction(
        store.state.state.sidebarDeferredDirectoryLoadingReady,
        action
      )
      if (
        sidebarDeferredDirectoryLoadingReady ===
        store.state.state.sidebarDeferredDirectoryLoadingReady
      ) {
        return
      }
      setSidebarState({ sidebarDeferredDirectoryLoadingReady })
    },
    setAgentSearch: (action) => {
      const agentSearch = applyStoreAction(
        store.state.state.agentSearch,
        action
      )
      if (agentSearch === store.state.state.agentSearch) return
      setSidebarState({ agentSearch })
    },
    setPinnedSidebarAgentKeys: (action) => {
      const pinnedSidebarAgentKeys = applyStoreAction(
        store.state.state.pinnedSidebarAgentKeys,
        action
      )
      if (pinnedSidebarAgentKeys === store.state.state.pinnedSidebarAgentKeys) {
        return
      }
      setSidebarState({ pinnedSidebarAgentKeys })
    },
    setSelectedSidebarAgentKeys: (action) => {
      const selectedSidebarAgentKeys = applyStoreAction(
        store.state.state.selectedSidebarAgentKeys,
        action
      )
      if (
        selectedSidebarAgentKeys === store.state.state.selectedSidebarAgentKeys
      ) {
        return
      }
      setSidebarState({ selectedSidebarAgentKeys })
    },
    setSidebarAgentSelectionAnchor: (action) => {
      const sidebarAgentSelectionAnchor = applyStoreAction(
        store.state.state.sidebarAgentSelectionAnchor,
        action
      )
      if (
        sidebarAgentSelectionAnchor ===
        store.state.state.sidebarAgentSelectionAnchor
      ) {
        return
      }
      setSidebarState({ sidebarAgentSelectionAnchor })
    },
  } satisfies Omit<
    AppShellSidebarStore,
    keyof PicoStore<AppShellSidebarStoreSnapshot>
  >)

  return store
}

export function useAppShellSidebarValue<T>(
  store: AppShellSidebarStore,
  selector: (snapshot: AppShellSidebarStoreSnapshot) => T,
  isEqual: (left: T, right: T) => boolean = Object.is
) {
  return useSelector(store, selector, { compare: isEqual })
}
