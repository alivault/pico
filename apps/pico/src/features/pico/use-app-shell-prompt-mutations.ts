import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/pico/toast"

import type { PromptImage, AgentState, StreamingBehavior } from "@/lib/pico"
import type {
  DirectoryResolveResponse,
  PendingMessagesResponse,
  PromptResponse,
  AgentNewResponse,
  SimpleOkResponse,
} from "@/lib/pico/api"

import { resolveNewAgentCwd } from "@/features/pico/app-shell-common"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  enqueueOfflinePrompt,
  readOfflinePrompts,
  removeOfflinePrompt,
  type OfflinePromptQueueItem,
} from "@/features/pico/offline-prompt-queue"
import { picoQueryKeys, picoAgentScopeKey } from "@/features/pico/query-keys"
import {
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import {
  buildComposerPromptMessage,
  serializeComposerDraft,
} from "@/features/pico/composer-utils"
import type { ComposerLineComment } from "@/features/pico/app-shell-composer-state"
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
type AgentNewData = Extract<AgentNewResponse, { ok: true }>

type NewAgentPromptTarget = {
  ownerKey: string
  agentKey: string
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
  optimisticSidebarAgentId?: string
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

type AgentStateStore = PicoStore<AgentState>

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
  activeAgentId?: string
  defaultNewAgentDirectory?: string
  agentStore: AgentStateStore
  agentStateRef: React.RefObject<AgentState>
  draftAgentLoadingOwnerKey: string | null
  pendingDraftPrompt: PendingDraftPrompt | null
  pendingDraftFollowUps: Array<PendingDraftFollowUp>
  awaitingFirstTurn: boolean
  pendingMessages: Array<PendingComposerMessage>
  composerLineCommentsRef: React.RefObject<Array<ComposerLineComment>>
  composerImagesRef: React.RefObject<Array<PromptImage>>
  composerTextRef: React.RefObject<string>
  composerSkillRef: React.RefObject<string | undefined>
  replaceComposerDraft: (
    value: string,
    target?: AgentState,
    options?: {
      forceSync?: boolean
    }
  ) => void
  lastSyncedEditorTextRef: React.RefObject<string>
  rememberRecentDirectory: (directory: string) => void
  prefetchDirectoryAgentsIndex: (directory: string) => void
  addOptimisticUserMessage: (options: {
    message: string
    images: Array<PromptImage>
    queued: boolean
    streamingBehavior?: StreamingBehavior
  }) => string
  removeOptimisticUserMessage: (pendingId: string | undefined) => void
  addOptimisticSidebarAgent: (options?: {
    id?: string
    cwd?: string
    lastMessagePreview?: string
  }) => string | undefined
  removeOptimisticSidebarAgent: (optimisticId: string | undefined) => void
  bindOptimisticSidebarAgent: (
    optimisticId: string | undefined,
    agent: { agentId?: string; agentPath?: string }
  ) => void
  updateOptimisticSidebarAgentPreview: (options: {
    preview: string
    optimisticSidebarAgentId?: string
  }) => void
  setSidebarDirectories: React.Dispatch<React.SetStateAction<Array<string>>>
  setStoredDraftDirectory: React.Dispatch<React.SetStateAction<string>>
  setDraftAgentLoadingOwnerKey: React.Dispatch<
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
  setComposerLineComments: React.Dispatch<
    React.SetStateAction<Array<ComposerLineComment>>
  >
  setComposerImages: React.Dispatch<React.SetStateAction<Array<PromptImage>>>
}

type PromptMutationAgentSnapshot = {
  assistantOutputSignature: string
  cwd?: string
  draft: boolean
  agentFile?: string
  agentId?: string
  agentKey?: string
  streaming: boolean
}

function samePromptMutationAgentSnapshot(
  left: PromptMutationAgentSnapshot,
  right: PromptMutationAgentSnapshot
) {
  return (
    left.assistantOutputSignature === right.assistantOutputSignature &&
    left.cwd === right.cwd &&
    left.draft === right.draft &&
    left.agentFile === right.agentFile &&
    left.agentId === right.agentId &&
    left.agentKey === right.agentKey &&
    left.streaming === right.streaming
  )
}

function agentAssistantOutputSignature(items: AgentState["items"]) {
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

function usePromptMutationAgentSnapshot(store: AgentStateStore) {
  return useSelector(
    store,
    (agentState) => ({
      assistantOutputSignature: agentAssistantOutputSignature(agentState.items),
      cwd: agentState.cwd,
      draft: agentState.draft,
      agentFile: agentState.agentFile,
      agentId: agentState.agentId,
      agentKey: agentState.agentKey,
      streaming: agentState.streaming,
    }),
    { compare: samePromptMutationAgentSnapshot }
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

function buildCurrentAgentRequestUrl(
  path: string,
  {
    machineId,
    contextId,
    agentState,
    fallbackAgentId,
    targetAgentKey,
  }: {
    machineId: string
    contextId: string
    agentState: AgentState
    fallbackAgentId?: string
    targetAgentKey?: string
  }
) {
  if (targetAgentKey) {
    return buildRequestUrl(path, {
      machineId,
      contextId,
      searchParams: { agentKey: targetAgentKey },
    })
  }

  const agentKey =
    agentState.agentKey && !agentState.agentKey.startsWith("optimistic:")
      ? agentState.agentKey
      : undefined
  // Drafts do not expose a stable agent id yet. During a new-agent
  // transition, callbacks can still carry the previous route agent id as a
  // fallback; never use that previous id while the current snapshot is a draft.
  const shouldUseAgentKey = Boolean(
    agentKey && (agentState.draft || !agentState.agentId)
  )
  const agentId =
    shouldUseAgentKey || agentState.draft
      ? undefined
      : (agentState.agentId ?? fallbackAgentId)

  return buildRequestUrl(path, {
    machineId,
    contextId,
    agentId,
    searchParams: shouldUseAgentKey ? { agentKey } : undefined,
  })
}

function buildOfflinePromptRequestUrl(
  machineId: string,
  item: OfflinePromptQueueItem
) {
  return buildRequestUrl("/api/prompt", {
    machineId,
    contextId: item.contextId,
    agentId: item.targetAgentKey ? undefined : item.agentId,
    searchParams: item.targetAgentKey
      ? { agentKey: item.targetAgentKey }
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
  activeAgentId,
  defaultNewAgentDirectory,
  agentStore,
  agentStateRef,
  draftAgentLoadingOwnerKey,
  pendingDraftPrompt,
  pendingDraftFollowUps,
  awaitingFirstTurn,
  pendingMessages,
  composerLineCommentsRef,
  composerImagesRef,
  composerTextRef,
  composerSkillRef,
  replaceComposerDraft,
  lastSyncedEditorTextRef,
  rememberRecentDirectory,
  prefetchDirectoryAgentsIndex,
  addOptimisticUserMessage,
  removeOptimisticUserMessage,
  addOptimisticSidebarAgent,
  removeOptimisticSidebarAgent,
  bindOptimisticSidebarAgent,
  updateOptimisticSidebarAgentPreview,
  setSidebarDirectories,
  setStoredDraftDirectory,
  setDraftAgentLoadingOwnerKey,
  setPendingDraftPrompt,
  setPendingDraftFollowUps,
  setPendingMessages,
  setAwaitingFirstTurn,
  setIsSubmitting,
  setComposerLineComments,
  setComposerImages,
}: UseAppShellPromptMutationsOptions) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const draftAgentLoadingOwnerKeyRef = React.useRef(draftAgentLoadingOwnerKey)
  const pendingNewAgentPromptTargetRef =
    React.useRef<NewAgentPromptTarget | null>(null)
  const newAgentRequestNonceRef = React.useRef(0)
  const pendingDraftPromptRef = React.useRef(pendingDraftPrompt)
  const pendingDraftFollowUpsRef = React.useRef(pendingDraftFollowUps)
  const pendingMessagesRef = React.useRef(pendingMessages)
  const awaitingFirstTurnRef = React.useRef(awaitingFirstTurn)
  const awaitingFirstTurnAssistantOutputSignatureRef = React.useRef<
    string | null
  >(null)
  const agentSnapshot = usePromptMutationAgentSnapshot(agentStore)
  const flushPendingDraftPromptRef = React.useRef<
    (ownerKey: string, targetAgentKey?: string) => Promise<boolean>
  >(async () => false)

  React.useEffect(() => {
    draftAgentLoadingOwnerKeyRef.current = draftAgentLoadingOwnerKey
  }, [draftAgentLoadingOwnerKey])

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
          agentId: activeAgentId,
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
        queryKey: picoQueryKeys.directoryAgentsIndex(
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
      removeOptimisticSidebarAgent(nextPrompt.optimisticSidebarAgentId)
      for (const followUp of pendingDraftFollowUpsRef.current) {
        removeOptimisticUserMessage(followUp.optimisticId)
      }

      pendingNewAgentPromptTargetRef.current = null
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
      removeOptimisticSidebarAgent,
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
        prefetchDirectoryAgentsIndex(response.path)
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
      prefetchDirectoryAgentsIndex,
      rememberRecentDirectory,
      setSidebarDirectories,
      viewerContextId,
    ]
  )

  const createAgentRequest = React.useCallback(
    async ({ cwd }: { cwd?: string }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<AgentNewData>(
        buildCurrentAgentRequestUrl("/api/agent/new", {
          machineId,
          contextId: viewerContextId,
          agentState: agentStateRef.current,
          fallbackAgentId: activeAgentId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd }),
        }
      )
    },
    [activeAgentId, agentStateRef, viewerContextId]
  )

  const createAgent = React.useCallback(
    async (cwdOverride?: string) => {
      if (!viewerContextId) return false

      const nextCwd = resolveNewAgentCwd({
        cwdOverride,
        defaultDirectory: defaultNewAgentDirectory,
        currentCwd: agentStateRef.current.cwd,
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
      draftAgentLoadingOwnerKeyRef.current = ownerKey
      setDraftAgentLoadingOwnerKey(ownerKey)
      awaitingFirstTurnAssistantOutputSignatureRef.current = null
      awaitingFirstTurnRef.current = false
      setAwaitingFirstTurn(false)
      pendingMessagesRef.current = []
      setPendingMessages((current) => (current.length === 0 ? current : []))

      const requestNonce = newAgentRequestNonceRef.current + 1
      newAgentRequestNonceRef.current = requestNonce

      try {
        const response = await createAgentRequest({ cwd: nextCwd })
        if (newAgentRequestNonceRef.current !== requestNonce) {
          return true
        }

        pendingNewAgentPromptTargetRef.current = {
          ownerKey,
          agentKey: response.agentKey,
          cwd: response.cwd,
        }
        if (draftAgentLoadingOwnerKeyRef.current === ownerKey) {
          draftAgentLoadingOwnerKeyRef.current = null
          setDraftAgentLoadingOwnerKey((current) =>
            current === ownerKey ? null : current
          )
        }
        if (pendingDraftPromptRef.current?.ownerKey === ownerKey) {
          void flushPendingDraftPromptRef.current(ownerKey, response.agentKey)
        }
        return true
      } catch (error) {
        if (newAgentRequestNonceRef.current !== requestNonce) {
          return true
        }

        if (draftAgentLoadingOwnerKeyRef.current === ownerKey) {
          draftAgentLoadingOwnerKeyRef.current = null
        }
        setDraftAgentLoadingOwnerKey((current) =>
          current === ownerKey ? null : current
        )
        if (pendingNewAgentPromptTargetRef.current?.ownerKey === ownerKey) {
          pendingNewAgentPromptTargetRef.current = null
        }
        restorePendingDraftPrompt(ownerKey)
        toast.error(
          error instanceof Error ? error.message : "Failed to create agent"
        )
        return false
      }
    },
    [
      createAgentRequest,
      defaultNewAgentDirectory,
      rememberRecentDirectory,
      restorePendingDraftPrompt,
      agentStateRef,
      setAwaitingFirstTurn,
      setDraftAgentLoadingOwnerKey,
      setPendingMessages,
      setStoredDraftDirectory,
      viewerContextId,
    ]
  )

  const queuePendingDraftPrompt = React.useCallback(
    (streamingBehavior?: StreamingBehavior, ownerKeyOverride?: string) => {
      const ownerKey = ownerKeyOverride || draftAgentLoadingOwnerKeyRef.current
      if (!ownerKey) return false

      const message = buildComposerPromptMessage({
        text: composerTextRef.current,
        skillName: composerSkillRef.current,
        lineComments: composerLineCommentsRef.current,
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
        const optimisticSidebarAgentId = addOptimisticSidebarAgent({
          lastMessagePreview: sidebarPreview,
        })
        const nextPrompt = {
          ownerKey,
          message,
          images,
          streamingBehavior,
          optimisticId,
          optimisticSidebarAgentId,
        } satisfies PendingDraftPrompt
        pendingDraftPromptRef.current = nextPrompt
        setPendingDraftPrompt(nextPrompt)
        awaitingFirstTurnRef.current = true
        setAwaitingFirstTurn(true)
        toast.info("Prompt will send when the new agent is ready.")
      } else {
        const queuedStreamingBehavior =
          normalizeQueuedStreamingBehavior(streamingBehavior)
        const optimisticId = createLocalPendingId()
        updateOptimisticSidebarAgentPreview({
          ...(currentPendingPrompt.optimisticSidebarAgentId
            ? {
                optimisticSidebarAgentId:
                  currentPendingPrompt.optimisticSidebarAgentId,
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
      setComposerLineComments([])
      setComposerImages([])
      lastSyncedEditorTextRef.current = ""

      return true
    },
    [
      addOptimisticSidebarAgent,
      addOptimisticUserMessage,
      composerLineCommentsRef,
      composerImagesRef,
      composerSkillRef,
      composerTextRef,
      lastSyncedEditorTextRef,
      replaceComposerDraft,
      setAwaitingFirstTurn,
      setComposerLineComments,
      setComposerImages,
      setPendingDraftFollowUps,
      setPendingDraftPrompt,
      updateOptimisticSidebarAgentPreview,
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
      targetAgentKey,
      draftTarget,
    }: {
      message: string
      images: Array<PromptImage>
      streamingBehavior?: StreamingBehavior
      pendingId?: string
      clientRequestId?: string
      thinkingLevel?: string
      targetAgentKey?: string
      draftTarget?: PromptDraftTargetContext
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<PromptResponse>(
        buildCurrentAgentRequestUrl("/api/prompt", {
          machineId,
          contextId: viewerContextId,
          agentState: agentStateRef.current,
          fallbackAgentId: activeAgentId,
          targetAgentKey,
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
        queryKey: picoQueryKeys.agentTree(
          viewerContextId,
          picoAgentScopeKey(agentStateRef.current)
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
        optimisticSidebarAgentId?: string
        targetAgentKey?: string
        targetDraftOwnerKey?: string
        targetDraftCwd?: string
      }
    ) => {
      if (!viewerContextId) return false
      if (draftAgentLoadingOwnerKeyRef.current) {
        return queuePendingDraftPrompt(streamingBehavior)
      }

      const submittedLineComments = composerLineCommentsRef.current.map(
        (comment) => ({ ...comment })
      )
      const message = buildComposerPromptMessage({
        text: composerTextRef.current,
        skillName: composerSkillRef.current,
        lineComments: submittedLineComments,
      }).trim()
      if (!message && composerImagesRef.current.length === 0) return false

      const currentAgentState = agentStateRef.current
      const pendingNewAgentPromptTarget = pendingNewAgentPromptTargetRef.current
      const currentDraftOwnerKey = currentAgentState.draft
        ? promptDraftKey(currentAgentState)
        : ""
      const implicitTargetAgentKey =
        !options?.targetAgentKey &&
        currentAgentState.draft &&
        pendingNewAgentPromptTarget &&
        promptDraftKeyMatchesOwner(
          currentDraftOwnerKey,
          pendingNewAgentPromptTarget.ownerKey
        )
          ? pendingNewAgentPromptTarget.agentKey
          : undefined
      const targetAgentKey = options?.targetAgentKey || implicitTargetAgentKey
      const targetDraft = currentAgentState.draft
        ? {
            ownerKey:
              options?.targetDraftOwnerKey ||
              (targetAgentKey &&
              pendingNewAgentPromptTarget?.agentKey === targetAgentKey
                ? pendingNewAgentPromptTarget.ownerKey
                : currentDraftOwnerKey),
            cwd:
              options?.targetDraftCwd ||
              (targetAgentKey &&
              pendingNewAgentPromptTarget?.agentKey === targetAgentKey
                ? pendingNewAgentPromptTarget.cwd || currentAgentState.cwd
                : currentAgentState.cwd),
          }
        : undefined

      if (
        currentAgentState.draft &&
        currentAgentState.agentKey?.startsWith("optimistic:") &&
        !targetAgentKey
      ) {
        if (!draftAgentLoadingOwnerKeyRef.current && currentDraftOwnerKey) {
          draftAgentLoadingOwnerKeyRef.current = currentDraftOwnerKey
          setDraftAgentLoadingOwnerKey(currentDraftOwnerKey)
        }
        return queuePendingDraftPrompt(streamingBehavior, currentDraftOwnerKey)
      }

      const treatAsQueuedPrompt = options?.forceFirstPrompt
        ? false
        : Boolean(
            currentAgentState.streaming ||
            currentAgentState.compacting ||
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
          agentAssistantOutputSignature(currentAgentState.items)
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
      const optimisticSidebarAgentId =
        options?.optimisticSidebarAgentId ??
        (!treatAsQueuedPrompt && currentAgentState.draft
          ? addOptimisticSidebarAgent({
              lastMessagePreview: sidebarPreview,
            })
          : undefined)

      updateOptimisticSidebarAgentPreview({
        ...(optimisticSidebarAgentId ? { optimisticSidebarAgentId } : {}),
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
        setComposerLineComments([])
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
          thinkingLevel: currentAgentState.thinkingLevel,
          targetAgentKey,
          draftTarget: targetDraft,
        })
        if (
          queuedPendingId &&
          "queued" in response &&
          (!response.queued || response.canceled)
        ) {
          removeOptimisticPendingMessage(queuedPendingId)
        }
        // The response names the agent that got the prompt. Move the
        // sidebar placeholder to it now. The state sync can come late or
        // not show the change from draft to agent, and then the
        // placeholder stays next to the real entry.
        if (optimisticSidebarAgentId && "agentId" in response) {
          bindOptimisticSidebarAgent(optimisticSidebarAgentId, {
            agentId: response.agentId,
            agentPath: response.agentPath,
          })
        }
        if (
          targetAgentKey &&
          pendingNewAgentPromptTargetRef.current?.agentKey === targetAgentKey
        ) {
          pendingNewAgentPromptTargetRef.current = null
        }
        if (!shouldOptimisticallyClearComposer) {
          replaceComposerDraft("")
          setComposerLineComments([])
          setComposerImages([])
          lastSyncedEditorTextRef.current = ""
        }
        return true
      } catch (error) {
        const queueAgentKey =
          targetAgentKey ||
          (currentAgentState.agentKey &&
          !currentAgentState.agentKey.startsWith("optimistic:") &&
          (currentAgentState.draft || !currentAgentState.agentId)
            ? currentAgentState.agentKey
            : undefined)
        const queueAgentId = queueAgentKey
          ? undefined
          : (currentAgentState.agentId ?? activeAgentId)
        if (
          isOfflinePromptSubmissionError(error) &&
          (queueAgentKey || queueAgentId)
        ) {
          await enqueueOfflinePrompt(machineId, {
            id: clientRequestId,
            contextId: viewerContextId,
            createdAt: Date.now(),
            agentId: queueAgentId,
            targetAgentKey: queueAgentKey,
            message,
            images: submittedImages.map((image) => ({
              type: "image",
              mimeType: image.mimeType,
              data: image.data,
            })),
            streamingBehavior: normalizedStreamingBehavior,
            pendingId: queuedPendingId,
            clientRequestId,
            thinkingLevel: currentAgentState.thinkingLevel,
            draftOwnerKey: targetDraft?.ownerKey,
            draftCwd: targetDraft?.cwd,
          })
          if (queuedPendingId) {
            removeOptimisticPendingMessage(queuedPendingId)
          }
          removeOptimisticUserMessage(optimisticId)
          removeOptimisticSidebarAgent(optimisticSidebarAgentId)
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
        removeOptimisticSidebarAgent(optimisticSidebarAgentId)
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

          if (!currentDraft && composerLineCommentsRef.current.length === 0) {
            replaceComposerDraft(message)
            setComposerLineComments((current) =>
              current.length === 0
                ? submittedLineComments.map((comment) => ({ ...comment }))
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
      activeAgentId,
      addOptimisticPendingMessage,
      addOptimisticSidebarAgent,
      addOptimisticUserMessage,
      bindOptimisticSidebarAgent,
      composerLineCommentsRef,
      composerImagesRef,
      composerSkillRef,
      composerTextRef,
      lastSyncedEditorTextRef,
      promptMutation,
      queuePendingDraftPrompt,
      agentStateRef,
      removeOptimisticPendingMessage,
      removeOptimisticSidebarAgent,
      removeOptimisticUserMessage,
      replaceComposerDraft,
      setAwaitingFirstTurn,
      setComposerLineComments,
      setComposerImages,
      setDraftAgentLoadingOwnerKey,
      setIsSubmitting,
      updateOptimisticSidebarAgentPreview,
      viewerContextId,
    ]
  )

  const flushPendingDraftFollowUps = React.useCallback(
    async (targetAgentKey?: string, draftTarget?: PromptDraftTargetContext) => {
      if (draftAgentLoadingOwnerKeyRef.current) {
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
            thinkingLevel: agentStateRef.current.thinkingLevel,
            targetAgentKey,
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
      agentStateRef,
      replaceComposerDraft,
      setComposerImages,
      setPendingDraftFollowUps,
    ]
  )

  const flushPendingDraftPrompt = React.useCallback(
    async (ownerKey: string, targetAgentKey?: string) => {
      const nextPrompt = pendingDraftPromptRef.current
      if (
        !nextPrompt ||
        nextPrompt.ownerKey !== ownerKey ||
        draftAgentLoadingOwnerKeyRef.current
      ) {
        return false
      }

      const pendingTarget = pendingNewAgentPromptTargetRef.current
      const resolvedTargetAgentKey =
        targetAgentKey ||
        (pendingTarget?.ownerKey === ownerKey
          ? pendingTarget.agentKey
          : undefined)
      const resolvedDraftTarget = {
        ownerKey,
        cwd: pendingTarget?.cwd || agentStateRef.current.cwd,
      }

      pendingDraftPromptRef.current = null
      setPendingDraftPrompt(null)
      applyPendingDraftPromptToComposer(nextPrompt)
      const sent = await submitPrompt(nextPrompt.streamingBehavior, {
        forceFirstPrompt: true,
        optimisticId: nextPrompt.optimisticId,
        optimisticSidebarAgentId: nextPrompt.optimisticSidebarAgentId,
        targetAgentKey: resolvedTargetAgentKey,
        targetDraftOwnerKey: resolvedDraftTarget.ownerKey,
        targetDraftCwd: resolvedDraftTarget.cwd,
      })
      if (!sent) {
        removeOptimisticSidebarAgent(nextPrompt.optimisticSidebarAgentId)
        for (const followUp of pendingDraftFollowUpsRef.current) {
          removeOptimisticUserMessage(followUp.optimisticId)
        }
        pendingDraftFollowUpsRef.current = []
        setPendingDraftFollowUps([])
        if (pendingNewAgentPromptTargetRef.current?.ownerKey === ownerKey) {
          pendingNewAgentPromptTargetRef.current = null
        }
        return false
      }
      await flushPendingDraftFollowUps(
        resolvedTargetAgentKey,
        resolvedDraftTarget
      )
      if (pendingNewAgentPromptTargetRef.current?.ownerKey === ownerKey) {
        pendingNewAgentPromptTargetRef.current = null
      }
      return true
    },
    [
      applyPendingDraftPromptToComposer,
      flushPendingDraftFollowUps,
      removeOptimisticSidebarAgent,
      removeOptimisticUserMessage,
      setPendingDraftFollowUps,
      setPendingDraftPrompt,
      submitPrompt,
    ]
  )

  flushPendingDraftPromptRef.current = flushPendingDraftPrompt

  React.useEffect(() => {
    if (!draftAgentLoadingOwnerKey) return
    const currentAgentState = agentStateRef.current
    if (currentAgentState.agentKey?.startsWith("optimistic:")) {
      return
    }

    const currentOwnerKey = promptDraftKey(currentAgentState)
    if (
      !currentAgentState.draft ||
      !promptDraftKeyMatchesOwner(currentOwnerKey, draftAgentLoadingOwnerKey)
    ) {
      return
    }

    const targetAgentKey = currentAgentState.agentKey?.startsWith("optimistic:")
      ? undefined
      : currentAgentState.agentKey
    if (targetAgentKey) {
      pendingNewAgentPromptTargetRef.current = {
        ownerKey: draftAgentLoadingOwnerKey,
        agentKey: targetAgentKey,
        cwd: currentAgentState.cwd,
      }
    }

    draftAgentLoadingOwnerKeyRef.current = null
    setDraftAgentLoadingOwnerKey(null)
    if (pendingDraftPromptRef.current?.ownerKey === draftAgentLoadingOwnerKey) {
      void flushPendingDraftPrompt(draftAgentLoadingOwnerKey, targetAgentKey)
    }
  }, [
    draftAgentLoadingOwnerKey,
    flushPendingDraftPrompt,
    agentSnapshot,
    agentStateRef,
    setDraftAgentLoadingOwnerKey,
  ])

  React.useEffect(() => {
    if (!awaitingFirstTurn) return

    const baselineAssistantOutputSignature =
      awaitingFirstTurnAssistantOutputSignatureRef.current
    const assistantOutputStarted =
      baselineAssistantOutputSignature !== null &&
      agentSnapshot.assistantOutputSignature !==
        baselineAssistantOutputSignature

    if (
      agentStateRef.current.streaming ||
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
    agentSnapshot.assistantOutputSignature,
    agentSnapshot.streaming,
    agentStateRef,
    setAwaitingFirstTurn,
  ])

  const abortAgentMutation = useMutation({
    mutationFn: async () => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<SimpleOkResponse>(
        buildCurrentAgentRequestUrl("/api/abort", {
          machineId,
          contextId: viewerContextId,
          agentState: agentStateRef.current,
          fallbackAgentId: activeAgentId,
        }),
        {
          method: "POST",
        }
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.agentTree(
          viewerContextId,
          picoAgentScopeKey(agentStateRef.current)
        ),
        refetchType: "active",
      })
    },
  })

  const abortAgent = React.useCallback(async () => {
    if (!viewerContextId) return
    try {
      await abortAgentMutation.mutateAsync()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to abort agent"
      )
    }
  }, [abortAgentMutation, viewerContextId])

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
        buildCurrentAgentRequestUrl("/api/pending-messages/reorder", {
          machineId,
          contextId: viewerContextId,
          agentState: agentStateRef.current,
          fallbackAgentId: activeAgentId,
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
        queryKey: picoQueryKeys.agentTree(
          viewerContextId,
          picoAgentScopeKey(agentStateRef.current)
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
   * agent, also after a switch to another agent, or null when the queue
   * must stay paused.
   */
  const holdPendingQueue = React.useCallback(async (): Promise<
    (() => void) | null
  > => {
    if (!viewerContextId) return null
    const startUrl = () =>
      buildCurrentAgentRequestUrl("/api/pending-messages/start", {
        machineId,
        contextId: viewerContextId,
        agentState: agentStateRef.current,
        fallbackAgentId: activeAgentId,
      })
    const heldStartUrl = startUrl()
    try {
      const response = await fetchJson<
        PendingMessagesResponse & { wasPaused?: boolean }
      >(
        buildCurrentAgentRequestUrl("/api/pending-messages/hold", {
          machineId,
          contextId: viewerContextId,
          agentState: agentStateRef.current,
          fallbackAgentId: activeAgentId,
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
            // Show the result only while the held agent is still shown.
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
    activeAgentId,
    machineId,
    agentStateRef,
    updatePendingMessages,
    viewerContextId,
  ])

  const startPendingQueueMutation = useMutation({
    mutationFn: async () => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<PendingMessagesResponse>(
        buildCurrentAgentRequestUrl("/api/pending-messages/start", {
          machineId,
          contextId: viewerContextId,
          agentState: agentStateRef.current,
          fallbackAgentId: activeAgentId,
        }),
        { method: "POST" }
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: picoQueryKeys.agentTree(
          viewerContextId,
          picoAgentScopeKey(agentStateRef.current)
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
    abortAgent,
    addDirectoryPath,
    createAgent,
    holdPendingQueue,
    savePendingQueue,
    startPendingQueue,
    submitPrompt,
  }
}
