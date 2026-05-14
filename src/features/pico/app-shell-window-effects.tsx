import * as React from "react"
import { toast } from "sonner"

import {
  doneEventLabel,
  getCurrentSessionTitleFromState,
  sessionNotificationKey,
  shallowRecordEqual,
} from "@/features/pico/app-shell-common"
import type { AppShellNotificationState } from "@/features/pico/app-shell-types"
import {
  playSessionDoneSound,
  primeSessionDoneSound,
  showSessionDoneDesktopNotification,
} from "@/features/pico/session-done-notifications"
import type { AppShellSidebarStore } from "@/features/pico/app-shell-sidebar-store"
import {
  setStoreField,
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import type { SessionState } from "@/lib/pico"
import type { SessionDoneEvent } from "@/lib/pico/api"

const TITLE_STREAMING_FRAMES = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"]
const TITLE_STREAMING_INTERVAL_MS = 500

function getIsPageForeground() {
  if (typeof document === "undefined") return true

  return document.visibilityState === "visible" && document.hasFocus()
}

function getWindowTitleUnreadCount(
  sidebarUnreadVersion: string,
  backgroundCurrentSessionUnreadKey: string
) {
  const unreadKeys = new Set(
    sidebarUnreadVersion ? sidebarUnreadVersion.split("\n") : []
  )

  if (backgroundCurrentSessionUnreadKey) {
    unreadKeys.add(backgroundCurrentSessionUnreadKey)
  }

  return unreadKeys.size
}

function setPicoDocumentTitle({
  backgroundCurrentSessionUnreadKey,
  currentPageTitle,
  sessionStreaming,
  sidebarUnreadVersion,
  titleStreamingFrameIndex,
}: {
  backgroundCurrentSessionUnreadKey: string
  currentPageTitle: string
  sessionStreaming: boolean
  sidebarUnreadVersion: string
  titleStreamingFrameIndex: number
}) {
  const streamingPrefix = sessionStreaming
    ? `${TITLE_STREAMING_FRAMES[titleStreamingFrameIndex]} `
    : ""
  const nextTitle = `${streamingPrefix}${currentPageTitle}`
  const unreadSessionCount = getWindowTitleUnreadCount(
    sidebarUnreadVersion,
    backgroundCurrentSessionUnreadKey
  )

  document.title =
    unreadSessionCount > 0 ? `(${unreadSessionCount}) ${nextTitle}` : nextTitle
}

export function AppShellWindowEffectsHost({
  isSessionViewLoading,
  loadingDisplaySessionTitle,
  notificationStore,
  onSelectSession,
  sessionStore,
  sidebarStore,
}: {
  isSessionViewLoading: boolean
  loadingDisplaySessionTitle: string
  notificationStore: PicoStore<AppShellNotificationState>
  onSelectSession: (nextSessionId?: string) => void
  sessionStore: PicoStore<SessionState>
  sidebarStore: AppShellSidebarStore
}) {
  const sessionWindowState = useSelector(
    sessionStore,
    (sessionState) => ({
      activeSessionKey: sessionState.sessionKey,
      activeSessionNotificationKey: sessionNotificationKey({
        sessionId: sessionState.sessionId,
        sessionFile: sessionState.sessionFile,
      }),
      sessionCwd: sessionState.cwd,
      sessionName: sessionState.sessionName,
      sessionStreaming: sessionState.streaming,
      firstMessage: sessionState.firstMessage,
      uiTitle: sessionState.uiState.title?.trim() || "",
    }),
    { compare: shallowRecordEqual }
  )
  const notificationState = useSelector(notificationStore)
  React.useEffect(() => {
    if (!notificationState.sessionDoneSoundEnabled) return

    const handleInteraction = () => {
      void primeSessionDoneSound()
    }

    window.addEventListener("pointerdown", handleInteraction, true)
    window.addEventListener("keydown", handleInteraction, true)

    return () => {
      window.removeEventListener("pointerdown", handleInteraction, true)
      window.removeEventListener("keydown", handleInteraction, true)
    }
  }, [notificationState.sessionDoneSoundEnabled])

  const currentSessionTitle =
    getCurrentSessionTitleFromState(sessionWindowState)
  const currentPageTitle = isSessionViewLoading
    ? loadingDisplaySessionTitle
    : sessionWindowState.uiTitle ||
      (currentSessionTitle !== "New session" ? currentSessionTitle : "Pico")
  const onConsumeSessionDoneEvents = (ids: Array<string>) => {
    const consumedIds = new Set(ids)
    setStoreField(notificationStore, "sessionDoneEvents", (current) =>
      current.filter((event) => !consumedIds.has(event.id))
    )
  }

  return (
    <AppShellWindowEffects
      activeSessionKey={sessionWindowState.activeSessionKey}
      activeSessionNotificationKey={
        sessionWindowState.activeSessionNotificationKey
      }
      currentPageTitle={currentPageTitle}
      sessionCwd={sessionWindowState.sessionCwd}
      sessionDoneDesktopNotificationsEnabled={
        notificationState.sessionDoneDesktopNotificationsEnabled
      }
      sessionDoneSoundEnabled={notificationState.sessionDoneSoundEnabled}
      sessionStreaming={sessionWindowState.sessionStreaming}
      sessionDoneEvents={notificationState.sessionDoneEvents}
      sidebarStore={sidebarStore}
      onConsumeSessionDoneEvents={onConsumeSessionDoneEvents}
      onSelectSession={onSelectSession}
    />
  )
}

function AppShellWindowEffects({
  activeSessionKey,
  activeSessionNotificationKey,
  currentPageTitle,
  sessionCwd,
  sessionDoneDesktopNotificationsEnabled,
  sessionDoneSoundEnabled,
  sessionStreaming,
  sessionDoneEvents,
  sidebarStore,
  onConsumeSessionDoneEvents,
  onSelectSession,
}: {
  activeSessionKey?: string
  activeSessionNotificationKey: string
  currentPageTitle: string
  sessionCwd?: string
  sessionDoneDesktopNotificationsEnabled: boolean
  sessionDoneSoundEnabled: boolean
  sessionStreaming: boolean
  sessionDoneEvents: Array<SessionDoneEvent>
  sidebarStore: AppShellSidebarStore
  onConsumeSessionDoneEvents: (ids: Array<string>) => void
  onSelectSession: (nextSessionId?: string) => void
}) {
  const sidebarUnreadVersion = useSelector(sidebarStore, (snapshot) =>
    snapshot.derived.sidebarSessions
      .flatMap((session) => {
        if (!session.unread) return []
        const key = sessionNotificationKey(session)
        return key ? [key] : []
      })
      .sort()
      .join("\n")
  )
  const isPageForegroundRef = React.useRef(getIsPageForeground())
  const titleStreamingFrameIndexRef = React.useRef(0)
  const backgroundCurrentSessionUnreadKeyRef = React.useRef("")
  const titleSnapshotRef = React.useRef({
    currentPageTitle,
    sessionStreaming,
    sidebarUnreadVersion,
  })
  const processedSessionDoneEventIdsRef = React.useRef<Set<string>>(new Set())

  const updateDocumentTitle = () => {
    setPicoDocumentTitle({
      ...titleSnapshotRef.current,
      backgroundCurrentSessionUnreadKey:
        backgroundCurrentSessionUnreadKeyRef.current,
      titleStreamingFrameIndex: titleStreamingFrameIndexRef.current,
    })
  }

  React.useEffect(() => {
    titleSnapshotRef.current = {
      currentPageTitle,
      sessionStreaming,
      sidebarUnreadVersion,
    }
    updateDocumentTitle()
  }, [currentPageTitle, sessionStreaming, sidebarUnreadVersion])

  React.useEffect(() => {
    const syncPageForeground = () => {
      const isPageForeground = getIsPageForeground()
      isPageForegroundRef.current = isPageForeground

      if (isPageForeground || !activeSessionNotificationKey) {
        backgroundCurrentSessionUnreadKeyRef.current = ""
        updateDocumentTitle()
        return
      }

      const currentBackgroundKey = backgroundCurrentSessionUnreadKeyRef.current
      if (
        currentBackgroundKey &&
        currentBackgroundKey !== activeSessionNotificationKey
      ) {
        backgroundCurrentSessionUnreadKeyRef.current = ""
        updateDocumentTitle()
      }
    }

    syncPageForeground()
    window.addEventListener("focus", syncPageForeground)
    window.addEventListener("blur", syncPageForeground)
    document.addEventListener("visibilitychange", syncPageForeground)

    return () => {
      window.removeEventListener("focus", syncPageForeground)
      window.removeEventListener("blur", syncPageForeground)
      document.removeEventListener("visibilitychange", syncPageForeground)
    }
  }, [activeSessionNotificationKey])

  React.useEffect(() => {
    if (!sessionStreaming) {
      titleStreamingFrameIndexRef.current = 0
      updateDocumentTitle()
      return
    }

    const intervalId = window.setInterval(() => {
      titleStreamingFrameIndexRef.current =
        (titleStreamingFrameIndexRef.current + 1) %
        TITLE_STREAMING_FRAMES.length
      updateDocumentTitle()
    }, TITLE_STREAMING_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [sessionStreaming])

  React.useEffect(() => {
    if (sessionDoneEvents.length === 0) return

    const consumedIds: Array<string> = []
    let playedSound = false

    for (const event of sessionDoneEvents) {
      consumedIds.push(event.id)
      if (processedSessionDoneEventIdsRef.current.has(event.id)) continue
      processedSessionDoneEventIdsRef.current.add(event.id)

      const key = sessionNotificationKey({
        sessionId: event.sessionId,
        sessionPath: event.sessionPath,
      })
      const matchesCurrentSession = Boolean(
        (key &&
          activeSessionNotificationKey &&
          key === activeSessionNotificationKey) ||
        (event.sessionKey &&
          activeSessionKey &&
          event.sessionKey === activeSessionKey)
      )
      const label = doneEventLabel(event)
      const body = event.cwd || sessionCwd || "Open Pico to continue"
      const tag = event.sessionPath || event.sessionId || event.id
      const isPageForeground = isPageForegroundRef.current

      if (matchesCurrentSession) {
        if (!isPageForeground && key) {
          backgroundCurrentSessionUnreadKeyRef.current = key
          updateDocumentTitle()
        }

        if (sessionDoneDesktopNotificationsEnabled && !isPageForeground) {
          showSessionDoneDesktopNotification({
            title: label,
            body,
            tag,
          })
        }

        if (sessionDoneSoundEnabled && !isPageForeground && !playedSound) {
          playedSound = true
          void playSessionDoneSound()
        }
        continue
      }

      if (event.sessionId) {
        const sessionId = event.sessionId
        const toastId = event.id

        toast.success(label, {
          id: toastId,
          className: "cursor-pointer",
          action: (
            <button
              type="button"
              aria-label={`Open ${label}`}
              className="absolute inset-0 z-10 cursor-pointer rounded-[var(--border-radius)] bg-transparent p-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
              onClick={() => {
                toast.dismiss(toastId)
                onSelectSession(sessionId)
              }}
            />
          ),
        })
      } else {
        toast.success(label)
      }

      if (sessionDoneDesktopNotificationsEnabled && !isPageForeground) {
        showSessionDoneDesktopNotification({
          title: label,
          body,
          tag,
        })
      }

      if (sessionDoneSoundEnabled && !playedSound) {
        playedSound = true
        void playSessionDoneSound()
      }
    }

    onConsumeSessionDoneEvents(consumedIds)
  }, [
    activeSessionKey,
    activeSessionNotificationKey,
    onConsumeSessionDoneEvents,
    onSelectSession,
    sessionCwd,
    sessionDoneDesktopNotificationsEnabled,
    sessionDoneEvents,
    sessionDoneSoundEnabled,
  ])

  return null
}
