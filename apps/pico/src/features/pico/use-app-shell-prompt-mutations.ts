import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/pico/toast"

import type { PromptImage, SessionState, StreamingBehavior } from "@/lib/pico"
import type {
  DirectoryResolveResponse,
  PendingMessagesResponse,
  PromptResponse,
  SessionNewResponse,
  SimpleOkResponse,
} from "@/lib/pico/api"

import { resolveNewSessionCwd } from "@/features/pico/app-shell-common"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  enqueueOfflinePrompt,
  readOfflinePrompts,
  removeOfflinePrompt,
  type OfflinePromptQueueItem,
} from "@/features/pico/offline-prompt-queue"
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
  isHeldPendingId,
  type PendingQueueSaveRow,
} from "@/features/pico/pending-queue"
import { MachineOfflineError } from "@/lib/pico/machine"
import {
  DRAFT_DIRECTORY_STORAGE_KEY,
  SIDEBAR_DIRECTORIES_STORAGE_KEY,
  normalizePromptImage,
  normalizeStoredDirectoryList,
  promptDraftKey,
  promptDraftKeyMatchesOwner,
  machineLocalStorageSetItem,
} from "@/lib/pico"
import { useMachineId } from "@/lib/pico/machine-context"

type DirectoryResolveData = Extract<DirectoryResolveResponse, { ok: true }>
type SessionNewData = Extract<SessionNewResponse, { ok: true }>

type NewSessionPromptTarget = {
  ownerKey: string
  sessionKey: string
  cwd?: string
}

type PromptDraftTargetContext = {
  ownerKey?: string
  cwd?: string
}

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

function pendingMessagesFromResponse(
  response: PendingMessagesResponse
): Array<PendingComposerMessage> | null {
  if (!("ok" in response) || !response.ok) return null

  return response.pendingMessages.map((message) => ({
    pendingId: message.pendingId,
    text: message.text,
    images: message.images.flatMap((image) => {
      const normalizedImage = normalizePromptImage(image)
      return normalizedImage ? [normalizedImage] : []
    }),
    streamingBehavior:
      message.streamingBehavior === "steer" ? "steer" : "followUp",
  }))
}

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
    lastMessagePreview?: string
  }) => string | undefined
  removeOptimisticSidebarSession: (optimisticId: string | undefined) => void
  bindOptimisticSidebarSession: (
    optimisticId: string | undefined,
    session: { sessionId?: string; sessionPath?: string }
  ) => void
  updateOptimisticSidebarSessionPreview: (options: {
    preview: string
    optimisticSidebarSessionId?: string
  }) => void
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

function promptSidebarPreview(message: string, images: Array<PromptImage>) {
  const text = message.replace(/\s+/g, " ").trim()
  if (text) return text
  if (images.length === 0) return ""

  return `${images.length.toLocaleString()} image${images.length === 1 ? "" : "s"}`
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

function createClientPromptRequestId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `prompt:${crypto.randomUUID()}`
  }

  return `prompt:${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

function isOfflinePromptSubmissionError(error: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true
  }
  // The machine of the page is offline: keep the prompt until it is back.
  if (error instanceof MachineOfflineError) return true

  const message = error instanceof Error ? error.message.toLowerCase() : ""
  return (
    message === "failed to fetch" ||
    message === "load failed" ||
    message.includes("networkerror") ||
    message.includes("network error")
  )
}

function buildCurrentSessionRequestUrl(
  path: string,
  {
    machineId,
    contextId,
    sessionState,
    fallbackSessionId,
    targetSessionKey,
  }: {
    machineId: string
    contextId: string
    sessionState: SessionState
    fallbackSessionId?: string
    targetSessionKey?: string
  }
) {
  if (targetSessionKey) {
    return buildRequestUrl(path, {
      machineId,
      contextId,
      searchParams: { sessionKey: targetSessionKey },
    })
  }

  const sessionKey =
    sessionState.sessionKey &&
    !sessionState.sessionKey.startsWith("optimistic:")
      ? sessionState.sessionKey
      : undefined
  // Drafts do not expose a stable session id yet. During a new-session
  // transition, callbacks can still carry the previous route session id as a
  // fallback; never use that previous id while the current snapshot is a draft.
  const shouldUseSessionKey = Boolean(
    sessionKey && (sessionState.draft || !sessionState.sessionId)
  )
  const sessionId =
    shouldUseSessionKey || sessionState.draft
      ? undefined
      : (sessionState.sessionId ?? fallbackSessionId)

  return buildRequestUrl(path, {
    machineId,
    contextId,
    sessionId,
    searchParams: shouldUseSessionKey ? { sessionKey } : undefined,
  })
}

function buildOfflinePromptRequestUrl(
  machineId: string,
  item: OfflinePromptQueueItem
) {
  return buildRequestUrl("/api/prompt", {
    machineId,
    contextId: item.contextId,
    sessionId: item.targetSessionKey ? undefined : item.sessionId,
    searchParams: item.targetSessionKey
      ? { sessionKey: item.targetSessionKey }
      : undefined,
  })
}

function buildOfflinePromptBody(item: OfflinePromptQueueItem) {
  return {
    message: item.message,
    images: item.images,
    streamingBehavior: item.streamingBehavior,
    pendingId: item.pendingId,
    clientRequestId: item.clientRequestId,
    thinkingLevel: item.thinkingLevel,
    draftOwnerKey: item.draftOwnerKey,
    draftCwd: item.draftCwd,
  }
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
  bindOptimisticSidebarSession,
  updateOptimisticSidebarSessionPreview,
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
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const draftSessionLoadingOwnerKeyRef = React.useRef(
    draftSessionLoadingOwnerKey
  )
  const pendingNewSessionPromptTargetRef =
    React.useRef<NewSessionPromptTarget | null>(null)
  const newSessionRequestNonceRef = React.useRef(0)
  const pendingDraftPromptRef = React.useRef(pendingDraftPrompt)
  const pendingDraftFollowUpsRef = React.useRef(pendingDraftFollowUps)
  const pendingMessagesRef = React.useRef(pendingMessages)
  const awaitingFirstTurnRef = React.useRef(awaitingFirstTurn)
  const awaitingFirstTurnAssistantOutputSignatureRef = React.useRef<
    string | null
  >(null)
  const sessionSnapshot = usePromptMutationSessionSnapshot(sessionStore)
  const flushPendingDraftPromptRef = React.useRef<
    (ownerKey: string, targetSessionKey?: string) => Promise<boolean>
  >(async () => false)

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

  const addDirectoryMutation = useMutation({
    mutationFn: async (requestedPath: string) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<DirectoryResolveData>(
        buildRequestUrl("/api/directory/resolve", {
          machineId,
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

      pendingNewSessionPromptTargetRef.current = null
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
          machineLocalStorageSetItem(
            machineId,
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

      return await fetchJson<SessionNewData>(
        buildCurrentSessionRequestUrl("/api/session/new", {
          machineId,
          contextId: viewerContextId,
          sessionState: sessionStateRef.current,
          fallbackSessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd }),
        }
      )
    },
    [activeSessionId, sessionStateRef, viewerContextId]
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
        machineLocalStorageSetItem(
          machineId,
          DRAFT_DIRECTORY_STORAGE_KEY,
          nextCwd
        )
        setStoredDraftDirectory(nextCwd)
      }
      const ownerKey = promptDraftKey({ cwd: nextCwd })
      draftSessionLoadingOwnerKeyRef.current = ownerKey
      setDraftSessionLoadingOwnerKey(ownerKey)
      awaitingFirstTurnAssistantOutputSignatureRef.current = null
      awaitingFirstTurnRef.current = false
      setAwaitingFirstTurn(false)
      pendingMessagesRef.current = []
      setPendingMessages((current) => (current.length === 0 ? current : []))

      const requestNonce = newSessionRequestNonceRef.current + 1
      newSessionRequestNonceRef.current = requestNonce

      try {
        const response = await createSessionRequest({ cwd: nextCwd })
        if (newSessionRequestNonceRef.current !== requestNonce) {
          return true
        }

        pendingNewSessionPromptTargetRef.current = {
          ownerKey,
          sessionKey: response.sessionKey,
          cwd: response.cwd,
        }
        if (draftSessionLoadingOwnerKeyRef.current === ownerKey) {
          draftSessionLoadingOwnerKeyRef.current = null
          setDraftSessionLoadingOwnerKey((current) =>
            current === ownerKey ? null : current
          )
        }
        if (pendingDraftPromptRef.current?.ownerKey === ownerKey) {
          void flushPendingDraftPromptRef.current(ownerKey, response.sessionKey)
        }
        return true
      } catch (error) {
        if (newSessionRequestNonceRef.current !== requestNonce) {
          return true
        }

        if (draftSessionLoadingOwnerKeyRef.current === ownerKey) {
          draftSessionLoadingOwnerKeyRef.current = null
        }
        setDraftSessionLoadingOwnerKey((current) =>
          current === ownerKey ? null : current
        )
        if (pendingNewSessionPromptTargetRef.current?.ownerKey === ownerKey) {
          pendingNewSessionPromptTargetRef.current = null
        }
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
      setAwaitingFirstTurn,
      setDraftSessionLoadingOwnerKey,
      setPendingMessages,
      setStoredDraftDirectory,
      viewerContextId,
    ]
  )

  const queuePendingDraftPrompt = React.useCallback(
    (streamingBehavior?: StreamingBehavior, ownerKeyOverride?: string) => {
      const ownerKey =
        ownerKeyOverride || draftSessionLoadingOwnerKeyRef.current
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

      const sidebarPreview = promptSidebarPreview(message, images)

      if (!currentPendingPrompt) {
        const optimisticId = addOptimisticUserMessage({
          message,
          images,
          queued: false,
        })
        const optimisticSidebarSessionId = addOptimisticSidebarSession({
          lastMessagePreview: sidebarPreview,
        })
        const nextPrompt = {
          ownerKey,
          message,
          images,
          streamingBehavior,
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
        updateOptimisticSidebarSessionPreview({
          ...(currentPendingPrompt.optimisticSidebarSessionId
            ? {
                optimisticSidebarSessionId:
                  currentPendingPrompt.optimisticSidebarSessionId,
              }
            : {}),
          preview: sidebarPreview,
        })
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
      updateOptimisticSidebarSessionPreview,
    ]
  )

  const promptMutation = useMutation({
    mutationFn: async ({
      message,
      images,
      streamingBehavior,
      pendingId,
      clientRequestId,
      thinkingLevel,
      targetSessionKey,
      draftTarget,
    }: {
      message: string
      images: Array<PromptImage>
      streamingBehavior?: StreamingBehavior
      pendingId?: string
      clientRequestId?: string
      thinkingLevel?: string
      targetSessionKey?: string
      draftTarget?: PromptDraftTargetContext
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<PromptResponse>(
        buildCurrentSessionRequestUrl("/api/prompt", {
          machineId,
          contextId: viewerContextId,
          sessionState: sessionStateRef.current,
          fallbackSessionId: activeSessionId,
          targetSessionKey,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message,
            images,
            streamingBehavior,
            pendingId,
            clientRequestId,
            thinkingLevel,
            draftOwnerKey: draftTarget?.ownerKey,
            draftCwd: draftTarget?.cwd,
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

  const offlinePromptFlushInFlightRef = React.useRef(false)
  const offlinePromptFailureToastIdsRef = React.useRef<Set<string>>(new Set())
  const flushOfflinePromptQueue = React.useCallback(async () => {
    if (!viewerContextId || offlinePromptFlushInFlightRef.current) return
    if (typeof navigator !== "undefined" && navigator.onLine === false) return

    offlinePromptFlushInFlightRef.current = true
    try {
      // The prompts of a machine go only to that machine.
      const queuedPrompts = await readOfflinePrompts(machineId, viewerContextId)
      if (queuedPrompts.length === 0) return

      let flushedCount = 0
      for (const item of queuedPrompts) {
        try {
          await fetchJson<PromptResponse>(
            buildOfflinePromptRequestUrl(machineId, item),
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(buildOfflinePromptBody(item)),
            }
          )
          await removeOfflinePrompt(machineId, item.id)
          offlinePromptFailureToastIdsRef.current.delete(item.id)
          flushedCount += 1
        } catch (error) {
          if (isOfflinePromptSubmissionError(error)) break
          if (!offlinePromptFailureToastIdsRef.current.has(item.id)) {
            offlinePromptFailureToastIdsRef.current.add(item.id)
            toast.error(
              error instanceof Error
                ? `Failed to send queued prompt: ${error.message}`
                : "Failed to send queued prompt"
            )
          }
          break
        }
      }

      if (flushedCount > 0) {
        toast.success(
          flushedCount === 1
            ? "Sent queued prompt"
            : `Sent ${flushedCount.toLocaleString()} queued prompts`
        )
        await queryClient.invalidateQueries({ refetchType: "active" })
      }
    } finally {
      offlinePromptFlushInFlightRef.current = false
    }
  }, [machineId, queryClient, viewerContextId])

  React.useEffect(() => {
    if (!viewerContextId) return

    const flush = () => {
      void flushOfflinePromptQueue()
    }

    window.addEventListener("online", flush)
    window.addEventListener("focus", flush)
    document.addEventListener("visibilitychange", flush)
    const timer = window.setInterval(flush, 30_000)
    flush()

    return () => {
      window.removeEventListener("online", flush)
      window.removeEventListener("focus", flush)
      document.removeEventListener("visibilitychange", flush)
      window.clearInterval(timer)
    }
  }, [flushOfflinePromptQueue, viewerContextId])

  const submitPrompt = React.useCallback(
    async (
      streamingBehavior?: StreamingBehavior,
      options?: {
        forceFirstPrompt?: boolean
        optimisticId?: string
        optimisticSidebarSessionId?: string
        targetSessionKey?: string
        targetDraftOwnerKey?: string
        targetDraftCwd?: string
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

      const currentSessionState = sessionStateRef.current
      const pendingNewSessionPromptTarget =
        pendingNewSessionPromptTargetRef.current
      const currentDraftOwnerKey = currentSessionState.draft
        ? promptDraftKey(currentSessionState)
        : ""
      const implicitTargetSessionKey =
        !options?.targetSessionKey &&
        currentSessionState.draft &&
        pendingNewSessionPromptTarget &&
        promptDraftKeyMatchesOwner(
          currentDraftOwnerKey,
          pendingNewSessionPromptTarget.ownerKey
        )
          ? pendingNewSessionPromptTarget.sessionKey
          : undefined
      const targetSessionKey =
        options?.targetSessionKey || implicitTargetSessionKey
      const targetDraft = currentSessionState.draft
        ? {
            ownerKey:
              options?.targetDraftOwnerKey ||
              (targetSessionKey &&
              pendingNewSessionPromptTarget?.sessionKey === targetSessionKey
                ? pendingNewSessionPromptTarget.ownerKey
                : currentDraftOwnerKey),
            cwd:
              options?.targetDraftCwd ||
              (targetSessionKey &&
              pendingNewSessionPromptTarget?.sessionKey === targetSessionKey
                ? pendingNewSessionPromptTarget.cwd || currentSessionState.cwd
                : currentSessionState.cwd),
          }
        : undefined

      if (
        currentSessionState.draft &&
        currentSessionState.sessionKey?.startsWith("optimistic:") &&
        !targetSessionKey
      ) {
        if (!draftSessionLoadingOwnerKeyRef.current && currentDraftOwnerKey) {
          draftSessionLoadingOwnerKeyRef.current = currentDraftOwnerKey
          setDraftSessionLoadingOwnerKey(currentDraftOwnerKey)
        }
        return queuePendingDraftPrompt(streamingBehavior, currentDraftOwnerKey)
      }

      const treatAsQueuedPrompt = options?.forceFirstPrompt
        ? false
        : Boolean(
            currentSessionState.streaming ||
            currentSessionState.compacting ||
            awaitingFirstTurnRef.current
          )
      const normalizedStreamingBehavior = treatAsQueuedPrompt
        ? normalizeQueuedStreamingBehavior(streamingBehavior)
        : undefined
      const submittedImages = composerImagesRef.current.map((image) => ({
        ...image,
      }))
      const shouldOptimisticallyClearComposer = true
      const sidebarPreview = promptSidebarPreview(message, submittedImages)
      const queuedPendingId = treatAsQueuedPrompt
        ? createLocalPendingId()
        : undefined

      if (!treatAsQueuedPrompt) {
        awaitingFirstTurnAssistantOutputSignatureRef.current =
          sessionAssistantOutputSignature(currentSessionState.items)
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
        (!treatAsQueuedPrompt && currentSessionState.draft
          ? addOptimisticSidebarSession({
              lastMessagePreview: sidebarPreview,
            })
          : undefined)

      updateOptimisticSidebarSessionPreview({
        ...(optimisticSidebarSessionId ? { optimisticSidebarSessionId } : {}),
        preview: sidebarPreview,
      })

      if (queuedPendingId && normalizedStreamingBehavior) {
        addOptimisticPendingMessage({
          pendingId: queuedPendingId,
          text: message,
          images: submittedImages.map((image) => ({ ...image })),
          streamingBehavior: normalizedStreamingBehavior,
        })
      }

      const clientRequestId = createClientPromptRequestId()

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
          clientRequestId,
          thinkingLevel: currentSessionState.thinkingLevel,
          targetSessionKey,
          draftTarget: targetDraft,
        })
        if (
          queuedPendingId &&
          "queued" in response &&
          (!response.queued || response.canceled)
        ) {
          removeOptimisticPendingMessage(queuedPendingId)
        }
        // The response names the session that got the prompt. Move the
        // sidebar placeholder to it now. The state sync can come late or
        // not show the change from draft to session, and then the
        // placeholder stays next to the real entry.
        if (optimisticSidebarSessionId && "sessionId" in response) {
          bindOptimisticSidebarSession(optimisticSidebarSessionId, {
            sessionId: response.sessionId,
            sessionPath: response.sessionPath,
          })
        }
        if (
          targetSessionKey &&
          pendingNewSessionPromptTargetRef.current?.sessionKey ===
            targetSessionKey
        ) {
          pendingNewSessionPromptTargetRef.current = null
        }
        if (!shouldOptimisticallyClearComposer) {
          replaceComposerDraft("")
          setComposerDiffLineComments([])
          setComposerImages([])
          lastSyncedEditorTextRef.current = ""
        }
        return true
      } catch (error) {
        const queueSessionKey =
          targetSessionKey ||
          (currentSessionState.sessionKey &&
          !currentSessionState.sessionKey.startsWith("optimistic:") &&
          (currentSessionState.draft || !currentSessionState.sessionId)
            ? currentSessionState.sessionKey
            : undefined)
        const queueSessionId = queueSessionKey
          ? undefined
          : (currentSessionState.sessionId ?? activeSessionId)
        if (
          isOfflinePromptSubmissionError(error) &&
          (queueSessionKey || queueSessionId)
        ) {
          await enqueueOfflinePrompt(machineId, {
            id: clientRequestId,
            contextId: viewerContextId,
            createdAt: Date.now(),
            sessionId: queueSessionId,
            targetSessionKey: queueSessionKey,
            message,
            images: submittedImages.map((image) => ({
              type: "image",
              mimeType: image.mimeType,
              data: image.data,
            })),
            streamingBehavior: normalizedStreamingBehavior,
            pendingId: queuedPendingId,
            clientRequestId,
            thinkingLevel: currentSessionState.thinkingLevel,
            draftOwnerKey: targetDraft?.ownerKey,
            draftCwd: targetDraft?.cwd,
          })
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
          toast.info("Prompt queued locally and will send when reconnected")
          return true
        }

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
      activeSessionId,
      addOptimisticPendingMessage,
      addOptimisticSidebarSession,
      addOptimisticUserMessage,
      bindOptimisticSidebarSession,
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
      setDraftSessionLoadingOwnerKey,
      setIsSubmitting,
      updateOptimisticSidebarSessionPreview,
      viewerContextId,
    ]
  )

  const flushPendingDraftFollowUps = React.useCallback(
    async (
      targetSessionKey?: string,
      draftTarget?: PromptDraftTargetContext
    ) => {
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
            clientRequestId: createClientPromptRequestId(),
            thinkingLevel: sessionStateRef.current.thinkingLevel,
            targetSessionKey,
            draftTarget,
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
    },
    [
      composerTextRef,
      promptMutation,
      removeOptimisticUserMessage,
      sessionStateRef,
      replaceComposerDraft,
      setComposerImages,
      setPendingDraftFollowUps,
    ]
  )

  const flushPendingDraftPrompt = React.useCallback(
    async (ownerKey: string, targetSessionKey?: string) => {
      const nextPrompt = pendingDraftPromptRef.current
      if (
        !nextPrompt ||
        nextPrompt.ownerKey !== ownerKey ||
        draftSessionLoadingOwnerKeyRef.current
      ) {
        return false
      }

      const pendingTarget = pendingNewSessionPromptTargetRef.current
      const resolvedTargetSessionKey =
        targetSessionKey ||
        (pendingTarget?.ownerKey === ownerKey
          ? pendingTarget.sessionKey
          : undefined)
      const resolvedDraftTarget = {
        ownerKey,
        cwd: pendingTarget?.cwd || sessionStateRef.current.cwd,
      }

      pendingDraftPromptRef.current = null
      setPendingDraftPrompt(null)
      applyPendingDraftPromptToComposer(nextPrompt)
      const sent = await submitPrompt(nextPrompt.streamingBehavior, {
        forceFirstPrompt: true,
        optimisticId: nextPrompt.optimisticId,
        optimisticSidebarSessionId: nextPrompt.optimisticSidebarSessionId,
        targetSessionKey: resolvedTargetSessionKey,
        targetDraftOwnerKey: resolvedDraftTarget.ownerKey,
        targetDraftCwd: resolvedDraftTarget.cwd,
      })
      if (!sent) {
        removeOptimisticSidebarSession(nextPrompt.optimisticSidebarSessionId)
        for (const followUp of pendingDraftFollowUpsRef.current) {
          removeOptimisticUserMessage(followUp.optimisticId)
        }
        pendingDraftFollowUpsRef.current = []
        setPendingDraftFollowUps([])
        if (pendingNewSessionPromptTargetRef.current?.ownerKey === ownerKey) {
          pendingNewSessionPromptTargetRef.current = null
        }
        return false
      }
      await flushPendingDraftFollowUps(
        resolvedTargetSessionKey,
        resolvedDraftTarget
      )
      if (pendingNewSessionPromptTargetRef.current?.ownerKey === ownerKey) {
        pendingNewSessionPromptTargetRef.current = null
      }
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

  flushPendingDraftPromptRef.current = flushPendingDraftPrompt

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

    const targetSessionKey = currentSessionState.sessionKey?.startsWith(
      "optimistic:"
    )
      ? undefined
      : currentSessionState.sessionKey
    if (targetSessionKey) {
      pendingNewSessionPromptTargetRef.current = {
        ownerKey: draftSessionLoadingOwnerKey,
        sessionKey: targetSessionKey,
        cwd: currentSessionState.cwd,
      }
    }

    draftSessionLoadingOwnerKeyRef.current = null
    setDraftSessionLoadingOwnerKey(null)
    if (
      pendingDraftPromptRef.current?.ownerKey === draftSessionLoadingOwnerKey
    ) {
      void flushPendingDraftPrompt(
        draftSessionLoadingOwnerKey,
        targetSessionKey
      )
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
          machineId,
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

  const savePendingQueueMutation = useMutation({
    mutationFn: async ({
      rows,
      removedPendingIds,
      resume,
    }: {
      rows: Array<PendingQueueSaveRow>
      removedPendingIds: Array<string>
      resume: boolean
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<PendingMessagesResponse & { missed?: number }>(
        buildCurrentSessionRequestUrl("/api/pending-messages/reorder", {
          machineId,
          contextId: viewerContextId,
          sessionState: sessionStateRef.current,
          fallbackSessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pendingMessages: rows.map((row) =>
              row.pendingId
                ? {
                    pendingId: row.pendingId,
                    text: row.text,
                    ...(row.imagesChanged
                      ? {
                          images: row.images.map(({ mimeType, data }) => ({
                            mimeType,
                            data,
                          })),
                        }
                      : {}),
                    streamingBehavior: row.streamingBehavior,
                  }
                : {
                    text: row.text,
                    images: row.images.map(({ mimeType, data }) => ({
                      mimeType,
                      data,
                    })),
                    streamingBehavior: row.streamingBehavior,
                  }
            ),
            removedPendingIds,
            resume,
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

  /** Save a whole queue edit: text, order, lanes, new rows, and removals. */
  const savePendingQueue = React.useCallback(
    async (
      rows: Array<PendingQueueSaveRow>,
      removedPendingIds: Array<string>,
      resume: boolean
    ) => {
      if (!viewerContextId) return
      if (rows.length === 0 && removedPendingIds.length === 0 && !resume) {
        return
      }

      const previous = pendingMessagesRef.current
      updatePendingMessages(() =>
        rows.map((row) => ({
          pendingId: row.pendingId ?? createLocalPendingId(),
          text: row.text,
          images: row.images,
          streamingBehavior: row.streamingBehavior,
        }))
      )

      try {
        const response = await savePendingQueueMutation.mutateAsync({
          rows,
          removedPendingIds,
          resume,
        })
        const nextPendingMessages = pendingMessagesFromResponse(response)
        if (nextPendingMessages) {
          updatePendingMessages(() => nextPendingMessages)
        }
        const missed = "missed" in response ? (response.missed ?? 0) : 0
        if (missed > 0) {
          toast.warning(
            missed === 1
              ? "1 queued prompt was sent before the save."
              : `${missed} queued prompts were sent before the save.`
          )
        }
      } catch (error) {
        updatePendingMessages(() => previous)
        toast.error(
          error instanceof Error ? error.message : "Failed to update the queue"
        )
      }
    },
    [
      pendingMessagesRef,
      savePendingQueueMutation,
      updatePendingMessages,
      viewerContextId,
    ]
  )

  /**
   * Hold the queue for an edit. Resolves a function that resumes the held
   * session, also after a switch to another session, or null when the queue
   * must stay paused.
   */
  const holdPendingQueue = React.useCallback(async (): Promise<
    (() => void) | null
  > => {
    if (!viewerContextId) return null
    const startUrl = () =>
      buildCurrentSessionRequestUrl("/api/pending-messages/start", {
        machineId,
        contextId: viewerContextId,
        sessionState: sessionStateRef.current,
        fallbackSessionId: activeSessionId,
      })
    const heldStartUrl = startUrl()
    try {
      const response = await fetchJson<
        PendingMessagesResponse & { wasPaused?: boolean }
      >(
        buildCurrentSessionRequestUrl("/api/pending-messages/hold", {
          machineId,
          contextId: viewerContextId,
          sessionState: sessionStateRef.current,
          fallbackSessionId: activeSessionId,
        }),
        { method: "POST" }
      )
      const nextPendingMessages = pendingMessagesFromResponse(response)
      if (nextPendingMessages) {
        updatePendingMessages(() => nextPendingMessages)
      }
      const wasPaused = "wasPaused" in response && response.wasPaused === true
      const held =
        nextPendingMessages?.some((message) =>
          isHeldPendingId(message.pendingId)
        ) ?? false
      if (!held || wasPaused) return null
      return () => {
        void fetchJson<PendingMessagesResponse>(heldStartUrl, {
          method: "POST",
        })
          .then((startResponse) => {
            // Show the result only while the held session is still shown.
            if (startUrl() !== heldStartUrl) return
            const startedMessages = pendingMessagesFromResponse(startResponse)
            if (startedMessages) updatePendingMessages(() => startedMessages)
          })
          .catch((error: unknown) => {
            toast.error(
              error instanceof Error ? error.message : "Failed to start queue"
            )
          })
      }
    } catch {
      return null
    }
  }, [
    activeSessionId,
    machineId,
    sessionStateRef,
    updatePendingMessages,
    viewerContextId,
  ])

  const startPendingQueueMutation = useMutation({
    mutationFn: async () => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<PendingMessagesResponse>(
        buildCurrentSessionRequestUrl("/api/pending-messages/start", {
          machineId,
          contextId: viewerContextId,
          sessionState: sessionStateRef.current,
          fallbackSessionId: activeSessionId,
        }),
        { method: "POST" }
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

  const startPendingQueue = React.useCallback(async () => {
    if (!viewerContextId) return
    if (pendingMessagesRef.current.length === 0) return

    setIsSubmitting(true)
    try {
      const response = await startPendingQueueMutation.mutateAsync()
      const nextPendingMessages = pendingMessagesFromResponse(response)
      if (nextPendingMessages) {
        updatePendingMessages(() => nextPendingMessages)
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to start queue"
      )
    } finally {
      setIsSubmitting(false)
    }
  }, [
    pendingMessagesRef,
    setIsSubmitting,
    startPendingQueueMutation,
    updatePendingMessages,
    viewerContextId,
  ])

  return {
    abortSession,
    addDirectoryPath,
    createSession,
    holdPendingQueue,
    savePendingQueue,
    startPendingQueue,
    submitPrompt,
  }
}
