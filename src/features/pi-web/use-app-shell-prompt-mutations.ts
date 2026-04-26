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
  optimisticId?: string
}

type PendingDraftFollowUp = {
  message: string
  images: Array<PromptImage>
  streamingBehavior: "steer" | "followUp"
  optimisticId?: string
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
  defaultNewSessionDirectory?: string
  sessionState: SessionState
  draftSessionLoadingOwnerKey: string | null
  pendingDraftPrompt: PendingDraftPrompt | null
  pendingDraftFollowUps: Array<PendingDraftFollowUp>
  awaitingFirstTurn: boolean
  pendingMessages: Array<PendingComposerMessage>
  composerImagesRef: React.MutableRefObject<Array<PromptImage>>
  composerTextRef: React.MutableRefObject<string>
  composerSkillRef: React.MutableRefObject<string | undefined>
  replaceComposerDraft: (
    value: string,
    target?: SessionState,
    options?: {
      forceSync?: boolean
    }
  ) => void
  lastSyncedEditorTextRef: React.MutableRefObject<string>
  rememberRecentDirectory: (directory: string) => void
  prefetchDirectorySessionsIndex: (directory: string) => void
  addOptimisticUserMessage: (options: {
    message: string
    images: Array<PromptImage>
    queued: boolean
    streamingBehavior?: StreamingBehavior
  }) => string
  removeOptimisticUserMessage: (pendingId: string | undefined) => void
  setSidebarDirectories: React.Dispatch<React.SetStateAction<Array<string>>>
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
  setPendingMessages: React.Dispatch<
    React.SetStateAction<Array<PendingComposerMessage>>
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

function createLocalPendingId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `optimistic:${crypto.randomUUID()}`
  }

  return `optimistic:${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

function isPendingPromptNotFoundError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("pending prompt not found")
  )
}

export function useAppShellPromptMutations({
  viewerContextId,
  activeSessionId,
  defaultNewSessionDirectory,
  sessionState,
  draftSessionLoadingOwnerKey,
  pendingDraftPrompt,
  pendingDraftFollowUps,
  awaitingFirstTurn,
  pendingMessages,
  composerImagesRef,
  composerTextRef,
  composerSkillRef,
  replaceComposerDraft,
  lastSyncedEditorTextRef,
  rememberRecentDirectory,
  prefetchDirectorySessionsIndex,
  addOptimisticUserMessage,
  removeOptimisticUserMessage,
  setSidebarDirectories,
  setStoredDraftDirectory,
  setDraftSessionLoadingOwnerKey,
  setPendingDraftPrompt,
  setPendingDraftFollowUps,
  setPendingMessages,
  setAwaitingFirstTurn,
  setIsSubmitting,
  setComposerImages,
}: UseAppShellPromptMutationsOptions) {
  const draftSessionLoadingOwnerKeyRef = React.useRef(
    draftSessionLoadingOwnerKey
  )
  const pendingDraftPromptRef = React.useRef(pendingDraftPrompt)
  const pendingDraftFollowUpsRef = React.useRef(pendingDraftFollowUps)
  const pendingMessagesRef = React.useRef(pendingMessages)
  const awaitingFirstTurnRef = React.useRef(awaitingFirstTurn)
  const sessionStreamingRef = React.useRef(sessionState.streaming)

  React.useEffect(() => {
    draftSessionLoadingOwnerKeyRef.current = draftSessionLoadingOwnerKey
  }, [draftSessionLoadingOwnerKey])

  React.useEffect(() => {
    pendingDraftPromptRef.current = pendingDraftPrompt
  }, [pendingDraftPrompt])

  React.useEffect(() => {
    pendingDraftFollowUpsRef.current = pendingDraftFollowUps
  }, [pendingDraftFollowUps])

  React.useEffect(() => {
    pendingMessagesRef.current = pendingMessages
  }, [pendingMessages])

  React.useEffect(() => {
    awaitingFirstTurnRef.current = awaitingFirstTurn
  }, [awaitingFirstTurn])

  React.useEffect(() => {
    sessionStreamingRef.current = sessionState.streaming
  }, [sessionState.streaming])

  const updatePendingMessages = React.useCallback(
    (
      updater: (
        current: Array<PendingComposerMessage>
      ) => Array<PendingComposerMessage>
    ) => {
      setPendingMessages((current) => {
        const next = updater(current)
        pendingMessagesRef.current = next
        return next
      })
    },
    [setPendingMessages]
  )

  const addOptimisticPendingMessage = React.useCallback(
    (message: PendingComposerMessage) => {
      updatePendingMessages((current) => {
        if (current.some((entry) => entry.pendingId === message.pendingId)) {
          return current
        }

        return [...current, message]
      })
    },
    [updatePendingMessages]
  )

  const removeOptimisticPendingMessage = React.useCallback(
    (pendingId: string) => {
      updatePendingMessages((current) =>
        current.filter((entry) => entry.pendingId !== pendingId)
      )
    },
    [updatePendingMessages]
  )

  const restoreOptimisticPendingMessage = React.useCallback(
    (message: PendingComposerMessage, index: number) => {
      updatePendingMessages((current) => {
        if (current.some((entry) => entry.pendingId === message.pendingId)) {
          return current
        }

        const next = [...current]
        next.splice(Math.max(0, Math.min(index, next.length)), 0, message)
        return next
      })
    },
    [updatePendingMessages]
  )

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
      const nextPrompt = pendingDraftPromptRef.current
      if (!nextPrompt || nextPrompt.ownerKey !== ownerKey) {
        return false
      }

      removeOptimisticUserMessage(nextPrompt.optimisticId)
      for (const followUp of pendingDraftFollowUpsRef.current) {
        removeOptimisticUserMessage(followUp.optimisticId)
      }

      pendingDraftPromptRef.current = null
      pendingDraftFollowUpsRef.current = []
      setPendingDraftPrompt(null)
      setPendingDraftFollowUps([])
      awaitingFirstTurnRef.current = false
      setAwaitingFirstTurn(false)
      return applyPendingDraftPromptToComposer(nextPrompt)
    },
    [
      applyPendingDraftPromptToComposer,
      removeOptimisticUserMessage,
      setAwaitingFirstTurn,
      setPendingDraftFollowUps,
      setPendingDraftPrompt,
    ]
  )

  const addDirectoryPath = React.useCallback(
    async (path: string) => {
      if (!viewerContextId) return false
      const requestedPath = path.trim()
      if (!requestedPath) return false

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
        prefetchDirectorySessionsIndex(response.path)
        return true
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to add directory"
        )
        return false
      }
    },
    [
      addDirectoryMutation,
      prefetchDirectorySessionsIndex,
      rememberRecentDirectory,
      setSidebarDirectories,
      viewerContextId,
    ]
  )

  const createSessionRequest = React.useCallback(
    async ({ cwd }: { cwd?: string }) => {
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
    [activeSessionId, viewerContextId]
  )

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
      draftSessionLoadingOwnerKeyRef.current = ownerKey
      setDraftSessionLoadingOwnerKey(ownerKey)

      try {
        await createSessionRequest({ cwd: nextCwd })
        return true
      } catch (error) {
        if (draftSessionLoadingOwnerKeyRef.current === ownerKey) {
          draftSessionLoadingOwnerKeyRef.current = null
        }
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
      createSessionRequest,
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
      const ownerKey = draftSessionLoadingOwnerKeyRef.current
      if (!ownerKey) return false

      const message = serializeComposerDraft({
        text: composerTextRef.current,
        skillName: composerSkillRef.current,
      }).trim()
      const images = composerImagesRef.current.map((image) => ({ ...image }))
      if (!message && images.length === 0) return false

      const currentPendingPrompt =
        pendingDraftPromptRef.current?.ownerKey === ownerKey
          ? pendingDraftPromptRef.current
          : null

      if (!currentPendingPrompt) {
        const optimisticId = addOptimisticUserMessage({
          message,
          images,
          queued: false,
        })
        const nextPrompt = {
          ownerKey,
          message,
          images,
          optimisticId,
        } satisfies PendingDraftPrompt
        pendingDraftPromptRef.current = nextPrompt
        setPendingDraftPrompt(nextPrompt)
        awaitingFirstTurnRef.current = true
        setAwaitingFirstTurn(true)
        toast.info("Prompt will send when the new session is ready.")
      } else {
        const queuedStreamingBehavior =
          normalizeQueuedStreamingBehavior(streamingBehavior)
        const optimisticId = createLocalPendingId()
        const nextFollowUps = [
          ...pendingDraftFollowUpsRef.current,
          {
            message,
            images,
            streamingBehavior: queuedStreamingBehavior,
            optimisticId,
          },
        ] satisfies Array<PendingDraftFollowUp>
        pendingDraftFollowUpsRef.current = nextFollowUps
        setPendingDraftFollowUps(nextFollowUps)
      }

      replaceComposerDraft("", undefined, { forceSync: true })
      setComposerImages([])
      lastSyncedEditorTextRef.current = ""

      return true
    },
    [
      addOptimisticUserMessage,
      composerImagesRef,
      composerSkillRef,
      composerTextRef,
      lastSyncedEditorTextRef,
      replaceComposerDraft,
      setAwaitingFirstTurn,
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
      pendingId,
    }: {
      message: string
      images: Array<PromptImage>
      streamingBehavior?: StreamingBehavior
      pendingId?: string
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
            pendingId,
          }),
        }
      )
    },
  })

  const submitPrompt = React.useCallback(
    async (
      streamingBehavior?: StreamingBehavior,
      options?: {
        forceFirstPrompt?: boolean
        optimisticId?: string
      }
    ) => {
      if (!viewerContextId) return false
      if (draftSessionLoadingOwnerKeyRef.current) {
        return queuePendingDraftPrompt(streamingBehavior)
      }

      const message = serializeComposerDraft({
        text: composerTextRef.current,
        skillName: composerSkillRef.current,
      }).trim()
      if (!message && composerImagesRef.current.length === 0) return false

      const treatAsQueuedPrompt = options?.forceFirstPrompt
        ? false
        : Boolean(sessionStreamingRef.current || awaitingFirstTurnRef.current)
      const normalizedStreamingBehavior = treatAsQueuedPrompt
        ? normalizeQueuedStreamingBehavior(streamingBehavior)
        : undefined
      const submittedImages = composerImagesRef.current.map((image) => ({
        ...image,
      }))
      const shouldOptimisticallyClearComposer = true
      const queuedPendingId = treatAsQueuedPrompt
        ? createLocalPendingId()
        : undefined
      const optimisticId =
        options?.optimisticId ??
        (treatAsQueuedPrompt
          ? undefined
          : addOptimisticUserMessage({
              message,
              images: submittedImages,
              queued: false,
            }))

      if (queuedPendingId && normalizedStreamingBehavior) {
        addOptimisticPendingMessage({
          pendingId: queuedPendingId,
          text: message,
          images: submittedImages.map((image) => ({ ...image })),
          streamingBehavior: normalizedStreamingBehavior,
        })
      }

      setIsSubmitting(true)
      if (!treatAsQueuedPrompt) {
        awaitingFirstTurnRef.current = true
        setAwaitingFirstTurn(true)
      }
      if (shouldOptimisticallyClearComposer) {
        replaceComposerDraft("", undefined, { forceSync: true })
        setComposerImages([])
        lastSyncedEditorTextRef.current = ""
      }

      try {
        const response = await promptMutation.mutateAsync({
          message,
          images: submittedImages,
          streamingBehavior: normalizedStreamingBehavior,
          pendingId: queuedPendingId,
        })
        if (
          queuedPendingId &&
          "queued" in response &&
          (!response.queued || response.canceled)
        ) {
          removeOptimisticPendingMessage(queuedPendingId)
        }
        if (!shouldOptimisticallyClearComposer) {
          replaceComposerDraft("")
          setComposerImages([])
          lastSyncedEditorTextRef.current = ""
        }
        return true
      } catch (error) {
        if (queuedPendingId) {
          removeOptimisticPendingMessage(queuedPendingId)
        }
        removeOptimisticUserMessage(optimisticId)
        if (!treatAsQueuedPrompt) {
          awaitingFirstTurnRef.current = false
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
      addOptimisticPendingMessage,
      addOptimisticUserMessage,
      composerImagesRef,
      composerSkillRef,
      composerTextRef,
      lastSyncedEditorTextRef,
      promptMutation,
      queuePendingDraftPrompt,
      removeOptimisticPendingMessage,
      removeOptimisticUserMessage,
      replaceComposerDraft,
      setAwaitingFirstTurn,
      setComposerImages,
      setIsSubmitting,
      viewerContextId,
    ]
  )

  const flushPendingDraftFollowUps = React.useCallback(async () => {
    if (draftSessionLoadingOwnerKeyRef.current) {
      return false
    }

    const pendingFollowUps = pendingDraftFollowUpsRef.current
    if (pendingFollowUps.length === 0) {
      return false
    }

    const followUps = pendingFollowUps.map((entry) => ({
      message: entry.message,
      images: entry.images.map((image) => ({ ...image })),
      streamingBehavior: entry.streamingBehavior,
      optimisticId: entry.optimisticId,
    }))

    pendingDraftFollowUpsRef.current = []
    setPendingDraftFollowUps([])

    for (let index = 0; index < followUps.length; index += 1) {
      const followUp = followUps[index]
      if (!followUp) continue

      try {
        await promptMutation.mutateAsync({
          message: followUp.message,
          images: followUp.images,
          streamingBehavior: followUp.streamingBehavior,
          pendingId: followUp.optimisticId,
        })
      } catch (error) {
        for (const unsentFollowUp of followUps.slice(index)) {
          removeOptimisticUserMessage(unsentFollowUp.optimisticId)
        }
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
    promptMutation,
    removeOptimisticUserMessage,
    replaceComposerDraft,
    setComposerImages,
    setPendingDraftFollowUps,
  ])

  const flushPendingDraftPrompt = React.useCallback(
    async (ownerKey: string) => {
      const nextPrompt = pendingDraftPromptRef.current
      if (
        !nextPrompt ||
        nextPrompt.ownerKey !== ownerKey ||
        draftSessionLoadingOwnerKeyRef.current
      ) {
        return false
      }

      pendingDraftPromptRef.current = null
      setPendingDraftPrompt(null)
      applyPendingDraftPromptToComposer(nextPrompt)
      const sent = await submitPrompt(nextPrompt.streamingBehavior, {
        forceFirstPrompt: true,
        optimisticId: nextPrompt.optimisticId,
      })
      if (!sent) {
        for (const followUp of pendingDraftFollowUpsRef.current) {
          removeOptimisticUserMessage(followUp.optimisticId)
        }
        pendingDraftFollowUpsRef.current = []
        setPendingDraftFollowUps([])
        return false
      }
      await flushPendingDraftFollowUps()
      return true
    },
    [
      applyPendingDraftPromptToComposer,
      flushPendingDraftFollowUps,
      removeOptimisticUserMessage,
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

    draftSessionLoadingOwnerKeyRef.current = null
    setDraftSessionLoadingOwnerKey(null)
    if (
      pendingDraftPromptRef.current?.ownerKey === draftSessionLoadingOwnerKey
    ) {
      void flushPendingDraftPrompt(draftSessionLoadingOwnerKey)
    }
  }, [
    draftSessionLoadingOwnerKey,
    flushPendingDraftPrompt,
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
      awaitingFirstTurnRef.current = false
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

      const previousIndex = pendingMessagesRef.current.findIndex(
        (entry) => entry.pendingId === pendingId
      )
      const previousMessage = pendingMessagesRef.current[previousIndex]
      removeOptimisticPendingMessage(pendingId)

      try {
        await removePendingMessageMutation.mutateAsync(pendingId)
      } catch (error) {
        if (isPendingPromptNotFoundError(error)) {
          return
        }

        if (previousMessage) {
          restoreOptimisticPendingMessage(previousMessage, previousIndex)
        }
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to remove pending prompt"
        )
      }
    },
    [
      removeOptimisticPendingMessage,
      removePendingMessageMutation,
      restoreOptimisticPendingMessage,
      viewerContextId,
    ]
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
      const next = [...pendingMessagesRef.current]
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
    [pendingMessagesRef, reorderPendingMessagesMutation, viewerContextId]
  )

  return {
    abortSession,
    addDirectoryPath,
    createSession,
    removePendingMessage,
    reorderPending,
    submitPrompt,
  }
}
