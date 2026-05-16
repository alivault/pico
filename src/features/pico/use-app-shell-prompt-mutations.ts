import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { PromptImage, SessionState, StreamingBehavior } from "@/lib/pico"
import type {
  DirectoryResolveResponse,
  PendingMessageRemoveResponse,
  PendingMessagesResponse,
  PromptResponse,
  SimpleOkResponse,
} from "@/lib/pico/api"

import { resolveNewSessionCwd } from "@/features/pico/app-shell-common"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import { picoQueryKeys, picoSessionScopeKey } from "@/features/pico/query-keys"
import {
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import {
  buildComposerPromptMessage,
  serializeComposerDraft,
} from "@/features/pico/composer-utils"
import type { ComposerDiffLineComment } from "@/features/pico/app-shell-composer-state"
import {
  DRAFT_DIRECTORY_STORAGE_KEY,
  SIDEBAR_DIRECTORIES_STORAGE_KEY,
  normalizeStoredDirectoryList,
  promptDraftKey,
  promptDraftKeyMatchesOwner,
  safeLocalStorageSetItem,
} from "@/lib/pico"

type DirectoryResolveData = Extract<DirectoryResolveResponse, { ok: true }>

type PendingDraftPrompt = {
  ownerKey: string
  message: string
  images: Array<PromptImage>
  streamingBehavior?: StreamingBehavior
  optimisticId?: string
  optimisticSidebarSessionId?: string
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

type SessionStateStore = PicoStore<SessionState>

type UseAppShellPromptMutationsOptions = {
  viewerContextId: string
  activeSessionId?: string
  defaultNewSessionDirectory?: string
  sessionStore: SessionStateStore
  sessionStateRef: React.RefObject<SessionState>
  draftSessionLoadingOwnerKey: string | null
  pendingDraftPrompt: PendingDraftPrompt | null
  pendingDraftFollowUps: Array<PendingDraftFollowUp>
  awaitingFirstTurn: boolean
  pendingMessages: Array<PendingComposerMessage>
  composerDiffLineCommentsRef: React.RefObject<Array<ComposerDiffLineComment>>
  composerImagesRef: React.RefObject<Array<PromptImage>>
  composerTextRef: React.RefObject<string>
  composerSkillRef: React.RefObject<string | undefined>
  replaceComposerDraft: (
    value: string,
    target?: SessionState,
    options?: {
      forceSync?: boolean
    }
  ) => void
  lastSyncedEditorTextRef: React.RefObject<string>
  rememberRecentDirectory: (directory: string) => void
  prefetchDirectorySessionsIndex: (directory: string) => void
  addOptimisticUserMessage: (options: {
    message: string
    images: Array<PromptImage>
    queued: boolean
    streamingBehavior?: StreamingBehavior
  }) => string
  removeOptimisticUserMessage: (pendingId: string | undefined) => void
  addOptimisticSidebarSession: (options?: {
    id?: string
    cwd?: string
  }) => string | undefined
  removeOptimisticSidebarSession: (optimisticId: string | undefined) => void
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
  setComposerDiffLineComments: React.Dispatch<
    React.SetStateAction<Array<ComposerDiffLineComment>>
  >
  setComposerImages: React.Dispatch<React.SetStateAction<Array<PromptImage>>>
}

type PromptMutationSessionSnapshot = {
  assistantOutputSignature: string
  cwd?: string
  draft: boolean
  sessionFile?: string
  sessionId?: string
  sessionKey?: string
  streaming: boolean
}

function samePromptMutationSessionSnapshot(
  left: PromptMutationSessionSnapshot,
  right: PromptMutationSessionSnapshot
) {
  return (
    left.assistantOutputSignature === right.assistantOutputSignature &&
    left.cwd === right.cwd &&
    left.draft === right.draft &&
    left.sessionFile === right.sessionFile &&
    left.sessionId === right.sessionId &&
    left.sessionKey === right.sessionKey &&
    left.streaming === right.streaming
  )
}

function sessionAssistantOutputSignature(items: SessionState["items"]) {
  let outputCount = 0
  let lastOutputKey = ""

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item || item.kind !== "assistant") continue

    const hasTextOutput = item.blocks.some(
      (block) => block.type === "text" && block.text.trim()
    )
    if (!hasTextOutput) continue

    outputCount += 1
    lastOutputKey = item.itemKey || item.renderKey || `index:${index}`
  }

  return `${outputCount}:${lastOutputKey}`
}

function usePromptMutationSessionSnapshot(store: SessionStateStore) {
  return useSelector(
    store,
    (sessionState) => ({
      assistantOutputSignature: sessionAssistantOutputSignature(
        sessionState.items
      ),
      cwd: sessionState.cwd,
      draft: sessionState.draft,
      sessionFile: sessionState.sessionFile,
      sessionId: sessionState.sessionId,
      sessionKey: sessionState.sessionKey,
      streaming: sessionState.streaming,
    }),
    { compare: samePromptMutationSessionSnapshot }
  )
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

function buildCurrentSessionRequestUrl(
  path: string,
  {
    contextId,
    sessionState,
    fallbackSessionId,
  }: {
    contextId: string
    sessionState: SessionState
    fallbackSessionId?: string
  }
) {
  const sessionKey =
    sessionState.sessionKey &&
    !sessionState.sessionKey.startsWith("optimistic:")
      ? sessionState.sessionKey
      : undefined
  // Drafts do not expose a stable session id yet. During a new-session
  // transition, callbacks can still carry the previous route session id as a
  // fallback, so prefer the explicit runtime session key whenever the current
  // snapshot is a draft or otherwise id-less.
  const shouldUseSessionKey = Boolean(
    sessionKey && (sessionState.draft || !sessionState.sessionId)
  )

  return buildRequestUrl(path, {
    contextId,
    sessionId: shouldUseSessionKey
      ? undefined
      : (sessionState.sessionId ?? fallbackSessionId),
    searchParams: shouldUseSessionKey ? { sessionKey } : undefined,
  })
}

function isPendingPromptNotFoundError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("pending prompt not found")
  )
}

function movePendingComposerMessage(
  messages: Array<PendingComposerMessage>,
  pendingId: string,
  direction: -1 | 1
) {
  const index = messages.findIndex((entry) => entry.pendingId === pendingId)
  if (index === -1) return null

  const item = messages[index]
  if (!item) return null

  const next = [...messages]
  const targetIndex = index + direction
  const target = next[targetIndex]

  if (direction === -1) {
    if (item.streamingBehavior === "followUp" && !target) {
      next[index] = { ...item, streamingBehavior: "steer" }
      return next
    }

    if (
      item.streamingBehavior === "followUp" &&
      target.streamingBehavior === "steer"
    ) {
      next[index] = { ...item, streamingBehavior: "steer" }
      return next
    }
  }

  if (direction === 1) {
    if (item.streamingBehavior === "steer" && !target) {
      next[index] = { ...item, streamingBehavior: "followUp" }
      return next
    }

    if (
      item.streamingBehavior === "steer" &&
      target.streamingBehavior === "followUp"
    ) {
      next[index] = { ...item, streamingBehavior: "followUp" }
      return next
    }
  }

  if (!target) return null

  const [movedItem] = next.splice(index, 1)
  if (!movedItem) return null
  next.splice(targetIndex, 0, movedItem)
  return next
}

export function useAppShellPromptMutations({
  viewerContextId,
  activeSessionId,
  defaultNewSessionDirectory,
  sessionStore,
  sessionStateRef,
  draftSessionLoadingOwnerKey,
  pendingDraftPrompt,
  pendingDraftFollowUps,
  awaitingFirstTurn,
  pendingMessages,
  composerDiffLineCommentsRef,
  composerImagesRef,
  composerTextRef,
  composerSkillRef,
  replaceComposerDraft,
  lastSyncedEditorTextRef,
  rememberRecentDirectory,
  prefetchDirectorySessionsIndex,
  addOptimisticUserMessage,
  removeOptimisticUserMessage,
  addOptimisticSidebarSession,
  removeOptimisticSidebarSession,
  setSidebarDirectories,
  setStoredDraftDirectory,
  setDraftSessionLoadingOwnerKey,
  setPendingDraftPrompt,
  setPendingDraftFollowUps,
  setPendingMessages,
  setAwaitingFirstTurn,
  setIsSubmitting,
  setComposerDiffLineComments,
  setComposerImages,
}: UseAppShellPromptMutationsOptions) {
  const queryClient = useQueryClient()
  const draftSessionLoadingOwnerKeyRef = React.useRef(
    draftSessionLoadingOwnerKey
  )
  const pendingDraftPromptRef = React.useRef(pendingDraftPrompt)
  const pendingDraftFollowUpsRef = React.useRef(pendingDraftFollowUps)
  const pendingMessagesRef = React.useRef(pendingMessages)
  const awaitingFirstTurnRef = React.useRef(awaitingFirstTurn)
  const awaitingFirstTurnAssistantOutputSignatureRef = React.useRef<
    string | null
  >(null)
  const sessionSnapshot = usePromptMutationSessionSnapshot(sessionStore)
  const sessionStreamingRef = React.useRef(sessionSnapshot.streaming)

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
    sessionStreamingRef.current = sessionSnapshot.streaming
  }, [sessionSnapshot.streaming])

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
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.directorySessionsIndex(
          viewerContextId,
          response.path
        ),
        refetchType: "active",
      })
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
      removeOptimisticSidebarSession(nextPrompt.optimisticSidebarSessionId)
      for (const followUp of pendingDraftFollowUpsRef.current) {
        removeOptimisticUserMessage(followUp.optimisticId)
      }

      pendingDraftPromptRef.current = null
      pendingDraftFollowUpsRef.current = []
      setPendingDraftPrompt(null)
      setPendingDraftFollowUps([])
      awaitingFirstTurnAssistantOutputSignatureRef.current = null
      awaitingFirstTurnRef.current = false
      setAwaitingFirstTurn(false)
      return applyPendingDraftPromptToComposer(nextPrompt)
    },
    [
      applyPendingDraftPromptToComposer,
      removeOptimisticSidebarSession,
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
        return response.path
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

      const nextCwd = resolveNewSessionCwd({
        cwdOverride,
        defaultDirectory: defaultNewSessionDirectory,
        currentCwd: sessionStateRef.current.cwd,
      })
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
      sessionStateRef,
      setDraftSessionLoadingOwnerKey,
      setStoredDraftDirectory,
      viewerContextId,
    ]
  )

  const queuePendingDraftPrompt = React.useCallback(
    (streamingBehavior?: StreamingBehavior) => {
      const ownerKey = draftSessionLoadingOwnerKeyRef.current
      if (!ownerKey) return false

      const message = buildComposerPromptMessage({
        text: composerTextRef.current,
        skillName: composerSkillRef.current,
        diffLineComments: composerDiffLineCommentsRef.current,
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
        const optimisticSidebarSessionId = addOptimisticSidebarSession()
        const nextPrompt = {
          ownerKey,
          message,
          images,
          optimisticId,
          optimisticSidebarSessionId,
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
      setComposerDiffLineComments([])
      setComposerImages([])
      lastSyncedEditorTextRef.current = ""

      return true
    },
    [
      addOptimisticSidebarSession,
      addOptimisticUserMessage,
      composerDiffLineCommentsRef,
      composerImagesRef,
      composerSkillRef,
      composerTextRef,
      lastSyncedEditorTextRef,
      replaceComposerDraft,
      setAwaitingFirstTurn,
      setComposerDiffLineComments,
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
      thinkingLevel,
    }: {
      message: string
      images: Array<PromptImage>
      streamingBehavior?: StreamingBehavior
      pendingId?: string
      thinkingLevel?: string
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<PromptResponse>(
        buildCurrentSessionRequestUrl("/api/prompt", {
          contextId: viewerContextId,
          sessionState: sessionStateRef.current,
          fallbackSessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message,
            images,
            streamingBehavior,
            pendingId,
            thinkingLevel,
          }),
        }
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.sessionTree(
          viewerContextId,
          picoSessionScopeKey(sessionStateRef.current)
        ),
        refetchType: "active",
      })
    },
  })

  const submitPrompt = React.useCallback(
    async (
      streamingBehavior?: StreamingBehavior,
      options?: {
        forceFirstPrompt?: boolean
        optimisticId?: string
        optimisticSidebarSessionId?: string
      }
    ) => {
      if (!viewerContextId) return false
      if (draftSessionLoadingOwnerKeyRef.current) {
        return queuePendingDraftPrompt(streamingBehavior)
      }

      const submittedDiffLineComments = composerDiffLineCommentsRef.current.map(
        (comment) => ({ ...comment })
      )
      const message = buildComposerPromptMessage({
        text: composerTextRef.current,
        skillName: composerSkillRef.current,
        diffLineComments: submittedDiffLineComments,
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

      if (!treatAsQueuedPrompt) {
        awaitingFirstTurnAssistantOutputSignatureRef.current =
          sessionAssistantOutputSignature(sessionStateRef.current.items)
        awaitingFirstTurnRef.current = true
        setAwaitingFirstTurn(true)
      }

      const optimisticId =
        options?.optimisticId ??
        (treatAsQueuedPrompt
          ? undefined
          : addOptimisticUserMessage({
              message,
              images: submittedImages,
              queued: false,
            }))
      const optimisticSidebarSessionId =
        options?.optimisticSidebarSessionId ??
        (!treatAsQueuedPrompt && sessionStateRef.current.draft
          ? addOptimisticSidebarSession()
          : undefined)

      if (queuedPendingId && normalizedStreamingBehavior) {
        addOptimisticPendingMessage({
          pendingId: queuedPendingId,
          text: message,
          images: submittedImages.map((image) => ({ ...image })),
          streamingBehavior: normalizedStreamingBehavior,
        })
      }

      setIsSubmitting(true)
      if (shouldOptimisticallyClearComposer) {
        replaceComposerDraft("", undefined, { forceSync: true })
        setComposerDiffLineComments([])
        setComposerImages([])
        lastSyncedEditorTextRef.current = ""
      }

      try {
        const response = await promptMutation.mutateAsync({
          message,
          images: submittedImages,
          streamingBehavior: normalizedStreamingBehavior,
          pendingId: queuedPendingId,
          thinkingLevel: sessionStateRef.current.thinkingLevel,
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
          setComposerDiffLineComments([])
          setComposerImages([])
          lastSyncedEditorTextRef.current = ""
        }
        return true
      } catch (error) {
        if (queuedPendingId) {
          removeOptimisticPendingMessage(queuedPendingId)
        }
        removeOptimisticUserMessage(optimisticId)
        removeOptimisticSidebarSession(optimisticSidebarSessionId)
        if (!treatAsQueuedPrompt) {
          awaitingFirstTurnAssistantOutputSignatureRef.current = null
          awaitingFirstTurnRef.current = false
          setAwaitingFirstTurn(false)
        }
        if (shouldOptimisticallyClearComposer) {
          const currentDraft = serializeComposerDraft({
            text: composerTextRef.current,
            skillName: composerSkillRef.current,
          }).trim()

          if (
            !currentDraft &&
            composerDiffLineCommentsRef.current.length === 0
          ) {
            replaceComposerDraft(message)
            setComposerDiffLineComments((current) =>
              current.length === 0
                ? submittedDiffLineComments.map((comment) => ({ ...comment }))
                : current
            )
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
      addOptimisticSidebarSession,
      addOptimisticUserMessage,
      composerDiffLineCommentsRef,
      composerImagesRef,
      composerSkillRef,
      composerTextRef,
      lastSyncedEditorTextRef,
      promptMutation,
      queuePendingDraftPrompt,
      sessionStateRef,
      removeOptimisticPendingMessage,
      removeOptimisticSidebarSession,
      removeOptimisticUserMessage,
      replaceComposerDraft,
      setAwaitingFirstTurn,
      setComposerDiffLineComments,
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

    const flushFollowUp = async (index = 0): Promise<boolean> => {
      const followUp = followUps[index]
      if (!followUp) return true

      try {
        await promptMutation.mutateAsync({
          message: followUp.message,
          images: followUp.images,
          streamingBehavior: followUp.streamingBehavior,
          pendingId: followUp.optimisticId,
          thinkingLevel: sessionStateRef.current.thinkingLevel,
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

      return await flushFollowUp(index + 1)
    }

    return await flushFollowUp()
  }, [
    composerTextRef,
    promptMutation,
    removeOptimisticUserMessage,
    sessionStateRef,
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
        optimisticSidebarSessionId: nextPrompt.optimisticSidebarSessionId,
      })
      if (!sent) {
        removeOptimisticSidebarSession(nextPrompt.optimisticSidebarSessionId)
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
      removeOptimisticSidebarSession,
      removeOptimisticUserMessage,
      setPendingDraftFollowUps,
      setPendingDraftPrompt,
      submitPrompt,
    ]
  )

  React.useEffect(() => {
    if (!draftSessionLoadingOwnerKey) return
    const currentSessionState = sessionStateRef.current
    if (currentSessionState.sessionKey?.startsWith("optimistic:")) {
      return
    }

    const currentOwnerKey = promptDraftKey(currentSessionState)
    if (
      !currentSessionState.draft ||
      !promptDraftKeyMatchesOwner(currentOwnerKey, draftSessionLoadingOwnerKey)
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
    sessionSnapshot,
    sessionStateRef,
    setDraftSessionLoadingOwnerKey,
  ])

  React.useEffect(() => {
    if (!awaitingFirstTurn) return

    const baselineAssistantOutputSignature =
      awaitingFirstTurnAssistantOutputSignatureRef.current
    const assistantOutputStarted =
      baselineAssistantOutputSignature !== null &&
      sessionSnapshot.assistantOutputSignature !==
        baselineAssistantOutputSignature

    if (
      sessionStateRef.current.streaming ||
      assistantOutputStarted ||
      pendingMessages.length > 0
    ) {
      awaitingFirstTurnAssistantOutputSignatureRef.current = null
      awaitingFirstTurnRef.current = false
      setAwaitingFirstTurn(false)
    }
  }, [
    awaitingFirstTurn,
    pendingMessages.length,
    sessionSnapshot.assistantOutputSignature,
    sessionSnapshot.streaming,
    sessionStateRef,
    setAwaitingFirstTurn,
  ])

  const abortSessionMutation = useMutation({
    mutationFn: async () => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<SimpleOkResponse>(
        buildCurrentSessionRequestUrl("/api/abort", {
          contextId: viewerContextId,
          sessionState: sessionStateRef.current,
          fallbackSessionId: activeSessionId,
        }),
        {
          method: "POST",
        }
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.sessionTree(
          viewerContextId,
          picoSessionScopeKey(sessionStateRef.current)
        ),
        refetchType: "active",
      })
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

  const editPendingMessagesMutation = useMutation({
    mutationFn: async (nextPendingMessages: Array<PendingComposerMessage>) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<PendingMessagesResponse>(
        buildCurrentSessionRequestUrl("/api/pending-messages/reorder", {
          contextId: viewerContextId,
          sessionState: sessionStateRef.current,
          fallbackSessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pendingMessages: nextPendingMessages }),
        }
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.sessionTree(
          viewerContextId,
          picoSessionScopeKey(sessionStateRef.current)
        ),
        refetchType: "active",
      })
    },
  })

  const editPendingMessage = React.useCallback(
    async (pendingId: string, text: string) => {
      if (!viewerContextId) return

      const previous = pendingMessagesRef.current
      const existing = previous.find((entry) => entry.pendingId === pendingId)
      if (!existing) return

      if (!text.trim() && existing.images.length === 0) {
        toast.error("Enter a message or keep at least one image")
        return
      }

      const next = previous.map((entry) =>
        entry.pendingId === pendingId ? { ...entry, text } : entry
      )
      updatePendingMessages((current) =>
        current.map((entry) =>
          entry.pendingId === pendingId ? { ...entry, text } : entry
        )
      )

      try {
        await editPendingMessagesMutation.mutateAsync(next)
      } catch (error) {
        updatePendingMessages(() => previous)
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update pending prompt"
        )
      }
    },
    [
      editPendingMessagesMutation,
      pendingMessagesRef,
      updatePendingMessages,
      viewerContextId,
    ]
  )

  const removePendingMessageMutation = useMutation({
    mutationFn: async (pendingId: string) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<PendingMessageRemoveResponse>(
        buildCurrentSessionRequestUrl("/api/pending-message/remove", {
          contextId: viewerContextId,
          sessionState: sessionStateRef.current,
          fallbackSessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pendingId }),
        }
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.sessionTree(
          viewerContextId,
          picoSessionScopeKey(sessionStateRef.current)
        ),
        refetchType: "active",
      })
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

  const reorderPending = React.useCallback(
    async (pendingId: string, direction: -1 | 1) => {
      if (!viewerContextId) return
      const previous = pendingMessagesRef.current
      const next = movePendingComposerMessage(previous, pendingId, direction)
      if (!next) return

      updatePendingMessages(() => next)

      try {
        await editPendingMessagesMutation.mutateAsync(next)
      } catch (error) {
        updatePendingMessages(() => previous)
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update pending prompts"
        )
      }
    },
    [
      editPendingMessagesMutation,
      pendingMessagesRef,
      updatePendingMessages,
      viewerContextId,
    ]
  )

  return {
    abortSession,
    addDirectoryPath,
    createSession,
    editPendingMessage,
    removePendingMessage,
    reorderPending,
    submitPrompt,
  }
}
