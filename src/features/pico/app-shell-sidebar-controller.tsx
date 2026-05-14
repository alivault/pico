import * as React from "react"
import { toast } from "sonner"

import {
  sameMapEntries,
  sameStringArray,
} from "@/features/pico/app-shell-common"
import {
  clearUnreadForActiveSidebarSession,
  fetchDirectorySessionsIndexes,
  getRenderedSidebarSessionKeys,
  mergeDirectoryIndexData,
  mergeSidebarSessionStatusMap,
  sameDirectoryIndexDataRecord,
  sameSessionEntryRecord,
  updateDirectoryIndexLoadingState,
  useAppShellSidebarValue,
  type AppShellSidebarStore,
  type DirectorySessionsIndexData,
} from "@/features/pico/app-shell-sidebar-store"
import type { AppShellSessionWorkspaceHandle } from "@/features/pico/app-shell-types"
import {
  AppSidebar,
  createDirectorySessionsStore,
} from "@/features/pico/sidebar"
import {
  normalizeSessionSelectionKeys,
  normalizeStoredDirectoryList,
  PINNED_SESSIONS_STORAGE_KEY,
  safeLocalStorageSetItem,
  sessionListEntryKey,
  SIDEBAR_DIRECTORIES_STORAGE_KEY,
} from "@/lib/pico"
import type { SessionListEntry } from "@/lib/pico/api"

const PINNED_SESSION_STORE_DIRECTORY = "__pico_pinned_sessions__"

function findSidebarSessionSelectionKey(
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

export function AppShellSidebarController({
  viewerContextId,
  sidebarStore,
  sessionWorkspaceRef,
}: {
  viewerContextId: string
  sidebarStore: AppShellSidebarStore
  sessionWorkspaceRef: React.RefObject<AppShellSessionWorkspaceHandle | null>
}) {
  const [directorySessionsStore] = React.useState(() =>
    createDirectorySessionsStore({}, {})
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
  const filteredDirectorySessions = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.filteredDirectorySessions,
    sameSessionEntryRecord
  )
  const pinnedSidebarSessions = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.pinnedSidebarSessions
  )
  const pinnedSidebarSessionKeys = pinnedSidebarSessions.flatMap((entry) => {
    const key = sessionListEntryKey(entry)
    return key ? [key] : []
  })
  const sidebarSessionEntriesByKey = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.sidebarSessionEntriesByKey,
    sameMapEntries
  )
  const visibleDirectories = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.visibleDirectories,
    sameStringArray
  )
  const directoryIndexDataByPath = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.directoryIndexDataByPath
  )
  const directoryIndexLoading = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.directoryIndexLoading
  )
  const selectedSidebarSessionKeys = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.selectedSidebarSessionKeys,
    sameStringArray
  )
  const sidebarSessionsEventSnapshot = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => {
      const event = snapshot.state.sessionsEvent
      const activeSessionId = snapshot.state.activeSidebarSessionId
      const activeSessionKey = snapshot.state.activeSidebarSessionKey
      const activeSessionPath = snapshot.state.activeSidebarSessionPath
      const statuses = snapshot.state.sidebarSessionStatusByKey
      const status =
        (activeSessionPath
          ? statuses[`path:${activeSessionPath}`]
          : undefined) ||
        (activeSessionId ? statuses[`id:${activeSessionId}`] : undefined) ||
        (activeSessionKey ? statuses[`key:${activeSessionKey}`] : undefined)

      return {
        event,
        activeSessionId,
        activeSessionKey,
        activeSessionPath,
        activeStreaming: Boolean(status?.streaming),
      }
    },
    (left, right) =>
      left.activeSessionId === right.activeSessionId &&
      left.activeSessionKey === right.activeSessionKey &&
      left.activeSessionPath === right.activeSessionPath &&
      left.activeStreaming === right.activeStreaming &&
      left.event?.activeSessionId === right.event?.activeSessionId &&
      left.event?.activeSessionKey === right.event?.activeSessionKey &&
      left.event?.activeSessionPath === right.event?.activeSessionPath &&
      sameStringArray(
        left.event?.directories || [],
        right.event?.directories || []
      )
  )
  const sessionsEvent = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.sessionsEvent
  )
  const activeSidebarSessionId = sidebarSessionsEventSnapshot.activeSessionId
  const activeSidebarSessionKey = sidebarSessionsEventSnapshot.activeSessionKey
  const activeSidebarSessionPath =
    sidebarSessionsEventSnapshot.activeSessionPath
  const activeSidebarSessionStreaming =
    sidebarSessionsEventSnapshot.activeStreaming
  const matchingSessionCount = visibleDirectories.reduce(
    (total, directory) =>
      total + (filteredDirectorySessions[directory]?.length ?? 0),
    0
  )
  const sessionSearch = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.sessionSearch
  )
  const sidebarDeferredDirectoryLoadingReady = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.sidebarDeferredDirectoryLoadingReady
  )
  const sidebarSessionSelectionAnchor = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.sidebarSessionSelectionAnchor
  )
  const lastActiveSidebarSelectionSyncRef = React.useRef({
    signature: "",
    key: "",
  })
  const directoryIndexRequestIdRef = React.useRef(0)
  const directoryIndexRequestIdsByPathRef = React.useRef<
    Record<string, number>
  >({})
  const sidebarDirectorySessionsSnapshotRef = React.useRef<{
    activeSessionId: string
    activeSessionKey: string
    activeSessionPath: string
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
    directorySessionsStore.setData(
      pinnedSidebarSessions.length > 0
        ? {
            ...filteredDirectorySessions,
            [PINNED_SESSION_STORE_DIRECTORY]: pinnedSidebarSessions,
          }
        : filteredDirectorySessions,
      directoryIndexLoading
    )
  }, [
    directoryIndexLoading,
    directorySessionsStore,
    filteredDirectorySessions,
    pinnedSidebarSessions,
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
      const next: Record<string, DirectorySessionsIndexData> = {}

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
    if (!viewerContextId || !sessionsEvent) return

    const payloadDirectoryIndexes = sessionsEvent.directoryIndexes || {}
    const payloadDirectories = Object.keys(payloadDirectoryIndexes)
    const payloadDirectorySet = new Set(payloadDirectories)

    sidebarStore.setSidebarState((current) => {
      const merged = payloadDirectories.length
        ? mergeDirectoryIndexData(
            current.directoryIndexDataByPath,
            payloadDirectoryIndexes
          )
        : current.directoryIndexDataByPath
      const nextDirectoryIndexDataByPath = clearUnreadForActiveSidebarSession(
        merged,
        {
          sessionId: activeSidebarSessionId,
          sessionPath: activeSidebarSessionPath,
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

    const previousSnapshot = sidebarDirectorySessionsSnapshotRef.current
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

      if (activeSidebarSessionStreaming) {
        continue
      }

      directoriesToRefresh.push(directory)
    }

    sidebarDirectorySessionsSnapshotRef.current = {
      activeSessionId: activeSidebarSessionId,
      activeSessionKey: activeSidebarSessionKey,
      activeSessionPath: activeSidebarSessionPath,
      revisions: nextRevisions,
    }

    if (directoriesToRefresh.length === 0) {
      return
    }

    const requestId = startDirectoryIndexRequest(directoriesToRefresh)

    void fetchDirectorySessionsIndexes({
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
              ? mergeDirectoryIndexData(
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
            : "Failed to load sidebar sessions"
        )
      })
  }, [
    baseSidebarDirectories,
    directoryIndexDataByPath,
    directoryIndexLoading,
    activeSidebarSessionId,
    activeSidebarSessionKey,
    activeSidebarSessionPath,
    activeSidebarSessionStreaming,
    directoryStateByPath,
    sessionsEvent,
    sidebarStore,
    viewerContextId,
  ])

  React.useEffect(() => {
    if (
      !activeSidebarSessionId &&
      !activeSidebarSessionKey &&
      !activeSidebarSessionPath
    ) {
      return
    }

    sidebarStore.setSidebarSessionStatusByKey((current) =>
      mergeSidebarSessionStatusMap(current, {
        type: "session_status",
        sessionKey: activeSidebarSessionKey,
        sessionId: activeSidebarSessionId,
        sessionPath: activeSidebarSessionPath,
        unread: false,
      })
    )
  }, [
    activeSidebarSessionId,
    activeSidebarSessionKey,
    activeSidebarSessionPath,
    sidebarStore,
  ])

  React.useEffect(() => {
    const activeSignature = [
      activeSidebarSessionId,
      activeSidebarSessionPath,
      activeSidebarSessionKey,
    ].join("\0")
    let nextKey = findSidebarSessionSelectionKey(sidebarSessionEntriesByKey, {
      sessionId: activeSidebarSessionId,
      sessionPath: activeSidebarSessionPath,
    })

    if (
      !nextKey &&
      activeSidebarSessionKey &&
      sidebarSessionEntriesByKey.has(activeSidebarSessionKey)
    ) {
      nextKey = activeSidebarSessionKey
    }

    const previous = lastActiveSidebarSelectionSyncRef.current
    if (previous.signature === activeSignature && previous.key === nextKey) {
      return
    }

    lastActiveSidebarSelectionSyncRef.current = {
      signature: activeSignature,
      key: nextKey,
    }
    sidebarStore.setSelectedSidebarSessionKeys((current) => {
      const nextKeys = nextKey ? [nextKey] : []
      return sameStringArray(current, nextKeys) ? current : nextKeys
    })
    sidebarStore.setSidebarSessionSelectionAnchor((current) =>
      current === nextKey ? current : nextKey
    )
  }, [
    activeSidebarSessionId,
    activeSidebarSessionKey,
    activeSidebarSessionPath,
    sidebarSessionEntriesByKey,
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
        !directoryIndexRequestIdsByPathRef.current[directory]
    )

    if (missingDirectories.length === 0) {
      return
    }

    const requestId = startDirectoryIndexRequest(missingDirectories)
    sidebarStore.setDirectoryIndexLoading((current) =>
      updateDirectoryIndexLoadingState(current, missingDirectories, true)
    )

    void fetchDirectorySessionsIndexes({
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
              ? mergeDirectoryIndexData(
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

        sidebarStore.setDirectoryIndexLoading((current) =>
          updateDirectoryIndexLoadingState(current, activeDirectories, false)
        )
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load sidebar sessions"
        )
      })
  }, [
    baseSidebarDirectories,
    directoryIndexDataByPath,
    directoryIndexLoading,
    sidebarDeferredDirectoryLoadingReady,
    sidebarStore,
    viewerContextId,
  ])

  React.useEffect(() => {
    const validKeys = new Set(sidebarSessionEntriesByKey.keys())

    sidebarStore.setSelectedSidebarSessionKeys((current) => {
      const next = current.filter((key) => validKeys.has(key))
      return next.length === current.length ? current : next
    })

    sidebarStore.setSidebarSessionSelectionAnchor((current) =>
      current && validKeys.has(current) ? current : ""
    )
  }, [sidebarSessionEntriesByKey, sidebarStore])

  const reorderSidebarDirectories = (nextDirectories: Array<string>) => {
    const normalizedNext = normalizeStoredDirectoryList(nextDirectories)
    if (normalizedNext.length === 0) return

    sidebarStore.setSidebarDirectories((current) => {
      const previous = normalizeStoredDirectoryList(current)
      if (JSON.stringify(previous) === JSON.stringify(normalizedNext)) {
        return current
      }

      safeLocalStorageSetItem(
        SIDEBAR_DIRECTORIES_STORAGE_KEY,
        JSON.stringify(normalizedNext)
      )
      return normalizedNext
    })
  }

  const togglePinnedSession = (entry: SessionListEntry) => {
    const key = sessionListEntryKey(entry)
    if (!key) return

    sidebarStore.setPinnedSidebarSessionKeys((current) => {
      const currentKeys = normalizeSessionSelectionKeys(current)
      const nextKeys = currentKeys.includes(key)
        ? currentKeys.filter((currentKey) => currentKey !== key)
        : [key, ...currentKeys]

      safeLocalStorageSetItem(
        PINNED_SESSIONS_STORAGE_KEY,
        JSON.stringify(nextKeys)
      )
      return nextKeys
    })
  }

  const setSidebarSelection = (nextKeys: Array<string>, anchorKey = "") => {
    const normalizedKeys = normalizeSessionSelectionKeys(nextKeys)
    const nextAnchor =
      normalizedKeys.length === 0
        ? ""
        : anchorKey && normalizedKeys.includes(anchorKey)
          ? anchorKey
          : (normalizedKeys[normalizedKeys.length - 1] ?? "")

    sidebarStore.setSelectedSidebarSessionKeys((current) =>
      sameStringArray(current, normalizedKeys) ? current : normalizedKeys
    )
    sidebarStore.setSidebarSessionSelectionAnchor((current) =>
      current === nextAnchor ? current : nextAnchor
    )
  }

  const selectSidebarSessionRange = (targetKey: string) => {
    const normalizedTargetKey = targetKey.trim()
    if (!normalizedTargetKey) return

    const orderedKeys = getRenderedSidebarSessionKeys()
    const targetIndex = orderedKeys.indexOf(normalizedTargetKey)
    if (targetIndex < 0) {
      setSidebarSelection([normalizedTargetKey], normalizedTargetKey)
      return
    }

    const anchorKey = orderedKeys.includes(sidebarSessionSelectionAnchor)
      ? sidebarSessionSelectionAnchor
      : (selectedSidebarSessionKeys.find((key) => orderedKeys.includes(key)) ??
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

  const handleSidebarSessionClick = (
    entry: SessionListEntry,
    modifiers: { multiSelectKey: boolean; shiftKey: boolean }
  ) => {
    const key = sessionListEntryKey(entry)

    if (!key) {
      if (entry.id) {
        sessionWorkspaceRef.current?.selectSession(entry.id, {
          sessionPath: entry.path,
        })
      }
      return
    }

    if (modifiers.shiftKey) {
      selectSidebarSessionRange(key)
      return
    }

    if (modifiers.multiSelectKey) {
      setSidebarSelection(
        selectedSidebarSessionKeys.includes(key)
          ? selectedSidebarSessionKeys.filter(
              (currentKey) => currentKey !== key
            )
          : [...selectedSidebarSessionKeys, key],
        key
      )
      return
    }

    setSidebarSelection([key], key)
    if (entry.id) {
      sessionWorkspaceRef.current?.selectSession(entry.id, {
        sessionPath: entry.path,
      })
    }
  }

  return (
    <AppSidebar
      sessionSearch={sessionSearch}
      onOpenSessionsDialog={() => {
        sessionWorkspaceRef.current?.openSessionsDialog()
      }}
      visibleDirectories={visibleDirectories}
      directorySessionsStore={directorySessionsStore}
      matchingSessionCount={matchingSessionCount}
      selectedSessionKeys={selectedSidebarSessionKeys}
      activeSessionId={activeSidebarSessionId || undefined}
      activeSessionKey={activeSidebarSessionKey || undefined}
      pinnedSessionKeys={pinnedSidebarSessionKeys}
      emptyStateText={emptySidebarStateText}
      onCreateSession={() => {
        void sessionWorkspaceRef.current?.createSession(undefined, {
          closeMobileSidebar: true,
        })
      }}
      onOpenAddDirectoryDialog={() => {
        sessionWorkspaceRef.current?.openAddDirectoryDialog()
      }}
      onOpenCommandPalette={() => {
        sessionWorkspaceRef.current?.openCommandPalette()
      }}
      onOpenSettings={() => {
        sessionWorkspaceRef.current?.openSettingsDialog()
      }}
      onSessionClick={handleSidebarSessionClick}
      onRenameSession={(entry) => {
        sessionWorkspaceRef.current?.openRenameDialogForEntry(entry)
      }}
      onDeleteSession={(entry) => {
        sessionWorkspaceRef.current?.openDeleteDialog([entry])
      }}
      onMoveSession={(entry, directory) => {
        void sessionWorkspaceRef.current?.moveSessionToDirectory(
          entry,
          directory
        )
      }}
      onMoveSessionAnyDirectory={(entry) => {
        sessionWorkspaceRef.current?.openMoveSessionDirectoryDialogForEntry(
          entry
        )
      }}
      onTogglePinnedSession={togglePinnedSession}
      onCreateSessionInDirectory={(directory) => {
        void sessionWorkspaceRef.current?.createSession(directory, {
          closeMobileSidebar: true,
        })
      }}
      onDeleteOldSessionsInDirectory={(directory) => {
        sessionWorkspaceRef.current?.openDeleteOldDirectorySessionsDialog(
          directory
        )
      }}
      onRemoveDirectory={(directory) => {
        sidebarStore.setSidebarDirectories((current) => {
          const next = current.filter((entry) => entry !== directory)
          safeLocalStorageSetItem(
            SIDEBAR_DIRECTORIES_STORAGE_KEY,
            JSON.stringify(next)
          )
          return next
        })
      }}
      onReorderDirectories={reorderSidebarDirectories}
    />
  )
}
