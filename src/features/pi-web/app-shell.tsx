import * as React from "react"
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  ArrowDownIcon,
  ArrowDownToLineIcon,
  ArrowUpIcon,
  ArrowUpToLineIcon,
  EllipsisIcon,
  SquarePenIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { toast } from "sonner"

import type { DesktopNotificationPermission } from "@/features/pi-web/session-done-notifications"
import type {
  AssistantItem,
  ConversationItem,
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
  EmptyTitle,
} from "@/components/ui/empty"
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
  assistantMessageHasVisibleBlocks,
  conversationItemSignature,
} from "@/features/pi-web/conversation-view"
import {
  parseComposerSkillMessage,
  serializeComposerDraft,
} from "@/features/pi-web/composer-utils"
import { GitPanel } from "@/features/pi-web/git-panel"
import {
  piWebQueryKeys,
  piWebSessionScopeKey,
} from "@/features/pi-web/query-keys"
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

function mergeAssistantTurns(items: Array<ConversationItem>) {
  const merged: Array<ConversationItem> = []
  let pendingAssistant: AssistantItem | null = null

  for (const item of items) {
    if (item.kind === "assistant") {
      if (!pendingAssistant) {
        pendingAssistant = {
          kind: "assistant",
          blocks: [...item.blocks],
          streaming: item.streaming,
        }
      } else {
        pendingAssistant.blocks.push(...item.blocks)
        pendingAssistant.streaming =
          pendingAssistant.streaming || item.streaming
      }

      continue
    }

    if (pendingAssistant) {
      merged.push(pendingAssistant)
      pendingAssistant = null
    }

    merged.push(item)
  }

  if (pendingAssistant) {
    merged.push(pendingAssistant)
  }

  return merged
}

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
  return (
    root.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ||
    (root instanceof HTMLDivElement ? root : null)
  )
}

function isViewportNearTop(viewport: HTMLDivElement, threshold = 48) {
  return viewport.scrollTop < threshold
}

function isViewportNearBottom(viewport: HTMLDivElement, threshold = 48) {
  return (
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
    threshold
  )
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

function formatDisplayPath(value: string | undefined) {
  const path = value?.trim() || ""
  if (!path) return ""

  return path
    .replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/home\/[^/]+(?=\/|$)/, "~")
}

function finishedSessionLabel(title: string) {
  return title !== "New session"
    ? `Session finished: ${title}`
    : "Session finished"
}

type DirectoryResolveData = Extract<DirectoryResolveResponse, { ok: true }>
type DirectorySessionsIndexData = Extract<
  DirectorySessionsIndexResponse,
  { ok: true }
>
type GitStatusData = Extract<GitStatusResponse, { ok: true }>
type GitChangesData = Extract<GitChangesResponse, { ok: true }>
type SessionTreeData = Extract<SessionTreeResponse, { ok: true }>
type NavigateSessionTreeData = Extract<
  NavigateSessionTreeResponse,
  { ok: true }
>
type ForkableMessagesData = Extract<ForkableMessagesResponse, { ok: true }>

function sessionScrollKey(sessionState: {
  draft: boolean
  sessionFile?: string
  sessionId?: string
  cwd?: string
}) {
  return piWebSessionScopeKey(sessionState)
}

function directorySessionsIndexQueryOptions({
  viewerContextId,
  directory,
}: {
  viewerContextId: string
  directory: string
}) {
  return {
    queryKey: piWebQueryKeys.directorySessionsIndex(viewerContextId, directory),
    queryFn: () =>
      fetchJson<DirectorySessionsIndexData>(
        buildRequestUrl(
          `/api/directory-sessions-index?directory=${encodeURIComponent(
            directory
          )}`,
          {
            contextId: viewerContextId,
          }
        )
      ),
    staleTime: Infinity,
    gcTime: 1000 * 60 * 10,
  }
}

function gitStatusQueryOptions({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd: string
}) {
  return {
    queryKey: piWebQueryKeys.gitStatus(viewerContextId, cwd),
    queryFn: () =>
      fetchJson<GitStatusData>(
        buildRequestUrl(`/api/git-status?cwd=${encodeURIComponent(cwd)}`, {
          contextId: viewerContextId,
        })
      ),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  }
}

function gitChangesQueryOptions({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd: string
}) {
  return {
    queryKey: piWebQueryKeys.gitChanges(viewerContextId, cwd),
    queryFn: () =>
      fetchJson<GitChangesData>(
        buildRequestUrl(`/api/git-changes?cwd=${encodeURIComponent(cwd)}`, {
          contextId: viewerContextId,
        })
      ),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  }
}

function sessionTreeQueryOptions({
  viewerContextId,
  sessionScopeKey,
  sessionId,
}: {
  viewerContextId: string
  sessionScopeKey: string
  sessionId?: string
}) {
  return {
    queryKey: piWebQueryKeys.sessionTree(viewerContextId, sessionScopeKey),
    queryFn: () =>
      fetchJson<SessionTreeData>(
        buildRequestUrl("/api/session/tree", {
          contextId: viewerContextId,
          sessionId,
        })
      ),
    staleTime: 0,
    gcTime: 1000 * 60 * 10,
  }
}

function forkableMessagesQueryOptions({
  viewerContextId,
  sessionScopeKey,
  sessionId,
}: {
  viewerContextId: string
  sessionScopeKey: string
  sessionId?: string
}) {
  return {
    queryKey: piWebQueryKeys.forkableMessages(viewerContextId, sessionScopeKey),
    queryFn: () =>
      fetchJson<ForkableMessagesData>(
        buildRequestUrl("/api/session/fork", {
          contextId: viewerContextId,
          sessionId,
        })
      ),
    staleTime: 0,
    gcTime: 1000 * 60 * 10,
  }
}

function messageAnchors(viewport: HTMLDivElement) {
  return [
    ...viewport.querySelectorAll<HTMLElement>("[data-message-anchor='true']"),
  ]
}

function currentMessageAnchorIndex(
  anchors: Array<HTMLElement>,
  viewport: HTMLDivElement
) {
  if (anchors.length === 0) return -1

  const viewportTop = viewport.scrollTop + 8
  let currentIndex = 0

  for (let index = 0; index < anchors.length; index += 1) {
    if (anchors[index].offsetTop <= viewportTop) {
      currentIndex = index
      continue
    }

    break
  }

  return currentIndex
}

function previousMessageJumpTarget(viewport: HTMLDivElement) {
  const anchors = messageAnchors(viewport)
  const currentIndex = currentMessageAnchorIndex(anchors, viewport)
  if (currentIndex <= 0) return null
  return anchors[currentIndex - 1]
}

function nextMessageJumpTarget(viewport: HTMLDivElement) {
  const anchors = messageAnchors(viewport)
  const currentIndex = currentMessageAnchorIndex(anchors, viewport)
  if (currentIndex < 0 || currentIndex >= anchors.length - 1) return null
  return anchors[currentIndex + 1]
}

function useLatestRef<T>(value: T) {
  const ref = React.useRef(value)
  ref.current = value
  return ref
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
  const [composerDraftSeed, setComposerDraftSeed] = React.useState<{
    text: string
    skillName?: string
  }>({ text: "" })
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
  const [pendingDraftPrompt, setPendingDraftPrompt] = React.useState<{
    ownerKey: string
    message: string
    images: Array<PromptImage>
    streamingBehavior?: StreamingBehavior
  } | null>(null)
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
  const [addDirectoryOpen, setAddDirectoryOpen] = React.useState(false)
  const [directoryInput, setDirectoryInput] = React.useState("")
  const [recentDirectories, setRecentDirectories] = React.useState<
    Array<string>
  >([])
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [renameTarget, setRenameTarget] =
    React.useState<SessionListEntry | null>(null)
  const [renameValue, setRenameValue] = React.useState("")
  const [deleteTargets, setDeleteTargets] = React.useState<
    Array<SessionListEntry>
  >([])
  const [forkOpen, setForkOpen] = React.useState(false)
  const [treeOpen, setTreeOpen] = React.useState(false)
  const [treeQuery, setTreeQuery] = React.useState("")
  const [selectedTreeNodeId, setSelectedTreeNodeId] = React.useState<
    string | null
  >(null)
  const [selectedTreeNodeLabel, setSelectedTreeNodeLabel] = React.useState("")
  const [pendingUiRequest, setPendingUiRequest] =
    React.useState<ExtensionUiEvent | null>(null)
  const [pendingUiValue, setPendingUiValue] = React.useState("")
  const [commandPaletteOpen, setCommandPaletteOpen] = React.useState(false)
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
  const [
    backgroundCurrentSessionUnreadKey,
    setBackgroundCurrentSessionUnreadKey,
  ] = React.useState("")
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const sessionSearchInputRef = React.useRef<HTMLInputElement | null>(null)
  const composerPanelRef = React.useRef<ComposerPanelHandle | null>(null)
  const messagesScrollAreaRef = React.useRef<HTMLDivElement | null>(null)
  const bottomRef = React.useRef<HTMLDivElement | null>(null)
  const messageViewportRef = React.useRef<HTMLDivElement | null>(null)
  const [isMessagesNearTop, setIsMessagesNearTop] = React.useState(true)
  const [isMessagesNearBottom, setIsMessagesNearBottom] = React.useState(true)
  const [hasPreviousMessageJumpTarget, setHasPreviousMessageJumpTarget] =
    React.useState(false)
  const [hasNextMessageJumpTarget, setHasNextMessageJumpTarget] =
    React.useState(false)
  const lastStreamingRef = React.useRef(false)
  const lastSyncedEditorTextRef = React.useRef("")
  const sessionStateRef = React.useRef(sessionState)
  const composerTextRef = React.useRef(composerDraftSeed.text)
  const composerSkillRef = React.useRef<string | undefined>(
    composerDraftSeed.skillName
  )
  const sidebarDirectorySessionsSnapshotRef = React.useRef<{
    activeSessionId: string
    activeSessionKey: string
    activeSessionPath: string
    revisions: Record<string, string>
  } | null>(null)
  const pendingRouteSessionIdRef = React.useRef<string | undefined>(undefined)
  const lastEscapePressedAtRef = React.useRef(0)
  const sessionUnreadSnapshotsRef = React.useRef<Map<string, boolean>>(
    new Map()
  )
  const sessionUnreadSnapshotsReadyRef = React.useRef(false)
  const lastLoadedSessionScrollKeyRef = React.useRef("")

  const { resolvedTheme, setTheme, theme } = useTheme()
  const currentTheme = normalizeThemeMode(theme)
  const currentThemeLabel = themeModeLabel(currentTheme, resolvedTheme)

  const activeSessionId = sessionState.sessionId || sessionId
  const queryClient = useQueryClient()
  const directoryStates = sessionsEvent?.directoryStates || []
  const directoryStateByPath = (() =>
    new Map(directoryStates.map((state) => [state.path, state])))()
  const baseSidebarDirectories = (() =>
    normalizeStoredDirectoryList(sidebarDirectories))()
  const directoryIndexQueries = useQueries({
    queries: baseSidebarDirectories.map((directory) => ({
      ...directorySessionsIndexQueryOptions({
        viewerContextId,
        directory,
      }),
      enabled: Boolean(viewerContextId),
      placeholderData: (previousData?: DirectorySessionsIndexData) =>
        previousData,
    })),
  })
  const directoryIndexes = (() => {
    const nextIndexes: Record<string, Array<SessionListEntry>> = {}

    for (const [index, directory] of baseSidebarDirectories.entries()) {
      const response = directoryIndexQueries[index]?.data
      nextIndexes[directory] = response?.sessions || []
    }

    return nextIndexes
  })()
  const directoryIndexLoading = (() => {
    const nextLoading: Record<string, boolean> = {}

    for (const [index, directory] of baseSidebarDirectories.entries()) {
      const query = directoryIndexQueries[index]
      nextLoading[directory] = Boolean(query?.isPending && !query.data)
    }

    return nextLoading
  })()
  const currentSessionQueryScope = sessionScrollKey(sessionState)
  const shouldLoadDraftGitStatus = Boolean(
    viewerContextId &&
    sessionState.draft &&
    sessionState.items.length === 0 &&
    sessionState.cwd
  )
  const gitStatusQuery = useQuery({
    ...gitStatusQueryOptions({
      viewerContextId,
      cwd: sessionState.cwd || "",
    }),
    enabled: Boolean(
      viewerContextId &&
      sessionState.cwd &&
      (currentTab === "git" || shouldLoadDraftGitStatus)
    ),
  })
  const gitChangesQuery = useQuery({
    ...gitChangesQueryOptions({
      viewerContextId,
      cwd: sessionState.cwd || "",
    }),
    enabled: Boolean(
      viewerContextId && sessionState.cwd && currentTab === "git"
    ),
  })
  const treeQueryResult = useQuery({
    ...sessionTreeQueryOptions({
      viewerContextId,
      sessionScopeKey: currentSessionQueryScope,
      sessionId: activeSessionId,
    }),
    enabled: Boolean(viewerContextId && treeOpen && currentSessionQueryScope),
  })
  const forkMessagesQuery = useQuery({
    ...forkableMessagesQueryOptions({
      viewerContextId,
      sessionScopeKey: currentSessionQueryScope,
      sessionId: activeSessionId,
    }),
    enabled: Boolean(viewerContextId && forkOpen && currentSessionQueryScope),
  })
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
    (currentSessionTitle !== "New session" ? currentSessionTitle : "Pi")
  const deleteOpen = deleteTargets.length > 0
  const gitStatus = gitStatusQuery.data ?? null
  const gitChanges = gitChangesQuery.data ?? null
  const gitLoading = Boolean(
    currentTab === "git" &&
    ((gitStatusQuery.isPending && !gitStatusQuery.data) ||
      (gitChangesQuery.isPending && !gitChangesQuery.data))
  )
  const treeData = treeQueryResult.data ?? null
  const treeLoading = Boolean(
    treeQueryResult.isPending && !treeQueryResult.data
  )
  const forkMessages = forkMessagesQuery.data?.messages ?? null
  const forkLoading = Boolean(
    forkMessagesQuery.isPending && !forkMessagesQuery.data
  )

  React.useEffect(() => {
    sessionStateRef.current = sessionState
  }, [sessionState])

  const syncComposerDraft = (
    value: string,
    target = sessionStateRef.current
  ) => {
    const parsed = parseComposerSkillMessage(value)
    const nextText = parsed.matched ? parsed.text : value
    const nextSkill = parsed.matched ? parsed.skillName : undefined

    composerTextRef.current = nextText
    composerSkillRef.current = nextSkill
    rememberStoredPromptDraft(
      target,
      serializeComposerDraft({ text: nextText, skillName: nextSkill })
    )
  }

  const replaceComposerDraft = (
    value: string,
    target = sessionStateRef.current
  ) => {
    const parsed = parseComposerSkillMessage(value)
    const nextText = parsed.matched ? parsed.text : value
    const nextSkill = parsed.matched ? parsed.skillName : undefined

    composerTextRef.current = nextText
    composerSkillRef.current = nextSkill
    setComposerDraftSeed({ text: nextText, skillName: nextSkill })
    rememberStoredPromptDraft(
      target,
      serializeComposerDraft({ text: nextText, skillName: nextSkill })
    )
  }
  const replaceComposerDraftRef = useLatestRef(replaceComposerDraft)

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

  const openCommandPalette = () => {
    setSettingsOpen(false)
    setCommandPaletteOpen(true)
  }

  const openSettingsDialog = () => {
    setCommandPaletteOpen(false)
    setSettingsOpen(true)
  }

  const openRenameDialog = () => {
    setRenameTarget(null)
    setRenameValue(sessionState.sessionName || currentSessionTitle)
    setRenameOpen(true)
  }

  const focusSessionSearch = () => {
    sessionSearchInputRef.current?.focus()
    sessionSearchInputRef.current?.select()
  }

  const focusModelSelector = () => {
    composerPanelRef.current?.openModelPicker()
  }

  const handleSessionDoneSoundEnabledChange = (enabled: boolean) => {
    setSessionDoneSoundEnabled(enabled)
    safeLocalStorageSetItem(
      SESSION_DONE_SOUND_ENABLED_STORAGE_KEY,
      enabled ? "1" : "0"
    )

    if (enabled) {
      void primeSessionDoneSound()
    }
  }

  const handleSessionDoneDesktopNotificationsEnabledChange = async (
    enabled: boolean
  ) => {
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
  }

  const handleSelectSession = (nextSessionId?: string) => {
    pendingRouteSessionIdRef.current = nextSessionId
    onSelectSession?.(nextSessionId)
  }
  const handleSelectSessionRef = useLatestRef(handleSelectSession)

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

        replaceComposerDraftRef.current(nextPromptText, nextState)
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
  }, [replaceComposerDraftRef, sessionId, viewerContextId])

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
    sessionId,
    sessionState.draft,
    sessionState.sessionId,
  ])

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
          body: sessionState.cwd || "Open Pi to continue",
          tag:
            sessionState.sessionFile ||
            sessionState.sessionId ||
            currentSessionTitle,
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
      setIsMessagesNearTop(isViewportNearTop(viewport))
      setIsMessagesNearBottom(isViewportNearBottom(viewport))
      setHasPreviousMessageJumpTarget(
        Boolean(previousMessageJumpTarget(viewport))
      )
      setHasNextMessageJumpTarget(Boolean(nextMessageJumpTarget(viewport)))
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
    if (!viewerContextId || !sessionsEvent) return

    const previousSnapshot = sidebarDirectorySessionsSnapshotRef.current
    const activeSessionChanged =
      Boolean(previousSnapshot) &&
      (previousSnapshot?.activeSessionId !==
        (sessionsEvent.activeSessionId || "") ||
        previousSnapshot?.activeSessionKey !==
          (sessionsEvent.activeSessionKey || "") ||
        previousSnapshot?.activeSessionPath !==
          (sessionsEvent.activeSessionPath || ""))
    const nextRevisions: Record<string, string> = {}

    for (const directory of baseSidebarDirectories) {
      const nextRevision = directoryStateByPath.get(directory)?.revision || ""
      const previousRevision = previousSnapshot?.revisions[directory] || ""
      nextRevisions[directory] = nextRevision

      if (!activeSessionChanged && previousRevision === nextRevision) {
        continue
      }

      const queryState = queryClient.getQueryState(
        piWebQueryKeys.directorySessionsIndex(viewerContextId, directory)
      )
      if (!queryState?.dataUpdatedAt) {
        continue
      }

      void queryClient.invalidateQueries({
        queryKey: piWebQueryKeys.directorySessionsIndex(
          viewerContextId,
          directory
        ),
        exact: true,
        refetchType: "active",
      })
    }

    sidebarDirectorySessionsSnapshotRef.current = {
      activeSessionId: sessionsEvent.activeSessionId || "",
      activeSessionKey: sessionsEvent.activeSessionKey || "",
      activeSessionPath: sessionsEvent.activeSessionPath || "",
      revisions: nextRevisions,
    }
  }, [
    baseSidebarDirectories,
    directoryStateByPath,
    queryClient,
    sessionsEvent,
    viewerContextId,
  ])

  React.useEffect(() => {
    if (currentTab !== "git") return

    const error = gitChangesQuery.error || gitStatusQuery.error
    if (!error) return

    toast.error(
      error instanceof Error ? error.message : "Failed to load git view"
    )
  }, [
    currentTab,
    gitChangesQuery.error,
    gitChangesQuery.errorUpdatedAt,
    gitStatusQuery.error,
    gitStatusQuery.errorUpdatedAt,
  ])

  React.useEffect(() => {
    if (!treeOpen || !treeQueryResult.error) return

    toast.error(
      treeQueryResult.error instanceof Error
        ? treeQueryResult.error.message
        : "Failed to load tree"
    )
    setTreeOpen(false)
  }, [treeOpen, treeQueryResult.error, treeQueryResult.errorUpdatedAt])

  React.useEffect(() => {
    if (!forkOpen || !forkMessagesQuery.error) return

    toast.error(
      forkMessagesQuery.error instanceof Error
        ? forkMessagesQuery.error.message
        : "Failed to load forks"
    )
    setForkOpen(false)
  }, [forkMessagesQuery.error, forkMessagesQuery.errorUpdatedAt, forkOpen])

  React.useEffect(() => {
    if (!treeOpen || !treeData) return

    const flat = flattenTree(treeData.tree)
    setSelectedTreeNodeId((current) => {
      if (current && flat.some((entry) => entry.id === current)) {
        return current
      }
      return treeData.leafId
    })
  }, [treeData, treeOpen])

  React.useEffect(() => {
    if (!treeData) return

    const flat = flattenTree(treeData.tree)
    const fallbackId = selectedTreeNodeId || treeData.leafId
    const selected = flat.find((entry) => entry.id === fallbackId)
    setSelectedTreeNodeLabel(selected?.label || "")
  }, [selectedTreeNodeId, treeData])

  const refreshGit = async () => {
    if (!viewerContextId || !sessionState.cwd) return

    try {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: piWebQueryKeys.gitStatus(viewerContextId, sessionState.cwd),
          exact: true,
          refetchType: "all",
        }),
        queryClient.invalidateQueries({
          queryKey: piWebQueryKeys.gitChanges(
            viewerContextId,
            sessionState.cwd
          ),
          exact: true,
          refetchType: "all",
        }),
      ])
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load git view"
      )
    }
  }

  const defaultNewSessionDirectory =
    sessionState.cwd?.trim() ||
    baseSidebarDirectories[0] ||
    storedDraftDirectory ||
    ""
  const newSessionDirectoryOptions = (() => {
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
  })()

  const knownDirectories = (() =>
    normalizeStoredDirectoryList([
      ...sidebarDirectories,
      sessionState.cwd || "",
      ...Array.from(directoryStateByPath.keys()),
      ...Object.values(directoryIndexes).flatMap((entries) =>
        entries.map((entry) => entry.cwd || "")
      ),
    ]))()

  const sidebarSearchPending = (() => {
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
  })()

  const {
    visibleDirectories,
    filteredDirectorySessions,
    emptySidebarStateText,
  } = (() => {
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
  })()

  const allDirectoriesCollapsed = (() =>
    baseSidebarDirectories.length > 0 &&
    baseSidebarDirectories.every(
      (directory) => collapsedDirectories[directory]
    ))()

  const toggleAllDirectories = () => {
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
  }

  const reorderSidebarDirectories = (nextDirectories: Array<string>) => {
    const normalizedNext = normalizeStoredDirectoryList(nextDirectories)
    if (normalizedNext.length === 0) return

    setSidebarDirectories((current) => {
      const previous = normalizeStoredDirectoryList(current)
      if (JSON.stringify(previous) === JSON.stringify(normalizedNext)) {
        return current
      }

      safeLocalStorageSetItem(
        SIDEBAR_DIRECTORIES_STORAGE_KEY,
        JSON.stringify(normalizedNext)
      )
      return normalizedNext
    })
  }

  const sidebarSessionEntriesByKey = (() => {
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
  })()

  const sidebarSessions = (() =>
    Array.from(sidebarSessionEntriesByKey.values()))()
  const unreadSessionCount = (() => {
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
  })()

  React.useEffect(() => {
    const streamingPrefix = sessionState.streaming
      ? `${TITLE_STREAMING_FRAMES[titleStreamingFrameIndex]} `
      : ""
    const nextTitle = `${streamingPrefix}${currentPageTitle}`
    document.title =
      unreadSessionCount > 0
        ? `(${unreadSessionCount}) ${nextTitle}`
        : nextTitle
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
          body: session.cwd || "Open Pi to continue",
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

  const renderedSidebarSessionKeys = (() => {
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
  })()

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

  const selectedSidebarSessions = (() =>
    selectedSidebarSessionKeys
      .map((key) => sidebarSessionEntriesByKey.get(key))
      .filter((entry): entry is SessionListEntry =>
        Boolean(entry?.path || entry?.id)
      ))()

  const setSidebarSelection = (nextKeys: Array<string>, anchorKey = "") => {
    const normalizedKeys = normalizeSessionSelectionKeys(nextKeys)
    setSelectedSidebarSessionKeys(normalizedKeys)
    setSidebarSessionSelectionAnchor(
      normalizedKeys.length === 0
        ? ""
        : anchorKey && normalizedKeys.includes(anchorKey)
          ? anchorKey
          : (normalizedKeys[normalizedKeys.length - 1] ?? "")
    )
  }

  const selectSidebarSessionRange = (targetKey: string) => {
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
      : (selectedSidebarSessionKeys.find((key) => orderedKeys.includes(key)) ??
        normalizedTargetKey)
    const anchorIndex = orderedKeys.indexOf(anchorKey)
    if (anchorIndex < 0) {
      setSidebarSelection([normalizedTargetKey], normalizedTargetKey)
      return
    }

    const start = Math.min(anchorIndex, targetIndex)
    const end = Math.max(anchorIndex, targetIndex)
    setSidebarSelection(orderedKeys.slice(start, end + 1), anchorKey)
  }

  const openDeleteDialog = (targets: Array<SessionListEntry>) => {
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
  }

  const openDeleteDialogForCurrentSession = () => {
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
  }

  const handleSidebarSessionClick = (
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
  }

  const openAddDirectoryDialog = () => {
    setDirectoryInput("")
    setAddDirectoryOpen(true)
  }

  const loadMoreDirectorySessions = (directory: string) => {
    setDirectoryRenderCounts((current) => ({
      ...current,
      [directory]:
        (current[directory] ?? INITIAL_DIRECTORY_SESSION_RENDER_COUNT) +
        DIRECTORY_SESSION_LOAD_MORE_COUNT,
    }))
  }

  const rememberRecentDirectory = (directory: string) => {
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
  }

  const addDirectoryMutation = useMutation({
    mutationFn: async (requestedPath: string) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<DirectoryResolveData>(
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
    },
  })

  const addDirectoryPath = async (path: string) => {
    if (!viewerContextId) return
    const requestedPath = path.trim()
    if (!requestedPath) return

    try {
      const response = await addDirectoryMutation.mutateAsync(requestedPath)
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
      void queryClient.prefetchQuery(
        directorySessionsIndexQueryOptions({
          viewerContextId,
          directory: response.path,
        })
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add directory"
      )
    }
  }

  const addDirectory = async () => {
    await addDirectoryPath(directoryInput)
  }

  const toggleDirectory = (directory: string) => {
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
  }

  const applyPendingDraftPromptToComposer = (pendingPrompt: {
    message: string
    images: Array<PromptImage>
  }) => {
    replaceComposerDraft(pendingPrompt.message)
    setComposerImages(pendingPrompt.images.map((image) => ({ ...image })))
    return true
  }

  const normalizeQueuedStreamingBehavior = (
    streamingBehavior?: StreamingBehavior
  ) => (streamingBehavior === "followUp" ? "followUp" : "steer")

  const restorePendingDraftPrompt = (ownerKey: string) => {
    if (!pendingDraftPrompt || pendingDraftPrompt.ownerKey !== ownerKey) {
      return false
    }
    const nextPrompt = pendingDraftPrompt
    setPendingDraftPrompt(null)
    setPendingDraftFollowUps([])
    setAwaitingFirstTurn(false)
    return applyPendingDraftPromptToComposer(nextPrompt)
  }

  const createSessionMutation = useMutation({
    mutationFn: async ({ cwd }: { cwd?: string }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<SimpleOkResponse>(
        buildRequestUrl("/api/session/new", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd }),
        }
      )
    },
  })

  const createSession = async (cwdOverride?: string) => {
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
      await createSessionMutation.mutateAsync({ cwd: nextCwd })
      handleSelectSession(undefined)
    } catch (error) {
      setDraftSessionLoadingOwnerKey((current) =>
        current === ownerKey ? null : current
      )
      restorePendingDraftPrompt(ownerKey)
      toast.error(
        error instanceof Error ? error.message : "Failed to create session"
      )
    }
  }

  const queuePendingDraftPrompt = (streamingBehavior?: StreamingBehavior) => {
    if (!draftSessionLoadingOwnerKey) return false

    const message = serializeComposerDraft({
      text: composerTextRef.current,
      skillName: composerSkillRef.current,
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
          streamingBehavior:
            normalizeQueuedStreamingBehavior(streamingBehavior),
        },
      ])
    }

    replaceComposerDraft("")
    setComposerImages([])
    lastSyncedEditorTextRef.current = ""

    if (!pendingDraftPrompt) {
      toast.info("Prompt will send when the new session is ready.")
    }

    return true
  }

  const promptMutation = useMutation({
    mutationFn: async ({
      message,
      images,
      streamingBehavior,
    }: {
      message: string
      images: Array<PromptImage>
      streamingBehavior?: StreamingBehavior
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<PromptResponse>(
        buildRequestUrl("/api/prompt", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message,
            images,
            streamingBehavior,
          }),
        }
      )
    },
  })

  const submitPrompt = async (streamingBehavior?: StreamingBehavior) => {
    if (!viewerContextId) return false
    if (draftSessionLoadingOwnerKey) {
      return queuePendingDraftPrompt(streamingBehavior)
    }

    const message = serializeComposerDraft({
      text: composerTextRef.current,
      skillName: composerSkillRef.current,
    }).trim()
    if (!message && composerImages.length === 0) return false

    const treatAsQueuedPrompt = Boolean(
      sessionState.streaming || awaitingFirstTurn
    )
    const normalizedStreamingBehavior = treatAsQueuedPrompt
      ? normalizeQueuedStreamingBehavior(streamingBehavior)
      : streamingBehavior

    setIsSubmitting(true)
    if (!treatAsQueuedPrompt) {
      setAwaitingFirstTurn(true)
    }

    try {
      await promptMutation.mutateAsync({
        message,
        images: composerImages,
        streamingBehavior: normalizedStreamingBehavior,
      })
      replaceComposerDraft("")
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
  }

  const flushPendingDraftFollowUps = async () => {
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
        await promptMutation.mutateAsync({
          message: followUp.message,
          images: followUp.images,
          streamingBehavior: followUp.streamingBehavior,
        })
      } catch (error) {
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
    }

    return true
  }

  const flushPendingDraftPrompt = async (ownerKey: string) => {
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
  }
  const flushPendingDraftPromptRef = useLatestRef(flushPendingDraftPrompt)

  React.useEffect(() => {
    if (!draftSessionLoadingOwnerKey) return
    const currentOwnerKey = promptDraftKey(sessionState)
    if (
      !sessionState.draft ||
      currentOwnerKey !== draftSessionLoadingOwnerKey
    ) {
      return
    }

    setDraftSessionLoadingOwnerKey(null)
    if (pendingDraftPrompt?.ownerKey === draftSessionLoadingOwnerKey) {
      void flushPendingDraftPromptRef.current(draftSessionLoadingOwnerKey)
    }
  }, [
    draftSessionLoadingOwnerKey,
    flushPendingDraftPromptRef,
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

    if (
      sessionState.streaming ||
      hasAssistantOutput ||
      pendingMessages.length > 0
    ) {
      setAwaitingFirstTurn(false)
    }
  }, [
    awaitingFirstTurn,
    pendingMessages.length,
    sessionState.items,
    sessionState.streaming,
  ])

  const abortSessionMutation = useMutation({
    mutationFn: async () => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<SimpleOkResponse>(
        buildRequestUrl("/api/abort", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
        }
      )
    },
  })

  const abortSession = async () => {
    if (!viewerContextId) return
    try {
      await abortSessionMutation.mutateAsync()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to abort session"
      )
    }
  }

  const onPickImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const nextImages = await Promise.all(
      [...files].slice(0, 8).map((file) => readFileAsPromptImage(file))
    )
    setComposerImages((current) => [...current, ...nextImages].slice(0, 8))
  }

  const removePendingMessageMutation = useMutation({
    mutationFn: async (pendingId: string) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<PendingMessageRemoveResponse>(
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
    },
  })

  const removePendingMessage = async (pendingId: string) => {
    if (!viewerContextId) return
    try {
      await removePendingMessageMutation.mutateAsync(pendingId)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to remove pending prompt"
      )
    }
  }

  const currentPendingMessages = pendingMessages

  const reorderPendingMessagesMutation = useMutation({
    mutationFn: async (
      nextPendingMessages: Array<{
        pendingId: string
        text: string
        images: Array<PromptImage>
        streamingBehavior: "steer" | "followUp"
      }>
    ) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<PendingMessagesResponse>(
        buildRequestUrl("/api/pending-messages/reorder", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pendingMessages: nextPendingMessages }),
        }
      )
    },
  })

  const reorderPending = async (pendingId: string, direction: -1 | 1) => {
    if (!viewerContextId) return
    const next = [...pendingMessages]
    const index = next.findIndex((entry) => entry.pendingId === pendingId)
    if (index === -1) return
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= next.length) return
    const [item] = next.splice(index, 1)
    next.splice(targetIndex, 0, item)
    try {
      await reorderPendingMessagesMutation.mutateAsync(next)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to reorder pending prompts"
      )
    }
  }

  const setModelMutation = useMutation({
    mutationFn: async ({
      provider,
      modelId,
    }: {
      provider: string
      modelId: string
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson(
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
    },
  })

  const setModel = async (value: string) => {
    if (!viewerContextId) return
    const [provider, modelId] = value.split("/")
    if (!provider || !modelId) return
    try {
      await setModelMutation.mutateAsync({ provider, modelId })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update model"
      )
    }
  }

  const setThinkingLevelMutation = useMutation({
    mutationFn: async (level: string) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson(
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
    },
  })

  const setThinkingLevel = async (level: string) => {
    if (!viewerContextId) return
    try {
      await setThinkingLevelMutation.mutateAsync(level)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update thinking level"
      )
    }
  }

  const cycleThinkingLevel = async (direction: -1 | 1) => {
    const levels = sessionState.availableThinkingLevels.length
      ? sessionState.availableThinkingLevels
      : ["off"]
    const currentIndex = levels.indexOf(sessionState.thinkingLevel || "off")
    const safeIndex = currentIndex >= 0 ? currentIndex : 0
    const nextLevel =
      levels[(safeIndex + direction + levels.length) % levels.length] ||
      levels[0]
    await setThinkingLevel(nextLevel)
  }

  const setThinkingBlocksHiddenMutation = useMutation({
    mutationFn: async (hidden: boolean) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson(
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
    },
  })

  const setThinkingBlocksHidden = async (hidden: boolean) => {
    if (!viewerContextId) return
    try {
      await setThinkingBlocksHiddenMutation.mutateAsync(hidden)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update thinking visibility"
      )
    }
  }

  const toggleHideThinking = async () => {
    await setThinkingBlocksHidden(!sessionState.hideThinkingBlock)
  }

  const setToolBlocksHidden = (hidden: boolean) => {
    setHideToolBlocks(hidden)
    safeLocalStorageSetItem(HIDE_TOOL_BLOCKS_STORAGE_KEY, hidden ? "1" : "0")
  }

  const toggleHideToolBlocks = () => {
    setToolBlocksHidden(!hideToolBlocks)
    toast.info(hideToolBlocks ? "Tools shown" : "Tools hidden")
  }

  const compactMutation = useMutation({
    mutationFn: async () => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson(
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
    },
  })

  const runCompact = async () => {
    if (!viewerContextId) return
    setRunningSlashCommand("compact")
    try {
      await compactMutation.mutateAsync()
      toast.success("Started compaction")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to compact session"
      )
    } finally {
      setRunningSlashCommand(null)
    }
  }

  const openTreeDialog = async () => {
    if (!viewerContextId) return
    setTreeOpen(true)
    setTreeQuery("")
    await queryClient.invalidateQueries({
      queryKey: piWebQueryKeys.sessionTree(
        viewerContextId,
        currentSessionQueryScope
      ),
      exact: true,
      refetchType: "active",
    })
  }

  const saveTreeLabelMutation = useMutation({
    mutationFn: async ({
      entryId,
      label,
    }: {
      entryId: string
      label: string
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<SessionTreeData>(
        buildRequestUrl("/api/session/tree/label", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entryId, label }),
        }
      )
    },
    onSuccess: (response) => {
      queryClient.setQueryData(
        piWebQueryKeys.sessionTree(viewerContextId, currentSessionQueryScope),
        response
      )
    },
  })

  const saveTreeLabel = async () => {
    if (!viewerContextId || !selectedTreeNodeId) return
    try {
      await saveTreeLabelMutation.mutateAsync({
        entryId: selectedTreeNodeId,
        label: selectedTreeNodeLabel,
      })
      toast.success("Saved tree label")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save label"
      )
    }
  }

  const navigateTreeNodeMutation = useMutation({
    mutationFn: async ({
      targetId,
      summarize,
      customInstructions,
    }: {
      targetId: string
      summarize?: boolean
      customInstructions?: string
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<NavigateSessionTreeData>(
        buildRequestUrl("/api/session/tree", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            targetId,
            summarize: Boolean(summarize),
            customInstructions,
          }),
        }
      )
    },
  })

  const navigateTreeNode = async (
    targetId: string,
    options?: { summarize?: boolean; customInstructions?: string }
  ) => {
    if (!viewerContextId) return
    try {
      const response = await navigateTreeNodeMutation.mutateAsync({
        targetId,
        summarize: options?.summarize,
        customInstructions: options?.customInstructions,
      })
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
        options?.summarize
          ? "Continued from summarized branch"
          : "Moved session tree cursor"
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to navigate tree"
      )
    }
  }

  const openForkDialog = async () => {
    if (!viewerContextId) return
    setForkOpen(true)
    await queryClient.invalidateQueries({
      queryKey: piWebQueryKeys.forkableMessages(
        viewerContextId,
        currentSessionQueryScope
      ),
      exact: true,
      refetchType: "active",
    })
  }

  const forkFromMessageMutation = useMutation({
    mutationFn: async (entryId: string) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<ForkSessionResponse>(
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
    },
  })

  const forkFromMessage = async (entryId: string) => {
    if (!viewerContextId) return
    try {
      await forkFromMessageMutation.mutateAsync(entryId)
      setForkOpen(false)
      toast.success("Forked session")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to fork session"
      )
    }
  }

  const renameSessionMutation = useMutation({
    mutationFn: async ({ path, name }: { path: string; name: string }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<RenameSessionResponse>(
        buildRequestUrl("/api/session/rename", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path, name }),
        }
      )
    },
  })

  const renameSessionToValue = async (nextName: string, closeDialog = true) => {
    const targetPath = renameTarget?.path || sessionState.sessionFile
    if (!viewerContextId || !targetPath) return false
    try {
      await renameSessionMutation.mutateAsync({
        path: targetPath,
        name: nextName,
      })
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
  }

  const renameSession = async () => {
    return await renameSessionToValue(renameValue)
  }

  const deleteSessionMutation = useMutation({
    mutationFn: async (paths: Array<string>) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      for (const path of paths) {
        await fetchJson<DeleteSessionResponse>(
          buildRequestUrl("/api/session/delete", {
            contextId: viewerContextId,
            sessionId: activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path }),
          }
        )
      }
    },
  })

  const deleteSession = async () => {
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
      await deleteSessionMutation.mutateAsync(
        orderedTargets.flatMap((target) => (target.path ? [target.path] : []))
      )

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
  }

  const runBuiltinSlashCommand = async (name: string, args: string) => {
    const trimmedArgs = args.trim()

    switch (name) {
      case "compact": {
        if (composerImages.length > 0) {
          toast.error("Built-in slash commands do not support images.")
          return
        }
        replaceComposerDraft("")
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
        replaceComposerDraft("")
        await renameSessionToValue(trimmedArgs, false)
        return
      }
      case "delete": {
        if (!sessionState.sessionFile) {
          toast.error("Start the session before deleting it.")
          return
        }
        replaceComposerDraft("")
        openDeleteDialogForCurrentSession()
        return
      }
      case "fork": {
        if (trimmedArgs) {
          toast.error("/fork does not take any arguments.")
          return
        }
        replaceComposerDraft("")
        await openForkDialog()
        return
      }
      case "tree": {
        if (trimmedArgs) {
          toast.error("/tree does not take any arguments.")
          return
        }
        replaceComposerDraft("")
        await openTreeDialog()
        return
      }
      case "hide-thinking": {
        replaceComposerDraft("")
        if (!sessionState.hideThinkingBlock) {
          await toggleHideThinking()
        }
        return
      }
      case "show-thinking": {
        replaceComposerDraft("")
        if (sessionState.hideThinkingBlock) {
          await toggleHideThinking()
        }
        return
      }
      case "hide-tools": {
        replaceComposerDraft("")
        setToolBlocksHidden(true)
        return
      }
      case "show-tools": {
        replaceComposerDraft("")
        setToolBlocksHidden(false)
        return
      }
      default:
        toast.error(`Unsupported slash command: /${name}`)
    }
  }

  const resolveUiRequestMutation = useMutation({
    mutationFn: async ({
      requestId,
      body,
    }: {
      requestId: string
      body: Record<string, unknown>
    }) => {
      if (!viewerContextId) {
        throw new Error("Viewer context unavailable")
      }

      return await fetchJson<UiRequestResponse>(
        buildRequestUrl(`/api/ui/${encodeURIComponent(requestId)}`, {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      )
    },
  })

  const resolveUiRequest = async (body: Record<string, unknown>) => {
    if (!viewerContextId || !pendingUiRequest) return
    try {
      await resolveUiRequestMutation.mutateAsync({
        requestId: pendingUiRequest.id,
        body,
      })
      setPendingUiRequest(null)
      setPendingUiValue("")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to resolve UI request"
      )
    }
  }

  const forkDialogLoading = Boolean(
    forkLoading || forkFromMessageMutation.isPending
  )
  const treeSubmitting = Boolean(
    saveTreeLabelMutation.isPending || navigateTreeNodeMutation.isPending
  )
  const flatTree = treeData ? flattenTree(treeData.tree) : []
  const treeLeafId = treeData?.leafId ?? null
  const treeSummaryAvailable = sessionState.availableModels.length > 0

  const handleThemeChange = (value: ThemeMode) => {
    setTheme(value)
  }

  const slashCommands: Array<SlashCommandDescriptor> = (() => [
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
  ])()

  const workingState = (() => {
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
  })()

  const commandPaletteCommands = (() => {
    const commands: Array<AppCommand> = [
      {
        id: "new-session",
        group: "Sessions",
        title: "New session",
        description: "Create a new draft session",
        shortcut: "Ctrl+N",
        keywords: ["create", "draft", "session"],
        onSelect: createSession,
      },
      {
        id: "search-sessions",
        group: "Sidebar",
        title: "Search sessions",
        description: "Search and jump through sessions in the sidebar",
        shortcut: "Ctrl+S",
        keywords: ["sidebar", "filter", "search", "switch"],
        onSelect: focusSessionSearch,
      },
      {
        id: "set-model",
        group: "Assistant",
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
        group: "Sidebar",
        title: "Add Directory",
        description: "Add a directory accordion to the sidebar",
        shortcut: "Ctrl+D",
        keywords: ["workspace", "sidebar", "directory", "folder"],
        onSelect: openAddDirectoryDialog,
      },
      {
        id: "tree-session",
        group: "Sessions",
        title: "Open tree",
        description: "Jump to an earlier point in the current session tree",
        shortcut: "Ctrl+T",
        keywords: ["tree", "branch", "history", "navigate"],
        onSelect: openTreeDialog,
      },
      {
        id: "fork-session",
        group: "Sessions",
        title: "Fork session",
        description: "Create a new session from a previous user message",
        shortcut: "Ctrl+F",
        keywords: ["fork", "branch", "draft"],
        onSelect: openForkDialog,
      },
      {
        id: "compact-session",
        group: "Sessions",
        title: "Compact",
        description: "Manually compact the session context",
        shortcut: "Ctrl+C",
        keywords: ["compact", "context", "compress", "summarize"],
        onSelect: runCompact,
      },
      {
        id: "toggle-thinking",
        group: "Assistant",
        title: sessionState.hideThinkingBlock
          ? "Show thinking blocks"
          : "Hide thinking blocks",
        description: sessionState.hideThinkingBlock
          ? "Show assistant thinking blocks"
          : "Hide assistant thinking blocks",
        shortcut: "Ctrl+G",
        keywords: ["thinking", "reasoning", "visibility", "show", "hide"],
        onSelect: toggleHideThinking,
      },
      {
        id: "cycle-reasoning",
        group: "Assistant",
        title: "Next reasoning level",
        description: `Current level: ${sessionState.thinkingLevel}`,
        shortcut: "Ctrl+R",
        keywords: ["thinking", "reasoning", "level", "cycle", "next"],
        onSelect: () => {
          void cycleThinkingLevel(1)
        },
      },
      {
        id: "previous-reasoning",
        group: "Assistant",
        title: "Previous reasoning level",
        description: `Current level: ${sessionState.thinkingLevel}`,
        shortcut: "Ctrl+Shift+R",
        keywords: [
          "thinking",
          "reasoning",
          "level",
          "cycle",
          "previous",
          "back",
        ],
        onSelect: () => {
          void cycleThinkingLevel(-1)
        },
      },
      {
        id: "toggle-tools",
        group: "Assistant",
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
        group: "App",
        title: "Open settings",
        description: "Open app settings",
        shortcut: "Ctrl+,",
        keywords: ["settings", "theme", "notifications", "display"],
        onSelect: openSettingsDialog,
      },
    ]

    if (sessionState.sessionFile) {
      commands.splice(1, 0, {
        id: "rename-session",
        group: "Sessions",
        title: "Rename session",
        description: "Rename the current session",
        shortcut: "Ctrl+E",
        keywords: ["rename", "title", "name"],
        onSelect: openRenameDialog,
      })
      commands.push({
        id: "delete-session",
        group: "Sessions",
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
        group: "Sidebar",
        title: "Clear selected sidebar sessions",
        description: `Clear ${selectedSidebarSessions.length} selected sidebar ${selectedSidebarSessions.length === 1 ? "session" : "sessions"}`,
        keywords: ["clear", "selected", "sidebar", "sessions"],
        onSelect: () => {
          setSidebarSelection([])
        },
      })
      commands.push({
        id: "delete-selected-sessions",
        group: "Sidebar",
        title: "Delete selected sidebar sessions",
        description: `Delete ${selectedSidebarSessions.length} selected sidebar ${selectedSidebarSessions.length === 1 ? "session" : "sessions"}`,
        keywords: ["delete", "selected", "sidebar", "sessions"],
        onSelect: () => {
          openDeleteDialog(selectedSidebarSessions)
        },
      })
    }

    return commands
  })()

  const shortcutActionsRef = useLatestRef({
    createSession,
    focusModelSelector,
    focusSessionSearch,
    openAddDirectoryDialog,
    openCommandPalette,
    openDeleteDialog,
    openDeleteDialogForCurrentSession,
    openForkDialog,
    openRenameDialog,
    openSettingsDialog,
    openTreeDialog,
    runCompact,
    toggleHideThinking,
    toggleHideToolBlocks,
    cycleThinkingLevel,
  })

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const modalOpen =
        addDirectoryOpen ||
        renameOpen ||
        deleteOpen ||
        forkOpen ||
        treeOpen ||
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
        if (
          key === "escape" &&
          !event.repeat &&
          !isEditableTarget(event.target)
        ) {
          const now = Date.now()
          if (now - lastEscapePressedAtRef.current <= 600) {
            event.preventDefault()
            lastEscapePressedAtRef.current = 0
            void shortcutActionsRef.current.openTreeDialog()
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
            document.querySelectorAll<HTMLElement>(
              "[data-sidebar-session-item]"
            )
          )
          const focusedSessionButton =
            activeElement instanceof HTMLElement
              ? activeElement.closest<HTMLElement>(
                  "[data-sidebar-session-item]"
                )
              : null

          if (sessionButtons.length > 0) {
            const currentIndex = focusedSessionButton
              ? sessionButtons.findIndex(
                  (button) => button === focusedSessionButton
                )
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
                    : key === "arrowup"
                      ? sessionButtons.length - 1
                      : 0

            event.preventDefault()
            sessionButtons[nextIndex]?.focus()
            return
          }
        }

        if (
          !event.shiftKey &&
          (key === "delete" ||
            (key === "backspace" && selectedSidebarSessions.length > 0))
        ) {
          const targetsToDelete =
            selectedSidebarSessions.length > 0
              ? selectedSidebarSessions
              : focusedSidebarSession?.path
                ? [focusedSidebarSession]
                : []

          if (targetsToDelete.length > 0) {
            event.preventDefault()
            shortcutActionsRef.current.openDeleteDialog(targetsToDelete)
            return
          }
        }
      }

      if (!event.ctrlKey || event.metaKey || event.altKey) return

      if (modalOpen) return

      if (key === "p" && !event.shiftKey) {
        event.preventDefault()
        shortcutActionsRef.current.openCommandPalette()
        return
      }

      if (key === "n" && !event.shiftKey) {
        event.preventDefault()
        void shortcutActionsRef.current.createSession()
        return
      }

      if (key === "s" && !event.shiftKey) {
        event.preventDefault()
        shortcutActionsRef.current.focusSessionSearch()
        return
      }

      if (key === "e" && !event.shiftKey) {
        if (!sessionState.sessionFile) return
        event.preventDefault()
        shortcutActionsRef.current.openRenameDialog()
        return
      }

      if (key === "f" && !event.shiftKey) {
        event.preventDefault()
        void shortcutActionsRef.current.openForkDialog()
        return
      }

      if (key === "d" && !event.shiftKey) {
        event.preventDefault()
        shortcutActionsRef.current.openAddDirectoryDialog()
        return
      }

      if (key === "," && !event.shiftKey) {
        event.preventDefault()
        shortcutActionsRef.current.openSettingsDialog()
        return
      }

      if (key === "m" && !event.shiftKey) {
        if (sessionState.availableModels.length === 0) return
        event.preventDefault()
        shortcutActionsRef.current.focusModelSelector()
        return
      }

      if (key === "t" && !event.shiftKey) {
        event.preventDefault()
        void shortcutActionsRef.current.openTreeDialog()
        return
      }

      if (key === "g" && !event.shiftKey) {
        event.preventDefault()
        void shortcutActionsRef.current.toggleHideThinking()
        return
      }

      if (key === "r") {
        event.preventDefault()
        void shortcutActionsRef.current.cycleThinkingLevel(
          event.shiftKey ? -1 : 1
        )
        return
      }

      if (key === "o" && !event.shiftKey) {
        event.preventDefault()
        shortcutActionsRef.current.toggleHideToolBlocks()
        return
      }

      if (key === "c" && !event.shiftKey) {
        if (hasSelectedText(event.target)) return
        event.preventDefault()
        void shortcutActionsRef.current.runCompact()
        return
      }

      if (key === "x" && !event.shiftKey) {
        if (isEditableTarget(event.target)) return
        if (!sessionState.sessionFile) return
        event.preventDefault()
        shortcutActionsRef.current.openDeleteDialogForCurrentSession()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [
    addDirectoryOpen,
    commandPaletteOpen,
    deleteOpen,
    forkOpen,
    pendingUiRequest,
    renameOpen,
    renderedSidebarSessionKeys,
    selectedSidebarSessions,
    sessionState.availableModels.length,
    sessionState.sessionFile,
    settingsOpen,
    shortcutActionsRef,
    sidebarSessionEntriesByKey,
    treeOpen,
  ])

  const isSessionViewLoading = Boolean(
    sessionId && !sessionState.draft && sessionId !== sessionState.sessionId
  )

  React.useLayoutEffect(() => {
    if (isSessionViewLoading) return

    const nextSessionScrollKey = sessionScrollKey(sessionState)
    if (!nextSessionScrollKey) return
    if (lastLoadedSessionScrollKeyRef.current === nextSessionScrollKey) return

    const viewport =
      messageViewportRef.current ||
      findMessageViewport(messagesScrollAreaRef.current)
    if (!viewport) return

    messageViewportRef.current = viewport
    lastLoadedSessionScrollKeyRef.current = nextSessionScrollKey
    viewport.scrollTop = viewport.scrollHeight
    setIsMessagesNearTop(isViewportNearTop(viewport))
    setIsMessagesNearBottom(isViewportNearBottom(viewport))
    setHasPreviousMessageJumpTarget(
      Boolean(previousMessageJumpTarget(viewport))
    )
    setHasNextMessageJumpTarget(Boolean(nextMessageJumpTarget(viewport)))
  }, [isSessionViewLoading, sessionState])
  const draftGitSummary =
    sessionState.draft &&
    sessionState.items.length === 0 &&
    gitStatus &&
    !isApiErrorResponse(gitStatus)
      ? gitStatus.gitStatus
      : null

  const scrollConversationToTop = () => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    viewport.scrollTo({ top: 0, behavior: "smooth" })
  }

  const scrollConversationToBottom = () => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" })
  }

  const jumpToPreviousMessage = () => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    const target = previousMessageJumpTarget(viewport)
    if (!target) return
    viewport.scrollTo({
      top: Math.max(0, target.offsetTop - 8),
      behavior: "smooth",
    })
  }

  const jumpToNextMessage = () => {
    const viewport = messageViewportRef.current
    if (!viewport) return
    const target = nextMessageJumpTarget(viewport)
    if (!target) return
    viewport.scrollTo({
      top: Math.max(0, target.offsetTop - 8),
      behavior: "smooth",
    })
  }

  return (
    <SidebarProvider className="h-full overflow-hidden bg-background">
      <AppSidebar
        connected={sessionState.connected}
        sessionSearch={sessionSearch}
        onSessionSearchChange={setSessionSearch}
        sessionSearchInputRef={sessionSearchInputRef}
        visibleDirectories={visibleDirectories}
        directoryCount={baseSidebarDirectories.length}
        directoryStateByPath={directoryStateByPath}
        filteredDirectorySessions={filteredDirectorySessions}
        collapsedDirectories={collapsedDirectories}
        directoryIndexLoading={directoryIndexLoading}
        directoryRenderCounts={directoryRenderCounts}
        selectedSessionKeys={selectedSidebarSessionKeys}
        activeSessionId={activeSessionId}
        emptyStateText={emptySidebarStateText}
        allDirectoriesCollapsed={allDirectoriesCollapsed}
        onCreateSession={createSession}
        onOpenAddDirectoryDialog={openAddDirectoryDialog}
        onOpenCommandPalette={openCommandPalette}
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
        onRemoveAllDirectories={() => {
          setSidebarDirectories((current) => {
            if (current.length === 0) {
              return current
            }
            safeLocalStorageSetItem(
              SIDEBAR_DIRECTORIES_STORAGE_KEY,
              JSON.stringify([])
            )
            return []
          })
          setCollapsedDirectories((current) => {
            let changed = false
            const next = { ...current }

            for (const directory of baseSidebarDirectories) {
              if (!Object.prototype.hasOwnProperty.call(next, directory)) {
                continue
              }
              delete next[directory]
              changed = true
            }

            if (!changed) {
              return current
            }

            safeLocalStorageSetItem(
              COLLAPSED_DIRECTORIES_STORAGE_KEY,
              JSON.stringify(next)
            )
            return next
          })
        }}
        onReorderDirectories={reorderSidebarDirectories}
        onLoadMoreDirectorySessions={loadMoreDirectorySessions}
      />

      <SidebarInset className="min-h-0 overflow-hidden">
        <div className="shrink-0 border-b border-border/70 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <SidebarTrigger className="mt-0.5 shrink-0" />
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h2 className="text-[15px] leading-tight font-semibold">
                    {currentSessionTitle}
                  </h2>
                  {sessionState.draft && <Badge variant="outline">Draft</Badge>}
                  {sessionState.streaming && (
                    <Badge variant="outline">Streaming</Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {sessionState.cwd && (
                    <span>{formatDisplayPath(sessionState.cwd)}</span>
                  )}
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
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label="Session menu"
                      title="Session menu"
                    />
                  }
                >
                  <EllipsisIcon />
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
                              <span className="truncate">
                                {formatDisplayPath(option.path)}
                              </span>
                            </div>
                            {option.path === defaultNewSessionDirectory ? (
                              <DropdownMenuShortcut>
                                Default
                              </DropdownMenuShortcut>
                            ) : null}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={runCompact}>
                    <span>Compact session</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={openTreeDialog}>
                    <span>Tree</span>
                    <DropdownMenuShortcut>Ctrl+T</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={openForkDialog}>
                    <span>Fork</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
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
                    <DropdownMenuShortcut>Ctrl+G</DropdownMenuShortcut>
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
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="Create a new session"
                title={
                  defaultNewSessionDirectory
                    ? `Create a new session in ${defaultNewSessionDirectory}`
                    : "Create a new session"
                }
                onClick={() => {
                  void createSession()
                }}
              >
                <SquarePenIcon />
              </Button>
            </div>
          </div>
        </div>

        <Tabs
          value={currentTab}
          onValueChange={setCurrentTab}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <TabsList className="w-full rounded-none">
            <TabsTrigger value="session">Session</TabsTrigger>
            <TabsTrigger value="git">Git</TabsTrigger>
          </TabsList>

          <TabsContent value="session" className="flex min-h-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1">
              <div
                ref={messagesScrollAreaRef}
                className="h-full overflow-auto px-4"
              >
                {isSessionViewLoading ? (
                  <div className="flex min-h-full flex-col items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
                    <Spinner />
                    <div>Loading...</div>
                  </div>
                ) : sessionState.items.length > 0 ? (
                  <>
                    <div className="flex flex-col gap-4">
                      {(() => {
                        const counts = new Map<string, number>()
                        return mergeAssistantTurns(sessionState.items).map(
                          (item) => {
                            const baseKey = conversationItemSignature(item)
                            const count = (counts.get(baseKey) ?? 0) + 1
                            counts.set(baseKey, count)
                            const key = `${baseKey}:${count}`

                            if (item.kind === "user") {
                              return (
                                <div
                                  key={key}
                                  data-message-anchor="true"
                                  className="flex justify-end"
                                >
                                  <UserMessageCard item={item} />
                                </div>
                              )
                            }

                            if (
                              !assistantMessageHasVisibleBlocks({
                                item,
                                hideThinking: sessionState.hideThinkingBlock,
                                hideToolBlocks,
                              })
                            ) {
                              return null
                            }

                            return (
                              <div
                                key={key}
                                data-message-anchor="true"
                                className="flex justify-start"
                              >
                                <AssistantMessageCard
                                  item={item}
                                  hideThinking={sessionState.hideThinkingBlock}
                                  hideToolBlocks={hideToolBlocks}
                                />
                              </div>
                            )
                          }
                        )
                      })()}
                      {workingState ? (
                        <div className="flex justify-start">
                          <MessagesWorkingIndicator state={workingState} />
                        </div>
                      ) : null}
                    </div>
                    <div ref={bottomRef} />
                  </>
                ) : (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>
                        {sessionState.draft
                          ? "New session"
                          : "Start a new conversation"}
                      </EmptyTitle>
                      <EmptyDescription>
                        {sessionState.draft
                          ? undefined
                          : "This is the native Pi session view backed by the new TypeScript runtime."}
                      </EmptyDescription>
                    </EmptyHeader>
                    {sessionState.draft ? (
                      <EmptyContent className="flex flex-col items-center gap-3">
                        {sessionState.cwd ? (
                          <Badge variant="outline">
                            {formatDisplayPath(sessionState.cwd)}
                          </Badge>
                        ) : null}
                        {draftGitSummary?.label ? (
                          <Badge variant="outline">
                            {draftGitSummary.label}
                          </Badge>
                        ) : null}
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
              </div>

              {!isSessionViewLoading ? (
                <div className="absolute right-4 bottom-4 z-10 flex justify-end md:right-[18px] md:bottom-[18px]">
                  <div className="flex items-center gap-4">
                    <Button
                      variant="secondary"
                      size="icon-lg"
                      disabled={
                        sessionState.draft ||
                        sessionState.items.length === 0 ||
                        isMessagesNearBottom
                      }
                      className="rounded-full border-0 shadow-[0_10px_24px_rgba(0,0,0,0.28)] disabled:pointer-events-none disabled:opacity-0"
                      title="Jump to latest message"
                      aria-label="Jump to latest message"
                      onClick={scrollConversationToBottom}
                    >
                      <ArrowDownIcon className="size-4" />
                    </Button>

                    <Button
                      variant="secondary"
                      size="icon-lg"
                      disabled={
                        !hasNextMessageJumpTarget || isMessagesNearBottom
                      }
                      className="rounded-full border-0 shadow-[0_10px_24px_rgba(0,0,0,0.28)] disabled:pointer-events-none disabled:opacity-0"
                      title="Jump to next message"
                      aria-label="Jump to next message"
                      onClick={jumpToNextMessage}
                    >
                      <ArrowDownToLineIcon className="size-4" />
                    </Button>

                    <Button
                      variant="secondary"
                      size="icon-lg"
                      disabled={!hasPreviousMessageJumpTarget}
                      className="rounded-full border-0 shadow-[0_10px_24px_rgba(0,0,0,0.28)] disabled:pointer-events-none disabled:opacity-0"
                      title="Jump to previous message"
                      aria-label="Jump to previous message"
                      onClick={jumpToPreviousMessage}
                    >
                      <ArrowUpToLineIcon className="size-4" />
                    </Button>

                    <Button
                      variant="secondary"
                      size="icon-lg"
                      disabled={isMessagesNearTop}
                      className="rounded-full border-0 shadow-[0_10px_24px_rgba(0,0,0,0.28)] disabled:pointer-events-none disabled:opacity-0"
                      title="Go to top"
                      aria-label="Go to top"
                      onClick={scrollConversationToTop}
                    >
                      <ArrowUpIcon className="size-4" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            <ComposerPanel
              ref={composerPanelRef}
              currentPendingMessages={currentPendingMessages}
              composerImages={composerImages}
              composerText={composerDraftSeed.text}
              composerSkill={composerDraftSeed.skillName}
              availableModels={sessionState.availableModels}
              model={sessionState.model}
              thinkingLevel={sessionState.thinkingLevel}
              availableThinkingLevels={sessionState.availableThinkingLevels}
              isSubmitting={isSubmitting}
              isStreaming={sessionState.streaming}
              awaitingFirstTurn={awaitingFirstTurn}
              workingState={workingState}
              fileInputRef={fileInputRef}
              slashCommands={slashCommands}
              onComposerTextChange={syncComposerDraft}
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
                return isApiErrorResponse(response) ? [] : response.items
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
                return isApiErrorResponse(response) ? [] : response.items
              }}
            />
          </TabsContent>

          <TabsContent
            value="git"
            className="min-h-0 flex-1 space-y-4 overflow-auto px-6 pb-6"
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
        forkLoading={forkDialogLoading}
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
