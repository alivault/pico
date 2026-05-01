import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { SelectSessionNavigationOptions } from "@/features/phi/app-shell"
import type { PromptImage, SessionState } from "@/lib/phi"
import type {
  ExtensionUiEvent,
  PhiServerEvent,
  SessionDoneEvent,
  SessionListEntry,
  SessionStatusEvent,
  SessionsEvent,
  SimpleOkResponse,
} from "@/lib/phi/api"

import {
  buildRequestUrl,
  fetchJson,
  updateStateFromSync,
} from "@/features/phi/app-shell-utils"
import { serializeComposerDraft } from "@/features/phi/composer-utils"
import { phiQueryKeys } from "@/features/phi/query-keys"
import {
  batch,
  useSelector,
  type PhiStore,
} from "@/features/phi/tanstack-store-utils"
import {
  normalizePromptImage,
  promptDraftKey,
  readStoredPromptDraft,
  rememberStoredPromptDraft,
} from "@/lib/phi"
import { sameContextUsage } from "@/lib/phi/sync"
import {
  isGitChangedEvent,
  isSessionDoneEvent,
  isSessionStatusEvent,
  isSessionsEvent,
  isStateSyncEvent,
} from "@/lib/phi/api"

const RESUME_RECONNECT_AFTER_MS = 30_000

type PendingComposerMessage = {
  pendingId: string
  text: string
  images: Array<PromptImage>
  streamingBehavior: "steer" | "followUp"
}

type SessionStateStore = PhiStore<SessionState>

type SyncedWorkingState = {
  label: string
  summary?: string
  done?: boolean
}

type UseAppShellSessionSyncOptions = {
  viewerContextId: string
  sessionId?: string
  draftSessionLoadingOwnerKey: string | null
  bootstrapSidebarDirectories: Array<string>
  hideToolBlocksRef: React.RefObject<boolean>
  sessionStore: SessionStateStore
  sessionStateRef: React.RefObject<SessionState>
  composerTextRef: React.RefObject<string>
  composerSkillRef: React.RefObject<string | undefined>
  replaceComposerDraftRef: React.RefObject<
    (
      value: string,
      target?: SessionState,
      options?: {
        forceSync?: boolean
      }
    ) => void
  >
  handleSelectSessionRef: React.RefObject<
    (nextSessionId?: string, options?: SelectSessionNavigationOptions) => void
  >
  pendingRouteSessionIdRef: React.RefObject<string | undefined>
  pendingRouteSessionPathRef: React.RefObject<string | undefined>
  setSessionState: React.Dispatch<React.SetStateAction<SessionState>>
  setConversationItems: (items: SessionState["items"]) => void
  setHiddenThinkingPreview: (
    value: string,
    options?: { preserveExisting?: boolean }
  ) => void
  setWorkingState: (state: SyncedWorkingState | null) => void
  setComposerContextUsage: (contextUsage: SessionState["contextUsage"]) => void
  setComposerStreaming: (streaming: boolean) => void
  setSessionsEvent: React.Dispatch<React.SetStateAction<SessionsEvent | null>>
  setSessionDoneEvents: React.Dispatch<
    React.SetStateAction<Array<SessionDoneEvent>>
  >
  applySidebarSessionStatusRef: React.RefObject<
    (status: SessionStatusEvent) => void
  >
  setComposerImages: React.Dispatch<React.SetStateAction<Array<PromptImage>>>
  setPendingMessages: React.Dispatch<
    React.SetStateAction<Array<PendingComposerMessage>>
  >
  pendingUiRequestHandlerRef: React.RefObject<
    (request: ExtensionUiEvent) => void
  >
  lastSyncedEditorTextRef: React.RefObject<string>
}

function normalizePendingMessages(
  payload: PhiServerEvent
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
      ? message.images
          .map((image: unknown) => normalizePromptImage(image))
          .filter((image: PromptImage | null): image is PromptImage =>
            Boolean(image)
          )
      : [],
    streamingBehavior:
      message.streamingBehavior === "steer" ? "steer" : "followUp",
  }))
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
  left: NonNullable<SessionsEvent["directoryStates"]> = [],
  right: NonNullable<SessionsEvent["directoryStates"]> = []
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

function sameSessionListEntries(
  left: Array<SessionListEntry> = [],
  right: Array<SessionListEntry> = []
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
  }

  return true
}

function sameDirectoryIndexes(
  left: SessionsEvent["directoryIndexes"],
  right: SessionsEvent["directoryIndexes"]
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
    if (
      !sameSessionListEntries(leftSnapshot.sessions, rightSnapshot.sessions)
    ) {
      return false
    }
  }

  return true
}

function sameSessionsEvent(
  left: SessionsEvent | null,
  right: SessionsEvent | null
) {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.activeSessionId === right.activeSessionId &&
    left.activeSessionKey === right.activeSessionKey &&
    left.activeSessionPath === right.activeSessionPath &&
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
    SessionState["items"][number],
    { kind: "assistant" }
  >["blocks"][number],
  options: { hideThinking: boolean; hideToolBlocks: boolean }
) {
  switch (block.type) {
    case "text":
      return block.text.trim() ? `text:${block.text}` : ""
    case "compaction":
      return `compaction:${block.tokensBefore}:${block.summary}`
    case "thinking":
      return options.hideThinking
        ? ""
        : `thinking:${block.summaryLabel || ""}:${block.text}`
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

function visibleConversationItemKey(item: SessionState["items"][number]) {
  return item.renderKey || item.itemKey || ""
}

function visibleConversationSignature(
  items: SessionState["items"],
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
          .map((image) => `${image.mimeType}:${image.data}`)
          .join(",")}`
      )
      continue
    }

    const blockKeys = item.blocks
      .map((block) => visibleAssistantBlockKey(block, options))
      .filter(Boolean)
    if (blockKeys.length === 0) {
      if (item.streaming) {
        parts.push(`assistant:${itemKey}:1`)
      }
      continue
    }
    parts.push(
      `assistant:${itemKey}:${item.streaming ? "1" : "0"}:${blockKeys.join("|")}`
    )
  }

  return parts.join("\n")
}

function sameVisibleConversation(
  left: SessionState["items"],
  right: SessionState["items"],
  options: { hideThinking: boolean; hideToolBlocks: boolean }
) {
  if (left === right) return true

  return (
    visibleConversationSignature(left, options) ===
    visibleConversationSignature(right, options)
  )
}

function sameSessionStateExceptConversation(
  left: SessionState,
  right: SessionState
) {
  return (
    left.connected === right.connected &&
    left.replaying === right.replaying &&
    left.streaming === right.streaming &&
    left.draft === right.draft &&
    left.historyOffset === right.historyOffset &&
    left.historyTotalCount === right.historyTotalCount &&
    left.sessionId === right.sessionId &&
    left.sessionKey === right.sessionKey &&
    left.sessionName === right.sessionName &&
    left.firstMessage === right.firstMessage &&
    left.sessionFile === right.sessionFile &&
    left.cwd === right.cwd &&
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
  left: SessionState["uiState"],
  right: SessionState["uiState"]
) {
  return (
    left.statuses === right.statuses &&
    left.title === right.title &&
    left.editorText === right.editorText
  )
}

function shouldPublishSessionState(previous: SessionState, next: SessionState) {
  if (previous === next) return false

  return (
    !sameSessionStateExceptConversation(previous, next) ||
    !samePublishableUiState(previous.uiState, next.uiState) ||
    (previous.items.length === 0) !== (next.items.length === 0)
  )
}

export function useAppShellSessionSync({
  viewerContextId,
  sessionId,
  draftSessionLoadingOwnerKey,
  bootstrapSidebarDirectories,
  hideToolBlocksRef,
  sessionStore,
  sessionStateRef,
  composerTextRef,
  composerSkillRef,
  replaceComposerDraftRef,
  handleSelectSessionRef,
  pendingRouteSessionIdRef,
  pendingRouteSessionPathRef,
  setSessionState,
  setConversationItems,
  setHiddenThinkingPreview,
  setWorkingState,
  setComposerContextUsage,
  setComposerStreaming,
  setSessionsEvent,
  setSessionDoneEvents,
  applySidebarSessionStatusRef,
  setComposerImages,
  setPendingMessages,
  pendingUiRequestHandlerRef,
  lastSyncedEditorTextRef,
}: UseAppShellSessionSyncOptions) {
  const queryClient = useQueryClient()
  const initialEventsSessionIdRef = React.useRef(sessionId)
  const currentSessionIdRef = React.useRef(sessionId)
  const draftSessionLoadingOwnerKeyRef = React.useRef(
    draftSessionLoadingOwnerKey
  )
  const currentSourceRef = React.useRef<EventSource | null>(null)
  const hasReceivedStateSyncRef = React.useRef(false)
  const backgroundedAtRef = React.useRef<number | null>(null)
  const wasBackgroundedRef = React.useRef(false)
  const [eventsReconnectNonce, setEventsReconnectNonce] = React.useState(0)

  React.useEffect(() => {
    currentSessionIdRef.current = sessionId
  }, [sessionId])

  React.useEffect(() => {
    draftSessionLoadingOwnerKeyRef.current = draftSessionLoadingOwnerKey
  }, [draftSessionLoadingOwnerKey])

  React.useEffect(() => {
    if (currentSourceRef.current) return
    initialEventsSessionIdRef.current = sessionId
  }, [sessionId])

  const syncedSessionId = useSelector(
    sessionStore,
    (sessionState) => sessionState.sessionId
  )
  const syncedSessionIdRef = React.useRef(syncedSessionId)
  const syncedSessionDraft = useSelector(
    sessionStore,
    (sessionState) => sessionState.draft
  )

  React.useEffect(() => {
    if (!sessionId) {
      pendingRouteSessionIdRef.current = undefined
      pendingRouteSessionPathRef.current = undefined
      return
    }

    if (sessionId === syncedSessionId) {
      if (pendingRouteSessionIdRef.current === sessionId) {
        pendingRouteSessionIdRef.current = undefined
        pendingRouteSessionPathRef.current = undefined
      }
      return
    }

    if (pendingRouteSessionIdRef.current !== sessionId) {
      pendingRouteSessionPathRef.current = undefined
    }
    pendingRouteSessionIdRef.current = sessionId
  }, [
    pendingRouteSessionIdRef,
    pendingRouteSessionPathRef,
    sessionId,
    syncedSessionId,
  ])

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

      initialEventsSessionIdRef.current = currentSessionIdRef.current
      setEventsReconnectNonce((nonce) => nonce + 1)
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

  React.useEffect(() => {
    if (!viewerContextId) return

    hasReceivedStateSyncRef.current = false
    const source = new EventSource(
      buildRequestUrl("/events", {
        contextId: viewerContextId,
        sessionId: initialEventsSessionIdRef.current,
        searchParams: {
          sidebarDirectory: bootstrapSidebarDirectories,
        },
      })
    )
    currentSourceRef.current = source

    source.onopen = () => {
      if (currentSourceRef.current !== source) return
      const currentState = sessionStateRef.current
      if (currentState.connected) return
      const nextState = { ...currentState, connected: true }
      sessionStateRef.current = nextState
      setConversationItems(nextState.items)
      setSessionState(nextState)
    }

    source.onerror = () => {
      if (currentSourceRef.current !== source) return
      const currentState = sessionStateRef.current
      if (!currentState.connected) return
      const nextState = { ...currentState, connected: false }
      sessionStateRef.current = nextState
      setConversationItems(nextState.items)
      setSessionState(nextState)
    }

    source.onmessage = (event) => {
      if (currentSourceRef.current !== source) return
      const payload = JSON.parse(event.data) as PhiServerEvent

      if (isStateSyncEvent(payload)) {
        hasReceivedStateSyncRef.current = true
        const previousState = sessionStateRef.current
        const localPromptText = composerTextRef.current

        rememberStoredPromptDraft(
          previousState,
          serializeComposerDraft({
            text: localPromptText,
            skillName: composerSkillRef.current,
          })
        )

        const previousEditorText = previousState.uiState.editorText || ""
        const nextState = updateStateFromSync(previousState, payload)
        const sessionChanged =
          promptDraftKey(nextState) !== promptDraftKey(previousState)
        const currentRouteSessionId = currentSessionIdRef.current
        const currentDraftOwnerKey = draftSessionLoadingOwnerKeyRef.current
        const confirmedDraft =
          nextState.draft && !nextState.sessionKey?.startsWith("optimistic:")
        const previousWasOptimisticDraft =
          previousState.draft &&
          previousState.sessionKey?.startsWith("optimistic:")
        const draftMatchesPendingOwner = currentDraftOwnerKey
          ? promptDraftKey(nextState) === currentDraftOwnerKey
          : false
        const shouldClearDraftRoute = Boolean(
          currentRouteSessionId &&
          !pendingRouteSessionIdRef.current &&
          confirmedDraft &&
          (draftMatchesPendingOwner || previousWasOptimisticDraft)
        )
        const preserveLocalPrompt =
          !sessionChanged && localPromptText !== previousEditorText
        const nextPromptText = preserveLocalPrompt
          ? localPromptText
          : (readStoredPromptDraft(nextState) ??
            nextState.uiState.editorText ??
            "")

        batch(() => {
          sessionStateRef.current = nextState
          setHiddenThinkingPreview(nextState.hiddenThinkingPreview || "", {
            preserveExisting: Boolean(
              previousState.streaming &&
              nextState.streaming &&
              !nextState.hiddenThinkingPreview
            ),
          })
          if (previousState.contextUsage !== nextState.contextUsage) {
            setComposerContextUsage(nextState.contextUsage)
          }
          if (previousState.streaming !== nextState.streaming) {
            setComposerStreaming(nextState.streaming)
          }
          if (previousState.streaming || nextState.streaming) {
            setWorkingState(
              nextState.streaming
                ? { label: nextState.uiState.workingMessage || "Working…" }
                : null
            )
          }
          const forceConversationSync =
            previousState.sessionKey !== nextState.sessionKey ||
            previousState.sessionId !== nextState.sessionId ||
            previousState.sessionFile !== nextState.sessionFile
          if (
            forceConversationSync ||
            !sameVisibleConversation(previousState.items, nextState.items, {
              hideThinking: nextState.hideThinkingBlock,
              hideToolBlocks: hideToolBlocksRef.current,
            })
          ) {
            setConversationItems(nextState.items)
          }
          if (shouldPublishSessionState(previousState, nextState)) {
            setSessionState(nextState)
          }

          if (
            previousState.sessionKey !== nextState.sessionKey ||
            previousState.sessionId !== nextState.sessionId ||
            previousState.sessionFile !== nextState.sessionFile ||
            previousState.streaming !== nextState.streaming
          ) {
            applySidebarSessionStatusRef.current({
              type: "session_status",
              sessionKey: nextState.sessionKey,
              sessionId: nextState.sessionId,
              sessionPath: nextState.sessionFile,
              streaming: nextState.streaming,
              unread: false,
            })
          }

          if (sessionChanged) {
            setSessionsEvent((current) => {
              if (!current) return current
              const nextSessionsEvent = {
                ...current,
                activeSessionId: nextState.sessionId,
                activeSessionKey: nextState.sessionKey,
                activeSessionPath: nextState.sessionFile,
              }
              return sameSessionsEvent(current, nextSessionsEvent)
                ? current
                : nextSessionsEvent
            })
          }

          if (sessionChanged) {
            setComposerImages((current) =>
              current.length === 0 ? current : []
            )
          }

          if (shouldClearDraftRoute) {
            handleSelectSessionRef.current(undefined, { replace: true })
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

      if (isSessionsEvent(payload)) {
        setSessionsEvent((current) =>
          sameSessionsEvent(current, payload) ? current : payload
        )
        return
      }

      if (isSessionStatusEvent(payload)) {
        applySidebarSessionStatusRef.current(payload)
        return
      }

      if (isSessionDoneEvent(payload)) {
        setSessionDoneEvents((current) =>
          current.some((entry) => entry.id === payload.id)
            ? current
            : [...current, payload]
        )
        return
      }

      if (isGitChangedEvent(payload)) {
        const cwd = payload.cwd.trim()
        if (cwd) {
          const scopes = new Set(payload.scopes ?? ["status", "files", "refs"])
          const invalidations = []
          if (scopes.has("status")) {
            invalidations.push(
              queryClient.invalidateQueries({
                queryKey: phiQueryKeys.gitStatus(viewerContextId, cwd),
                exact: true,
                refetchType: "active",
              })
            )
          }
          if (scopes.has("files")) {
            invalidations.push(
              queryClient.invalidateQueries({
                queryKey: phiQueryKeys.gitFiles(viewerContextId, cwd),
                exact: true,
                refetchType: "active",
              })
            )
          }
          if (scopes.has("refs")) {
            invalidations.push(
              queryClient.invalidateQueries({
                queryKey: phiQueryKeys.gitBranches(viewerContextId, cwd),
                exact: true,
                refetchType: "active",
              }),
              queryClient.invalidateQueries({
                queryKey: phiQueryKeys.gitCommits(viewerContextId, cwd),
                exact: true,
                refetchType: "active",
              })
            )
          }
          void Promise.all(invalidations).catch(() => undefined)
        }
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

      if (payload.type === "extension_ui_request") {
        if (payload.method === "notify") {
          const notifyMessage = payload.message || "Notification"
          if (payload.notifyType === "success") toast.success(notifyMessage)
          else if (payload.notifyType === "warning") {
            toast.warning(notifyMessage)
          } else if (payload.notifyType === "error") {
            toast.error(notifyMessage)
          } else {
            toast.info(notifyMessage)
          }
          return
        }

        pendingUiRequestHandlerRef.current(payload)
      }
    }

    return () => {
      if (currentSourceRef.current === source) {
        currentSourceRef.current = null
      }
      source.close()
    }
  }, [
    bootstrapSidebarDirectories,
    composerSkillRef,
    composerTextRef,
    lastSyncedEditorTextRef,
    applySidebarSessionStatusRef,
    queryClient,
    replaceComposerDraftRef,
    sessionStateRef,
    setComposerImages,
    setHiddenThinkingPreview,
    setWorkingState,
    setComposerContextUsage,
    setComposerStreaming,
    setConversationItems,
    setPendingMessages,
    pendingUiRequestHandlerRef,
    setSessionDoneEvents,
    setSessionState,
    setSessionsEvent,
    viewerContextId,
    eventsReconnectNonce,
  ])

  React.useEffect(() => {
    syncedSessionIdRef.current = syncedSessionId
  }, [syncedSessionId])

  React.useEffect(() => {
    if (!viewerContextId || !sessionId) return
    if (draftSessionLoadingOwnerKey) return
    if (!hasReceivedStateSyncRef.current) return
    if (sessionId === syncedSessionIdRef.current) return

    const abortController = new AbortController()
    const sessionPath = pendingRouteSessionPathRef.current

    void fetchJson<SimpleOkResponse>(
      buildRequestUrl("/api/session/select", {
        contextId: viewerContextId,
        sessionId,
        searchParams: {
          sessionPath,
        },
      }),
      {
        method: "POST",
        signal: abortController.signal,
      }
    ).catch((error) => {
      if (abortController.signal.aborted) return
      toast.error(
        error instanceof Error ? error.message : "Failed to select session"
      )
    })

    return () => {
      abortController.abort()
    }
  }, [
    draftSessionLoadingOwnerKey,
    pendingRouteSessionPathRef,
    viewerContextId,
    sessionId,
  ])

  React.useEffect(() => {
    if (syncedSessionDraft || !syncedSessionId) return

    const pendingRouteSessionId = pendingRouteSessionIdRef.current
    if (pendingRouteSessionId) {
      if (syncedSessionId === pendingRouteSessionId) {
        pendingRouteSessionIdRef.current = undefined
        pendingRouteSessionPathRef.current = undefined
      }
      return
    }

    if (syncedSessionId !== sessionId) {
      handleSelectSessionRef.current(syncedSessionId, { replace: true })
    }
  }, [
    handleSelectSessionRef,
    pendingRouteSessionIdRef,
    pendingRouteSessionPathRef,
    sessionId,
    syncedSessionDraft,
    syncedSessionId,
  ])
}
