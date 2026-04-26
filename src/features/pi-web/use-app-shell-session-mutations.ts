import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

import type { SessionState } from "@/lib/pi-web"
import type {
  DeleteSessionResponse,
  RenameSessionResponse,
  SessionListEntry,
  ThinkingResponse,
} from "@/lib/pi-web-api"

import { buildRequestUrl, fetchJson } from "@/features/pi-web/app-shell-utils"
import { sessionListEntryKey } from "@/lib/pi-web"

type ThinkingResponseData = Extract<ThinkingResponse, { ok: true }>

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

type UseAppShellSessionMutationsOptions = {
  viewerContextId: string
  activeSessionId?: string
  sessionStateRef: React.MutableRefObject<SessionState>
  setSessionState: React.Dispatch<React.SetStateAction<SessionState>>
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

  const setThinkingLevelMutation = useMutation({
    mutationFn: async (level: string) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<ThinkingResponseData>(
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
    },
  })

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
            const response = await setThinkingLevelMutation.mutateAsync(level)
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
    [
      sessionStateRef,
      setSessionState,
      setThinkingLevelMutation,
      viewerContextId,
    ]
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

      return await fetchJson<RenameSessionResponse>(
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
      try {
        await renameSessionMutation.mutateAsync({
          path: targetPath,
          name: nextName,
        })
        toast.success("Renamed session")
        return true
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to rename session"
        )
        return false
      }
    },
    [renameSessionMutation, viewerContextId]
  )

  const deleteSessionMutation = useMutation({
    mutationFn: async (paths: Array<string>) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      for (const path of paths) {
        await fetchJson<DeleteSessionResponse>(
          buildRequestUrl("/api/session/delete", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path }),
          }
        )
      }
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

      try {
        await deleteSessionMutation.mutateAsync(
          orderedTargets.flatMap((target) => (target.path ? [target.path] : []))
        )

        const deletedKeys = new Set(
          orderedTargets
            .map((target) => sessionListEntryKey(target))
            .filter(Boolean)
        )
        setSelectedSidebarSessionKeys((current) =>
          current.filter((key) => !deletedKeys.has(key))
        )
        setSidebarSessionSelectionAnchor((current) =>
          current && deletedKeys.has(current) ? "" : current
        )
        toast.success(
          orderedTargets.length === 1
            ? "Deleted session"
            : `Deleted ${orderedTargets.length} sessions`
        )
        return true
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to delete session"
        )
        return false
      }
    },
    [
      deleteSessionMutation,
      sessionStateRef,
      setSelectedSidebarSessionKeys,
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
