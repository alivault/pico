import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

import type { PromptImage, SessionState, StreamingBehavior } from "@/lib/pi-web"
import type {
  DirectoryResolveResponse,
  PendingMessageRemoveResponse,
  PendingMessagesResponse,
  PromptResponse,
  SimpleOkResponse,
} from "@/lib/pi-web-api"

import { buildRequestUrl, fetchJson } from "@/features/pi-web/app-shell-utils"
import { serializeComposerDraft } from "@/features/pi-web/composer-utils"
import {
  DRAFT_DIRECTORY_STORAGE_KEY,
  SIDEBAR_DIRECTORIES_STORAGE_KEY,
  normalizeStoredDirectoryList,
  promptDraftKey,
  safeLocalStorageSetItem,
} from "@/lib/pi-web"

type DirectoryResolveData = Extract<DirectoryResolveResponse, { ok: true }>

type PendingDraftPrompt = {
  ownerKey: string
  message: string
  images: Array<PromptImage>
  streamingBehavior?: StreamingBehavior
}

type PendingDraftFollowUp = {
  message: string
  images: Array<PromptImage>
  streamingBehavior: "steer" | "followUp"
}

type PendingComposerMessage = {
  pendingId: string
  text: string
  images: Array<PromptImage>
  streamingBehavior: "steer" | "followUp"
}

type UseAppShellPromptMutationsOptions = {
  viewerContextId: string
  activeSessionId?: string
  directoryInput: string
  defaultNewSessionDirectory?: string
  sessionState: SessionState
  draftSessionLoadingOwnerKey: string | null
  pendingDraftPrompt: PendingDraftPrompt | null
  pendingDraftFollowUps: Array<PendingDraftFollowUp>
  awaitingFirstTurn: boolean
  pendingMessages: Array<PendingComposerMessage>
  composerImages: Array<PromptImage>
  composerTextRef: React.MutableRefObject<string>
  composerSkillRef: React.MutableRefObject<string | undefined>
  replaceComposerDraft: (value: string, target?: SessionState) => void
  lastSyncedEditorTextRef: React.MutableRefObject<string>
  rememberRecentDirectory: (directory: string) => void
  prefetchDirectorySessionsIndex: (directory: string) => void
  setSidebarDirectories: React.Dispatch<React.SetStateAction<Array<string>>>
  setDirectoryInput: React.Dispatch<React.SetStateAction<string>>
  setAddDirectoryOpen: React.Dispatch<React.SetStateAction<boolean>>
  setStoredDraftDirectory: React.Dispatch<React.SetStateAction<string>>
  setDraftSessionLoadingOwnerKey: React.Dispatch<
    React.SetStateAction<string | null>
  >
  setPendingDraftPrompt: React.Dispatch<
    React.SetStateAction<PendingDraftPrompt | null>
  >
  setPendingDraftFollowUps: React.Dispatch<
    React.SetStateAction<Array<PendingDraftFollowUp>>
  >
  setAwaitingFirstTurn: React.Dispatch<React.SetStateAction<boolean>>
  setIsSubmitting: React.Dispatch<React.SetStateAction<boolean>>
  setComposerImages: React.Dispatch<React.SetStateAction<Array<PromptImage>>>
}

function normalizeQueuedStreamingBehavior(
  streamingBehavior?: StreamingBehavior
) {
  return streamingBehavior === "followUp" ? "followUp" : "steer"
}

export function useAppShellPromptMutations({
  viewerContextId,
  activeSessionId,
  directoryInput,
  defaultNewSessionDirectory,
  sessionState,
  draftSessionLoadingOwnerKey,
  pendingDraftPrompt,
  pendingDraftFollowUps,
  awaitingFirstTurn,
  pendingMessages,
  composerImages,
  composerTextRef,
  composerSkillRef,
  replaceComposerDraft,
  lastSyncedEditorTextRef,
  rememberRecentDirectory,
  prefetchDirectorySessionsIndex,
  setSidebarDirectories,
  setDirectoryInput,
  setAddDirectoryOpen,
  setStoredDraftDirectory,
  setDraftSessionLoadingOwnerKey,
  setPendingDraftPrompt,
  setPendingDraftFollowUps,
  setAwaitingFirstTurn,
  setIsSubmitting,
  setComposerImages,
}: UseAppShellPromptMutationsOptions) {
  const addDirectoryMutation = useMutation({
    mutationFn: async (requestedPath: string) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<DirectoryResolveData>(
        buildRequestUrl("/api/directory/resolve", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: requestedPath }),
        }
      )
    },
  })

  const applyPendingDraftPromptToComposer = React.useCallback(
    (pendingPrompt: { message: string; images: Array<PromptImage> }) => {
      replaceComposerDraft(pendingPrompt.message)
      setComposerImages(pendingPrompt.images.map((image) => ({ ...image })))
      return true
    },
    [replaceComposerDraft, setComposerImages]
  )

  const restorePendingDraftPrompt = React.useCallback(
    (ownerKey: string) => {
      if (!pendingDraftPrompt || pendingDraftPrompt.ownerKey !== ownerKey) {
        return false
      }
      const nextPrompt = pendingDraftPrompt
      setPendingDraftPrompt(null)
      setPendingDraftFollowUps([])
      setAwaitingFirstTurn(false)
      return applyPendingDraftPromptToComposer(nextPrompt)
    },
    [
      applyPendingDraftPromptToComposer,
      pendingDraftPrompt,
      setAwaitingFirstTurn,
      setPendingDraftFollowUps,
      setPendingDraftPrompt,
    ]
  )

  const addDirectoryPath = React.useCallback(
    async (path: string) => {
      if (!viewerContextId) return
      const requestedPath = path.trim()
      if (!requestedPath) return

      try {
        const response = await addDirectoryMutation.mutateAsync(requestedPath)
        setSidebarDirectories((current) => {
          const next = normalizeStoredDirectoryList([...current, response.path])
          safeLocalStorageSetItem(
            SIDEBAR_DIRECTORIES_STORAGE_KEY,
            JSON.stringify(next)
          )
          return next
        })
        rememberRecentDirectory(response.path)
        setDirectoryInput("")
        setAddDirectoryOpen(false)
        prefetchDirectorySessionsIndex(response.path)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to add directory"
        )
      }
    },
    [
      addDirectoryMutation,
      prefetchDirectorySessionsIndex,
      rememberRecentDirectory,
      setAddDirectoryOpen,
      setDirectoryInput,
      setSidebarDirectories,
      viewerContextId,
    ]
  )

  const addDirectory = React.useCallback(async () => {
    await addDirectoryPath(directoryInput)
  }, [addDirectoryPath, directoryInput])

  const createSessionMutation = useMutation({
    mutationFn: async ({ cwd }: { cwd?: string }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<SimpleOkResponse>(
        buildRequestUrl("/api/session/new", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd }),
        }
      )
    },
  })

  const createSession = React.useCallback(
    async (cwdOverride?: string) => {
      if (!viewerContextId) return false

      const nextCwd = cwdOverride || defaultNewSessionDirectory || undefined
      if (nextCwd) {
        rememberRecentDirectory(nextCwd)
        safeLocalStorageSetItem(DRAFT_DIRECTORY_STORAGE_KEY, nextCwd)
        setStoredDraftDirectory(nextCwd)
      }
      const ownerKey = promptDraftKey({ cwd: nextCwd })
      setDraftSessionLoadingOwnerKey(ownerKey)

      try {
        await createSessionMutation.mutateAsync({ cwd: nextCwd })
        return true
      } catch (error) {
        setDraftSessionLoadingOwnerKey((current) =>
          current === ownerKey ? null : current
        )
        restorePendingDraftPrompt(ownerKey)
        toast.error(
          error instanceof Error ? error.message : "Failed to create session"
        )
        return false
      }
    },
    [
      createSessionMutation,
      defaultNewSessionDirectory,
      rememberRecentDirectory,
      restorePendingDraftPrompt,
      setDraftSessionLoadingOwnerKey,
      setStoredDraftDirectory,
      viewerContextId,
    ]
  )

  const queuePendingDraftPrompt = React.useCallback(
    (streamingBehavior?: StreamingBehavior) => {
      if (!draftSessionLoadingOwnerKey) return false

      const message = serializeComposerDraft({
        text: composerTextRef.current,
        skillName: composerSkillRef.current,
      }).trim()
      const images = composerImages.map((image) => ({ ...image }))
      if (!message && images.length === 0) return false

      if (!pendingDraftPrompt) {
        setPendingDraftPrompt({
          ownerKey: draftSessionLoadingOwnerKey,
          message,
          images,
          streamingBehavior,
        })
      } else {
        setPendingDraftFollowUps((current) => [
          ...current,
          {
            message,
            images,
            streamingBehavior:
              normalizeQueuedStreamingBehavior(streamingBehavior),
          },
        ])
      }

      replaceComposerDraft("")
      setComposerImages([])
      lastSyncedEditorTextRef.current = ""

      if (!pendingDraftPrompt) {
        toast.info("Prompt will send when the new session is ready.")
      }

      return true
    },
    [
      composerImages,
      composerSkillRef,
      composerTextRef,
      draftSessionLoadingOwnerKey,
      lastSyncedEditorTextRef,
      pendingDraftPrompt,
      replaceComposerDraft,
      setComposerImages,
      setPendingDraftFollowUps,
      setPendingDraftPrompt,
    ]
  )

  const promptMutation = useMutation({
    mutationFn: async ({
      message,
      images,
      streamingBehavior,
    }: {
      message: string
      images: Array<PromptImage>
      streamingBehavior?: StreamingBehavior
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<PromptResponse>(
        buildRequestUrl("/api/prompt", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message,
            images,
            streamingBehavior,
          }),
        }
      )
    },
  })

  const submitPrompt = React.useCallback(
    async (streamingBehavior?: StreamingBehavior) => {
      if (!viewerContextId) return false
      if (draftSessionLoadingOwnerKey) {
        return queuePendingDraftPrompt(streamingBehavior)
      }

      const message = serializeComposerDraft({
        text: composerTextRef.current,
        skillName: composerSkillRef.current,
      }).trim()
      if (!message && composerImages.length === 0) return false

      const treatAsQueuedPrompt = Boolean(
        sessionState.streaming || awaitingFirstTurn
      )
      const normalizedStreamingBehavior = treatAsQueuedPrompt
        ? normalizeQueuedStreamingBehavior(streamingBehavior)
        : streamingBehavior
      const submittedImages = composerImages.map((image) => ({ ...image }))
      const shouldOptimisticallyClearComposer = true

      setIsSubmitting(true)
      if (!treatAsQueuedPrompt) {
        setAwaitingFirstTurn(true)
      }
      if (shouldOptimisticallyClearComposer) {
        replaceComposerDraft("")
        setComposerImages([])
        lastSyncedEditorTextRef.current = ""
      }

      try {
        await promptMutation.mutateAsync({
          message,
          images: submittedImages,
          streamingBehavior: normalizedStreamingBehavior,
        })
        if (!shouldOptimisticallyClearComposer) {
          replaceComposerDraft("")
          setComposerImages([])
          lastSyncedEditorTextRef.current = ""
        }
        return true
      } catch (error) {
        if (!treatAsQueuedPrompt) {
          setAwaitingFirstTurn(false)
        }
        if (shouldOptimisticallyClearComposer) {
          const currentDraft = serializeComposerDraft({
            text: composerTextRef.current,
            skillName: composerSkillRef.current,
          }).trim()

          if (!currentDraft) {
            replaceComposerDraft(message)
            setComposerImages((current) =>
              current.length === 0
                ? submittedImages.map((image) => ({ ...image }))
                : current
            )
          }
        }
        toast.error(
          error instanceof Error ? error.message : "Failed to submit prompt"
        )
        return false
      } finally {
        setIsSubmitting(false)
      }
    },
    [
      awaitingFirstTurn,
      composerImages,
      composerSkillRef,
      composerTextRef,
      draftSessionLoadingOwnerKey,
      lastSyncedEditorTextRef,
      promptMutation,
      queuePendingDraftPrompt,
      replaceComposerDraft,
      sessionState.streaming,
      setAwaitingFirstTurn,
      setComposerImages,
      setIsSubmitting,
      viewerContextId,
    ]
  )

  const flushPendingDraftFollowUps = React.useCallback(async () => {
    if (draftSessionLoadingOwnerKey || pendingDraftFollowUps.length === 0) {
      return false
    }

    const followUps = pendingDraftFollowUps.map((entry) => ({
      message: entry.message,
      images: entry.images.map((image) => ({ ...image })),
      streamingBehavior: entry.streamingBehavior,
    }))

    setPendingDraftFollowUps([])

    for (const followUp of followUps) {
      try {
        await promptMutation.mutateAsync({
          message: followUp.message,
          images: followUp.images,
          streamingBehavior: followUp.streamingBehavior,
        })
      } catch (error) {
        if (!composerTextRef.current) {
          replaceComposerDraft(followUp.message)
          setComposerImages(followUp.images)
        }
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to submit queued follow-up"
        )
        return false
      }
    }

    return true
  }, [
    composerTextRef,
    draftSessionLoadingOwnerKey,
    pendingDraftFollowUps,
    promptMutation,
    replaceComposerDraft,
    setComposerImages,
    setPendingDraftFollowUps,
  ])

  const flushPendingDraftPrompt = React.useCallback(
    async (ownerKey: string) => {
      if (
        !pendingDraftPrompt ||
        pendingDraftPrompt.ownerKey !== ownerKey ||
        draftSessionLoadingOwnerKey
      ) {
        return false
      }

      const nextPrompt = pendingDraftPrompt
      setPendingDraftPrompt(null)
      applyPendingDraftPromptToComposer(nextPrompt)
      const sent = await submitPrompt(nextPrompt.streamingBehavior)
      if (!sent) {
        setPendingDraftFollowUps([])
        return false
      }
      await flushPendingDraftFollowUps()
      return true
    },
    [
      applyPendingDraftPromptToComposer,
      draftSessionLoadingOwnerKey,
      flushPendingDraftFollowUps,
      pendingDraftPrompt,
      setPendingDraftFollowUps,
      setPendingDraftPrompt,
      submitPrompt,
    ]
  )

  React.useEffect(() => {
    if (!draftSessionLoadingOwnerKey) return
    if (sessionState.sessionKey?.startsWith("optimistic:")) {
      return
    }

    const currentOwnerKey = promptDraftKey(sessionState)
    if (
      !sessionState.draft ||
      currentOwnerKey !== draftSessionLoadingOwnerKey
    ) {
      return
    }

    setDraftSessionLoadingOwnerKey(null)
    if (pendingDraftPrompt?.ownerKey === draftSessionLoadingOwnerKey) {
      void flushPendingDraftPrompt(draftSessionLoadingOwnerKey)
    }
  }, [
    draftSessionLoadingOwnerKey,
    flushPendingDraftPrompt,
    pendingDraftPrompt?.ownerKey,
    sessionState,
    setDraftSessionLoadingOwnerKey,
  ])

  React.useEffect(() => {
    if (!awaitingFirstTurn) return
    const hasAssistantOutput = sessionState.items.some(
      (item) =>
        item.kind === "assistant" &&
        item.blocks.some((block) => block.type === "text" && block.text.trim())
    )

    if (
      sessionState.streaming ||
      hasAssistantOutput ||
      pendingMessages.length > 0
    ) {
      setAwaitingFirstTurn(false)
    }
  }, [
    awaitingFirstTurn,
    pendingMessages.length,
    sessionState.items,
    sessionState.streaming,
    setAwaitingFirstTurn,
  ])

  const abortSessionMutation = useMutation({
    mutationFn: async () => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<SimpleOkResponse>(
        buildRequestUrl("/api/abort", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
        }
      )
    },
  })

  const abortSession = React.useCallback(async () => {
    if (!viewerContextId) return
    try {
      await abortSessionMutation.mutateAsync()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to abort session"
      )
    }
  }, [abortSessionMutation, viewerContextId])

  const removePendingMessageMutation = useMutation({
    mutationFn: async (pendingId: string) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<PendingMessageRemoveResponse>(
        buildRequestUrl("/api/pending-message/remove", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pendingId }),
        }
      )
    },
  })

  const removePendingMessage = React.useCallback(
    async (pendingId: string) => {
      if (!viewerContextId) return
      try {
        await removePendingMessageMutation.mutateAsync(pendingId)
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to remove pending prompt"
        )
      }
    },
    [removePendingMessageMutation, viewerContextId]
  )

  const reorderPendingMessagesMutation = useMutation({
    mutationFn: async (nextPendingMessages: Array<PendingComposerMessage>) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<PendingMessagesResponse>(
        buildRequestUrl("/api/pending-messages/reorder", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pendingMessages: nextPendingMessages }),
        }
      )
    },
  })

  const reorderPending = React.useCallback(
    async (pendingId: string, direction: -1 | 1) => {
      if (!viewerContextId) return
      const next = [...pendingMessages]
      const index = next.findIndex((entry) => entry.pendingId === pendingId)
      if (index === -1) return
      const targetIndex = index + direction
      if (targetIndex < 0 || targetIndex >= next.length) return
      const [item] = next.splice(index, 1)
      next.splice(targetIndex, 0, item)
      try {
        await reorderPendingMessagesMutation.mutateAsync(next)
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to reorder pending prompts"
        )
      }
    },
    [pendingMessages, reorderPendingMessagesMutation, viewerContextId]
  )

  return {
    abortSession,
    addDirectory,
    addDirectoryPath,
    createSession,
    removePendingMessage,
    reorderPending,
    submitPrompt,
  }
}
