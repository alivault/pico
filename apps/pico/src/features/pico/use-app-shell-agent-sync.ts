import * as React from "react"
import { emitPicoEvent } from "@/features/pico/agent/events"
import {
  handleSidebarStateEvent,
  refreshSidebarState,
} from "@/features/pico/sidebar-sync"
import { Batcher } from "@tanstack/pacer"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/pico/toast"

import type { SelectAgentNavigationOptions } from "@/features/pico/app-shell-types"
import type { PromptImage, AgentState, StateSyncPayload } from "@/lib/pico"
import type {
  ExtensionUiEvent,
  PicoServerEvent,
  AgentDoneEvent,
  AgentListEntry,
  AgentStatusEvent,
  AgentsEvent,
  SimpleOkResponse,
} from "@/lib/pico/api"

import {
  buildRequestUrl,
  fetchJson,
  updateStateFromSync,
} from "@/features/pico/app-shell-utils"
import { serializeComposerDraft } from "@/features/pico/composer-utils"
import { picoQueryKeys } from "@/features/pico/query-keys"
import { hasPendingNewAgentAction } from "@/lib/pico/machine"
import {
  batch,
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import {
  normalizePromptImage,
  promptDraftKey,
  promptDraftKeyMatchesOwner,
  readStoredPromptDraft,
  rememberStoredPromptDraft,
} from "@/lib/pico"
import { LOCAL_MACHINE_ID } from "@/lib/pico/machine"
import { applyConversationDelta, sameContextUsage } from "@/lib/pico/sync"
import {
  isConversationDeltaEvent,
  isGitChangedEvent,
  isAgentDoneEvent,
  isAgentStatusEvent,
  isAgentsEvent,
  isStateSyncEvent,
  uiRequestExpectsResponse,
} from "@/lib/pico/api"
import { useMachineId } from "@/lib/pico/machine-context"
import {
  checkServerConnection,
  markServerOnline,
  onServerReconnect,
} from "@/lib/pico/server-connection"

const RESUME_RECONNECT_AFTER_MS = 30_000
const COMPACT_WORKING_LABEL = "Compacting context..."
const EVENT_SOURCE_LAST_ID_STORAGE_PREFIX = "pico-events-last-id:"

type PendingComposerMessage = {
  pendingId: string
  text: string
  images: Array<PromptImage>
  streamingBehavior: "steer" | "followUp"
}

type AgentStateStore = PicoStore<AgentState>

type SyncedWorkingState = {
  label: string
  summary?: string
  done?: boolean
  cancelable?: boolean
}

type GitInvalidationBatchItem = {
  cwd: string
  scopes: Set<string>
}

type UseAppShellAgentSyncOptions = {
  viewerContextId: string
  agentId?: string
  draftAgentLoadingOwnerKey: string | null
  bootstrapSidebarDirectories: Array<string>
  hideToolBlocksRef: React.RefObject<boolean>
  agentStore: AgentStateStore
  agentStateRef: React.RefObject<AgentState>
  composerTextRef: React.RefObject<string>
  composerSkillRef: React.RefObject<string | undefined>
  replaceComposerDraftRef: React.RefObject<
    (
      value: string,
      target?: AgentState,
      options?: {
        forceSync?: boolean
      }
    ) => void
  >
  handleSelectAgentRef: React.RefObject<
    (nextAgentId?: string, options?: SelectAgentNavigationOptions) => void
  >
  pendingRouteAgentIdRef: React.RefObject<string | undefined>
  pendingRouteAgentPathRef: React.RefObject<string | undefined>
  setAgentState: React.Dispatch<React.SetStateAction<AgentState>>
  setConversationItems: (items: AgentState["items"]) => void
  setWorkingState: (state: SyncedWorkingState | null) => void
  setCompactRunningState: (running: boolean) => void
  setComposerContextUsage: (contextUsage: AgentState["contextUsage"]) => void
  setComposerStreaming: (streaming: boolean) => void
  setAgentsEvent: React.Dispatch<React.SetStateAction<AgentsEvent | null>>
  setAgentDoneEvents: React.Dispatch<
    React.SetStateAction<Array<AgentDoneEvent>>
  >
  applySidebarAgentStatusRef: React.RefObject<
    (status: AgentStatusEvent) => void
  >
  bindOptimisticSidebarAgentRef: React.RefObject<
    (agent: { cwd?: string; agentId?: string; agentPath?: string }) => void
  >
  setComposerImages: React.Dispatch<React.SetStateAction<Array<PromptImage>>>
  setPendingMessages: React.Dispatch<
    React.SetStateAction<Array<PendingComposerMessage>>
  >
  pendingUiRequestHandlerRef: React.RefObject<
    (request: ExtensionUiEvent) => void
  >
  dismissUiRequestRef: React.RefObject<(id: string) => void>
  lastSyncedEditorTextRef: React.RefObject<string>
}

/** Each machine has its own event sequence, so its own last ID. */
function eventsLastIdStorageKey(machine: string, viewerContextId: string) {
  return `${EVENT_SOURCE_LAST_ID_STORAGE_PREFIX}${viewerContextId}${machine === LOCAL_MACHINE_ID ? "" : `@${machine}`}`
}

function readStoredEventsLastId(machineId: string, viewerContextId: string) {
  try {
    return window.sessionStorage.getItem(
      eventsLastIdStorageKey(machineId, viewerContextId)
    )
  } catch {
    return null
  }
}

function rememberStoredEventsLastId(
  machineId: string,
  viewerContextId: string,
  lastEventId: string
) {
  try {
    window.sessionStorage.setItem(
      eventsLastIdStorageKey(machineId, viewerContextId),
      lastEventId
    )
  } catch {
    // Ignore storage failures.
  }
}

function normalizeEventSourceLastId(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return /^\d+$/.test(normalized) ? normalized : undefined
}

function normalizePendingMessages(
  payload: PicoServerEvent
): Array<PendingComposerMessage> | undefined {
  if (!isStateSyncEvent(payload)) {
    return undefined
  }

  if (!Array.isArray(payload.pendingUserMessages)) {
    return undefined
  }

  return payload.pendingUserMessages.map((message) => ({
    pendingId: typeof message.pendingId === "string" ? message.pendingId : "",
    text: typeof message.text === "string" ? message.text : "",
    images: Array.isArray(message.images)
      ? message.images.flatMap((image: unknown) => {
          const normalizedImage = normalizePromptImage(image)
          return normalizedImage ? [normalizedImage] : []
        })
      : [],
    streamingBehavior:
      message.streamingBehavior === "steer" ? "steer" : "followUp",
  }))
}

type AutoAgentNamingErrorPayload = Extract<
  PicoServerEvent,
  { type: "auto_agent_naming_error" }
>

function autoAgentNamingErrorDescription(payload: AutoAgentNamingErrorPayload) {
  return (
    payload.refinementReason ||
    payload.heuristicReason ||
    payload.promptPreview ||
    "The server could not generate an agent name."
  )
}

function sameStringArray(left: Array<string> = [], right: Array<string> = []) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }

  return true
}

function samePromptImages(
  left: Array<PromptImage> = [],
  right: Array<PromptImage> = []
) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftImage = left[index]
    const rightImage = right[index]
    if (!leftImage || !rightImage) return false
    if (leftImage.mimeType !== rightImage.mimeType) return false
    if (leftImage.data !== rightImage.data) return false
    if (leftImage.previewUrl !== rightImage.previewUrl) return false
  }

  return true
}

function samePendingMessages(
  left: Array<PendingComposerMessage> = [],
  right: Array<PendingComposerMessage> = []
) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftMessage = left[index]
    const rightMessage = right[index]
    if (!leftMessage || !rightMessage) return false
    if (leftMessage.pendingId !== rightMessage.pendingId) return false
    if (leftMessage.text !== rightMessage.text) return false
    if (leftMessage.streamingBehavior !== rightMessage.streamingBehavior) {
      return false
    }
    if (!samePromptImages(leftMessage.images, rightMessage.images)) {
      return false
    }
  }

  return true
}

function sameDirectoryStates(
  left: NonNullable<AgentsEvent["directoryStates"]> = [],
  right: NonNullable<AgentsEvent["directoryStates"]> = []
) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftState = left[index]
    const rightState = right[index]
    if (!leftState || !rightState) return false
    if (leftState.path !== rightState.path) return false
    if (leftState.totalCount !== rightState.totalCount) return false
    if (leftState.revision !== rightState.revision) return false
  }

  return true
}

function sameAgentListEntries(
  left: Array<AgentListEntry> = [],
  right: Array<AgentListEntry> = []
) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index]
    const rightEntry = right[index]
    if (!leftEntry || !rightEntry) return false
    if (leftEntry.path !== rightEntry.path) return false
    if (leftEntry.id !== rightEntry.id) return false
    if (leftEntry.cwd !== rightEntry.cwd) return false
    if (leftEntry.name !== rightEntry.name) return false
    if (leftEntry.title !== rightEntry.title) return false
    if (leftEntry.modified !== rightEntry.modified) return false
    if (leftEntry.lastUserMessageAt !== rightEntry.lastUserMessageAt) {
      return false
    }
    if (leftEntry.lastMessageAt !== rightEntry.lastMessageAt) {
      return false
    }
    if (leftEntry.lastMessagePreview !== rightEntry.lastMessagePreview) {
      return false
    }
    if (leftEntry.messageCount !== rightEntry.messageCount) return false
    if (!sameContextUsage(leftEntry.contextUsage, rightEntry.contextUsage)) {
      return false
    }
    if (Boolean(leftEntry.streaming) !== Boolean(rightEntry.streaming)) {
      return false
    }
    if (Boolean(leftEntry.unread) !== Boolean(rightEntry.unread)) {
      return false
    }
    if (Boolean(leftEntry.optimistic) !== Boolean(rightEntry.optimistic)) {
      return false
    }
  }

  return true
}

function sameDirectoryIndexes(
  left: AgentsEvent["directoryIndexes"],
  right: AgentsEvent["directoryIndexes"]
) {
  const leftEntries = Object.entries(left || {})
  const rightEntries = Object.entries(right || {})

  if (leftEntries.length !== rightEntries.length) return false

  for (const [directory, leftSnapshot] of leftEntries) {
    const rightSnapshot = right?.[directory]
    if (!leftSnapshot || !rightSnapshot) return false
    if (leftSnapshot.directory !== rightSnapshot.directory) return false
    if (leftSnapshot.totalCount !== rightSnapshot.totalCount) return false
    if (leftSnapshot.revision !== rightSnapshot.revision) return false
    if (!sameAgentListEntries(leftSnapshot.agents, rightSnapshot.agents)) {
      return false
    }
  }

  return true
}

function sameAgentsEvent(left: AgentsEvent | null, right: AgentsEvent | null) {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.activeAgentId === right.activeAgentId &&
    left.activeAgentKey === right.activeAgentKey &&
    left.activeAgentPath === right.activeAgentPath &&
    sameStringArray(left.directories || [], right.directories || []) &&
    sameDirectoryStates(
      left.directoryStates || [],
      right.directoryStates || []
    ) &&
    sameDirectoryIndexes(left.directoryIndexes, right.directoryIndexes)
  )
}

function visibleAssistantBlockKey(
  block: Extract<
    AgentState["items"][number],
    { kind: "assistant" }
  >["blocks"][number],
  options: { hideThinking: boolean; hideToolBlocks: boolean }
) {
  switch (block.type) {
    case "text":
      return block.text.trim() ? `text:${block.text}` : ""
    case "compaction":
      return `compaction:${block.tokensBefore}:${block.estimatedTokensAfter ?? ""}:${block.summary}`
    case "thinking":
      // Hidden thinking shows as a collapsed row that can open, so its text
      // stays part of the visible conversation.
      return `thinking:${block.summaryLabel || ""}:${block.text}`
    case "tool":
      return options.hideToolBlocks
        ? ""
        : `tool:${block.callId || ""}:${block.name || ""}:${JSON.stringify(
            block.args ?? null
          )}:${block.output}:${JSON.stringify(block.details ?? null)}:${
            block.isError ? "1" : "0"
          }:${block.running ? "1" : "0"}`
    default:
      return ""
  }
}

function visibleConversationItemKey(item: AgentState["items"][number]) {
  return item.renderKey || item.itemKey || ""
}

function visibleConversationSignature(
  items: AgentState["items"],
  options: { hideThinking: boolean; hideToolBlocks: boolean }
) {
  const parts: Array<string> = []

  for (const item of items) {
    const itemKey = visibleConversationItemKey(item)

    if (item.kind === "user") {
      parts.push(
        `user:${itemKey}:${item.text}:${item.queued ? "1" : "0"}:${
          item.streamingBehavior || ""
        }:${item.images
          .map((image) => `${image.mimeType}:${image.url}`)
          .join(",")}`
      )
      continue
    }

    const blockKeys = item.blocks.flatMap((block) => {
      const key = visibleAssistantBlockKey(block, options)
      return key ? [key] : []
    })
    const footerSignature = [
      item.done === false ? "0" : "1",
      item.model?.provider || "",
      item.model?.id || "",
      item.startedAt ?? "",
      item.endedAt ?? "",
    ].join(":")

    if (blockKeys.length === 0) {
      if (
        item.streaming ||
        item.done === false ||
        footerSignature !== "1::::"
      ) {
        parts.push(
          `assistant:${itemKey}:${item.streaming ? "1" : "0"}:${footerSignature}`
        )
      }
      continue
    }
    parts.push(
      `assistant:${itemKey}:${item.streaming ? "1" : "0"}:${footerSignature}:${blockKeys.join("|")}`
    )
  }

  return parts.join("\n")
}

function sameVisibleConversation(
  left: AgentState["items"],
  right: AgentState["items"],
  options: { hideThinking: boolean; hideToolBlocks: boolean }
) {
  if (left === right) return true

  return (
    visibleConversationSignature(left, options) ===
    visibleConversationSignature(right, options)
  )
}

function sameAgentStateExceptConversation(left: AgentState, right: AgentState) {
  return (
    left.connected === right.connected &&
    left.replaying === right.replaying &&
    left.streaming === right.streaming &&
    left.compacting === right.compacting &&
    left.draft === right.draft &&
    left.historyOffset === right.historyOffset &&
    left.historyTotalCount === right.historyTotalCount &&
    left.agentId === right.agentId &&
    left.agentKey === right.agentKey &&
    left.agentName === right.agentName &&
    left.firstMessage === right.firstMessage &&
    left.agentFile === right.agentFile &&
    left.cwd === right.cwd &&
    left.directory === right.directory &&
    left.modified === right.modified &&
    left.model === right.model &&
    left.thinkingLevel === right.thinkingLevel &&
    left.availableThinkingLevels === right.availableThinkingLevels &&
    left.availableModels === right.availableModels &&
    left.availableSkills === right.availableSkills &&
    left.hideThinkingBlock === right.hideThinkingBlock &&
    left.uiRequest === right.uiRequest
  )
}

function samePublishableUiState(
  left: AgentState["uiState"],
  right: AgentState["uiState"]
) {
  return (
    left.statuses === right.statuses &&
    left.title === right.title &&
    left.editorText === right.editorText
  )
}

function shouldPublishAgentState(previous: AgentState, next: AgentState) {
  if (previous === next) return false

  return (
    !sameAgentStateExceptConversation(previous, next) ||
    !samePublishableUiState(previous.uiState, next.uiState) ||
    (previous.items.length === 0) !== (next.items.length === 0)
  )
}

function stateSyncPayloadDraftKey(payload: StateSyncPayload) {
  return promptDraftKey({
    cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
    agentFile:
      typeof payload.agentFile === "string" ? payload.agentFile : undefined,
    agentId: typeof payload.agentId === "string" ? payload.agentId : undefined,
  })
}

function stateSyncPayloadConfirmsPendingDraft(
  payload: StateSyncPayload,
  ownerKey: string | null
) {
  if (!ownerKey || payload.draft !== true) return false

  return promptDraftKeyMatchesOwner(stateSyncPayloadDraftKey(payload), ownerKey)
}

function stateSyncPayloadConfirmsOptimisticDraft(
  payload: StateSyncPayload,
  previousState: AgentState
) {
  if (payload.draft !== true) return false

  return promptDraftKeyMatchesOwner(
    stateSyncPayloadDraftKey(payload),
    promptDraftKey(previousState)
  )
}

function shouldIgnoreOptimisticDraftStateSync(options: {
  ownerKey: string | null
  payload: StateSyncPayload
  previousState: AgentState
}) {
  const previousAgentKey = options.previousState.agentKey || ""
  const payloadAgentKey =
    typeof options.payload.agentKey === "string" ? options.payload.agentKey : ""

  if (!previousAgentKey.startsWith("optimistic:")) return false
  if (!payloadAgentKey || payloadAgentKey === previousAgentKey) {
    return false
  }

  if (
    stateSyncPayloadConfirmsPendingDraft(options.payload, options.ownerKey) ||
    stateSyncPayloadConfirmsOptimisticDraft(
      options.payload,
      options.previousState
    )
  ) {
    return false
  }

  return true
}

export function useAppShellAgentSync({
  viewerContextId,
  agentId,
  draftAgentLoadingOwnerKey,
  bootstrapSidebarDirectories,
  hideToolBlocksRef,
  agentStore,
  agentStateRef,
  composerTextRef,
  composerSkillRef,
  replaceComposerDraftRef,
  handleSelectAgentRef,
  pendingRouteAgentIdRef,
  pendingRouteAgentPathRef,
  setAgentState,
  setConversationItems,
  setWorkingState,
  setCompactRunningState,
  setComposerContextUsage,
  setComposerStreaming,
  setAgentsEvent,
  setAgentDoneEvents,
  applySidebarAgentStatusRef,
  bindOptimisticSidebarAgentRef,
  setComposerImages,
  setPendingMessages,
  pendingUiRequestHandlerRef,
  dismissUiRequestRef,
  lastSyncedEditorTextRef,
}: UseAppShellAgentSyncOptions) {
  const machineId = useMachineId()
  const queryClient = useQueryClient()
  const initialEventsAgentIdRef = React.useRef(agentId)
  const currentAgentIdRef = React.useRef(agentId)
  const draftAgentLoadingOwnerKeyRef = React.useRef(draftAgentLoadingOwnerKey)
  const currentSourceRef = React.useRef<EventSource | null>(null)
  const eventsLastIdRef = React.useRef<string | undefined>(undefined)
  const hasReceivedStateSyncRef = React.useRef(false)
  const [hasReceivedStateSync, setHasReceivedStateSync] = React.useState(false)
  const backgroundedAtRef = React.useRef<number | null>(null)
  const wasBackgroundedRef = React.useRef(false)
  const [eventsReconnectNonce, setEventsReconnectNonce] = React.useState(0)

  React.useEffect(() => {
    currentAgentIdRef.current = agentId
  }, [agentId])

  React.useEffect(() => {
    draftAgentLoadingOwnerKeyRef.current = draftAgentLoadingOwnerKey
  }, [draftAgentLoadingOwnerKey])

  React.useEffect(() => {
    eventsLastIdRef.current = normalizeEventSourceLastId(
      readStoredEventsLastId(machineId, viewerContextId)
    )
  }, [viewerContextId])

  React.useEffect(() => {
    if (currentSourceRef.current) return
    initialEventsAgentIdRef.current = agentId
  }, [agentId])

  const syncedAgentId = useSelector(
    agentStore,
    (agentState) => agentState.agentId
  )
  const latestActivationRevisionRef = React.useRef(0)
  const agentSelectNonceRef = React.useRef(Date.now() * 1000)
  const observedRouteAgentIdRef = React.useRef<string | undefined>(undefined)
  const syncedAgentDraft = useSelector(
    agentStore,
    (agentState) => agentState.draft
  )

  React.useEffect(() => {
    const previousRouteAgentId = observedRouteAgentIdRef.current
    const routeAgentChanged = previousRouteAgentId !== agentId
    observedRouteAgentIdRef.current = agentId

    if (!agentId) {
      pendingRouteAgentIdRef.current = undefined
      pendingRouteAgentPathRef.current = undefined
      return
    }

    if (agentId === syncedAgentId) {
      if (pendingRouteAgentIdRef.current === agentId) {
        pendingRouteAgentIdRef.current = undefined
        pendingRouteAgentPathRef.current = undefined
      }
      return
    }

    if (!routeAgentChanged) return

    if (pendingRouteAgentIdRef.current !== agentId) {
      pendingRouteAgentPathRef.current = undefined
    }
    pendingRouteAgentIdRef.current = agentId
  }, [pendingRouteAgentIdRef, pendingRouteAgentPathRef, agentId, syncedAgentId])

  React.useEffect(() => {
    if (!viewerContextId) return

    const markBackgrounded = () => {
      backgroundedAtRef.current = Date.now()
      wasBackgroundedRef.current = true
    }

    const refreshAfterResume = (force = false) => {
      if (document.visibilityState !== "visible") return

      const backgroundedAt = backgroundedAtRef.current
      const backgroundedFor = backgroundedAt ? Date.now() - backgroundedAt : 0
      const shouldRefresh =
        force ||
        (wasBackgroundedRef.current &&
          backgroundedFor >= RESUME_RECONNECT_AFTER_MS)

      backgroundedAtRef.current = null
      wasBackgroundedRef.current = false

      if (!shouldRefresh) return

      const source = currentSourceRef.current
      const shouldReconnectEvents =
        force || !source || source.readyState !== EventSource.OPEN
      if (shouldReconnectEvents) {
        initialEventsAgentIdRef.current = currentAgentIdRef.current
        setEventsReconnectNonce((nonce) => nonce + 1)
      }
      void queryClient
        .invalidateQueries({ refetchType: "active" })
        .catch(() => undefined)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markBackgrounded()
        return
      }

      refreshAfterResume()
    }

    const handleFocus = () => {
      refreshAfterResume()
    }

    const handlePageShow = (event: PageTransitionEvent) => {
      refreshAfterResume(event.persisted)
    }

    if (document.visibilityState === "hidden") {
      markBackgrounded()
    }

    window.addEventListener("blur", markBackgrounded)
    window.addEventListener("focus", handleFocus)
    window.addEventListener("pagehide", markBackgrounded)
    window.addEventListener("pageshow", handlePageShow)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.removeEventListener("blur", markBackgrounded)
      window.removeEventListener("focus", handleFocus)
      window.removeEventListener("pagehide", markBackgrounded)
      window.removeEventListener("pageshow", handlePageShow)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [queryClient, viewerContextId])

  // The stream closes for good after an error status, such as a 502 from a
  // proxy, and data can change while the server is down. Open the stream and
  // load the data again when the server answers again.
  React.useEffect(() => {
    if (!viewerContextId) return
    return onServerReconnect(() => {
      const source = currentSourceRef.current
      if (!source || source.readyState !== EventSource.OPEN) {
        initialEventsAgentIdRef.current = currentAgentIdRef.current
        setEventsReconnectNonce((nonce) => nonce + 1)
      }
      void queryClient
        .invalidateQueries({ refetchType: "active" })
        .catch(() => undefined)
    })
  }, [queryClient, viewerContextId])

  const handleEventSourceOpen = React.useCallback(
    (source: EventSource) => {
      if (currentSourceRef.current !== source) return
      markServerOnline()
      // Events may be lost while the stream was closed.
      refreshSidebarState(machineId)
      const currentState = agentStateRef.current
      if (currentState.connected) return
      const nextState = { ...currentState, connected: true }
      agentStateRef.current = nextState
      setConversationItems(nextState.items)
      setAgentState(nextState)
    },
    [agentStateRef, setConversationItems, setAgentState]
  )

  const handleEventSourceError = React.useCallback(
    (source: EventSource) => {
      if (currentSourceRef.current !== source) return
      checkServerConnection()
      const currentState = agentStateRef.current
      if (!currentState.connected) return
      const nextState = { ...currentState, connected: false }
      agentStateRef.current = nextState
      setConversationItems(nextState.items)
      setAgentState(nextState)
    },
    [agentStateRef, setConversationItems, setAgentState]
  )

  const handleEventSourceMessage = React.useCallback(
    (
      source: EventSource,
      gitInvalidationBatcher: Batcher<GitInvalidationBatchItem>,
      event: MessageEvent<string>
    ) => {
      if (currentSourceRef.current !== source) return
      const lastEventId = normalizeEventSourceLastId(event.lastEventId)
      if (lastEventId) {
        eventsLastIdRef.current = lastEventId
        rememberStoredEventsLastId(machineId, viewerContextId, lastEventId)
      }
      const payload = JSON.parse(event.data) as PicoServerEvent

      if (isConversationDeltaEvent(payload)) {
        const previousState = agentStateRef.current
        if (
          previousState.agentId &&
          previousState.agentId !== payload.agentId
        ) {
          return
        }
        const items = applyConversationDelta(previousState.items, payload)
        if (items === previousState.items) return
        const nextState = {
          ...previousState,
          connected: true,
          replaying: false,
          streaming: true,
          items,
        } satisfies AgentState
        batch(() => {
          agentStateRef.current = nextState
          setConversationItems(items)
          if (!previousState.streaming) {
            setComposerStreaming(true)
            setWorkingState({ label: "Working…", cancelable: false })
          }
          setAgentState(nextState)
        })
        return
      }

      if (isStateSyncEvent(payload)) {
        const activationRevision = payload.activationRevision
        if (
          typeof activationRevision === "number" &&
          activationRevision < latestActivationRevisionRef.current
        ) {
          return
        }
        if (typeof activationRevision === "number") {
          latestActivationRevisionRef.current = activationRevision
        }

        if (!hasReceivedStateSyncRef.current) {
          hasReceivedStateSyncRef.current = true
          setHasReceivedStateSync(true)
        }
        const previousState = agentStateRef.current
        if (
          shouldIgnoreOptimisticDraftStateSync({
            ownerKey: draftAgentLoadingOwnerKeyRef.current,
            payload,
            previousState,
          })
        ) {
          return
        }

        const localPromptText = composerTextRef.current

        rememberStoredPromptDraft(
          machineId,
          previousState,
          serializeComposerDraft({
            text: localPromptText,
            skillName: composerSkillRef.current,
          })
        )

        const previousEditorText = previousState.uiState.editorText || ""
        const nextState = updateStateFromSync(previousState, payload)
        const agentChanged =
          promptDraftKey(nextState) !== promptDraftKey(previousState)
        const currentRouteAgentId = currentAgentIdRef.current
        const currentDraftOwnerKey = draftAgentLoadingOwnerKeyRef.current
        const confirmedDraft =
          nextState.draft && !nextState.agentKey?.startsWith("optimistic:")
        const previousWasOptimisticDraft =
          previousState.draft &&
          previousState.agentKey?.startsWith("optimistic:")
        const draftMatchesPendingOwner = promptDraftKeyMatchesOwner(
          promptDraftKey(nextState),
          currentDraftOwnerKey
        )
        const shouldClearDraftRoute = Boolean(
          currentRouteAgentId &&
          !pendingRouteAgentIdRef.current &&
          confirmedDraft &&
          (draftMatchesPendingOwner || previousWasOptimisticDraft)
        )
        const preserveLocalPrompt =
          !agentChanged && localPromptText !== previousEditorText
        const nextPromptText = preserveLocalPrompt
          ? localPromptText
          : (readStoredPromptDraft(machineId, nextState) ??
            nextState.uiState.editorText ??
            "")
        // Sent one time with the editor text, for example after a fork at a
        // user message. Not kept in the agent state.
        const editorImages = payload.uiState?.editorImages
          ?.map(normalizePromptImage)
          .filter((image) => image !== null)

        batch(() => {
          agentStateRef.current = nextState
          if (previousState.contextUsage !== nextState.contextUsage) {
            setComposerContextUsage(nextState.contextUsage)
          }
          const activeAgentChanged =
            previousState.agentKey !== nextState.agentKey ||
            previousState.agentId !== nextState.agentId ||
            previousState.agentFile !== nextState.agentFile
          if (previousState.streaming !== nextState.streaming) {
            setComposerStreaming(nextState.streaming)
          }
          if (
            activeAgentChanged ||
            previousState.compacting !== nextState.compacting
          ) {
            setCompactRunningState(nextState.compacting)
          }
          if (
            activeAgentChanged ||
            previousState.streaming ||
            nextState.streaming ||
            previousState.compacting ||
            nextState.compacting
          ) {
            setWorkingState(
              nextState.compacting
                ? { label: COMPACT_WORKING_LABEL, cancelable: true }
                : nextState.streaming
                  ? { label: nextState.uiState.workingMessage || "Working…" }
                  : null
            )
          }
          const forceConversationSync = activeAgentChanged
          if (
            forceConversationSync ||
            !sameVisibleConversation(previousState.items, nextState.items, {
              hideThinking: nextState.hideThinkingBlock,
              hideToolBlocks: hideToolBlocksRef.current,
            })
          ) {
            setConversationItems(nextState.items)
          }
          if (shouldPublishAgentState(previousState, nextState)) {
            setAgentState(nextState)
          }

          if (
            previousState.agentKey !== nextState.agentKey ||
            previousState.agentId !== nextState.agentId ||
            previousState.agentFile !== nextState.agentFile ||
            previousState.streaming !== nextState.streaming
          ) {
            applySidebarAgentStatusRef.current({
              type: "agent_status",
              agentKey: nextState.agentKey,
              agentId: nextState.agentId,
              agentPath: nextState.agentFile,
              streaming: nextState.streaming,
              unread: false,
            })
          }

          // The draft became a real agent. Move the sidebar placeholder
          // to the new agent, so it does not stay next to the real entry.
          if (previousState.draft && !nextState.draft && nextState.agentId) {
            bindOptimisticSidebarAgentRef.current({
              cwd: nextState.cwd,
              agentId: nextState.agentId,
              agentPath: nextState.agentFile,
            })
          }

          if (agentChanged) {
            setAgentsEvent((current) => {
              if (!current) return current
              const nextAgentsEvent = {
                ...current,
                activeAgentId: nextState.agentId,
                activeAgentKey: nextState.agentKey,
                activeAgentPath: nextState.agentFile,
              }
              return sameAgentsEvent(current, nextAgentsEvent)
                ? current
                : nextAgentsEvent
            })
          }

          if (editorImages && !preserveLocalPrompt) {
            setComposerImages(editorImages)
          } else if (agentChanged) {
            setComposerImages((current) =>
              current.length === 0 ? current : []
            )
          }

          if (shouldClearDraftRoute) {
            handleSelectAgentRef.current(undefined, { replace: true })
          }
          if (!preserveLocalPrompt) {
            replaceComposerDraftRef.current(nextPromptText, nextState)
          }
          lastSyncedEditorTextRef.current = nextState.uiState.editorText || ""
          const nextPendingMessages = normalizePendingMessages(payload)
          if (nextPendingMessages) {
            setPendingMessages((current) =>
              samePendingMessages(current, nextPendingMessages)
                ? current
                : nextPendingMessages
            )
          }
        })
        return
      }

      if (isAgentsEvent(payload)) {
        setAgentsEvent((current) =>
          sameAgentsEvent(current, payload) ? current : payload
        )
        return
      }

      if (isAgentStatusEvent(payload)) {
        applySidebarAgentStatusRef.current(payload)
        return
      }

      if (isAgentDoneEvent(payload)) {
        // The read state is global. The server sends an agent_status with
        // unread true before this event, unless an open tab shows the agent.
        setAgentDoneEvents((current) =>
          current.some((entry) => entry.id === payload.id)
            ? current
            : [...current, payload]
        )
        return
      }

      if (isGitChangedEvent(payload)) {
        const cwd = payload.cwd.trim()
        if (cwd) {
          gitInvalidationBatcher.addItem({
            cwd,
            scopes: new Set(payload.scopes ?? ["status", "files", "refs"]),
          })
        }
        return
      }

      if (payload.type === "sidebar_state") {
        handleSidebarStateEvent(machineId, payload)
        return
      }

      if (payload.type === "agent_extensions") {
        if (typeof payload.agentId === "string") {
          emitPicoEvent("pico:agent-extensions", {
            agentId: payload.agentId,
            ...(typeof payload.kind === "string" ? { kind: payload.kind } : {}),
          })
        }
        return
      }

      if (payload.type === "auto_agent_naming_error") {
        console.warn("[pico] auto agent naming failed", payload)
        toast.warning("Could not name agent", {
          description: autoAgentNamingErrorDescription(payload),
        })
        return
      }

      if (payload.type === "request_error") {
        toast.error(payload.error || "Request failed")
        return
      }

      if (payload.type === "extension_error") {
        toast.error(payload.error || "Extension error")
        return
      }

      if (payload.type === "extension_ui_dismiss") {
        dismissUiRequestRef.current(payload.id)
        return
      }

      if (payload.type === "extension_ui_request") {
        if (payload.method === "notify") {
          const notifyMessage = payload.message || "Notification"
          const options = payload.toastId ? { id: payload.toastId } : undefined
          if (payload.notifyType === "success") {
            toast.success(notifyMessage, options)
          } else if (payload.notifyType === "warning") {
            toast.warning(notifyMessage, options)
          } else if (payload.notifyType === "error") {
            toast.error(notifyMessage, options)
          } else {
            toast.info(notifyMessage, options)
          }
          return
        }

        // Older servers may forward Pi's fire-and-forget terminal updates.
        // Only interactive methods have a request ID that can be answered.
        if (uiRequestExpectsResponse(payload.method)) {
          pendingUiRequestHandlerRef.current(payload)
        }
      }
    },
    [
      applySidebarAgentStatusRef,
      bindOptimisticSidebarAgentRef,
      composerSkillRef,
      composerTextRef,
      handleSelectAgentRef,
      hideToolBlocksRef,
      lastSyncedEditorTextRef,
      pendingRouteAgentIdRef,
      pendingUiRequestHandlerRef,
      dismissUiRequestRef,
      replaceComposerDraftRef,
      agentStateRef,
      setComposerContextUsage,
      setComposerImages,
      setComposerStreaming,
      setCompactRunningState,
      setConversationItems,
      setPendingMessages,
      setAgentDoneEvents,
      setAgentState,
      setAgentsEvent,
      setWorkingState,
      viewerContextId,
    ]
  )

  React.useEffect(() => {
    if (!viewerContextId) return

    hasReceivedStateSyncRef.current = false
    setHasReceivedStateSync(false)
    latestActivationRevisionRef.current = 0
    const gitInvalidationBatcher = new Batcher<GitInvalidationBatchItem>(
      (items) => {
        const scopesByCwd = new Map<string, Set<string>>()
        for (const item of items) {
          const scopes = scopesByCwd.get(item.cwd) ?? new Set<string>()
          for (const scope of item.scopes) scopes.add(scope)
          scopesByCwd.set(item.cwd, scopes)
        }

        const invalidations = []
        for (const [cwd, scopes] of scopesByCwd) {
          if (scopes.has("status")) {
            invalidations.push(
              queryClient.invalidateQueries({
                queryKey: picoQueryKeys.gitStatus(viewerContextId, cwd),
                exact: true,
                refetchType: "active",
              })
            )
          }
          if (scopes.has("files")) {
            invalidations.push(
              queryClient.invalidateQueries({
                queryKey: picoQueryKeys.gitFiles(viewerContextId, cwd),
                exact: true,
                refetchType: "active",
              }),
              queryClient.invalidateQueries({
                queryKey: picoQueryKeys.projectFileTree(viewerContextId, cwd),
                exact: true,
                refetchType: "active",
              }),
              queryClient.invalidateQueries({
                queryKey: picoQueryKeys.gitFileReviews(viewerContextId, cwd),
                exact: false,
                refetchType: "active",
              })
            )
          }
          if (scopes.has("refs")) {
            invalidations.push(
              queryClient.invalidateQueries({
                queryKey: picoQueryKeys.gitBranches(viewerContextId, cwd),
                exact: true,
                refetchType: "active",
              }),
              queryClient.invalidateQueries({
                queryKey: picoQueryKeys.gitCommits(viewerContextId, cwd),
                exact: false,
                refetchType: "active",
              })
            )
          }
        }

        void Promise.all(invalidations).catch(() => undefined)
      },
      {
        key: "pico.git.invalidations",
        wait: 100,
      }
    )

    const source = new EventSource(
      buildRequestUrl("/events", {
        machineId,
        contextId: viewerContextId,
        agentId: initialEventsAgentIdRef.current,
        searchParams: {
          lastEventId: eventsLastIdRef.current,
          sidebarDirectory: bootstrapSidebarDirectories,
        },
      })
    )
    currentSourceRef.current = source

    source.onopen = () => {
      handleEventSourceOpen(source)
    }

    source.onerror = () => {
      handleEventSourceError(source)
    }

    source.onmessage = (event) => {
      handleEventSourceMessage(source, gitInvalidationBatcher, event)
    }

    return () => {
      if (currentSourceRef.current === source) {
        currentSourceRef.current = null
      }
      source.close()
      gitInvalidationBatcher.flush()
      gitInvalidationBatcher.cancel()
      gitInvalidationBatcher.clear()
    }
  }, [
    bootstrapSidebarDirectories,
    eventsReconnectNonce,
    handleEventSourceError,
    handleEventSourceMessage,
    handleEventSourceOpen,
    queryClient,
    viewerContextId,
  ])

  React.useEffect(() => {
    if (!viewerContextId || !agentId) return
    if (draftAgentLoadingOwnerKey) return
    if (!hasReceivedStateSync) return
    if (agentId === syncedAgentId) return
    if (pendingRouteAgentIdRef.current !== agentId) return

    const abortController = new AbortController()
    const agentPath = pendingRouteAgentPathRef.current
    const selectionNonce = Math.max(
      agentSelectNonceRef.current + 1,
      Date.now() * 1000
    )
    agentSelectNonceRef.current = selectionNonce

    void fetchJson<SimpleOkResponse>(
      buildRequestUrl("/api/agent/select", {
        machineId,
        contextId: viewerContextId,
        agentId,
        searchParams: {
          selectionNonce,
          agentPath,
        },
      }),
      {
        method: "POST",
        signal: abortController.signal,
      }
    ).catch((error) => {
      if (abortController.signal.aborted) return
      toast.error(
        error instanceof Error ? error.message : "Failed to select agent"
      )
    })

    return () => {
      abortController.abort()
    }
  }, [
    draftAgentLoadingOwnerKey,
    hasReceivedStateSync,
    pendingRouteAgentIdRef,
    pendingRouteAgentPathRef,
    syncedAgentId,
    viewerContextId,
    agentId,
  ])

  React.useEffect(() => {
    if (syncedAgentDraft || !syncedAgentId) return

    const pendingRouteAgentId = pendingRouteAgentIdRef.current
    if (pendingRouteAgentId) {
      if (syncedAgentId === pendingRouteAgentId) {
        pendingRouteAgentIdRef.current = undefined
        pendingRouteAgentPathRef.current = undefined
      }
      return
    }

    if (syncedAgentId !== agentId) {
      // The sidebar opened this machine for a new agent. The shell still
      // has the agent that it showed before, and it makes the new agent
      // in an effect after this one. Do not take the route back to the old
      // agent.
      if (hasPendingNewAgentAction(machineId)) return
      handleSelectAgentRef.current(syncedAgentId, { replace: true })
    }
  }, [
    handleSelectAgentRef,
    machineId,
    pendingRouteAgentIdRef,
    pendingRouteAgentPathRef,
    agentId,
    syncedAgentDraft,
    syncedAgentId,
  ])
}
