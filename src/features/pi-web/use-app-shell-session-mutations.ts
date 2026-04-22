import * as React from "react"
import { useMutation, type QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { SessionState } from "@/lib/pi-web"
import type {
  DeleteSessionResponse,
  ExtensionUiEvent,
  ForkSessionResponse,
  NavigateSessionTreeResponse,
  RenameSessionResponse,
  SessionListEntry,
  SessionTreeResponse,
  UiRequestResponse,
} from "@/lib/pi-web-api"

import { buildRequestUrl, fetchJson } from "@/features/pi-web/app-shell-utils"
import { piWebQueryKeys } from "@/features/pi-web/query-keys"
import { sessionListEntryKey } from "@/lib/pi-web"

type SessionTreeData = Extract<SessionTreeResponse, { ok: true }>
type NavigateSessionTreeData = Extract<
  NavigateSessionTreeResponse,
  { ok: true }
>

type UseAppShellSessionMutationsOptions = {
  viewerContextId: string
  activeSessionId?: string
  currentSessionQueryScope: string
  sessionState: SessionState
  selectedTreeNodeId: string | null
  selectedTreeNodeLabel: string
  renameTarget: SessionListEntry | null
  renameValue: string
  deleteTargets: Array<SessionListEntry>
  pendingUiRequest: ExtensionUiEvent | null
  queryClient: QueryClient
  setTreeOpen: React.Dispatch<React.SetStateAction<boolean>>
  setTreeQuery: React.Dispatch<React.SetStateAction<string>>
  setForkOpen: React.Dispatch<React.SetStateAction<boolean>>
  setRenameOpen: React.Dispatch<React.SetStateAction<boolean>>
  setRenameTarget: React.Dispatch<React.SetStateAction<SessionListEntry | null>>
  setDeleteTargets: React.Dispatch<
    React.SetStateAction<Array<SessionListEntry>>
  >
  setSelectedSidebarSessionKeys: React.Dispatch<
    React.SetStateAction<Array<string>>
  >
  setSidebarSessionSelectionAnchor: React.Dispatch<React.SetStateAction<string>>
  setRunningSlashCommand: React.Dispatch<React.SetStateAction<string | null>>
  setPendingUiRequest: React.Dispatch<
    React.SetStateAction<ExtensionUiEvent | null>
  >
  setPendingUiValue: React.Dispatch<React.SetStateAction<string>>
}

export function useAppShellSessionMutations({
  viewerContextId,
  activeSessionId,
  currentSessionQueryScope,
  sessionState,
  selectedTreeNodeId,
  selectedTreeNodeLabel,
  renameTarget,
  renameValue,
  deleteTargets,
  pendingUiRequest,
  queryClient,
  setTreeOpen,
  setTreeQuery,
  setForkOpen,
  setRenameOpen,
  setRenameTarget,
  setDeleteTargets,
  setSelectedSidebarSessionKeys,
  setSidebarSessionSelectionAnchor,
  setRunningSlashCommand,
  setPendingUiRequest,
  setPendingUiValue,
}: UseAppShellSessionMutationsOptions) {
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

      return await fetchJson(
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
      try {
        await setThinkingLevelMutation.mutateAsync(level)
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update thinking level"
        )
      }
    },
    [setThinkingLevelMutation, viewerContextId]
  )

  const cycleThinkingLevel = React.useCallback(
    async (direction: -1 | 1) => {
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
    [
      sessionState.availableThinkingLevels,
      sessionState.thinkingLevel,
      setThinkingLevel,
    ]
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
    await setThinkingBlocksHidden(!sessionState.hideThinkingBlock)
  }, [sessionState.hideThinkingBlock, setThinkingBlocksHidden])

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
      toast.success("Started compaction")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to compact session"
      )
    } finally {
      setRunningSlashCommand(null)
    }
  }, [compactMutation, setRunningSlashCommand, viewerContextId])

  const openTreeDialog = React.useCallback(async () => {
    if (!viewerContextId) return
    setTreeOpen(true)
    setTreeQuery("")
    await queryClient.invalidateQueries({
      queryKey: piWebQueryKeys.sessionTree(
        viewerContextId,
        currentSessionQueryScope
      ),
      exact: true,
      refetchType: "active",
    })
  }, [
    currentSessionQueryScope,
    queryClient,
    setTreeOpen,
    setTreeQuery,
    viewerContextId,
  ])

  const saveTreeLabelMutation = useMutation({
    mutationFn: async ({
      entryId,
      label,
    }: {
      entryId: string
      label: string
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<SessionTreeData>(
        buildRequestUrl("/api/session/tree/label", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entryId, label }),
        }
      )
    },
    onSuccess: (response) => {
      queryClient.setQueryData(
        piWebQueryKeys.sessionTree(viewerContextId, currentSessionQueryScope),
        response
      )
    },
  })

  const saveTreeLabel = React.useCallback(async () => {
    if (!viewerContextId || !selectedTreeNodeId) return
    try {
      await saveTreeLabelMutation.mutateAsync({
        entryId: selectedTreeNodeId,
        label: selectedTreeNodeLabel,
      })
      toast.success("Saved tree label")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save label"
      )
    }
  }, [
    saveTreeLabelMutation,
    selectedTreeNodeId,
    selectedTreeNodeLabel,
    viewerContextId,
  ])

  const navigateTreeNodeMutation = useMutation({
    mutationFn: async ({
      targetId,
      summarize,
      customInstructions,
    }: {
      targetId: string
      summarize?: boolean
      customInstructions?: string
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<NavigateSessionTreeData>(
        buildRequestUrl("/api/session/tree", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            targetId,
            summarize: Boolean(summarize),
            customInstructions,
          }),
        }
      )
    },
  })

  const navigateTreeNode = React.useCallback(
    async (
      targetId: string,
      options?: { summarize?: boolean; customInstructions?: string }
    ) => {
      if (!viewerContextId) return
      try {
        const response = await navigateTreeNodeMutation.mutateAsync({
          targetId,
          summarize: options?.summarize,
          customInstructions: options?.customInstructions,
        })
        if (response.aborted) {
          toast.info("Branch summarization cancelled")
          return
        }
        if (response.cancelled) {
          toast.info("Tree navigation cancelled")
          return
        }
        setTreeOpen(false)
        toast.success(
          options?.summarize
            ? "Continued from summarized branch"
            : "Moved session tree cursor"
        )
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to navigate tree"
        )
      }
    },
    [navigateTreeNodeMutation, setTreeOpen, viewerContextId]
  )

  const openForkDialog = React.useCallback(async () => {
    if (!viewerContextId) return
    setForkOpen(true)
    await queryClient.invalidateQueries({
      queryKey: piWebQueryKeys.forkableMessages(
        viewerContextId,
        currentSessionQueryScope
      ),
      exact: true,
      refetchType: "active",
    })
  }, [currentSessionQueryScope, queryClient, setForkOpen, viewerContextId])

  const forkFromMessageMutation = useMutation({
    mutationFn: async (entryId: string) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<ForkSessionResponse>(
        buildRequestUrl("/api/session/fork", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entryId }),
        }
      )
    },
  })

  const forkFromMessage = React.useCallback(
    async (entryId: string) => {
      if (!viewerContextId) return
      try {
        await forkFromMessageMutation.mutateAsync(entryId)
        setForkOpen(false)
        toast.success("Forked session")
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to fork session"
        )
      }
    },
    [forkFromMessageMutation, setForkOpen, viewerContextId]
  )

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

  const renameSessionToValue = React.useCallback(
    async (nextName: string, closeDialog = true) => {
      const targetPath = renameTarget?.path || sessionState.sessionFile
      if (!viewerContextId || !targetPath) return false
      try {
        await renameSessionMutation.mutateAsync({
          path: targetPath,
          name: nextName,
        })
        if (closeDialog) {
          setRenameOpen(false)
          setRenameTarget(null)
        }
        toast.success("Renamed session")
        return true
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to rename session"
        )
        return false
      }
    },
    [
      renameSessionMutation,
      renameTarget?.path,
      sessionState.sessionFile,
      setRenameOpen,
      setRenameTarget,
      viewerContextId,
    ]
  )

  const renameSession = React.useCallback(async () => {
    return await renameSessionToValue(renameValue)
  }, [renameSessionToValue, renameValue])

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

  const deleteSession = React.useCallback(async () => {
    if (!viewerContextId || deleteTargets.length === 0) return

    const orderedTargets = [
      ...deleteTargets.filter(
        (target) => target.path && target.path !== sessionState.sessionFile
      ),
      ...deleteTargets.filter(
        (target) => target.path && target.path === sessionState.sessionFile
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
      setDeleteTargets([])
      toast.success(
        orderedTargets.length === 1
          ? "Deleted session"
          : `Deleted ${orderedTargets.length} sessions`
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete session"
      )
    }
  }, [
    deleteSessionMutation,
    deleteTargets,
    sessionState.sessionFile,
    setDeleteTargets,
    setSelectedSidebarSessionKeys,
    setSidebarSessionSelectionAnchor,
    viewerContextId,
  ])

  const resolveUiRequestMutation = useMutation({
    mutationFn: async ({
      requestId,
      body,
    }: {
      requestId: string
      body: Record<string, unknown>
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<UiRequestResponse>(
        buildRequestUrl(`/api/ui/${encodeURIComponent(requestId)}`, {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      )
    },
  })

  const resolveUiRequest = React.useCallback(
    async (body: Record<string, unknown>) => {
      if (!viewerContextId || !pendingUiRequest) return
      try {
        await resolveUiRequestMutation.mutateAsync({
          requestId: pendingUiRequest.id,
          body,
        })
        setPendingUiRequest(null)
        setPendingUiValue("")
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to resolve UI request"
        )
      }
    },
    [
      pendingUiRequest,
      resolveUiRequestMutation,
      setPendingUiRequest,
      setPendingUiValue,
      viewerContextId,
    ]
  )

  return {
    cycleThinkingLevel,
    deleteSession,
    forkFromMessage,
    isForkingFromMessage: forkFromMessageMutation.isPending,
    navigateTreeNode,
    openForkDialog,
    openTreeDialog,
    renameSession,
    renameSessionToValue,
    resolveUiRequest,
    runCompact,
    saveTreeLabel,
    setModel,
    setThinkingBlocksHidden,
    setThinkingLevel,
    toggleHideThinking,
    treeSubmitting:
      saveTreeLabelMutation.isPending || navigateTreeNodeMutation.isPending,
  }
}
