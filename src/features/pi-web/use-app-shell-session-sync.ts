import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { PromptImage, SessionState } from "@/lib/pi-web"
import type {
  ExtensionUiEvent,
  PiWebServerEvent,
  SessionListEntry,
  SessionsEvent,
  SimpleOkResponse,
} from "@/lib/pi-web-api"

import {
  buildRequestUrl,
  fetchJson,
  updateStateFromSync,
} from "@/features/pi-web/app-shell-utils"
import { serializeComposerDraft } from "@/features/pi-web/composer-utils"
import { piWebQueryKeys } from "@/features/pi-web/query-keys"
import {
  normalizePromptImage,
  promptDraftKey,
  readStoredPromptDraft,
  rememberStoredPromptDraft,
} from "@/lib/pi-web"
import {
  isGitChangedEvent,
  isSessionsEvent,
  isStateSyncEvent,
} from "@/lib/pi-web-api"

const RESUME_RECONNECT_AFTER_MS = 30_000

type PendingComposerMessage = {
  pendingId: string
  text: string
  images: Array<PromptImage>
  streamingBehavior: "steer" | "followUp"
}

type UseAppShellSessionSyncOptions = {
  viewerContextId: string
  sessionId?: string
  draftSessionLoadingOwnerKey: string | null
  bootstrapSidebarDirectories: Array<string>
  sessionState: SessionState
  sessionStateRef: React.MutableRefObject<SessionState>
  setConnected?: React.Dispatch<React.SetStateAction<boolean>>
  composerTextRef: React.MutableRefObject<string>
  composerSkillRef: React.MutableRefObject<string | undefined>
  replaceComposerDraftRef: React.MutableRefObject<
    (
      value: string,
      target?: SessionState,
      options?: {
        forceSync?: boolean
      }
    ) => void
  >
  handleSelectSessionRef: React.MutableRefObject<
    (nextSessionId?: string) => void
  >
  pendingRouteSessionIdRef: React.MutableRefObject<string | undefined>
  setSessionState: React.Dispatch<React.SetStateAction<SessionState>>
  setConversationItems: (items: SessionState["items"]) => void
  setSessionsEvent: React.Dispatch<React.SetStateAction<SessionsEvent | null>>
  setComposerImages: React.Dispatch<React.SetStateAction<Array<PromptImage>>>
  setPendingMessages: React.Dispatch<
    React.SetStateAction<Array<PendingComposerMessage>>
  >
  pendingUiRequestHandlerRef: React.MutableRefObject<
    (request: ExtensionUiEvent) => void
  >
  lastSyncedEditorTextRef: React.MutableRefObject<string>
}

function normalizePendingMessages(
  payload: PiWebServerEvent
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
    left.hiddenThinkingPreview === right.hiddenThinkingPreview &&
    left.contextUsage === right.contextUsage &&
    left.uiState === right.uiState &&
    left.uiRequest === right.uiRequest
  )
}

function shouldPublishSessionState(previous: SessionState, next: SessionState) {
  if (previous === next) return false

  return (
    !sameSessionStateExceptConversation(previous, next) ||
    (previous.items.length === 0) !== (next.items.length === 0)
  )
}

export function useAppShellSessionSync({
  viewerContextId,
  sessionId,
  draftSessionLoadingOwnerKey,
  bootstrapSidebarDirectories,
  sessionState,
  sessionStateRef,
  setConnected,
  composerTextRef,
  composerSkillRef,
  replaceComposerDraftRef,
  handleSelectSessionRef,
  pendingRouteSessionIdRef,
  setSessionState,
  setConversationItems,
  setSessionsEvent,
  setComposerImages,
  setPendingMessages,
  pendingUiRequestHandlerRef,
  lastSyncedEditorTextRef,
}: UseAppShellSessionSyncOptions) {
  const queryClient = useQueryClient()
  const initialEventsSessionIdRef = React.useRef(sessionId)
  const currentSessionIdRef = React.useRef(sessionId)
  const currentSourceRef = React.useRef<EventSource | null>(null)
  const hasReceivedStateSyncRef = React.useRef(false)
  const backgroundedAtRef = React.useRef<number | null>(null)
  const wasBackgroundedRef = React.useRef(false)
  const [eventsReconnectNonce, setEventsReconnectNonce] = React.useState(0)

  React.useEffect(() => {
    currentSessionIdRef.current = sessionId
  }, [sessionId])

  React.useEffect(() => {
    if (currentSourceRef.current) return
    initialEventsSessionIdRef.current = sessionId
  }, [sessionId])

  React.useEffect(() => {
    if (!sessionId) {
      pendingRouteSessionIdRef.current = undefined
      return
    }

    if (sessionId === sessionState.sessionId) {
      if (pendingRouteSessionIdRef.current === sessionId) {
        pendingRouteSessionIdRef.current = undefined
      }
      return
    }

    pendingRouteSessionIdRef.current = sessionId
  }, [pendingRouteSessionIdRef, sessionId, sessionState.sessionId])

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
      setConnected?.(true)
      const currentState = sessionStateRef.current
      if (currentState.connected) return
      const nextState = { ...currentState, connected: true }
      sessionStateRef.current = nextState
      setConversationItems(nextState.items)
      setSessionState(nextState)
    }

    source.onerror = () => {
      if (currentSourceRef.current !== source) return
      setConnected?.(false)
      const currentState = sessionStateRef.current
      if (!currentState.connected) return
      const nextState = { ...currentState, connected: false }
      sessionStateRef.current = nextState
      setConversationItems(nextState.items)
      setSessionState(nextState)
    }

    source.onmessage = (event) => {
      if (currentSourceRef.current !== source) return
      const payload = JSON.parse(event.data) as PiWebServerEvent

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
        const preserveLocalPrompt =
          !sessionChanged && localPromptText !== previousEditorText
        const nextPromptText = preserveLocalPrompt
          ? localPromptText
          : (readStoredPromptDraft(nextState) ??
            nextState.uiState.editorText ??
            "")

        sessionStateRef.current = nextState
        setConversationItems(nextState.items)
        if (shouldPublishSessionState(previousState, nextState)) {
          setSessionState(nextState)
        }

        if (sessionChanged) {
          setComposerImages((current) => (current.length === 0 ? current : []))
        }

        replaceComposerDraftRef.current(nextPromptText, nextState)
        lastSyncedEditorTextRef.current = nextState.uiState.editorText || ""
        const nextPendingMessages = normalizePendingMessages(payload)
        if (nextPendingMessages) {
          setPendingMessages((current) =>
            samePendingMessages(current, nextPendingMessages)
              ? current
              : nextPendingMessages
          )
        }
        return
      }

      if (isSessionsEvent(payload)) {
        setSessionsEvent((current) =>
          sameSessionsEvent(current, payload) ? current : payload
        )
        return
      }

      if (isGitChangedEvent(payload)) {
        const cwd = payload.cwd.trim()
        if (cwd) {
          void Promise.all([
            queryClient.invalidateQueries({
              queryKey: piWebQueryKeys.gitStatus(viewerContextId, cwd),
              exact: true,
              refetchType: "active",
            }),
            queryClient.invalidateQueries({
              queryKey: piWebQueryKeys.gitChanges(viewerContextId, cwd),
              exact: true,
              refetchType: "active",
            }),
          ]).catch(() => undefined)
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
    queryClient,
    replaceComposerDraftRef,
    sessionStateRef,
    setConnected,
    setComposerImages,
    setConversationItems,
    setPendingMessages,
    pendingUiRequestHandlerRef,
    setSessionState,
    setSessionsEvent,
    viewerContextId,
    eventsReconnectNonce,
  ])

  React.useEffect(() => {
    if (!viewerContextId || !sessionId) return
    if (draftSessionLoadingOwnerKey) return
    if (!hasReceivedStateSyncRef.current) return
    if (sessionId === sessionState.sessionId) return

    const abortController = new AbortController()

    void fetchJson<SimpleOkResponse>(
      buildRequestUrl("/api/session/select", {
        contextId: viewerContextId,
        sessionId,
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
    viewerContextId,
    sessionId,
    sessionState.sessionId,
  ])

  React.useEffect(() => {
    if (sessionState.draft || !sessionState.sessionId) return

    const pendingRouteSessionId = pendingRouteSessionIdRef.current
    if (pendingRouteSessionId) {
      if (sessionState.sessionId === pendingRouteSessionId) {
        pendingRouteSessionIdRef.current = undefined
      }
      return
    }

    if (sessionState.sessionId !== sessionId) {
      handleSelectSessionRef.current(sessionState.sessionId)
    }
  }, [
    handleSelectSessionRef,
    pendingRouteSessionIdRef,
    sessionId,
    sessionState.draft,
    sessionState.sessionId,
  ])
}
