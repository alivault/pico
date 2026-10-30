import * as React from "react"
import { toast } from "@/lib/pico/toast"

import {
  sameMapEntries,
  sameStringArray,
} from "@/features/pico/app-shell-common"
import {
  clearUnreadForActiveSidebarAgent,
  fetchDirectoryAgentsIndexes,
  getRenderedSidebarAgentKeys,
  isOptimisticSidebarAgentEntry,
  mergeDirectoryIndexData,
  mergeDirectoryIndexDataPreservingOptimistic,
  mergeSidebarAgentStatusMap,
  sameDirectoryIndexDataRecord,
  sameAgentEntryRecord,
  updateDirectoryIndexLoadingState,
  useAppShellSidebarValue,
  type AppShellSidebarStore,
  type DirectoryAgentsIndexData,
} from "@/features/pico/app-shell-sidebar-store"
import type { AppShellAgentWorkspaceHandle } from "@/features/pico/app-shell-types"
import { AppSidebar, createDirectoryAgentsStore } from "@/features/pico/sidebar"
import {
  normalizeAgentSelectionKeys,
  normalizeStoredDirectoryList,
  PINNED_AGENTS_STORAGE_KEY,
  machineLocalStorageSetItem,
  agentListEntryKey,
  SIDEBAR_DIRECTORIES_STORAGE_KEY,
} from "@/lib/pico"
import type { AgentListEntry } from "@/lib/pico/api"
import { ArchivedAgentsDialog } from "@/features/pico/archived-agents-dialog"
import { useMachineId } from "@/lib/pico/machine-context"
import { onServerReconnect } from "@/lib/pico/server-connection"
import {
  filterDirectoryAgentsByStatus,
  agentMatchesStatusFilter,
  useAgentStatusFilter,
} from "@/features/pico/agent-status-filter"

// Stored name: do not change.
const PINNED_AGENT_STORE_DIRECTORY = "__pico_pinned_sessions__"

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
  const [directoryAgentsStore] = React.useState(() =>
    createDirectoryAgentsStore({}, {})
  )
  const baseSidebarDirectories = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.baseSidebarDirectories,
    sameStringArray
  )
  const directoryStateByPath = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.directoryStateByPath,
    sameMapEntries
  )
  const emptySidebarStateText = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.emptySidebarStateText
  )
  const searchedDirectoryAgents = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.filteredDirectoryAgents,
    sameAgentEntryRecord
  )
  const allPinnedSidebarAgents = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.pinnedSidebarAgents
  )
  const searchedDirectories = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.visibleDirectories,
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
  const { visibleDirectories, filteredDirectoryAgents } = React.useMemo(() => {
    if (!statusFilter)
      return {
        visibleDirectories: searchedDirectories,
        filteredDirectoryAgents: searchedDirectoryAgents,
      }
    const pinnedKeys = new Set(
      allPinnedSidebarAgents.map((entry) => agentListEntryKey(entry))
    )
    const filtered = filterDirectoryAgentsByStatus(
      searchedDirectories,
      searchedDirectoryAgents,
      statusFilter,
      (entry) => pinnedKeys.has(agentListEntryKey(entry))
    )
    return {
      visibleDirectories: filtered.visibleDirectories,
      filteredDirectoryAgents: filtered.filteredAgents,
    }
  }, [
    allPinnedSidebarAgents,
    searchedDirectories,
    searchedDirectoryAgents,
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
  const directoryIndexDataByPath = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.directoryIndexDataByPath
  )
  const directoryIndexLoading = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.directoryIndexLoading
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
      sameStringArray(
        left.event?.directories || [],
        right.event?.directories || []
      )
  )
  const agentsEvent = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.agentsEvent
  )
  const activeSidebarAgentId = sidebarAgentsEventSnapshot.activeAgentId
  const activeSidebarAgentKey = sidebarAgentsEventSnapshot.activeAgentKey
  const activeSidebarAgentPath = sidebarAgentsEventSnapshot.activeAgentPath
  const activeSidebarAgentStreaming = sidebarAgentsEventSnapshot.activeStreaming
  const matchingAgentCount = visibleDirectories.reduce(
    (total, directory) =>
      total + (filteredDirectoryAgents[directory]?.length ?? 0),
    0
  )
  const agentSearch = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.agentSearch
  )
  const sidebarDeferredDirectoryLoadingReady = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.sidebarDeferredDirectoryLoadingReady
  )
  const sidebarAgentSelectionAnchor = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.sidebarAgentSelectionAnchor
  )
  const lastActiveSidebarSelectionSyncRef = React.useRef({
    signature: "",
    key: "",
  })
  const directoryIndexRequestIdRef = React.useRef(0)
  const directoryIndexRequestIdsByPathRef = React.useRef<
    Record<string, number>
  >({})
  // Directories whose first load failed. The load effect skips them, else
  // each failure starts the next request at once, in a loop. They load again
  // when the server answers again after a failure.
  const failedDirectoryIndexesRef = React.useRef(new Set<string>())
  const [directoryIndexRetryNonce, setDirectoryIndexRetryNonce] =
    React.useState(0)
  React.useEffect(
    () =>
      onServerReconnect(() => {
        if (failedDirectoryIndexesRef.current.size === 0) return
        failedDirectoryIndexesRef.current.clear()
        setDirectoryIndexRetryNonce((nonce) => nonce + 1)
      }),
    []
  )
  const sidebarDirectoryAgentsSnapshotRef = React.useRef<{
    activeAgentId: string
    activeAgentKey: string
    activeAgentPath: string
    revisions: Record<string, string>
  } | null>(null)

  const startDirectoryIndexRequest = (directories: Array<string>) => {
    const requestId = directoryIndexRequestIdRef.current + 1
    directoryIndexRequestIdRef.current = requestId

    for (const directory of directories) {
      directoryIndexRequestIdsByPathRef.current[directory] = requestId
    }

    return requestId
  }

  const getActiveDirectoryIndexRequestDirectories = (
    directories: Array<string>,
    requestId: number
  ) =>
    directories.filter(
      (directory) =>
        directoryIndexRequestIdsByPathRef.current[directory] === requestId
    )

  const clearDirectoryIndexRequestDirectories = (
    directories: Array<string>,
    requestId: number
  ) => {
    for (const directory of directories) {
      if (directoryIndexRequestIdsByPathRef.current[directory] === requestId) {
        delete directoryIndexRequestIdsByPathRef.current[directory]
      }
    }
  }

  React.useLayoutEffect(() => {
    directoryAgentsStore.setData(
      pinnedSidebarAgents.length > 0
        ? {
            ...filteredDirectoryAgents,
            [PINNED_AGENT_STORE_DIRECTORY]: pinnedSidebarAgents,
          }
        : filteredDirectoryAgents,
      directoryIndexLoading
    )
  }, [
    directoryIndexLoading,
    directoryAgentsStore,
    filteredDirectoryAgents,
    pinnedSidebarAgents,
  ])

  React.useEffect(() => {
    let timeoutId = 0
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        sidebarStore.setSidebarDeferredDirectoryLoadingReady(true)
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
    const sidebarDirectorySet = new Set(baseSidebarDirectories)

    sidebarStore.setDirectoryIndexDataByPath((current) => {
      const next: Record<string, DirectoryAgentsIndexData> = {}

      for (const [directory, payload] of Object.entries(current)) {
        if (!sidebarDirectorySet.has(directory)) continue
        next[directory] = payload
      }

      return JSON.stringify(next) === JSON.stringify(current) ? current : next
    })

    sidebarStore.setDirectoryIndexLoading((current) => {
      const next: Record<string, boolean> = {}

      for (const [directory, loading] of Object.entries(current)) {
        if (!sidebarDirectorySet.has(directory)) continue
        next[directory] = loading
      }

      return JSON.stringify(next) === JSON.stringify(current) ? current : next
    })

    const nextRequestIdsByPath: Record<string, number> = {}
    for (const [directory, requestId] of Object.entries(
      directoryIndexRequestIdsByPathRef.current
    )) {
      if (!sidebarDirectorySet.has(directory)) continue
      nextRequestIdsByPath[directory] = requestId
    }
    directoryIndexRequestIdsByPathRef.current = nextRequestIdsByPath
  }, [baseSidebarDirectories, sidebarStore])

  React.useEffect(() => {
    if (!viewerContextId || !agentsEvent) return

    const payloadDirectoryIndexes = agentsEvent.directoryIndexes || {}
    const payloadDirectories = Object.keys(payloadDirectoryIndexes)
    const payloadDirectorySet = new Set(payloadDirectories)

    sidebarStore.setSidebarState((current) => {
      const merged = payloadDirectories.length
        ? mergeDirectoryIndexData(
            current.directoryIndexDataByPath,
            payloadDirectoryIndexes
          )
        : current.directoryIndexDataByPath
      const nextDirectoryIndexDataByPath = clearUnreadForActiveSidebarAgent(
        merged,
        {
          agentId: activeSidebarAgentId,
          agentPath: activeSidebarAgentPath,
        }
      )
      const nextDirectoryIndexLoading = payloadDirectories.length
        ? updateDirectoryIndexLoadingState(
            current.directoryIndexLoading,
            payloadDirectories,
            false
          )
        : current.directoryIndexLoading

      const directoryIndexDataChanged = !sameDirectoryIndexDataRecord(
        current.directoryIndexDataByPath,
        nextDirectoryIndexDataByPath
      )

      if (
        !directoryIndexDataChanged &&
        nextDirectoryIndexLoading === current.directoryIndexLoading
      ) {
        return current
      }

      return {
        directoryIndexDataByPath: directoryIndexDataChanged
          ? nextDirectoryIndexDataByPath
          : current.directoryIndexDataByPath,
        directoryIndexLoading: nextDirectoryIndexLoading,
      }
    })

    const previousSnapshot = sidebarDirectoryAgentsSnapshotRef.current
    const nextRevisions: Record<string, string> = {}
    const directoriesToRefresh: Array<string> = []

    for (const directory of baseSidebarDirectories) {
      const nextRevision = directoryStateByPath.get(directory)?.revision || ""
      const previousRevision = previousSnapshot?.revisions[directory] || ""
      nextRevisions[directory] = nextRevision

      if (payloadDirectorySet.has(directory)) {
        continue
      }

      if (
        !Object.prototype.hasOwnProperty.call(
          directoryIndexDataByPath,
          directory
        )
      ) {
        continue
      }

      if (
        directoryIndexLoading[directory] ||
        directoryIndexRequestIdsByPathRef.current[directory]
      ) {
        continue
      }

      if (previousRevision === nextRevision) {
        continue
      }

      if (activeSidebarAgentStreaming) {
        // Keep the old revision, so the index refreshes when streaming stops.
        nextRevisions[directory] = previousRevision
        continue
      }

      directoriesToRefresh.push(directory)
    }

    sidebarDirectoryAgentsSnapshotRef.current = {
      activeAgentId: activeSidebarAgentId,
      activeAgentKey: activeSidebarAgentKey,
      activeAgentPath: activeSidebarAgentPath,
      revisions: nextRevisions,
    }

    if (directoriesToRefresh.length === 0) {
      return
    }

    const requestId = startDirectoryIndexRequest(directoriesToRefresh)

    void fetchDirectoryAgentsIndexes({
      machineId,
      viewerContextId,
      directories: directoriesToRefresh,
    })
      .then((response) => {
        const activeDirectories = getActiveDirectoryIndexRequestDirectories(
          directoriesToRefresh,
          requestId
        )
        if (activeDirectories.length === 0) return
        clearDirectoryIndexRequestDirectories(activeDirectories, requestId)

        const activeDirectoryIndexes = Object.fromEntries(
          activeDirectories.flatMap((directory) => {
            const indexData = response.directoryIndexes[directory]
            return indexData ? [[directory, indexData]] : []
          })
        )

        sidebarStore.setSidebarState((current) => {
          const nextDirectoryIndexDataByPath =
            Object.keys(activeDirectoryIndexes).length > 0
              ? mergeDirectoryIndexDataPreservingOptimistic(
                  current.directoryIndexDataByPath,
                  activeDirectoryIndexes
                )
              : current.directoryIndexDataByPath
          const nextDirectoryIndexLoading = updateDirectoryIndexLoadingState(
            current.directoryIndexLoading,
            activeDirectories,
            false
          )

          if (
            nextDirectoryIndexDataByPath === current.directoryIndexDataByPath &&
            nextDirectoryIndexLoading === current.directoryIndexLoading
          ) {
            return current
          }

          return {
            directoryIndexDataByPath: nextDirectoryIndexDataByPath,
            directoryIndexLoading: nextDirectoryIndexLoading,
          }
        })
      })
      .catch((error) => {
        const activeDirectories = getActiveDirectoryIndexRequestDirectories(
          directoriesToRefresh,
          requestId
        )
        if (activeDirectories.length === 0) return
        clearDirectoryIndexRequestDirectories(activeDirectories, requestId)

        sidebarStore.setDirectoryIndexLoading((current) =>
          updateDirectoryIndexLoadingState(current, activeDirectories, false)
        )
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load sidebar agents"
        )
      })
  }, [
    baseSidebarDirectories,
    directoryIndexDataByPath,
    directoryIndexLoading,
    activeSidebarAgentId,
    activeSidebarAgentKey,
    activeSidebarAgentPath,
    activeSidebarAgentStreaming,
    directoryStateByPath,
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
    if (!viewerContextId || !sidebarDeferredDirectoryLoadingReady) return

    const missingDirectories = baseSidebarDirectories.filter(
      (directory) =>
        !Object.prototype.hasOwnProperty.call(
          directoryIndexDataByPath,
          directory
        ) &&
        !directoryIndexLoading[directory] &&
        !directoryIndexRequestIdsByPathRef.current[directory] &&
        !failedDirectoryIndexesRef.current.has(directory)
    )

    if (missingDirectories.length === 0) {
      return
    }

    const requestId = startDirectoryIndexRequest(missingDirectories)
    sidebarStore.setDirectoryIndexLoading((current) =>
      updateDirectoryIndexLoadingState(current, missingDirectories, true)
    )

    void fetchDirectoryAgentsIndexes({
      machineId,
      viewerContextId,
      directories: missingDirectories,
    })
      .then((response) => {
        const activeDirectories = getActiveDirectoryIndexRequestDirectories(
          missingDirectories,
          requestId
        )
        if (activeDirectories.length === 0) return
        clearDirectoryIndexRequestDirectories(activeDirectories, requestId)

        const activeDirectoryIndexes = Object.fromEntries(
          activeDirectories.flatMap((directory) => {
            const indexData = response.directoryIndexes[directory]
            return indexData ? [[directory, indexData]] : []
          })
        )

        sidebarStore.setSidebarState((current) => {
          const nextDirectoryIndexDataByPath =
            Object.keys(activeDirectoryIndexes).length > 0
              ? mergeDirectoryIndexDataPreservingOptimistic(
                  current.directoryIndexDataByPath,
                  activeDirectoryIndexes
                )
              : current.directoryIndexDataByPath
          const nextDirectoryIndexLoading = updateDirectoryIndexLoadingState(
            current.directoryIndexLoading,
            activeDirectories,
            false
          )

          if (
            nextDirectoryIndexDataByPath === current.directoryIndexDataByPath &&
            nextDirectoryIndexLoading === current.directoryIndexLoading
          ) {
            return current
          }

          return {
            directoryIndexDataByPath: nextDirectoryIndexDataByPath,
            directoryIndexLoading: nextDirectoryIndexLoading,
          }
        })
      })
      .catch((error) => {
        const activeDirectories = getActiveDirectoryIndexRequestDirectories(
          missingDirectories,
          requestId
        )
        if (activeDirectories.length === 0) return
        clearDirectoryIndexRequestDirectories(activeDirectories, requestId)
        for (const directory of activeDirectories) {
          failedDirectoryIndexesRef.current.add(directory)
        }

        sidebarStore.setDirectoryIndexLoading((current) =>
          updateDirectoryIndexLoadingState(current, activeDirectories, false)
        )
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load sidebar agents"
        )
      })
  }, [
    baseSidebarDirectories,
    directoryIndexDataByPath,
    directoryIndexLoading,
    directoryIndexRetryNonce,
    sidebarDeferredDirectoryLoadingReady,
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

  const reorderSidebarDirectories = (nextDirectories: Array<string>) => {
    const normalizedNext = normalizeStoredDirectoryList(nextDirectories)
    if (normalizedNext.length === 0) return

    sidebarStore.setSidebarDirectories((current) => {
      const previous = normalizeStoredDirectoryList(current)
      if (JSON.stringify(previous) === JSON.stringify(normalizedNext)) {
        return current
      }

      machineLocalStorageSetItem(
        machineId,
        SIDEBAR_DIRECTORIES_STORAGE_KEY,
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

  const showRestoredAgentDirectory = (directory: string) => {
    sidebarStore.setSidebarDirectories((current) => {
      const normalizedCurrent = normalizeStoredDirectoryList(current)
      if (normalizedCurrent.includes(directory)) return current
      const next = normalizeStoredDirectoryList([
        ...normalizedCurrent,
        directory,
      ])
      machineLocalStorageSetItem(
        machineId,
        SIDEBAR_DIRECTORIES_STORAGE_KEY,
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
        visibleDirectories={visibleDirectories}
        directoryAgentsStore={directoryAgentsStore}
        matchingAgentCount={matchingAgentCount}
        selectedAgentKeys={selectedSidebarAgentKeys}
        activeAgentId={activeSidebarAgentId || undefined}
        activeAgentKey={activeSidebarAgentKey || undefined}
        pinnedAgentKeys={pinnedSidebarAgentKeys}
        emptyStateText={
          statusFilter ? "No agents with these states." : emptySidebarStateText
        }
        statusFilterActive={Boolean(statusFilter)}
        onOpenAddDirectoryDialog={() => {
          agentWorkspaceRef.current?.openAddDirectoryDialog()
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
        onMoveAgent={(entry, directory) => {
          void agentWorkspaceRef.current?.moveAgentToDirectory(entry, directory)
        }}
        onMoveAgentAnyDirectory={(entry) => {
          agentWorkspaceRef.current?.openMoveAgentDirectoryDialogForEntry(entry)
        }}
        onTogglePinnedAgent={togglePinnedAgent}
        onCreateAgentInDirectory={(directory) => {
          void agentWorkspaceRef.current?.createAgent(directory, {
            closeMobileSidebar: true,
          })
        }}
        onDeleteOldAgentsInDirectory={(directory) => {
          agentWorkspaceRef.current?.openDeleteOldDirectoryAgentsDialog(
            directory
          )
        }}
        onMarkAgentsRead={(entries) => {
          void agentWorkspaceRef.current?.markAgentsRead(entries)
        }}
        onRemoveDirectory={(directory) => {
          sidebarStore.setSidebarDirectories((current) => {
            const next = current.filter((entry) => entry !== directory)
            machineLocalStorageSetItem(
              machineId,
              SIDEBAR_DIRECTORIES_STORAGE_KEY,
              JSON.stringify(next)
            )
            return next
          })
        }}
        onReorderDirectories={reorderSidebarDirectories}
        onOpenArchivedAgents={() => setArchivedAgentsOpen(true)}
      />
      <ArchivedAgentsDialog
        open={archivedAgentsOpen}
        onOpenChange={setArchivedAgentsOpen}
        viewerContextId={viewerContextId}
        onRestored={(result) => showRestoredAgentDirectory(result.directory)}
      />
    </>
  )
}
