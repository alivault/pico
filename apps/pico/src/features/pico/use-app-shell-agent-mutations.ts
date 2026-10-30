import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/pico/toast"

import type { AgentState } from "@/lib/pico"
import type {
  CloneAgentResponse,
  DeleteAgentsResponse,
  DirectoryAgentsIndexSnapshot,
  MoveAgentResponse,
  ModelResponse,
  RenameAgentResponse,
  AgentListEntry,
  AgentsEvent,
  ThinkingResponse,
} from "@/lib/pico/api"

import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  PINNED_AGENTS_STORAGE_KEY,
  machineLocalStorageSetItem,
  agentListEntryKey,
} from "@/lib/pico"
import { useMachineId } from "@/lib/pico/machine-context"
import { sortSidebarAgents } from "@/features/pico/agent-order"

type CloneAgentResponseData = Extract<CloneAgentResponse, { ok: true }>
type ThinkingResponseData = Extract<ThinkingResponse, { ok: true }>
type ModelResponseData = Extract<ModelResponse, { ok: true }>
type RenameAgentResponseData = Extract<RenameAgentResponse, { ok: true }>
type MoveAgentResponseData = Extract<MoveAgentResponse, { ok: true }>
type DirectoryIndexDataByPath = Record<string, DirectoryAgentsIndexSnapshot>

type SidebarSelectionSnapshot = {
  selectedSidebarAgentKeys: Array<string>
  sidebarAgentSelectionAnchor: string
}

type AgentMutationTarget = Pick<
  AgentState,
  "cwd" | "draft" | "agentFile" | "agentId" | "agentKey"
>

function sameAgentMutationTarget(
  target: AgentMutationTarget,
  state: AgentState
) {
  if (target.agentKey || state.agentKey) {
    return target.agentKey === state.agentKey
  }
  if (target.agentId || state.agentId) {
    return target.agentId === state.agentId
  }
  if (target.agentFile || state.agentFile) {
    return target.agentFile === state.agentFile
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

export function applyDirectoryIndexRename(
  current: DirectoryIndexDataByPath,
  targetPath: string,
  nextName: string
) {
  let changed = false
  const next: DirectoryIndexDataByPath = { ...current }

  for (const [directory, snapshot] of Object.entries(current)) {
    let agentsChanged = false
    const agents = snapshot.agents.map((entry) => {
      if (entry.path !== targetPath) return entry
      if (entry.name === nextName && entry.title === nextName) return entry

      agentsChanged = true
      changed = true
      return {
        ...entry,
        name: nextName,
        title: nextName,
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

function applyDirectoryIndexDelete(
  current: DirectoryIndexDataByPath,
  targetPaths: Set<string>
) {
  if (targetPaths.size === 0) return current

  let changed = false
  const next: DirectoryIndexDataByPath = { ...current }

  for (const [directory, snapshot] of Object.entries(current)) {
    const agents = snapshot.agents.filter(
      (entry) => !entry.path || !targetPaths.has(entry.path)
    )
    const removedCount = snapshot.agents.length - agents.length
    if (removedCount === 0) continue

    changed = true
    next[directory] = {
      ...snapshot,
      totalCount: Math.max(0, snapshot.totalCount - removedCount),
      agents,
    }
  }

  return changed ? next : current
}

function agentEntryMatchesMoveTarget(
  entry: AgentListEntry,
  options: {
    previousPath: string
    nextPath: string
    agentId: string
  }
) {
  return Boolean(
    (entry.path &&
      (entry.path === options.previousPath ||
        entry.path === options.nextPath)) ||
    (options.agentId && entry.id === options.agentId)
  )
}

function applyDirectoryIndexMove(
  current: DirectoryIndexDataByPath,
  options: {
    previousPath: string
    nextPath?: string
    nextCwd: string
    fallbackEntry: AgentListEntry
  }
) {
  const previousPath = options.previousPath.trim()
  const nextPath = (options.nextPath || previousPath).trim()
  const nextCwd = options.nextCwd.trim()
  if (!previousPath || !nextPath || !nextCwd) return current

  const agentId = options.fallbackEntry.id || ""
  let changed = false
  let movedEntry: AgentListEntry | undefined
  const next: DirectoryIndexDataByPath = { ...current }

  for (const [directory, snapshot] of Object.entries(current)) {
    let removedCount = 0
    const agents = snapshot.agents.filter((entry) => {
      if (
        !agentEntryMatchesMoveTarget(entry, {
          previousPath,
          nextPath,
          agentId,
        })
      ) {
        return true
      }

      movedEntry = movedEntry ?? entry
      removedCount += 1
      return false
    })

    if (removedCount === 0) continue

    changed = true
    next[directory] = {
      ...snapshot,
      totalCount: Math.max(0, snapshot.totalCount - removedCount),
      agents,
    }
  }

  const targetSnapshot = next[nextCwd] || current[nextCwd]
  if (!targetSnapshot) return changed ? next : current

  const nextEntry = {
    ...(movedEntry || options.fallbackEntry),
    path: nextPath,
    cwd: nextCwd,
  }
  const alreadyInTarget = targetSnapshot.agents.some((entry) =>
    agentEntryMatchesMoveTarget(entry, {
      previousPath: nextPath,
      nextPath,
      agentId: nextEntry.id || agentId,
    })
  )
  if (alreadyInTarget) return changed ? next : current

  changed = true
  next[nextCwd] = {
    ...targetSnapshot,
    totalCount: targetSnapshot.totalCount + 1,
    agents: sortSidebarAgents([nextEntry, ...targetSnapshot.agents]),
  }

  return next
}

function directoriesWithAgentPaths(
  indexes: DirectoryIndexDataByPath | undefined,
  targetPaths: Set<string>
) {
  if (!indexes || targetPaths.size === 0) return []

  const directories: Array<string> = []
  for (const [directory, snapshot] of Object.entries(indexes)) {
    if (
      snapshot.agents.some((entry) => entry.path && targetPaths.has(entry.path))
    ) {
      directories.push(directory)
    }
  }

  return directories
}

function uniqueDirectories(directories: Array<string>) {
  return Array.from(new Set(directories.filter(Boolean)))
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

export function updateAgentsEventDirectoryIndexes(
  current: AgentsEvent | null,
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
  const selectedSidebarAgentKeys = selection.selectedSidebarAgentKeys.filter(
    (key) => !deletedKeys.has(key)
  )
  const sidebarAgentSelectionAnchor =
    selection.sidebarAgentSelectionAnchor &&
    deletedKeys.has(selection.sidebarAgentSelectionAnchor)
      ? ""
      : selection.sidebarAgentSelectionAnchor

  return {
    selectedSidebarAgentKeys,
    sidebarAgentSelectionAnchor,
  }
}

function replaceAgentKey(
  keys: Array<string>,
  previousKey: string,
  nextKey: string
) {
  if (!previousKey || !nextKey || previousKey === nextKey) return keys

  let changed = false
  const seen = new Set<string>()
  const nextKeys: Array<string> = []
  for (const key of keys) {
    const nextValue = key === previousKey ? nextKey : key
    if (nextValue !== key) changed = true
    if (!nextValue || seen.has(nextValue)) continue
    seen.add(nextValue)
    nextKeys.push(nextValue)
  }

  return changed ? nextKeys : keys
}

type UseAppShellAgentMutationsOptions = {
  viewerContextId: string
  activeAgentId?: string
  agentStateRef: React.RefObject<AgentState>
  setAgentState: React.Dispatch<React.SetStateAction<AgentState>>
  getDirectoryIndexDataByPath: () => DirectoryIndexDataByPath
  setDirectoryIndexDataByPath: React.Dispatch<
    React.SetStateAction<DirectoryIndexDataByPath>
  >
  getAgentsEvent: () => AgentsEvent | null
  setAgentsEvent: React.Dispatch<React.SetStateAction<AgentsEvent | null>>
  getSidebarSelection: () => SidebarSelectionSnapshot
  optimisticallyClearActiveDeletedAgent?: (
    targetPath: string
  ) => (() => void) | undefined
  setSelectedSidebarAgentKeys: React.Dispatch<
    React.SetStateAction<Array<string>>
  >
  setSidebarAgentSelectionAnchor: React.Dispatch<React.SetStateAction<string>>
  setPinnedSidebarAgentKeys: React.Dispatch<React.SetStateAction<Array<string>>>
  setCompactWorkingState: (running: boolean) => void
  isCompactAbortRequested: () => boolean
}

export function useAppShellAgentMutations({
  viewerContextId,
  activeAgentId,
  agentStateRef,
  setAgentState,
  getDirectoryIndexDataByPath,
  setDirectoryIndexDataByPath,
  getAgentsEvent,
  setAgentsEvent,
  getSidebarSelection,
  optimisticallyClearActiveDeletedAgent,
  setSelectedSidebarAgentKeys,
  setSidebarAgentSelectionAnchor,
  setPinnedSidebarAgentKeys,
  setCompactWorkingState,
  isCompactAbortRequested,
}: UseAppShellAgentMutationsOptions) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const modelRequestIdRef = React.useRef(0)
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

  const setModel = React.useCallback(
    async (value: string) => {
      if (!viewerContextId) return
      const [provider, modelId] = value.split("/")
      if (!provider || !modelId) return
      const requestId = ++modelRequestIdRef.current
      const targetAgent = agentStateRef.current
      try {
        const response = await fetchJson<ModelResponseData>(
          buildRequestUrl("/api/model", {
            machineId,
            contextId: viewerContextId,
            agentId: activeAgentId,
            searchParams: { agentKey: targetAgent.agentKey },
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ provider, modelId }),
          }
        )
        if (modelRequestIdRef.current !== requestId) return
        const currentState = agentStateRef.current
        if (!sameAgentMutationTarget(targetAgent, currentState)) return

        // A fresh draft's SSE connection may predate its Pi runtime/agent ID.
        // Publish the acknowledged model even if that scoped event is missed.
        setAgentState({
          ...currentState,
          model: response.model ?? currentState.model,
          thinkingLevel: response.thinkingLevel ?? currentState.thinkingLevel,
          availableThinkingLevels:
            response.availableThinkingLevels ??
            currentState.availableThinkingLevels,
        })
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update model"
        )
      }
    },
    [activeAgentId, viewerContextId, agentStateRef, setAgentState]
  )

  const setThinkingLevel = React.useCallback(
    async (level: string) => {
      if (!viewerContextId) return

      const requestId = thinkingLevelRequestIdRef.current + 1
      thinkingLevelRequestIdRef.current = requestId
      const previousState = agentStateRef.current
      const previousLevel = previousState.thinkingLevel
      const previousAvailableThinkingLevels =
        previousState.availableThinkingLevels
      const targetAgent = {
        cwd: previousState.cwd,
        draft: previousState.draft,
        agentFile: previousState.agentFile,
        agentId: previousState.agentId,
        agentKey: previousState.agentKey,
      } satisfies AgentMutationTarget

      if (previousLevel !== level) {
        setAgentState({ ...previousState, thinkingLevel: level })
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
                machineId,
                contextId: viewerContextId,
                agentId: activeAgentId,
              }),
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ level }),
              }
            )
            if (thinkingLevelRequestIdRef.current !== requestId) return

            const currentState = agentStateRef.current
            if (!sameAgentMutationTarget(targetAgent, currentState)) {
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

            setAgentState({
              ...currentState,
              thinkingLevel: nextLevel,
              availableThinkingLevels: nextAvailableThinkingLevels,
            })
          } catch (error) {
            if (thinkingLevelRequestIdRef.current !== requestId) return

            const currentState = agentStateRef.current
            if (
              sameAgentMutationTarget(targetAgent, currentState) &&
              currentState.thinkingLevel === level
            ) {
              setAgentState({
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
    [agentStateRef, activeAgentId, setAgentState, viewerContextId]
  )

  const cycleThinkingLevel = React.useCallback(
    async (direction: -1 | 1) => {
      const agentState = agentStateRef.current
      const levels = agentState.availableThinkingLevels.length
        ? agentState.availableThinkingLevels
        : ["off"]
      const currentIndex = levels.indexOf(agentState.thinkingLevel || "off")
      const safeIndex = currentIndex >= 0 ? currentIndex : 0
      const nextLevel =
        levels[(safeIndex + direction + levels.length) % levels.length] ||
        levels[0]
      await setThinkingLevel(nextLevel)
    },
    [agentStateRef, setThinkingLevel]
  )

  const setThinkingBlocksHidden = React.useCallback(
    async (hidden: boolean) => {
      if (!viewerContextId) return
      try {
        await fetchJson(
          buildRequestUrl("/api/settings/hide-thinking", {
            machineId,
            contextId: viewerContextId,
            agentId: activeAgentId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ hide: hidden }),
          }
        )
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update thinking visibility"
        )
      }
    },
    [activeAgentId, viewerContextId]
  )

  const toggleHideThinking = React.useCallback(async () => {
    await setThinkingBlocksHidden(!agentStateRef.current.hideThinkingBlock)
  }, [agentStateRef, setThinkingBlocksHidden])

  const runCompact = React.useCallback(async () => {
    if (!viewerContextId) return
    setCompactWorkingState(true)
    try {
      // The request returns when compaction ends, so the working state shows
      // for the whole compaction.
      const response = await fetchJson<{ compacted?: boolean }>(
        buildRequestUrl("/api/slash-command", {
          machineId,
          contextId: viewerContextId,
          agentId: activeAgentId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "compact", args: "" }),
        }
      )
      if (response.compacted === false) {
        toast.info("Nothing to compact yet")
      }
    } catch (error) {
      if (!isCompactAbortRequested()) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to compact the conversation"
        )
      }
    } finally {
      setCompactWorkingState(false)
    }
  }, [
    activeAgentId,
    isCompactAbortRequested,
    setCompactWorkingState,
    viewerContextId,
  ])

  const runClone = React.useCallback(async () => {
    if (!viewerContextId) return
    try {
      const response = await fetchJson<CloneAgentResponseData>(
        buildRequestUrl("/api/agent/clone", {
          machineId,
          contextId: viewerContextId,
          agentId: activeAgentId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
        }
      )
      if (response.cancelled) return
      toast.success("Cloned the conversation")
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to clone the conversation"
      )
    }
  }, [activeAgentId, viewerContextId])

  const renameAgentMutation = useMutation({
    mutationFn: async ({ path, name }: { path: string; name: string }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<RenameAgentResponseData>(
        buildRequestUrl("/api/agent/rename", {
          machineId,
          contextId: viewerContextId,
          agentId: activeAgentId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path, name }),
        }
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["pico", "directory-agents-index", viewerContextId],
        refetchType: "active",
      })
    },
  })

  const renameAgentPath = React.useCallback(
    async (targetPath: string | undefined, nextName: string) => {
      if (!viewerContextId || !targetPath) return false

      const optimisticName = nextName.trim()
      if (!optimisticName) {
        toast.error("Name is required")
        return false
      }

      const previousDirectoryIndexDataByPath = getDirectoryIndexDataByPath()
      const previousAgentsEvent = getAgentsEvent()
      const targetPaths = new Set([targetPath])
      const affectedDirectories = directoriesWithAgentPaths(
        previousDirectoryIndexDataByPath,
        targetPaths
      )
      const affectedEventDirectories = directoriesWithAgentPaths(
        previousAgentsEvent?.directoryIndexes,
        targetPaths
      )
      const previousAgentName = agentStateRef.current.agentName
      const activeAgentMatches = agentStateRef.current.agentFile === targetPath

      setAgentsEvent((current) =>
        updateAgentsEventDirectoryIndexes(current, (indexes) =>
          applyDirectoryIndexRename(indexes, targetPath, optimisticName)
        )
      )
      setDirectoryIndexDataByPath((current) =>
        applyDirectoryIndexRename(current, targetPath, optimisticName)
      )

      if (
        activeAgentMatches &&
        agentStateRef.current.agentName !== optimisticName
      ) {
        setAgentState((current) =>
          current.agentFile === targetPath
            ? { ...current, agentName: optimisticName }
            : current
        )
      }

      void (async () => {
        try {
          const response = await renameAgentMutation.mutateAsync({
            path: targetPath,
            name: optimisticName,
          })
          const confirmedName = response.name || optimisticName

          if (confirmedName !== optimisticName) {
            setAgentsEvent((current) =>
              updateAgentsEventDirectoryIndexes(current, (indexes) =>
                applyDirectoryIndexRename(indexes, targetPath, confirmedName)
              )
            )
            setDirectoryIndexDataByPath((current) =>
              applyDirectoryIndexRename(current, targetPath, confirmedName)
            )
            setAgentState((current) =>
              current.agentFile === targetPath &&
              current.agentName === optimisticName
                ? { ...current, agentName: confirmedName }
                : current
            )
          }

          toast.success("Renamed agent")
        } catch (error) {
          setAgentsEvent((current) =>
            updateAgentsEventDirectoryIndexes(current, (indexes) =>
              restoreDirectoryIndexesForDirectories(
                indexes,
                previousAgentsEvent?.directoryIndexes,
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
          setAgentState((current) =>
            current.agentFile === targetPath &&
            current.agentName === optimisticName
              ? { ...current, agentName: previousAgentName }
              : current
          )
          toast.error(
            error instanceof Error ? error.message : "Failed to rename agent"
          )
        }
      })()

      return true
    },
    [
      getDirectoryIndexDataByPath,
      getAgentsEvent,
      renameAgentMutation,
      agentStateRef,
      setDirectoryIndexDataByPath,
      setAgentState,
      setAgentsEvent,
      viewerContextId,
    ]
  )

  const moveAgentMutation = useMutation({
    mutationFn: async ({ path, cwd }: { path: string; cwd: string }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<MoveAgentResponseData>(
        buildRequestUrl("/api/agent/move", {
          machineId,
          contextId: viewerContextId,
          agentId: activeAgentId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path, cwd }),
        }
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["pico", "directory-agents-index", viewerContextId],
        refetchType: "active",
      })
    },
  })

  const moveAgentPath = React.useCallback(
    async (entry: AgentListEntry, directory: string) => {
      if (!viewerContextId || !entry.path) return false

      const nextDirectory = directory.trim()
      if (!nextDirectory) {
        toast.error("Directory is required")
        return false
      }
      if (entry.cwd === nextDirectory) return false

      const targetPath = entry.path
      const previousDirectoryIndexDataByPath = getDirectoryIndexDataByPath()
      const previousAgentsEvent = getAgentsEvent()
      const targetPaths = new Set([targetPath])
      const affectedDirectories = uniqueDirectories([
        ...directoriesWithAgentPaths(
          previousDirectoryIndexDataByPath,
          targetPaths
        ),
        ...(previousDirectoryIndexDataByPath[nextDirectory]
          ? [nextDirectory]
          : []),
      ])
      const affectedEventDirectories = uniqueDirectories([
        ...directoriesWithAgentPaths(
          previousAgentsEvent?.directoryIndexes,
          targetPaths
        ),
        ...(previousAgentsEvent?.directoryIndexes?.[nextDirectory]
          ? [nextDirectory]
          : []),
      ])
      const previousAgentCwd = agentStateRef.current.cwd
      const activeAgentMatches = agentStateRef.current.agentFile === targetPath

      setAgentsEvent((current) =>
        updateAgentsEventDirectoryIndexes(current, (indexes) =>
          applyDirectoryIndexMove(indexes, {
            previousPath: targetPath,
            nextCwd: nextDirectory,
            fallbackEntry: entry,
          })
        )
      )
      setDirectoryIndexDataByPath((current) =>
        applyDirectoryIndexMove(current, {
          previousPath: targetPath,
          nextCwd: nextDirectory,
          fallbackEntry: entry,
        })
      )
      if (activeAgentMatches) {
        setAgentState((current) =>
          current.agentFile === targetPath
            ? { ...current, cwd: nextDirectory }
            : current
        )
      }

      void (async () => {
        try {
          const response = await moveAgentMutation.mutateAsync({
            path: targetPath,
            cwd: nextDirectory,
          })
          const previousKey = agentListEntryKey({
            path: response.previousPath || targetPath,
          })
          const nextKey = agentListEntryKey({
            path: response.path,
            id: response.agentId || entry.id,
          })

          setAgentsEvent((current) =>
            updateAgentsEventDirectoryIndexes(current, (indexes) =>
              applyDirectoryIndexMove(indexes, {
                previousPath: response.previousPath || targetPath,
                nextPath: response.path,
                nextCwd: response.cwd,
                fallbackEntry: {
                  ...entry,
                  id: response.agentId || entry.id,
                },
              })
            )
          )
          setDirectoryIndexDataByPath((current) =>
            applyDirectoryIndexMove(current, {
              previousPath: response.previousPath || targetPath,
              nextPath: response.path,
              nextCwd: response.cwd,
              fallbackEntry: {
                ...entry,
                id: response.agentId || entry.id,
              },
            })
          )
          setSelectedSidebarAgentKeys((current) =>
            replaceAgentKey(current, previousKey, nextKey)
          )
          setSidebarAgentSelectionAnchor((current) =>
            current === previousKey ? nextKey : current
          )
          setPinnedSidebarAgentKeys((current) => {
            const next = replaceAgentKey(current, previousKey, nextKey)
            if (next !== current) {
              machineLocalStorageSetItem(
                machineId,
                PINNED_AGENTS_STORAGE_KEY,
                JSON.stringify(next)
              )
            }
            return next
          })
          setAgentState((current) =>
            current.agentFile === response.previousPath ||
            current.agentFile === targetPath
              ? { ...current, cwd: response.cwd, agentFile: response.path }
              : current
          )

          toast.success("Moved agent")
        } catch (error) {
          setAgentsEvent((current) =>
            updateAgentsEventDirectoryIndexes(current, (indexes) =>
              restoreDirectoryIndexesForDirectories(
                indexes,
                previousAgentsEvent?.directoryIndexes,
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
          setAgentState((current) =>
            current.agentFile === targetPath && current.cwd === nextDirectory
              ? { ...current, cwd: previousAgentCwd }
              : current
          )
          toast.error(
            error instanceof Error ? error.message : "Failed to move agent"
          )
        }
      })()

      return true
    },
    [
      getDirectoryIndexDataByPath,
      getAgentsEvent,
      moveAgentMutation,
      agentStateRef,
      setDirectoryIndexDataByPath,
      setPinnedSidebarAgentKeys,
      setSelectedSidebarAgentKeys,
      setAgentState,
      setAgentsEvent,
      setSidebarAgentSelectionAnchor,
      viewerContextId,
    ]
  )

  const deleteAgentMutation = useMutation({
    mutationFn: async ({
      paths,
      removeWorktree,
    }: {
      paths: Array<string>
      removeWorktree?: boolean
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      await fetchJson<DeleteAgentsResponse>(
        buildRequestUrl("/api/agents/delete", {
          machineId,
          contextId: viewerContextId,
          agentId: activeAgentId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paths, removeWorktree }),
        }
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["pico", "directory-agents-index", viewerContextId],
        refetchType: "active",
      })
    },
  })

  const deleteAgents = React.useCallback(
    (
      targets: Array<AgentListEntry>,
      options: { removeWorktree?: boolean } = {}
    ) => {
      if (!viewerContextId || targets.length === 0) return false

      const orderedTargets = [
        ...targets.filter(
          (target) =>
            target.path && target.path !== agentStateRef.current.agentFile
        ),
        ...targets.filter(
          (target) =>
            target.path && target.path === agentStateRef.current.agentFile
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
        orderedTargets.flatMap((target) => {
          const key = agentListEntryKey(target)
          return key ? [key] : []
        })
      )
      const previousDirectoryIndexDataByPath = getDirectoryIndexDataByPath()
      const previousAgentsEvent = getAgentsEvent()
      const affectedDirectories = directoriesWithAgentPaths(
        previousDirectoryIndexDataByPath,
        deletedPathSet
      )
      const affectedEventDirectories = directoriesWithAgentPaths(
        previousAgentsEvent?.directoryIndexes,
        deletedPathSet
      )
      const previousSelection = getSidebarSelection()
      const optimisticSelection = optimisticSelectionAfterDelete(
        previousSelection,
        deletedKeys
      )

      setAgentsEvent((current) =>
        updateAgentsEventDirectoryIndexes(current, (indexes) =>
          applyDirectoryIndexDelete(indexes, deletedPathSet)
        )
      )
      setDirectoryIndexDataByPath((current) =>
        applyDirectoryIndexDelete(current, deletedPathSet)
      )
      setSelectedSidebarAgentKeys((current) =>
        current.filter((key) => !deletedKeys.has(key))
      )
      setSidebarAgentSelectionAnchor((current) =>
        current && deletedKeys.has(current) ? "" : current
      )
      const activeDeletedPath = agentStateRef.current.agentFile
      const rollbackActiveDeletedAgent =
        activeDeletedPath && deletedPathSet.has(activeDeletedPath)
          ? optimisticallyClearActiveDeletedAgent?.(activeDeletedPath)
          : undefined

      void (async () => {
        try {
          await deleteAgentMutation.mutateAsync({
            paths: orderedPaths,
            removeWorktree: Boolean(options.removeWorktree),
          })
          toast.success(
            orderedPaths.length === 1
              ? "Archived agent"
              : `Archived ${orderedPaths.length} agents`
          )
        } catch (error) {
          setAgentsEvent((current) =>
            updateAgentsEventDirectoryIndexes(current, (indexes) =>
              restoreDirectoryIndexesForDirectories(
                indexes,
                previousAgentsEvent?.directoryIndexes,
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

          rollbackActiveDeletedAgent?.()

          const currentSelection = getSidebarSelection()
          if (
            sameStringArray(
              currentSelection.selectedSidebarAgentKeys,
              optimisticSelection.selectedSidebarAgentKeys
            ) &&
            currentSelection.sidebarAgentSelectionAnchor ===
              optimisticSelection.sidebarAgentSelectionAnchor
          ) {
            setSelectedSidebarAgentKeys(
              previousSelection.selectedSidebarAgentKeys
            )
            setSidebarAgentSelectionAnchor(
              previousSelection.sidebarAgentSelectionAnchor
            )
          }

          toast.error(
            error instanceof Error ? error.message : "Failed to archive agent"
          )
        }
      })()

      return true
    },
    [
      deleteAgentMutation,
      getDirectoryIndexDataByPath,
      getAgentsEvent,
      getSidebarSelection,
      optimisticallyClearActiveDeletedAgent,
      agentStateRef,
      setDirectoryIndexDataByPath,
      setSelectedSidebarAgentKeys,
      setAgentsEvent,
      setSidebarAgentSelectionAnchor,
      viewerContextId,
    ]
  )

  return {
    cycleThinkingLevel,
    deleteAgents,
    moveAgentPath,
    renameAgentPath,
    runClone,
    runCompact,
    setModel,
    setThinkingBlocksHidden,
    setThinkingLevel,
    toggleHideThinking,
  }
}
