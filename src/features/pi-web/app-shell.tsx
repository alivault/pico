import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpToLineIcon,
  EllipsisIcon,
  SquarePenIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { toast } from "sonner"

import type { DesktopNotificationPermission } from "@/features/pi-web/session-done-notifications"
import type {
  ConversationItem,
  DirectoryState,
  PromptImage,
  SessionState,
  StreamingBehavior,
  ThemeMode,
} from "@/lib/pi-web"
import type {
  DirectorySessionsIndexSnapshot,
  DirectorySessionsIndexesResponse,
  ExtensionUiEvent,
  FileCompletionsResponse,
  PathCompletionsResponse,
  SessionDoneEvent,
  SessionListEntry,
  SessionStatusEvent,
  SessionsEvent,
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
  useSidebar,
} from "@/components/ui/sidebar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AppShellCommandPaletteController,
  type AppShellCommandPaletteHandle,
} from "@/features/pi-web/app-shell-command-palette"
import {
  AppShellSettingsDialogController,
  type AppShellSettingsDialogHandle,
} from "@/features/pi-web/app-shell-settings-dialog"
import {
  AppShellAddDirectoryDialogController,
  type AppShellAddDirectoryDialogHandle,
} from "@/features/pi-web/app-shell-add-directory-dialog"
import {
  AppShellTreeDialogController,
  type AppShellTreeDialogHandle,
} from "@/features/pi-web/app-shell-tree-dialog"
import {
  AppShellUiRequestDialogController,
  type AppShellUiRequestDialogHandle,
} from "@/features/pi-web/app-shell-ui-request-dialog"
import {
  DeleteSessionsDialogController,
  ForkSessionDialogController,
  RenameSessionDialogController,
  type DeleteSessionsDialogHandle,
  type ForkSessionDialogHandle,
  type RenameSessionDialogHandle,
} from "@/features/pi-web/app-shell-session-dialogs"
import {
  buildRequestUrl,
  fetchJson,
  readFileAsPromptImage,
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
  AssistantMessagesCard,
  MessagesWorkingIndicator,
  UserMessageCard,
  assistantMessageHasVisibleBlocks,
} from "@/features/pi-web/conversation-view"
import {
  parseComposerSkillMessage,
  serializeComposerDraft,
} from "@/features/pi-web/composer-utils"
import {
  DraftGitStatusBadge,
  GitPanel,
  GitTabStatusText,
  HeaderGitStatusText,
} from "@/features/pi-web/git-panel"
import { piWebSessionScopeKey } from "@/features/pi-web/query-keys"
import { AppSidebar } from "@/features/pi-web/sidebar"
import {
  useAppShellMessageScroll,
  useMessageScrollValue,
} from "@/features/pi-web/use-app-shell-message-scroll"
import type { MessageScrollStateStore } from "@/features/pi-web/use-app-shell-message-scroll"
import { useAppShellPromptMutations } from "@/features/pi-web/use-app-shell-prompt-mutations"
import { useAppShellSessionMutations } from "@/features/pi-web/use-app-shell-session-mutations"
import { useAppShellSessionSync } from "@/features/pi-web/use-app-shell-session-sync"
import {
  useAppShellShortcuts,
  type AppShellShortcutState,
} from "@/features/pi-web/use-app-shell-shortcuts"
import {
  DRAFT_DIRECTORY_STORAGE_KEY,
  HIDE_TOOL_BLOCKS_STORAGE_KEY,
  CENTER_MESSAGES_STORAGE_KEY,
  RECENT_DIRECTORIES_LIMIT,
  RECENT_DIRECTORIES_STORAGE_KEY,
  SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY,
  SESSION_DONE_SOUND_ENABLED_STORAGE_KEY,
  SIDEBAR_DIRECTORIES_STORAGE_KEY,
  VIEWER_CONTEXT_STORAGE_KEY,
  createContextId,
  createInitialSessionState,
  getSessionTitle,
  normalizeSessionSelectionKeys,
  normalizeStoredDirectoryList,
  normalizeThemeMode,
  readStoredDraftDirectory,
  readStoredHideToolBlocks,
  readStoredCenterMessages,
  readStoredRecentDirectories,
  readStoredSessionDoneDesktopNotificationsEnabled,
  readStoredSessionDoneSoundEnabled,
  readStoredSidebarDirectories,
  rememberStoredPromptDraft,
  promptDraftKey,
  safeLocalStorageSetItem,
  sessionListEntryKey,
} from "@/lib/pi-web"
import { isApiErrorResponse } from "@/lib/pi-web-api"

const TITLE_STREAMING_FRAMES = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"]
const TITLE_STREAMING_INTERVAL_MS = 500
const INITIAL_SIDEBAR_BOOTSTRAP_DIRECTORY_COUNT = 6

function sessionNotificationKey(sessionLike: {
  sessionFile?: string
  sessionPath?: string
  path?: string
  sessionId?: string
  id?: string
}) {
  const sessionFile = (
    sessionLike.sessionFile ||
    sessionLike.sessionPath ||
    sessionLike.path ||
    ""
  ).trim()
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

function doneEventLabel(event: SessionDoneEvent) {
  const title = event.title?.trim() || "New session"
  if (event.reason === "manual_compaction") {
    return title !== "New session"
      ? `Compaction complete: ${title}`
      : "Compaction complete"
  }

  if (event.outcome === "error") {
    return title !== "New session"
      ? `Session stopped: ${title}`
      : "Session stopped"
  }

  return finishedSessionLabel(title)
}

type DirectorySessionsIndexData = DirectorySessionsIndexSnapshot
type DirectorySessionsIndexesData = Extract<
  DirectorySessionsIndexesResponse,
  { ok: true }
>

type AppShellSidebarSnapshot = {
  baseSidebarDirectories: Array<string>
  directoryStateByPath: Map<string, DirectoryState>
  directoryIndexes: Record<string, Array<SessionListEntry>>
  sidebarSessions: Array<SessionListEntry>
  selectedSidebarSessions: Array<SessionListEntry>
  sidebarSessionEntriesByKey: Map<string, SessionListEntry>
}

type AppShellSidebarState = {
  connected: boolean
  sessionsEvent: SessionsEvent | null
  sidebarDirectories: Array<string>
  initialSidebarBootstrapDirectories: Array<string>
  directoryIndexDataByPath: Record<string, DirectorySessionsIndexData>
  directoryIndexLoading: Record<string, boolean>
  sidebarSessionStatusByKey: SidebarSessionStatusMap
  sidebarDeferredDirectoryLoadingReady: boolean
  sessionSearch: string
  selectedSidebarSessionKeys: Array<string>
  sidebarSessionSelectionAnchor: string
}

type AppShellSidebarDerived = AppShellSidebarSnapshot & {
  sidebarDirectoryIndexes: Record<string, Array<SessionListEntry>>
  visibleDirectories: Array<string>
  filteredDirectorySessions: Record<string, Array<SessionListEntry>>
  emptySidebarStateText: string
  workspaceVersion: string
}

type AppShellSidebarStoreSnapshot = {
  state: AppShellSidebarState
  derived: AppShellSidebarDerived
  revision: number
}

type AppShellSidebarStateUpdate =
  | Partial<AppShellSidebarState>
  | ((
      current: AppShellSidebarState
    ) => Partial<AppShellSidebarState> | AppShellSidebarState)

type AppShellSidebarStore = {
  getSnapshot: () => AppShellSidebarStoreSnapshot
  getWorkspaceSnapshot: () => AppShellSidebarSnapshot
  getWorkspaceVersion: () => string
  subscribe: (listener: () => void) => () => void
  setState: (update: AppShellSidebarStateUpdate) => void
  setConnected: React.Dispatch<React.SetStateAction<boolean>>
  setSessionsEvent: React.Dispatch<React.SetStateAction<SessionsEvent | null>>
  setSidebarDirectories: React.Dispatch<React.SetStateAction<Array<string>>>
  setDirectoryIndexDataByPath: React.Dispatch<
    React.SetStateAction<Record<string, DirectorySessionsIndexData>>
  >
  setDirectoryIndexLoading: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >
  setSidebarSessionStatusByKey: React.Dispatch<
    React.SetStateAction<SidebarSessionStatusMap>
  >
  setSidebarDeferredDirectoryLoadingReady: React.Dispatch<
    React.SetStateAction<boolean>
  >
  setSessionSearch: React.Dispatch<React.SetStateAction<string>>
  setSelectedSidebarSessionKeys: React.Dispatch<
    React.SetStateAction<Array<string>>
  >
  setSidebarSessionSelectionAnchor: React.Dispatch<React.SetStateAction<string>>
}
function sessionScrollKey(sessionState: {
  draft: boolean
  sessionFile?: string
  sessionId?: string
  cwd?: string
}) {
  return piWebSessionScopeKey(sessionState)
}

function createOptimisticDraftSessionState(options: {
  previous: SessionState
  cwd?: string
  ownerKey: string
}): SessionState {
  const nextCwd = options.cwd?.trim() || options.previous.cwd?.trim() || ""
  const base = createInitialSessionState()

  return {
    ...base,
    connected: options.previous.connected,
    draft: true,
    sessionKey: `optimistic:${options.ownerKey}`,
    cwd: nextCwd || undefined,
    model: options.previous.model,
    thinkingLevel: options.previous.thinkingLevel,
    availableThinkingLevels: options.previous.availableThinkingLevels,
    availableModels: options.previous.availableModels,
    availableSkills: options.previous.availableSkills,
    hideThinkingBlock: options.previous.hideThinkingBlock,
  }
}

async function fetchDirectorySessionsIndexes(options: {
  viewerContextId: string
  directories: Array<string>
}) {
  const directories = normalizeStoredDirectoryList(options.directories)
  if (directories.length === 0) {
    return {
      ok: true,
      directories: [],
      directoryIndexes: {},
    } satisfies DirectorySessionsIndexesData
  }

  return await fetchJson<DirectorySessionsIndexesData>(
    buildRequestUrl("/api/directory-sessions-indexes", {
      contextId: options.viewerContextId,
      searchParams: {
        directory: directories,
      },
    })
  )
}

function mergeDirectoryIndexData(
  current: Record<string, DirectorySessionsIndexData>,
  next: Record<string, DirectorySessionsIndexData>
) {
  let changed = false
  const merged = { ...current }

  for (const [directory, payload] of Object.entries(next)) {
    if (JSON.stringify(current[directory]) === JSON.stringify(payload)) {
      continue
    }

    merged[directory] = payload
    changed = true
  }

  return changed ? merged : current
}

function updateDirectoryIndexLoadingState(
  current: Record<string, boolean>,
  directories: Array<string>,
  loading: boolean
) {
  let changed = false
  const next = { ...current }

  for (const directory of directories) {
    if (Boolean(current[directory]) === loading) continue
    next[directory] = loading
    changed = true
  }

  return changed ? next : current
}

function sameStringArray(left: Array<string>, right: Array<string>) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }

  return true
}

function sameReferenceArray<T>(left: Array<T>, right: Array<T>) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }

  return true
}

function sameMapEntries<K, V>(left: Map<K, V>, right: Map<K, V>) {
  if (left.size !== right.size) return false

  for (const [key, value] of left) {
    if (right.get(key) !== value) return false
  }

  return true
}

function sameSessionEntryRecord(
  left: Record<string, Array<SessionListEntry>>,
  right: Record<string, Array<SessionListEntry>>
) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (!sameStringArray(leftKeys.sort(), rightKeys.sort())) return false

  for (const key of leftKeys) {
    if (!sameReferenceArray(left[key] || [], right[key] || [])) return false
  }

  return true
}

function getRenderedSidebarSessionKeys() {
  if (typeof document === "undefined") return []

  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-sidebar-session-item]")
  )
    .map((element) => element.dataset.sessionKey?.trim() || "")
    .filter((key) => key.length > 0)
}

function clearUnreadForActiveSidebarSession(
  current: Record<string, DirectorySessionsIndexData>,
  activeSession: {
    sessionId?: string
    sessionPath?: string
  }
) {
  const activeSessionId = activeSession.sessionId?.trim() || ""
  const activeSessionPath = activeSession.sessionPath?.trim() || ""
  if (!activeSessionId && !activeSessionPath) {
    return current
  }

  let changed = false
  const next: Record<string, DirectorySessionsIndexData> = { ...current }

  for (const [directory, snapshot] of Object.entries(current)) {
    let sessionsChanged = false
    const sessions = snapshot.sessions.map((entry) => {
      const matchesActiveSession =
        (activeSessionId && entry.id === activeSessionId) ||
        (activeSessionPath && entry.path === activeSessionPath)
      if (!matchesActiveSession || !entry.unread) {
        return entry
      }

      sessionsChanged = true
      changed = true
      return {
        ...entry,
        unread: false,
      }
    })

    if (sessionsChanged) {
      next[directory] = {
        ...snapshot,
        sessions,
      }
    }
  }

  return changed ? next : current
}

type SidebarSessionStatus = Omit<SessionStatusEvent, "type">
type SidebarSessionStatusMap = Record<string, SidebarSessionStatus>

function sidebarSessionStatusKeys(status: SidebarSessionStatus) {
  const keys: Array<string> = []
  const sessionPath = status.sessionPath?.trim() || ""
  const sessionId = status.sessionId?.trim() || ""
  const sessionKey = status.sessionKey?.trim() || ""

  if (sessionPath) keys.push(`path:${sessionPath}`)
  if (sessionId) keys.push(`id:${sessionId}`)
  if (sessionKey) keys.push(`key:${sessionKey}`)

  return keys
}

function sameSidebarSessionStatus(
  left: SidebarSessionStatus | undefined,
  right: SidebarSessionStatus
) {
  return (
    left?.sessionKey === right.sessionKey &&
    left?.sessionId === right.sessionId &&
    left?.sessionPath === right.sessionPath &&
    left?.streaming === right.streaming &&
    left?.unread === right.unread
  )
}

function mergeSidebarSessionStatusMap(
  current: SidebarSessionStatusMap,
  event: SessionStatusEvent
) {
  const keys = sidebarSessionStatusKeys(event)
  if (keys.length === 0) return current

  let changed = false
  const next: SidebarSessionStatusMap = { ...current }

  for (const key of keys) {
    const previous = current[key]
    const status: SidebarSessionStatus = {
      sessionKey: event.sessionKey ?? previous?.sessionKey,
      sessionId: event.sessionId ?? previous?.sessionId,
      sessionPath: event.sessionPath ?? previous?.sessionPath,
      streaming:
        typeof event.streaming === "boolean"
          ? event.streaming
          : previous?.streaming,
      unread:
        typeof event.unread === "boolean" ? event.unread : previous?.unread,
    }

    if (sameSidebarSessionStatus(previous, status)) continue
    next[key] = status
    changed = true
  }

  return changed ? next : current
}

function sidebarStatusForEntry(
  entry: SessionListEntry,
  statuses: SidebarSessionStatusMap
) {
  const pathKey = entry.path ? `path:${entry.path}` : ""
  const idKey = entry.id ? `id:${entry.id}` : ""
  return (
    (pathKey ? statuses[pathKey] : undefined) ||
    (idKey ? statuses[idKey] : undefined)
  )
}

function applySidebarSessionStatus(
  entry: SessionListEntry,
  status: SidebarSessionStatus | undefined
) {
  if (!status) return entry

  const nextStreaming =
    typeof status.streaming === "boolean" ? status.streaming : entry.streaming
  const nextUnread =
    typeof status.unread === "boolean" ? status.unread : entry.unread

  if (
    Boolean(entry.streaming) === Boolean(nextStreaming) &&
    Boolean(entry.unread) === Boolean(nextUnread)
  ) {
    return entry
  }

  return {
    ...entry,
    streaming: nextStreaming,
    unread: nextUnread,
  }
}

function applySidebarSessionStatusOverlay(
  indexes: Record<string, Array<SessionListEntry>>,
  statuses: SidebarSessionStatusMap
) {
  if (Object.keys(statuses).length === 0) return indexes

  let changed = false
  const nextIndexes: Record<string, Array<SessionListEntry>> = {}

  for (const [directory, sessions] of Object.entries(indexes)) {
    let sessionsChanged = false
    const nextSessions = sessions.map((entry) => {
      const nextEntry = applySidebarSessionStatus(
        entry,
        sidebarStatusForEntry(entry, statuses)
      )
      if (nextEntry !== entry) {
        sessionsChanged = true
        changed = true
      }
      return nextEntry
    })

    nextIndexes[directory] = sessionsChanged ? nextSessions : sessions
  }

  return changed ? nextIndexes : indexes
}

function createInitialSidebarState(): AppShellSidebarState {
  return {
    connected: false,
    sessionsEvent: null,
    sidebarDirectories: [],
    initialSidebarBootstrapDirectories: [],
    directoryIndexDataByPath: {},
    directoryIndexLoading: {},
    sidebarSessionStatusByKey: {},
    sidebarDeferredDirectoryLoadingReady: false,
    sessionSearch: "",
    selectedSidebarSessionKeys: [],
    sidebarSessionSelectionAnchor: "",
  }
}

function computeAppShellSidebarDerived(
  state: AppShellSidebarState
): AppShellSidebarDerived {
  const directoryStates = state.sessionsEvent?.directoryStates || []
  const directoryStateByPath = new Map(
    directoryStates.map((directoryState) => [
      directoryState.path,
      directoryState,
    ])
  )
  const baseSidebarDirectories = normalizeStoredDirectoryList(
    state.sidebarDirectories
  )
  const directoryIndexes: Record<string, Array<SessionListEntry>> = {}

  for (const directory of baseSidebarDirectories) {
    directoryIndexes[directory] =
      state.directoryIndexDataByPath[directory]?.sessions || []
  }

  const sidebarDirectoryIndexes = applySidebarSessionStatusOverlay(
    directoryIndexes,
    state.sidebarSessionStatusByKey
  )
  const query = state.sessionSearch.trim().toLowerCase()
  const sidebarSearchPending = query
    ? baseSidebarDirectories.some((directory) => {
        const totalCount = directoryStateByPath.get(directory)?.totalCount ?? 0
        const loadedCount = Object.prototype.hasOwnProperty.call(
          directoryIndexes,
          directory
        )
          ? directoryIndexes[directory].length
          : 0
        const loading = Boolean(state.directoryIndexLoading[directory])
        return loading || (!loadedCount && totalCount > 0)
      })
    : false
  const visibleDirectories: Array<string> = []
  const filteredDirectorySessions: Record<string, Array<SessionListEntry>> = {}

  for (const directory of baseSidebarDirectories) {
    const sessions = Object.prototype.hasOwnProperty.call(
      sidebarDirectoryIndexes,
      directory
    )
      ? sidebarDirectoryIndexes[directory]
      : []

    if (!query) {
      visibleDirectories.push(directory)
      filteredDirectorySessions[directory] = sessions
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
      visibleDirectories.push(directory)
      filteredDirectorySessions[directory] = filteredSessions
    }
  }

  const sidebarSessionEntriesByKey = new Map<string, SessionListEntry>()
  for (const directory of baseSidebarDirectories) {
    const entries = Object.prototype.hasOwnProperty.call(
      sidebarDirectoryIndexes,
      directory
    )
      ? sidebarDirectoryIndexes[directory]
      : []

    for (const entry of entries) {
      const key = sessionListEntryKey(entry)
      if (!key || sidebarSessionEntriesByKey.has(key)) continue
      sidebarSessionEntriesByKey.set(key, entry)
    }
  }

  const sidebarSessions = Array.from(sidebarSessionEntriesByKey.values())
  const selectedSidebarSessions = state.selectedSidebarSessionKeys
    .map((key) => sidebarSessionEntriesByKey.get(key))
    .filter((entry): entry is SessionListEntry =>
      Boolean(entry?.path || entry?.id)
    )
  const sidebarUnreadVersion = sidebarSessions
    .filter((session) => session.unread)
    .map((session) => sessionNotificationKey(session))
    .filter(Boolean)
    .sort()
    .join("\n")
  const workspaceVersion = [
    baseSidebarDirectories.join("\n"),
    state.selectedSidebarSessionKeys.join("\n"),
    sidebarUnreadVersion,
  ].join("\0")

  return {
    baseSidebarDirectories,
    directoryStateByPath,
    directoryIndexes: sidebarDirectoryIndexes,
    sidebarDirectoryIndexes,
    sidebarSessions,
    selectedSidebarSessions,
    sidebarSessionEntriesByKey,
    visibleDirectories,
    filteredDirectorySessions,
    emptySidebarStateText: query
      ? sidebarSearchPending
        ? "Searching sessions…"
        : "No sessions or directories match your search."
      : baseSidebarDirectories.length > 0
        ? "No directories match this view."
        : "No directories added yet.",
    workspaceVersion,
  }
}

function applySidebarStateAction<T>(
  current: T,
  action: React.SetStateAction<T>
) {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action
}

function createAppShellSidebarStore(): AppShellSidebarStore {
  let state = createInitialSidebarState()
  let snapshot: AppShellSidebarStoreSnapshot = {
    state,
    derived: computeAppShellSidebarDerived(state),
    revision: 0,
  }
  const listeners = new Set<() => void>()

  const publish = (nextState: AppShellSidebarState) => {
    if (nextState === state) return

    state = nextState
    snapshot = {
      state,
      derived: computeAppShellSidebarDerived(state),
      revision: snapshot.revision + 1,
    }
    for (const listener of listeners) {
      listener()
    }
  }

  const setState = (update: AppShellSidebarStateUpdate) => {
    const partial = typeof update === "function" ? update(state) : update
    if (partial === state) return

    const entries = Object.entries(partial) as Array<
      [
        keyof AppShellSidebarState,
        AppShellSidebarState[keyof AppShellSidebarState],
      ]
    >
    if (entries.every(([key, value]) => Object.is(state[key], value))) {
      return
    }

    publish({
      ...state,
      ...partial,
    })
  }

  return {
    getSnapshot: () => snapshot,
    getWorkspaceSnapshot: () => snapshot.derived,
    getWorkspaceVersion: () => snapshot.derived.workspaceVersion,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setState,
    setConnected: (action) => {
      const connected = applySidebarStateAction(state.connected, action)
      if (connected === state.connected) return
      setState({ connected })
    },
    setSessionsEvent: (action) => {
      const sessionsEvent = applySidebarStateAction(state.sessionsEvent, action)
      if (sessionsEvent === state.sessionsEvent) return
      setState({ sessionsEvent })
    },
    setSidebarDirectories: (action) => {
      const sidebarDirectories = applySidebarStateAction(
        state.sidebarDirectories,
        action
      )
      if (sidebarDirectories === state.sidebarDirectories) return
      setState({ sidebarDirectories })
    },
    setDirectoryIndexDataByPath: (action) => {
      const directoryIndexDataByPath = applySidebarStateAction(
        state.directoryIndexDataByPath,
        action
      )
      if (directoryIndexDataByPath === state.directoryIndexDataByPath) return
      setState({ directoryIndexDataByPath })
    },
    setDirectoryIndexLoading: (action) => {
      const directoryIndexLoading = applySidebarStateAction(
        state.directoryIndexLoading,
        action
      )
      if (directoryIndexLoading === state.directoryIndexLoading) return
      setState({ directoryIndexLoading })
    },
    setSidebarSessionStatusByKey: (action) => {
      const sidebarSessionStatusByKey = applySidebarStateAction(
        state.sidebarSessionStatusByKey,
        action
      )
      if (sidebarSessionStatusByKey === state.sidebarSessionStatusByKey) return
      setState({ sidebarSessionStatusByKey })
    },
    setSidebarDeferredDirectoryLoadingReady: (action) => {
      const sidebarDeferredDirectoryLoadingReady = applySidebarStateAction(
        state.sidebarDeferredDirectoryLoadingReady,
        action
      )
      if (
        sidebarDeferredDirectoryLoadingReady ===
        state.sidebarDeferredDirectoryLoadingReady
      ) {
        return
      }
      setState({ sidebarDeferredDirectoryLoadingReady })
    },
    setSessionSearch: (action) => {
      const sessionSearch = applySidebarStateAction(state.sessionSearch, action)
      if (sessionSearch === state.sessionSearch) return
      setState({ sessionSearch })
    },
    setSelectedSidebarSessionKeys: (action) => {
      const selectedSidebarSessionKeys = applySidebarStateAction(
        state.selectedSidebarSessionKeys,
        action
      )
      if (selectedSidebarSessionKeys === state.selectedSidebarSessionKeys) {
        return
      }
      setState({ selectedSidebarSessionKeys })
    },
    setSidebarSessionSelectionAnchor: (action) => {
      const sidebarSessionSelectionAnchor = applySidebarStateAction(
        state.sidebarSessionSelectionAnchor,
        action
      )
      if (
        sidebarSessionSelectionAnchor === state.sidebarSessionSelectionAnchor
      ) {
        return
      }
      setState({ sidebarSessionSelectionAnchor })
    },
  }
}

function useAppShellSidebarValue<T>(
  store: AppShellSidebarStore,
  selector: (snapshot: AppShellSidebarStoreSnapshot) => T,
  isEqual: (left: T, right: T) => boolean = Object.is
) {
  const cacheRef = React.useRef<{
    source: AppShellSidebarStoreSnapshot | undefined
    selected: T | undefined
  }>({
    source: undefined,
    selected: undefined,
  })

  const getSnapshot = () => {
    const source = store.getSnapshot()
    const cache = cacheRef.current
    if (cache.source === source && cache.selected !== undefined) {
      return cache.selected
    }

    const selected = selector(source)
    if (cache.selected !== undefined && isEqual(cache.selected, selected)) {
      cacheRef.current = { source, selected: cache.selected }
      return cache.selected
    }

    cacheRef.current = { source, selected }
    return selected
  }

  return React.useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

function useAppShellSidebarWorkspaceVersion(store: AppShellSidebarStore) {
  return React.useSyncExternalStore(
    store.subscribe,
    store.getWorkspaceVersion,
    store.getWorkspaceVersion
  )
}

function useLatestRef<T>(value: T) {
  const ref = React.useRef(value)
  ref.current = value
  return ref
}

function useStableEvent<Args extends Array<unknown>, Result>(
  handler: (...args: Args) => Result
) {
  const handlerRef = useLatestRef(handler)

  return React.useCallback(
    (...args: Args) => handlerRef.current(...args),
    [handlerRef]
  )
}

type ValueStore<T> = {
  getSnapshot: () => T
  setSnapshot: (nextSnapshot: T) => void
  subscribe: (listener: () => void) => () => void
}

function createValueStore<T>(
  initialSnapshot: T,
  isEqual: (left: T, right: T) => boolean = Object.is
): ValueStore<T> {
  let snapshot = initialSnapshot
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    setSnapshot: (nextSnapshot) => {
      if (isEqual(snapshot, nextSnapshot)) return
      snapshot = nextSnapshot
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function useValueStore<T>(store: ValueStore<T>) {
  return React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  )
}

function useSelectedValueStore<T, S>(
  store: ValueStore<T>,
  selector: (snapshot: T) => S,
  isEqual: (left: S, right: S) => boolean = Object.is
) {
  const cacheRef = React.useRef<{
    source: T | undefined
    selected: S | undefined
  }>({
    source: undefined,
    selected: undefined,
  })

  const getSnapshot = () => {
    const source = store.getSnapshot()
    const cache = cacheRef.current
    if (cache.source === source && cache.selected !== undefined) {
      return cache.selected
    }

    const selected = selector(source)
    if (cache.selected !== undefined && isEqual(cache.selected, selected)) {
      cacheRef.current = { source, selected: cache.selected }
      return cache.selected
    }

    cacheRef.current = { source, selected }
    return selected
  }

  return React.useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

function shallowRecordEqual<T extends Record<string, unknown>>(
  left: T,
  right: T
) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    if (!Object.is(left[key], right[key])) return false
  }

  return true
}

type UserConversationItem = Extract<ConversationItem, { kind: "user" }>
type AssistantConversationItem = Extract<
  ConversationItem,
  { kind: "assistant" }
>

function createOptimisticPendingId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `optimistic:${crypto.randomUUID()}`
  }

  return `optimistic:${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

function insertOptimisticUserItem(
  items: Array<ConversationItem>,
  item: UserConversationItem
) {
  if (
    item.pendingId &&
    items.some(
      (entry) => entry.kind === "user" && entry.pendingId === item.pendingId
    )
  ) {
    return items
  }

  const nextItems = [...items]
  const lastItem = nextItems[nextItems.length - 1]
  const insertIndex =
    lastItem?.kind === "assistant" && lastItem.streaming
      ? nextItems.length - 1
      : nextItems.length
  nextItems.splice(insertIndex, 0, item)
  return nextItems
}

function removeOptimisticUserItem(
  items: Array<ConversationItem>,
  pendingId: string
) {
  let changed = false
  const nextItems = items.filter((item) => {
    const remove = item.kind === "user" && item.pendingId === pendingId
    if (remove) changed = true
    return !remove
  })

  return changed ? nextItems : items
}

type RenderConversationGroupDescriptor =
  | {
      kind: "user"
      key: string
      itemKey: string
    }
  | {
      kind: "assistant"
      key: string
      itemKeys: Array<string>
    }

function conversationItemKey(item: ConversationItem, index: number) {
  return item.itemKey || `message-row:${index}`
}

function groupConversationItemsForRender(options: {
  items: Array<ConversationItem>
  hideThinking: boolean
  hideToolBlocks: boolean
}) {
  const groups: Array<RenderConversationGroupDescriptor> = []
  let pendingAssistantGroup: Extract<
    RenderConversationGroupDescriptor,
    { kind: "assistant" }
  > | null = null
  let pendingAssistantVisible = false

  const flushAssistantGroup = () => {
    if (!pendingAssistantGroup) {
      pendingAssistantVisible = false
      return
    }

    if (pendingAssistantVisible) {
      groups.push(pendingAssistantGroup)
    }

    pendingAssistantGroup = null
    pendingAssistantVisible = false
  }

  options.items.forEach((item, index) => {
    const key = conversationItemKey(item, index)

    if (item.kind === "assistant") {
      if (!pendingAssistantGroup) {
        pendingAssistantGroup = {
          kind: "assistant",
          key,
          itemKeys: [],
        }
      }

      pendingAssistantGroup.itemKeys.push(key)
      pendingAssistantVisible ||= assistantMessageHasVisibleBlocks({
        item,
        hideThinking: options.hideThinking,
        hideToolBlocks: options.hideToolBlocks,
      })
      return
    }

    flushAssistantGroup()
    groups.push({
      kind: "user",
      key,
      itemKey: key,
    })
  })

  flushAssistantGroup()
  return groups
}

function sameRenderConversationGroupDescriptor(
  left: RenderConversationGroupDescriptor,
  right: RenderConversationGroupDescriptor
) {
  if (left.kind !== right.kind || left.key !== right.key) return false

  if (left.kind === "user" && right.kind === "user") {
    return left.itemKey === right.itemKey
  }

  if (left.kind !== "assistant" || right.kind !== "assistant") {
    return false
  }

  if (left.itemKeys.length !== right.itemKeys.length) return false

  for (let index = 0; index < left.itemKeys.length; index += 1) {
    if (left.itemKeys[index] !== right.itemKeys[index]) return false
  }

  return true
}

function reconcileRenderConversationGroupDescriptors(
  previousGroups: Array<RenderConversationGroupDescriptor>,
  nextGroups: Array<RenderConversationGroupDescriptor>
) {
  if (previousGroups.length === 0) return nextGroups

  let changed = previousGroups.length !== nextGroups.length
  const groups: Array<RenderConversationGroupDescriptor> = []

  for (let index = 0; index < nextGroups.length; index += 1) {
    const nextGroup = nextGroups[index]
    const previousGroup = previousGroups[index]

    if (
      previousGroup &&
      sameRenderConversationGroupDescriptor(previousGroup, nextGroup)
    ) {
      groups.push(previousGroup)
      continue
    }

    changed = true
    groups.push(nextGroup)
  }

  return changed ? groups : previousGroups
}

type ConversationItemsSnapshot = {
  items: Array<ConversationItem>
  itemByKey: Map<string, ConversationItem>
  revision: number
}

type ConversationItemsStore = {
  getSnapshot: () => ConversationItemsSnapshot
  getItem: (key: string) => ConversationItem | undefined
  setItems: (items: Array<ConversationItem>) => void
  subscribe: (listener: () => void) => () => void
  subscribeItems: (keys: Array<string>, listener: () => void) => () => void
}

type TextValueStore = {
  getSnapshot: () => string
  setValue: (value: string) => void
  subscribe: (listener: () => void) => () => void
}

function buildConversationItemMap(items: Array<ConversationItem>) {
  const itemByKey = new Map<string, ConversationItem>()
  items.forEach((item, index) => {
    itemByKey.set(conversationItemKey(item, index), item)
  })
  return itemByKey
}

function createConversationItemsStore(
  initialItems: Array<ConversationItem>
): ConversationItemsStore {
  let snapshot: ConversationItemsSnapshot = {
    items: initialItems,
    itemByKey: buildConversationItemMap(initialItems),
    revision: 0,
  }
  const listeners = new Set<() => void>()
  const itemListeners = new Map<string, Set<() => void>>()

  const notifyItemListeners = (key: string) => {
    const listenersForItem = itemListeners.get(key)
    if (!listenersForItem) return

    for (const listener of listenersForItem) listener()
  }

  return {
    getSnapshot: () => snapshot,
    getItem: (key) => snapshot.itemByKey.get(key),
    setItems: (items) => {
      if (snapshot.items === items) return

      const previousItemByKey = snapshot.itemByKey
      const nextItemByKey = buildConversationItemMap(items)
      snapshot = {
        items,
        itemByKey: nextItemByKey,
        revision: snapshot.revision + 1,
      }

      const changedItemKeys = new Set<string>()
      for (const key of previousItemByKey.keys()) {
        if (previousItemByKey.get(key) !== nextItemByKey.get(key)) {
          changedItemKeys.add(key)
        }
      }
      for (const key of nextItemByKey.keys()) {
        if (previousItemByKey.get(key) !== nextItemByKey.get(key)) {
          changedItemKeys.add(key)
        }
      }

      for (const listener of listeners) listener()
      for (const key of changedItemKeys) notifyItemListeners(key)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    subscribeItems: (keys, listener) => {
      const uniqueKeys = [...new Set(keys)]
      for (const key of uniqueKeys) {
        const listenersForItem = itemListeners.get(key) ?? new Set<() => void>()
        listenersForItem.add(listener)
        itemListeners.set(key, listenersForItem)
      }

      return () => {
        for (const key of uniqueKeys) {
          const listenersForItem = itemListeners.get(key)
          if (!listenersForItem) continue
          listenersForItem.delete(listener)
          if (listenersForItem.size === 0) {
            itemListeners.delete(key)
          }
        }
      }
    },
  }
}

function useConversationRevision(store: ConversationItemsStore) {
  return React.useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().revision,
    () => store.getSnapshot().revision
  )
}

function conversationHasAssistantOutput(items: Array<ConversationItem>) {
  return items.some(
    (item) =>
      item.kind === "assistant" &&
      item.blocks.some(
        (block) =>
          block.type === "text" &&
          typeof block.text === "string" &&
          block.text.trim().length > 0
      )
  )
}

function useConversationHasMessages(store: ConversationItemsStore) {
  return React.useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().items.length > 0,
    () => store.getSnapshot().items.length > 0
  )
}

function useConversationHasAssistantOutput(store: ConversationItemsStore) {
  return React.useSyncExternalStore(
    store.subscribe,
    () => conversationHasAssistantOutput(store.getSnapshot().items),
    () => conversationHasAssistantOutput(store.getSnapshot().items)
  )
}

function useConversationGroupDescriptors({
  hideThinking,
  hideToolBlocks,
  store,
}: {
  hideThinking: boolean
  hideToolBlocks: boolean
  store: ConversationItemsStore
}) {
  const cacheRef = React.useRef<{
    hideThinking: boolean
    hideToolBlocks: boolean
    revision: number
    groups: Array<RenderConversationGroupDescriptor>
  }>({
    hideThinking,
    hideToolBlocks,
    revision: -1,
    groups: [],
  })

  const getSnapshot = () => {
    const snapshot = store.getSnapshot()
    const cache = cacheRef.current
    if (
      cache.revision === snapshot.revision &&
      cache.hideThinking === hideThinking &&
      cache.hideToolBlocks === hideToolBlocks
    ) {
      return cache.groups
    }

    const nextGroups = groupConversationItemsForRender({
      items: snapshot.items,
      hideThinking,
      hideToolBlocks,
    })
    const groups =
      cache.hideThinking === hideThinking &&
      cache.hideToolBlocks === hideToolBlocks
        ? reconcileRenderConversationGroupDescriptors(cache.groups, nextGroups)
        : nextGroups

    cacheRef.current = {
      hideThinking,
      hideToolBlocks,
      revision: snapshot.revision,
      groups,
    }

    return groups
  }

  return React.useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

function useConversationItem(
  store: ConversationItemsStore,
  key: string
): ConversationItem | undefined {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener) => store.subscribeItems([key], listener),
      [key, store]
    ),
    () => store.getItem(key),
    () => store.getItem(key)
  )
}

function useConversationAssistantItems(
  store: ConversationItemsStore,
  itemKeys: Array<string>
) {
  const cacheRef = React.useRef<{
    itemKeys: Array<string>
    items: Array<AssistantConversationItem>
  }>({ itemKeys: [], items: [] })

  const getSnapshot = () => {
    const nextItems = itemKeys
      .map((key) => store.getItem(key))
      .filter(
        (item): item is AssistantConversationItem => item?.kind === "assistant"
      )
    const cache = cacheRef.current
    if (
      cache.itemKeys.length === itemKeys.length &&
      cache.itemKeys.every((key, index) => key === itemKeys[index]) &&
      cache.items.length === nextItems.length &&
      cache.items.every((item, index) => item === nextItems[index])
    ) {
      return cache.items
    }

    cacheRef.current = {
      itemKeys,
      items: nextItems,
    }
    return nextItems
  }

  return React.useSyncExternalStore(
    React.useCallback(
      (listener) => store.subscribeItems(itemKeys, listener),
      [itemKeys, store]
    ),
    getSnapshot,
    getSnapshot
  )
}

function createTextValueStore(initialValue = ""): TextValueStore {
  let value = initialValue
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => value,
    setValue: (nextValue) => {
      if (value === nextValue) return

      value = nextValue
      for (const listener of listeners) {
        listener()
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function useTextValueSnapshot(store: TextValueStore) {
  return React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  )
}

type AppShellConversationFrameHandle = {
  jumpToNextMessage: () => void
  jumpToPreviousMessage: () => void
  scrollConversationToBottom: () => void
  scrollConversationToTop: () => void
}

function ConversationLatestMessageButton({
  conversationItemsStore,
  draft,
  onClick,
  scrollStateStore,
}: {
  conversationItemsStore: ConversationItemsStore
  draft: boolean
  onClick: () => void
  scrollStateStore: MessageScrollStateStore
}) {
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  const isDisabled = useMessageScrollValue(
    scrollStateStore,
    (snapshot) => draft || !hasMessages || snapshot.isMessagesNearBottom
  )

  return (
    <Button
      variant="secondary"
      size="icon-lg"
      disabled={isDisabled}
      className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border-0 shadow-[0_10px_24px_rgba(0,0,0,0.28)] disabled:pointer-events-none disabled:opacity-0 md:bottom-[18px]"
      title="Jump to latest message"
      aria-label="Jump to latest message"
      onClick={onClick}
    >
      <ArrowDownIcon className="size-4" />
    </Button>
  )
}

function ConversationScrollRevisionObserver({
  conversationItemsStore,
  disabled,
  onRevisionChange,
}: {
  conversationItemsStore: ConversationItemsStore
  disabled: boolean
  onRevisionChange: () => void
}) {
  const conversationRevision = useConversationRevision(conversationItemsStore)

  React.useLayoutEffect(() => {
    if (disabled) return
    onRevisionChange()
  }, [conversationRevision, disabled, onRevisionChange])

  return null
}

function ConversationPreviousMessageButton({
  onClick,
  scrollStateStore,
}: {
  onClick: () => void
  scrollStateStore: MessageScrollStateStore
}) {
  const isDisabled = useMessageScrollValue(
    scrollStateStore,
    (snapshot) => !snapshot.hasPreviousMessageJumpTarget
  )

  return (
    <Button
      variant="secondary"
      size="icon-lg"
      disabled={isDisabled}
      className="absolute right-4 bottom-4 z-10 rounded-full border-0 shadow-[0_10px_24px_rgba(0,0,0,0.28)] disabled:pointer-events-none disabled:opacity-0 md:right-[18px] md:bottom-[18px]"
      title="Jump to previous message"
      aria-label="Jump to previous message"
      onClick={onClick}
    >
      <ArrowUpToLineIcon className="size-4" />
    </Button>
  )
}

type AppShellConversationSessionState = Pick<
  SessionState,
  "cwd" | "draft" | "sessionFile" | "sessionId" | "streaming"
>

function useAppShellConversationSessionState(store: ValueStore<SessionState>) {
  return useSelectedValueStore(
    store,
    (sessionState) => ({
      cwd: sessionState.cwd,
      draft: sessionState.draft,
      sessionFile: sessionState.sessionFile,
      sessionId: sessionState.sessionId,
      streaming: sessionState.streaming,
    }),
    shallowRecordEqual
  )
}

const AppShellConversationFrame = React.forwardRef<
  AppShellConversationFrameHandle,
  {
    children: React.ReactNode
    conversationItemsStore: ConversationItemsStore
    isSessionViewLoading: boolean
    sessionState: AppShellConversationSessionState
  }
>(function AppShellConversationFrameImpl(
  { children, conversationItemsStore, isSessionViewLoading, sessionState },
  ref
) {
  const {
    bottomRef,
    jumpToNextMessage,
    jumpToPreviousMessage,
    messagesContentRef,
    messagesScrollAreaRef,
    scrollConversationToBottom,
    scrollConversationToTop,
    scrollStateStore,
    syncAfterConversationChange,
  } = useAppShellMessageScroll({
    isSessionViewLoading,
    sessionState,
  })

  React.useImperativeHandle(
    ref,
    () => ({
      jumpToNextMessage,
      jumpToPreviousMessage,
      scrollConversationToBottom,
      scrollConversationToTop,
    }),
    [
      jumpToNextMessage,
      jumpToPreviousMessage,
      scrollConversationToBottom,
      scrollConversationToTop,
    ]
  )

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={messagesScrollAreaRef}
        data-conversation-viewport="true"
        tabIndex={0}
        role="region"
        aria-label="Conversation messages"
        className="h-full overflow-auto px-4 outline-none"
      >
        <div ref={messagesContentRef} className="flex min-h-full flex-col">
          <ConversationScrollRevisionObserver
            conversationItemsStore={conversationItemsStore}
            disabled={isSessionViewLoading}
            onRevisionChange={syncAfterConversationChange}
          />
          {children}
          <div ref={bottomRef} />
        </div>
      </div>

      {!isSessionViewLoading ? (
        <>
          <ConversationLatestMessageButton
            conversationItemsStore={conversationItemsStore}
            draft={sessionState.draft}
            onClick={scrollConversationToBottom}
            scrollStateStore={scrollStateStore}
          />
          <ConversationPreviousMessageButton
            onClick={jumpToPreviousMessage}
            scrollStateStore={scrollStateStore}
          />
        </>
      ) : null}
    </div>
  )
})

type AppShellWorkingState = {
  label: string
  summary?: string
  done?: boolean
}

function sameWorkingState(
  left: AppShellWorkingState | null,
  right: AppShellWorkingState | null
) {
  return (
    left?.label === right?.label &&
    left?.summary === right?.summary &&
    left?.done === right?.done
  )
}

function AppShellMessagesWorkingIndicator({
  hiddenThinkingPreviewStore,
  state,
  useHiddenThinkingPreview,
}: {
  hiddenThinkingPreviewStore: TextValueStore
  state: AppShellWorkingState
  useHiddenThinkingPreview: boolean
}) {
  const hiddenThinkingPreview = useTextValueSnapshot(hiddenThinkingPreviewStore)
  const displayedState =
    useHiddenThinkingPreview && hiddenThinkingPreview
      ? { ...state, label: hiddenThinkingPreview }
      : state

  return <MessagesWorkingIndicator state={displayedState} />
}

function AppShellTabsList({
  viewerContextId,
  sessionStore,
}: {
  viewerContextId: string
  sessionStore: ValueStore<SessionState>
}) {
  const cwd = useSelectedValueStore(
    sessionStore,
    (sessionState) => sessionState.cwd
  )

  return (
    <TabsList className="w-full rounded-none border-b border-border/70">
      <TabsTrigger value="session">Session</TabsTrigger>
      <TabsTrigger value="git">
        <GitTabStatusText viewerContextId={viewerContextId} cwd={cwd} />
      </TabsTrigger>
    </TabsList>
  )
}

const AppShellGitPanelController = React.memo(
  function AppShellGitPanelController({
    active,
    sessionStore,
    viewerContextId,
  }: {
    active: boolean
    sessionStore: ValueStore<SessionState>
    viewerContextId: string
  }) {
    const cwd = useSelectedValueStore(
      sessionStore,
      (sessionState) => sessionState.cwd
    )

    if (!active) return null

    return (
      <GitPanel viewerContextId={viewerContextId} cwd={cwd} active={active} />
    )
  }
)

function ConversationGroupView({
  className,
  group,
  hideThinking,
  hideToolBlocks,
  store,
}: {
  className: string
  group: RenderConversationGroupDescriptor
  hideThinking: boolean
  hideToolBlocks: boolean
  store: ConversationItemsStore
}) {
  if (group.kind === "user") {
    return (
      <ConversationUserGroupView
        className={className}
        itemKey={group.itemKey}
        store={store}
      />
    )
  }

  return (
    <ConversationAssistantGroupView
      className={className}
      hideThinking={hideThinking}
      hideToolBlocks={hideToolBlocks}
      itemKeys={group.itemKeys}
      store={store}
    />
  )
}

function ConversationUserGroupView({
  className,
  itemKey,
  store,
}: {
  className: string
  itemKey: string
  store: ConversationItemsStore
}) {
  const item = useConversationItem(store, itemKey)
  if (!item || item.kind !== "user") return null

  return (
    <div data-message-anchor="true" className={className}>
      <UserMessageCard item={item} />
    </div>
  )
}

function ConversationAssistantGroupView({
  className,
  hideThinking,
  hideToolBlocks,
  itemKeys,
  store,
}: {
  className: string
  hideThinking: boolean
  hideToolBlocks: boolean
  itemKeys: Array<string>
  store: ConversationItemsStore
}) {
  const items = useConversationAssistantItems(store, itemKeys)
  if (items.length === 0) return null

  return (
    <div data-message-anchor="true" className={className}>
      <AssistantMessagesCard
        items={items}
        hideThinking={hideThinking}
        hideToolBlocks={hideToolBlocks}
      />
    </div>
  )
}

function AppShellConversationItemGroups({
  centerMessages,
  conversationItemsStore,
  hideThinking,
  hideToolBlocks,
}: {
  centerMessages: boolean
  conversationItemsStore: ConversationItemsStore
  hideThinking: boolean
  hideToolBlocks: boolean
}) {
  const conversationMessageColumnClassName = centerMessages
    ? "mx-auto w-full max-w-[80ch]"
    : "w-full"
  const renderedConversationGroups = useConversationGroupDescriptors({
    store: conversationItemsStore,
    hideThinking,
    hideToolBlocks,
  })

  if (renderedConversationGroups.length === 0) return null

  return (
    <>
      {renderedConversationGroups.map((group) => (
        <ConversationGroupView
          key={group.key}
          className={conversationMessageColumnClassName}
          group={group}
          hideThinking={hideThinking}
          hideToolBlocks={hideToolBlocks}
          store={conversationItemsStore}
        />
      ))}
    </>
  )
}

function AppShellConversationEmptyState({
  awaitingFirstTurn,
  conversationItemsStore,
  draft,
  cwd,
  isSessionViewLoading,
  isSubmitting,
  onCreateSession,
  streaming,
  viewerContextId,
  workingStateStore,
}: {
  awaitingFirstTurn: boolean
  conversationItemsStore: ConversationItemsStore
  draft: boolean
  cwd?: string
  isSessionViewLoading: boolean
  isSubmitting: boolean
  onCreateSession: () => void
  streaming: boolean
  viewerContextId: string
  workingStateStore: ValueStore<AppShellWorkingState | null>
}) {
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  const hasAssistantOutput = useConversationHasAssistantOutput(
    conversationItemsStore
  )
  const workingState = useValueStore(workingStateStore)
  const displayedWorkingState =
    workingState ||
    (hasAssistantOutput
      ? {
          label: "Done",
          done: true,
        }
      : null)
  const showConversationLoadingState = Boolean(
    isSessionViewLoading ||
    (!draft &&
      !hasMessages &&
      (isSubmitting ||
        awaitingFirstTurn ||
        streaming ||
        Boolean(displayedWorkingState)))
  )
  const conversationLoadingLabel = isSessionViewLoading
    ? "Loading session…"
    : displayedWorkingState && !displayedWorkingState.done
      ? displayedWorkingState.label
      : "Loading…"

  if (hasMessages) return null

  if (showConversationLoadingState) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
        <Spinner />
        <div>{conversationLoadingLabel}</div>
      </div>
    )
  }

  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          {draft ? "New session" : "Start a new conversation"}
        </EmptyTitle>
        <EmptyDescription>
          {draft
            ? undefined
            : "This is the native Pi session view backed by the new TypeScript runtime."}
        </EmptyDescription>
      </EmptyHeader>
      {draft ? (
        <EmptyContent className="flex flex-col items-center gap-3">
          {cwd ? (
            <Badge variant="outline">{formatDisplayPath(cwd)}</Badge>
          ) : null}
          <DraftGitStatusBadge viewerContextId={viewerContextId} cwd={cwd} />
        </EmptyContent>
      ) : (
        <EmptyContent>
          <Button onClick={onCreateSession}>New session</Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

function AppShellConversationWorkingFooter({
  centerMessages,
  conversationItemsStore,
  hiddenThinkingPreviewStore,
  hideThinking,
  streaming,
  workingStateStore,
}: {
  centerMessages: boolean
  conversationItemsStore: ConversationItemsStore
  hiddenThinkingPreviewStore: TextValueStore
  hideThinking: boolean
  streaming: boolean
  workingStateStore: ValueStore<AppShellWorkingState | null>
}) {
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  const hasAssistantOutput = useConversationHasAssistantOutput(
    conversationItemsStore
  )
  const conversationMessageColumnClassName = centerMessages
    ? "mx-auto w-full max-w-[80ch]"
    : "w-full"
  const workingState = useValueStore(workingStateStore)
  const displayedWorkingState =
    workingState ||
    (hasAssistantOutput
      ? {
          label: "Done",
          done: true,
        }
      : null)

  if (!hasMessages || !displayedWorkingState) return null

  return (
    <div className={`${conversationMessageColumnClassName} mt-4`}>
      <AppShellMessagesWorkingIndicator
        hiddenThinkingPreviewStore={hiddenThinkingPreviewStore}
        state={displayedWorkingState}
        useHiddenThinkingPreview={streaming && hideThinking}
      />
    </div>
  )
}

function AppShellConversationMessageStack({
  centerMessages,
  conversationItemsStore,
  hideThinking,
  hideToolBlocks,
}: {
  centerMessages: boolean
  conversationItemsStore: ConversationItemsStore
  hideThinking: boolean
  hideToolBlocks: boolean
}) {
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  if (!hasMessages) return null

  return (
    <div className="flex flex-col gap-4 pt-4">
      <AppShellConversationItemGroups
        centerMessages={centerMessages}
        conversationItemsStore={conversationItemsStore}
        hideThinking={hideThinking}
        hideToolBlocks={hideToolBlocks}
      />
    </div>
  )
}

const AppShellSessionConversation = React.memo(
  function AppShellSessionConversation({
    awaitingFirstTurn,
    centerMessages,
    conversationFrameRef,
    conversationItemsStore,
    hideThinking,
    hideToolBlocks,
    hiddenThinkingPreviewStore,
    isSessionViewLoading,
    isSubmitting,
    onCreateSession,
    sessionStore,
    viewerContextId,
    workingStateStore,
  }: {
    awaitingFirstTurn: boolean
    centerMessages: boolean
    conversationFrameRef: React.RefObject<AppShellConversationFrameHandle | null>
    conversationItemsStore: ConversationItemsStore
    hiddenThinkingPreviewStore: TextValueStore
    hideThinking: boolean
    hideToolBlocks: boolean
    isSessionViewLoading: boolean
    isSubmitting: boolean
    onCreateSession: () => void
    sessionStore: ValueStore<SessionState>
    viewerContextId: string
    workingStateStore: ValueStore<AppShellWorkingState | null>
  }) {
    const sessionState = useAppShellConversationSessionState(sessionStore)
    return (
      <AppShellConversationFrame
        ref={conversationFrameRef}
        conversationItemsStore={conversationItemsStore}
        isSessionViewLoading={isSessionViewLoading}
        sessionState={sessionState}
      >
        <AppShellConversationEmptyState
          awaitingFirstTurn={awaitingFirstTurn}
          conversationItemsStore={conversationItemsStore}
          cwd={sessionState.cwd}
          draft={sessionState.draft}
          isSessionViewLoading={isSessionViewLoading}
          isSubmitting={isSubmitting}
          onCreateSession={onCreateSession}
          streaming={sessionState.streaming}
          viewerContextId={viewerContextId}
          workingStateStore={workingStateStore}
        />
        <AppShellConversationMessageStack
          centerMessages={centerMessages}
          conversationItemsStore={conversationItemsStore}
          hideThinking={hideThinking}
          hideToolBlocks={hideToolBlocks}
        />
        <AppShellConversationWorkingFooter
          centerMessages={centerMessages}
          conversationItemsStore={conversationItemsStore}
          hiddenThinkingPreviewStore={hiddenThinkingPreviewStore}
          hideThinking={hideThinking}
          streaming={sessionState.streaming}
          workingStateStore={workingStateStore}
        />
      </AppShellConversationFrame>
    )
  }
)

function useAppShellComposerSnapshot(
  store: ValueStore<AppShellComposerSnapshot>
) {
  return useValueStore(store)
}

const AppShellComposerController = React.memo(
  function AppShellComposerController({
    actionsRef,
    composerPanelRef,
    fileInputRef,
    store,
  }: {
    actionsRef: React.MutableRefObject<AppShellComposerActions>
    composerPanelRef: React.RefObject<ComposerPanelHandle | null>
    fileInputRef: React.RefObject<HTMLInputElement | null>
    store: ValueStore<AppShellComposerSnapshot>
  }) {
    const snapshot = useAppShellComposerSnapshot(store)
    const snapshotRef = useLatestRef(snapshot)

    const onComposerTextChange = useStableEvent((value: string) => {
      if (snapshotRef.current.disabled) return
      actionsRef.current.syncComposerDraft(value)
    })
    const onPickImages = useStableEvent(
      (files: FileList | Array<File> | null) => {
        if (snapshotRef.current.disabled) return
        void actionsRef.current.onPickImages(files)
      }
    )
    const onRemoveComposerImage = useStableEvent((index: number) => {
      if (snapshotRef.current.disabled) return
      actionsRef.current.onRemoveComposerImage(index)
    })
    const onSubmitPrompt = useStableEvent(
      (streamingBehavior?: StreamingBehavior) => {
        if (snapshotRef.current.disabled) return
        void actionsRef.current.submitPrompt(streamingBehavior)
      }
    )
    const onAbort = useStableEvent(() => {
      if (snapshotRef.current.disabled) return
      void actionsRef.current.abortSession()
    })
    const onRemovePendingMessage = useStableEvent((pendingId: string) => {
      if (snapshotRef.current.disabled) return
      if (actionsRef.current.removePendingDraftFollowUp(pendingId)) return
      void actionsRef.current.removePendingMessage(pendingId)
    })
    const onReorderPending = useStableEvent(
      (pendingId: string, direction: -1 | 1) => {
        if (snapshotRef.current.disabled) return
        if (
          actionsRef.current.reorderPendingDraftFollowUp(pendingId, direction)
        ) {
          return
        }
        void actionsRef.current.reorderPending(pendingId, direction)
      }
    )
    const onRunBuiltinSlashCommand = useStableEvent(
      (name: string, args: string) => {
        if (snapshotRef.current.disabled) return
        void actionsRef.current.runBuiltinSlashCommand(name, args)
      }
    )
    const onSelectModel = useStableEvent((value: string) => {
      if (snapshotRef.current.disabled) return
      void actionsRef.current.setModel(value)
    })
    const onSelectThinkingLevel = useStableEvent((level: string) => {
      if (snapshotRef.current.disabled) return
      void actionsRef.current.setThinkingLevel(level)
    })
    const requestPathCompletions = useStableEvent(async (prefix: string) => {
      const currentSnapshot = snapshotRef.current
      if (currentSnapshot.disabled) return []

      const response = await fetchJson<PathCompletionsResponse>(
        buildRequestUrl("/api/path-completions", {
          contextId: currentSnapshot.viewerContextId,
          sessionId: currentSnapshot.activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prefix }),
        }
      )
      return isApiErrorResponse(response) ? [] : response.items
    })
    const requestFileCompletions = useStableEvent(
      async (query: string, isQuotedPrefix: boolean) => {
        const currentSnapshot = snapshotRef.current
        if (currentSnapshot.disabled) return []

        const response = await fetchJson<FileCompletionsResponse>(
          buildRequestUrl("/api/file-completions", {
            contextId: currentSnapshot.viewerContextId,
            sessionId: currentSnapshot.activeSessionId,
          }),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ query, isQuotedPrefix }),
          }
        )
        return isApiErrorResponse(response) ? [] : response.items
      }
    )

    return (
      <ComposerPanel
        ref={composerPanelRef}
        currentPendingMessages={snapshot.currentPendingMessages}
        composerImages={snapshot.composerImages}
        composerText={snapshot.composerText}
        composerSkill={snapshot.composerSkill}
        composerSyncNonce={snapshot.composerSyncNonce}
        centerMessages={snapshot.centerMessages}
        availableModels={snapshot.availableModels}
        model={snapshot.model}
        thinkingLevel={snapshot.thinkingLevel}
        availableThinkingLevels={snapshot.availableThinkingLevels}
        contextUsage={snapshot.contextUsage}
        isSubmitting={snapshot.isSubmitting}
        isStreaming={snapshot.isStreaming}
        awaitingFirstTurn={snapshot.awaitingFirstTurn}
        disabled={snapshot.disabled}
        fileInputRef={fileInputRef}
        slashCommands={snapshot.slashCommands}
        onComposerTextChange={onComposerTextChange}
        onPickImages={onPickImages}
        onRemoveComposerImage={onRemoveComposerImage}
        onSubmitPrompt={onSubmitPrompt}
        onAbort={onAbort}
        onRemovePendingMessage={onRemovePendingMessage}
        onReorderPending={onReorderPending}
        onRunBuiltinSlashCommand={onRunBuiltinSlashCommand}
        onSelectModel={onSelectModel}
        onSelectThinkingLevel={onSelectThinkingLevel}
        requestPathCompletions={requestPathCompletions}
        requestFileCompletions={requestFileCompletions}
      />
    )
  }
)

function AppShellWindowEffectsHost({
  currentSessionTitle,
  displaySessionTitle,
  isSessionViewLoading,
  onConsumeSessionDoneEvents,
  onSelectSession,
  sessionDoneDesktopNotificationsEnabled,
  sessionDoneEvents,
  sessionDoneSoundEnabled,
  sessionStore,
  sidebarStore,
}: {
  currentSessionTitle: string
  displaySessionTitle: string
  isSessionViewLoading: boolean
  onConsumeSessionDoneEvents: (ids: Array<string>) => void
  onSelectSession: (nextSessionId?: string) => void
  sessionDoneDesktopNotificationsEnabled: boolean
  sessionDoneEvents: Array<SessionDoneEvent>
  sessionDoneSoundEnabled: boolean
  sessionStore: ValueStore<SessionState>
  sidebarStore: AppShellSidebarStore
}) {
  const sessionWindowState = useSelectedValueStore(
    sessionStore,
    (sessionState) => ({
      activeSessionKey: sessionState.sessionKey,
      activeSessionNotificationKey: sessionNotificationKey({
        sessionId: sessionState.sessionId,
        sessionFile: sessionState.sessionFile,
      }),
      sessionCwd: sessionState.cwd,
      sessionStreaming: sessionState.streaming,
      uiTitle: sessionState.uiState.title?.trim() || "",
    }),
    shallowRecordEqual
  )
  const currentPageTitle = isSessionViewLoading
    ? displaySessionTitle
    : sessionWindowState.uiTitle ||
      (currentSessionTitle !== "New session" ? currentSessionTitle : "Pi")

  return (
    <AppShellWindowEffects
      activeSessionKey={sessionWindowState.activeSessionKey}
      activeSessionNotificationKey={
        sessionWindowState.activeSessionNotificationKey
      }
      currentPageTitle={currentPageTitle}
      sessionCwd={sessionWindowState.sessionCwd}
      sessionDoneDesktopNotificationsEnabled={
        sessionDoneDesktopNotificationsEnabled
      }
      sessionDoneSoundEnabled={sessionDoneSoundEnabled}
      sessionStreaming={sessionWindowState.sessionStreaming}
      sessionDoneEvents={sessionDoneEvents}
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
  const processedSessionDoneEventIdsRef = React.useRef<Set<string>>(new Set())

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
    if (!sessionStreaming) {
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
      const body = event.cwd || sessionCwd || "Open Pi to continue"
      const tag = event.sessionPath || event.sessionId || event.id

      if (matchesCurrentSession) {
        if (!isPageForeground && key) {
          setBackgroundCurrentSessionUnreadKey(key)
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
        toast.success(label, {
          action: {
            label: "Open",
            onClick: () => onSelectSession(event.sessionId),
          },
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
    isPageForeground,
    onConsumeSessionDoneEvents,
    onSelectSession,
    sessionCwd,
    sessionDoneDesktopNotificationsEnabled,
    sessionDoneEvents,
    sessionDoneSoundEnabled,
  ])

  const sidebarUnreadVersion = React.useSyncExternalStore(
    sidebarStore.subscribe,
    () =>
      sidebarStore
        .getWorkspaceSnapshot()
        .sidebarSessions.filter((session) => session.unread)
        .map((session) => sessionNotificationKey(session))
        .filter(Boolean)
        .sort()
        .join("\n"),
    () => ""
  )
  const unreadSessionCount = (() => {
    const unreadKeys = new Set(
      sidebarUnreadVersion ? sidebarUnreadVersion.split("\n") : []
    )

    if (backgroundCurrentSessionUnreadKey) {
      unreadKeys.add(backgroundCurrentSessionUnreadKey)
    }

    return unreadKeys.size
  })()

  React.useEffect(() => {
    const streamingPrefix = sessionStreaming
      ? `${TITLE_STREAMING_FRAMES[titleStreamingFrameIndex]} `
      : ""
    const nextTitle = `${streamingPrefix}${currentPageTitle}`
    document.title =
      unreadSessionCount > 0
        ? `(${unreadSessionCount}) ${nextTitle}`
        : nextTitle
  }, [
    currentPageTitle,
    sessionStreaming,
    titleStreamingFrameIndex,
    unreadSessionCount,
  ])

  return null
}

export type SelectSessionNavigationOptions = {
  replace?: boolean
}

type CreateSessionOptions = {
  closeMobileSidebar?: boolean
}

type PendingComposerMessage = {
  pendingId: string
  text: string
  images: Array<PromptImage>
  streamingBehavior: "steer" | "followUp"
}

type AppShellComposerSnapshot = {
  activeSessionId?: string
  awaitingFirstTurn: boolean
  availableModels: SessionState["availableModels"]
  availableThinkingLevels: SessionState["availableThinkingLevels"]
  centerMessages: boolean
  composerImages: Array<PromptImage>
  composerSkill?: string
  composerSyncNonce: number
  composerText: string
  contextUsage?: SessionState["contextUsage"]
  currentPendingMessages: Array<PendingComposerMessage>
  disabled: boolean
  isStreaming: boolean
  isSubmitting: boolean
  model: SessionState["model"]
  slashCommands: Array<SlashCommandDescriptor>
  thinkingLevel: SessionState["thinkingLevel"]
  viewerContextId: string
}

type AppShellComposerActions = {
  abortSession: () => void | Promise<unknown>
  onPickImages: (files: FileList | Array<File> | null) => void | Promise<void>
  onRemoveComposerImage: (index: number) => void
  removePendingDraftFollowUp: (pendingId: string) => boolean
  removePendingMessage: (pendingId: string) => void | Promise<unknown>
  reorderPending: (
    pendingId: string,
    direction: -1 | 1
  ) => void | Promise<unknown>
  reorderPendingDraftFollowUp: (pendingId: string, direction: -1 | 1) => boolean
  runBuiltinSlashCommand: (
    name: string,
    args: string
  ) => void | Promise<unknown>
  setModel: (value: string) => void | Promise<unknown>
  setThinkingLevel: (level: string) => void | Promise<unknown>
  submitPrompt: (
    streamingBehavior?: StreamingBehavior
  ) => void | Promise<unknown>
  syncComposerDraft: (value: string) => void
}

function createInitialAppShellComposerSnapshot(
  viewerContextId: string
): AppShellComposerSnapshot {
  const initialSessionState = createInitialSessionState()
  return {
    activeSessionId: undefined,
    awaitingFirstTurn: false,
    availableModels: initialSessionState.availableModels,
    availableThinkingLevels: initialSessionState.availableThinkingLevels,
    centerMessages: false,
    composerImages: [],
    composerSkill: undefined,
    composerSyncNonce: 0,
    composerText: "",
    contextUsage: undefined,
    currentPendingMessages: [],
    disabled: false,
    isStreaming: false,
    isSubmitting: false,
    model: initialSessionState.model,
    slashCommands: [],
    thinkingLevel: initialSessionState.thinkingLevel,
    viewerContextId,
  }
}

type AppShellSessionWorkspaceHandle = {
  createSession: (
    cwdOverride?: string,
    options?: CreateSessionOptions
  ) => Promise<void>
  openAddDirectoryDialog: () => void
  openCommandPalette: () => void
  openDeleteDialog: (targets: Array<SessionListEntry>) => void
  openRenameDialogForEntry: (entry: SessionListEntry) => void
  openSettingsDialog: () => void
  selectSession: (
    nextSessionId?: string,
    options?: SelectSessionNavigationOptions
  ) => void
}

type AppShellSessionWorkspaceProps = {
  viewerContextId: string
  sessionId?: string
  onSelectSession?: (
    sessionId?: string,
    options?: SelectSessionNavigationOptions
  ) => void
  sidebarStore: AppShellSidebarStore
  sessionSearchInputRef: React.RefObject<HTMLInputElement | null>
}

const AppShellSessionWorkspace = React.forwardRef<
  AppShellSessionWorkspaceHandle,
  AppShellSessionWorkspaceProps
>(function AppShellSessionWorkspaceImpl(
  {
    viewerContextId,
    sessionId,
    onSelectSession,
    sidebarStore,
    sessionSearchInputRef,
  },
  ref
) {
  const initialSessionStateRef = React.useRef<SessionState | null>(null)
  if (!initialSessionStateRef.current) {
    initialSessionStateRef.current = createInitialSessionState()
  }
  const [sessionState, setSessionStateState] = React.useState<SessionState>(
    initialSessionStateRef.current
  )
  const sessionStoreRef = React.useRef<ValueStore<SessionState> | null>(null)
  if (!sessionStoreRef.current) {
    sessionStoreRef.current = createValueStore(initialSessionStateRef.current)
  }
  const sessionStore = sessionStoreRef.current
  const [currentTab, setCurrentTab] = React.useState("session")
  const previousRouteSessionIdRef = React.useRef(sessionId)
  const composerDraftSeedStoreRef = React.useRef<ValueStore<{
    text: string
    skillName?: string
    syncNonce: number
  }> | null>(null)
  if (!composerDraftSeedStoreRef.current) {
    composerDraftSeedStoreRef.current = createValueStore({
      text: "",
      syncNonce: 0,
    })
  }
  const composerDraftSeedStore = composerDraftSeedStoreRef.current
  const composerImagesStoreRef = React.useRef<ValueStore<
    Array<PromptImage>
  > | null>(null)
  if (!composerImagesStoreRef.current) {
    composerImagesStoreRef.current = createValueStore<Array<PromptImage>>([])
  }
  const composerImagesStore = composerImagesStoreRef.current
  const composerImagesRef = React.useRef<Array<PromptImage>>([])
  const [hideToolBlocks, setHideToolBlocks] = React.useState(false)
  const [centerMessages, setCenterMessages] = React.useState(false)
  const awaitingFirstTurnStoreRef = React.useRef<ValueStore<boolean> | null>(
    null
  )
  if (!awaitingFirstTurnStoreRef.current) {
    awaitingFirstTurnStoreRef.current = createValueStore(false)
  }
  const awaitingFirstTurnStore = awaitingFirstTurnStoreRef.current
  const [runningSlashCommand, setRunningSlashCommand] = React.useState<
    string | null
  >(null)
  const [draftSessionLoadingOwnerKey, setDraftSessionLoadingOwnerKey] =
    React.useState<string | null>(null)
  const [loadingSessionId, setLoadingSessionId] = React.useState<string | null>(
    null
  )
  const [initialLoadingSessionId, setInitialLoadingSessionId] = React.useState<
    string | null
  >(() => sessionId || null)
  const pendingDraftPromptStoreRef = React.useRef<ValueStore<{
    ownerKey: string
    message: string
    images: Array<PromptImage>
    streamingBehavior?: StreamingBehavior
    optimisticId?: string
  } | null> | null>(null)
  if (!pendingDraftPromptStoreRef.current) {
    pendingDraftPromptStoreRef.current = createValueStore<{
      ownerKey: string
      message: string
      images: Array<PromptImage>
      streamingBehavior?: StreamingBehavior
      optimisticId?: string
    } | null>(null)
  }
  const pendingDraftPromptStore = pendingDraftPromptStoreRef.current
  const pendingDraftFollowUpsStoreRef = React.useRef<ValueStore<
    Array<{
      message: string
      images: Array<PromptImage>
      streamingBehavior: "steer" | "followUp"
      optimisticId?: string
    }>
  > | null>(null)
  if (!pendingDraftFollowUpsStoreRef.current) {
    pendingDraftFollowUpsStoreRef.current = createValueStore<
      Array<{
        message: string
        images: Array<PromptImage>
        streamingBehavior: "steer" | "followUp"
        optimisticId?: string
      }>
    >([])
  }
  const pendingDraftFollowUpsStore = pendingDraftFollowUpsStoreRef.current
  const isSubmittingStoreRef = React.useRef<ValueStore<boolean> | null>(null)
  if (!isSubmittingStoreRef.current) {
    isSubmittingStoreRef.current = createValueStore(false)
  }
  const isSubmittingStore = isSubmittingStoreRef.current
  const pendingMessagesStoreRef = React.useRef<ValueStore<
    Array<PendingComposerMessage>
  > | null>(null)
  if (!pendingMessagesStoreRef.current) {
    pendingMessagesStoreRef.current = createValueStore<
      Array<PendingComposerMessage>
    >([])
  }
  const pendingMessagesStore = pendingMessagesStoreRef.current
  const [sessionDoneEvents, setSessionDoneEvents] = React.useState<
    Array<SessionDoneEvent>
  >([])
  const [recentDirectories, setRecentDirectories] = React.useState<
    Array<string>
  >([])
  const [sessionDoneSoundEnabled, setSessionDoneSoundEnabled] =
    React.useState(true)
  const [
    sessionDoneDesktopNotificationsEnabled,
    setSessionDoneDesktopNotificationsEnabled,
  ] = React.useState(true)
  const [desktopNotificationPermission, setDesktopNotificationPermission] =
    React.useState<DesktopNotificationPermission>("unsupported")
  const [storedDraftDirectory, setStoredDraftDirectory] = React.useState("")
  const { isMobile, openMobile, openMobileSettled, setOpenMobile } =
    useSidebar()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const composerPanelRef = React.useRef<ComposerPanelHandle | null>(null)
  const composerStoreRef =
    React.useRef<ValueStore<AppShellComposerSnapshot> | null>(null)
  if (!composerStoreRef.current) {
    composerStoreRef.current = createValueStore(
      createInitialAppShellComposerSnapshot(viewerContextId),
      shallowRecordEqual
    )
  }
  const composerStore = composerStoreRef.current
  const setComposerDraftSeed = React.useCallback<
    React.Dispatch<
      React.SetStateAction<{
        text: string
        skillName?: string
        syncNonce: number
      }>
    >
  >(
    (action) => {
      const current = composerDraftSeedStore.getSnapshot()
      const next = applySidebarStateAction(current, action)
      if (next === current) return
      composerDraftSeedStore.setSnapshot(next)
      const currentComposerSnapshot = composerStore.getSnapshot()
      composerStore.setSnapshot({
        ...currentComposerSnapshot,
        composerSkill: currentComposerSnapshot.disabled
          ? undefined
          : next.skillName,
        composerSyncNonce: next.syncNonce,
        composerText: currentComposerSnapshot.disabled ? "" : next.text,
      })
    },
    [composerDraftSeedStore, composerStore]
  )
  const setComposerImages = React.useCallback<
    React.Dispatch<React.SetStateAction<Array<PromptImage>>>
  >(
    (action) => {
      const current = composerImagesStore.getSnapshot()
      const next = applySidebarStateAction(current, action)
      if (next === current) return
      composerImagesRef.current = next
      composerImagesStore.setSnapshot(next)
      const currentComposerSnapshot = composerStore.getSnapshot()
      composerStore.setSnapshot({
        ...currentComposerSnapshot,
        composerImages: currentComposerSnapshot.disabled ? [] : next,
      })
    },
    [composerImagesStore, composerStore]
  )
  const commandPaletteRef = React.useRef<AppShellCommandPaletteHandle | null>(
    null
  )
  const commandPaletteOpenRef = React.useRef(false)
  const addDirectoryDialogRef =
    React.useRef<AppShellAddDirectoryDialogHandle | null>(null)
  const addDirectoryOpenRef = React.useRef(false)
  const renameDialogRef = React.useRef<RenameSessionDialogHandle | null>(null)
  const renameOpenRef = React.useRef(false)
  const deleteDialogRef = React.useRef<DeleteSessionsDialogHandle | null>(null)
  const deleteOpenRef = React.useRef(false)
  const forkDialogRef = React.useRef<ForkSessionDialogHandle | null>(null)
  const forkOpenRef = React.useRef(false)
  const treeDialogRef = React.useRef<AppShellTreeDialogHandle | null>(null)
  const treeOpenRef = React.useRef(false)
  const settingsDialogRef = React.useRef<AppShellSettingsDialogHandle | null>(
    null
  )
  const settingsOpenRef = React.useRef(false)
  const uiRequestDialogRef = React.useRef<AppShellUiRequestDialogHandle | null>(
    null
  )
  const uiRequestOpenRef = React.useRef(false)
  const conversationFrameRef =
    React.useRef<AppShellConversationFrameHandle | null>(null)
  const lastSyncedEditorTextRef = React.useRef("")
  const sessionStateRef = React.useRef(sessionState)
  const setSessionState = React.useCallback<
    React.Dispatch<React.SetStateAction<SessionState>>
  >(
    (action) => {
      const currentState = sessionStateRef.current
      const nextState =
        typeof action === "function"
          ? (action as (current: SessionState) => SessionState)(currentState)
          : action
      if (Object.is(currentState, nextState)) return

      sessionStateRef.current = nextState
      sessionStore.setSnapshot(nextState)
      setSessionStateState(nextState)
    },
    [sessionStore]
  )
  const composerTextRef = React.useRef(
    composerDraftSeedStore.getSnapshot().text
  )
  const composerSkillRef = React.useRef<string | undefined>(
    composerDraftSeedStore.getSnapshot().skillName
  )
  const pendingRouteSessionIdRef = React.useRef<string | undefined>(undefined)
  const pendingUiRequestHandlerRef = React.useRef(
    (_request: ExtensionUiEvent) => {}
  )
  pendingUiRequestHandlerRef.current = (request) => {
    uiRequestDialogRef.current?.open(request)
  }
  const autoAddedSessionDirectoryKeysRef = React.useRef<Set<string>>(new Set())
  const lastEscapePressedAtRef = React.useRef(0)
  const pendingMobileSidebarPromptFocusRef = React.useRef(false)
  const conversationItemsStoreRef = React.useRef<ConversationItemsStore | null>(
    null
  )
  if (!conversationItemsStoreRef.current) {
    conversationItemsStoreRef.current = createConversationItemsStore(
      sessionState.items
    )
  }
  const conversationItemsStore = conversationItemsStoreRef.current
  const hiddenThinkingPreviewStoreRef = React.useRef<TextValueStore | null>(
    null
  )
  if (!hiddenThinkingPreviewStoreRef.current) {
    hiddenThinkingPreviewStoreRef.current = createTextValueStore(
      sessionState.hiddenThinkingPreview || ""
    )
  }
  const hiddenThinkingPreviewStore = hiddenThinkingPreviewStoreRef.current
  const workingStateStoreRef =
    React.useRef<ValueStore<AppShellWorkingState | null> | null>(null)
  if (!workingStateStoreRef.current) {
    workingStateStoreRef.current =
      createValueStore<AppShellWorkingState | null>(null, sameWorkingState)
  }
  const workingStateStore = workingStateStoreRef.current
  const setAwaitingFirstTurn = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const current = awaitingFirstTurnStore.getSnapshot()
      const next = applySidebarStateAction(current, action)
      if (next === current) return
      awaitingFirstTurnStore.setSnapshot(next)
      const currentComposerSnapshot = composerStore.getSnapshot()
      composerStore.setSnapshot({
        ...currentComposerSnapshot,
        awaitingFirstTurn: currentComposerSnapshot.disabled ? false : next,
      })
      if (next && !sessionStateRef.current.streaming) {
        workingStateStore.setSnapshot({ label: "Waiting for first response…" })
      } else if (
        !next &&
        workingStateStore.getSnapshot()?.label === "Waiting for first response…"
      ) {
        workingStateStore.setSnapshot(null)
      }
    },
    [awaitingFirstTurnStore, composerStore, workingStateStore]
  )
  const setIsSubmitting = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const current = isSubmittingStore.getSnapshot()
      const next = applySidebarStateAction(current, action)
      if (next === current) return
      isSubmittingStore.setSnapshot(next)
      const currentComposerSnapshot = composerStore.getSnapshot()
      composerStore.setSnapshot({
        ...currentComposerSnapshot,
        isSubmitting: currentComposerSnapshot.disabled ? false : next,
      })
    },
    [composerStore, isSubmittingStore]
  )
  const refreshComposerPendingMessages = React.useCallback(() => {
    const pendingDraftFollowUpMessages = pendingDraftFollowUpsStore
      .getSnapshot()
      .map((message, index) => ({
        pendingId: message.optimisticId || `pending-draft:${index}`,
        text: message.message,
        images: message.images,
        streamingBehavior: message.streamingBehavior,
      }))
    const currentComposerSnapshot = composerStore.getSnapshot()
    composerStore.setSnapshot({
      ...currentComposerSnapshot,
      currentPendingMessages: currentComposerSnapshot.disabled
        ? []
        : [
            ...pendingDraftFollowUpMessages,
            ...pendingMessagesStore.getSnapshot(),
          ],
    })
  }, [composerStore, pendingDraftFollowUpsStore, pendingMessagesStore])
  const setPendingDraftPrompt = React.useCallback<
    React.Dispatch<
      React.SetStateAction<{
        ownerKey: string
        message: string
        images: Array<PromptImage>
        streamingBehavior?: StreamingBehavior
        optimisticId?: string
      } | null>
    >
  >(
    (action) => {
      const current = pendingDraftPromptStore.getSnapshot()
      const next = applySidebarStateAction(current, action)
      if (next === current) return
      pendingDraftPromptStore.setSnapshot(next)
      if (next) {
        workingStateStore.setSnapshot({ label: "Waiting for new session…" })
      } else if (
        workingStateStore.getSnapshot()?.label === "Waiting for new session…"
      ) {
        workingStateStore.setSnapshot(null)
      }
    },
    [pendingDraftPromptStore, workingStateStore]
  )
  const setPendingDraftFollowUps = React.useCallback<
    React.Dispatch<
      React.SetStateAction<
        Array<{
          message: string
          images: Array<PromptImage>
          streamingBehavior: "steer" | "followUp"
          optimisticId?: string
        }>
      >
    >
  >(
    (action) => {
      const current = pendingDraftFollowUpsStore.getSnapshot()
      const next = applySidebarStateAction(current, action)
      if (next === current) return
      pendingDraftFollowUpsStore.setSnapshot(next)
      refreshComposerPendingMessages()
    },
    [pendingDraftFollowUpsStore, refreshComposerPendingMessages]
  )
  const setPendingMessages = React.useCallback<
    React.Dispatch<React.SetStateAction<Array<PendingComposerMessage>>>
  >(
    (action) => {
      const current = pendingMessagesStore.getSnapshot()
      const next = applySidebarStateAction(current, action)
      if (next === current) return
      pendingMessagesStore.setSnapshot(next)
      refreshComposerPendingMessages()
    },
    [pendingMessagesStore, refreshComposerPendingMessages]
  )
  const setConversationItems = React.useCallback(
    (items: Array<ConversationItem>) => {
      conversationItemsStore.setItems(items)
    },
    [conversationItemsStore]
  )
  const setHiddenThinkingPreview = React.useCallback(
    (value: string) => {
      hiddenThinkingPreviewStore.setValue(value)
    },
    [hiddenThinkingPreviewStore]
  )
  const addOptimisticUserMessage = React.useCallback(
    (options: {
      message: string
      images: Array<PromptImage>
      queued: boolean
      streamingBehavior?: StreamingBehavior
    }) => {
      const pendingId = createOptimisticPendingId()
      const item = {
        kind: "user",
        itemKey: `pending:${pendingId}`,
        pendingId,
        text: options.message,
        images: options.images.map((image) => ({ ...image })),
        queued: options.queued,
        streamingBehavior: options.streamingBehavior,
      } satisfies UserConversationItem

      const currentState = sessionStateRef.current
      const nextItems = insertOptimisticUserItem(currentState.items, item)
      if (nextItems !== currentState.items) {
        const nextState = { ...currentState, items: nextItems }
        sessionStateRef.current = nextState
        conversationItemsStore.setItems(nextItems)
        setSessionState(nextState)
      }

      return pendingId
    },
    [conversationItemsStore]
  )
  const removeOptimisticUserMessage = React.useCallback(
    (pendingId: string | undefined) => {
      if (!pendingId) return

      const currentState = sessionStateRef.current
      const nextItems = removeOptimisticUserItem(currentState.items, pendingId)
      if (nextItems === currentState.items) return

      const nextState = { ...currentState, items: nextItems }
      sessionStateRef.current = nextState
      conversationItemsStore.setItems(nextItems)
      setSessionState(nextState)
    },
    [conversationItemsStore]
  )

  const { setTheme, theme } = useTheme()
  const currentTheme = normalizeThemeMode(theme)
  const sidebarWorkspaceVersion =
    useAppShellSidebarWorkspaceVersion(sidebarStore)
  void sidebarWorkspaceVersion
  const {
    baseSidebarDirectories,
    directoryStateByPath,
    directoryIndexes,
    sidebarSessions,
    selectedSidebarSessions,
    sidebarSessionEntriesByKey,
  } = sidebarStore.getWorkspaceSnapshot()
  const applySidebarSessionStatusRef = React.useRef(
    (status: SessionStatusEvent) => {
      sidebarStore.setSidebarSessionStatusByKey((current) =>
        mergeSidebarSessionStatusMap(current, status)
      )
    }
  )
  applySidebarSessionStatusRef.current = (status) => {
    sidebarStore.setSidebarSessionStatusByKey((current) =>
      mergeSidebarSessionStatusMap(current, status)
    )
  }
  const activeSessionId =
    sessionState.sessionId || (sessionState.sessionKey ? undefined : sessionId)
  const currentSessionQueryScope = sessionScrollKey(sessionState)
  const initialRouteLoadingSessionId =
    initialLoadingSessionId && !sessionState.sessionKey
      ? initialLoadingSessionId
      : null
  const activeLoadingSessionId =
    loadingSessionId && loadingSessionId !== sessionState.sessionId
      ? loadingSessionId
      : initialRouteLoadingSessionId &&
          initialRouteLoadingSessionId !== sessionState.sessionId
        ? initialRouteLoadingSessionId
        : null
  const isSessionViewLoading = Boolean(activeLoadingSessionId)
  const loadingSessionSummary = activeLoadingSessionId
    ? sidebarSessions.find((session) => session.id === activeLoadingSessionId)
    : undefined
  const currentSessionTitle = getSessionTitle({
    title:
      sessionState.sessionName || sessionState.firstMessage || "New session",
    name: sessionState.sessionName,
  })
  const loadingSessionTitle = getSessionTitle(loadingSessionSummary)
  const displaySessionTitle = isSessionViewLoading
    ? loadingSessionTitle !== "New session"
      ? loadingSessionTitle
      : "Loading session…"
    : currentSessionTitle
  const displaySessionCwd = isSessionViewLoading
    ? loadingSessionSummary?.cwd
    : sessionState.cwd
  React.useEffect(() => {
    const previousSessionId = previousRouteSessionIdRef.current
    previousRouteSessionIdRef.current = sessionId

    if (previousSessionId === sessionId) return

    setCurrentTab((tab) => (tab === "git" ? "session" : tab))

    if (!sessionId) {
      setInitialLoadingSessionId(null)
      setLoadingSessionId(null)
      return
    }

    if (sessionStateRef.current.sessionId !== sessionId) {
      setLoadingSessionId(sessionId)
    }
  }, [sessionId])

  React.useEffect(() => {
    sessionStateRef.current = sessionState
  }, [sessionState])

  React.useLayoutEffect(() => {
    conversationItemsStore.setItems(sessionStateRef.current.items)
  }, [conversationItemsStore, hideToolBlocks, sessionState.hideThinkingBlock])

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
    target = sessionStateRef.current,
    options?: {
      forceSync?: boolean
    }
  ) => {
    const parsed = parseComposerSkillMessage(value)
    const nextText = parsed.matched ? parsed.text : value
    const nextSkill = parsed.matched ? parsed.skillName : undefined

    composerTextRef.current = nextText
    composerSkillRef.current = nextSkill
    setComposerDraftSeed((current) => {
      const draftUnchanged =
        current.text === nextText && current.skillName === nextSkill

      if (draftUnchanged && !options?.forceSync) {
        return current
      }

      return {
        text: nextText,
        skillName: nextSkill,
        syncNonce: draftUnchanged ? current.syncNonce + 1 : current.syncNonce,
      }
    })
    rememberStoredPromptDraft(
      target,
      serializeComposerDraft({ text: nextText, skillName: nextSkill })
    )
  }
  const replaceComposerDraftRef = useLatestRef(replaceComposerDraft)

  React.useEffect(() => {
    setStoredDraftDirectory(readStoredDraftDirectory() || "")
    setSessionDoneSoundEnabled(readStoredSessionDoneSoundEnabled())
    setSessionDoneDesktopNotificationsEnabled(
      readStoredSessionDoneDesktopNotificationsEnabled()
    )
    setHideToolBlocks(readStoredHideToolBlocks())
    setCenterMessages(readStoredCenterMessages())
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
    settingsDialogRef.current?.close()
    commandPaletteRef.current?.open()
  }

  const openSettingsDialog = () => {
    commandPaletteRef.current?.close()
    settingsDialogRef.current?.open()
  }

  const openRenameDialog = () => {
    if (!sessionState.sessionFile) return
    renameDialogRef.current?.open({
      path: sessionState.sessionFile,
      title: sessionState.sessionName || currentSessionTitle,
    })
  }

  const openRenameDialogForEntry = (entry: SessionListEntry) => {
    renameDialogRef.current?.openForEntry(entry)
  }

  const openDeleteDialog = (targets: Array<SessionListEntry>) => {
    deleteDialogRef.current?.open(targets)
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

  const openAddDirectoryDialog = () => {
    addDirectoryDialogRef.current?.open()
  }

  const openForkDialog = async () => {
    await forkDialogRef.current?.open()
  }

  const openTreeDialog = async () => {
    await treeDialogRef.current?.open()
  }

  const focusSessionSearch = () => {
    sessionSearchInputRef.current?.focus()
    sessionSearchInputRef.current?.select()
  }

  const focusPrompt = () => {
    if (currentTab !== "session") {
      setCurrentTab("session")
    }

    if (isMobile && (openMobile || openMobileSettled)) {
      pendingMobileSidebarPromptFocusRef.current = true
      if (openMobile) {
        setOpenMobile(false)
      }
      return
    }

    window.requestAnimationFrame(() => {
      composerPanelRef.current?.focusPrompt({ preventScroll: true })
    })
  }

  const focusModelSelector = () => {
    composerPanelRef.current?.openModelPicker()
  }
  const focusPromptRef = useLatestRef(focusPrompt)

  React.useEffect(() => {
    if (
      !pendingMobileSidebarPromptFocusRef.current ||
      openMobile ||
      openMobileSettled
    ) {
      return
    }

    pendingMobileSidebarPromptFocusRef.current = false
    const timeoutId = window.setTimeout(() => {
      focusPromptRef.current()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [focusPromptRef, openMobile, openMobileSettled])

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

  const handleSelectSession = React.useCallback(
    (nextSessionId?: string, options?: SelectSessionNavigationOptions) => {
      setCurrentTab((tab) => (tab === "git" ? "session" : tab))

      pendingRouteSessionIdRef.current = nextSessionId
      setLoadingSessionId((current) => {
        if (!nextSessionId) {
          return null
        }
        if (
          !sessionStateRef.current.draft &&
          sessionStateRef.current.sessionId === nextSessionId
        ) {
          return current
        }
        return nextSessionId
      })
      onSelectSession?.(nextSessionId, options)
    },
    [onSelectSession, sessionStateRef]
  )
  const handleSelectSessionRef = useLatestRef(handleSelectSession)

  useAppShellSessionSync({
    viewerContextId,
    sessionId,
    draftSessionLoadingOwnerKey,
    bootstrapSidebarDirectories:
      sidebarStore.getSnapshot().state.initialSidebarBootstrapDirectories,
    hideToolBlocks,
    sessionState,
    sessionStateRef,
    setConnected: sidebarStore.setConnected,
    composerTextRef,
    composerSkillRef,
    replaceComposerDraftRef,
    handleSelectSessionRef,
    pendingRouteSessionIdRef,
    setSessionState,
    setConversationItems,
    setHiddenThinkingPreview,
    setSessionsEvent: sidebarStore.setSessionsEvent,
    setSessionDoneEvents,
    applySidebarSessionStatusRef,
    setComposerImages,
    setPendingMessages,
    pendingUiRequestHandlerRef,
    lastSyncedEditorTextRef,
  })

  React.useEffect(() => {
    if (!loadingSessionId) return
    if (sessionState.sessionId === loadingSessionId) {
      setLoadingSessionId(null)
    }
  }, [loadingSessionId, sessionState.sessionId])

  React.useEffect(() => {
    if (!initialLoadingSessionId) return
    if (
      sessionState.sessionKey ||
      sessionState.sessionId === initialLoadingSessionId
    ) {
      setInitialLoadingSessionId(null)
    }
  }, [initialLoadingSessionId, sessionState.sessionId, sessionState.sessionKey])

  React.useEffect(() => {
    const nextDirectory = sessionState.cwd?.trim()
    if (!nextDirectory) return
    safeLocalStorageSetItem(DRAFT_DIRECTORY_STORAGE_KEY, nextDirectory)
    setStoredDraftDirectory(nextDirectory)
  }, [sessionState.cwd])

  React.useEffect(() => {
    const nextDirectory = sessionState.cwd?.trim()
    const nextSessionId = sessionState.sessionId?.trim()
    if (!sessionId || !nextSessionId || sessionState.draft || !nextDirectory) {
      return
    }
    if (nextSessionId !== sessionId) return

    const autoAddKey = `${nextSessionId}\n${nextDirectory}`
    if (autoAddedSessionDirectoryKeysRef.current.has(autoAddKey)) return
    autoAddedSessionDirectoryKeysRef.current.add(autoAddKey)

    sidebarStore.setSidebarDirectories((current) => {
      const normalizedCurrent = normalizeStoredDirectoryList(current)
      if (normalizedCurrent.includes(nextDirectory)) return current

      const nextDirectories = normalizeStoredDirectoryList([
        nextDirectory,
        ...normalizedCurrent,
      ])
      safeLocalStorageSetItem(
        SIDEBAR_DIRECTORIES_STORAGE_KEY,
        JSON.stringify(nextDirectories)
      )
      return nextDirectories
    })
  }, [
    sessionId,
    sessionState.cwd,
    sessionState.draft,
    sessionState.sessionId,
    sidebarStore,
  ])

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
        ...baseSidebarDirectories,
        sessionState.cwd || "",
        ...Array.from(directoryStateByPath.keys()),
        ...Object.values(directoryIndexes).flatMap((entries) =>
          entries.map((entry) => entry.cwd || "")
        ),
      ]),
    [
      baseSidebarDirectories,
      directoryIndexes,
      directoryStateByPath,
      sessionState.cwd,
    ]
  )

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

  const prefetchDirectorySessionsIndex = React.useCallback(
    (_directory: string) => {},
    []
  )

  const clearSelectedSidebarSelection = React.useCallback(() => {
    sidebarStore.setSelectedSidebarSessionKeys((current) =>
      current.length === 0 ? current : []
    )
    sidebarStore.setSidebarSessionSelectionAnchor((current) =>
      current ? "" : current
    )
  }, [sidebarStore])

  const awaitingFirstTurn = awaitingFirstTurnStore.getSnapshot()
  const isSubmitting = isSubmittingStore.getSnapshot()
  const pendingDraftPrompt = pendingDraftPromptStore.getSnapshot()
  const pendingDraftFollowUps = pendingDraftFollowUpsStore.getSnapshot()
  const pendingMessages = pendingMessagesStore.getSnapshot()

  const {
    abortSession,
    addDirectoryPath,
    createSession: requestCreateSession,
    removePendingMessage,
    reorderPending,
    submitPrompt,
  } = useAppShellPromptMutations({
    viewerContextId,
    activeSessionId,
    defaultNewSessionDirectory,
    sessionState,
    draftSessionLoadingOwnerKey,
    pendingDraftPrompt,
    pendingDraftFollowUps,
    awaitingFirstTurn,
    pendingMessages,
    composerImagesRef,
    composerTextRef,
    composerSkillRef,
    replaceComposerDraft,
    lastSyncedEditorTextRef,
    rememberRecentDirectory,
    prefetchDirectorySessionsIndex,
    addOptimisticUserMessage,
    removeOptimisticUserMessage,
    setSidebarDirectories: sidebarStore.setSidebarDirectories,
    setStoredDraftDirectory,
    setDraftSessionLoadingOwnerKey,
    setPendingDraftPrompt,
    setPendingDraftFollowUps,
    setPendingMessages,
    setAwaitingFirstTurn,
    setIsSubmitting,
    setComposerImages,
  })

  const createSession = React.useCallback(
    async (cwdOverride?: string, options?: CreateSessionOptions) => {
      const nextCwd = cwdOverride || defaultNewSessionDirectory || undefined
      const ownerKey = promptDraftKey({ cwd: nextCwd })
      const optimisticSessionKey = `optimistic:${ownerKey}`
      const previousState = sessionStateRef.current
      const shouldCloseMobileSidebar =
        Boolean(options?.closeMobileSidebar) && isMobile && openMobile

      pendingRouteSessionIdRef.current = undefined
      setLoadingSessionId(null)
      setCurrentTab((tab) => (tab === "git" ? "session" : tab))
      clearSelectedSidebarSelection()
      if (shouldCloseMobileSidebar) {
        pendingMobileSidebarPromptFocusRef.current = true
        setOpenMobile(false)
      } else {
        focusPrompt()
      }
      setAwaitingFirstTurn(false)
      setPendingMessages((current) => (current.length === 0 ? current : []))
      const nextState = createOptimisticDraftSessionState({
        previous: previousState,
        cwd: nextCwd,
        ownerKey,
      })
      sessionStateRef.current = nextState
      conversationItemsStore.setItems(nextState.items)
      setSessionState(nextState)

      const created = await requestCreateSession(cwdOverride)
      if (created) {
        return
      }

      if (sessionStateRef.current.sessionKey !== optimisticSessionKey) {
        return
      }

      sessionStateRef.current = previousState
      conversationItemsStore.setItems(previousState.items)
      setSessionState(previousState)
    },
    [
      clearSelectedSidebarSelection,
      conversationItemsStore,
      defaultNewSessionDirectory,
      focusPrompt,
      isMobile,
      openMobile,
      requestCreateSession,
      sessionStateRef,
      setAwaitingFirstTurn,
      setOpenMobile,
      setPendingMessages,
      setSessionState,
    ]
  )

  const onPickImages = async (files: FileList | Array<File> | null) => {
    if (!files || files.length === 0) return
    const imageFiles = Array.from(files).filter((file) =>
      file.type.startsWith("image/")
    )
    if (imageFiles.length === 0) return

    const nextImages = await Promise.all(
      imageFiles.slice(0, 8).map((file) => readFileAsPromptImage(file))
    )
    setComposerImages((current) => [...current, ...nextImages].slice(0, 8))
  }

  const composerDraftSeed = composerDraftSeedStore.getSnapshot()
  const composerImages = composerImagesStore.getSnapshot()
  const pendingDraftFollowUpMessages = pendingDraftFollowUps.map(
    (message, index) => ({
      pendingId: message.optimisticId || `pending-draft:${index}`,
      text: message.message,
      images: message.images,
      streamingBehavior: message.streamingBehavior,
    })
  )
  const currentPendingMessages = [
    ...pendingDraftFollowUpMessages,
    ...pendingMessages,
  ]
  const composerDisabled = isSessionViewLoading
  const displayedPendingMessages = composerDisabled
    ? []
    : currentPendingMessages
  const displayedComposerImages = composerDisabled ? [] : composerImages
  const displayedComposerText = composerDisabled ? "" : composerDraftSeed.text
  const displayedComposerSkill = composerDisabled
    ? undefined
    : composerDraftSeed.skillName

  const removePendingDraftFollowUp = (pendingId: string) => {
    if (
      !pendingDraftFollowUps.some(
        (message, index) =>
          (message.optimisticId || `pending-draft:${index}`) === pendingId
      )
    ) {
      return false
    }

    setPendingDraftFollowUps((current) =>
      current.filter(
        (message, index) =>
          (message.optimisticId || `pending-draft:${index}`) !== pendingId
      )
    )
    return true
  }

  const reorderPendingDraftFollowUp = (
    pendingId: string,
    direction: -1 | 1
  ) => {
    const index = pendingDraftFollowUps.findIndex(
      (message, messageIndex) =>
        (message.optimisticId || `pending-draft:${messageIndex}`) === pendingId
    )
    if (index === -1) return false

    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= pendingDraftFollowUps.length) {
      return false
    }

    setPendingDraftFollowUps((current) => {
      const next = [...current]
      const [item] = next.splice(index, 1)
      if (!item) return current
      next.splice(targetIndex, 0, item)
      return next
    })
    return true
  }

  const {
    cycleThinkingLevel,
    deleteSessions,
    renameSessionPath,
    runCompact,
    setModel,
    setThinkingBlocksHidden,
    setThinkingLevel,
    toggleHideThinking,
  } = useAppShellSessionMutations({
    viewerContextId,
    activeSessionId,
    sessionStateRef,
    setSelectedSidebarSessionKeys: sidebarStore.setSelectedSidebarSessionKeys,
    setSidebarSessionSelectionAnchor:
      sidebarStore.setSidebarSessionSelectionAnchor,
    setRunningSlashCommand,
  })

  const setToolBlocksHidden = (hidden: boolean) => {
    setHideToolBlocks(hidden)
    safeLocalStorageSetItem(HIDE_TOOL_BLOCKS_STORAGE_KEY, hidden ? "1" : "0")
  }

  const toggleHideToolBlocks = () => {
    setToolBlocksHidden(!hideToolBlocks)
    toast.info(hideToolBlocks ? "Tools shown" : "Tools hidden")
  }

  const setMessagesCentered = (centered: boolean) => {
    setCenterMessages(centered)
    safeLocalStorageSetItem(CENTER_MESSAGES_STORAGE_KEY, centered ? "1" : "0")
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
        await renameSessionPath(sessionState.sessionFile, trimmedArgs)
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

  const composerSnapshot = {
    activeSessionId,
    awaitingFirstTurn: composerDisabled ? false : awaitingFirstTurn,
    availableModels: sessionState.availableModels,
    availableThinkingLevels: sessionState.availableThinkingLevels,
    centerMessages,
    composerImages: displayedComposerImages,
    composerSkill: displayedComposerSkill,
    composerSyncNonce: composerDraftSeed.syncNonce,
    composerText: displayedComposerText,
    contextUsage: composerDisabled ? undefined : sessionState.contextUsage,
    currentPendingMessages: displayedPendingMessages,
    disabled: composerDisabled,
    isStreaming: composerDisabled ? false : sessionState.streaming,
    isSubmitting: composerDisabled ? false : isSubmitting,
    model: sessionState.model,
    slashCommands,
    thinkingLevel: sessionState.thinkingLevel,
    viewerContextId,
  } satisfies AppShellComposerSnapshot

  React.useLayoutEffect(() => {
    composerStore.setSnapshot(composerSnapshot)
  })

  const composerActionsRef = useLatestRef<AppShellComposerActions>({
    abortSession,
    onPickImages,
    onRemoveComposerImage: (index) => {
      setComposerImages((current) =>
        current.filter((_, imageIndex) => imageIndex !== index)
      )
    },
    removePendingDraftFollowUp,
    removePendingMessage,
    reorderPending,
    reorderPendingDraftFollowUp,
    runBuiltinSlashCommand,
    setModel,
    setThinkingLevel,
    submitPrompt,
    syncComposerDraft,
  })

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
      }
    }

    return null
  })()

  React.useLayoutEffect(() => {
    workingStateStore.setSnapshot(workingState)
  })

  const commandPaletteStateRef = useLatestRef({
    currentSessionTitle,
    hasAvailableModels: sessionState.availableModels.length > 0,
    hideThinkingBlock: sessionState.hideThinkingBlock,
    hideToolBlocks,
    selectedSidebarSessions,
    sessionFile: sessionState.sessionFile,
    thinkingLevel: sessionState.thinkingLevel,
  })

  const buildCommandPaletteCommands = () => {
    const commandState = commandPaletteStateRef.current
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
        id: "focus-prompt",
        group: "Assistant",
        title: "Focus prompt",
        description: "Move focus to the prompt field",
        shortcut: "Ctrl+Enter",
        keywords: ["prompt", "composer", "input", "message", "reply"],
        onSelect: focusPrompt,
      },
      {
        id: "set-model",
        group: "Assistant",
        title: "Set model",
        description: "Open the model picker",
        shortcut: "Ctrl+M",
        keywords: ["model", "provider", "picker", "choose"],
        onSelect: () => {
          if (!commandPaletteStateRef.current.hasAvailableModels) {
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
        title: commandState.hideThinkingBlock
          ? "Show thinking blocks"
          : "Hide thinking blocks",
        description: commandState.hideThinkingBlock
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
        description: `Current level: ${commandState.thinkingLevel}`,
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
        description: `Current level: ${commandState.thinkingLevel}`,
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
        title: commandState.hideToolBlocks
          ? "Show tool calls"
          : "Hide tool calls",
        description: commandState.hideToolBlocks
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

    if (commandState.sessionFile) {
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
        description: `Delete ${commandState.currentSessionTitle}`,
        shortcut: "Ctrl+X",
        keywords: ["delete", "remove", "session"],
        onSelect: openDeleteDialogForCurrentSession,
      })
    }

    if (commandState.selectedSidebarSessions.length > 0) {
      commands.push({
        id: "clear-selected-sessions",
        group: "Sidebar",
        title: "Clear selected sidebar sessions",
        description: `Clear ${commandState.selectedSidebarSessions.length} selected sidebar ${commandState.selectedSidebarSessions.length === 1 ? "session" : "sessions"}`,
        keywords: ["clear", "selected", "sidebar", "sessions"],
        onSelect: clearSelectedSidebarSelection,
      })
      commands.push({
        id: "delete-selected-sessions",
        group: "Sidebar",
        title: "Delete selected sidebar sessions",
        description: `Delete ${commandState.selectedSidebarSessions.length} selected sidebar ${commandState.selectedSidebarSessions.length === 1 ? "session" : "sessions"}`,
        keywords: ["delete", "selected", "sidebar", "sessions"],
        onSelect: () => {
          openDeleteDialog(
            commandPaletteStateRef.current.selectedSidebarSessions
          )
        },
      })
    }

    return commands
  }
  const commandPaletteCommandsRef = useLatestRef(buildCommandPaletteCommands)

  const shortcutActionsRef = useLatestRef({
    createSession,
    focusModelSelector,
    focusPrompt,
    focusSessionSearch,
    jumpToNextMessage: () => {
      conversationFrameRef.current?.jumpToNextMessage()
    },
    jumpToPreviousMessage: () => {
      conversationFrameRef.current?.jumpToPreviousMessage()
    },
    openAddDirectoryDialog,
    openCommandPalette,
    openDeleteDialog,
    openDeleteDialogForCurrentSession,
    openForkDialog,
    openRenameDialog,
    openSettingsDialog,
    openTreeDialog,
    runCompact,
    scrollConversationToBottom: () => {
      conversationFrameRef.current?.scrollConversationToBottom()
    },
    scrollConversationToTop: () => {
      conversationFrameRef.current?.scrollConversationToTop()
    },
    toggleHideThinking,
    toggleHideToolBlocks,
    cycleThinkingLevel,
  })

  const shortcutStateRef = useLatestRef<AppShellShortcutState>({
    currentTab,
    selectedSidebarSessions,
    sessionHasAvailableModels: sessionState.availableModels.length > 0,
    sessionHasFile: Boolean(sessionState.sessionFile),
    sidebarSessionEntriesByKey,
  })
  const sessionHeaderActionsRef = useLatestRef<AppShellSessionHeaderActions>({
    createSession,
    onDeleteCurrentSession: openDeleteDialogForCurrentSession,
    onForkSession: openForkDialog,
    onRenameSession: openRenameDialog,
    onRunCompact: runCompact,
    onToggleHideThinking: toggleHideThinking,
    onToggleHideToolBlocks: toggleHideToolBlocks,
    onTreeSession: openTreeDialog,
  })

  useAppShellShortcuts({
    addDirectoryOpenRef,
    commandPaletteOpenRef,
    deleteOpenRef,
    forkOpenRef,
    pendingUiRequestOpenRef: uiRequestOpenRef,
    lastEscapePressedAtRef,
    renameOpenRef,
    sessionSearchInputRef,
    settingsOpenRef,
    shortcutActionsRef,
    shortcutStateRef,
    treeOpenRef,
  })

  React.useImperativeHandle(
    ref,
    () => ({
      createSession,
      openAddDirectoryDialog,
      openCommandPalette,
      openDeleteDialog,
      openRenameDialogForEntry,
      openSettingsDialog,
      selectSession: handleSelectSession,
    }),
    [
      createSession,
      handleSelectSession,
      openAddDirectoryDialog,
      openCommandPalette,
      openDeleteDialog,
      openRenameDialogForEntry,
      openSettingsDialog,
    ]
  )

  return (
    <>
      <AppShellWindowEffectsHost
        currentSessionTitle={currentSessionTitle}
        displaySessionTitle={displaySessionTitle}
        isSessionViewLoading={isSessionViewLoading}
        sessionDoneDesktopNotificationsEnabled={
          sessionDoneDesktopNotificationsEnabled
        }
        sessionDoneSoundEnabled={sessionDoneSoundEnabled}
        sessionDoneEvents={sessionDoneEvents}
        sessionStore={sessionStore}
        sidebarStore={sidebarStore}
        onConsumeSessionDoneEvents={(ids) => {
          const consumedIds = new Set(ids)
          setSessionDoneEvents((current) =>
            current.filter((event) => !consumedIds.has(event.id))
          )
        }}
        onSelectSession={handleSelectSession}
      />

      <SidebarInset className="min-h-0 overflow-hidden">
        <AppShellSessionHeader
          actionsRef={sessionHeaderActionsRef}
          defaultNewSessionDirectory={defaultNewSessionDirectory}
          displaySessionCwd={displaySessionCwd}
          displaySessionTitle={displaySessionTitle}
          hideToolBlocks={hideToolBlocks}
          isSessionViewLoading={isSessionViewLoading}
          newSessionDirectoryOptions={newSessionDirectoryOptions}
          sessionStore={sessionStore}
          viewerContextId={viewerContextId}
        />

        <Tabs
          value={currentTab}
          onValueChange={setCurrentTab}
          className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
        >
          <AppShellTabsList
            viewerContextId={viewerContextId}
            sessionStore={sessionStore}
          />

          <TabsContent
            value="session"
            keepMounted
            className="flex min-h-0 flex-1 flex-col"
          >
            <AppShellSessionConversation
              awaitingFirstTurn={awaitingFirstTurn}
              centerMessages={centerMessages}
              conversationFrameRef={conversationFrameRef}
              conversationItemsStore={conversationItemsStore}
              hiddenThinkingPreviewStore={hiddenThinkingPreviewStore}
              hideThinking={sessionState.hideThinkingBlock}
              hideToolBlocks={hideToolBlocks}
              isSessionViewLoading={isSessionViewLoading}
              isSubmitting={isSubmitting}
              onCreateSession={() => {
                void createSession()
              }}
              sessionStore={sessionStore}
              viewerContextId={viewerContextId}
              workingStateStore={workingStateStore}
            />

            <AppShellComposerController
              actionsRef={composerActionsRef}
              composerPanelRef={composerPanelRef}
              fileInputRef={fileInputRef}
              store={composerStore}
            />
          </TabsContent>

          <TabsContent
            value="git"
            className="min-h-0 flex-1 space-y-4 overflow-auto p-6"
          >
            <AppShellGitPanelController
              viewerContextId={viewerContextId}
              sessionStore={sessionStore}
              active={currentTab === "git"}
            />
          </TabsContent>
        </Tabs>
      </SidebarInset>

      <AppShellFloatingControllers
        activeSessionId={activeSessionId}
        addDirectoryDialogRef={addDirectoryDialogRef}
        addDirectoryOpenRef={addDirectoryOpenRef}
        addDirectoryPath={addDirectoryPath}
        baseSidebarDirectories={baseSidebarDirectories}
        centerMessages={centerMessages}
        commandPaletteCommandsRef={commandPaletteCommandsRef}
        commandPaletteOpenRef={commandPaletteOpenRef}
        commandPaletteRef={commandPaletteRef}
        currentSessionQueryScope={currentSessionQueryScope}
        currentTheme={currentTheme}
        deleteDialogRef={deleteDialogRef}
        deleteOpenRef={deleteOpenRef}
        deleteSessions={deleteSessions}
        desktopNotificationPermission={desktopNotificationPermission}
        forkDialogRef={forkDialogRef}
        forkOpenRef={forkOpenRef}
        hideThinkingBlocks={sessionState.hideThinkingBlock}
        hideToolBlocks={hideToolBlocks}
        knownDirectories={knownDirectories}
        onCenterMessagesChange={setMessagesCentered}
        onHideThinkingBlocksChange={(hidden) => {
          void setThinkingBlocksHidden(hidden)
        }}
        onHideToolBlocksChange={setToolBlocksHidden}
        onSessionDoneDesktopNotificationsEnabledChange={
          handleSessionDoneDesktopNotificationsEnabledChange
        }
        onSessionDoneSoundEnabledChange={handleSessionDoneSoundEnabledChange}
        onThemeChange={handleThemeChange}
        recentDirectories={recentDirectories}
        renameDialogRef={renameDialogRef}
        renameOpenRef={renameOpenRef}
        renameSessionPath={renameSessionPath}
        sessionCwd={sessionState.cwd}
        sessionDoneDesktopNotificationsEnabled={
          sessionDoneDesktopNotificationsEnabled
        }
        sessionDoneSoundEnabled={sessionDoneSoundEnabled}
        settingsDialogRef={settingsDialogRef}
        settingsOpenRef={settingsOpenRef}
        treeDialogRef={treeDialogRef}
        treeOpenRef={treeOpenRef}
        treeSummaryAvailable={treeSummaryAvailable}
        uiRequestDialogRef={uiRequestDialogRef}
        uiRequestOpenRef={uiRequestOpenRef}
        viewerContextId={viewerContextId}
      />
    </>
  )
})

type AppShellSessionHeaderActions = {
  createSession: (cwdOverride?: string) => void | Promise<unknown>
  onDeleteCurrentSession: () => void
  onForkSession: () => void | Promise<unknown>
  onRenameSession: () => void
  onRunCompact: () => void | Promise<unknown>
  onToggleHideThinking: () => void | Promise<unknown>
  onToggleHideToolBlocks: () => void
  onTreeSession: () => void | Promise<unknown>
}

type AppShellSessionHeaderProps = {
  actionsRef: React.MutableRefObject<AppShellSessionHeaderActions>
  defaultNewSessionDirectory: string
  displaySessionCwd?: string
  displaySessionTitle: string
  hideToolBlocks: boolean
  isSessionViewLoading: boolean
  newSessionDirectoryOptions: Array<{ path: string; label: string }>
  sessionStore: ValueStore<SessionState>
  viewerContextId: string
}

const AppShellSessionHeader = React.memo(function AppShellSessionHeader({
  actionsRef,
  defaultNewSessionDirectory,
  displaySessionCwd,
  displaySessionTitle,
  hideToolBlocks,
  isSessionViewLoading,
  newSessionDirectoryOptions,
  sessionStore,
  viewerContextId,
}: AppShellSessionHeaderProps) {
  const sessionHeaderState = useSelectedValueStore(
    sessionStore,
    (sessionState) => ({
      hideThinkingBlock: sessionState.hideThinkingBlock,
      sessionDraft: sessionState.draft,
      sessionHasFile: Boolean(sessionState.sessionFile),
      sessionStreaming: sessionState.streaming,
    }),
    shallowRecordEqual
  )

  return (
    <div className="shrink-0 border-b border-border/70 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <SidebarTrigger className="mt-0.5 shrink-0" />
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 items-center gap-1.5">
              {!isSessionViewLoading && sessionHeaderState.sessionStreaming ? (
                <Spinner
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-label="Session streaming"
                />
              ) : null}
              <h2
                className="min-w-0 truncate text-[15px] leading-tight font-semibold"
                title={displaySessionTitle}
              >
                {displaySessionTitle}
              </h2>
              {!isSessionViewLoading && sessionHeaderState.sessionDraft ? (
                <Badge variant="outline">Draft</Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {displaySessionCwd ? (
                <span>{formatDisplayPath(displaySessionCwd)}</span>
              ) : null}
              <HeaderGitStatusText
                viewerContextId={viewerContextId}
                cwd={displaySessionCwd}
              />
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
                  void actionsRef.current.createSession()
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
                          void actionsRef.current.createSession(option.path)
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
                          <DropdownMenuShortcut>Default</DropdownMenuShortcut>
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  void actionsRef.current.onRunCompact()
                }}
              >
                <span>Compact session</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void actionsRef.current.onTreeSession()
                }}
              >
                <span>Tree</span>
                <DropdownMenuShortcut>Ctrl+T</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void actionsRef.current.onForkSession()
                }}
              >
                <span>Fork</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  void actionsRef.current.onToggleHideThinking()
                }}
              >
                <span>
                  {sessionHeaderState.hideThinkingBlock
                    ? "Show thinking"
                    : "Hide thinking"}
                </span>
                <DropdownMenuShortcut>Ctrl+G</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  actionsRef.current.onToggleHideToolBlocks()
                }}
              >
                <span>{hideToolBlocks ? "Show tools" : "Hide tools"}</span>
                <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!sessionHeaderState.sessionHasFile}
                onClick={() => {
                  actionsRef.current.onRenameSession()
                }}
              >
                <span>Rename session</span>
                <DropdownMenuShortcut>Ctrl+E</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={!sessionHeaderState.sessionHasFile}
                onClick={() => {
                  actionsRef.current.onDeleteCurrentSession()
                }}
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
              void actionsRef.current.createSession()
            }}
          >
            <SquarePenIcon />
          </Button>
        </div>
      </div>
    </div>
  )
})

type AppShellFloatingControllersProps = {
  activeSessionId?: string
  addDirectoryDialogRef: React.RefObject<AppShellAddDirectoryDialogHandle | null>
  addDirectoryOpenRef: React.MutableRefObject<boolean>
  addDirectoryPath: React.ComponentProps<
    typeof AppShellAddDirectoryDialogController
  >["onAddDirectoryPath"]
  baseSidebarDirectories: Array<string>
  centerMessages: boolean
  commandPaletteCommandsRef: React.MutableRefObject<() => Array<AppCommand>>
  commandPaletteOpenRef: React.MutableRefObject<boolean>
  commandPaletteRef: React.RefObject<AppShellCommandPaletteHandle | null>
  currentSessionQueryScope: string
  currentTheme: ThemeMode
  deleteDialogRef: React.RefObject<DeleteSessionsDialogHandle | null>
  deleteOpenRef: React.MutableRefObject<boolean>
  deleteSessions: React.ComponentProps<
    typeof DeleteSessionsDialogController
  >["onDeleteSession"]
  desktopNotificationPermission: DesktopNotificationPermission
  forkDialogRef: React.RefObject<ForkSessionDialogHandle | null>
  forkOpenRef: React.MutableRefObject<boolean>
  hideThinkingBlocks: boolean
  hideToolBlocks: boolean
  knownDirectories: Array<string>
  onCenterMessagesChange: (centered: boolean) => void
  onHideThinkingBlocksChange: (hidden: boolean) => void
  onHideToolBlocksChange: (hidden: boolean) => void
  onSessionDoneDesktopNotificationsEnabledChange: (enabled: boolean) => void
  onSessionDoneSoundEnabledChange: (enabled: boolean) => void
  onThemeChange: (value: ThemeMode) => void
  recentDirectories: Array<string>
  renameDialogRef: React.RefObject<RenameSessionDialogHandle | null>
  renameOpenRef: React.MutableRefObject<boolean>
  renameSessionPath: React.ComponentProps<
    typeof RenameSessionDialogController
  >["onRenameSession"]
  sessionCwd?: string
  sessionDoneDesktopNotificationsEnabled: boolean
  sessionDoneSoundEnabled: boolean
  settingsDialogRef: React.RefObject<AppShellSettingsDialogHandle | null>
  settingsOpenRef: React.MutableRefObject<boolean>
  treeDialogRef: React.RefObject<AppShellTreeDialogHandle | null>
  treeOpenRef: React.MutableRefObject<boolean>
  treeSummaryAvailable: boolean
  uiRequestDialogRef: React.RefObject<AppShellUiRequestDialogHandle | null>
  uiRequestOpenRef: React.MutableRefObject<boolean>
  viewerContextId: string
}

const AppShellCommandPaletteHost = React.memo(
  function AppShellCommandPaletteHost({
    commandPaletteCommandsRef,
    commandPaletteOpenRef,
    commandPaletteRef,
  }: Pick<
    AppShellFloatingControllersProps,
    "commandPaletteCommandsRef" | "commandPaletteOpenRef" | "commandPaletteRef"
  >) {
    return (
      <AppShellCommandPaletteController
        ref={commandPaletteRef}
        openStateRef={commandPaletteOpenRef}
        getCommandsRef={commandPaletteCommandsRef}
        onCommandError={(error) => {
          toast.error(
            error instanceof Error ? error.message : "Failed to run command"
          )
        }}
      />
    )
  }
)

const AppShellAddDirectoryDialogHost = React.memo(
  function AppShellAddDirectoryDialogHost({
    addDirectoryDialogRef,
    addDirectoryOpenRef,
    addDirectoryPath,
    baseSidebarDirectories,
    knownDirectories,
    recentDirectories,
    sessionCwd,
  }: Pick<
    AppShellFloatingControllersProps,
    | "addDirectoryDialogRef"
    | "addDirectoryOpenRef"
    | "addDirectoryPath"
    | "baseSidebarDirectories"
    | "knownDirectories"
    | "recentDirectories"
    | "sessionCwd"
  >) {
    return (
      <AppShellAddDirectoryDialogController
        ref={addDirectoryDialogRef}
        openStateRef={addDirectoryOpenRef}
        openedDirectories={baseSidebarDirectories}
        currentDirectory={sessionCwd}
        recentDirectories={recentDirectories}
        knownDirectories={knownDirectories}
        onAddDirectoryPath={addDirectoryPath}
      />
    )
  }
)

const AppShellRenameSessionDialogHost = React.memo(
  function AppShellRenameSessionDialogHost({
    renameDialogRef,
    renameOpenRef,
    renameSessionPath,
  }: Pick<
    AppShellFloatingControllersProps,
    "renameDialogRef" | "renameOpenRef" | "renameSessionPath"
  >) {
    return (
      <RenameSessionDialogController
        ref={renameDialogRef}
        openStateRef={renameOpenRef}
        onRenameSession={renameSessionPath}
      />
    )
  }
)

const AppShellDeleteSessionsDialogHost = React.memo(
  function AppShellDeleteSessionsDialogHost({
    deleteDialogRef,
    deleteOpenRef,
    deleteSessions,
  }: Pick<
    AppShellFloatingControllersProps,
    "deleteDialogRef" | "deleteOpenRef" | "deleteSessions"
  >) {
    return (
      <DeleteSessionsDialogController
        ref={deleteDialogRef}
        openStateRef={deleteOpenRef}
        onDeleteSession={deleteSessions}
      />
    )
  }
)

const AppShellForkSessionDialogHost = React.memo(
  function AppShellForkSessionDialogHost({
    activeSessionId,
    currentSessionQueryScope,
    forkDialogRef,
    forkOpenRef,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "activeSessionId"
    | "currentSessionQueryScope"
    | "forkDialogRef"
    | "forkOpenRef"
    | "viewerContextId"
  >) {
    return (
      <ForkSessionDialogController
        ref={forkDialogRef}
        openStateRef={forkOpenRef}
        viewerContextId={viewerContextId}
        sessionScopeKey={currentSessionQueryScope}
        sessionId={activeSessionId}
      />
    )
  }
)

const AppShellTreeDialogHost = React.memo(function AppShellTreeDialogHost({
  activeSessionId,
  currentSessionQueryScope,
  treeDialogRef,
  treeOpenRef,
  treeSummaryAvailable,
  viewerContextId,
}: Pick<
  AppShellFloatingControllersProps,
  | "activeSessionId"
  | "currentSessionQueryScope"
  | "treeDialogRef"
  | "treeOpenRef"
  | "treeSummaryAvailable"
  | "viewerContextId"
>) {
  return (
    <AppShellTreeDialogController
      ref={treeDialogRef}
      openStateRef={treeOpenRef}
      viewerContextId={viewerContextId}
      sessionScopeKey={currentSessionQueryScope}
      sessionId={activeSessionId}
      treeSummaryAvailable={treeSummaryAvailable}
    />
  )
})

const AppShellSettingsDialogHost = React.memo(
  function AppShellSettingsDialogHost({
    centerMessages,
    currentTheme,
    desktopNotificationPermission,
    hideThinkingBlocks,
    hideToolBlocks,
    onCenterMessagesChange,
    onHideThinkingBlocksChange,
    onHideToolBlocksChange,
    onSessionDoneDesktopNotificationsEnabledChange,
    onSessionDoneSoundEnabledChange,
    onThemeChange,
    sessionDoneDesktopNotificationsEnabled,
    sessionDoneSoundEnabled,
    settingsDialogRef,
    settingsOpenRef,
  }: Pick<
    AppShellFloatingControllersProps,
    | "centerMessages"
    | "currentTheme"
    | "desktopNotificationPermission"
    | "hideThinkingBlocks"
    | "hideToolBlocks"
    | "onCenterMessagesChange"
    | "onHideThinkingBlocksChange"
    | "onHideToolBlocksChange"
    | "onSessionDoneDesktopNotificationsEnabledChange"
    | "onSessionDoneSoundEnabledChange"
    | "onThemeChange"
    | "sessionDoneDesktopNotificationsEnabled"
    | "sessionDoneSoundEnabled"
    | "settingsDialogRef"
    | "settingsOpenRef"
  >) {
    return (
      <AppShellSettingsDialogController
        ref={settingsDialogRef}
        openStateRef={settingsOpenRef}
        currentTheme={currentTheme}
        onThemeChange={onThemeChange}
        hideThinkingBlocks={hideThinkingBlocks}
        onHideThinkingBlocksChange={onHideThinkingBlocksChange}
        hideToolBlocks={hideToolBlocks}
        onHideToolBlocksChange={onHideToolBlocksChange}
        centerMessages={centerMessages}
        onCenterMessagesChange={onCenterMessagesChange}
        sessionDoneSoundEnabled={sessionDoneSoundEnabled}
        onSessionDoneSoundEnabledChange={onSessionDoneSoundEnabledChange}
        sessionDoneDesktopNotificationsEnabled={
          sessionDoneDesktopNotificationsEnabled
        }
        onSessionDoneDesktopNotificationsEnabledChange={
          onSessionDoneDesktopNotificationsEnabledChange
        }
        desktopNotificationPermission={desktopNotificationPermission}
      />
    )
  }
)

const AppShellUiRequestDialogHost = React.memo(
  function AppShellUiRequestDialogHost({
    activeSessionId,
    uiRequestDialogRef,
    uiRequestOpenRef,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "activeSessionId"
    | "uiRequestDialogRef"
    | "uiRequestOpenRef"
    | "viewerContextId"
  >) {
    return (
      <AppShellUiRequestDialogController
        ref={uiRequestDialogRef}
        openStateRef={uiRequestOpenRef}
        viewerContextId={viewerContextId}
        sessionId={activeSessionId}
      />
    )
  }
)

const AppShellFloatingControllers = React.memo(
  function AppShellFloatingControllers({
    activeSessionId,
    addDirectoryDialogRef,
    addDirectoryOpenRef,
    addDirectoryPath,
    baseSidebarDirectories,
    centerMessages,
    commandPaletteCommandsRef,
    commandPaletteOpenRef,
    commandPaletteRef,
    currentSessionQueryScope,
    currentTheme,
    deleteDialogRef,
    deleteOpenRef,
    deleteSessions,
    desktopNotificationPermission,
    forkDialogRef,
    forkOpenRef,
    hideThinkingBlocks,
    hideToolBlocks,
    knownDirectories,
    onCenterMessagesChange,
    onHideThinkingBlocksChange,
    onHideToolBlocksChange,
    onSessionDoneDesktopNotificationsEnabledChange,
    onSessionDoneSoundEnabledChange,
    onThemeChange,
    recentDirectories,
    renameDialogRef,
    renameOpenRef,
    renameSessionPath,
    sessionCwd,
    sessionDoneDesktopNotificationsEnabled,
    sessionDoneSoundEnabled,
    settingsDialogRef,
    settingsOpenRef,
    treeDialogRef,
    treeOpenRef,
    treeSummaryAvailable,
    uiRequestDialogRef,
    uiRequestOpenRef,
    viewerContextId,
  }: AppShellFloatingControllersProps) {
    return (
      <>
        <AppShellCommandPaletteHost
          commandPaletteCommandsRef={commandPaletteCommandsRef}
          commandPaletteOpenRef={commandPaletteOpenRef}
          commandPaletteRef={commandPaletteRef}
        />

        <AppShellAddDirectoryDialogHost
          addDirectoryDialogRef={addDirectoryDialogRef}
          addDirectoryOpenRef={addDirectoryOpenRef}
          addDirectoryPath={addDirectoryPath}
          baseSidebarDirectories={baseSidebarDirectories}
          knownDirectories={knownDirectories}
          recentDirectories={recentDirectories}
          sessionCwd={sessionCwd}
        />

        <AppShellRenameSessionDialogHost
          renameDialogRef={renameDialogRef}
          renameOpenRef={renameOpenRef}
          renameSessionPath={renameSessionPath}
        />

        <AppShellDeleteSessionsDialogHost
          deleteDialogRef={deleteDialogRef}
          deleteOpenRef={deleteOpenRef}
          deleteSessions={deleteSessions}
        />

        <AppShellForkSessionDialogHost
          activeSessionId={activeSessionId}
          currentSessionQueryScope={currentSessionQueryScope}
          forkDialogRef={forkDialogRef}
          forkOpenRef={forkOpenRef}
          viewerContextId={viewerContextId}
        />

        <AppShellTreeDialogHost
          activeSessionId={activeSessionId}
          currentSessionQueryScope={currentSessionQueryScope}
          treeDialogRef={treeDialogRef}
          treeOpenRef={treeOpenRef}
          treeSummaryAvailable={treeSummaryAvailable}
          viewerContextId={viewerContextId}
        />

        <AppShellSettingsDialogHost
          centerMessages={centerMessages}
          currentTheme={currentTheme}
          desktopNotificationPermission={desktopNotificationPermission}
          hideThinkingBlocks={hideThinkingBlocks}
          hideToolBlocks={hideToolBlocks}
          onCenterMessagesChange={onCenterMessagesChange}
          onHideThinkingBlocksChange={onHideThinkingBlocksChange}
          onHideToolBlocksChange={onHideToolBlocksChange}
          onSessionDoneDesktopNotificationsEnabledChange={
            onSessionDoneDesktopNotificationsEnabledChange
          }
          onSessionDoneSoundEnabledChange={onSessionDoneSoundEnabledChange}
          onThemeChange={onThemeChange}
          sessionDoneDesktopNotificationsEnabled={
            sessionDoneDesktopNotificationsEnabled
          }
          sessionDoneSoundEnabled={sessionDoneSoundEnabled}
          settingsDialogRef={settingsDialogRef}
          settingsOpenRef={settingsOpenRef}
        />

        <AppShellUiRequestDialogHost
          activeSessionId={activeSessionId}
          uiRequestDialogRef={uiRequestDialogRef}
          uiRequestOpenRef={uiRequestOpenRef}
          viewerContextId={viewerContextId}
        />
      </>
    )
  }
)

function AppShellSidebarController({
  viewerContextId,
  sidebarStore,
  sessionSearchInputRef,
  sessionWorkspaceRef,
}: {
  viewerContextId: string
  sidebarStore: AppShellSidebarStore
  sessionSearchInputRef: React.RefObject<HTMLInputElement | null>
  sessionWorkspaceRef: React.RefObject<AppShellSessionWorkspaceHandle | null>
}) {
  const baseSidebarDirectories = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.baseSidebarDirectories,
    sameStringArray
  )
  const directoryStateByPath = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.directoryStateByPath,
    sameMapEntries
  )
  const emptySidebarStateText = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.emptySidebarStateText
  )
  const filteredDirectorySessions = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.filteredDirectorySessions,
    sameSessionEntryRecord
  )
  const sidebarSessionEntriesByKey = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.sidebarSessionEntriesByKey,
    sameMapEntries
  )
  const visibleDirectories = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.visibleDirectories,
    sameStringArray
  )
  const connected = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.connected
  )
  const directoryIndexDataByPath = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.directoryIndexDataByPath
  )
  const directoryIndexLoading = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.directoryIndexLoading
  )
  const selectedSidebarSessionKeys = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.selectedSidebarSessionKeys,
    sameStringArray
  )
  const sessionsEvent = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.sessionsEvent
  )
  const sessionSearch = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.sessionSearch
  )
  const sidebarDeferredDirectoryLoadingReady = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.sidebarDeferredDirectoryLoadingReady
  )
  const sidebarSessionSelectionAnchor = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.sidebarSessionSelectionAnchor
  )
  const directoryIndexRequestIdRef = React.useRef(0)
  const directoryIndexRequestIdsByPathRef = React.useRef<
    Record<string, number>
  >({})
  const sidebarDirectorySessionsSnapshotRef = React.useRef<{
    activeSessionId: string
    activeSessionKey: string
    activeSessionPath: string
    revisions: Record<string, string>
  } | null>(null)

  const startDirectoryIndexRequest = (directories: Array<string>) => {
    const requestId = directoryIndexRequestIdRef.current + 1
    directoryIndexRequestIdRef.current = requestId

    for (const directory of directories) {
      directoryIndexRequestIdsByPathRef.current[directory] = requestId
    }

    return requestId
  }

  const getActiveDirectoryIndexRequestDirectories = (
    directories: Array<string>,
    requestId: number
  ) =>
    directories.filter(
      (directory) =>
        directoryIndexRequestIdsByPathRef.current[directory] === requestId
    )

  React.useEffect(() => {
    let timeoutId = 0
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        sidebarStore.setSidebarDeferredDirectoryLoadingReady(true)
      }, 0)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [sidebarStore])

  React.useEffect(() => {
    const sidebarDirectorySet = new Set(baseSidebarDirectories)

    sidebarStore.setDirectoryIndexDataByPath((current) => {
      const next: Record<string, DirectorySessionsIndexData> = {}

      for (const [directory, payload] of Object.entries(current)) {
        if (!sidebarDirectorySet.has(directory)) continue
        next[directory] = payload
      }

      return JSON.stringify(next) === JSON.stringify(current) ? current : next
    })

    sidebarStore.setDirectoryIndexLoading((current) => {
      const next: Record<string, boolean> = {}

      for (const [directory, loading] of Object.entries(current)) {
        if (!sidebarDirectorySet.has(directory)) continue
        next[directory] = loading
      }

      return JSON.stringify(next) === JSON.stringify(current) ? current : next
    })

    const nextRequestIdsByPath: Record<string, number> = {}
    for (const [directory, requestId] of Object.entries(
      directoryIndexRequestIdsByPathRef.current
    )) {
      if (!sidebarDirectorySet.has(directory)) continue
      nextRequestIdsByPath[directory] = requestId
    }
    directoryIndexRequestIdsByPathRef.current = nextRequestIdsByPath
  }, [baseSidebarDirectories, sidebarStore])

  React.useEffect(() => {
    if (!viewerContextId || !sessionsEvent) return

    const payloadDirectoryIndexes = sessionsEvent.directoryIndexes || {}
    const payloadDirectories = Object.keys(payloadDirectoryIndexes)

    sidebarStore.setDirectoryIndexDataByPath((current) => {
      const merged = payloadDirectories.length
        ? mergeDirectoryIndexData(current, payloadDirectoryIndexes)
        : current

      return clearUnreadForActiveSidebarSession(merged, {
        sessionId: sessionsEvent.activeSessionId,
        sessionPath: sessionsEvent.activeSessionPath,
      })
    })

    if (payloadDirectories.length > 0) {
      sidebarStore.setDirectoryIndexLoading((current) =>
        updateDirectoryIndexLoadingState(current, payloadDirectories, false)
      )
    }

    const previousSnapshot = sidebarDirectorySessionsSnapshotRef.current
    const nextRevisions: Record<string, string> = {}
    const directoriesToRefresh: Array<string> = []

    for (const directory of baseSidebarDirectories) {
      const nextRevision = directoryStateByPath.get(directory)?.revision || ""
      const previousRevision = previousSnapshot?.revisions[directory] || ""
      nextRevisions[directory] = nextRevision

      if (payloadDirectories.includes(directory)) {
        continue
      }

      if (
        !Object.prototype.hasOwnProperty.call(
          directoryIndexDataByPath,
          directory
        )
      ) {
        continue
      }

      if (directoryIndexLoading[directory]) {
        continue
      }

      if (previousRevision === nextRevision) {
        continue
      }

      directoriesToRefresh.push(directory)
    }

    sidebarDirectorySessionsSnapshotRef.current = {
      activeSessionId: sessionsEvent.activeSessionId || "",
      activeSessionKey: sessionsEvent.activeSessionKey || "",
      activeSessionPath: sessionsEvent.activeSessionPath || "",
      revisions: nextRevisions,
    }

    if (directoriesToRefresh.length === 0) {
      return
    }

    const requestId = startDirectoryIndexRequest(directoriesToRefresh)
    sidebarStore.setDirectoryIndexLoading((current) =>
      updateDirectoryIndexLoadingState(current, directoriesToRefresh, true)
    )

    void fetchDirectorySessionsIndexes({
      viewerContextId,
      directories: directoriesToRefresh,
    })
      .then((response) => {
        const activeDirectories = getActiveDirectoryIndexRequestDirectories(
          directoriesToRefresh,
          requestId
        )
        if (activeDirectories.length === 0) return

        const activeDirectoryIndexes = Object.fromEntries(
          activeDirectories
            .map((directory) => [
              directory,
              response.directoryIndexes[directory],
            ])
            .filter((entry) => Boolean(entry[1]))
        )

        if (Object.keys(activeDirectoryIndexes).length > 0) {
          sidebarStore.setDirectoryIndexDataByPath((current) =>
            mergeDirectoryIndexData(current, activeDirectoryIndexes)
          )
        }
        sidebarStore.setDirectoryIndexLoading((current) =>
          updateDirectoryIndexLoadingState(current, activeDirectories, false)
        )
      })
      .catch((error) => {
        const activeDirectories = getActiveDirectoryIndexRequestDirectories(
          directoriesToRefresh,
          requestId
        )
        if (activeDirectories.length === 0) return

        sidebarStore.setDirectoryIndexLoading((current) =>
          updateDirectoryIndexLoadingState(current, activeDirectories, false)
        )
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load sidebar sessions"
        )
      })
  }, [
    baseSidebarDirectories,
    directoryIndexDataByPath,
    directoryIndexLoading,
    directoryStateByPath,
    sessionsEvent,
    sidebarStore,
    viewerContextId,
  ])

  React.useEffect(() => {
    if (!sessionsEvent) return

    sidebarStore.setSidebarSessionStatusByKey((current) =>
      mergeSidebarSessionStatusMap(current, {
        type: "session_status",
        sessionKey: sessionsEvent.activeSessionKey,
        sessionId: sessionsEvent.activeSessionId,
        sessionPath: sessionsEvent.activeSessionPath,
        unread: false,
      })
    )
  }, [
    sessionsEvent?.activeSessionId,
    sessionsEvent?.activeSessionKey,
    sessionsEvent?.activeSessionPath,
    sidebarStore,
  ])

  React.useEffect(() => {
    if (!viewerContextId || !sidebarDeferredDirectoryLoadingReady) return

    const missingDirectories = baseSidebarDirectories.filter(
      (directory) =>
        !Object.prototype.hasOwnProperty.call(
          directoryIndexDataByPath,
          directory
        ) && !directoryIndexLoading[directory]
    )

    if (missingDirectories.length === 0) {
      return
    }

    const requestId = startDirectoryIndexRequest(missingDirectories)
    sidebarStore.setDirectoryIndexLoading((current) =>
      updateDirectoryIndexLoadingState(current, missingDirectories, true)
    )

    void fetchDirectorySessionsIndexes({
      viewerContextId,
      directories: missingDirectories,
    })
      .then((response) => {
        const activeDirectories = getActiveDirectoryIndexRequestDirectories(
          missingDirectories,
          requestId
        )
        if (activeDirectories.length === 0) return

        const activeDirectoryIndexes = Object.fromEntries(
          activeDirectories
            .map((directory) => [
              directory,
              response.directoryIndexes[directory],
            ])
            .filter((entry) => Boolean(entry[1]))
        )

        if (Object.keys(activeDirectoryIndexes).length > 0) {
          sidebarStore.setDirectoryIndexDataByPath((current) =>
            mergeDirectoryIndexData(current, activeDirectoryIndexes)
          )
        }
        sidebarStore.setDirectoryIndexLoading((current) =>
          updateDirectoryIndexLoadingState(current, activeDirectories, false)
        )
      })
      .catch((error) => {
        const activeDirectories = getActiveDirectoryIndexRequestDirectories(
          missingDirectories,
          requestId
        )
        if (activeDirectories.length === 0) return

        sidebarStore.setDirectoryIndexLoading((current) =>
          updateDirectoryIndexLoadingState(current, activeDirectories, false)
        )
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load sidebar sessions"
        )
      })
  }, [
    baseSidebarDirectories,
    directoryIndexDataByPath,
    directoryIndexLoading,
    sidebarDeferredDirectoryLoadingReady,
    sidebarStore,
    viewerContextId,
  ])

  React.useEffect(() => {
    const validKeys = new Set(sidebarSessionEntriesByKey.keys())

    sidebarStore.setSelectedSidebarSessionKeys((current) => {
      const next = current.filter((key) => validKeys.has(key))
      return next.length === current.length ? current : next
    })

    sidebarStore.setSidebarSessionSelectionAnchor((current) =>
      current && validKeys.has(current) ? current : ""
    )
  }, [sidebarSessionEntriesByKey, sidebarStore])

  const reorderSidebarDirectories = (nextDirectories: Array<string>) => {
    const normalizedNext = normalizeStoredDirectoryList(nextDirectories)
    if (normalizedNext.length === 0) return

    sidebarStore.setSidebarDirectories((current) => {
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

  const setSidebarSelection = (nextKeys: Array<string>, anchorKey = "") => {
    const normalizedKeys = normalizeSessionSelectionKeys(nextKeys)
    const nextAnchor =
      normalizedKeys.length === 0
        ? ""
        : anchorKey && normalizedKeys.includes(anchorKey)
          ? anchorKey
          : (normalizedKeys[normalizedKeys.length - 1] ?? "")

    sidebarStore.setSelectedSidebarSessionKeys((current) =>
      sameStringArray(current, normalizedKeys) ? current : normalizedKeys
    )
    sidebarStore.setSidebarSessionSelectionAnchor((current) =>
      current === nextAnchor ? current : nextAnchor
    )
  }

  const selectSidebarSessionRange = (targetKey: string) => {
    const normalizedTargetKey = targetKey.trim()
    if (!normalizedTargetKey) return

    const orderedKeys = getRenderedSidebarSessionKeys()
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

  const handleSidebarSessionClick = (
    entry: SessionListEntry,
    modifiers: { ctrlKey: boolean; shiftKey: boolean }
  ) => {
    const key = sessionListEntryKey(entry)

    if (!key) {
      if (entry.id) {
        sessionWorkspaceRef.current?.selectSession(entry.id)
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
      sessionWorkspaceRef.current?.selectSession(entry.id)
    }
  }

  return (
    <AppSidebar
      connected={connected}
      sessionSearch={sessionSearch}
      onSessionSearchChange={sidebarStore.setSessionSearch}
      sessionSearchInputRef={sessionSearchInputRef}
      visibleDirectories={visibleDirectories}
      directoryCount={baseSidebarDirectories.length}
      filteredDirectorySessions={filteredDirectorySessions}
      directoryIndexLoading={directoryIndexLoading}
      selectedSessionKeys={selectedSidebarSessionKeys}
      activeSessionId={sessionsEvent?.activeSessionId}
      activeSessionKey={sessionsEvent?.activeSessionKey}
      emptyStateText={emptySidebarStateText}
      onOpenAddDirectoryDialog={() => {
        sessionWorkspaceRef.current?.openAddDirectoryDialog()
      }}
      onOpenCommandPalette={() => {
        sessionWorkspaceRef.current?.openCommandPalette()
      }}
      onOpenSettings={() => {
        sessionWorkspaceRef.current?.openSettingsDialog()
      }}
      onSessionClick={handleSidebarSessionClick}
      onRenameSession={(entry) => {
        sessionWorkspaceRef.current?.openRenameDialogForEntry(entry)
      }}
      onDeleteSession={(entry) => {
        sessionWorkspaceRef.current?.openDeleteDialog([entry])
      }}
      onCreateSessionInDirectory={(directory) => {
        void sessionWorkspaceRef.current?.createSession(directory, {
          closeMobileSidebar: true,
        })
      }}
      onRemoveDirectory={(directory) => {
        sidebarStore.setSidebarDirectories((current) => {
          const next = current.filter((entry) => entry !== directory)
          safeLocalStorageSetItem(
            SIDEBAR_DIRECTORIES_STORAGE_KEY,
            JSON.stringify(next)
          )
          return next
        })
      }}
      onRemoveAllDirectories={() => {
        sidebarStore.setSidebarDirectories((current) => {
          if (current.length === 0) {
            return current
          }
          safeLocalStorageSetItem(
            SIDEBAR_DIRECTORIES_STORAGE_KEY,
            JSON.stringify([])
          )
          return []
        })
      }}
      onReorderDirectories={reorderSidebarDirectories}
    />
  )
}

export function PiWebAppShell({
  sessionId,
  onSelectSession,
}: {
  sessionId?: string
  onSelectSession?: (
    sessionId?: string,
    options?: SelectSessionNavigationOptions
  ) => void
}) {
  const [viewerContextId, setViewerContextId] = React.useState("")
  const sidebarStoreRef = React.useRef<AppShellSidebarStore | null>(null)
  if (!sidebarStoreRef.current) {
    sidebarStoreRef.current = createAppShellSidebarStore()
  }
  const sidebarStore = sidebarStoreRef.current
  const sessionSearchInputRef = React.useRef<HTMLInputElement | null>(null)
  const sessionWorkspaceRef =
    React.useRef<AppShellSessionWorkspaceHandle | null>(null)

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
    const nextBootstrapDirectories = nextDirectories.slice(
      0,
      INITIAL_SIDEBAR_BOOTSTRAP_DIRECTORY_COUNT
    )
    sidebarStore.setState((current) => {
      if (
        sameStringArray(current.sidebarDirectories, nextDirectories) &&
        sameStringArray(
          current.initialSidebarBootstrapDirectories,
          nextBootstrapDirectories
        )
      ) {
        return current
      }

      return {
        sidebarDirectories: nextDirectories,
        initialSidebarBootstrapDirectories: nextBootstrapDirectories,
      }
    })
  }, [sidebarStore])

  return (
    <SidebarProvider className="h-full overflow-hidden bg-background">
      <AppShellSidebarController
        viewerContextId={viewerContextId}
        sidebarStore={sidebarStore}
        sessionSearchInputRef={sessionSearchInputRef}
        sessionWorkspaceRef={sessionWorkspaceRef}
      />

      <AppShellSessionWorkspace
        ref={sessionWorkspaceRef}
        viewerContextId={viewerContextId}
        sessionId={sessionId}
        onSelectSession={onSelectSession}
        sidebarStore={sidebarStore}
        sessionSearchInputRef={sessionSearchInputRef}
      />
    </SidebarProvider>
  )
}
