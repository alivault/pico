import * as React from "react"
import { toast } from "@/lib/pico/toast"

import {
  sameMapEntries,
  sameStringArray,
} from "@/features/pico/app-shell-common"
import {
  clearUnreadForActiveSidebarAgent,
  fetchProjectAgentsIndexes,
  getRenderedSidebarAgentKeys,
  isOptimisticSidebarAgentEntry,
  mergeProjectIndexData,
  mergeProjectIndexDataPreservingOptimistic,
  mergeSidebarAgentStatusMap,
  sameProjectIndexDataRecord,
  sameAgentEntryRecord,
  updateProjectIndexLoadingState,
  useAppShellSidebarValue,
  type AppShellSidebarStore,
  type ProjectAgentsIndexData,
} from "@/features/pico/app-shell-sidebar-store"
import type { AppShellAgentWorkspaceHandle } from "@/features/pico/app-shell-types"
import { AppSidebar, createProjectAgentsStore } from "@/features/pico/sidebar"
import {
  normalizeAgentSelectionKeys,
  normalizeStoredProjectList,
  PINNED_AGENTS_STORAGE_KEY,
  machineLocalStorageSetItem,
  agentListEntryKey,
  SIDEBAR_PROJECTS_STORAGE_KEY,
} from "@/lib/pico"
import type { AgentListEntry } from "@/lib/pico/api"
import { ArchivedAgentsDialog } from "@/features/pico/archived-agents-dialog"
import { useMachineId } from "@/lib/pico/machine-context"
import { onServerReconnect } from "@/lib/pico/server-connection"
import {
  filterProjectAgentsByStatus,
  agentMatchesStatusFilter,
  useAgentStatusFilter,
} from "@/features/pico/agent-status-filter"

// Stored name: do not change.
const PINNED_AGENT_STORE_PROJECT = "__pico_pinned_sessions__"

function findSidebarAgentSelectionKey(
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

type AppShellSidebarControllerProps = {
  viewerContextId: string
  sidebarStore: AppShellSidebarStore
  agentWorkspaceRef: React.RefObject<AppShellAgentWorkspaceHandle | null>
}

export function AppShellSidebarController(
  props: AppShellSidebarControllerProps
) {
  return useAppShellSidebarControllerView(props)
}

function useAppShellSidebarControllerView({
  viewerContextId,
  sidebarStore,
  agentWorkspaceRef,
}: AppShellSidebarControllerProps) {
  const machineId = useMachineId()
  const [archivedAgentsOpen, setArchivedAgentsOpen] = React.useState(false)
  const [projectAgentsStore] = React.useState(() =>
    createProjectAgentsStore({}, {})
  )
  const baseSidebarProjects = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.baseSidebarProjects,
    sameStringArray
  )
  const projectStateByPath = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.projectStateByPath,
    sameMapEntries
  )
  const emptySidebarStateText = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.emptySidebarStateText
  )
  const searchedProjectAgents = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.filteredProjectAgents,
    sameAgentEntryRecord
  )
  const allPinnedSidebarAgents = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.pinnedSidebarAgents
  )
  const searchedProjects = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.visibleProjects,
    sameStringArray
  )
  // A click on a count in the machine heading shows only the agents with
  // that state.
  const statusFilter = useAgentStatusFilter(machineId)
  const pinnedSidebarAgents = React.useMemo(
    () =>
      statusFilter
        ? allPinnedSidebarAgents.filter((entry) =>
            agentMatchesStatusFilter(entry, statusFilter)
          )
        : allPinnedSidebarAgents,
    [allPinnedSidebarAgents, statusFilter]
  )
  const { visibleProjects, filteredProjectAgents } = React.useMemo(() => {
    if (!statusFilter)
      return {
        visibleProjects: searchedProjects,
        filteredProjectAgents: searchedProjectAgents,
      }
    const pinnedKeys = new Set(
      allPinnedSidebarAgents.map((entry) => agentListEntryKey(entry))
    )
    const filtered = filterProjectAgentsByStatus(
      searchedProjects,
      searchedProjectAgents,
      statusFilter,
      (entry) => pinnedKeys.has(agentListEntryKey(entry))
    )
    return {
      visibleProjects: filtered.visibleProjects,
      filteredProjectAgents: filtered.filteredAgents,
    }
  }, [
    allPinnedSidebarAgents,
    searchedProjects,
    searchedProjectAgents,
    statusFilter,
  ])
  const pinnedSidebarAgentKeys = pinnedSidebarAgents.flatMap((entry) => {
    const key = agentListEntryKey(entry)
    return key ? [key] : []
  })
  const sidebarAgentEntriesByKey = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.sidebarAgentEntriesByKey,
    sameMapEntries
  )
  const projectIndexDataByPath = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.projectIndexDataByPath
  )
  const projectIndexLoading = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.projectIndexLoading
  )
  const selectedSidebarAgentKeys = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.selectedSidebarAgentKeys,
    sameStringArray
  )
  const sidebarAgentsEventSnapshot = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => {
      const event = snapshot.state.agentsEvent
      const activeAgentId = snapshot.state.activeSidebarAgentId
      const activeAgentKey = snapshot.state.activeSidebarAgentKey
      const activeAgentPath = snapshot.state.activeSidebarAgentPath
      const statuses = snapshot.state.sidebarAgentStatusByKey
      const status =
        (activeAgentPath ? statuses[`path:${activeAgentPath}`] : undefined) ||
        (activeAgentId ? statuses[`id:${activeAgentId}`] : undefined) ||
        (activeAgentKey ? statuses[`key:${activeAgentKey}`] : undefined)

      return {
        event,
        activeAgentId,
        activeAgentKey,
        activeAgentPath,
        activeStreaming: Boolean(status?.streaming),
      }
    },
    (left, right) =>
      left.activeAgentId === right.activeAgentId &&
      left.activeAgentKey === right.activeAgentKey &&
      left.activeAgentPath === right.activeAgentPath &&
      left.activeStreaming === right.activeStreaming &&
      left.event?.activeAgentId === right.event?.activeAgentId &&
      left.event?.activeAgentKey === right.event?.activeAgentKey &&
      left.event?.activeAgentPath === right.event?.activeAgentPath &&
      sameStringArray(left.event?.projects || [], right.event?.projects || [])
  )
  const agentsEvent = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.agentsEvent
  )
  const activeSidebarAgentId = sidebarAgentsEventSnapshot.activeAgentId
  const activeSidebarAgentKey = sidebarAgentsEventSnapshot.activeAgentKey
  const activeSidebarAgentPath = sidebarAgentsEventSnapshot.activeAgentPath
  const activeSidebarAgentStreaming = sidebarAgentsEventSnapshot.activeStreaming
  const matchingAgentCount = visibleProjects.reduce(
    (total, project) => total + (filteredProjectAgents[project]?.length ?? 0),
    0
  )
  const agentSearch = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.agentSearch
  )
  const sidebarDeferredProjectLoadingReady = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.sidebarDeferredProjectLoadingReady
  )
  const sidebarAgentSelectionAnchor = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.sidebarAgentSelectionAnchor
  )
  const lastActiveSidebarSelectionSyncRef = React.useRef({
    signature: "",
    key: "",
  })
  const projectIndexRequestIdRef = React.useRef(0)
  const projectIndexRequestIdsByPathRef = React.useRef<Record<string, number>>(
    {}
  )
  // Projects whose first load failed. The load effect skips them, else
  // each failure starts the next request at once, in a loop. They load again
  // when the server answers again after a failure.
  const failedProjectIndexesRef = React.useRef(new Set<string>())
  const [projectIndexRetryNonce, setProjectIndexRetryNonce] = React.useState(0)
  React.useEffect(
    () =>
      onServerReconnect(() => {
        if (failedProjectIndexesRef.current.size === 0) return
        failedProjectIndexesRef.current.clear()
        setProjectIndexRetryNonce((nonce) => nonce + 1)
      }),
    []
  )
  const sidebarProjectAgentsSnapshotRef = React.useRef<{
    activeAgentId: string
    activeAgentKey: string
    activeAgentPath: string
    revisions: Record<string, string>
  } | null>(null)

  const startProjectIndexRequest = (projects: Array<string>) => {
    const requestId = projectIndexRequestIdRef.current + 1
    projectIndexRequestIdRef.current = requestId

    for (const project of projects) {
      projectIndexRequestIdsByPathRef.current[project] = requestId
    }

    return requestId
  }

  const getActiveProjectIndexRequestProjects = (
    projects: Array<string>,
    requestId: number
  ) =>
    projects.filter(
      (project) =>
        projectIndexRequestIdsByPathRef.current[project] === requestId
    )

  const clearProjectIndexRequestProjects = (
    projects: Array<string>,
    requestId: number
  ) => {
    for (const project of projects) {
      if (projectIndexRequestIdsByPathRef.current[project] === requestId) {
        delete projectIndexRequestIdsByPathRef.current[project]
      }
    }
  }

  React.useLayoutEffect(() => {
    projectAgentsStore.setData(
      pinnedSidebarAgents.length > 0
        ? {
            ...filteredProjectAgents,
            [PINNED_AGENT_STORE_PROJECT]: pinnedSidebarAgents,
          }
        : filteredProjectAgents,
      projectIndexLoading
    )
  }, [
    projectIndexLoading,
    projectAgentsStore,
    filteredProjectAgents,
    pinnedSidebarAgents,
  ])

  React.useEffect(() => {
    let timeoutId = 0
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        sidebarStore.setSidebarDeferredProjectLoadingReady(true)
      }, 0)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [sidebarStore])

  React.useEffect(() => {
    const sidebarProjectSet = new Set(baseSidebarProjects)

    sidebarStore.setProjectIndexDataByPath((current) => {
      const next: Record<string, ProjectAgentsIndexData> = {}

      for (const [project, payload] of Object.entries(current)) {
        if (!sidebarProjectSet.has(project)) continue
        next[project] = payload
      }

      return JSON.stringify(next) === JSON.stringify(current) ? current : next
    })

    sidebarStore.setProjectIndexLoading((current) => {
      const next: Record<string, boolean> = {}

      for (const [project, loading] of Object.entries(current)) {
        if (!sidebarProjectSet.has(project)) continue
        next[project] = loading
      }

      return JSON.stringify(next) === JSON.stringify(current) ? current : next
    })

    const nextRequestIdsByPath: Record<string, number> = {}
    for (const [project, requestId] of Object.entries(
      projectIndexRequestIdsByPathRef.current
    )) {
      if (!sidebarProjectSet.has(project)) continue
      nextRequestIdsByPath[project] = requestId
    }
    projectIndexRequestIdsByPathRef.current = nextRequestIdsByPath
  }, [baseSidebarProjects, sidebarStore])

  React.useEffect(() => {
    if (!viewerContextId || !agentsEvent) return

    const payloadProjectIndexes = agentsEvent.projectIndexes || {}
    const payloadProjects = Object.keys(payloadProjectIndexes)
    const payloadProjectSet = new Set(payloadProjects)

    sidebarStore.setSidebarState((current) => {
      const merged = payloadProjects.length
        ? mergeProjectIndexData(
            current.projectIndexDataByPath,
            payloadProjectIndexes
          )
        : current.projectIndexDataByPath
      const nextProjectIndexDataByPath = clearUnreadForActiveSidebarAgent(
        merged,
        {
          agentId: activeSidebarAgentId,
          agentPath: activeSidebarAgentPath,
        }
      )
      const nextProjectIndexLoading = payloadProjects.length
        ? updateProjectIndexLoadingState(
            current.projectIndexLoading,
            payloadProjects,
            false
          )
        : current.projectIndexLoading

      const projectIndexDataChanged = !sameProjectIndexDataRecord(
        current.projectIndexDataByPath,
        nextProjectIndexDataByPath
      )

      if (
        !projectIndexDataChanged &&
        nextProjectIndexLoading === current.projectIndexLoading
      ) {
        return current
      }

      return {
        projectIndexDataByPath: projectIndexDataChanged
          ? nextProjectIndexDataByPath
          : current.projectIndexDataByPath,
        projectIndexLoading: nextProjectIndexLoading,
      }
    })

    const previousSnapshot = sidebarProjectAgentsSnapshotRef.current
    const nextRevisions: Record<string, string> = {}
    const projectsToRefresh: Array<string> = []

    for (const project of baseSidebarProjects) {
      const nextRevision = projectStateByPath.get(project)?.revision || ""
      const previousRevision = previousSnapshot?.revisions[project] || ""
      nextRevisions[project] = nextRevision

      if (payloadProjectSet.has(project)) {
        continue
      }

      if (
        !Object.prototype.hasOwnProperty.call(projectIndexDataByPath, project)
      ) {
        continue
      }

      if (
        projectIndexLoading[project] ||
        projectIndexRequestIdsByPathRef.current[project]
      ) {
        continue
      }

      if (previousRevision === nextRevision) {
        continue
      }

      if (activeSidebarAgentStreaming) {
        // Keep the old revision, so the index refreshes when streaming stops.
        nextRevisions[project] = previousRevision
        continue
      }

      projectsToRefresh.push(project)
    }

    sidebarProjectAgentsSnapshotRef.current = {
      activeAgentId: activeSidebarAgentId,
      activeAgentKey: activeSidebarAgentKey,
      activeAgentPath: activeSidebarAgentPath,
      revisions: nextRevisions,
    }

    if (projectsToRefresh.length === 0) {
      return
    }

    const requestId = startProjectIndexRequest(projectsToRefresh)

    void fetchProjectAgentsIndexes({
      machineId,
      viewerContextId,
      projects: projectsToRefresh,
    })
      .then((response) => {
        const activeProjects = getActiveProjectIndexRequestProjects(
          projectsToRefresh,
          requestId
        )
        if (activeProjects.length === 0) return
        clearProjectIndexRequestProjects(activeProjects, requestId)

        const activeProjectIndexes = Object.fromEntries(
          activeProjects.flatMap((project) => {
            const indexData = response.projectIndexes[project]
            return indexData ? [[project, indexData]] : []
          })
        )

        sidebarStore.setSidebarState((current) => {
          const nextProjectIndexDataByPath =
            Object.keys(activeProjectIndexes).length > 0
              ? mergeProjectIndexDataPreservingOptimistic(
                  current.projectIndexDataByPath,
                  activeProjectIndexes
                )
              : current.projectIndexDataByPath
          const nextProjectIndexLoading = updateProjectIndexLoadingState(
            current.projectIndexLoading,
            activeProjects,
            false
          )

          if (
            nextProjectIndexDataByPath === current.projectIndexDataByPath &&
            nextProjectIndexLoading === current.projectIndexLoading
          ) {
            return current
          }

          return {
            projectIndexDataByPath: nextProjectIndexDataByPath,
            projectIndexLoading: nextProjectIndexLoading,
          }
        })
      })
      .catch((error) => {
        const activeProjects = getActiveProjectIndexRequestProjects(
          projectsToRefresh,
          requestId
        )
        if (activeProjects.length === 0) return
        clearProjectIndexRequestProjects(activeProjects, requestId)

        sidebarStore.setProjectIndexLoading((current) =>
          updateProjectIndexLoadingState(current, activeProjects, false)
        )
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load sidebar agents"
        )
      })
  }, [
    baseSidebarProjects,
    projectIndexDataByPath,
    projectIndexLoading,
    activeSidebarAgentId,
    activeSidebarAgentKey,
    activeSidebarAgentPath,
    activeSidebarAgentStreaming,
    projectStateByPath,
    agentsEvent,
    sidebarStore,
    viewerContextId,
  ])

  React.useEffect(() => {
    if (
      !activeSidebarAgentId &&
      !activeSidebarAgentKey &&
      !activeSidebarAgentPath
    ) {
      return
    }

    sidebarStore.setSidebarAgentStatusByKey((current) =>
      mergeSidebarAgentStatusMap(current, {
        type: "agent_status",
        agentKey: activeSidebarAgentKey,
        agentId: activeSidebarAgentId,
        agentPath: activeSidebarAgentPath,
        unread: false,
      })
    )
  }, [
    activeSidebarAgentId,
    activeSidebarAgentKey,
    activeSidebarAgentPath,
    sidebarStore,
  ])

  React.useEffect(() => {
    const activeSignature = [
      activeSidebarAgentId,
      activeSidebarAgentPath,
      activeSidebarAgentKey,
    ].join("\0")
    let nextKey = findSidebarAgentSelectionKey(sidebarAgentEntriesByKey, {
      agentId: activeSidebarAgentId,
      agentPath: activeSidebarAgentPath,
    })

    if (
      !nextKey &&
      activeSidebarAgentKey &&
      sidebarAgentEntriesByKey.has(activeSidebarAgentKey)
    ) {
      nextKey = activeSidebarAgentKey
    }

    const previous = lastActiveSidebarSelectionSyncRef.current
    if (previous.signature === activeSignature && previous.key === nextKey) {
      return
    }

    lastActiveSidebarSelectionSyncRef.current = {
      signature: activeSignature,
      key: nextKey,
    }
    sidebarStore.setSelectedSidebarAgentKeys((current) => {
      const nextKeys = nextKey ? [nextKey] : []
      return sameStringArray(current, nextKeys) ? current : nextKeys
    })
    sidebarStore.setSidebarAgentSelectionAnchor((current) =>
      current === nextKey ? current : nextKey
    )
  }, [
    activeSidebarAgentId,
    activeSidebarAgentKey,
    activeSidebarAgentPath,
    sidebarAgentEntriesByKey,
    sidebarStore,
  ])

  React.useEffect(() => {
    if (!viewerContextId || !sidebarDeferredProjectLoadingReady) return

    const missingProjects = baseSidebarProjects.filter(
      (project) =>
        !Object.prototype.hasOwnProperty.call(
          projectIndexDataByPath,
          project
        ) &&
        !projectIndexLoading[project] &&
        !projectIndexRequestIdsByPathRef.current[project] &&
        !failedProjectIndexesRef.current.has(project)
    )

    if (missingProjects.length === 0) {
      return
    }

    const requestId = startProjectIndexRequest(missingProjects)
    sidebarStore.setProjectIndexLoading((current) =>
      updateProjectIndexLoadingState(current, missingProjects, true)
    )

    void fetchProjectAgentsIndexes({
      machineId,
      viewerContextId,
      projects: missingProjects,
    })
      .then((response) => {
        const activeProjects = getActiveProjectIndexRequestProjects(
          missingProjects,
          requestId
        )
        if (activeProjects.length === 0) return
        clearProjectIndexRequestProjects(activeProjects, requestId)

        const activeProjectIndexes = Object.fromEntries(
          activeProjects.flatMap((project) => {
            const indexData = response.projectIndexes[project]
            return indexData ? [[project, indexData]] : []
          })
        )

        sidebarStore.setSidebarState((current) => {
          const nextProjectIndexDataByPath =
            Object.keys(activeProjectIndexes).length > 0
              ? mergeProjectIndexDataPreservingOptimistic(
                  current.projectIndexDataByPath,
                  activeProjectIndexes
                )
              : current.projectIndexDataByPath
          const nextProjectIndexLoading = updateProjectIndexLoadingState(
            current.projectIndexLoading,
            activeProjects,
            false
          )

          if (
            nextProjectIndexDataByPath === current.projectIndexDataByPath &&
            nextProjectIndexLoading === current.projectIndexLoading
          ) {
            return current
          }

          return {
            projectIndexDataByPath: nextProjectIndexDataByPath,
            projectIndexLoading: nextProjectIndexLoading,
          }
        })
      })
      .catch((error) => {
        const activeProjects = getActiveProjectIndexRequestProjects(
          missingProjects,
          requestId
        )
        if (activeProjects.length === 0) return
        clearProjectIndexRequestProjects(activeProjects, requestId)
        for (const project of activeProjects) {
          failedProjectIndexesRef.current.add(project)
        }

        sidebarStore.setProjectIndexLoading((current) =>
          updateProjectIndexLoadingState(current, activeProjects, false)
        )
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load sidebar agents"
        )
      })
  }, [
    baseSidebarProjects,
    projectIndexDataByPath,
    projectIndexLoading,
    projectIndexRetryNonce,
    sidebarDeferredProjectLoadingReady,
    sidebarStore,
    viewerContextId,
  ])

  React.useEffect(() => {
    const validKeys = new Set(sidebarAgentEntriesByKey.keys())

    sidebarStore.setSelectedSidebarAgentKeys((current) => {
      const next = current.filter((key) => validKeys.has(key))
      return next.length === current.length ? current : next
    })

    sidebarStore.setSidebarAgentSelectionAnchor((current) =>
      current && validKeys.has(current) ? current : ""
    )
  }, [sidebarAgentEntriesByKey, sidebarStore])

  const reorderSidebarProjects = (nextProjects: Array<string>) => {
    const normalizedNext = normalizeStoredProjectList(nextProjects)
    if (normalizedNext.length === 0) return

    sidebarStore.setSidebarProjects((current) => {
      const previous = normalizeStoredProjectList(current)
      if (JSON.stringify(previous) === JSON.stringify(normalizedNext)) {
        return current
      }

      machineLocalStorageSetItem(
        machineId,
        SIDEBAR_PROJECTS_STORAGE_KEY,
        JSON.stringify(normalizedNext)
      )
      return normalizedNext
    })
  }

  const togglePinnedAgent = (entry: AgentListEntry) => {
    const key = agentListEntryKey(entry)
    if (!key) return

    sidebarStore.setPinnedSidebarAgentKeys((current) => {
      const currentKeys = normalizeAgentSelectionKeys(current)
      const nextKeys = currentKeys.includes(key)
        ? currentKeys.filter((currentKey) => currentKey !== key)
        : [key, ...currentKeys]

      machineLocalStorageSetItem(
        machineId,
        PINNED_AGENTS_STORAGE_KEY,
        JSON.stringify(nextKeys)
      )
      return nextKeys
    })
  }

  const setSidebarSelection = (nextKeys: Array<string>, anchorKey = "") => {
    const normalizedKeys = normalizeAgentSelectionKeys(nextKeys)
    const nextAnchor =
      normalizedKeys.length === 0
        ? ""
        : anchorKey && normalizedKeys.includes(anchorKey)
          ? anchorKey
          : (normalizedKeys[normalizedKeys.length - 1] ?? "")

    sidebarStore.setSelectedSidebarAgentKeys((current) =>
      sameStringArray(current, normalizedKeys) ? current : normalizedKeys
    )
    sidebarStore.setSidebarAgentSelectionAnchor((current) =>
      current === nextAnchor ? current : nextAnchor
    )
  }

  const selectSidebarAgentRange = (targetKey: string) => {
    const normalizedTargetKey = targetKey.trim()
    if (!normalizedTargetKey) return

    const orderedKeys = getRenderedSidebarAgentKeys()
    const targetIndex = orderedKeys.indexOf(normalizedTargetKey)
    if (targetIndex < 0) {
      setSidebarSelection([normalizedTargetKey], normalizedTargetKey)
      return
    }

    const anchorKey = orderedKeys.includes(sidebarAgentSelectionAnchor)
      ? sidebarAgentSelectionAnchor
      : (selectedSidebarAgentKeys.find((key) => orderedKeys.includes(key)) ??
        normalizedTargetKey)
    const anchorIndex = orderedKeys.indexOf(anchorKey)
    if (anchorIndex < 0) {
      setSidebarSelection([normalizedTargetKey], normalizedTargetKey)
      return
    }

    const start = Math.min(anchorIndex, targetIndex)
    const end = Math.max(anchorIndex, targetIndex)
    setSidebarSelection(orderedKeys.slice(start, end + 1), anchorKey)
  }

  const handleSidebarAgentClick = (
    entry: AgentListEntry,
    modifiers: { multiSelectKey: boolean; shiftKey: boolean }
  ) => {
    const key = agentListEntryKey(entry)

    if (!key) {
      if (entry.id) {
        agentWorkspaceRef.current?.selectAgent(entry.id, {
          agentPath: entry.path,
        })
      }
      return
    }

    if (modifiers.shiftKey) {
      selectSidebarAgentRange(key)
      return
    }

    if (modifiers.multiSelectKey) {
      setSidebarSelection(
        selectedSidebarAgentKeys.includes(key)
          ? selectedSidebarAgentKeys.filter((currentKey) => currentKey !== key)
          : [...selectedSidebarAgentKeys, key],
        key
      )
      return
    }

    setSidebarSelection([key], key)
    if (entry.id && !isOptimisticSidebarAgentEntry(entry)) {
      agentWorkspaceRef.current?.selectAgent(entry.id, {
        agentPath: entry.path,
      })
    }
  }

  const showRestoredAgentProject = (project: string) => {
    sidebarStore.setSidebarProjects((current) => {
      const normalizedCurrent = normalizeStoredProjectList(current)
      if (normalizedCurrent.includes(project)) return current
      const next = normalizeStoredProjectList([...normalizedCurrent, project])
      machineLocalStorageSetItem(
        machineId,
        SIDEBAR_PROJECTS_STORAGE_KEY,
        JSON.stringify(next)
      )
      return next
    })
  }

  return (
    <>
      <AppSidebar
        agentSearch={agentSearch}
        onOpenAgentsDialog={() => {
          agentWorkspaceRef.current?.openAgentsDialog()
        }}
        visibleProjects={visibleProjects}
        projectAgentsStore={projectAgentsStore}
        matchingAgentCount={matchingAgentCount}
        selectedAgentKeys={selectedSidebarAgentKeys}
        activeAgentId={activeSidebarAgentId || undefined}
        activeAgentKey={activeSidebarAgentKey || undefined}
        pinnedAgentKeys={pinnedSidebarAgentKeys}
        emptyStateText={
          statusFilter ? "No agents with these states." : emptySidebarStateText
        }
        statusFilterActive={Boolean(statusFilter)}
        onOpenAddProjectDialog={() => {
          agentWorkspaceRef.current?.openAddProjectDialog()
        }}
        onAgentClick={handleSidebarAgentClick}
        onRenameAgent={(entry) => {
          agentWorkspaceRef.current?.openRenameDialogForEntry(entry)
        }}
        onDeleteAgent={(entry) => {
          const key = agentListEntryKey(entry)
          const { selectedSidebarAgents } = sidebarStore.getWorkspaceSnapshot()
          const archiveSelection =
            selectedSidebarAgents.length > 1 &&
            selectedSidebarAgents.some(
              (selected) => agentListEntryKey(selected) === key
            )
          agentWorkspaceRef.current?.openDeleteDialog(
            archiveSelection ? selectedSidebarAgents : [entry]
          )
        }}
        onSetAgentUnread={(entry, unread) => {
          void agentWorkspaceRef.current?.setAgentUnread(entry, unread)
        }}
        onMoveAgent={(entry, project) => {
          void agentWorkspaceRef.current?.moveAgentToProject(entry, project)
        }}
        onMoveAgentAnyProject={(entry) => {
          agentWorkspaceRef.current?.openMoveAgentProjectDialogForEntry(entry)
        }}
        onTogglePinnedAgent={togglePinnedAgent}
        onCreateAgentInProject={(project) => {
          void agentWorkspaceRef.current?.createAgent(project, {
            closeMobileSidebar: true,
          })
        }}
        onDeleteOldAgentsInProject={(project) => {
          agentWorkspaceRef.current?.openDeleteOldProjectAgentsDialog(project)
        }}
        onMarkAgentsRead={(entries) => {
          void agentWorkspaceRef.current?.markAgentsRead(entries)
        }}
        onRemoveProject={(project) => {
          sidebarStore.setSidebarProjects((current) => {
            const next = current.filter((entry) => entry !== project)
            machineLocalStorageSetItem(
              machineId,
              SIDEBAR_PROJECTS_STORAGE_KEY,
              JSON.stringify(next)
            )
            return next
          })
        }}
        onReorderProjects={reorderSidebarProjects}
        onOpenArchivedAgents={() => setArchivedAgentsOpen(true)}
      />
      <ArchivedAgentsDialog
        open={archivedAgentsOpen}
        onOpenChange={setArchivedAgentsOpen}
        viewerContextId={viewerContextId}
        onRestored={(result) => showRestoredAgentProject(result.project)}
      />
    </>
  )
}
