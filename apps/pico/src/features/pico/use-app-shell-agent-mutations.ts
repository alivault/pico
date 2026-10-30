import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/pico/toast"

import type { AgentState } from "@/lib/pico"
import type {
  CloneAgentResponse,
  DeleteAgentsResponse,
  ProjectAgentsIndexSnapshot,
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
type ProjectIndexDataByPath = Record<string, ProjectAgentsIndexSnapshot>

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

export function applyProjectIndexRename(
  current: ProjectIndexDataByPath,
  targetPath: string,
  nextName: string
) {
  let changed = false
  const next: ProjectIndexDataByPath = { ...current }

  for (const [project, snapshot] of Object.entries(current)) {
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
      next[project] = {
        ...snapshot,
        agents,
      }
    }
  }

  return changed ? next : current
}

function applyProjectIndexDelete(
  current: ProjectIndexDataByPath,
  targetPaths: Set<string>
) {
  if (targetPaths.size === 0) return current

  let changed = false
  const next: ProjectIndexDataByPath = { ...current }

  for (const [project, snapshot] of Object.entries(current)) {
    const agents = snapshot.agents.filter(
      (entry) => !entry.path || !targetPaths.has(entry.path)
    )
    const removedCount = snapshot.agents.length - agents.length
    if (removedCount === 0) continue

    changed = true
    next[project] = {
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

function applyProjectIndexMove(
  current: ProjectIndexDataByPath,
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
  const next: ProjectIndexDataByPath = { ...current }

  for (const [project, snapshot] of Object.entries(current)) {
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
    next[project] = {
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

function projectsWithAgentPaths(
  indexes: ProjectIndexDataByPath | undefined,
  targetPaths: Set<string>
) {
  if (!indexes || targetPaths.size === 0) return []

  const projects: Array<string> = []
  for (const [project, snapshot] of Object.entries(indexes)) {
    if (
      snapshot.agents.some((entry) => entry.path && targetPaths.has(entry.path))
    ) {
      projects.push(project)
    }
  }

  return projects
}

function uniqueProjects(projects: Array<string>) {
  return Array.from(new Set(projects.filter(Boolean)))
}

function restoreProjectIndexesForProjects(
  current: ProjectIndexDataByPath,
  previous: ProjectIndexDataByPath | undefined,
  projects: Array<string>
) {
  if (projects.length === 0) return current

  let changed = false
  const next: ProjectIndexDataByPath = { ...current }

  for (const project of projects) {
    const previousSnapshot = previous?.[project]
    if (previousSnapshot) {
      if (current[project] !== previousSnapshot) {
        next[project] = previousSnapshot
        changed = true
      }
      continue
    }

    if (Object.prototype.hasOwnProperty.call(current, project)) {
      delete next[project]
      changed = true
    }
  }

  return changed ? next : current
}

export function updateAgentsEventProjectIndexes(
  current: AgentsEvent | null,
  updater: (indexes: ProjectIndexDataByPath) => ProjectIndexDataByPath
) {
  if (!current?.projectIndexes) return current

  const nextProjectIndexes = updater(current.projectIndexes)
  if (nextProjectIndexes === current.projectIndexes) return current

  return {
    ...current,
    projectIndexes: nextProjectIndexes,
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
  getProjectIndexDataByPath: () => ProjectIndexDataByPath
  setProjectIndexDataByPath: React.Dispatch<
    React.SetStateAction<ProjectIndexDataByPath>
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
  getProjectIndexDataByPath,
  setProjectIndexDataByPath,
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
        queryKey: ["pico", "project-agents-index", viewerContextId],
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

      const previousProjectIndexDataByPath = getProjectIndexDataByPath()
      const previousAgentsEvent = getAgentsEvent()
      const targetPaths = new Set([targetPath])
      const affectedProjects = projectsWithAgentPaths(
        previousProjectIndexDataByPath,
        targetPaths
      )
      const affectedEventProjects = projectsWithAgentPaths(
        previousAgentsEvent?.projectIndexes,
        targetPaths
      )
      const previousAgentName = agentStateRef.current.agentName
      const activeAgentMatches = agentStateRef.current.agentFile === targetPath

      setAgentsEvent((current) =>
        updateAgentsEventProjectIndexes(current, (indexes) =>
          applyProjectIndexRename(indexes, targetPath, optimisticName)
        )
      )
      setProjectIndexDataByPath((current) =>
        applyProjectIndexRename(current, targetPath, optimisticName)
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
              updateAgentsEventProjectIndexes(current, (indexes) =>
                applyProjectIndexRename(indexes, targetPath, confirmedName)
              )
            )
            setProjectIndexDataByPath((current) =>
              applyProjectIndexRename(current, targetPath, confirmedName)
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
            updateAgentsEventProjectIndexes(current, (indexes) =>
              restoreProjectIndexesForProjects(
                indexes,
                previousAgentsEvent?.projectIndexes,
                affectedEventProjects
              )
            )
          )
          setProjectIndexDataByPath((current) =>
            restoreProjectIndexesForProjects(
              current,
              previousProjectIndexDataByPath,
              affectedProjects
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
      getProjectIndexDataByPath,
      getAgentsEvent,
      renameAgentMutation,
      agentStateRef,
      setProjectIndexDataByPath,
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
        queryKey: ["pico", "project-agents-index", viewerContextId],
        refetchType: "active",
      })
    },
  })

  const moveAgentPath = React.useCallback(
    async (entry: AgentListEntry, project: string) => {
      if (!viewerContextId || !entry.path) return false

      const nextProject = project.trim()
      if (!nextProject) {
        toast.error("Project is required")
        return false
      }
      if (entry.cwd === nextProject) return false

      const targetPath = entry.path
      const previousProjectIndexDataByPath = getProjectIndexDataByPath()
      const previousAgentsEvent = getAgentsEvent()
      const targetPaths = new Set([targetPath])
      const affectedProjects = uniqueProjects([
        ...projectsWithAgentPaths(previousProjectIndexDataByPath, targetPaths),
        ...(previousProjectIndexDataByPath[nextProject] ? [nextProject] : []),
      ])
      const affectedEventProjects = uniqueProjects([
        ...projectsWithAgentPaths(
          previousAgentsEvent?.projectIndexes,
          targetPaths
        ),
        ...(previousAgentsEvent?.projectIndexes?.[nextProject]
          ? [nextProject]
          : []),
      ])
      const previousAgentCwd = agentStateRef.current.cwd
      const activeAgentMatches = agentStateRef.current.agentFile === targetPath

      setAgentsEvent((current) =>
        updateAgentsEventProjectIndexes(current, (indexes) =>
          applyProjectIndexMove(indexes, {
            previousPath: targetPath,
            nextCwd: nextProject,
            fallbackEntry: entry,
          })
        )
      )
      setProjectIndexDataByPath((current) =>
        applyProjectIndexMove(current, {
          previousPath: targetPath,
          nextCwd: nextProject,
          fallbackEntry: entry,
        })
      )
      if (activeAgentMatches) {
        setAgentState((current) =>
          current.agentFile === targetPath
            ? { ...current, cwd: nextProject }
            : current
        )
      }

      void (async () => {
        try {
          const response = await moveAgentMutation.mutateAsync({
            path: targetPath,
            cwd: nextProject,
          })
          const previousKey = agentListEntryKey({
            path: response.previousPath || targetPath,
          })
          const nextKey = agentListEntryKey({
            path: response.path,
            id: response.agentId || entry.id,
          })

          setAgentsEvent((current) =>
            updateAgentsEventProjectIndexes(current, (indexes) =>
              applyProjectIndexMove(indexes, {
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
          setProjectIndexDataByPath((current) =>
            applyProjectIndexMove(current, {
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
            updateAgentsEventProjectIndexes(current, (indexes) =>
              restoreProjectIndexesForProjects(
                indexes,
                previousAgentsEvent?.projectIndexes,
                affectedEventProjects
              )
            )
          )
          setProjectIndexDataByPath((current) =>
            restoreProjectIndexesForProjects(
              current,
              previousProjectIndexDataByPath,
              affectedProjects
            )
          )
          setAgentState((current) =>
            current.agentFile === targetPath && current.cwd === nextProject
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
      getProjectIndexDataByPath,
      getAgentsEvent,
      moveAgentMutation,
      agentStateRef,
      setProjectIndexDataByPath,
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
        queryKey: ["pico", "project-agents-index", viewerContextId],
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
      const previousProjectIndexDataByPath = getProjectIndexDataByPath()
      const previousAgentsEvent = getAgentsEvent()
      const affectedProjects = projectsWithAgentPaths(
        previousProjectIndexDataByPath,
        deletedPathSet
      )
      const affectedEventProjects = projectsWithAgentPaths(
        previousAgentsEvent?.projectIndexes,
        deletedPathSet
      )
      const previousSelection = getSidebarSelection()
      const optimisticSelection = optimisticSelectionAfterDelete(
        previousSelection,
        deletedKeys
      )

      setAgentsEvent((current) =>
        updateAgentsEventProjectIndexes(current, (indexes) =>
          applyProjectIndexDelete(indexes, deletedPathSet)
        )
      )
      setProjectIndexDataByPath((current) =>
        applyProjectIndexDelete(current, deletedPathSet)
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
            updateAgentsEventProjectIndexes(current, (indexes) =>
              restoreProjectIndexesForProjects(
                indexes,
                previousAgentsEvent?.projectIndexes,
                affectedEventProjects
              )
            )
          )
          setProjectIndexDataByPath((current) =>
            restoreProjectIndexesForProjects(
              current,
              previousProjectIndexDataByPath,
              affectedProjects
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
      getProjectIndexDataByPath,
      getAgentsEvent,
      getSidebarSelection,
      optimisticallyClearActiveDeletedAgent,
      agentStateRef,
      setProjectIndexDataByPath,
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
