import * as React from "react"
import { toast } from "sonner"

import type { PromptImage, SessionState } from "@/lib/pi-web"
import type {
  ExtensionUiEvent,
  PiWebServerEvent,
  SessionsEvent,
} from "@/lib/pi-web-api"

import {
  buildRequestUrl,
  updateStateFromSync,
} from "@/features/pi-web/app-shell-utils"
import { serializeComposerDraft } from "@/features/pi-web/composer-utils"
import {
  normalizePromptImage,
  promptDraftKey,
  readStoredPromptDraft,
  rememberStoredPromptDraft,
} from "@/lib/pi-web"
import { isSessionsEvent, isStateSyncEvent } from "@/lib/pi-web-api"

type PendingComposerMessage = {
  pendingId: string
  text: string
  images: Array<PromptImage>
  streamingBehavior: "steer" | "followUp"
}

type UseAppShellSessionSyncOptions = {
  viewerContextId: string
  sessionId?: string
  sessionState: SessionState
  sessionStateRef: React.MutableRefObject<SessionState>
  composerTextRef: React.MutableRefObject<string>
  composerSkillRef: React.MutableRefObject<string | undefined>
  replaceComposerDraftRef: React.MutableRefObject<
    (value: string, target?: SessionState) => void
  >
  handleSelectSessionRef: React.MutableRefObject<
    (nextSessionId?: string) => void
  >
  pendingRouteSessionIdRef: React.MutableRefObject<string | undefined>
  setSessionState: React.Dispatch<React.SetStateAction<SessionState>>
  setSessionsEvent: React.Dispatch<React.SetStateAction<SessionsEvent | null>>
  setComposerImages: React.Dispatch<React.SetStateAction<Array<PromptImage>>>
  setPendingMessages: React.Dispatch<
    React.SetStateAction<Array<PendingComposerMessage>>
  >
  setPendingUiRequest: React.Dispatch<
    React.SetStateAction<ExtensionUiEvent | null>
  >
  setPendingUiValue: React.Dispatch<React.SetStateAction<string>>
  lastSyncedEditorTextRef: React.MutableRefObject<string>
}

function normalizePendingMessages(
  payload: PiWebServerEvent
): Array<PendingComposerMessage> {
  if (
    !isStateSyncEvent(payload) ||
    !Array.isArray(payload.pendingUserMessages)
  ) {
    return []
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

export function useAppShellSessionSync({
  viewerContextId,
  sessionId,
  sessionState,
  sessionStateRef,
  composerTextRef,
  composerSkillRef,
  replaceComposerDraftRef,
  handleSelectSessionRef,
  pendingRouteSessionIdRef,
  setSessionState,
  setSessionsEvent,
  setComposerImages,
  setPendingMessages,
  setPendingUiRequest,
  setPendingUiValue,
  lastSyncedEditorTextRef,
}: UseAppShellSessionSyncOptions) {
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

    const source = new EventSource(
      buildRequestUrl("/events", {
        contextId: viewerContextId,
        sessionId,
      })
    )

    source.onopen = () => {
      setSessionState((current) => ({ ...current, connected: true }))
    }

    source.onerror = () => {
      setSessionState((current) => ({ ...current, connected: false }))
    }

    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as PiWebServerEvent

      if (isStateSyncEvent(payload)) {
        const previousState = sessionStateRef.current
        const sessionChanged =
          promptDraftKey(payload) !== promptDraftKey(previousState)
        const localPromptText = composerTextRef.current

        rememberStoredPromptDraft(
          previousState,
          serializeComposerDraft({
            text: localPromptText,
            skillName: composerSkillRef.current,
          })
        )

        const previousEditorText = previousState.uiState.editorText || ""
        const preserveLocalPrompt =
          !sessionChanged && localPromptText !== previousEditorText
        const nextState = updateStateFromSync(previousState, payload)
        const nextPromptText = preserveLocalPrompt
          ? localPromptText
          : (readStoredPromptDraft(nextState) ??
            nextState.uiState.editorText ??
            "")

        setSessionState(nextState)
        sessionStateRef.current = nextState

        if (sessionChanged) {
          setComposerImages([])
        }

        replaceComposerDraftRef.current(nextPromptText, nextState)
        lastSyncedEditorTextRef.current = nextState.uiState.editorText || ""
        setPendingMessages(normalizePendingMessages(payload))
        return
      }

      if (isSessionsEvent(payload)) {
        setSessionsEvent(payload)
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

        setPendingUiRequest(payload)
        setPendingUiValue(payload.prefill || "")
      }
    }

    return () => {
      source.close()
    }
  }, [
    composerSkillRef,
    composerTextRef,
    lastSyncedEditorTextRef,
    replaceComposerDraftRef,
    sessionId,
    sessionStateRef,
    setComposerImages,
    setPendingMessages,
    setPendingUiRequest,
    setPendingUiValue,
    setSessionState,
    setSessionsEvent,
    viewerContextId,
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
