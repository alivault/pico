import * as React from "react"

import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  applyStoreAction,
  createPicoStore,
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import type { ProjectState } from "@/lib/pico"
import { normalizeStoredProjectList, agentListEntryKey } from "@/lib/pico"
import type {
  ProjectAgentsIndexSnapshot,
  ProjectAgentsIndexesResponse,
  AgentListEntry,
  AgentStatusEvent,
  AgentsEvent,
} from "@/lib/pico/api"
import { isInShownMachineShell } from "@/lib/pico/machine-context"

export type ProjectAgentsIndexData = ProjectAgentsIndexSnapshot
type ProjectAgentsIndexesData = Extract<
  ProjectAgentsIndexesResponse,
  { ok: true }
>

function sidebarTextContains(text: string, query: string) {
  return text.indexOf(query) >= 0
}

type AppShellSidebarSnapshot = {
  baseSidebarProjects: Array<string>
  projectStateByPath: Map<string, ProjectState>
  projectIndexes: Record<string, Array<AgentListEntry>>
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
  sidebarProjects: Array<string>
  initialSidebarBootstrapProjects: Array<string>
  projectIndexDataByPath: Record<string, ProjectAgentsIndexData>
  projectIndexLoading: Record<string, boolean>
  sidebarAgentStatusByKey: SidebarAgentStatusMap
  sidebarDeferredProjectLoadingReady: boolean
  agentSearch: string
  pinnedSidebarAgentKeys: Array<string>
  selectedSidebarAgentKeys: Array<string>
  sidebarAgentSelectionAnchor: string
}

type AppShellSidebarDerived = AppShellSidebarSnapshot & {
  sidebarProjectIndexes: Record<string, Array<AgentListEntry>>
  visibleProjects: Array<string>
  filteredProjectAgents: Record<string, Array<AgentListEntry>>
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
  setSidebarProjects: React.Dispatch<React.SetStateAction<Array<string>>>
  setProjectIndexDataByPath: React.Dispatch<
    React.SetStateAction<Record<string, ProjectAgentsIndexData>>
  >
  setProjectIndexLoading: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >
  setSidebarAgentStatusByKey: React.Dispatch<
    React.SetStateAction<SidebarAgentStatusMap>
  >
  setSidebarDeferredProjectLoadingReady: React.Dispatch<
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

export async function fetchProjectAgentsIndexes(options: {
  machineId: string
  viewerContextId: string
  projects: Array<string>
}) {
  const projects = normalizeStoredProjectList(options.projects)
  if (projects.length === 0) {
    return {
      ok: true,
      projects: [],
      projectIndexes: {},
    } satisfies ProjectAgentsIndexesData
  }

  return await fetchJson<ProjectAgentsIndexesData>(
    buildRequestUrl("/api/project-agents-indexes", {
      machineId: options.machineId,
      contextId: options.viewerContextId,
      searchParams: {
        project: projects,
      },
    })
  )
}

export function mergeProjectIndexData(
  current: Record<string, ProjectAgentsIndexData>,
  next: Record<string, ProjectAgentsIndexData>
) {
  let changed = false
  const merged = { ...current }

  for (const [project, payload] of Object.entries(next)) {
    if (JSON.stringify(current[project]) === JSON.stringify(payload)) {
      continue
    }

    merged[project] = payload
    changed = true
  }

  return changed ? merged : current
}

export function sameProjectIndexDataRecord(
  left: Record<string, ProjectAgentsIndexData>,
  right: Record<string, ProjectAgentsIndexData>
) {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (!sameStringArray(leftKeys, rightKeys)) return false

  for (const key of leftKeys) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false
  }

  return true
}

export function updateProjectIndexLoadingState(
  current: Record<string, boolean>,
  projects: Array<string>,
  loading: boolean
) {
  let changed = false
  const next = { ...current }

  for (const project of projects) {
    if (Boolean(current[project]) === loading) continue
    next[project] = loading
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
  current: Record<string, ProjectAgentsIndexData>,
  entry: AgentListEntry & { cwd: string; id: string }
) {
  const project = entry.cwd.trim()
  const optimisticId = entry.id.trim()
  if (!project || !optimisticId) return current

  const currentSnapshot = current[project]
  const currentAgents = currentSnapshot?.agents || []
  const existingEntry = currentAgents.find((agent) => agent.id === optimisticId)
  const nextEntry = {
    ...existingEntry,
    ...entry,
    id: optimisticId,
    cwd: project,
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
    [project]: {
      project,
      totalCount: existingEntry ? totalCountBaseline : totalCountBaseline + 1,
      revision: `optimistic:${optimisticId}:${
        currentSnapshot?.revision || "initial"
      }:${entry.modified || ""}`,
      agents: nextAgents,
    },
  }
}

export function updateOptimisticSidebarAgentPreviewEntry(
  current: Record<string, ProjectAgentsIndexData>,
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
  const next: Record<string, ProjectAgentsIndexData> = { ...current }

  for (const [project, snapshot] of Object.entries(current)) {
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
    next[project] = {
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
  current: Record<string, ProjectAgentsIndexData>,
  optimisticId: string | undefined
) {
  const targetId = optimisticId?.trim() || ""
  if (!targetId) return current

  let changed = false
  const next: Record<string, ProjectAgentsIndexData> = { ...current }

  for (const [project, snapshot] of Object.entries(current)) {
    const nextAgents = snapshot.agents.filter((entry) => entry.id !== targetId)
    if (nextAgents.length === snapshot.agents.length) continue

    changed = true
    next[project] = {
      ...snapshot,
      totalCount: Math.max(0, snapshot.totalCount - 1),
      revision: `remove-optimistic:${targetId}:${snapshot.revision}`,
      agents: nextAgents,
    }
  }

  return changed ? next : current
}

/**
 * Give the optimistic entries of a project the identity of the agent that
 * the server made for the draft. A project index fetch keeps optimistic
 * entries until the server lists their ID. Without this step, the draft ID
 * never shows in the index, and the sidebar shows the placeholder next to the
 * real agent.
 */
export function bindOptimisticSidebarAgentEntries(
  current: Record<string, ProjectAgentsIndexData>,
  agent: { cwd?: string; agentId?: string; agentPath?: string }
) {
  const project = agent.cwd?.trim() || ""
  const agentId = agent.agentId?.trim() || ""
  const agentPath = agent.agentPath?.trim() || ""
  const snapshot = project ? current[project] : undefined
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
    [project]: {
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
 * project already lists the real agent, remove the placeholder.
 */
export function bindOptimisticSidebarAgentEntryById(
  current: Record<string, ProjectAgentsIndexData>,
  optimisticId: string | undefined,
  agent: { agentId?: string; agentPath?: string }
) {
  const targetId = optimisticId?.trim() || ""
  const agentId = agent.agentId?.trim() || ""
  const agentPath = agent.agentPath?.trim() || ""
  if (!targetId || !agentId || targetId === agentId) return current

  let changed = false
  const next: Record<string, ProjectAgentsIndexData> = { ...current }

  for (const [project, snapshot] of Object.entries(current)) {
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
    next[project] = {
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

export function mergeProjectIndexDataPreservingOptimistic(
  current: Record<string, ProjectAgentsIndexData>,
  next: Record<string, ProjectAgentsIndexData>
) {
  let merged = mergeProjectIndexData(current, next)

  for (const [project, snapshot] of Object.entries(current)) {
    const optimisticAgents = snapshot.agents.filter(
      isOptimisticSidebarAgentEntry
    )
    if (optimisticAgents.length === 0) continue

    const targetSnapshot = merged[project]
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
      [project]: {
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
  current: Record<string, ProjectAgentsIndexData>,
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
  const next: Record<string, ProjectAgentsIndexData> = { ...current }

  for (const [project, snapshot] of Object.entries(current)) {
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
      next[project] = {
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

  for (const [project, agents] of Object.entries(indexes)) {
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

    nextIndexes[project] = agentsChanged ? nextAgents : agents
  }

  return changed ? nextIndexes : indexes
}

function createInitialSidebarState(): AppShellSidebarState {
  return {
    agentsEvent: null,
    activeSidebarAgentId: "",
    activeSidebarAgentKey: "",
    activeSidebarAgentPath: "",
    sidebarProjects: [],
    initialSidebarBootstrapProjects: [],
    projectIndexDataByPath: {},
    projectIndexLoading: {},
    sidebarAgentStatusByKey: {},
    sidebarDeferredProjectLoadingReady: false,
    agentSearch: "",
    pinnedSidebarAgentKeys: [],
    selectedSidebarAgentKeys: [],
    sidebarAgentSelectionAnchor: "",
  }
}

function computeAppShellSidebarDerived(
  state: AppShellSidebarState
): AppShellSidebarDerived {
  const projectStates = state.agentsEvent?.projectStates || []
  const projectStateByPath = new Map(
    projectStates.map((projectState) => [projectState.path, projectState])
  )
  const baseSidebarProjects = normalizeStoredProjectList(state.sidebarProjects)
  const projectIndexes: Record<string, Array<AgentListEntry>> = {}

  for (const project of baseSidebarProjects) {
    projectIndexes[project] =
      state.projectIndexDataByPath[project]?.agents || []
  }

  const sidebarProjectIndexes = applySidebarAgentStatusOverlay(
    projectIndexes,
    state.sidebarAgentStatusByKey
  )
  const query = state.agentSearch.trim().toLowerCase()
  const sidebarSearchPending = query
    ? baseSidebarProjects.some((project) => {
        const totalCount = projectStateByPath.get(project)?.totalCount ?? 0
        const loadedCount = Object.prototype.hasOwnProperty.call(
          projectIndexes,
          project
        )
          ? projectIndexes[project].length
          : 0
        const loading = Boolean(state.projectIndexLoading[project])
        return loading || (!loadedCount && totalCount > 0)
      })
    : false
  const visibleProjects: Array<string> = []
  const filteredProjectAgents: Record<string, Array<AgentListEntry>> = {}

  for (const project of baseSidebarProjects) {
    const agents = Object.prototype.hasOwnProperty.call(
      sidebarProjectIndexes,
      project
    )
      ? sidebarProjectIndexes[project]
      : []

    if (!query) {
      visibleProjects.push(project)
      filteredProjectAgents[project] = agents
      continue
    }

    const projectMatches = sidebarTextContains(project.toLowerCase(), query)
    const filteredAgents = projectMatches
      ? agents
      : agents.filter((entry) => {
          const haystack = [entry.title, entry.name, entry.path, entry.cwd]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
          return sidebarTextContains(haystack, query)
        })

    if (projectMatches || filteredAgents.length > 0) {
      visibleProjects.push(project)
      filteredProjectAgents[project] = filteredAgents
    }
  }

  const sidebarAgentEntriesByKey = new Map<string, AgentListEntry>()
  for (const project of baseSidebarProjects) {
    const entries = Object.prototype.hasOwnProperty.call(
      sidebarProjectIndexes,
      project
    )
      ? sidebarProjectIndexes[project]
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
    baseSidebarProjects.join("\n"),
    state.pinnedSidebarAgentKeys.join("\n"),
    state.selectedSidebarAgentKeys.join("\n"),
  ].join("\0")

  return {
    baseSidebarProjects,
    projectStateByPath,
    projectIndexes: sidebarProjectIndexes,
    sidebarProjectIndexes,
    sidebarAgents,
    pinnedSidebarAgents,
    selectedSidebarAgents,
    sidebarAgentEntriesByKey,
    visibleProjects,
    filteredProjectAgents,
    emptySidebarStateText: query
      ? sidebarSearchPending
        ? "Searching agents…"
        : "No agents or projects match your search."
      : baseSidebarProjects.length > 0
        ? "No projects match this view."
        : "No projects added yet.",
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
    setSidebarProjects: (action) => {
      const sidebarProjects = applyStoreAction(
        store.state.state.sidebarProjects,
        action
      )
      if (sidebarProjects === store.state.state.sidebarProjects) return
      setSidebarState({ sidebarProjects })
    },
    setProjectIndexDataByPath: (action) => {
      const projectIndexDataByPath = applyStoreAction(
        store.state.state.projectIndexDataByPath,
        action
      )
      if (projectIndexDataByPath === store.state.state.projectIndexDataByPath) {
        return
      }
      setSidebarState({ projectIndexDataByPath })
    },
    setProjectIndexLoading: (action) => {
      const projectIndexLoading = applyStoreAction(
        store.state.state.projectIndexLoading,
        action
      )
      if (projectIndexLoading === store.state.state.projectIndexLoading) return
      setSidebarState({ projectIndexLoading })
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
    setSidebarDeferredProjectLoadingReady: (action) => {
      const sidebarDeferredProjectLoadingReady = applyStoreAction(
        store.state.state.sidebarDeferredProjectLoadingReady,
        action
      )
      if (
        sidebarDeferredProjectLoadingReady ===
        store.state.state.sidebarDeferredProjectLoadingReady
      ) {
        return
      }
      setSidebarState({ sidebarDeferredProjectLoadingReady })
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
