import * as React from "react"
import {
  PencilIcon,
  SparklesIcon,
  SplitIcon,
  Trash2Icon,
  WaypointsIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AppShellCommandPalette,
  type AppCommand,
} from "@/features/pi-web/app-shell-command-palette"
import { AppShellDialogs } from "@/features/pi-web/app-shell-dialogs"
import {
  buildRequestUrl,
  fetchJson,
  readFileAsPromptImage,
  updateStateFromSync,
} from "@/features/pi-web/app-shell-utils"
import { ComposerPanel } from "@/features/pi-web/composer-panel"
import {
  type DesktopNotificationPermission,
  getDesktopNotificationPermission,
  playSessionDoneSound,
  primeSessionDoneSound,
  requestDesktopNotificationPermission,
  showSessionDoneDesktopNotification,
} from "@/features/pi-web/session-done-notifications"
import {
  AssistantMessageCard,
  UserMessageCard,
  conversationItemSignature,
} from "@/features/pi-web/conversation-view"
import { GitPanel } from "@/features/pi-web/git-panel"
import { AppSidebar } from "@/features/pi-web/sidebar"
import {
  clampSidebarDirectories,
  COLLAPSED_DIRECTORIES_STORAGE_KEY,
  createContextId,
  createInitialSessionState,
  DIRECTORY_SESSION_LOAD_MORE_COUNT,
  filterFlatTree,
  flattenTree,
  getSessionTitle,
  INITIAL_DIRECTORY_SESSION_RENDER_COUNT,
  normalizePromptImage,
  normalizeStoredDirectoryList,
  normalizeThemeMode,
  readStoredCollapsedDirectories,
  readStoredSessionDoneDesktopNotificationsEnabled,
  readStoredSessionDoneSoundEnabled,
  readStoredSidebarDirectories,
  relativeTime,
  safeLocalStorageSetItem,
  SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY,
  SESSION_DONE_SOUND_ENABLED_STORAGE_KEY,
  SIDEBAR_DIRECTORIES_STORAGE_KEY,
  themeModeLabel,
  type PromptImage,
  type SessionState,
  type ThemeMode,
  VIEWER_CONTEXT_STORAGE_KEY,
} from "@/lib/pi-web"
import {
  type DeleteSessionResponse,
  type DirectoryResolveResponse,
  type DirectorySessionsIndexResponse,
  type ExtensionUiEvent,
  type ForkableMessagesResponse,
  type ForkSessionResponse,
  type GitChangesResponse,
  type GitStatusResponse,
  isApiErrorResponse,
  isSessionsEvent,
  isStateSyncEvent,
  type NavigateSessionTreeResponse,
  type PendingMessageRemoveResponse,
  type PendingMessagesResponse,
  type PiWebServerEvent,
  type PromptResponse,
  type RenameSessionResponse,
  type SessionListEntry,
  type SessionTreeResponse,
  type SessionsEvent,
  type SimpleOkResponse,
  type UiRequestResponse,
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

function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <Badge variant={connected ? "default" : "destructive"}>
      {connected ? "Connected" : "Disconnected"}
    </Badge>
  )
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
  const [composerImages, setComposerImages] = React.useState<
    Array<PromptImage>
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
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState("")
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [forkOpen, setForkOpen] = React.useState(false)
  const [forkMessages, setForkMessages] = React.useState<Array<{
    entryId: string
    text: string
  }> | null>(null)
  const [forkLoading, setForkLoading] = React.useState(false)
  const [treeOpen, setTreeOpen] = React.useState(false)
  const [treeLoading, setTreeLoading] = React.useState(false)
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
  const [sessionDoneSoundEnabled, setSessionDoneSoundEnabled] =
    React.useState(true)
  const [
    sessionDoneDesktopNotificationsEnabled,
    setSessionDoneDesktopNotificationsEnabled,
  ] = React.useState(true)
  const [desktopNotificationPermission, setDesktopNotificationPermission] =
    React.useState<DesktopNotificationPermission>("unsupported")
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const sessionSearchInputRef = React.useRef<HTMLInputElement | null>(null)
  const modelSelectRef = React.useRef<HTMLSelectElement | null>(null)
  const bottomRef = React.useRef<HTMLDivElement | null>(null)
  const lastStreamingRef = React.useRef(false)
  const lastSyncedEditorTextRef = React.useRef("")
  const loadedDirectoryRevisionRef = React.useRef<Record<string, string>>({})
  const pendingRouteSessionIdRef = React.useRef<string | undefined>(undefined)

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
  const statusCount = Object.entries(sessionState.uiState.statuses).filter(
    ([key, value]) => key.trim().length > 0 && value.trim().length > 0
  ).length

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
    setRenameValue(sessionState.sessionName || currentSessionTitle)
    setRenameOpen(true)
  }, [currentSessionTitle, sessionState.sessionName])

  const focusSessionSearch = React.useCallback(() => {
    sessionSearchInputRef.current?.focus()
    sessionSearchInputRef.current?.select()
  }, [])

  const focusModelSelector = React.useCallback(() => {
    modelSelectRef.current?.focus()
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
        setSessionState((current) => updateStateFromSync(current, payload))
        setPendingMessages(
          Array.isArray(payload.pendingUserMessages)
            ? payload.pendingUserMessages.map((message) => ({
                pendingId:
                  typeof message?.pendingId === "string"
                    ? message.pendingId
                    : "",
                text: typeof message?.text === "string" ? message.text : "",
                images: Array.isArray(message?.images)
                  ? message.images
                      .map((image: unknown) => normalizePromptImage(image))
                      .filter(
                        (image: PromptImage | null): image is PromptImage =>
                          Boolean(image)
                      )
                  : [],
                streamingBehavior:
                  message?.streamingBehavior === "steer" ? "steer" : "followUp",
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
  }, [viewerContextId, sessionId])

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

  React.useEffect(() => {
    const nextEditorText = sessionState.uiState.editorText || ""
    if (nextEditorText !== lastSyncedEditorTextRef.current) {
      setComposerText(nextEditorText)
      lastSyncedEditorTextRef.current = nextEditorText
    }
  }, [sessionState.uiState.editorText])

  React.useEffect(() => {
    if (lastStreamingRef.current && !sessionState.streaming) {
      const finishedLabel =
        currentSessionTitle !== "New session"
          ? `Session finished: ${currentSessionTitle}`
          : "Session finished"

      toast.success(finishedLabel)

      if (sessionDoneDesktopNotificationsEnabled) {
        const pageVisible =
          document.visibilityState === "visible" && document.hasFocus()

        if (!pageVisible) {
          showSessionDoneDesktopNotification({
            title: finishedLabel,
            body: sessionState.cwd || "Open Pi to Go to continue",
            tag: sessionState.sessionId || currentSessionTitle,
          })
        }
      }

      if (sessionDoneSoundEnabled) {
        void playSessionDoneSound()
      }
    }
    lastStreamingRef.current = sessionState.streaming
  }, [
    currentSessionTitle,
    sessionDoneDesktopNotificationsEnabled,
    sessionDoneSoundEnabled,
    sessionState.cwd,
    sessionState.sessionId,
    sessionState.streaming,
  ])

  React.useEffect(() => {
    const itemCount = sessionState.items.length
    const streaming = sessionState.streaming
    void itemCount
    void streaming
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [sessionState.items.length, sessionState.streaming])

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
      const currentSessions = directoryIndexes[directory]
      const isLoading = Boolean(directoryIndexLoading[directory])
      const loadedRevision = loadedDirectoryRevisionRef.current[directory]
      const needsInitialLoad = currentSessions === undefined
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

  const visibleDirectories = React.useMemo(
    () => clampSidebarDirectories(sidebarDirectories, sessionState.cwd),
    [sessionState.cwd, sidebarDirectories]
  )

  const filteredDirectorySessions = React.useMemo(() => {
    const query = sessionSearch.trim().toLowerCase()
    return Object.fromEntries(
      visibleDirectories.map((directory) => {
        const sessions = directoryIndexes[directory] || []
        const filtered = query
          ? sessions.filter((entry) => {
              const haystack = [entry.title, entry.name, entry.path]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
              return haystack.includes(query)
            })
          : sessions
        return [directory, filtered]
      })
    ) as Record<string, Array<SessionListEntry>>
  }, [directoryIndexes, sessionSearch, visibleDirectories])

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

  const addDirectory = React.useCallback(async () => {
    if (!viewerContextId) return
    try {
      const response = await fetchJson<DirectoryResolveResponse>(
        buildRequestUrl("/api/directory/resolve", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: directoryInput }),
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
      setAddDirectoryOpen(false)
      void loadDirectoryIndex(response.path)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add directory"
      )
    }
  }, [activeSessionId, directoryInput, loadDirectoryIndex, viewerContextId])

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

  const createSession = React.useCallback(async () => {
    if (!viewerContextId) return
    try {
      await fetchJson<SimpleOkResponse>(
        buildRequestUrl("/api/session/new", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: sessionState.cwd }),
        }
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create session"
      )
    }
  }, [activeSessionId, sessionState.cwd, viewerContextId])

  const submitPrompt = React.useCallback(
    async (streamingBehavior?: "steer" | "followUp") => {
      if (!viewerContextId) return
      if (!composerText.trim() && composerImages.length === 0) return

      setIsSubmitting(true)
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
              message: composerText,
              images: composerImages,
              streamingBehavior,
            }),
          }
        )
        if (isApiErrorResponse(response)) {
          throw new Error(response.error)
        }
        setComposerText("")
        setComposerImages([])
        lastSyncedEditorTextRef.current = ""
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to submit prompt"
        )
      } finally {
        setIsSubmitting(false)
      }
    },
    [activeSessionId, composerImages, composerText, viewerContextId]
  )

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
      if (!item) return
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

  const toggleHideThinking = React.useCallback(async () => {
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
          body: JSON.stringify({ hide: !sessionState.hideThinkingBlock }),
        }
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update thinking visibility"
      )
    }
  }, [activeSessionId, sessionState.hideThinkingBlock, viewerContextId])

  const runCompact = React.useCallback(async () => {
    if (!viewerContextId) return
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
    }
  }, [activeSessionId, viewerContextId])

  const openTreeDialog = React.useCallback(async () => {
    if (!viewerContextId) return
    setTreeOpen(true)
    setTreeLoading(true)
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
    }
  }, [
    activeSessionId,
    selectedTreeNodeId,
    selectedTreeNodeLabel,
    viewerContextId,
  ])

  const navigateTreeNode = React.useCallback(
    async (targetId: string) => {
      if (!viewerContextId) return
      try {
        const response = await fetchJson<NavigateSessionTreeResponse>(
          buildRequestUrl("/api/session/tree", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ targetId }),
          }
        )
        if (isApiErrorResponse(response)) throw new Error(response.error)
        if (!response.cancelled) {
          setTreeOpen(false)
          toast.success("Moved session tree cursor")
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to navigate tree"
        )
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

  const renameSession = React.useCallback(async () => {
    if (!viewerContextId || !sessionState.sessionFile) return
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
            path: sessionState.sessionFile,
            name: renameValue,
          }),
        }
      )
      if (isApiErrorResponse(response)) throw new Error(response.error)
      setRenameOpen(false)
      toast.success("Renamed session")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to rename session"
      )
    }
  }, [activeSessionId, renameValue, sessionState.sessionFile, viewerContextId])

  const deleteSession = React.useCallback(async () => {
    if (!viewerContextId || !sessionState.sessionFile) return
    try {
      const response = await fetchJson<DeleteSessionResponse>(
        buildRequestUrl("/api/session/delete", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: sessionState.sessionFile }),
        }
      )
      if (isApiErrorResponse(response)) throw new Error(response.error)
      setDeleteOpen(false)
      toast.success("Deleted session")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete session"
      )
    }
  }, [activeSessionId, sessionState.sessionFile, viewerContextId])

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
      ? filterFlatTree(flattenTree(treeData.tree), treeQuery)
      : []
  }, [treeData, treeQuery])

  const handleThemeChange = React.useCallback(
    (value: ThemeMode) => {
      setTheme(value)
    },
    [setTheme]
  )

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
        description: "Focus the sidebar session search",
        shortcut: "Ctrl+S",
        keywords: ["sidebar", "filter", "search"],
        onSelect: focusSessionSearch,
      },
      {
        id: "set-model",
        title: "Set model",
        description: "Focus the model picker",
        shortcut: "Ctrl+M",
        keywords: ["model", "provider", "picker"],
        onSelect: () => {
          if (sessionState.availableModels.length === 0) {
            throw new Error("No models are available right now.")
          }

          focusModelSelector()
        },
      },
      {
        id: "add-directory",
        title: "Add directory",
        description: "Add another directory to the sidebar",
        shortcut: "Ctrl+D",
        keywords: ["workspace", "sidebar", "directory"],
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
        description: "Manually compact the current session context",
        shortcut: "Ctrl+C",
        keywords: ["compact", "context", "summarize"],
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
        keywords: ["thinking", "reasoning", "visibility"],
        onSelect: toggleHideThinking,
      },
      {
        id: "open-settings",
        title: "Open settings",
        description: "Open theme and notification settings",
        shortcut: "Ctrl+,",
        keywords: ["settings", "theme", "notifications"],
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
        keywords: ["status", "runtime", "extension"],
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
        onSelect: () => {
          setDeleteOpen(true)
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
    openForkDialog,
    openRenameDialog,
    openSettingsDialog,
    openShortcutsDialog,
    openStatusDialog,
    openTreeDialog,
    runCompact,
    sessionState.availableModels.length,
    sessionState.hideThinkingBlock,
    sessionState.sessionFile,
    statusCount,
    toggleHideThinking,
  ])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const ctrlOrMeta = event.ctrlKey || event.metaKey
      if (!ctrlOrMeta || event.altKey) return

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

      if (key === "/" || key === "?") {
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
        setDeleteOpen(true)
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
    openForkDialog,
    openRenameDialog,
    openSettingsDialog,
    openShortcutsDialog,
    pendingUiRequest,
    renameOpen,
    runCompact,
    sessionState.availableModels.length,
    sessionState.sessionFile,
    settingsOpen,
    shortcutsOpen,
    statusOpen,
    toggleHideThinking,
    treeOpen,
  ])

  return (
    <div className="h-full overflow-hidden bg-background">
      <div className="grid h-full min-h-0 overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
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
          activeSessionId={activeSessionId}
          statusCount={statusCount}
          currentThemeLabel={currentThemeLabel}
          onCreateSession={createSession}
          onOpenAddDirectoryDialog={openAddDirectoryDialog}
          onOpenCommandPalette={openCommandPalette}
          onOpenShortcuts={openShortcutsDialog}
          onOpenStatus={openStatusDialog}
          onOpenSettings={openSettingsDialog}
          onToggleDirectory={toggleDirectory}
          onSelectSession={handleSelectSession}
          onLoadMoreDirectorySessions={loadMoreDirectorySessions}
        />

        <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border/70 px-6 py-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight">
                    {currentSessionTitle}
                  </h2>
                  {sessionState.draft && <Badge variant="outline">Draft</Badge>}
                  {sessionState.streaming && (
                    <Badge variant="outline">Streaming</Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
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

              <div className="flex flex-wrap gap-2">
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
                  disabled={!sessionState.sessionFile}
                  onClick={openRenameDialog}
                >
                  <PencilIcon /> Rename
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!sessionState.sessionFile}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2Icon /> Delete
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Model</CardTitle>
                </CardHeader>
                <CardContent>
                  <select
                    ref={modelSelectRef}
                    className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
                    value={
                      sessionState.model
                        ? `${sessionState.model.provider}/${sessionState.model.id}`
                        : ""
                    }
                    onChange={(event) => void setModel(event.target.value)}
                  >
                    {sessionState.availableModels.map((model) => (
                      <option
                        key={`${model.provider}/${model.id}`}
                        value={`${model.provider}/${model.id}`}
                      >
                        {model.provider}/{model.name || model.id}
                      </option>
                    ))}
                  </select>
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Thinking</CardTitle>
                </CardHeader>
                <CardContent>
                  <select
                    className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
                    value={sessionState.thinkingLevel}
                    onChange={(event) =>
                      void setThinkingLevel(event.target.value)
                    }
                  >
                    {sessionState.availableThinkingLevels.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Thinking blocks</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleHideThinking}
                  >
                    {sessionState.hideThinkingBlock ? "Show" : "Hide"} thinking
                  </Button>
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Skills</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {sessionState.availableSkills.length} available
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Connection</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ConnectionBadge connected={sessionState.connected} />
                </CardContent>
              </Card>
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
                    <ScrollArea className="min-h-0 flex-1 pr-4">
                      {sessionState.items.length > 0 ? (
                        <div className="space-y-4">
                          {(() => {
                            const counts = new Map<string, number>()
                            return sessionState.items.map((item) => {
                              const baseKey = conversationItemSignature(item)
                              const count = (counts.get(baseKey) ?? 0) + 1
                              counts.set(baseKey, count)
                              const key = `${baseKey}:${count}`

                              return item.kind === "user" ? (
                                <div key={key} className="flex justify-end">
                                  <UserMessageCard item={item} />
                                </div>
                              ) : (
                                <div key={key} className="flex justify-start">
                                  <AssistantMessageCard
                                    item={item}
                                    hideThinking={
                                      sessionState.hideThinkingBlock
                                    }
                                    hiddenThinkingLabel={
                                      sessionState.uiState
                                        .hiddenThinkingLabel ||
                                      sessionState.hiddenThinkingPreview
                                    }
                                  />
                                </div>
                              )
                            })
                          })()}
                          <div ref={bottomRef} />
                        </div>
                      ) : (
                        <Empty className="border border-dashed bg-card/60">
                          <EmptyHeader>
                            <EmptyMedia variant="icon">
                              <SparklesIcon />
                            </EmptyMedia>
                            <EmptyTitle>Start a new conversation</EmptyTitle>
                            <EmptyDescription>
                              This is the native Pi to Go session view backed by
                              the new TypeScript runtime.
                            </EmptyDescription>
                          </EmptyHeader>
                          <EmptyContent>
                            <Button onClick={createSession}>New session</Button>
                          </EmptyContent>
                        </Empty>
                      )}
                    </ScrollArea>

                    <ComposerPanel
                      currentPendingMessages={currentPendingMessages}
                      composerImages={composerImages}
                      composerText={composerText}
                      isSubmitting={isSubmitting}
                      isStreaming={sessionState.streaming}
                      fileInputRef={fileInputRef}
                      onComposerTextChange={setComposerText}
                      onPickImages={(files) => {
                        void onPickImages(files)
                      }}
                      onRemoveComposerImage={(index) => {
                        setComposerImages((current) =>
                          current.filter(
                            (_, imageIndex) => imageIndex !== index
                          )
                        )
                      }}
                      onCreateSession={createSession}
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
        </main>
      </div>

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
        onAddDirectory={() => {
          void addDirectory()
        }}
        renameOpen={renameOpen}
        onRenameOpenChange={setRenameOpen}
        renameValue={renameValue}
        onRenameValueChange={setRenameValue}
        onRenameSession={() => {
          void renameSession()
        }}
        deleteOpen={deleteOpen}
        onDeleteOpenChange={setDeleteOpen}
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
        treeQuery={treeQuery}
        onTreeQueryChange={setTreeQuery}
        flatTree={flatTree}
        selectedTreeNodeId={selectedTreeNodeId}
        onSelectedTreeNodeIdChange={setSelectedTreeNodeId}
        selectedTreeNodeLabel={selectedTreeNodeLabel}
        onSelectedTreeNodeLabelChange={setSelectedTreeNodeLabel}
        onNavigateTreeNode={(targetId) => {
          void navigateTreeNode(targetId)
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
    </div>
  )
}
