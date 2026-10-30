import * as React from "react"
import { toast } from "@/lib/pico/toast"

import {
  doneEventLabel,
  getCurrentAgentTitleFromState,
  agentNotificationKey,
  shallowRecordEqual,
} from "@/features/pico/app-shell-common"
import type { AppShellNotificationState } from "@/features/pico/app-shell-types"
import {
  playAgentDoneSound,
  primeAgentDoneSound,
  showAgentDoneDesktopNotification,
} from "@/features/pico/agent-done-notifications"
import type { AppShellSidebarStore } from "@/features/pico/app-shell-sidebar-store"
import {
  setStoreField,
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import type { AgentState } from "@/lib/pico"
import type { AgentDoneEvent } from "@/lib/pico/api"
import { hasPushSubscription } from "@/features/pico/agent/push"

/**
 * Shows the desktop notification for a finished agent. Web Push already
 * tells this browser about a finished agent run, so skip those to show only
 * one notification.
 */
function showDoneNotification(
  event: AgentDoneEvent,
  notification: { title: string; body: string; tag: string }
) {
  if (event.reason !== "agent") {
    showAgentDoneDesktopNotification(notification)
    return
  }
  void hasPushSubscription().then((subscribed) => {
    if (!subscribed) showAgentDoneDesktopNotification(notification)
  })
}

function getIsPageForeground() {
  if (typeof document === "undefined") return true

  return document.visibilityState === "visible" && document.hasFocus()
}

function getWindowTitleUnreadCount(
  sidebarUnreadVersion: string,
  backgroundCurrentAgentUnreadKey: string
) {
  const unreadKeys = new Set(
    sidebarUnreadVersion ? sidebarUnreadVersion.split("\n") : []
  )

  if (backgroundCurrentAgentUnreadKey) {
    unreadKeys.add(backgroundCurrentAgentUnreadKey)
  }

  return unreadKeys.size
}

function setPicoDocumentTitle({
  backgroundCurrentAgentUnreadKey,
  currentPageTitle,
  sidebarUnreadVersion,
}: {
  backgroundCurrentAgentUnreadKey: string
  currentPageTitle: string
  sidebarUnreadVersion: string
}) {
  const nextTitle = currentPageTitle
  const unreadAgentCount = getWindowTitleUnreadCount(
    sidebarUnreadVersion,
    backgroundCurrentAgentUnreadKey
  )

  document.title =
    unreadAgentCount > 0 ? `(${unreadAgentCount}) ${nextTitle}` : nextTitle
}

export function AppShellWindowEffectsHost({
  isAgentViewLoading,
  loadingDisplayAgentTitle,
  notificationStore,
  onSelectAgent,
  agentStore,
  sidebarStore,
}: {
  isAgentViewLoading: boolean
  loadingDisplayAgentTitle: string
  notificationStore: PicoStore<AppShellNotificationState>
  onSelectAgent: (nextAgentId?: string) => void
  agentStore: PicoStore<AgentState>
  sidebarStore: AppShellSidebarStore
}) {
  const agentWindowState = useSelector(
    agentStore,
    (agentState) => ({
      activeAgentKey: agentState.agentKey,
      activeAgentNotificationKey: agentNotificationKey({
        agentId: agentState.agentId,
        agentFile: agentState.agentFile,
      }),
      agentCwd: agentState.cwd,
      agentName: agentState.agentName,
      firstMessage: agentState.firstMessage,
      uiTitle: agentState.uiState.title?.trim() || "",
    }),
    { compare: shallowRecordEqual }
  )
  const notificationState = useSelector(notificationStore)
  React.useEffect(() => {
    if (!notificationState.agentDoneSoundEnabled) return

    const handleInteraction = () => {
      void primeAgentDoneSound()
    }

    window.addEventListener("pointerdown", handleInteraction, true)
    window.addEventListener("keydown", handleInteraction, true)

    return () => {
      window.removeEventListener("pointerdown", handleInteraction, true)
      window.removeEventListener("keydown", handleInteraction, true)
    }
  }, [notificationState.agentDoneSoundEnabled])

  const currentAgentTitle = getCurrentAgentTitleFromState(agentWindowState)
  const currentPageTitle = isAgentViewLoading
    ? loadingDisplayAgentTitle
    : agentWindowState.uiTitle ||
      (currentAgentTitle !== "New agent" ? currentAgentTitle : "Pico")
  const onConsumeAgentDoneEvents = (ids: Array<string>) => {
    const consumedIds = new Set(ids)
    setStoreField(notificationStore, "agentDoneEvents", (current) =>
      current.filter((event) => !consumedIds.has(event.id))
    )
  }

  return (
    <AppShellWindowEffects
      activeAgentKey={agentWindowState.activeAgentKey}
      activeAgentNotificationKey={agentWindowState.activeAgentNotificationKey}
      currentPageTitle={currentPageTitle}
      agentCwd={agentWindowState.agentCwd}
      agentDoneDesktopNotificationsEnabled={
        notificationState.agentDoneDesktopNotificationsEnabled
      }
      agentDoneSoundEnabled={notificationState.agentDoneSoundEnabled}
      agentDoneEvents={notificationState.agentDoneEvents}
      sidebarStore={sidebarStore}
      onConsumeAgentDoneEvents={onConsumeAgentDoneEvents}
      onSelectAgent={onSelectAgent}
    />
  )
}

function AppShellWindowEffects({
  activeAgentKey,
  activeAgentNotificationKey,
  currentPageTitle,
  agentCwd,
  agentDoneDesktopNotificationsEnabled,
  agentDoneSoundEnabled,
  agentDoneEvents,
  sidebarStore,
  onConsumeAgentDoneEvents,
  onSelectAgent,
}: {
  activeAgentKey?: string
  activeAgentNotificationKey: string
  currentPageTitle: string
  agentCwd?: string
  agentDoneDesktopNotificationsEnabled: boolean
  agentDoneSoundEnabled: boolean
  agentDoneEvents: Array<AgentDoneEvent>
  sidebarStore: AppShellSidebarStore
  onConsumeAgentDoneEvents: (ids: Array<string>) => void
  onSelectAgent: (nextAgentId?: string) => void
}) {
  const sidebarUnreadVersion = useSelector(sidebarStore, (snapshot) =>
    snapshot.derived.sidebarAgents
      .flatMap((agent) => {
        if (!agent.unread) return []
        const key = agentNotificationKey(agent)
        return key ? [key] : []
      })
      .sort()
      .join("\n")
  )
  const isPageForegroundRef = React.useRef(getIsPageForeground())
  const backgroundCurrentAgentUnreadKeyRef = React.useRef("")
  const titleSnapshotRef = React.useRef({
    currentPageTitle,
    sidebarUnreadVersion,
  })
  const processedAgentDoneEventIdsRef = React.useRef<Set<string>>(new Set())

  const updateDocumentTitle = () => {
    setPicoDocumentTitle({
      ...titleSnapshotRef.current,
      backgroundCurrentAgentUnreadKey:
        backgroundCurrentAgentUnreadKeyRef.current,
    })
  }

  React.useEffect(() => {
    titleSnapshotRef.current = {
      currentPageTitle,
      sidebarUnreadVersion,
    }
    updateDocumentTitle()
  }, [currentPageTitle, sidebarUnreadVersion])

  React.useEffect(() => {
    const syncPageForeground = () => {
      const isPageForeground = getIsPageForeground()
      isPageForegroundRef.current = isPageForeground

      if (isPageForeground || !activeAgentNotificationKey) {
        backgroundCurrentAgentUnreadKeyRef.current = ""
        updateDocumentTitle()
        return
      }

      const currentBackgroundKey = backgroundCurrentAgentUnreadKeyRef.current
      if (
        currentBackgroundKey &&
        currentBackgroundKey !== activeAgentNotificationKey
      ) {
        backgroundCurrentAgentUnreadKeyRef.current = ""
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
  }, [activeAgentNotificationKey])

  React.useEffect(() => {
    if (agentDoneEvents.length === 0) return

    const consumedIds: Array<string> = []
    let playedSound = false

    for (const event of agentDoneEvents) {
      consumedIds.push(event.id)
      if (processedAgentDoneEventIdsRef.current.has(event.id)) continue
      processedAgentDoneEventIdsRef.current.add(event.id)
      // The agent goes on when its timer, watch, or job fires.
      if (event.waiting) continue

      const key = agentNotificationKey({
        agentId: event.agentId,
        agentPath: event.agentPath,
      })
      const matchesCurrentAgent = Boolean(
        (key &&
          activeAgentNotificationKey &&
          key === activeAgentNotificationKey) ||
        (event.agentKey && activeAgentKey && event.agentKey === activeAgentKey)
      )
      const label = doneEventLabel(event)
      const body = event.cwd || agentCwd || "Open Pico to continue"
      const tag = event.agentPath || event.agentId || event.id
      const isPageForeground = isPageForegroundRef.current

      if (matchesCurrentAgent) {
        if (!isPageForeground && key) {
          backgroundCurrentAgentUnreadKeyRef.current = key
          updateDocumentTitle()
        }

        if (agentDoneDesktopNotificationsEnabled && !isPageForeground) {
          showDoneNotification(event, { title: label, body, tag })
        }

        if (agentDoneSoundEnabled && !isPageForeground && !playedSound) {
          playedSound = true
          void playAgentDoneSound()
        }
        continue
      }

      if (event.agentId) {
        const agentId = event.agentId
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
                onSelectAgent(agentId)
              }}
            />
          ),
        })
      } else {
        toast.success(label)
      }

      if (agentDoneDesktopNotificationsEnabled && !isPageForeground) {
        showDoneNotification(event, { title: label, body, tag })
      }

      if (agentDoneSoundEnabled && !playedSound) {
        playedSound = true
        void playAgentDoneSound()
      }
    }

    onConsumeAgentDoneEvents(consumedIds)
  }, [
    activeAgentKey,
    activeAgentNotificationKey,
    onConsumeAgentDoneEvents,
    onSelectAgent,
    agentCwd,
    agentDoneDesktopNotificationsEnabled,
    agentDoneEvents,
    agentDoneSoundEnabled,
  ])

  return null
}
