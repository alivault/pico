import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

import type { SessionState } from "@/lib/pi-web"
import type {
  DeleteSessionsResponse,
  DirectorySessionsIndexSnapshot,
  RenameSessionResponse,
  SessionListEntry,
  SessionsEvent,
  ThinkingResponse,
} from "@/lib/pi-web-api"

import { buildRequestUrl, fetchJson } from "@/features/pi-web/app-shell-utils"
import { sessionListEntryKey } from "@/lib/pi-web"

type ThinkingResponseData = Extract<ThinkingResponse, { ok: true }>
type RenameSessionResponseData = Extract<RenameSessionResponse, { ok: true }>
type DirectoryIndexDataByPath = Record<string, DirectorySessionsIndexSnapshot>

type SidebarSelectionSnapshot = {
  selectedSidebarSessionKeys: Array<string>
  sidebarSessionSelectionAnchor: string
}

type ThinkingLevelSessionTarget = {
  cwd: string | undefined
  draft: boolean
  sessionFile: string | undefined
  sessionId: string | undefined
  sessionKey: string | undefined
}

function sameThinkingLevelSessionTarget(
  target: ThinkingLevelSessionTarget,
  state: SessionState
) {
  if (target.sessionKey || state.sessionKey) {
    return target.sessionKey === state.sessionKey
  }
  if (target.sessionId || state.sessionId) {
    return target.sessionId === state.sessionId
  }
  if (target.sessionFile || state.sessionFile) {
    return target.sessionFile === state.sessionFile
  }
  return target.cwd === state.cwd && target.draft === state.draft
}

function sameStringArray(left: Array<string>, right: Array<string>) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }

  return true
}

function applyDirectoryIndexRename(
  current: DirectoryIndexDataByPath,
  targetPath: string,
  nextName: string
) {
  let changed = false
  const next: DirectoryIndexDataByPath = { ...current }

  for (const [directory, snapshot] of Object.entries(current)) {
    let sessionsChanged = false
    const sessions = snapshot.sessions.map((entry) => {
      if (entry.path !== targetPath) return entry
      if (entry.name === nextName && entry.title === nextName) return entry

      sessionsChanged = true
      changed = true
      return {
        ...entry,
        name: nextName,
        title: nextName,
      }
    })

    if (sessionsChanged) {
      next[directory] = {
        ...snapshot,
        sessions,
      }
    }
  }

  return changed ? next : current
}

function applyDirectoryIndexDelete(
  current: DirectoryIndexDataByPath,
  targetPaths: Set<string>
) {
  if (targetPaths.size === 0) return current

  let changed = false
  const next: DirectoryIndexDataByPath = { ...current }

  for (const [directory, snapshot] of Object.entries(current)) {
    const sessions = snapshot.sessions.filter(
      (entry) => !entry.path || !targetPaths.has(entry.path)
    )
    const removedCount = snapshot.sessions.length - sessions.length
    if (removedCount === 0) continue

    changed = true
    next[directory] = {
      ...snapshot,
      totalCount: Math.max(0, snapshot.totalCount - removedCount),
      sessions,
    }
  }

  return changed ? next : current
}

function directoriesWithSessionPaths(
  indexes: DirectoryIndexDataByPath | undefined,
  targetPaths: Set<string>
) {
  if (!indexes || targetPaths.size === 0) return []

  const directories: Array<string> = []
  for (const [directory, snapshot] of Object.entries(indexes)) {
    if (
      snapshot.sessions.some(
        (entry) => entry.path && targetPaths.has(entry.path)
      )
    ) {
      directories.push(directory)
    }
  }

  return directories
}

function restoreDirectoryIndexesForDirectories(
  current: DirectoryIndexDataByPath,
  previous: DirectoryIndexDataByPath | undefined,
  directories: Array<string>
) {
  if (directories.length === 0) return current

  let changed = false
  const next: DirectoryIndexDataByPath = { ...current }

  for (const directory of directories) {
    const previousSnapshot = previous?.[directory]
    if (previousSnapshot) {
      if (current[directory] !== previousSnapshot) {
        next[directory] = previousSnapshot
        changed = true
      }
      continue
    }

    if (Object.prototype.hasOwnProperty.call(current, directory)) {
      delete next[directory]
      changed = true
    }
  }

  return changed ? next : current
}

function updateSessionsEventDirectoryIndexes(
  current: SessionsEvent | null,
  updater: (indexes: DirectoryIndexDataByPath) => DirectoryIndexDataByPath
) {
  if (!current?.directoryIndexes) return current

  const nextDirectoryIndexes = updater(current.directoryIndexes)
  if (nextDirectoryIndexes === current.directoryIndexes) return current

  return {
    ...current,
    directoryIndexes: nextDirectoryIndexes,
  }
}

function optimisticSelectionAfterDelete(
  selection: SidebarSelectionSnapshot,
  deletedKeys: Set<string>
): SidebarSelectionSnapshot {
  const selectedSidebarSessionKeys =
    selection.selectedSidebarSessionKeys.filter((key) => !deletedKeys.has(key))
  const sidebarSessionSelectionAnchor =
    selection.sidebarSessionSelectionAnchor &&
    deletedKeys.has(selection.sidebarSessionSelectionAnchor)
      ? ""
      : selection.sidebarSessionSelectionAnchor

  return {
    selectedSidebarSessionKeys,
    sidebarSessionSelectionAnchor,
  }
}

type UseAppShellSessionMutationsOptions = {
  viewerContextId: string
  activeSessionId?: string
  sessionStateRef: React.MutableRefObject<SessionState>
  setSessionState: React.Dispatch<React.SetStateAction<SessionState>>
  getDirectoryIndexDataByPath: () => DirectoryIndexDataByPath
  setDirectoryIndexDataByPath: React.Dispatch<
    React.SetStateAction<DirectoryIndexDataByPath>
  >
  getSessionsEvent: () => SessionsEvent | null
  setSessionsEvent: React.Dispatch<React.SetStateAction<SessionsEvent | null>>
  getSidebarSelection: () => SidebarSelectionSnapshot
  optimisticallyClearActiveDeletedSession?: (
    targetPath: string
  ) => (() => void) | undefined
  setSelectedSidebarSessionKeys: React.Dispatch<
    React.SetStateAction<Array<string>>
  >
  setSidebarSessionSelectionAnchor: React.Dispatch<React.SetStateAction<string>>
  setRunningSlashCommand: React.Dispatch<React.SetStateAction<string | null>>
}

export function useAppShellSessionMutations({
  viewerContextId,
  activeSessionId,
  sessionStateRef,
  setSessionState,
  getDirectoryIndexDataByPath,
  setDirectoryIndexDataByPath,
  getSessionsEvent,
  setSessionsEvent,
  getSidebarSelection,
  optimisticallyClearActiveDeletedSession,
  setSelectedSidebarSessionKeys,
  setSidebarSessionSelectionAnchor,
  setRunningSlashCommand,
}: UseAppShellSessionMutationsOptions) {
  const thinkingLevelRequestIdRef = React.useRef(0)
  const thinkingLevelSyncTimerRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null)

  React.useEffect(() => {
    return () => {
      if (thinkingLevelSyncTimerRef.current) {
        clearTimeout(thinkingLevelSyncTimerRef.current)
      }
    }
  }, [])

  const setModelMutation = useMutation({
    mutationFn: async ({
      provider,
      modelId,
    }: {
      provider: string
      modelId: string
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson(
        buildRequestUrl("/api/model", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider, modelId }),
        }
      )
    },
  })

  const setModel = React.useCallback(
    async (value: string) => {
      if (!viewerContextId) return
      const [provider, modelId] = value.split("/")
      if (!provider || !modelId) return
      try {
        await setModelMutation.mutateAsync({ provider, modelId })
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update model"
        )
      }
    },
    [setModelMutation, viewerContextId]
  )

  const setThinkingLevel = React.useCallback(
    async (level: string) => {
      if (!viewerContextId) return

      const requestId = thinkingLevelRequestIdRef.current + 1
      thinkingLevelRequestIdRef.current = requestId
      const previousState = sessionStateRef.current
      const previousLevel = previousState.thinkingLevel
      const previousAvailableThinkingLevels =
        previousState.availableThinkingLevels
      const targetSession = {
        cwd: previousState.cwd,
        draft: previousState.draft,
        sessionFile: previousState.sessionFile,
        sessionId: previousState.sessionId,
        sessionKey: previousState.sessionKey,
      } satisfies ThinkingLevelSessionTarget

      if (previousLevel !== level) {
        setSessionState({ ...previousState, thinkingLevel: level })
      }

      if (thinkingLevelSyncTimerRef.current) {
        clearTimeout(thinkingLevelSyncTimerRef.current)
      }

      thinkingLevelSyncTimerRef.current = setTimeout(() => {
        thinkingLevelSyncTimerRef.current = null
        void (async () => {
          try {
            const response = await fetchJson<ThinkingResponseData>(
              buildRequestUrl("/api/thinking", {
                contextId: viewerContextId,
                sessionId: activeSessionId,
              }),
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ level }),
              }
            )
            if (thinkingLevelRequestIdRef.current !== requestId) return

            const currentState = sessionStateRef.current
            if (!sameThinkingLevelSessionTarget(targetSession, currentState)) {
              return
            }

            const nextLevel = response.thinkingLevel || level
            const nextAvailableThinkingLevels =
              response.availableThinkingLevels.length > 0
                ? response.availableThinkingLevels
                : currentState.availableThinkingLevels
            if (
              currentState.thinkingLevel === nextLevel &&
              currentState.availableThinkingLevels ===
                nextAvailableThinkingLevels
            ) {
              return
            }

            setSessionState({
              ...currentState,
              thinkingLevel: nextLevel,
              availableThinkingLevels: nextAvailableThinkingLevels,
            })
          } catch (error) {
            if (thinkingLevelRequestIdRef.current !== requestId) return

            const currentState = sessionStateRef.current
            if (
              sameThinkingLevelSessionTarget(targetSession, currentState) &&
              currentState.thinkingLevel === level
            ) {
              setSessionState({
                ...currentState,
                thinkingLevel: previousLevel,
                availableThinkingLevels: previousAvailableThinkingLevels,
              })
            }
            toast.error(
              error instanceof Error
                ? error.message
                : "Failed to update thinking level"
            )
          }
        })()
      }, 100)
    },
    [sessionStateRef, activeSessionId, setSessionState, viewerContextId]
  )

  const cycleThinkingLevel = React.useCallback(
    async (direction: -1 | 1) => {
      const sessionState = sessionStateRef.current
      const levels = sessionState.availableThinkingLevels.length
        ? sessionState.availableThinkingLevels
        : ["off"]
      const currentIndex = levels.indexOf(sessionState.thinkingLevel || "off")
      const safeIndex = currentIndex >= 0 ? currentIndex : 0
      const nextLevel =
        levels[(safeIndex + direction + levels.length) % levels.length] ||
        levels[0]
      await setThinkingLevel(nextLevel)
    },
    [sessionStateRef, setThinkingLevel]
  )

  const setThinkingBlocksHiddenMutation = useMutation({
    mutationFn: async (hidden: boolean) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson(
        buildRequestUrl("/api/settings/hide-thinking", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hide: hidden }),
        }
      )
    },
  })

  const setThinkingBlocksHidden = React.useCallback(
    async (hidden: boolean) => {
      if (!viewerContextId) return
      try {
        await setThinkingBlocksHiddenMutation.mutateAsync(hidden)
        toast.info(hidden ? "Thinking hidden" : "Thinking shown")
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update thinking visibility"
        )
      }
    },
    [setThinkingBlocksHiddenMutation, viewerContextId]
  )

  const toggleHideThinking = React.useCallback(async () => {
    await setThinkingBlocksHidden(!sessionStateRef.current.hideThinkingBlock)
  }, [sessionStateRef, setThinkingBlocksHidden])

  const compactMutation = useMutation({
    mutationFn: async () => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson(
        buildRequestUrl("/api/slash-command", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "compact", args: "" }),
        }
      )
    },
  })

  const runCompact = React.useCallback(async () => {
    if (!viewerContextId) return
    setRunningSlashCommand("compact")
    try {
      await compactMutation.mutateAsync()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to compact session"
      )
    } finally {
      setRunningSlashCommand(null)
    }
  }, [compactMutation, setRunningSlashCommand, viewerContextId])

  const renameSessionMutation = useMutation({
    mutationFn: async ({ path, name }: { path: string; name: string }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<RenameSessionResponseData>(
        buildRequestUrl("/api/session/rename", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path, name }),
        }
      )
    },
  })

  const renameSessionPath = React.useCallback(
    async (targetPath: string | undefined, nextName: string) => {
      if (!viewerContextId || !targetPath) return false

      const optimisticName = nextName.trim()
      if (!optimisticName) {
        toast.error("Name is required")
        return false
      }

      const previousDirectoryIndexDataByPath = getDirectoryIndexDataByPath()
      const previousSessionsEvent = getSessionsEvent()
      const targetPaths = new Set([targetPath])
      const affectedDirectories = directoriesWithSessionPaths(
        previousDirectoryIndexDataByPath,
        targetPaths
      )
      const affectedEventDirectories = directoriesWithSessionPaths(
        previousSessionsEvent?.directoryIndexes,
        targetPaths
      )
      const previousSessionName = sessionStateRef.current.sessionName
      const activeSessionMatches =
        sessionStateRef.current.sessionFile === targetPath

      setSessionsEvent((current) =>
        updateSessionsEventDirectoryIndexes(current, (indexes) =>
          applyDirectoryIndexRename(indexes, targetPath, optimisticName)
        )
      )
      setDirectoryIndexDataByPath((current) =>
        applyDirectoryIndexRename(current, targetPath, optimisticName)
      )

      if (
        activeSessionMatches &&
        sessionStateRef.current.sessionName !== optimisticName
      ) {
        setSessionState((current) =>
          current.sessionFile === targetPath
            ? { ...current, sessionName: optimisticName }
            : current
        )
      }

      void (async () => {
        try {
          const response = await renameSessionMutation.mutateAsync({
            path: targetPath,
            name: optimisticName,
          })
          const confirmedName = response.name || optimisticName

          if (confirmedName !== optimisticName) {
            setSessionsEvent((current) =>
              updateSessionsEventDirectoryIndexes(current, (indexes) =>
                applyDirectoryIndexRename(indexes, targetPath, confirmedName)
              )
            )
            setDirectoryIndexDataByPath((current) =>
              applyDirectoryIndexRename(current, targetPath, confirmedName)
            )
            setSessionState((current) =>
              current.sessionFile === targetPath &&
              current.sessionName === optimisticName
                ? { ...current, sessionName: confirmedName }
                : current
            )
          }

          toast.success("Renamed session")
        } catch (error) {
          setSessionsEvent((current) =>
            updateSessionsEventDirectoryIndexes(current, (indexes) =>
              restoreDirectoryIndexesForDirectories(
                indexes,
                previousSessionsEvent?.directoryIndexes,
                affectedEventDirectories
              )
            )
          )
          setDirectoryIndexDataByPath((current) =>
            restoreDirectoryIndexesForDirectories(
              current,
              previousDirectoryIndexDataByPath,
              affectedDirectories
            )
          )
          setSessionState((current) =>
            current.sessionFile === targetPath &&
            current.sessionName === optimisticName
              ? { ...current, sessionName: previousSessionName }
              : current
          )
          toast.error(
            error instanceof Error ? error.message : "Failed to rename session"
          )
        }
      })()

      return true
    },
    [
      getDirectoryIndexDataByPath,
      getSessionsEvent,
      renameSessionMutation,
      sessionStateRef,
      setDirectoryIndexDataByPath,
      setSessionState,
      setSessionsEvent,
      viewerContextId,
    ]
  )

  const deleteSessionMutation = useMutation({
    mutationFn: async (paths: Array<string>) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      await fetchJson<DeleteSessionsResponse>(
        buildRequestUrl("/api/sessions/delete", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paths }),
        }
      )
    },
  })

  const deleteSessions = React.useCallback(
    async (targets: Array<SessionListEntry>) => {
      if (!viewerContextId || targets.length === 0) return false

      const orderedTargets = [
        ...targets.filter(
          (target) =>
            target.path && target.path !== sessionStateRef.current.sessionFile
        ),
        ...targets.filter(
          (target) =>
            target.path && target.path === sessionStateRef.current.sessionFile
        ),
      ]
      const orderedPaths: Array<string> = []
      const deletedPathSet = new Set<string>()
      for (const target of orderedTargets) {
        if (!target.path || deletedPathSet.has(target.path)) continue
        deletedPathSet.add(target.path)
        orderedPaths.push(target.path)
      }

      if (orderedPaths.length === 0) return false

      const deletedKeys = new Set(
        orderedTargets
          .map((target) => sessionListEntryKey(target))
          .filter(Boolean)
      )
      const previousDirectoryIndexDataByPath = getDirectoryIndexDataByPath()
      const previousSessionsEvent = getSessionsEvent()
      const affectedDirectories = directoriesWithSessionPaths(
        previousDirectoryIndexDataByPath,
        deletedPathSet
      )
      const affectedEventDirectories = directoriesWithSessionPaths(
        previousSessionsEvent?.directoryIndexes,
        deletedPathSet
      )
      const previousSelection = getSidebarSelection()
      const optimisticSelection = optimisticSelectionAfterDelete(
        previousSelection,
        deletedKeys
      )

      setSessionsEvent((current) =>
        updateSessionsEventDirectoryIndexes(current, (indexes) =>
          applyDirectoryIndexDelete(indexes, deletedPathSet)
        )
      )
      setDirectoryIndexDataByPath((current) =>
        applyDirectoryIndexDelete(current, deletedPathSet)
      )
      setSelectedSidebarSessionKeys((current) =>
        current.filter((key) => !deletedKeys.has(key))
      )
      setSidebarSessionSelectionAnchor((current) =>
        current && deletedKeys.has(current) ? "" : current
      )
      const activeDeletedPath = sessionStateRef.current.sessionFile
      const rollbackActiveDeletedSession =
        activeDeletedPath && deletedPathSet.has(activeDeletedPath)
          ? optimisticallyClearActiveDeletedSession?.(activeDeletedPath)
          : undefined

      void (async () => {
        try {
          await deleteSessionMutation.mutateAsync(orderedPaths)
          toast.success(
            orderedPaths.length === 1
              ? "Deleted session"
              : `Deleted ${orderedPaths.length} sessions`
          )
        } catch (error) {
          setSessionsEvent((current) =>
            updateSessionsEventDirectoryIndexes(current, (indexes) =>
              restoreDirectoryIndexesForDirectories(
                indexes,
                previousSessionsEvent?.directoryIndexes,
                affectedEventDirectories
              )
            )
          )
          setDirectoryIndexDataByPath((current) =>
            restoreDirectoryIndexesForDirectories(
              current,
              previousDirectoryIndexDataByPath,
              affectedDirectories
            )
          )

          rollbackActiveDeletedSession?.()

          const currentSelection = getSidebarSelection()
          if (
            sameStringArray(
              currentSelection.selectedSidebarSessionKeys,
              optimisticSelection.selectedSidebarSessionKeys
            ) &&
            currentSelection.sidebarSessionSelectionAnchor ===
              optimisticSelection.sidebarSessionSelectionAnchor
          ) {
            setSelectedSidebarSessionKeys(
              previousSelection.selectedSidebarSessionKeys
            )
            setSidebarSessionSelectionAnchor(
              previousSelection.sidebarSessionSelectionAnchor
            )
          }

          toast.error(
            error instanceof Error ? error.message : "Failed to delete session"
          )
        }
      })()

      return true
    },
    [
      deleteSessionMutation,
      getDirectoryIndexDataByPath,
      getSessionsEvent,
      getSidebarSelection,
      optimisticallyClearActiveDeletedSession,
      sessionStateRef,
      setDirectoryIndexDataByPath,
      setSelectedSidebarSessionKeys,
      setSessionsEvent,
      setSidebarSessionSelectionAnchor,
      viewerContextId,
    ]
  )

  return {
    cycleThinkingLevel,
    deleteSessions,
    renameSessionPath,
    runCompact,
    setModel,
    setThinkingBlocksHidden,
    setThinkingLevel,
    toggleHideThinking,
  }
}
