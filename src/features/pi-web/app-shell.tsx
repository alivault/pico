import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpToLineIcon,
  EllipsisIcon,
  PlusIcon,
  SparklesIcon,
  SplitIcon,
  WaypointsIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { toast } from "sonner"

import type { DesktopNotificationPermission } from "@/features/pi-web/session-done-notifications"
import type {
  PromptImage,
  SessionState,
  StreamingBehavior,
  ThemeMode,
} from "@/lib/pi-web"
import type {
  DeleteSessionResponse,
  DirectoryResolveResponse,
  DirectorySessionsIndexResponse,
  ExtensionUiEvent,
  FileCompletionsResponse,
  ForkSessionResponse,
  ForkableMessagesResponse,
  GitChangesResponse,
  GitStatusResponse,
  NavigateSessionTreeResponse,
  PathCompletionsResponse,
  PendingMessageRemoveResponse,
  PendingMessagesResponse,
  PiWebServerEvent,
  PromptResponse,
  RenameSessionResponse,
  SessionListEntry,
  SessionTreeResponse,
  SessionsEvent,
  SimpleOkResponse,
  UiRequestResponse,
} from "@/lib/pi-web-api"
import type { AppCommand } from "@/features/pi-web/app-shell-command-palette"
import type { ComposerPanelHandle } from "@/features/pi-web/composer-panel"
import type { SlashCommandDescriptor } from "@/features/pi-web/composer-utils"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AppShellCommandPalette } from "@/features/pi-web/app-shell-command-palette"
import { AppShellDialogs } from "@/features/pi-web/app-shell-dialogs"
import {
  buildRequestUrl,
  fetchJson,
  readFileAsPromptImage,
  updateStateFromSync,
} from "@/features/pi-web/app-shell-utils"
import { ComposerPanel } from "@/features/pi-web/composer-panel"
import {
  getDesktopNotificationPermission,
  playSessionDoneSound,
  primeSessionDoneSound,
  requestDesktopNotificationPermission,
  showSessionDoneDesktopNotification,
} from "@/features/pi-web/session-done-notifications"
import {
  AssistantMessageCard,
  MessagesWorkingIndicator,
  UserMessageCard,
  conversationItemSignature,
} from "@/features/pi-web/conversation-view"
import {
  parseComposerSkillMessage,
  serializeComposerDraft,
} from "@/features/pi-web/composer-utils"
import { GitPanel } from "@/features/pi-web/git-panel"
import { AppSidebar } from "@/features/pi-web/sidebar"
import {
  COLLAPSED_DIRECTORIES_STORAGE_KEY,
  DIRECTORY_SESSION_LOAD_MORE_COUNT,
  DRAFT_DIRECTORY_STORAGE_KEY,
  HIDE_TOOL_BLOCKS_STORAGE_KEY,
  INITIAL_DIRECTORY_SESSION_RENDER_COUNT,
  RECENT_DIRECTORIES_LIMIT,
  RECENT_DIRECTORIES_STORAGE_KEY,
  SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY,
  SESSION_DONE_SOUND_ENABLED_STORAGE_KEY,
  SIDEBAR_DIRECTORIES_STORAGE_KEY,
  VIEWER_CONTEXT_STORAGE_KEY,
  clampSidebarDirectories,
  createContextId,
  createInitialSessionState,
  flattenTree,
  getSessionTitle,
  normalizePromptImage,
  normalizeSessionSelectionKeys,
  normalizeStoredDirectoryList,
  normalizeThemeMode,
  promptDraftKey,
  readStoredCollapsedDirectories,
  readStoredDraftDirectory,
  readStoredHideToolBlocks,
  readStoredPromptDraft,
  readStoredRecentDirectories,
  readStoredSessionDoneDesktopNotificationsEnabled,
  readStoredSessionDoneSoundEnabled,
  readStoredSidebarDirectories,
  relativeTime,
  rememberStoredPromptDraft,
  safeLocalStorageSetItem,
  sessionListEntryKey,
  themeModeLabel,
} from "@/lib/pi-web"
import {
  isApiErrorResponse,
  isSessionsEvent,
  isStateSyncEvent,
} from "@/lib/pi-web-api"

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

function hasSelectedText(target: EventTarget | null) {
  const selection =
    typeof document.getSelection === "function" ? document.getSelection() : null

  if (selection && !selection.isCollapsed && String(selection).length > 0) {
    return true
  }

  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return (
      typeof target.selectionStart === "number" &&
      typeof target.selectionEnd === "number" &&
      target.selectionStart !== target.selectionEnd
    )
  }

  return false
}

function findMessageViewport(root: HTMLElement | null) {
  if (!root) return null
  return root.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]')
}

function isViewportNearBottom(viewport: HTMLDivElement, threshold = 48) {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < threshold
}

const TITLE_STREAMING_FRAMES = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"]
const TITLE_STREAMING_INTERVAL_MS = 500

function sessionNotificationKey(sessionLike: {
  sessionFile?: string
  path?: string
  sessionId?: string
  id?: string
}) {
  const sessionFile = (sessionLike.sessionFile || sessionLike.path || "").trim()
  if (sessionFile) return `path:${sessionFile}`

  const sessionId = (sessionLike.sessionId || sessionLike.id || "").trim()
  if (sessionId) return `id:${sessionId}`

  return ""
}

function finishedSessionLabel(title: string) {
  return title !== "New session" ? `Session finished: ${title}` : "Session finished"
}

function previousMessageJumpTarget(viewport: HTMLDivElement) {
  const anchors = [...viewport.querySelectorAll<HTMLElement>("[data-message-anchor='true']")]
  if (anchors.length === 0) return null

  const viewportTop = viewport.scrollTop + 8
  let candidate: HTMLElement | null = null

  for (const anchor of anchors) {
    if (anchor.offsetTop < viewportTop - 8) {
      candidate = anchor
      continue
    }

    if (candidate) {
      break
    }
  }

  return candidate
}

export function PiWebAppShell({
  sessionId,
  onSelectSession,
}: {
  sessionId?: string
  onSelectSession?: (sessionId?: string) => void
}) {
  const [viewerContextId, setViewerContextId] = React.useState("")
  const [sessionState, setSessionState] = React.useState<SessionState>(
    createInitialSessionState()
  )
  const [sessionsEvent, setSessionsEvent] =
    React.useState<SessionsEvent | null>(null)
  const [directoryIndexes, setDirectoryIndexes] = React.useState<
    Record<string, Array<SessionListEntry>>
  >({})
  const [directoryIndexLoading, setDirectoryIndexLoading] = React.useState<
    Record<string, boolean>
  >({})
  const [sidebarDirectories, setSidebarDirectories] = React.useState<
    Array<string>
  >([])
  const [collapsedDirectories, setCollapsedDirectories] = React.useState<
    Record<string, boolean>
  >({})
  const [directoryRenderCounts, setDirectoryRenderCounts] = React.useState<
    Record<string, number>
  >({})
  const [sessionSearch, setSessionSearch] = React.useState("")
  const [currentTab, setCurrentTab] = React.useState("session")
  const [composerText, setComposerText] = React.useState("")
  const [composerSkill, setComposerSkill] = React.useState<string | undefined>()
  const [composerImages, setComposerImages] = React.useState<
    Array<PromptImage>
  >([])
  const [hideToolBlocks, setHideToolBlocks] = React.useState(false)
  const [awaitingFirstTurn, setAwaitingFirstTurn] = React.useState(false)
  const [runningSlashCommand, setRunningSlashCommand] = React.useState<
    string | null
  >(null)
  const [draftSessionLoadingOwnerKey, setDraftSessionLoadingOwnerKey] =
    React.useState<string | null>(null)
  const [pendingDraftPrompt, setPendingDraftPrompt] = React.useState<
    | {
        ownerKey: string
        message: string
        images: Array<PromptImage>
        streamingBehavior?: StreamingBehavior
      }
    | null
  >(null)
  const [pendingDraftFollowUps, setPendingDraftFollowUps] = React.useState<
    Array<{
      message: string
      images: Array<PromptImage>
      streamingBehavior: "steer" | "followUp"
    }>
  >([])
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [pendingMessages, setPendingMessages] = React.useState<
    Array<{
      pendingId: string
      text: string
      images: Array<PromptImage>
      streamingBehavior: "steer" | "followUp"
    }>
  >([])
  const [gitStatus, setGitStatus] = React.useState<GitStatusResponse | null>(
    null
  )
  const [gitChanges, setGitChanges] = React.useState<GitChangesResponse | null>(
    null
  )
  const [gitLoading, setGitLoading] = React.useState(false)
  const [addDirectoryOpen, setAddDirectoryOpen] = React.useState(false)
  const [directoryInput, setDirectoryInput] = React.useState("")
  const [recentDirectories, setRecentDirectories] = React.useState<Array<string>>([])
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [renameTarget, setRenameTarget] = React.useState<SessionListEntry | null>(
    null
  )
  const [renameValue, setRenameValue] = React.useState("")
  const [deleteTargets, setDeleteTargets] = React.useState<
    Array<SessionListEntry>
  >([])
  const [forkOpen, setForkOpen] = React.useState(false)
  const [forkMessages, setForkMessages] = React.useState<Array<{
    entryId: string
    text: string
  }> | null>(null)
  const [forkLoading, setForkLoading] = React.useState(false)
  const [treeOpen, setTreeOpen] = React.useState(false)
  const [treeLoading, setTreeLoading] = React.useState(false)
  const [treeSubmitting, setTreeSubmitting] = React.useState(false)
  const [treeData, setTreeData] = React.useState<SessionTreeResponse | null>(
    null
  )
  const [treeQuery, setTreeQuery] = React.useState("")
  const [selectedTreeNodeId, setSelectedTreeNodeId] = React.useState<
    string | null
  >(null)
  const [selectedTreeNodeLabel, setSelectedTreeNodeLabel] = React.useState("")
  const [pendingUiRequest, setPendingUiRequest] =
    React.useState<ExtensionUiEvent | null>(null)
  const [pendingUiValue, setPendingUiValue] = React.useState("")
  const [commandPaletteOpen, setCommandPaletteOpen] = React.useState(false)
  const [statusOpen, setStatusOpen] = React.useState(false)
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [selectedSidebarSessionKeys, setSelectedSidebarSessionKeys] =
    React.useState<Array<string>>([])
  const [sidebarSessionSelectionAnchor, setSidebarSessionSelectionAnchor] =
    React.useState("")
  const [sessionDoneSoundEnabled, setSessionDoneSoundEnabled] =
    React.useState(true)
  const [
    sessionDoneDesktopNotificationsEnabled,
    setSessionDoneDesktopNotificationsEnabled,
  ] = React.useState(true)
  const [desktopNotificationPermission, setDesktopNotificationPermission] =
    React.useState<DesktopNotificationPermission>("unsupported")
  const [isPageForeground, setIsPageForeground] = React.useState(() =>
    typeof document === "undefined"
      ? true
      : document.visibilityState === "visible" && document.hasFocus()
  )
  const [titleStreamingFrameIndex, setTitleStreamingFrameIndex] =
    React.useState(0)
  const [backgroundCurrentSessionUnreadKey, setBackgroundCurrentSessionUnreadKey] =
    React.useState("")
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const sessionSearchInputRef = React.useRef<HTMLInputElement | null>(null)
  const composerPanelRef = React.useRef<ComposerPanelHandle | null>(null)
  const messagesScrollAreaRef = React.useRef<HTMLDivElement | null>(null)
  const bottomRef = React.useRef<HTMLDivElement | null>(null)
  const messageViewportRef = React.useRef<HTMLDivElement | null>(null)
  const [isMessagesNearBottom, setIsMessagesNearBottom] = React.useState(true)
  const [hasPreviousMessageJumpTarget, setHasPreviousMessageJumpTarget] =
    React.useState(false)
  const lastStreamingRef = React.useRef(false)
  const lastSyncedEditorTextRef = React.useRef("")
  const sessionStateRef = React.useRef(sessionState)
  const composerTextRef = React.useRef(composerText)
  const composerSkillRef = React.useRef<string | undefined>(composerSkill)
  const loadedDirectoryRevisionRef = React.useRef<Record<string, string>>({})
  const pendingRouteSessionIdRef = React.useRef<string | undefined>(undefined)
  const lastEscapePressedAtRef = React.useRef(0)
  const sessionUnreadSnapshotsRef = React.useRef<Map<string, boolean>>(new Map())
  const sessionUnreadSnapshotsReadyRef = React.useRef(false)

  const { resolvedTheme, setTheme, theme } = useTheme()
  const currentTheme = normalizeThemeMode(theme)
  const currentThemeLabel = themeModeLabel(currentTheme, resolvedTheme)

  const activeSessionId = sessionState.sessionId || sessionId
  const directoryStates = sessionsEvent?.directoryStates || []
  const directoryStateByPath = React.useMemo(
    () => new Map(directoryStates.map((state) => [state.path, state])),
    [directoryStates]
  )
  const currentSessionTitle = getSessionTitle({
    title:
      sessionState.sessionName || sessionState.firstMessage || "New session",
    name: sessionState.sessionName,
  })
  const activeSessionNotificationKey = sessionNotificationKey({
    sessionId: sessionState.sessionId,
    sessionFile: sessionState.sessionFile,
  })
  const currentPageTitle =
    sessionState.uiState.title?.trim() ||
    (currentSessionTitle !== "New session" ? currentSessionTitle : "Pi to Go")
  const statusCount = Object.entries(sessionState.uiState.statuses).filter(
    ([key, value]) => key.trim().length > 0 && value.trim().length > 0
  ).length
  const deleteOpen = deleteTargets.length > 0

  React.useEffect(() => {
    sessionStateRef.current = sessionState
  }, [sessionState])

  React.useEffect(() => {
    composerTextRef.current = composerText
  }, [composerText])

  React.useEffect(() => {
    composerSkillRef.current = composerSkill
  }, [composerSkill])

  const updateComposerDraft = React.useCallback(
    (value: string, target = sessionStateRef.current) => {
      const parsed = parseComposerSkillMessage(value)
      const nextText = parsed.matched ? parsed.text : value
      const nextSkill = parsed.matched ? parsed.skillName : undefined

      composerTextRef.current = nextText
      composerSkillRef.current = nextSkill
      setComposerText(nextText)
      setComposerSkill(nextSkill)
      rememberStoredPromptDraft(
        target,
        serializeComposerDraft({ text: nextText, skillName: nextSkill })
      )
    },
    []
  )

  React.useEffect(() => {
    const storedContext = window.localStorage.getItem(
      VIEWER_CONTEXT_STORAGE_KEY
    )
    const nextContext = storedContext?.trim() || createContextId()
    safeLocalStorageSetItem(VIEWER_CONTEXT_STORAGE_KEY, nextContext)
    setViewerContextId(nextContext)

    const storedDirectories = readStoredSidebarDirectories()
    const nextDirectories = normalizeStoredDirectoryList(
      storedDirectories.directories
    )
    setSidebarDirectories(nextDirectories)
    setCollapsedDirectories(readStoredCollapsedDirectories())
    setSessionDoneSoundEnabled(readStoredSessionDoneSoundEnabled())
    setSessionDoneDesktopNotificationsEnabled(
      readStoredSessionDoneDesktopNotificationsEnabled()
    )
    setHideToolBlocks(readStoredHideToolBlocks())
    setRecentDirectories(readStoredRecentDirectories())
    setDesktopNotificationPermission(getDesktopNotificationPermission())
  }, [])

  React.useEffect(() => {
    if (!sessionDoneSoundEnabled) return

    const handleInteraction = () => {
      void primeSessionDoneSound()
    }

    window.addEventListener("pointerdown", handleInteraction, true)
    window.addEventListener("keydown", handleInteraction, true)

    return () => {
      window.removeEventListener("pointerdown", handleInteraction, true)
      window.removeEventListener("keydown", handleInteraction, true)
    }
  }, [sessionDoneSoundEnabled])

  const openCommandPalette = React.useCallback(() => {
    setStatusOpen(false)
    setShortcutsOpen(false)
    setSettingsOpen(false)
    setCommandPaletteOpen(true)
  }, [])

  const openStatusDialog = React.useCallback(() => {
    setCommandPaletteOpen(false)
    setShortcutsOpen(false)
    setSettingsOpen(false)
    setStatusOpen(true)
  }, [])

  const openShortcutsDialog = React.useCallback(() => {
    setCommandPaletteOpen(false)
    setStatusOpen(false)
    setSettingsOpen(false)
    setShortcutsOpen(true)
  }, [])

  const openSettingsDialog = React.useCallback(() => {
    setCommandPaletteOpen(false)
    setStatusOpen(false)
    setShortcutsOpen(false)
    setSettingsOpen(true)
  }, [])

  const openRenameDialog = React.useCallback(() => {
    setRenameTarget(null)
    setRenameValue(sessionState.sessionName || currentSessionTitle)
    setRenameOpen(true)
  }, [currentSessionTitle, sessionState.sessionName])

  const focusSessionSearch = React.useCallback(() => {
    sessionSearchInputRef.current?.focus()
    sessionSearchInputRef.current?.select()
  }, [])

  const focusModelSelector = React.useCallback(() => {
    composerPanelRef.current?.openModelPicker()
  }, [])

  const handleSessionDoneSoundEnabledChange = React.useCallback(
    (enabled: boolean) => {
      setSessionDoneSoundEnabled(enabled)
      safeLocalStorageSetItem(
        SESSION_DONE_SOUND_ENABLED_STORAGE_KEY,
        enabled ? "1" : "0"
      )

      if (enabled) {
        void primeSessionDoneSound()
      }
    },
    []
  )

  const handleSessionDoneDesktopNotificationsEnabledChange = React.useCallback(
    async (enabled: boolean) => {
      setSessionDoneDesktopNotificationsEnabled(enabled)
      safeLocalStorageSetItem(
        SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY,
        enabled ? "1" : "0"
      )

      if (!enabled) {
        return
      }

      const permission = await requestDesktopNotificationPermission()
      setDesktopNotificationPermission(permission)

      if (permission === "denied") {
        toast.info(
          "Allow notifications for this site in your browser to receive desktop alerts."
        )
      } else if (permission === "unsupported") {
        toast.error("Desktop notifications are unavailable in this browser.")
      }
    },
    []
  )

  React.useEffect(() => {
    if (!sessionsEvent?.directories) return
    setSidebarDirectories((current) => {
      const next = clampSidebarDirectories(
        current.length > 0 ? current : (sessionsEvent.directories ?? []),
        sessionState.cwd
      )
      if (JSON.stringify(current) === JSON.stringify(next)) {
        return current
      }
      safeLocalStorageSetItem(
        SIDEBAR_DIRECTORIES_STORAGE_KEY,
        JSON.stringify(next)
      )
      return next
    })
  }, [sessionsEvent?.directories, sessionState.cwd])

  const handleSelectSession = React.useCallback(
    (nextSessionId?: string) => {
      pendingRouteSessionIdRef.current = nextSessionId
      onSelectSession?.(nextSessionId)
    },
    [onSelectSession]
  )

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
  }, [sessionId, sessionState.sessionId])

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

        updateComposerDraft(nextPromptText, nextState)
        lastSyncedEditorTextRef.current = nextState.uiState.editorText || ""
        setPendingMessages(
          Array.isArray(payload.pendingUserMessages)
            ? payload.pendingUserMessages.map((message) => ({
                pendingId:
                  typeof message.pendingId === "string"
                    ? message.pendingId
                    : "",
                text: typeof message.text === "string" ? message.text : "",
                images: Array.isArray(message.images)
                  ? message.images
                      .map((image: unknown) => normalizePromptImage(image))
                      .filter(
                        (image: PromptImage | null): image is PromptImage =>
                          Boolean(image)
                      )
                  : [],
                streamingBehavior:
                  message.streamingBehavior === "steer" ? "steer" : "followUp",
              }))
            : []
        )
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
          else if (payload.notifyType === "warning")
            toast.warning(notifyMessage)
          else if (payload.notifyType === "error") toast.error(notifyMessage)
          else toast.info(notifyMessage)
          return
        }

        setPendingUiRequest(payload)
        setPendingUiValue(payload.prefill || "")
        return
      }
    }

    return () => {
      source.close()
    }
  }, [sessionId, updateComposerDraft, viewerContextId])

  React.useEffect(() => {
    if (!sessionState.sessionId) return

    const pendingRouteSessionId = pendingRouteSessionIdRef.current
    if (pendingRouteSessionId) {
      if (sessionState.sessionId === pendingRouteSessionId) {
        pendingRouteSessionIdRef.current = undefined
      }
      return
    }

    if (sessionState.sessionId !== sessionId) {
      handleSelectSession(sessionState.sessionId)
    }
  }, [handleSelectSession, sessionId, sessionState.sessionId])

  const [storedDraftDirectory, setStoredDraftDirectory] = React.useState("")

  React.useEffect(() => {
    setStoredDraftDirectory(readStoredDraftDirectory() || "")
  }, [])

  React.useEffect(() => {
    const nextDirectory = sessionState.cwd?.trim()
    if (!nextDirectory) return
    safeLocalStorageSetItem(DRAFT_DIRECTORY_STORAGE_KEY, nextDirectory)
    setStoredDraftDirectory(nextDirectory)
  }, [sessionState.cwd])

  React.useEffect(() => {
    const syncPageForeground = () => {
      setIsPageForeground(
        document.visibilityState === "visible" && document.hasFocus()
      )
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
  }, [])

  React.useEffect(() => {
    if (isPageForeground || !activeSessionNotificationKey) {
      setBackgroundCurrentSessionUnreadKey("")
      return
    }

    setBackgroundCurrentSessionUnreadKey((current) =>
      current && current !== activeSessionNotificationKey ? "" : current
    )
  }, [activeSessionNotificationKey, isPageForeground])

  React.useEffect(() => {
    if (!sessionState.streaming) {
      setTitleStreamingFrameIndex(0)
      return
    }

    const intervalId = window.setInterval(() => {
      setTitleStreamingFrameIndex(
        (current) => (current + 1) % TITLE_STREAMING_FRAMES.length
      )
    }, TITLE_STREAMING_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [sessionState.streaming])

  React.useEffect(() => {
    if (lastStreamingRef.current && !sessionState.streaming) {
      const finishedLabel = finishedSessionLabel(currentSessionTitle)
      toast.success(finishedLabel)

      if (!isPageForeground && activeSessionNotificationKey) {
        setBackgroundCurrentSessionUnreadKey(activeSessionNotificationKey)
      }

      if (sessionDoneDesktopNotificationsEnabled && !isPageForeground) {
        showSessionDoneDesktopNotification({
          title: finishedLabel,
          body: sessionState.cwd || "Open Pi to Go to continue",
          tag:
            sessionState.sessionFile || sessionState.sessionId || currentSessionTitle,
        })
      }

      if (sessionDoneSoundEnabled) {
        void playSessionDoneSound()
      }
    }
    lastStreamingRef.current = sessionState.streaming
  }, [
    activeSessionNotificationKey,
    currentSessionTitle,
    isPageForeground,
    sessionDoneDesktopNotificationsEnabled,
    sessionDoneSoundEnabled,
    sessionState.cwd,
    sessionState.sessionFile,
    sessionState.sessionId,
    sessionState.streaming,
  ])

  React.useEffect(() => {
    const viewport = findMessageViewport(messagesScrollAreaRef.current)
    messageViewportRef.current = viewport
    if (!viewport) return

    const syncScrollState = () => {
      setIsMessagesNearBottom(isViewportNearBottom(viewport))
      setHasPreviousMessageJumpTarget(Boolean(previousMessageJumpTarget(viewport)))
    }

    syncScrollState()
    viewport.addEventListener("scroll", syncScrollState, { passive: true })
    return () => {
      viewport.removeEventListener("scroll", syncScrollState)
    }
  }, [])

  React.useEffect(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    if (!isMessagesNearBottom && !sessionState.streaming) return

    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [isMessagesNearBottom, sessionState.streaming])

  React.useEffect(() => {
    if (
      !viewerContextId ||
      !sessionState.draft ||
      sessionState.items.length > 0 ||
      !sessionState.cwd
    ) {
      return
    }

    void fetchJson<GitStatusResponse>(
      buildRequestUrl(`/api/git-status?cwd=${encodeURIComponent(sessionState.cwd)}`, {
        contextId: viewerContextId,
        sessionId: activeSessionId,
      })
    )
      .then((response) => {
        setGitStatus(response)
      })
      .catch(() => {
        // Ignore draft card git summary failures.
      })
  }, [
    activeSessionId,
    sessionState.cwd,
    sessionState.draft,
    sessionState.items.length,
    viewerContextId,
  ])

  const loadDirectoryIndex = React.useCallback(
    async (directory: string, revision?: string) => {
      if (!viewerContextId) return

      setDirectoryIndexLoading((current) => {
        if (current[directory]) {
          return current
        }

        return { ...current, [directory]: true }
      })

      try {
        const response = await fetchJson<DirectorySessionsIndexResponse>(
          buildRequestUrl(
            `/api/directory-sessions-index?directory=${encodeURIComponent(
              directory
            )}`,
            {
              contextId: viewerContextId,
              sessionId: activeSessionId,
            }
          )
        )

        if (isApiErrorResponse(response)) {
          throw new Error(response.error)
        }

        loadedDirectoryRevisionRef.current[directory] =
          revision || `loaded:${response.sessions.length}`

        setDirectoryIndexes((current) => ({
          ...current,
          [directory]: response.sessions,
        }))
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : `Failed to load sessions for ${directory}`
        )
      } finally {
        setDirectoryIndexLoading((current) => {
          if (!current[directory]) {
            return current
          }

          return {
            ...current,
            [directory]: false,
          }
        })
      }
    },
    [activeSessionId, viewerContextId]
  )

  React.useEffect(() => {
    if (!viewerContextId || sidebarDirectories.length === 0) return

    for (const directory of sidebarDirectories) {
      const state = directoryStateByPath.get(directory)
      const hasCurrentSessions = Object.prototype.hasOwnProperty.call(
        directoryIndexes,
        directory
      )
      const isLoading = Boolean(directoryIndexLoading[directory])
      const loadedRevision = loadedDirectoryRevisionRef.current[directory]
      const needsInitialLoad = !hasCurrentSessions
      const needsRevisionRefresh =
        typeof state?.revision === "string" && state.revision !== loadedRevision

      if (!isLoading && (needsInitialLoad || needsRevisionRefresh)) {
        void loadDirectoryIndex(directory, state?.revision)
      }
    }
  }, [
    directoryIndexes,
    directoryIndexLoading,
    directoryStateByPath,
    loadDirectoryIndex,
    sidebarDirectories,
    viewerContextId,
  ])

  const refreshGit = React.useCallback(async () => {
    if (!viewerContextId || !sessionState.cwd) return
    setGitLoading(true)
    try {
      const [nextStatus, nextChanges] = await Promise.all([
        fetchJson<GitStatusResponse>(
          buildRequestUrl(
            `/api/git-status?cwd=${encodeURIComponent(sessionState.cwd)}`,
            {
              contextId: viewerContextId,
              sessionId: activeSessionId,
            }
          )
        ),
        fetchJson<GitChangesResponse>(
          buildRequestUrl(
            `/api/git-changes?cwd=${encodeURIComponent(sessionState.cwd)}`,
            {
              contextId: viewerContextId,
              sessionId: activeSessionId,
            }
          )
        ),
      ])
      setGitStatus(nextStatus)
      setGitChanges(nextChanges)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load git view"
      )
    } finally {
      setGitLoading(false)
    }
  }, [activeSessionId, sessionState.cwd, viewerContextId])

  React.useEffect(() => {
    if (currentTab === "git") {
      void refreshGit()
    }
  }, [currentTab, refreshGit])

  const baseSidebarDirectories = React.useMemo(
    () => clampSidebarDirectories(sidebarDirectories, sessionState.cwd),
    [sessionState.cwd, sidebarDirectories]
  )
  const defaultNewSessionDirectory =
    sessionState.cwd?.trim() ||
    baseSidebarDirectories[0] ||
    storedDraftDirectory ||
    ""
  const newSessionDirectoryOptions = React.useMemo(() => {
    const nextOptions: Array<{ path: string; label: string }> = []
    const seen = new Set<string>()
    const pushDirectoryOption = (path: string, label: string) => {
      const normalizedPath = path.trim()
      if (!normalizedPath || seen.has(normalizedPath)) return
      seen.add(normalizedPath)
      nextOptions.push({ path: normalizedPath, label })
    }

    if (sessionState.cwd?.trim()) {
      pushDirectoryOption(sessionState.cwd, "Current session directory")
    }
    if (storedDraftDirectory) {
      pushDirectoryOption(storedDraftDirectory, "Draft directory")
    }
    for (const directory of baseSidebarDirectories) {
      pushDirectoryOption(directory, "Sidebar directory")
    }

    return nextOptions
  }, [baseSidebarDirectories, sessionState.cwd, storedDraftDirectory])

  const knownDirectories = React.useMemo(
    () =>
      normalizeStoredDirectoryList([
        ...sidebarDirectories,
        sessionState.cwd || "",
        ...Array.from(directoryStateByPath.keys()),
        ...Object.values(directoryIndexes).flatMap((entries) =>
          entries.map((entry) => entry.cwd || "")
        ),
      ]),
    [directoryIndexes, directoryStateByPath, sessionState.cwd, sidebarDirectories]
  )

  const sidebarSearchPending = React.useMemo(() => {
    const query = sessionSearch.trim()
    if (!query) return false

    return baseSidebarDirectories.some((directory) => {
      const totalCount = directoryStateByPath.get(directory)?.totalCount ?? 0
      const loadedCount = Object.prototype.hasOwnProperty.call(
        directoryIndexes,
        directory
      )
        ? directoryIndexes[directory].length
        : 0
      const loading = Boolean(directoryIndexLoading[directory])
      return loading || (!loadedCount && totalCount > 0)
    })
  }, [
    baseSidebarDirectories,
    directoryIndexes,
    directoryIndexLoading,
    directoryStateByPath,
    sessionSearch,
  ])

  const {
    visibleDirectories,
    filteredDirectorySessions,
    emptySidebarStateText,
  } = React.useMemo(() => {
    const query = sessionSearch.trim().toLowerCase()
    const nextVisibleDirectories: Array<string> = []
    const nextFilteredSessions: Record<string, Array<SessionListEntry>> = {}

    for (const directory of baseSidebarDirectories) {
      const sessions = Object.prototype.hasOwnProperty.call(
        directoryIndexes,
        directory
      )
        ? directoryIndexes[directory]
        : []

      if (!query) {
        nextVisibleDirectories.push(directory)
        nextFilteredSessions[directory] = sessions
        continue
      }

      const directoryMatches = directory.toLowerCase().includes(query)
      const filteredSessions = directoryMatches
        ? sessions
        : sessions.filter((entry) => {
            const haystack = [entry.title, entry.name, entry.path, entry.cwd]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
            return haystack.includes(query)
          })

      if (directoryMatches || filteredSessions.length > 0) {
        nextVisibleDirectories.push(directory)
        nextFilteredSessions[directory] = filteredSessions
      }
    }

    return {
      visibleDirectories: nextVisibleDirectories,
      filteredDirectorySessions: nextFilteredSessions,
      emptySidebarStateText: query
        ? sidebarSearchPending
          ? "Searching sessions…"
          : "No sessions or directories match your search."
        : baseSidebarDirectories.length > 0
          ? "No directories match this view."
          : "No directories added yet.",
    }
  }, [
    baseSidebarDirectories,
    directoryIndexes,
    sessionSearch,
    sidebarSearchPending,
  ])

  const allDirectoriesCollapsed = React.useMemo(
    () =>
      baseSidebarDirectories.length > 0 &&
      baseSidebarDirectories.every(
        (directory) => collapsedDirectories[directory]
      ),
    [baseSidebarDirectories, collapsedDirectories]
  )

  const toggleAllDirectories = React.useCallback(() => {
    setCollapsedDirectories((current) => {
      const next = { ...current }
      const nextCollapsed = !allDirectoriesCollapsed

      for (const directory of baseSidebarDirectories) {
        if (nextCollapsed) {
          next[directory] = true
        } else {
          delete next[directory]
        }
      }

      safeLocalStorageSetItem(
        COLLAPSED_DIRECTORIES_STORAGE_KEY,
        JSON.stringify(next)
      )
      return next
    })
  }, [allDirectoriesCollapsed, baseSidebarDirectories])

  const reorderSidebarDirectories = React.useCallback(
    (
      sourceDirectory: string,
      targetDirectory: string,
      position: "before" | "after"
    ) => {
      const normalizedSource = sourceDirectory.trim()
      const normalizedTarget = targetDirectory.trim()
      if (!normalizedSource || !normalizedTarget) return
      if (normalizedSource === normalizedTarget) return

      setSidebarDirectories((current) => {
        const next = normalizeStoredDirectoryList(current)
        if (
          !next.includes(normalizedSource) ||
          !next.includes(normalizedTarget)
        ) {
          return current
        }

        const reordered = next.filter(
          (directory) => directory !== normalizedSource
        )
        const targetIndex = reordered.indexOf(normalizedTarget)
        const insertIndex =
          targetIndex < 0
            ? reordered.length
            : position === "before"
              ? targetIndex
              : targetIndex + 1

        reordered.splice(insertIndex, 0, normalizedSource)
        safeLocalStorageSetItem(
          SIDEBAR_DIRECTORIES_STORAGE_KEY,
          JSON.stringify(reordered)
        )
        return reordered
      })
    },
    []
  )

  const sidebarSessionEntriesByKey = React.useMemo(() => {
    const nextEntries = new Map<string, SessionListEntry>()

    for (const directory of baseSidebarDirectories) {
      const entries = Object.prototype.hasOwnProperty.call(
        directoryIndexes,
        directory
      )
        ? directoryIndexes[directory]
        : []

      for (const entry of entries) {
        const key = sessionListEntryKey(entry)
        if (!key || nextEntries.has(key)) continue
        nextEntries.set(key, entry)
      }
    }

    return nextEntries
  }, [baseSidebarDirectories, directoryIndexes])

  const sidebarSessions = React.useMemo(
    () => Array.from(sidebarSessionEntriesByKey.values()),
    [sidebarSessionEntriesByKey]
  )
  const unreadSessionCount = React.useMemo(() => {
    const unreadKeys = new Set<string>()

    for (const session of sidebarSessions) {
      const key = sessionNotificationKey(session)
      if (!key || !session.unread) continue
      unreadKeys.add(key)
    }

    if (
      backgroundCurrentSessionUnreadKey &&
      !unreadKeys.has(backgroundCurrentSessionUnreadKey)
    ) {
      unreadKeys.add(backgroundCurrentSessionUnreadKey)
    }

    return unreadKeys.size
  }, [backgroundCurrentSessionUnreadKey, sidebarSessions])

  React.useEffect(() => {
    const streamingPrefix = sessionState.streaming
      ? `${TITLE_STREAMING_FRAMES[titleStreamingFrameIndex]} `
      : ""
    const nextTitle = `${streamingPrefix}${currentPageTitle}`
    document.title =
      unreadSessionCount > 0 ? `(${unreadSessionCount}) ${nextTitle}` : nextTitle
  }, [
    currentPageTitle,
    titleStreamingFrameIndex,
    unreadSessionCount,
    sessionState.streaming,
  ])

  React.useEffect(() => {
    const nextSnapshots = new Map<string, boolean>()
    const finishedSessions: Array<SessionListEntry> = []

    for (const session of sidebarSessions) {
      const key = sessionNotificationKey(session)
      if (!key) continue

      const unread = Boolean(session.unread)
      const previous = sessionUnreadSnapshotsRef.current.get(key)
      if (sessionUnreadSnapshotsReadyRef.current && unread && !previous) {
        finishedSessions.push(session)
      }
      nextSnapshots.set(key, unread)
    }

    const ready = sessionUnreadSnapshotsReadyRef.current
    sessionUnreadSnapshotsRef.current = nextSnapshots
    sessionUnreadSnapshotsReadyRef.current = true
    if (!ready) return

    for (const [index, session] of finishedSessions.entries()) {
      const finishedLabel = finishedSessionLabel(session.title || "New session")
      toast.success(finishedLabel)

      if (sessionDoneDesktopNotificationsEnabled && !isPageForeground) {
        showSessionDoneDesktopNotification({
          title: finishedLabel,
          body: session.cwd || "Open Pi to Go to continue",
          tag: session.path || session.id || session.title,
        })
      }

      if (sessionDoneSoundEnabled && index === 0) {
        void playSessionDoneSound()
      }
    }
  }, [
    isPageForeground,
    sessionDoneDesktopNotificationsEnabled,
    sessionDoneSoundEnabled,
    sidebarSessions,
  ])

  const renderedSidebarSessionKeys = React.useMemo(() => {
    const searchActive = sessionSearch.trim().length > 0
    const nextKeys: Array<string> = []

    for (const directory of visibleDirectories) {
      if (!searchActive && collapsedDirectories[directory]) continue

      const sessions = Object.prototype.hasOwnProperty.call(
        filteredDirectorySessions,
        directory
      )
        ? filteredDirectorySessions[directory]
        : []
      const visibleCount = searchActive
        ? sessions.length
        : Math.min(
            sessions.length,
            directoryRenderCounts[directory] ??
              INITIAL_DIRECTORY_SESSION_RENDER_COUNT
          )

      for (const entry of sessions.slice(0, visibleCount)) {
        const key = sessionListEntryKey(entry)
        if (key) {
          nextKeys.push(key)
        }
      }
    }

    return nextKeys
  }, [
    collapsedDirectories,
    directoryRenderCounts,
    filteredDirectorySessions,
    sessionSearch,
    visibleDirectories,
  ])

  React.useEffect(() => {
    const validKeys = new Set(sidebarSessionEntriesByKey.keys())

    setSelectedSidebarSessionKeys((current) => {
      const next = normalizeSessionSelectionKeys(
        current.filter((key) => validKeys.has(key))
      )
      return current.length === next.length &&
        current.every((key, index) => key === next[index])
        ? current
        : next
    })

    setSidebarSessionSelectionAnchor((current) =>
      current && validKeys.has(current) ? current : ""
    )
  }, [sidebarSessionEntriesByKey])

  const selectedSidebarSessions = React.useMemo(
    () =>
      selectedSidebarSessionKeys
        .map((key) => sidebarSessionEntriesByKey.get(key))
        .filter((entry): entry is SessionListEntry =>
          Boolean(entry?.path || entry?.id)
        ),
    [selectedSidebarSessionKeys, sidebarSessionEntriesByKey]
  )

  const setSidebarSelection = React.useCallback(
    (nextKeys: Array<string>, anchorKey = "") => {
      const normalizedKeys = normalizeSessionSelectionKeys(nextKeys)
      setSelectedSidebarSessionKeys(normalizedKeys)
      setSidebarSessionSelectionAnchor(
        normalizedKeys.length === 0
          ? ""
          : anchorKey && normalizedKeys.includes(anchorKey)
            ? anchorKey
            : (normalizedKeys[normalizedKeys.length - 1] ?? "")
      )
    },
    []
  )

  const selectSidebarSessionRange = React.useCallback(
    (targetKey: string) => {
      const normalizedTargetKey = targetKey.trim()
      if (!normalizedTargetKey) return

      const orderedKeys = renderedSidebarSessionKeys
      const targetIndex = orderedKeys.indexOf(normalizedTargetKey)
      if (targetIndex < 0) {
        setSidebarSelection([normalizedTargetKey], normalizedTargetKey)
        return
      }

      const anchorKey = orderedKeys.includes(sidebarSessionSelectionAnchor)
        ? sidebarSessionSelectionAnchor
        : (selectedSidebarSessionKeys.find((key) =>
            orderedKeys.includes(key)
          ) ?? normalizedTargetKey)
      const anchorIndex = orderedKeys.indexOf(anchorKey)
      if (anchorIndex < 0) {
        setSidebarSelection([normalizedTargetKey], normalizedTargetKey)
        return
      }

      const start = Math.min(anchorIndex, targetIndex)
      const end = Math.max(anchorIndex, targetIndex)
      setSidebarSelection(orderedKeys.slice(start, end + 1), anchorKey)
    },
    [
      renderedSidebarSessionKeys,
      selectedSidebarSessionKeys,
      setSidebarSelection,
      sidebarSessionSelectionAnchor,
    ]
  )

  const openDeleteDialog = React.useCallback(
    (targets: Array<SessionListEntry>) => {
      const nextTargets: Array<SessionListEntry> = []
      const seenKeys = new Set<string>()

      for (const target of targets) {
        if (!target.path) continue
        const key = sessionListEntryKey(target)
        if (!key || seenKeys.has(key)) continue
        seenKeys.add(key)
        nextTargets.push(target)
      }

      if (nextTargets.length > 0) {
        setDeleteTargets(nextTargets)
      }
    },
    []
  )

  const openDeleteDialogForCurrentSession = React.useCallback(() => {
    if (!sessionState.sessionFile) return

    openDeleteDialog([
      {
        path: sessionState.sessionFile,
        id: sessionState.sessionId,
        title: currentSessionTitle,
        name: sessionState.sessionName,
        modified: sessionState.modified,
      },
    ])
  }, [
    currentSessionTitle,
    openDeleteDialog,
    sessionState.modified,
    sessionState.sessionFile,
    sessionState.sessionId,
    sessionState.sessionName,
  ])

  const handleSidebarSessionClick = React.useCallback(
    (
      entry: SessionListEntry,
      modifiers: { ctrlKey: boolean; shiftKey: boolean }
    ) => {
      const key = sessionListEntryKey(entry)

      if (!key) {
        if (entry.id) {
          handleSelectSession(entry.id)
        }
        return
      }

      if (modifiers.shiftKey) {
        selectSidebarSessionRange(key)
        return
      }

      if (modifiers.ctrlKey) {
        setSidebarSelection(
          selectedSidebarSessionKeys.includes(key)
            ? selectedSidebarSessionKeys.filter(
                (currentKey) => currentKey !== key
              )
            : [...selectedSidebarSessionKeys, key],
          key
        )
        return
      }

      setSidebarSelection([key], key)
      if (entry.id) {
        handleSelectSession(entry.id)
      }
    },
    [
      handleSelectSession,
      selectSidebarSessionRange,
      selectedSidebarSessionKeys,
      setSidebarSelection,
    ]
  )

  const openAddDirectoryDialog = React.useCallback(() => {
    setDirectoryInput("")
    setAddDirectoryOpen(true)
  }, [])

  const loadMoreDirectorySessions = React.useCallback((directory: string) => {
    setDirectoryRenderCounts((current) => ({
      ...current,
      [directory]:
        (current[directory] ?? INITIAL_DIRECTORY_SESSION_RENDER_COUNT) +
        DIRECTORY_SESSION_LOAD_MORE_COUNT,
    }))
  }, [])

  const rememberRecentDirectory = React.useCallback((directory: string) => {
    const normalizedDirectory = directory.trim()
    if (!normalizedDirectory) return

    setRecentDirectories((current) => {
      const next = normalizeStoredDirectoryList([
        normalizedDirectory,
        ...current,
      ]).slice(0, RECENT_DIRECTORIES_LIMIT)
      safeLocalStorageSetItem(
        RECENT_DIRECTORIES_STORAGE_KEY,
        JSON.stringify(next)
      )
      return next
    })
  }, [])

  const addDirectoryPath = React.useCallback(
    async (path: string) => {
      if (!viewerContextId) return
      const requestedPath = path.trim()
      if (!requestedPath) return

      try {
        const response = await fetchJson<DirectoryResolveResponse>(
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
        if (isApiErrorResponse(response)) {
          throw new Error(response.error)
        }
        setSidebarDirectories((current) => {
          const next = normalizeStoredDirectoryList([...current, response.path])
          safeLocalStorageSetItem(
            SIDEBAR_DIRECTORIES_STORAGE_KEY,
            JSON.stringify(next)
          )
          return next
        })
        rememberRecentDirectory(response.path)
        setDirectoryInput("")
        setAddDirectoryOpen(false)
        void loadDirectoryIndex(response.path)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to add directory"
        )
      }
    },
    [activeSessionId, loadDirectoryIndex, rememberRecentDirectory, viewerContextId]
  )

  const addDirectory = React.useCallback(async () => {
    await addDirectoryPath(directoryInput)
  }, [addDirectoryPath, directoryInput])

  const toggleDirectory = React.useCallback((directory: string) => {
    setCollapsedDirectories((current) => {
      const next = {
        ...current,
        [directory]: !current[directory],
      }
      safeLocalStorageSetItem(
        COLLAPSED_DIRECTORIES_STORAGE_KEY,
        JSON.stringify(next)
      )
      return next
    })
  }, [])

  const applyPendingDraftPromptToComposer = React.useCallback(
    (pendingPrompt: {
      message: string
      images: Array<PromptImage>
    }) => {
      updateComposerDraft(pendingPrompt.message)
      setComposerImages(
        pendingPrompt.images.map((image) => ({ ...image }))
      )
      return true
    },
    [updateComposerDraft]
  )

  const normalizeQueuedStreamingBehavior = React.useCallback(
    (streamingBehavior?: StreamingBehavior) =>
      streamingBehavior === "followUp" ? "followUp" : "steer",
    []
  )

  const restorePendingDraftPrompt = React.useCallback(
    (ownerKey: string) => {
      if (!pendingDraftPrompt || pendingDraftPrompt.ownerKey !== ownerKey) {
        return false
      }
      const nextPrompt = pendingDraftPrompt
      setPendingDraftPrompt(null)
      setPendingDraftFollowUps([])
      setAwaitingFirstTurn(false)
      return applyPendingDraftPromptToComposer(nextPrompt)
    },
    [applyPendingDraftPromptToComposer, pendingDraftPrompt]
  )

  const createSession = React.useCallback(async (cwdOverride?: string) => {
    if (!viewerContextId) return

    const nextCwd = cwdOverride || defaultNewSessionDirectory || undefined
    if (nextCwd) {
      rememberRecentDirectory(nextCwd)
      safeLocalStorageSetItem(DRAFT_DIRECTORY_STORAGE_KEY, nextCwd)
      setStoredDraftDirectory(nextCwd)
    }
    const ownerKey = promptDraftKey({ cwd: nextCwd })
    setDraftSessionLoadingOwnerKey(ownerKey)

    try {
      await fetchJson<SimpleOkResponse>(
        buildRequestUrl("/api/session/new", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cwd: nextCwd,
          }),
        }
      )
    } catch (error) {
      setDraftSessionLoadingOwnerKey((current) =>
        current === ownerKey ? null : current
      )
      restorePendingDraftPrompt(ownerKey)
      toast.error(
        error instanceof Error ? error.message : "Failed to create session"
      )
    }
  }, [
    activeSessionId,
    defaultNewSessionDirectory,
    rememberRecentDirectory,
    restorePendingDraftPrompt,
    viewerContextId,
  ])

  const queuePendingDraftPrompt = React.useCallback(
    (streamingBehavior?: StreamingBehavior) => {
      if (!draftSessionLoadingOwnerKey) return false

      const message = serializeComposerDraft({
        text: composerText,
        skillName: composerSkill,
      }).trim()
      const images = composerImages.map((image) => ({ ...image }))
      if (!message && images.length === 0) return false

      if (!pendingDraftPrompt) {
        setPendingDraftPrompt({
          ownerKey: draftSessionLoadingOwnerKey,
          message,
          images,
          streamingBehavior,
        })
      } else {
        setPendingDraftFollowUps((current) => [
          ...current,
          {
            message,
            images,
            streamingBehavior: normalizeQueuedStreamingBehavior(streamingBehavior),
          },
        ])
      }

      updateComposerDraft("")
      setComposerImages([])
      lastSyncedEditorTextRef.current = ""

      if (!pendingDraftPrompt) {
        toast.info("Prompt will send when the new session is ready.")
      }

      return true
    },
    [
      composerImages,
      composerSkill,
      composerText,
      draftSessionLoadingOwnerKey,
      normalizeQueuedStreamingBehavior,
      pendingDraftPrompt,
      updateComposerDraft,
    ]
  )

  const submitPrompt = React.useCallback(
    async (streamingBehavior?: StreamingBehavior) => {
      if (!viewerContextId) return false
      if (draftSessionLoadingOwnerKey) {
        return queuePendingDraftPrompt(streamingBehavior)
      }

      const message = serializeComposerDraft({
        text: composerText,
        skillName: composerSkill,
      }).trim()
      if (!message && composerImages.length === 0) return false

      const treatAsQueuedPrompt = Boolean(sessionState.streaming || awaitingFirstTurn)
      const normalizedStreamingBehavior = treatAsQueuedPrompt
        ? normalizeQueuedStreamingBehavior(streamingBehavior)
        : streamingBehavior

      setIsSubmitting(true)
      if (!treatAsQueuedPrompt) {
        setAwaitingFirstTurn(true)
      }

      try {
        const response = await fetchJson<PromptResponse>(
          buildRequestUrl("/api/prompt", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              message,
              images: composerImages,
              streamingBehavior: normalizedStreamingBehavior,
            }),
          }
        )
        if (isApiErrorResponse(response)) {
          throw new Error(response.error)
        }
        updateComposerDraft("")
        setComposerImages([])
        lastSyncedEditorTextRef.current = ""
        return true
      } catch (error) {
        if (!treatAsQueuedPrompt) {
          setAwaitingFirstTurn(false)
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
      awaitingFirstTurn,
      composerImages,
      composerSkill,
      composerText,
      draftSessionLoadingOwnerKey,
      normalizeQueuedStreamingBehavior,
      queuePendingDraftPrompt,
      sessionState.streaming,
      updateComposerDraft,
      viewerContextId,
    ]
  )

  const flushPendingDraftFollowUps = React.useCallback(async () => {
    if (draftSessionLoadingOwnerKey || pendingDraftFollowUps.length === 0) {
      return false
    }

    const followUps = pendingDraftFollowUps.map((entry) => ({
      message: entry.message,
      images: entry.images.map((image) => ({ ...image })),
      streamingBehavior: entry.streamingBehavior,
    }))

    setPendingDraftFollowUps([])

    for (const followUp of followUps) {
      try {
        await fetchJson<PromptResponse>(
          buildRequestUrl("/api/prompt", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              message: followUp.message,
              images: followUp.images,
              streamingBehavior: followUp.streamingBehavior,
            }),
          }
        )
      } catch (error) {
        if (!composerTextRef.current) {
          updateComposerDraft(followUp.message)
          setComposerImages(followUp.images)
        }
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to submit queued follow-up"
        )
        return false
      }
    }

    return true
  }, [
    activeSessionId,
    draftSessionLoadingOwnerKey,
    pendingDraftFollowUps,
    updateComposerDraft,
    viewerContextId,
  ])

  const flushPendingDraftPrompt = React.useCallback(
    async (ownerKey: string) => {
      if (
        !pendingDraftPrompt ||
        pendingDraftPrompt.ownerKey !== ownerKey ||
        draftSessionLoadingOwnerKey
      ) {
        return false
      }

      const nextPrompt = pendingDraftPrompt
      setPendingDraftPrompt(null)
      applyPendingDraftPromptToComposer(nextPrompt)
      const sent = await submitPrompt(nextPrompt.streamingBehavior)
      if (!sent) {
        setPendingDraftFollowUps([])
        return false
      }
      await flushPendingDraftFollowUps()
      return true
    },
    [
      applyPendingDraftPromptToComposer,
      draftSessionLoadingOwnerKey,
      flushPendingDraftFollowUps,
      pendingDraftPrompt,
      submitPrompt,
    ]
  )

  React.useEffect(() => {
    if (!draftSessionLoadingOwnerKey) return
    const currentOwnerKey = promptDraftKey(sessionState)
    if (!sessionState.draft || currentOwnerKey !== draftSessionLoadingOwnerKey) {
      return
    }

    setDraftSessionLoadingOwnerKey(null)
    if (pendingDraftPrompt?.ownerKey === draftSessionLoadingOwnerKey) {
      void flushPendingDraftPrompt(draftSessionLoadingOwnerKey)
    }
  }, [
    draftSessionLoadingOwnerKey,
    flushPendingDraftPrompt,
    pendingDraftPrompt?.ownerKey,
    sessionState,
  ])

  React.useEffect(() => {
    if (!awaitingFirstTurn) return
    const hasAssistantOutput = sessionState.items.some(
      (item) =>
        item.kind === "assistant" &&
        item.blocks.some((block) => block.type === "text" && block.text.trim())
    )

    if (sessionState.streaming || hasAssistantOutput || pendingMessages.length > 0) {
      setAwaitingFirstTurn(false)
    }
  }, [awaitingFirstTurn, pendingMessages.length, sessionState.items, sessionState.streaming])

  const abortSession = React.useCallback(async () => {
    if (!viewerContextId) return
    try {
      await fetchJson<SimpleOkResponse>(
        buildRequestUrl("/api/abort", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
        }
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to abort session"
      )
    }
  }, [activeSessionId, viewerContextId])

  const onPickImages = React.useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const nextImages = await Promise.all(
      [...files].slice(0, 8).map((file) => readFileAsPromptImage(file))
    )
    setComposerImages((current) => [...current, ...nextImages].slice(0, 8))
  }, [])

  const removePendingMessage = React.useCallback(
    async (pendingId: string) => {
      if (!viewerContextId) return
      try {
        await fetchJson<PendingMessageRemoveResponse>(
          buildRequestUrl("/api/pending-message/remove", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pendingId }),
          }
        )
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to remove pending prompt"
        )
      }
    },
    [activeSessionId, viewerContextId]
  )

  const currentPendingMessages = pendingMessages

  const reorderPending = React.useCallback(
    async (pendingId: string, direction: -1 | 1) => {
      if (!viewerContextId) return
      const next = [...pendingMessages]
      const index = next.findIndex((entry) => entry.pendingId === pendingId)
      if (index === -1) return
      const targetIndex = index + direction
      if (targetIndex < 0 || targetIndex >= next.length) return
      const [item] = next.splice(index, 1)
      next.splice(targetIndex, 0, item)
      try {
        await fetchJson<PendingMessagesResponse>(
          buildRequestUrl("/api/pending-messages/reorder", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pendingMessages: next }),
          }
        )
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to reorder pending prompts"
        )
      }
    },
    [activeSessionId, pendingMessages, viewerContextId]
  )

  const setModel = React.useCallback(
    async (value: string) => {
      if (!viewerContextId) return
      const [provider, modelId] = value.split("/")
      if (!provider || !modelId) return
      try {
        await fetchJson(
          buildRequestUrl("/api/model", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ provider, modelId }),
          }
        )
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update model"
        )
      }
    },
    [activeSessionId, viewerContextId]
  )

  const setThinkingLevel = React.useCallback(
    async (level: string) => {
      if (!viewerContextId) return
      try {
        await fetchJson(
          buildRequestUrl("/api/thinking", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ level }),
          }
        )
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update thinking level"
        )
      }
    },
    [activeSessionId, viewerContextId]
  )

  const cycleThinkingLevel = React.useCallback(
    async (direction: -1 | 1) => {
      const levels = sessionState.availableThinkingLevels.length
        ? sessionState.availableThinkingLevels
        : ["off"]
      const currentIndex = levels.indexOf(sessionState.thinkingLevel || "off")
      const safeIndex = currentIndex >= 0 ? currentIndex : 0
      const nextLevel =
        levels[(safeIndex + direction + levels.length) % levels.length] ||
        levels[0]
      await setThinkingLevel(nextLevel)
    },
    [sessionState.availableThinkingLevels, sessionState.thinkingLevel, setThinkingLevel]
  )

  const setThinkingBlocksHidden = React.useCallback(
    async (hidden: boolean) => {
      if (!viewerContextId) return
      try {
        await fetchJson(
          buildRequestUrl("/api/settings/hide-thinking", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ hide: hidden }),
          }
        )
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update thinking visibility"
        )
      }
    },
    [activeSessionId, viewerContextId]
  )

  const toggleHideThinking = React.useCallback(async () => {
    await setThinkingBlocksHidden(!sessionState.hideThinkingBlock)
  }, [sessionState.hideThinkingBlock, setThinkingBlocksHidden])

  const setToolBlocksHidden = React.useCallback((hidden: boolean) => {
    setHideToolBlocks(hidden)
    safeLocalStorageSetItem(
      HIDE_TOOL_BLOCKS_STORAGE_KEY,
      hidden ? "1" : "0"
    )
  }, [])

  const toggleHideToolBlocks = React.useCallback(() => {
    setToolBlocksHidden(!hideToolBlocks)
    toast.info(hideToolBlocks ? "Tools shown" : "Tools hidden")
  }, [hideToolBlocks, setToolBlocksHidden])

  const runCompact = React.useCallback(async () => {
    if (!viewerContextId) return
    setRunningSlashCommand("compact")
    try {
      await fetchJson(
        buildRequestUrl("/api/slash-command", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "compact", args: "" }),
        }
      )
      toast.success("Started compaction")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to compact session"
      )
    } finally {
      setRunningSlashCommand(null)
    }
  }, [activeSessionId, viewerContextId])

  const openTreeDialog = React.useCallback(async () => {
    if (!viewerContextId) return
    setTreeOpen(true)
    setTreeLoading(true)
    setTreeSubmitting(false)
    setTreeQuery("")
    try {
      const response = await fetchJson<SessionTreeResponse>(
        buildRequestUrl("/api/session/tree", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        })
      )
      if (isApiErrorResponse(response)) throw new Error(response.error)
      setTreeData(response)
      setSelectedTreeNodeId(response.leafId)
      const flat = flattenTree(response.tree)
      const selected = flat.find((entry) => entry.id === response.leafId)
      setSelectedTreeNodeLabel(selected?.label || "")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load tree"
      )
      setTreeOpen(false)
    } finally {
      setTreeLoading(false)
    }
  }, [activeSessionId, viewerContextId])

  const saveTreeLabel = React.useCallback(async () => {
    if (!viewerContextId || !selectedTreeNodeId) return
    setTreeSubmitting(true)
    try {
      const response = await fetchJson<SessionTreeResponse>(
        buildRequestUrl("/api/session/tree/label", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entryId: selectedTreeNodeId,
            label: selectedTreeNodeLabel,
          }),
        }
      )
      if (isApiErrorResponse(response)) throw new Error(response.error)
      setTreeData(response)
      toast.success("Saved tree label")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save label"
      )
    } finally {
      setTreeSubmitting(false)
    }
  }, [
    activeSessionId,
    selectedTreeNodeId,
    selectedTreeNodeLabel,
    viewerContextId,
  ])

  const navigateTreeNode = React.useCallback(
    async (
      targetId: string,
      options?: { summarize?: boolean; customInstructions?: string }
    ) => {
      if (!viewerContextId) return
      setTreeSubmitting(true)
      try {
        const response = await fetchJson<NavigateSessionTreeResponse>(
          buildRequestUrl("/api/session/tree", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              targetId,
              summarize: Boolean(options?.summarize),
              customInstructions: options?.customInstructions,
            }),
          }
        )
        if (isApiErrorResponse(response)) throw new Error(response.error)
        if (response.aborted) {
          toast.info("Branch summarization cancelled")
          return
        }
        if (response.cancelled) {
          toast.info("Tree navigation cancelled")
          return
        }
        setTreeOpen(false)
        toast.success(
          options?.summarize ? "Continued from summarized branch" : "Moved session tree cursor"
        )
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to navigate tree"
        )
      } finally {
        setTreeSubmitting(false)
      }
    },
    [activeSessionId, viewerContextId]
  )

  const openForkDialog = React.useCallback(async () => {
    if (!viewerContextId) return
    setForkOpen(true)
    setForkLoading(true)
    try {
      const response = await fetchJson<ForkableMessagesResponse>(
        buildRequestUrl("/api/session/fork", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        })
      )
      if (isApiErrorResponse(response)) throw new Error(response.error)
      setForkMessages(response.messages)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load forks"
      )
      setForkOpen(false)
    } finally {
      setForkLoading(false)
    }
  }, [activeSessionId, viewerContextId])

  const forkFromMessage = React.useCallback(
    async (entryId: string) => {
      if (!viewerContextId) return
      try {
        const response = await fetchJson<ForkSessionResponse>(
          buildRequestUrl("/api/session/fork", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ entryId }),
          }
        )
        if (isApiErrorResponse(response)) throw new Error(response.error)
        setForkOpen(false)
        toast.success("Forked session")
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to fork session"
        )
      }
    },
    [activeSessionId, viewerContextId]
  )

  const renameSessionToValue = React.useCallback(
    async (nextName: string, closeDialog = true) => {
      const targetPath = renameTarget?.path || sessionState.sessionFile
      if (!viewerContextId || !targetPath) return false
      try {
        const response = await fetchJson<RenameSessionResponse>(
          buildRequestUrl("/api/session/rename", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              path: targetPath,
              name: nextName,
            }),
          }
        )
        if (isApiErrorResponse(response)) throw new Error(response.error)
        if (closeDialog) {
          setRenameOpen(false)
          setRenameTarget(null)
        }
        toast.success("Renamed session")
        return true
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to rename session"
        )
        return false
      }
    },
    [activeSessionId, renameTarget?.path, sessionState.sessionFile, viewerContextId]
  )

  const renameSession = React.useCallback(async () => {
    return await renameSessionToValue(renameValue)
  }, [renameSessionToValue, renameValue])

  const deleteSession = React.useCallback(async () => {
    if (!viewerContextId || deleteTargets.length === 0) return

    const orderedTargets = [
      ...deleteTargets.filter(
        (target) => target.path && target.path !== sessionState.sessionFile
      ),
      ...deleteTargets.filter(
        (target) => target.path && target.path === sessionState.sessionFile
      ),
    ]

    try {
      for (const target of orderedTargets) {
        if (!target.path) continue

        const response = await fetchJson<DeleteSessionResponse>(
          buildRequestUrl("/api/session/delete", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: target.path }),
          }
        )
        if (isApiErrorResponse(response)) throw new Error(response.error)
      }

      const deletedKeys = new Set(
        orderedTargets
          .map((target) => sessionListEntryKey(target))
          .filter(Boolean)
      )
      setSelectedSidebarSessionKeys((current) =>
        current.filter((key) => !deletedKeys.has(key))
      )
      setSidebarSessionSelectionAnchor((current) =>
        current && deletedKeys.has(current) ? "" : current
      )
      setDeleteTargets([])
      toast.success(
        orderedTargets.length === 1
          ? "Deleted session"
          : `Deleted ${orderedTargets.length} sessions`
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete session"
      )
    }
  }, [
    activeSessionId,
    deleteTargets,
    sessionState.sessionFile,
    viewerContextId,
  ])

  const runBuiltinSlashCommand = React.useCallback(
    async (name: string, args: string) => {
      const trimmedArgs = args.trim()

      switch (name) {
        case "compact": {
          if (composerImages.length > 0) {
            toast.error("Built-in slash commands do not support images.")
            return
          }
          updateComposerDraft("")
          await runCompact()
          return
        }
        case "rename": {
          if (!sessionState.sessionFile) {
            toast.error("Start the session before renaming it.")
            return
          }
          if (!trimmedArgs) {
            openRenameDialog()
            return
          }
          updateComposerDraft("")
          await renameSessionToValue(trimmedArgs, false)
          return
        }
        case "delete": {
          if (!sessionState.sessionFile) {
            toast.error("Start the session before deleting it.")
            return
          }
          updateComposerDraft("")
          openDeleteDialogForCurrentSession()
          return
        }
        case "fork": {
          if (trimmedArgs) {
            toast.error("/fork does not take any arguments.")
            return
          }
          updateComposerDraft("")
          await openForkDialog()
          return
        }
        case "tree": {
          if (trimmedArgs) {
            toast.error("/tree does not take any arguments.")
            return
          }
          updateComposerDraft("")
          await openTreeDialog()
          return
        }
        case "hide-thinking": {
          updateComposerDraft("")
          if (!sessionState.hideThinkingBlock) {
            await toggleHideThinking()
          }
          return
        }
        case "show-thinking": {
          updateComposerDraft("")
          if (sessionState.hideThinkingBlock) {
            await toggleHideThinking()
          }
          return
        }
        case "hide-tools": {
          updateComposerDraft("")
          setToolBlocksHidden(true)
          return
        }
        case "show-tools": {
          updateComposerDraft("")
          setToolBlocksHidden(false)
          return
        }
        default:
          toast.error(`Unsupported slash command: /${name}`)
      }
    },
    [
      composerImages.length,
      openDeleteDialogForCurrentSession,
      openForkDialog,
      openRenameDialog,
      openTreeDialog,
      renameSessionToValue,
      runCompact,
      sessionState.hideThinkingBlock,
      sessionState.sessionFile,
      setToolBlocksHidden,
      toggleHideThinking,
      updateComposerDraft,
    ]
  )

  const resolveUiRequest = React.useCallback(
    async (body: Record<string, unknown>) => {
      if (!viewerContextId || !pendingUiRequest) return
      try {
        await fetchJson<UiRequestResponse>(
          buildRequestUrl(
            `/api/ui/${encodeURIComponent(pendingUiRequest.id)}`,
            {
              contextId: viewerContextId,
              sessionId: activeSessionId,
            }
          ),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        )
        setPendingUiRequest(null)
        setPendingUiValue("")
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to resolve UI request"
        )
      }
    },
    [activeSessionId, pendingUiRequest, viewerContextId]
  )

  const flatTree = React.useMemo(() => {
    return treeData && !isApiErrorResponse(treeData)
      ? flattenTree(treeData.tree)
      : []
  }, [treeData])
  const treeLeafId =
    treeData && !isApiErrorResponse(treeData) ? treeData.leafId : null
  const treeSummaryAvailable = sessionState.availableModels.length > 0

  const handleThemeChange = React.useCallback(
    (value: ThemeMode) => {
      setTheme(value)
    },
    [setTheme]
  )

  const slashCommands = React.useMemo<Array<SlashCommandDescriptor>>(
    () => [
      {
        kind: "builtin",
        name: "compact",
        description: "Summarize the session to reduce context size",
      },
      {
        kind: "builtin",
        name: "delete",
        description: "Delete the current session",
      },
      {
        kind: "builtin",
        name: "fork",
        description: "Create a new session from a previous message",
      },
      {
        kind: "builtin",
        name: "tree",
        description: "Navigate to an earlier point in the current session tree",
      },
      {
        kind: "builtin",
        name: "rename",
        description: "Rename the current session",
      },
      ...(sessionState.hideThinkingBlock
        ? [
            {
              kind: "builtin" as const,
              name: "show-thinking",
              description: "Show assistant thinking blocks",
            },
          ]
        : [
            {
              kind: "builtin" as const,
              name: "hide-thinking",
              description: "Hide assistant thinking blocks",
            },
          ]),
      ...(hideToolBlocks
        ? [
            {
              kind: "builtin" as const,
              name: "show-tools",
              description: "Show assistant tool calls",
            },
          ]
        : [
            {
              kind: "builtin" as const,
              name: "hide-tools",
              description: "Hide assistant tool calls",
            },
          ]),
      ...sessionState.availableSkills.map((skill) => ({
        kind: "skill" as const,
        name: `skill:${skill.name}` as const,
        skillName: skill.name,
        description: skill.description || "Use this skill",
        scope: skill.scope,
        source: skill.source,
      })),
    ],
    [hideToolBlocks, sessionState.availableSkills, sessionState.hideThinkingBlock]
  )

  const workingState = React.useMemo(() => {
    if (draftSessionLoadingOwnerKey && pendingDraftPrompt) {
      return {
        label: "Waiting for new session…",
      }
    }

    if (awaitingFirstTurn && !sessionState.streaming) {
      return {
        label: "Waiting for first response…",
      }
    }

    if (runningSlashCommand === "compact") {
      return {
        label: "Compacting context…",
      }
    }

    if (sessionState.streaming) {
      return {
        label: sessionState.uiState.workingMessage || "Working…",
        summary: sessionState.hideThinkingBlock
          ? sessionState.uiState.hiddenThinkingLabel ||
            sessionState.hiddenThinkingPreview
          : undefined,
      }
    }

    const hasAssistantOutput = sessionState.items.some(
      (item) =>
        item.kind === "assistant" &&
        item.blocks.some(
          (block) =>
            block.type === "text" &&
            typeof block.text === "string" &&
            block.text.trim().length > 0
        )
    )

    return hasAssistantOutput
      ? {
          label: "Done",
          done: true,
        }
      : null
  }, [
    awaitingFirstTurn,
    draftSessionLoadingOwnerKey,
    pendingDraftPrompt,
    runningSlashCommand,
    sessionState.hiddenThinkingPreview,
    sessionState.hideThinkingBlock,
    sessionState.items,
    sessionState.streaming,
    sessionState.uiState.hiddenThinkingLabel,
    sessionState.uiState.workingMessage,
  ])

  const commandPaletteCommands = React.useMemo<Array<AppCommand>>(() => {
    const commands: Array<AppCommand> = [
      {
        id: "new-session",
        title: "New session",
        description: "Create a new draft session",
        shortcut: "Ctrl+N",
        keywords: ["create", "draft", "session"],
        onSelect: createSession,
      },
      {
        id: "search-sessions",
        title: "Search sessions",
        description: "Search and jump through sessions in the sidebar",
        shortcut: "Ctrl+S",
        keywords: ["sidebar", "filter", "search", "switch"],
        onSelect: focusSessionSearch,
      },
      {
        id: "set-model",
        title: "Set model",
        description: "Open the model picker",
        shortcut: "Ctrl+M",
        keywords: ["model", "provider", "picker", "choose"],
        onSelect: () => {
          if (sessionState.availableModels.length === 0) {
            throw new Error("No models are available right now.")
          }

          focusModelSelector()
        },
      },
      {
        id: "add-directory",
        title: "Add Directory",
        description: "Add a directory accordion to the sidebar",
        shortcut: "Ctrl+D",
        keywords: ["workspace", "sidebar", "directory", "folder"],
        onSelect: openAddDirectoryDialog,
      },
      {
        id: "tree-session",
        title: "Navigate tree",
        description: "Jump to an earlier point in the current session tree",
        keywords: ["tree", "branch", "history"],
        onSelect: openTreeDialog,
      },
      {
        id: "fork-session",
        title: "Fork session",
        description: "Create a new session from a previous user message",
        shortcut: "Ctrl+F",
        keywords: ["fork", "branch", "draft"],
        onSelect: openForkDialog,
      },
      {
        id: "compact-session",
        title: "Compact",
        description: "Manually compact the session context",
        shortcut: "Ctrl+C",
        keywords: ["compact", "context", "compress", "summarize"],
        onSelect: runCompact,
      },
      {
        id: "toggle-thinking",
        title: sessionState.hideThinkingBlock
          ? "Show thinking blocks"
          : "Hide thinking blocks",
        description: sessionState.hideThinkingBlock
          ? "Show assistant thinking blocks"
          : "Hide assistant thinking blocks",
        shortcut: "Ctrl+T",
        keywords: ["thinking", "reasoning", "visibility", "show", "hide"],
        onSelect: toggleHideThinking,
      },
      {
        id: "cycle-reasoning",
        title: "Cycle reasoning level",
        description: `Current level: ${sessionState.thinkingLevel}`,
        shortcut: "Ctrl+R",
        keywords: ["thinking", "reasoning", "level", "cycle", "next"],
        onSelect: () => {
          void cycleThinkingLevel(1)
        },
      },
      {
        id: "toggle-tools",
        title: hideToolBlocks ? "Show tool calls" : "Hide tool calls",
        description: hideToolBlocks
          ? "Show assistant tool calls"
          : "Hide assistant tool calls",
        shortcut: "Ctrl+O",
        keywords: ["tools", "tool calls", "visibility", "show", "hide"],
        onSelect: toggleHideToolBlocks,
      },
      {
        id: "open-settings",
        title: "Open settings",
        description: "Open app settings",
        shortcut: "Ctrl+,",
        keywords: ["settings", "theme", "notifications", "display"],
        onSelect: openSettingsDialog,
      },
      {
        id: "view-shortcuts",
        title: "View keyboard shortcuts",
        description: "Open the keyboard shortcuts dialog",
        shortcut: "Ctrl+/",
        keywords: ["shortcuts", "keyboard", "help"],
        onSelect: openShortcutsDialog,
      },
      {
        id: "view-status",
        title: "View status",
        description:
          statusCount > 0
            ? `Open ${statusCount} active status ${statusCount === 1 ? "item" : "items"}`
            : "Open current status items",
        keywords: ["status", "runtime", "extension", "items"],
        onSelect: openStatusDialog,
      },
    ]

    if (sessionState.sessionFile) {
      commands.splice(1, 0, {
        id: "rename-session",
        title: "Rename session",
        description: "Rename the current session",
        shortcut: "Ctrl+E",
        keywords: ["rename", "title", "name"],
        onSelect: openRenameDialog,
      })
      commands.push({
        id: "delete-session",
        title: "Delete session",
        description: `Delete ${currentSessionTitle}`,
        shortcut: "Ctrl+X",
        keywords: ["delete", "remove", "session"],
        onSelect: openDeleteDialogForCurrentSession,
      })
    }

    if (selectedSidebarSessions.length > 0) {
      commands.push({
        id: "clear-selected-sessions",
        title: "Clear selected sidebar sessions",
        description: `Clear ${selectedSidebarSessions.length} selected sidebar ${selectedSidebarSessions.length === 1 ? "session" : "sessions"}`,
        keywords: ["clear", "selected", "sidebar", "sessions"],
        onSelect: () => {
          setSidebarSelection([])
        },
      })
      commands.push({
        id: "delete-selected-sessions",
        title: "Delete selected sidebar sessions",
        description: `Delete ${selectedSidebarSessions.length} selected sidebar ${selectedSidebarSessions.length === 1 ? "session" : "sessions"}`,
        keywords: ["delete", "selected", "sidebar", "sessions"],
        onSelect: () => {
          openDeleteDialog(selectedSidebarSessions)
        },
      })
    }

    return commands
  }, [
    createSession,
    currentSessionTitle,
    focusModelSelector,
    focusSessionSearch,
    openAddDirectoryDialog,
    openDeleteDialog,
    openDeleteDialogForCurrentSession,
    openForkDialog,
    openRenameDialog,
    openSettingsDialog,
    openShortcutsDialog,
    openStatusDialog,
    openTreeDialog,
    cycleThinkingLevel,
    hideToolBlocks,
    runCompact,
    selectedSidebarSessions,
    setSidebarSelection,
    sessionState.availableModels.length,
    sessionState.hideThinkingBlock,
    sessionState.sessionFile,
    sessionState.thinkingLevel,
    statusCount,
    toggleHideThinking,
    toggleHideToolBlocks,
  ])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const modalOpen =
        addDirectoryOpen ||
        renameOpen ||
        deleteOpen ||
        forkOpen ||
        treeOpen ||
        statusOpen ||
        shortcutsOpen ||
        settingsOpen ||
        commandPaletteOpen ||
        Boolean(pendingUiRequest)

      const activeElement = document.activeElement
      const focusedSidebarSessionKey =
        activeElement instanceof HTMLElement
          ? (activeElement.dataset.sessionKey?.trim() ?? "")
          : ""
      const focusedSidebarSession = focusedSidebarSessionKey
        ? sidebarSessionEntriesByKey.get(focusedSidebarSessionKey)
        : undefined
      const targetIsSessionSearch =
        event.target instanceof HTMLInputElement &&
        event.target === sessionSearchInputRef.current

      if (
        !modalOpen &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (!isEditableTarget(event.target) || targetIsSessionSearch)
      ) {
        if (key === "escape" && !event.repeat && !isEditableTarget(event.target)) {
          const now = Date.now()
          if (now - lastEscapePressedAtRef.current <= 600) {
            event.preventDefault()
            lastEscapePressedAtRef.current = 0
            void openTreeDialog()
            return
          }

          lastEscapePressedAtRef.current = now
          return
        }

        if (
          key !== "shift" &&
          key !== "control" &&
          key !== "meta" &&
          key !== "alt"
        ) {
          lastEscapePressedAtRef.current = 0
        }
        if (
          (key === "arrowdown" ||
            key === "arrowup" ||
            key === "home" ||
            key === "end") &&
          renderedSidebarSessionKeys.length > 0
        ) {
          const sessionButtons = Array.from(
            document.querySelectorAll<HTMLElement>("[data-sidebar-session-item]")
          )
          const focusedSessionButton =
            activeElement instanceof HTMLElement
              ? activeElement.closest<HTMLElement>("[data-sidebar-session-item]")
              : null

          if (sessionButtons.length > 0) {
            const currentIndex = focusedSessionButton
              ? sessionButtons.findIndex((button) => button === focusedSessionButton)
              : -1
            const nextIndex =
              key === "home"
                ? 0
                : key === "end"
                  ? sessionButtons.length - 1
                  : currentIndex >= 0
                    ? Math.max(
                        0,
                        Math.min(
                          sessionButtons.length - 1,
                          currentIndex + (key === "arrowdown" ? 1 : -1)
                        )
                      )
                    : (key === "arrowup" ? sessionButtons.length - 1 : 0)

            event.preventDefault()
            sessionButtons[nextIndex]?.focus()
            return
          }
        }

        if (
          !event.shiftKey &&
          (
            key === "delete" ||
            (key === "backspace" && selectedSidebarSessions.length > 0)
          )
        ) {
          const targetsToDelete =
            selectedSidebarSessions.length > 0
              ? selectedSidebarSessions
              : focusedSidebarSession?.path
                ? [focusedSidebarSession]
                : []

          if (targetsToDelete.length > 0) {
            event.preventDefault()
            openDeleteDialog(targetsToDelete)
            return
          }
        }
      }

      if (!event.ctrlKey || event.metaKey || event.altKey) return

      if (key === "/" || key === "?") {
        if (treeOpen) return
        event.preventDefault()
        openShortcutsDialog()
        return
      }

      if (modalOpen) return

      if (key === "p" && !event.shiftKey) {
        event.preventDefault()
        openCommandPalette()
        return
      }

      if (key === "n" && !event.shiftKey) {
        event.preventDefault()
        void createSession()
        return
      }

      if (key === "s" && !event.shiftKey) {
        event.preventDefault()
        focusSessionSearch()
        return
      }

      if (key === "e" && !event.shiftKey) {
        if (!sessionState.sessionFile) return
        event.preventDefault()
        openRenameDialog()
        return
      }

      if (key === "f" && !event.shiftKey) {
        event.preventDefault()
        void openForkDialog()
        return
      }

      if (key === "d" && !event.shiftKey) {
        event.preventDefault()
        openAddDirectoryDialog()
        return
      }

      if (key === "," && !event.shiftKey) {
        event.preventDefault()
        openSettingsDialog()
        return
      }

      if (key === "m" && !event.shiftKey) {
        if (sessionState.availableModels.length === 0) return
        event.preventDefault()
        focusModelSelector()
        return
      }

      if (key === "t" && !event.shiftKey) {
        event.preventDefault()
        void toggleHideThinking()
        return
      }

      if (key === "r") {
        event.preventDefault()
        void cycleThinkingLevel(event.shiftKey ? -1 : 1)
        return
      }

      if (key === "o" && !event.shiftKey) {
        event.preventDefault()
        toggleHideToolBlocks()
        return
      }

      if (key === "c" && !event.shiftKey) {
        if (hasSelectedText(event.target)) return
        event.preventDefault()
        void runCompact()
        return
      }

      if (key === "x" && !event.shiftKey) {
        if (isEditableTarget(event.target)) return
        if (!sessionState.sessionFile) return
        event.preventDefault()
        openDeleteDialogForCurrentSession()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [
    addDirectoryOpen,
    commandPaletteOpen,
    createSession,
    deleteOpen,
    focusModelSelector,
    focusSessionSearch,
    forkOpen,
    openAddDirectoryDialog,
    openCommandPalette,
    openDeleteDialog,
    openDeleteDialogForCurrentSession,
    openForkDialog,
    openRenameDialog,
    openSettingsDialog,
    openShortcutsDialog,
    openTreeDialog,
    pendingUiRequest,
    renameOpen,
    runCompact,
    renderedSidebarSessionKeys,
    selectedSidebarSessions,
    sessionState.availableModels.length,
    sessionState.sessionFile,
    settingsOpen,
    shortcutsOpen,
    sidebarSessionEntriesByKey,
    statusOpen,
    toggleHideThinking,
    toggleHideToolBlocks,
    treeOpen,
    cycleThinkingLevel,
  ])

  const isSessionViewLoading = Boolean(sessionId && sessionId !== sessionState.sessionId)
  const draftGitSummary =
    sessionState.draft &&
    sessionState.items.length === 0 &&
    gitStatus &&
    !isApiErrorResponse(gitStatus)
      ? gitStatus.gitStatus
      : null

  const scrollConversationToBottom = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" })
  }, [])

  const jumpToPreviousMessage = React.useCallback(() => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    const target = previousMessageJumpTarget(viewport)
    if (!target) return
    viewport.scrollTo({ top: Math.max(0, target.offsetTop - 8), behavior: "smooth" })
  }, [])

  return (
    <SidebarProvider className="h-full overflow-hidden bg-background">
      <AppSidebar
        connected={sessionState.connected}
        sessionSearch={sessionSearch}
        onSessionSearchChange={setSessionSearch}
        sessionSearchInputRef={sessionSearchInputRef}
        visibleDirectories={visibleDirectories}
        directoryStateByPath={directoryStateByPath}
        filteredDirectorySessions={filteredDirectorySessions}
        collapsedDirectories={collapsedDirectories}
        directoryIndexLoading={directoryIndexLoading}
        directoryRenderCounts={directoryRenderCounts}
        selectedSessionKeys={selectedSidebarSessionKeys}
        activeSessionId={activeSessionId}
        statusCount={statusCount}
        emptyStateText={emptySidebarStateText}
        allDirectoriesCollapsed={allDirectoriesCollapsed}
        onCreateSession={createSession}
        onOpenAddDirectoryDialog={openAddDirectoryDialog}
        onOpenCommandPalette={openCommandPalette}
        onOpenShortcuts={openShortcutsDialog}
        onOpenStatus={openStatusDialog}
        onOpenSettings={openSettingsDialog}
        onToggleDirectory={toggleDirectory}
        onToggleAllDirectories={toggleAllDirectories}
        onSessionClick={handleSidebarSessionClick}
        onRenameSession={(entry) => {
          if (!entry.path) return
          setRenameTarget(entry)
          setRenameValue(entry.title || "")
          setRenameOpen(true)
        }}
        onDeleteSession={(entry) => {
          openDeleteDialog([entry])
        }}
        onCreateSessionInDirectory={(directory) => {
          void createSession(directory)
        }}
        onRemoveDirectory={(directory) => {
          setSidebarDirectories((current) => {
            const next = current.filter((entry) => entry !== directory)
            safeLocalStorageSetItem(
              SIDEBAR_DIRECTORIES_STORAGE_KEY,
              JSON.stringify(next)
            )
            return next
          })
          setCollapsedDirectories((current) => {
            if (!Object.prototype.hasOwnProperty.call(current, directory)) {
              return current
            }
            const next = { ...current }
            delete next[directory]
            safeLocalStorageSetItem(
              COLLAPSED_DIRECTORIES_STORAGE_KEY,
              JSON.stringify(next)
            )
            return next
          })
        }}
        onReorderDirectories={reorderSidebarDirectories}
        onLoadMoreDirectorySessions={loadMoreDirectorySessions}
        onDeleteSelectedSessions={() => {
          openDeleteDialog(selectedSidebarSessions)
        }}
        onClearSelectedSessions={() => {
          setSidebarSelection([])
        }}
      />

      <SidebarInset className="min-h-0 overflow-hidden">
        <div className="shrink-0 border-b border-border/70 px-6 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-3">
              <SidebarTrigger className="mt-0.5 shrink-0" />
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h2 className="text-[15px] font-semibold leading-tight">
                    {currentSessionTitle}
                  </h2>
                  {sessionState.draft && <Badge variant="outline">Draft</Badge>}
                  {sessionState.streaming && (
                    <Badge variant="outline">Streaming</Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {sessionState.cwd && <span>{sessionState.cwd}</span>}
                  {sessionState.modified && (
                    <span>• {relativeTime(sessionState.modified)}</span>
                  )}
                  {sessionState.contextUsage?.percent != null && (
                    <span>
                      • Context {Math.round(sessionState.contextUsage.percent)}%
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={runCompact}>
                <SparklesIcon /> Compact
              </Button>
              <Button size="sm" variant="outline" onClick={openTreeDialog}>
                <WaypointsIcon /> Tree
              </Button>
              <Button size="sm" variant="outline" onClick={openForkDialog}>
                <SplitIcon /> Fork
              </Button>
              <Button
                size="sm"
                variant="outline"
                title={
                  defaultNewSessionDirectory
                    ? `Create a new session in ${defaultNewSessionDirectory}`
                    : "Create a new session"
                }
                onClick={() => {
                  void createSession()
                }}
              >
                <PlusIcon /> New
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
                  <EllipsisIcon /> Session
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onClick={() => {
                      void createSession()
                    }}
                  >
                    <span>Create new session</span>
                    <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  {newSessionDirectoryOptions.length > 0 ? (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        New session in…
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-72">
                        {newSessionDirectoryOptions.map((option) => (
                          <DropdownMenuItem
                            key={option.path}
                            onClick={() => {
                              void createSession(option.path)
                            }}
                          >
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="text-xs text-muted-foreground">
                                {option.label}
                              </span>
                              <span className="truncate">{option.path}</span>
                            </div>
                            {option.path === defaultNewSessionDirectory ? (
                              <DropdownMenuShortcut>Default</DropdownMenuShortcut>
                            ) : null}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ) : null}
                  <DropdownMenuItem
                    onClick={() => {
                      void toggleHideThinking()
                    }}
                  >
                    <span>
                      {sessionState.hideThinkingBlock
                        ? "Show thinking"
                        : "Hide thinking"}
                    </span>
                    <DropdownMenuShortcut>Ctrl+T</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={toggleHideToolBlocks}>
                    <span>{hideToolBlocks ? "Show tools" : "Hide tools"}</span>
                    <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!sessionState.sessionFile}
                    onClick={openRenameDialog}
                  >
                    <span>Rename session</span>
                    <DropdownMenuShortcut>Ctrl+E</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={!sessionState.sessionFile}
                    onClick={openDeleteDialogForCurrentSession}
                  >
                    <span>Delete session</span>
                    <DropdownMenuShortcut>Ctrl+X</DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-6">
          <Tabs
            value={currentTab}
            onValueChange={setCurrentTab}
            className="flex h-full min-h-0 flex-col gap-6"
          >
            <TabsList variant="line">
              <TabsTrigger value="session">Session</TabsTrigger>
              <TabsTrigger value="git">Git</TabsTrigger>
            </TabsList>

            <TabsContent
              value="session"
              className="flex min-h-0 flex-1 flex-col gap-4"
            >
              <Card className="min-h-0 flex-1">
                <CardContent className="flex h-full min-h-0 flex-col gap-4 pt-4">
                  <div ref={messagesScrollAreaRef} className="relative min-h-0 flex-1">
                    <ScrollArea className="h-full pr-4">
                      {isSessionViewLoading ? (
                        <div className="flex min-h-full items-center justify-center py-10">
                          <div className="flex flex-col items-center gap-3 rounded-xl border bg-card/70 px-6 py-8 text-sm text-muted-foreground">
                            <Spinner />
                            <div className="font-medium text-foreground">Loading session…</div>
                            <div>Switching to the selected conversation.</div>
                          </div>
                        </div>
                      ) : sessionState.items.length > 0 ? (
                        <div className="flex flex-col gap-4 pb-6">
                          {(() => {
                            const counts = new Map<string, number>()
                            return sessionState.items.map((item) => {
                              const baseKey = conversationItemSignature(item)
                              const count = (counts.get(baseKey) ?? 0) + 1
                              counts.set(baseKey, count)
                              const key = `${baseKey}:${count}`

                              return item.kind === "user" ? (
                                <div
                                  key={key}
                                  data-message-anchor="true"
                                  className="flex justify-end"
                                >
                                  <UserMessageCard item={item} />
                                </div>
                              ) : (
                                <div
                                  key={key}
                                  data-message-anchor="true"
                                  className="flex justify-start"
                                >
                                  <AssistantMessageCard
                                    item={item}
                                    hideThinking={sessionState.hideThinkingBlock}
                                    hideToolBlocks={hideToolBlocks}
                                    hiddenThinkingLabel={
                                      sessionState.uiState.hiddenThinkingLabel ||
                                      sessionState.hiddenThinkingPreview
                                    }
                                  />
                                </div>
                              )
                            })
                          })()}
                          {workingState ? (
                            <div className="flex justify-start">
                              <MessagesWorkingIndicator state={workingState} />
                            </div>
                          ) : null}
                          <div ref={bottomRef} />
                        </div>
                      ) : (
                        <Empty className="border border-dashed bg-card/60">
                          <EmptyHeader>
                            <EmptyMedia variant="icon">
                              <SparklesIcon />
                            </EmptyMedia>
                            <EmptyTitle>
                              {sessionState.draft
                                ? "Draft session ready"
                                : "Start a new conversation"}
                            </EmptyTitle>
                            <EmptyDescription>
                              {sessionState.draft
                                ? sessionState.cwd
                                  ? `You are in a fresh draft for ${sessionState.cwd}. Unsent composer text is restored per session and directory, matching pi-web.`
                                  : "You are in a fresh draft session. Unsent composer text is restored per session and directory, matching pi-web."
                                : "This is the native Pi to Go session view backed by the new TypeScript runtime."}
                            </EmptyDescription>
                          </EmptyHeader>
                          {sessionState.draft ? (
                            <EmptyContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
                              {sessionState.cwd ? (
                                <Badge variant="outline">{sessionState.cwd}</Badge>
                              ) : null}
                              {draftGitSummary?.label ? (
                                <Badge variant="outline">{draftGitSummary.label}</Badge>
                              ) : null}
                              <Button
                                onClick={() => {
                                  void createSession()
                                }}
                              >
                                New session
                              </Button>
                            </EmptyContent>
                          ) : (
                            <EmptyContent>
                              <Button
                                onClick={() => {
                                  void createSession()
                                }}
                              >
                                New session
                              </Button>
                            </EmptyContent>
                          )}
                        </Empty>
                      )}
                    </ScrollArea>

                    {!isSessionViewLoading && !isMessagesNearBottom ? (
                      <Button
                        size="icon-lg"
                        className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border-0 text-primary-foreground shadow-[0_10px_24px_rgba(0,0,0,0.28)] md:bottom-[18px]"
                        title="Jump to latest message"
                        aria-label="Jump to latest message"
                        onClick={scrollConversationToBottom}
                      >
                        <ArrowDownIcon className="size-4" />
                      </Button>
                    ) : null}

                    {!isSessionViewLoading && hasPreviousMessageJumpTarget ? (
                      <Button
                        size="icon-lg"
                        className="absolute right-4 bottom-4 z-10 rounded-full border-0 text-primary-foreground shadow-[0_10px_24px_rgba(0,0,0,0.28)] md:right-[18px] md:bottom-[18px]"
                        title="Jump to previous message"
                        aria-label="Jump to previous message"
                        onClick={jumpToPreviousMessage}
                      >
                        <ArrowUpToLineIcon className="size-4" />
                      </Button>
                    ) : null}
                  </div>

                  <ComposerPanel
                    ref={composerPanelRef}
                    currentPendingMessages={currentPendingMessages}
                    composerImages={composerImages}
                    composerText={composerText}
                    composerSkill={composerSkill}
                    availableModels={sessionState.availableModels}
                    model={sessionState.model}
                    thinkingLevel={sessionState.thinkingLevel}
                    availableThinkingLevels={sessionState.availableThinkingLevels}
                    isSubmitting={isSubmitting}
                    isStreaming={sessionState.streaming}
                    awaitingFirstTurn={awaitingFirstTurn}
                    isDraftSessionLoading={Boolean(draftSessionLoadingOwnerKey)}
                    hasPendingDraftPrompt={Boolean(pendingDraftPrompt)}
                    workingState={workingState}
                    fileInputRef={fileInputRef}
                    slashCommands={slashCommands}
                    onComposerTextChange={updateComposerDraft}
                    onSetComposerSkill={setComposerSkill}
                    onPickImages={(files) => {
                      void onPickImages(files)
                    }}
                    onRemoveComposerImage={(index) => {
                      setComposerImages((current) =>
                        current.filter((_, imageIndex) => imageIndex !== index)
                      )
                    }}
                    onSubmitPrompt={(streamingBehavior) => {
                      void submitPrompt(streamingBehavior)
                    }}
                    onAbort={() => {
                      void abortSession()
                    }}
                    onRemovePendingMessage={(pendingId) => {
                      void removePendingMessage(pendingId)
                    }}
                    onReorderPending={(pendingId, direction) => {
                      void reorderPending(pendingId, direction)
                    }}
                    onRunBuiltinSlashCommand={(name, args) => {
                      void runBuiltinSlashCommand(name, args)
                    }}
                    onSelectModel={(value) => {
                      void setModel(value)
                    }}
                    onSelectThinkingLevel={(level) => {
                      void setThinkingLevel(level)
                    }}
                    requestPathCompletions={async (prefix) => {
                      const response = await fetchJson<PathCompletionsResponse>(
                        buildRequestUrl("/api/path-completions", {
                          contextId: viewerContextId,
                          sessionId: activeSessionId,
                        }),
                        {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ prefix }),
                        }
                      )
                      return isApiErrorResponse(response)
                        ? []
                        : response.items
                    }}
                    requestFileCompletions={async (query, isQuotedPrefix) => {
                      const response = await fetchJson<FileCompletionsResponse>(
                        buildRequestUrl("/api/file-completions", {
                          contextId: viewerContextId,
                          sessionId: activeSessionId,
                        }),
                        {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ query, isQuotedPrefix }),
                        }
                      )
                      return isApiErrorResponse(response)
                        ? []
                        : response.items
                    }}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent
              value="git"
              className="min-h-0 flex-1 space-y-4 overflow-auto"
            >
              <GitPanel
                gitLoading={gitLoading}
                gitStatus={gitStatus}
                gitChanges={gitChanges}
                cwd={sessionState.cwd}
                onRefresh={() => {
                  void refreshGit()
                }}
              />
            </TabsContent>
          </Tabs>
        </div>
      </SidebarInset>

      <AppShellCommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        commands={commandPaletteCommands}
        onCommandError={(error) => {
          toast.error(
            error instanceof Error ? error.message : "Failed to run command"
          )
        }}
      />

      <AppShellDialogs
        addDirectoryOpen={addDirectoryOpen}
        onAddDirectoryOpenChange={setAddDirectoryOpen}
        directoryInput={directoryInput}
        onDirectoryInputChange={setDirectoryInput}
        openedDirectories={sidebarDirectories}
        currentDirectory={sessionState.cwd}
        recentDirectories={recentDirectories}
        knownDirectories={knownDirectories}
        onAddDirectory={() => {
          void addDirectory()
        }}
        onAddDirectoryPath={(path) => {
          void addDirectoryPath(path)
        }}
        renameOpen={renameOpen}
        onRenameOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null)
          }
          setRenameOpen(open)
        }}
        renameValue={renameValue}
        onRenameValueChange={setRenameValue}
        onRenameSession={() => {
          void renameSession()
        }}
        deleteOpen={deleteOpen}
        onDeleteOpenChange={(open) => {
          if (!open) {
            setDeleteTargets([])
          }
        }}
        deleteTitle={
          deleteTargets.length === 1 ? "Delete session" : "Delete sessions"
        }
        deleteDescription={
          deleteTargets.length === 1
            ? `Delete "${deleteTargets[0]?.title || currentSessionTitle}" from disk?`
            : `Delete ${deleteTargets.length} selected sessions from disk?`
        }
        onDeleteSession={() => {
          void deleteSession()
        }}
        forkOpen={forkOpen}
        onForkOpenChange={setForkOpen}
        forkLoading={forkLoading}
        forkMessages={forkMessages}
        onForkFromMessage={(entryId) => {
          void forkFromMessage(entryId)
        }}
        treeOpen={treeOpen}
        onTreeOpenChange={setTreeOpen}
        treeLoading={treeLoading}
        treeSubmitting={treeSubmitting}
        treeLeafId={treeLeafId}
        treeSummaryAvailable={treeSummaryAvailable}
        treeQuery={treeQuery}
        onTreeQueryChange={setTreeQuery}
        flatTree={flatTree}
        selectedTreeNodeId={selectedTreeNodeId}
        onSelectedTreeNodeIdChange={setSelectedTreeNodeId}
        selectedTreeNodeLabel={selectedTreeNodeLabel}
        onSelectedTreeNodeLabelChange={setSelectedTreeNodeLabel}
        onNavigateTreeNode={(targetId, options) => {
          void navigateTreeNode(targetId, options)
        }}
        onSaveTreeLabel={() => {
          void saveTreeLabel()
        }}
        statusOpen={statusOpen}
        onStatusOpenChange={setStatusOpen}
        statuses={sessionState.uiState.statuses}
        shortcutsOpen={shortcutsOpen}
        onShortcutsOpenChange={setShortcutsOpen}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={setSettingsOpen}
        currentTheme={currentTheme}
        currentThemeLabel={currentThemeLabel}
        onThemeChange={handleThemeChange}
        hideThinkingBlocks={sessionState.hideThinkingBlock}
        onHideThinkingBlocksChange={(hidden) => {
          void setThinkingBlocksHidden(hidden)
        }}
        hideToolBlocks={hideToolBlocks}
        onHideToolBlocksChange={setToolBlocksHidden}
        sessionDoneSoundEnabled={sessionDoneSoundEnabled}
        onSessionDoneSoundEnabledChange={handleSessionDoneSoundEnabledChange}
        sessionDoneDesktopNotificationsEnabled={
          sessionDoneDesktopNotificationsEnabled
        }
        onSessionDoneDesktopNotificationsEnabledChange={
          handleSessionDoneDesktopNotificationsEnabledChange
        }
        desktopNotificationPermission={desktopNotificationPermission}
        pendingUiRequest={pendingUiRequest}
        pendingUiValue={pendingUiValue}
        onPendingUiValueChange={setPendingUiValue}
        onResolveUiRequest={(body) => {
          void resolveUiRequest(body)
        }}
      />
    </SidebarProvider>
  )
}
