import * as React from "react"
import { toast } from "@/lib/smith/toast"

import {
  doneEventLabel,
  getCurrentAgentTitleFromState,
  agentNotificationKey,
  shallowRecordEqual,
} from "@/features/smith/app-shell-common"
import type { AppShellNotificationState } from "@/features/smith/app-shell-types"
import {
  playAgentDoneSound,
  primeAgentDoneSound,
  showAgentDoneDesktopNotification,
} from "@/features/smith/agent-done-notifications"
import type { AppShellSidebarStore } from "@/features/smith/app-shell-sidebar-store"
import {
  setStoreField,
  useSelector,
  type SmithStore,
} from "@/features/smith/tanstack-store-utils"
import type { AgentState } from "@/lib/smith"
import type { AgentDoneEvent } from "@/lib/smith/api"
import { hasPushSubscription } from "@/features/smith/agent/push"

/**
 * Shows the desktop notification for a finished agent. Web Push already
 * tells this browser about a finished agent turn, so skip those to show only
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

/**
 * What the agents of the shown machine do, for one symbol in front of the
 * window title. The most urgent state wins:
 * - "question" (❓): an agent waits for the user's answer. Only this needs
 *   the user, so it shows also while other agents work.
 * - "working" (a moon that goes through its phases): an agent runs a turn.
 * - "waiting" (⏳): an agent waits on a job, a timer, or a watch, and no
 *   agent works: work continues later by itself.
 * - "idle": no symbol.
 */
export type TitleActivity = "question" | "working" | "waiting" | "idle"

const TITLE_WORKING_FRAMES = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"]
const TITLE_WORKING_INTERVAL_MS = 500

export function titleActivity(
  agents: ReadonlyArray<{
    streaming?: boolean
    needsInput?: boolean
    waiting?: string
  }>,
  currentAgent: { question: boolean; working: boolean }
): TitleActivity {
  if (currentAgent.question || agents.some((agent) => agent.needsInput))
    return "question"
  if (currentAgent.working || agents.some((agent) => agent.streaming))
    return "working"
  if (agents.some((agent) => agent.waiting)) return "waiting"
  return "idle"
}

function titleActivityPrefix(activity: TitleActivity, frameIndex: number) {
  switch (activity) {
    case "question":
      return "❓ "
    case "working":
      return `${TITLE_WORKING_FRAMES[frameIndex]} `
    case "waiting":
      return "⏳ "
    case "idle":
      return ""
  }
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

function setSmithDocumentTitle({
  backgroundCurrentAgentUnreadKey,
  currentPageTitle,
  activity,
  sidebarUnreadVersion,
  titleWorkingFrameIndex,
}: {
  backgroundCurrentAgentUnreadKey: string
  currentPageTitle: string
  activity: TitleActivity
  sidebarUnreadVersion: string
  titleWorkingFrameIndex: number
}) {
  const nextTitle = `${titleActivityPrefix(activity, titleWorkingFrameIndex)}${currentPageTitle}`
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
  notificationStore: SmithStore<AppShellNotificationState>
  onSelectAgent: (nextAgentId?: string) => void
  agentStore: SmithStore<AgentState>
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
      // A question to the user keeps the turn open, but the agent waits.
      agentQuestion: Boolean(agentState.uiRequest),
      agentWorking: agentState.streaming && !agentState.uiRequest,
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
      (currentAgentTitle !== "New agent" ? currentAgentTitle : "Smith")
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
      currentAgentQuestion={agentWindowState.agentQuestion}
      currentAgentWorking={agentWindowState.agentWorking}
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
  currentAgentQuestion,
  currentAgentWorking,
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
  currentAgentQuestion: boolean
  currentAgentWorking: boolean
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
  // The open agent's own state counts too, so its symbol changes at once.
  const activity = useSelector(sidebarStore, (snapshot) =>
    titleActivity(snapshot.derived.sidebarAgents, {
      question: currentAgentQuestion,
      working: currentAgentWorking,
    })
  )
  const agentWorking = activity === "working"
  const isPageForegroundRef = React.useRef(getIsPageForeground())
  const backgroundCurrentAgentUnreadKeyRef = React.useRef("")
  const titleWorkingFrameIndexRef = React.useRef(0)
  const titleSnapshotRef = React.useRef({
    currentPageTitle,
    activity,
    sidebarUnreadVersion,
  })
  const processedAgentDoneEventIdsRef = React.useRef<Set<string>>(new Set())

  const updateDocumentTitle = () => {
    setSmithDocumentTitle({
      ...titleSnapshotRef.current,
      backgroundCurrentAgentUnreadKey:
        backgroundCurrentAgentUnreadKeyRef.current,
      titleWorkingFrameIndex: titleWorkingFrameIndexRef.current,
    })
  }

  React.useEffect(() => {
    titleSnapshotRef.current = {
      currentPageTitle,
      activity,
      sidebarUnreadVersion,
    }
    updateDocumentTitle()
  }, [currentPageTitle, activity, sidebarUnreadVersion])

  React.useEffect(() => {
    if (!agentWorking) {
      titleWorkingFrameIndexRef.current = 0
      updateDocumentTitle()
      return
    }

    const intervalId = window.setInterval(() => {
      titleWorkingFrameIndexRef.current =
        (titleWorkingFrameIndexRef.current + 1) % TITLE_WORKING_FRAMES.length
      updateDocumentTitle()
    }, TITLE_WORKING_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [agentWorking])

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
      const body = event.cwd || agentCwd || "Open Smith to continue"
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
