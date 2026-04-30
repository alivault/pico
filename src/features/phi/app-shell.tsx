import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpToLineIcon,
  CheckIcon,
  ChevronDownIcon,
  EllipsisIcon,
  FolderIcon,
  GitBranchIcon,
  PanelRightIcon,
  SquarePenIcon,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { toast } from "sonner"

import type { DesktopNotificationPermission } from "@/features/phi/session-done-notifications"
import type {
  ConversationItem,
  DirectoryState,
  PromptImage,
  SessionState,
  StreamingBehavior,
  ThemeMode,
} from "@/lib/phi"
import type {
  DirectorySessionsIndexSnapshot,
  DirectorySessionsIndexesResponse,
  ExtensionUiEvent,
  FileCompletionsResponse,
  GitActionResponse,
  GitChangesResponse,
  GitLocalBranch,
  GitStatusResponse,
  PathCompletionsResponse,
  SessionDoneEvent,
  SessionListEntry,
  SessionStatusEvent,
  SessionsEvent,
} from "@/lib/phi/api"
import type { AppCommand } from "@/features/phi/app-shell-command-palette"
import type { ComposerContextUsageStore } from "@/features/phi/composer-context-usage-indicator"
import type { ComposerPanelHandle } from "@/features/phi/composer-panel"

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
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Spinner } from "@/components/ui/spinner"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AppShellCommandPaletteController,
  type AppShellCommandPaletteHandle,
} from "@/features/phi/app-shell-command-palette"
import {
  AppShellSessionsDialogController,
  type AppShellSessionsDialogHandle,
} from "@/features/phi/app-shell-sessions-dialog"
import {
  AppShellSettingsDialogController,
  type AppShellSettingsDialogHandle,
} from "@/features/phi/app-shell-settings-dialog"
import {
  AppShellAddDirectoryDialogController,
  type AppShellAddDirectoryDialogHandle,
} from "@/features/phi/app-shell-add-directory-dialog"
import {
  AppShellTreeDialogController,
  type AppShellTreeDialogHandle,
} from "@/features/phi/app-shell-tree-dialog"
import {
  AppShellUiRequestDialogController,
  type AppShellUiRequestDialogHandle,
} from "@/features/phi/app-shell-ui-request-dialog"
import {
  DeleteOldDirectorySessionsDialogController,
  DeleteSessionsDialogController,
  ForkSessionDialogController,
  RenameSessionDialogController,
  type DeleteOldDirectorySessionsDialogHandle,
  type DeleteSessionsDialogHandle,
  type ForkSessionDialogHandle,
  type RenameSessionDialogHandle,
} from "@/features/phi/app-shell-session-dialogs"
import {
  buildRequestUrl,
  fetchJson,
  readFileAsPromptImage,
} from "@/features/phi/app-shell-utils"
import { ComposerPanel } from "@/features/phi/composer-panel"
import {
  getDesktopNotificationPermission,
  playSessionDoneSound,
  primeSessionDoneSound,
  requestDesktopNotificationPermission,
  showSessionDoneDesktopNotification,
} from "@/features/phi/session-done-notifications"
import {
  AssistantMessagesStoreCard,
  UserMessageCard,
  assistantMessageHasVisibleBlocks,
  type AssistantMessagesSnapshot,
  type AssistantMessagesStore,
} from "@/features/phi/conversation-view"
import {
  parseComposerSkillMessage,
  serializeComposerDraft,
} from "@/features/phi/composer-utils"
import {
  DraftGitStatusBadge,
  GitPanel,
  GitPanelToolbar,
  GitTabStatusText,
  HeaderGitStatusText,
} from "@/features/phi/git-panel"
import { phiQueryKeys, phiSessionScopeKey } from "@/features/phi/query-keys"
import {
  AppSidebar,
  createDirectorySessionsStore,
} from "@/features/phi/sidebar"
import {
  useAppShellMessageScroll,
  useMessageScrollValue,
} from "@/features/phi/use-app-shell-message-scroll"
import type { MessageScrollStateStore } from "@/features/phi/use-app-shell-message-scroll"
import { useAppShellPromptMutations } from "@/features/phi/use-app-shell-prompt-mutations"
import { useAppShellSessionMutations } from "@/features/phi/use-app-shell-session-mutations"
import { useAppShellSessionSync } from "@/features/phi/use-app-shell-session-sync"
import {
  useAppShellShortcuts,
  type AppShellShortcutState,
} from "@/features/phi/use-app-shell-shortcuts"
import {
  DRAFT_DIRECTORY_STORAGE_KEY,
  HIDE_TOOL_BLOCKS_STORAGE_KEY,
  CENTER_MESSAGES_STORAGE_KEY,
  AUTO_SCROLL_ENABLED_STORAGE_KEY,
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
  readStoredAutoScrollEnabled,
  readStoredRecentDirectories,
  readStoredSessionDoneDesktopNotificationsEnabled,
  readStoredSessionDoneSoundEnabled,
  readStoredSidebarDirectories,
  rememberStoredPromptDraft,
  promptDraftKey,
  safeLocalStorageSetItem,
  sessionListEntryKey,
} from "@/lib/phi"
import { isApiErrorResponse } from "@/lib/phi/api"

const TITLE_STREAMING_FRAMES = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"]
const TITLE_STREAMING_INTERVAL_MS = 500
const INITIAL_SIDEBAR_BOOTSTRAP_DIRECTORY_COUNT = 6

function sessionNotificationKey(sessionLike: {
  sessionFile?: string | undefined
  sessionPath?: string | undefined
  path?: string | undefined
  sessionId?: string | undefined
  id?: string | undefined
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

function findSidebarSessionSelectionKey(
  entriesByKey: Map<string, SessionListEntry>,
  sessionLike: {
    sessionId?: string | undefined
    sessionPath?: string | undefined
  }
) {
  const sessionPath = sessionLike.sessionPath?.trim() || ""
  const sessionId = sessionLike.sessionId?.trim() || ""

  if (sessionPath) {
    const pathKey = sessionListEntryKey({ path: sessionPath })
    if (entriesByKey.has(pathKey)) return pathKey
  }

  if (sessionId) {
    const idKey = sessionListEntryKey({ id: sessionId })
    if (entriesByKey.has(idKey)) return idKey
  }

  for (const [key, entry] of entriesByKey) {
    if (
      (sessionPath && entry.path === sessionPath) ||
      (sessionId && entry.id === sessionId)
    ) {
      return key
    }
  }

  return ""
}

function formatDisplayPath(value: string | undefined) {
  const path = value?.trim() || ""
  if (!path) return ""

  return path
    .replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/home\/[^/]+(?=\/|$)/, "~")
}

function formatFolderName(value: string | undefined) {
  const path = value?.trim().replace(/\/+$/, "") || ""
  if (!path) return ""
  if (path === "/") return "/"

  const parts = path.split("/").filter(Boolean)
  return parts[parts.length - 1] || path
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
type GitStatusData = Extract<GitStatusResponse, { ok: true }>
type GitChangesData = Extract<GitChangesResponse, { ok: true }>

type AppShellSidebarSnapshot = {
  baseSidebarDirectories: Array<string>
  directoryStateByPath: Map<string, DirectoryState>
  directoryIndexes: Record<string, Array<SessionListEntry>>
  sidebarSessions: Array<SessionListEntry>
  selectedSidebarSessions: Array<SessionListEntry>
  sidebarSessionEntriesByKey: Map<string, SessionListEntry>
}

type AppShellSidebarState = {
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
  return phiSessionScopeKey(sessionState)
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

function sameDirectoryIndexDataRecord(
  left: Record<string, DirectorySessionsIndexData>,
  right: Record<string, DirectorySessionsIndexData>
) {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (!sameStringArray(leftKeys, rightKeys)) return false

  for (const key of leftKeys) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false
  }

  return true
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
  const workspaceVersion = [
    baseSidebarDirectories.join("\n"),
    state.selectedSidebarSessionKeys.join("\n"),
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

function setValueStoreField<T extends object, K extends keyof T>(
  store: ValueStore<T>,
  key: K,
  action: React.SetStateAction<T[K]>
) {
  const current = store.getSnapshot()
  const nextValue = applySidebarStateAction(current[key], action)
  if (Object.is(current[key], nextValue)) return
  store.setSnapshot({
    ...current,
    [key]: nextValue,
  })
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

function getCurrentSessionTitleFromState(
  sessionState: Pick<SessionState, "firstMessage" | "sessionName">
) {
  return getSessionTitle({
    title:
      sessionState.sessionName || sessionState.firstMessage || "New session",
    name: sessionState.sessionName,
  })
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
  return item.renderKey || item.itemKey || `message-row:${index}`
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

type ConversationGroupSubscription = {
  hideThinking: boolean
  hideToolBlocks: boolean
  groups: Array<RenderConversationGroupDescriptor>
  listener: () => void
}

type ConversationAssistantGroupItemsSubscription = {
  groupKey: string
  itemKeys: Array<string>
  listener: () => void
}

type ConversationItemsStore = {
  getSnapshot: () => ConversationItemsSnapshot
  getAssistantGroupItemKeys: (groupKey: string) => Array<string>
  getItem: (key: string) => ConversationItem | undefined
  setItems: (items: Array<ConversationItem>) => void
  subscribe: (listener: () => void) => () => void
  subscribeGroups: (options: {
    hideThinking: boolean
    hideToolBlocks: boolean
    groups: Array<RenderConversationGroupDescriptor>
    listener: () => void
  }) => () => void
  subscribeAssistantGroupItems: (
    groupKey: string,
    listener: () => void
  ) => () => void
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
  const groupSubscriptions = new Set<ConversationGroupSubscription>()
  const assistantGroupItemsSubscriptions =
    new Set<ConversationAssistantGroupItemsSubscription>()
  const assistantGroupItemKeysByGroup = new Map<string, Array<string>>()

  const notifyItemListeners = (key: string) => {
    const listenersForItem = itemListeners.get(key)
    if (!listenersForItem) return

    for (const listener of listenersForItem) listener()
  }

  const computeAssistantGroupItemKeys = (groupKey: string) => {
    const itemKeys: Array<string> = []
    const startIndex = snapshot.items.findIndex(
      (item, index) => conversationItemKey(item, index) === groupKey
    )
    if (startIndex < 0) return itemKeys

    for (let index = startIndex; index < snapshot.items.length; index += 1) {
      const item = snapshot.items[index]
      if (!item || item.kind !== "assistant") break
      itemKeys.push(conversationItemKey(item, index))
    }

    return itemKeys
  }

  const getAssistantGroupItemKeys = (groupKey: string) => {
    const cached = assistantGroupItemKeysByGroup.get(groupKey)
    const nextItemKeys = computeAssistantGroupItemKeys(groupKey)
    if (cached && sameStringArray(cached, nextItemKeys)) return cached

    assistantGroupItemKeysByGroup.set(groupKey, nextItemKeys)
    return nextItemKeys
  }

  return {
    getSnapshot: () => snapshot,
    getAssistantGroupItemKeys,
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

      for (const subscription of groupSubscriptions) {
        const nextGroups = groupConversationItemsForRender({
          items,
          hideThinking: subscription.hideThinking,
          hideToolBlocks: subscription.hideToolBlocks,
        })
        const groups = reconcileRenderConversationGroupDescriptors(
          subscription.groups,
          nextGroups
        )

        if (groups !== subscription.groups) {
          subscription.groups = groups
          subscription.listener()
        }
      }

      for (const subscription of assistantGroupItemsSubscriptions) {
        const nextItemKeys = getAssistantGroupItemKeys(subscription.groupKey)
        if (sameStringArray(subscription.itemKeys, nextItemKeys)) continue

        subscription.itemKeys = nextItemKeys
        subscription.listener()
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
    subscribeGroups: ({ hideThinking, hideToolBlocks, groups, listener }) => {
      const subscription: ConversationGroupSubscription = {
        hideThinking,
        hideToolBlocks,
        groups,
        listener,
      }
      groupSubscriptions.add(subscription)
      return () => {
        groupSubscriptions.delete(subscription)
      }
    },
    subscribeAssistantGroupItems: (groupKey, listener) => {
      const subscription: ConversationAssistantGroupItemsSubscription = {
        groupKey,
        itemKeys: getAssistantGroupItemKeys(groupKey),
        listener,
      }
      assistantGroupItemsSubscriptions.add(subscription)
      return () => {
        assistantGroupItemsSubscriptions.delete(subscription)
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

  const subscribe = (listener: () => void) =>
    store.subscribeGroups({
      hideThinking,
      hideToolBlocks,
      groups: getSnapshot(),
      listener,
    })

  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
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

function assistantMessagesSnapshotFromStore(options: {
  hideThinking: boolean
  hideToolBlocks: boolean
  itemKeys: Array<string>
  store: ConversationItemsStore
}): AssistantMessagesSnapshot {
  return {
    hideThinking: options.hideThinking,
    hideToolBlocks: options.hideToolBlocks,
    items: options.itemKeys
      .map((key) => options.store.getItem(key))
      .filter(
        (item): item is AssistantConversationItem => item?.kind === "assistant"
      ),
  }
}

function sameAssistantMessagesSnapshot(
  left: AssistantMessagesSnapshot,
  right: AssistantMessagesSnapshot
) {
  if (left.hideThinking !== right.hideThinking) return false
  if (left.hideToolBlocks !== right.hideToolBlocks) return false
  if (left.items.length !== right.items.length) return false

  for (let index = 0; index < left.items.length; index += 1) {
    if (left.items[index] !== right.items[index]) return false
  }

  return true
}

type MutableAssistantMessagesStore = AssistantMessagesStore & {
  setSnapshot: (snapshot: AssistantMessagesSnapshot) => void
}

function createMutableAssistantMessagesStore(
  initialSnapshot: AssistantMessagesSnapshot
): MutableAssistantMessagesStore {
  let snapshot = initialSnapshot
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    setSnapshot: (nextSnapshot) => {
      if (sameAssistantMessagesSnapshot(snapshot, nextSnapshot)) return

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

const ConversationContentChangeContext = React.createContext<
  (() => void) | null
>(null)

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
    autoScrollEnabled: boolean
    children: React.ReactNode
    conversationItemsStore: ConversationItemsStore
    isSessionViewLoading: boolean
    sessionState: AppShellConversationSessionState
  }
>(function AppShellConversationFrameImpl(
  {
    autoScrollEnabled,
    children,
    conversationItemsStore,
    isSessionViewLoading,
    sessionState,
  },
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
    autoScrollEnabled,
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
        className="h-full overflow-auto overscroll-contain px-4 outline-none [overflow-anchor:none]"
      >
        <div ref={messagesContentRef} className="flex min-h-full flex-col">
          <ConversationScrollRevisionObserver
            conversationItemsStore={conversationItemsStore}
            disabled={isSessionViewLoading}
            onRevisionChange={syncAfterConversationChange}
          />
          <ConversationContentChangeContext.Provider
            value={syncAfterConversationChange}
          >
            {children}
          </ConversationContentChangeContext.Provider>
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

function AppShellWorkingIndicatorLabel({
  fallbackLabel,
  hiddenThinkingPreviewStore,
  useHiddenThinkingPreview,
}: {
  fallbackLabel: string
  hiddenThinkingPreviewStore: TextValueStore
  useHiddenThinkingPreview: boolean
}) {
  const hiddenThinkingPreview = useTextValueSnapshot(hiddenThinkingPreviewStore)
  const visibleLabel =
    useHiddenThinkingPreview && hiddenThinkingPreview
      ? hiddenThinkingPreview
      : fallbackLabel

  return <div className="font-medium text-foreground">{visibleLabel}</div>
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
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex w-full items-start gap-3 rounded-xl px-1 py-1 text-sm text-muted-foreground"
    >
      <span className="mt-0.5 inline-flex items-center justify-center">
        {state.done ? (
          <CheckIcon className="size-4 text-emerald-600" />
        ) : (
          <Spinner />
        )}
      </span>
      <div className="min-w-0 flex-1">
        {state.done ? (
          <div className="font-medium text-foreground">Done</div>
        ) : (
          <AppShellWorkingIndicatorLabel
            fallbackLabel={state.label}
            hiddenThinkingPreviewStore={hiddenThinkingPreviewStore}
            useHiddenThinkingPreview={useHiddenThinkingPreview}
          />
        )}
        {state.summary ? (
          <div className="truncate text-muted-foreground">{state.summary}</div>
        ) : null}
      </div>
    </div>
  )
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
    <TabsList className="w-full rounded-none border-b border-border/70 md:hidden">
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
      groupKey={group.key}
      hideThinking={hideThinking}
      hideToolBlocks={hideToolBlocks}
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

function useConversationAssistantGroupItemKeys(
  store: ConversationItemsStore,
  groupKey: string
) {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener) => store.subscribeAssistantGroupItems(groupKey, listener),
      [groupKey, store]
    ),
    () => store.getAssistantGroupItemKeys(groupKey),
    () => store.getAssistantGroupItemKeys(groupKey)
  )
}

function ConversationAssistantGroupView({
  className,
  groupKey,
  hideThinking,
  hideToolBlocks,
  store,
}: {
  className: string
  groupKey: string
  hideThinking: boolean
  hideToolBlocks: boolean
  store: ConversationItemsStore
}) {
  const itemKeys = useConversationAssistantGroupItemKeys(store, groupKey)
  const syncAfterConversationContentChange = React.useContext(
    ConversationContentChangeContext
  )
  const assistantMessagesStoreRef =
    React.useRef<MutableAssistantMessagesStore | null>(null)
  if (!assistantMessagesStoreRef.current) {
    assistantMessagesStoreRef.current = createMutableAssistantMessagesStore(
      assistantMessagesSnapshotFromStore({
        hideThinking,
        hideToolBlocks,
        itemKeys,
        store,
      })
    )
  }
  const assistantMessagesStore = assistantMessagesStoreRef.current

  React.useLayoutEffect(() => {
    const updateSnapshot = () => {
      assistantMessagesStore.setSnapshot(
        assistantMessagesSnapshotFromStore({
          hideThinking,
          hideToolBlocks,
          itemKeys,
          store,
        })
      )
      syncAfterConversationContentChange?.()
    }

    updateSnapshot()
    return store.subscribeItems(itemKeys, updateSnapshot)
  }, [
    assistantMessagesStore,
    hideThinking,
    hideToolBlocks,
    itemKeys,
    store,
    syncAfterConversationContentChange,
  ])

  return (
    <div className={className}>
      <AssistantMessagesStoreCard store={assistantMessagesStore} />
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

  if (showConversationLoadingState) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
        <Spinner />
        <div>{conversationLoadingLabel}</div>
      </div>
    )
  }

  if (hasMessages) return null

  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          {draft ? "New session" : "Start a new conversation"}
        </EmptyTitle>
        <EmptyDescription>
          {draft
            ? undefined
            : "This is the native Phi session view backed by the new TypeScript runtime."}
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
  hideToolBlocks,
  sessionStore,
}: {
  centerMessages: boolean
  conversationItemsStore: ConversationItemsStore
  hideToolBlocks: boolean
  sessionStore: ValueStore<SessionState>
}) {
  const hideThinking = useSelectedValueStore(
    sessionStore,
    (sessionState) => sessionState.hideThinkingBlock
  )
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
    conversationFrameRef,
    conversationItemsStore,
    displaySettingsStore,
    hiddenThinkingPreviewStore,
    isSessionViewLoading,
    isSubmitting,
    onCreateSession,
    sessionStore,
    viewerContextId,
    workingStateStore,
  }: {
    awaitingFirstTurn: boolean
    conversationFrameRef: React.RefObject<AppShellConversationFrameHandle | null>
    conversationItemsStore: ConversationItemsStore
    displaySettingsStore: ValueStore<AppShellDisplaySettingsState>
    hiddenThinkingPreviewStore: TextValueStore
    isSessionViewLoading: boolean
    isSubmitting: boolean
    onCreateSession: () => void
    sessionStore: ValueStore<SessionState>
    viewerContextId: string
    workingStateStore: ValueStore<AppShellWorkingState | null>
  }) {
    const sessionState = useAppShellConversationSessionState(sessionStore)
    const { autoScrollEnabled, centerMessages, hideToolBlocks } =
      useValueStore(displaySettingsStore)
    const hideThinking = useSelectedValueStore(
      sessionStore,
      (currentSessionState) => currentSessionState.hideThinkingBlock
    )

    React.useLayoutEffect(() => {
      conversationItemsStore.setItems(sessionStore.getSnapshot().items)
    }, [conversationItemsStore, hideThinking, hideToolBlocks, sessionStore])

    return (
      <AppShellConversationFrame
        ref={conversationFrameRef}
        autoScrollEnabled={autoScrollEnabled}
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
        {!isSessionViewLoading ? (
          <>
            <AppShellConversationMessageStack
              centerMessages={centerMessages}
              conversationItemsStore={conversationItemsStore}
              hideToolBlocks={hideToolBlocks}
              sessionStore={sessionStore}
            />
            <AppShellConversationWorkingFooter
              centerMessages={centerMessages}
              conversationItemsStore={conversationItemsStore}
              hiddenThinkingPreviewStore={hiddenThinkingPreviewStore}
              hideThinking={hideThinking}
              streaming={sessionState.streaming}
              workingStateStore={workingStateStore}
            />
          </>
        ) : null}
      </AppShellConversationFrame>
    )
  }
)

function useAppShellComposerSnapshot(
  store: ValueStore<AppShellComposerSnapshot>
) {
  return useValueStore(store)
}

function gitStatusQueryOptions({
  cwd,
  viewerContextId,
}: {
  cwd: string
  viewerContextId: string
}) {
  return {
    queryKey: phiQueryKeys.gitStatus(viewerContextId, cwd),
    queryFn: () =>
      fetchJson<GitStatusData>(
        buildRequestUrl(`/api/git-status?cwd=${encodeURIComponent(cwd)}`, {
          contextId: viewerContextId,
        })
      ),
    staleTime: 30_000,
    gcTime: 600_000,
  }
}

function gitBranchesQueryOptions({
  cwd,
  viewerContextId,
}: {
  cwd: string
  viewerContextId: string
}) {
  return {
    queryKey: phiQueryKeys.gitBranches(viewerContextId, cwd),
    queryFn: () =>
      fetchJson<GitChangesData>(
        buildRequestUrl(
          `/api/git-changes?cwd=${encodeURIComponent(cwd)}&scope=branches`,
          {
            contextId: viewerContextId,
          }
        )
      ),
    staleTime: 30_000,
    gcTime: 600_000,
  }
}

function currentBranchLabel(value: {
  branch?: string
  detached: boolean
  revision?: string
}) {
  if (value.detached)
    return value.revision ? `detached ${value.revision}` : "detached"
  return value.branch?.trim() || ""
}

function localBranchTrackText(branch: GitLocalBranch) {
  if (!branch.upstream) return ""
  if (branch.upstreamGone) return "gone"
  const ahead = Number.isInteger(branch.ahead) ? branch.ahead : 0
  const behind = Number.isInteger(branch.behind) ? branch.behind : 0
  if (ahead > 0 && behind > 0) return `ahead ${ahead}, behind ${behind}`
  if (ahead > 0) return `ahead ${ahead}`
  if (behind > 0) return `behind ${behind}`
  return "synced"
}

function NewSessionComposerSelectors({
  cwd,
  defaultNewSessionDirectory,
  directoryOptions,
  onCreateSession,
  viewerContextId,
}: {
  cwd?: string
  defaultNewSessionDirectory: string
  directoryOptions: Array<{ path: string; label: string }>
  onCreateSession: (cwdOverride?: string) => void
  viewerContextId: string
}) {
  const queryClient = useQueryClient()
  const selectedDirectory = cwd?.trim() || defaultNewSessionDirectory.trim()
  const directoryMenuOptions = (() => {
    const seen = new Set<string>()
    const options: Array<{ path: string; label: string }> = []
    const pushOption = (path: string, label: string) => {
      const normalizedPath = path.trim()
      if (!normalizedPath || seen.has(normalizedPath)) return
      seen.add(normalizedPath)
      options.push({ path: normalizedPath, label })
    }

    pushOption(selectedDirectory, "Selected directory")
    for (const option of directoryOptions) {
      pushOption(option.path, option.label)
    }
    return options
  })()
  const selectedDirectoryLabel =
    formatFolderName(selectedDirectory) || "Select directory"
  const gitStatusQuery = useQuery({
    ...gitStatusQueryOptions({ cwd: selectedDirectory, viewerContextId }),
    enabled: Boolean(selectedDirectory && viewerContextId),
    select: (data) => data.gitStatus,
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const gitStatus = gitStatusQuery.data
  const branchLabel = gitStatus ? currentBranchLabel(gitStatus) : ""
  const branchQuery = useQuery({
    ...gitBranchesQueryOptions({ cwd: selectedDirectory, viewerContextId }),
    enabled: Boolean(selectedDirectory && viewerContextId && gitStatus),
    select: (data) => data.localBranches,
    notifyOnChangeProps: ["data", "isPending", "error"],
  })
  const localBranches = branchQuery.data || []
  const checkoutBranchMutation = useMutation({
    mutationFn: async (branch: string) =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-checkout", {
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: selectedDirectory, branch }),
        }
      ),
    onSuccess: (_result, branch) => {
      void queryClient.invalidateQueries({
        queryKey: phiQueryKeys.gitStatus(viewerContextId, selectedDirectory),
      })
      void queryClient.invalidateQueries({
        queryKey: phiQueryKeys.gitBranches(viewerContextId, selectedDirectory),
      })
      void queryClient.invalidateQueries({
        queryKey: phiQueryKeys.gitFiles(viewerContextId, selectedDirectory),
      })
      void queryClient.invalidateQueries({
        queryKey: phiQueryKeys.gitCommits(viewerContextId, selectedDirectory),
      })
      toast.success(`Switched to ${branch}`)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to switch branch"
      )
    },
  })

  return (
    <div className="flex min-w-0 items-center justify-start gap-1.5 text-muted-foreground">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              aria-label="Select new session directory"
            />
          }
        >
          <FolderIcon className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{selectedDirectoryLabel}</span>
          <ChevronDownIcon className="size-5 shrink-0" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          {directoryMenuOptions.map((option) => (
            <DropdownMenuItem
              key={option.path}
              onClick={() => onCreateSession(option.path)}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">
                  {option.label}
                </span>
                <span className="truncate">
                  {formatDisplayPath(option.path)}
                </span>
              </div>
              {option.path === selectedDirectory ? (
                <CheckIcon className="ml-2 size-4 shrink-0" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {gitStatus && branchLabel ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                aria-label="Select git branch"
                disabled={checkoutBranchMutation.isPending}
              />
            }
          >
            <GitBranchIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{branchLabel}</span>
            {checkoutBranchMutation.isPending ? (
              <Spinner className="size-4 shrink-0" />
            ) : (
              <ChevronDownIcon className="size-5 shrink-0" aria-hidden="true" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80">
            {branchQuery.isPending ? (
              <DropdownMenuItem disabled>
                <Spinner />
                Loading branches…
              </DropdownMenuItem>
            ) : localBranches.length > 0 ? (
              localBranches.map((branch) => {
                const trackText = localBranchTrackText(branch)
                return (
                  <DropdownMenuItem
                    key={branch.name}
                    disabled={checkoutBranchMutation.isPending}
                    onClick={() => {
                      if (branch.current) return
                      checkoutBranchMutation.mutate(branch.name)
                    }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate">{branch.name}</span>
                      {trackText || branch.subject ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {[trackText, branch.subject]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </div>
                    {branch.current ? (
                      <CheckIcon className="ml-2 size-4 shrink-0" />
                    ) : null}
                  </DropdownMenuItem>
                )
              })
            ) : (
              <DropdownMenuItem disabled>No local branches.</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

const AppShellComposerController = React.memo(
  function AppShellComposerController({
    actionsRef,
    composerPanelRef,
    contextUsageStore,
    displaySettingsStore,
    fileInputRef,
    sessionStore,
    store,
    topContent,
  }: {
    actionsRef: React.RefObject<AppShellComposerActions>
    composerPanelRef: React.RefObject<ComposerPanelHandle | null>
    contextUsageStore: ComposerContextUsageStore
    displaySettingsStore: ValueStore<AppShellDisplaySettingsState>
    fileInputRef: React.RefObject<HTMLInputElement | null>
    sessionStore: ValueStore<SessionState>
    store: ValueStore<AppShellComposerSnapshot>
    topContent?: React.ReactNode
  }) {
    const snapshot = useAppShellComposerSnapshot(store)
    const centerMessages = useSelectedValueStore(
      displaySettingsStore,
      (settings) => settings.centerMessages
    )
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
    const onEditPendingMessage = useStableEvent(
      (pendingId: string, text: string) => {
        if (snapshotRef.current.disabled) return
        if (actionsRef.current.editPendingDraftFollowUp(pendingId, text)) return
        void actionsRef.current.editPendingMessage(pendingId, text)
      }
    )
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
        centerMessages={centerMessages}
        contextUsageStore={contextUsageStore}
        displaySettingsStore={displaySettingsStore}
        sessionStore={sessionStore}
        isSubmitting={snapshot.isSubmitting}
        isStreaming={snapshot.isStreaming}
        awaitingFirstTurn={snapshot.awaitingFirstTurn}
        disabled={snapshot.disabled}
        flush={Boolean(topContent)}
        topContent={topContent}
        fileInputRef={fileInputRef}
        onComposerTextChange={onComposerTextChange}
        onPickImages={onPickImages}
        onRemoveComposerImage={onRemoveComposerImage}
        onSubmitPrompt={onSubmitPrompt}
        onAbort={onAbort}
        onEditPendingMessage={onEditPendingMessage}
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

type AppShellSessionContentProps = {
  actionsRef: React.RefObject<AppShellComposerActions>
  awaitingFirstTurn: boolean
  composerPanelRef: React.RefObject<ComposerPanelHandle | null>
  contextUsageStore: ComposerContextUsageStore
  conversationFrameRef: React.RefObject<AppShellConversationFrameHandle | null>
  conversationItemsStore: ConversationItemsStore
  defaultNewSessionDirectory: string
  displaySettingsStore: ValueStore<AppShellDisplaySettingsState>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  hiddenThinkingPreviewStore: TextValueStore
  isSessionViewLoading: boolean
  isSubmitting: boolean
  newSessionDirectoryOptions: Array<{ path: string; label: string }>
  onCreateSession: (cwdOverride?: string) => void
  sessionStore: ValueStore<SessionState>
  store: ValueStore<AppShellComposerSnapshot>
  viewerContextId: string
  workingStateStore: ValueStore<AppShellWorkingState | null>
}

function AppShellSessionContent({
  actionsRef,
  awaitingFirstTurn,
  composerPanelRef,
  contextUsageStore,
  conversationFrameRef,
  conversationItemsStore,
  defaultNewSessionDirectory,
  displaySettingsStore,
  fileInputRef,
  hiddenThinkingPreviewStore,
  isSessionViewLoading,
  isSubmitting,
  newSessionDirectoryOptions,
  onCreateSession,
  sessionStore,
  store,
  viewerContextId,
  workingStateStore,
}: AppShellSessionContentProps) {
  const sessionState = useSelectedValueStore(
    sessionStore,
    (currentSessionState) => ({
      cwd: currentSessionState.cwd,
      draft: currentSessionState.draft,
    }),
    shallowRecordEqual
  )
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  const showNewSessionComposer =
    sessionState.draft && !hasMessages && !isSessionViewLoading

  if (showNewSessionComposer) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-4">
        <AppShellComposerController
          actionsRef={actionsRef}
          composerPanelRef={composerPanelRef}
          contextUsageStore={contextUsageStore}
          displaySettingsStore={displaySettingsStore}
          fileInputRef={fileInputRef}
          sessionStore={sessionStore}
          store={store}
          topContent={
            <NewSessionComposerSelectors
              cwd={sessionState.cwd}
              defaultNewSessionDirectory={defaultNewSessionDirectory}
              directoryOptions={newSessionDirectoryOptions}
              onCreateSession={onCreateSession}
              viewerContextId={viewerContextId}
            />
          }
        />
      </div>
    )
  }

  return (
    <>
      <AppShellSessionConversation
        awaitingFirstTurn={awaitingFirstTurn}
        conversationFrameRef={conversationFrameRef}
        conversationItemsStore={conversationItemsStore}
        displaySettingsStore={displaySettingsStore}
        hiddenThinkingPreviewStore={hiddenThinkingPreviewStore}
        isSessionViewLoading={isSessionViewLoading}
        isSubmitting={isSubmitting}
        onCreateSession={onCreateSession}
        sessionStore={sessionStore}
        viewerContextId={viewerContextId}
        workingStateStore={workingStateStore}
      />

      <AppShellComposerController
        actionsRef={actionsRef}
        composerPanelRef={composerPanelRef}
        contextUsageStore={contextUsageStore}
        displaySettingsStore={displaySettingsStore}
        fileInputRef={fileInputRef}
        sessionStore={sessionStore}
        store={store}
      />
    </>
  )
}

function AppShellDesktopGitPanel({
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
    <aside
      aria-label="Git panel"
      className="flex h-full min-h-0 min-w-0 flex-col border-l border-border/70 bg-background"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 p-2">
        <div className="min-w-0 flex-1">
          <GitPanelToolbar
            viewerContextId={viewerContextId}
            cwd={cwd}
            active={active}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <GitPanel
          viewerContextId={viewerContextId}
          cwd={cwd}
          active={active}
          showToolbar={false}
        />
      </div>
    </aside>
  )
}

function AppShellTabsController({
  actionsRef,
  appUiStore,
  awaitingFirstTurn,
  composerPanelRef,
  contextUsageStore,
  conversationFrameRef,
  conversationItemsStore,
  defaultNewSessionDirectory,
  displaySettingsStore,
  fileInputRef,
  gitPanelOpen,
  hiddenThinkingPreviewStore,
  isSessionViewLoading,
  isSubmitting,
  isMobile,
  newSessionDirectoryOptions,
  onCreateSession,
  onValueChange,
  sessionStore,
  store,
  viewerContextId,
  workingStateStore,
}: AppShellSessionContentProps & {
  appUiStore: ValueStore<AppShellUiState>
  gitPanelOpen: boolean
  isMobile: boolean
  onValueChange: (value: string) => void
}) {
  const currentTab = useSelectedValueStore(
    appUiStore,
    (state) => state.currentTab
  )
  const isDraftSession = useSelectedValueStore(
    sessionStore,
    (sessionState) => sessionState.draft
  )
  const showTabsList = !isDraftSession || isSessionViewLoading
  const sessionVisibleClassName =
    currentTab === "git"
      ? "hidden min-h-0 flex-1 flex-col md:flex"
      : "flex min-h-0 flex-1 flex-col"
  const mobileGitClassName =
    currentTab === "git"
      ? "min-h-0 flex-1 space-y-4 overflow-auto p-6 md:hidden"
      : "hidden"
  const desktopGitPanelOpen = !isMobile && gitPanelOpen
  const sessionPane = (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className={sessionVisibleClassName}>
        <AppShellSessionContent
          actionsRef={actionsRef}
          awaitingFirstTurn={awaitingFirstTurn}
          composerPanelRef={composerPanelRef}
          contextUsageStore={contextUsageStore}
          conversationFrameRef={conversationFrameRef}
          conversationItemsStore={conversationItemsStore}
          defaultNewSessionDirectory={defaultNewSessionDirectory}
          displaySettingsStore={displaySettingsStore}
          fileInputRef={fileInputRef}
          hiddenThinkingPreviewStore={hiddenThinkingPreviewStore}
          isSessionViewLoading={isSessionViewLoading}
          isSubmitting={isSubmitting}
          newSessionDirectoryOptions={newSessionDirectoryOptions}
          onCreateSession={onCreateSession}
          sessionStore={sessionStore}
          store={store}
          viewerContextId={viewerContextId}
          workingStateStore={workingStateStore}
        />
      </div>

      <div className={mobileGitClassName}>
        <AppShellGitPanelController
          viewerContextId={viewerContextId}
          sessionStore={sessionStore}
          active={isMobile && currentTab === "git"}
        />
      </div>
    </div>
  )

  return (
    <Tabs
      value={currentTab}
      onValueChange={onValueChange}
      className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      {showTabsList ? (
        <AppShellTabsList
          viewerContextId={viewerContextId}
          sessionStore={sessionStore}
        />
      ) : null}

      {desktopGitPanelOpen ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1 overflow-hidden"
        >
          <ResizablePanel
            id="session"
            defaultSize="50%"
            minSize="20rem"
            className="h-full min-h-0 min-w-0"
          >
            {sessionPane}
          </ResizablePanel>
          <ResizablePanel
            id="git"
            defaultSize="50%"
            minSize="20rem"
            className="h-full min-h-0 min-w-0"
          >
            <AppShellDesktopGitPanel
              viewerContextId={viewerContextId}
              sessionStore={sessionStore}
              active={desktopGitPanelOpen}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">{sessionPane}</div>
      )}
    </Tabs>
  )
}

function AppShellWindowEffectsHost({
  isSessionViewLoading,
  loadingDisplaySessionTitle,
  notificationStore,
  onSelectSession,
  sessionStore,
  sidebarStore,
}: {
  isSessionViewLoading: boolean
  loadingDisplaySessionTitle: string
  notificationStore: ValueStore<AppShellNotificationState>
  onSelectSession: (nextSessionId?: string) => void
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
      sessionName: sessionState.sessionName,
      sessionStreaming: sessionState.streaming,
      firstMessage: sessionState.firstMessage,
      uiTitle: sessionState.uiState.title?.trim() || "",
    }),
    shallowRecordEqual
  )
  const notificationState = useValueStore(notificationStore)
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
      (currentSessionTitle !== "New session" ? currentSessionTitle : "Phi")
  const onConsumeSessionDoneEvents = (ids: Array<string>) => {
    const consumedIds = new Set(ids)
    setValueStoreField(notificationStore, "sessionDoneEvents", (current) =>
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
      const body = event.cwd || sessionCwd || "Open Phi to continue"
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
  sessionPath?: string
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

type PendingDraftFollowUp = {
  message: string
  images: Array<PromptImage>
  streamingBehavior: "steer" | "followUp"
  optimisticId?: string
}

function pendingDraftFollowUpId(
  message: { optimisticId?: string },
  index: number
) {
  return message.optimisticId || `pending-draft:${index}`
}

function movePendingDraftFollowUpMessage(
  messages: Array<PendingDraftFollowUp>,
  pendingId: string,
  direction: -1 | 1
) {
  const index = messages.findIndex(
    (message, messageIndex) =>
      pendingDraftFollowUpId(message, messageIndex) === pendingId
  )
  if (index === -1) return null

  const item = messages[index]
  if (!item) return null

  const next = [...messages]
  const targetIndex = index + direction
  const target = next[targetIndex]

  if (direction === -1) {
    if (item.streamingBehavior === "followUp" && !target) {
      next[index] = { ...item, streamingBehavior: "steer" }
      return next
    }

    if (
      item.streamingBehavior === "followUp" &&
      target.streamingBehavior === "steer"
    ) {
      next[index] = { ...item, streamingBehavior: "steer" }
      return next
    }
  }

  if (direction === 1) {
    if (item.streamingBehavior === "steer" && !target) {
      next[index] = { ...item, streamingBehavior: "followUp" }
      return next
    }

    if (
      item.streamingBehavior === "steer" &&
      target.streamingBehavior === "followUp"
    ) {
      next[index] = { ...item, streamingBehavior: "followUp" }
      return next
    }
  }

  if (!target) return null

  const [movedItem] = next.splice(index, 1)
  if (!movedItem) return null
  next.splice(targetIndex, 0, movedItem)
  return next
}

type AppShellComposerSnapshot = {
  activeSessionId?: string
  awaitingFirstTurn: boolean
  centerMessages: boolean
  composerImages: Array<PromptImage>
  composerSkill?: string
  composerSyncNonce: number
  composerText: string
  currentPendingMessages: Array<PendingComposerMessage>
  disabled: boolean
  isStreaming: boolean
  isSubmitting: boolean
  viewerContextId: string
}

const EMPTY_COMPOSER_IMAGES: Array<PromptImage> = []
const EMPTY_COMPOSER_PENDING_MESSAGES: Array<PendingComposerMessage> = []

function sameComposerPromptImages(
  left: Array<PromptImage>,
  right: Array<PromptImage>
) {
  if (left === right) return true
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

function sameComposerPendingMessages(
  left: Array<PendingComposerMessage>,
  right: Array<PendingComposerMessage>
) {
  if (left === right) return true
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
    if (!sameComposerPromptImages(leftMessage.images, rightMessage.images)) {
      return false
    }
  }

  return true
}

function sameAppShellComposerSnapshot(
  left: AppShellComposerSnapshot,
  right: AppShellComposerSnapshot
) {
  return (
    left.activeSessionId === right.activeSessionId &&
    left.awaitingFirstTurn === right.awaitingFirstTurn &&
    left.centerMessages === right.centerMessages &&
    left.composerSkill === right.composerSkill &&
    left.composerSyncNonce === right.composerSyncNonce &&
    left.composerText === right.composerText &&
    left.disabled === right.disabled &&
    left.isStreaming === right.isStreaming &&
    left.isSubmitting === right.isSubmitting &&
    left.viewerContextId === right.viewerContextId &&
    sameComposerPromptImages(left.composerImages, right.composerImages) &&
    sameComposerPendingMessages(
      left.currentPendingMessages,
      right.currentPendingMessages
    )
  )
}

type AppShellComposerActions = {
  abortSession: () => void | Promise<unknown>
  onPickImages: (files: FileList | Array<File> | null) => void | Promise<void>
  onRemoveComposerImage: (index: number) => void
  editPendingDraftFollowUp: (pendingId: string, text: string) => boolean
  editPendingMessage: (
    pendingId: string,
    text: string
  ) => void | Promise<unknown>
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
  return {
    activeSessionId: undefined,
    awaitingFirstTurn: false,
    centerMessages: false,
    composerImages: EMPTY_COMPOSER_IMAGES,
    composerSkill: undefined,
    composerSyncNonce: 0,
    composerText: "",
    currentPendingMessages: EMPTY_COMPOSER_PENDING_MESSAGES,
    disabled: false,
    isStreaming: false,
    isSubmitting: false,
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
  openDeleteOldDirectorySessionsDialog: (directory: string) => void
  openRenameDialogForEntry: (entry: SessionListEntry) => void
  openSessionsDialog: () => void
  openSettingsDialog: () => void
  selectSession: (
    nextSessionId?: string,
    options?: SelectSessionNavigationOptions
  ) => void
}

type AppShellUiState = {
  currentTab: string
  gitPanelOpen: boolean
  initialLoadingSessionId: string | null
  loadingSessionId: string | null
}

type AppShellDisplaySettingsState = {
  autoScrollEnabled: boolean
  centerMessages: boolean
  hideToolBlocks: boolean
}

type AppShellNotificationState = {
  desktopNotificationPermission: DesktopNotificationPermission
  sessionDoneDesktopNotificationsEnabled: boolean
  sessionDoneEvents: Array<SessionDoneEvent>
  sessionDoneSoundEnabled: boolean
}

type AppShellDraftFlowState = {
  draftSessionLoadingOwnerKey: string | null
  storedDraftDirectory: string
}

type AppShellController = {
  stores: {
    appUi: ValueStore<AppShellUiState>
    composer: ValueStore<AppShellComposerSnapshot>
    contextUsage: ComposerContextUsageStore
    conversationItems: ConversationItemsStore
    displaySettings: ValueStore<AppShellDisplaySettingsState>
    draftFlow: ValueStore<AppShellDraftFlowState>
    notification: ValueStore<AppShellNotificationState>
    session: ValueStore<SessionState>
    sidebar: AppShellSidebarStore
  }
  refs: {
    composerImages: React.RefObject<Array<PromptImage>>
    composerPanel: React.RefObject<ComposerPanelHandle | null>
    composerSkill: React.RefObject<string | undefined>
    composerText: React.RefObject<string>
    conversationFrame: React.RefObject<AppShellConversationFrameHandle | null>
    sessionState: React.RefObject<SessionState>
  }
  actions: AppShellSessionWorkspaceHandle & {
    focusModelSelector: () => void
    focusPrompt: () => void
    focusSessionSearch: () => void
  }
}

type AppShellSessionWorkspaceProps = {
  viewerContextId: string
  sessionId?: string
  onSelectSession?: (
    sessionId?: string,
    options?: SelectSessionNavigationOptions
  ) => void
  sidebar: React.ReactNode
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
    sidebar,
    sidebarStore,
    sessionSearchInputRef,
  },
  ref
) {
  const initialSessionStateRef = React.useRef<SessionState | null>(null)
  if (!initialSessionStateRef.current) {
    initialSessionStateRef.current = createInitialSessionState()
  }
  const sessionStoreRef = React.useRef<ValueStore<SessionState> | null>(null)
  if (!sessionStoreRef.current) {
    sessionStoreRef.current = createValueStore(initialSessionStateRef.current)
  }
  const sessionStore = sessionStoreRef.current
  const sessionStateRef = React.useRef(sessionStore.getSnapshot())
  const appUiStoreRef = React.useRef<ValueStore<AppShellUiState> | null>(null)
  if (!appUiStoreRef.current) {
    appUiStoreRef.current = createValueStore<AppShellUiState>(
      {
        currentTab: "session",
        gitPanelOpen: false,
        initialLoadingSessionId: sessionId || null,
        loadingSessionId: null,
      },
      shallowRecordEqual
    )
  }
  const appUiStore = appUiStoreRef.current
  const setCurrentTab = React.useCallback<
    React.Dispatch<React.SetStateAction<string>>
  >(
    (action) => {
      setValueStoreField(appUiStore, "currentTab", action)
    },
    [appUiStore]
  )
  const setGitPanelOpen = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      setValueStoreField(appUiStore, "gitPanelOpen", action)
    },
    [appUiStore]
  )
  const setLoadingSessionId = React.useCallback<
    React.Dispatch<React.SetStateAction<string | null>>
  >(
    (action) => {
      setValueStoreField(appUiStore, "loadingSessionId", action)
    },
    [appUiStore]
  )
  const setInitialLoadingSessionId = React.useCallback<
    React.Dispatch<React.SetStateAction<string | null>>
  >(
    (action) => {
      setValueStoreField(appUiStore, "initialLoadingSessionId", action)
    },
    [appUiStore]
  )
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
  const displaySettingsStoreRef =
    React.useRef<ValueStore<AppShellDisplaySettingsState> | null>(null)
  if (!displaySettingsStoreRef.current) {
    displaySettingsStoreRef.current =
      createValueStore<AppShellDisplaySettingsState>(
        {
          autoScrollEnabled: true,
          centerMessages: false,
          hideToolBlocks: false,
        },
        shallowRecordEqual
      )
  }
  const displaySettingsStore = displaySettingsStoreRef.current!
  const displaySettingsRef = React.useRef(displaySettingsStore.getSnapshot())
  const hideToolBlocksRef = React.useRef(
    displaySettingsStore.getSnapshot().hideToolBlocks
  )
  const setHideToolBlocks = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const current = displaySettingsStore.getSnapshot()
      const nextHideToolBlocks = applySidebarStateAction(
        current.hideToolBlocks,
        action
      )
      if (nextHideToolBlocks === current.hideToolBlocks) return
      const next = { ...current, hideToolBlocks: nextHideToolBlocks }
      displaySettingsRef.current = next
      hideToolBlocksRef.current = next.hideToolBlocks
      displaySettingsStore.setSnapshot(next)
    },
    [displaySettingsStore]
  )
  const setCenterMessages = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const current = displaySettingsStore.getSnapshot()
      const nextCenterMessages = applySidebarStateAction(
        current.centerMessages,
        action
      )
      if (nextCenterMessages === current.centerMessages) return
      const next = { ...current, centerMessages: nextCenterMessages }
      displaySettingsRef.current = next
      displaySettingsStore.setSnapshot(next)
    },
    [displaySettingsStore]
  )
  const setAutoScrollEnabled = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const current = displaySettingsStore.getSnapshot()
      const nextAutoScrollEnabled = applySidebarStateAction(
        current.autoScrollEnabled,
        action
      )
      if (nextAutoScrollEnabled === current.autoScrollEnabled) return
      const next = { ...current, autoScrollEnabled: nextAutoScrollEnabled }
      displaySettingsRef.current = next
      displaySettingsStore.setSnapshot(next)
    },
    [displaySettingsStore]
  )
  const awaitingFirstTurnStoreRef = React.useRef<ValueStore<boolean> | null>(
    null
  )
  if (!awaitingFirstTurnStoreRef.current) {
    awaitingFirstTurnStoreRef.current = createValueStore(false)
  }
  const awaitingFirstTurnStore = awaitingFirstTurnStoreRef.current
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
  const notificationStoreRef =
    React.useRef<ValueStore<AppShellNotificationState> | null>(null)
  if (!notificationStoreRef.current) {
    notificationStoreRef.current = createValueStore<AppShellNotificationState>(
      {
        desktopNotificationPermission: "unsupported",
        sessionDoneDesktopNotificationsEnabled: true,
        sessionDoneEvents: [],
        sessionDoneSoundEnabled: true,
      },
      shallowRecordEqual
    )
  }
  const notificationStore = notificationStoreRef.current!
  const setSessionDoneEvents = React.useCallback<
    React.Dispatch<React.SetStateAction<Array<SessionDoneEvent>>>
  >(
    (action) => {
      setValueStoreField(notificationStore, "sessionDoneEvents", action)
    },
    [notificationStore]
  )
  const setSessionDoneSoundEnabled = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      setValueStoreField(notificationStore, "sessionDoneSoundEnabled", action)
    },
    [notificationStore]
  )
  const setSessionDoneDesktopNotificationsEnabled = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      setValueStoreField(
        notificationStore,
        "sessionDoneDesktopNotificationsEnabled",
        action
      )
    },
    [notificationStore]
  )
  const setDesktopNotificationPermission = React.useCallback<
    React.Dispatch<React.SetStateAction<DesktopNotificationPermission>>
  >(
    (action) => {
      setValueStoreField(
        notificationStore,
        "desktopNotificationPermission",
        action
      )
    },
    [notificationStore]
  )
  const draftFlowStoreRef =
    React.useRef<ValueStore<AppShellDraftFlowState> | null>(null)
  if (!draftFlowStoreRef.current) {
    draftFlowStoreRef.current = createValueStore<AppShellDraftFlowState>(
      {
        draftSessionLoadingOwnerKey: null,
        storedDraftDirectory: "",
      },
      shallowRecordEqual
    )
  }
  const draftFlowStore = draftFlowStoreRef.current!
  const setDraftSessionLoadingOwnerKey = React.useCallback<
    React.Dispatch<React.SetStateAction<string | null>>
  >(
    (action) => {
      setValueStoreField(draftFlowStore, "draftSessionLoadingOwnerKey", action)
    },
    [draftFlowStore]
  )
  const setStoredDraftDirectory = React.useCallback<
    React.Dispatch<React.SetStateAction<string>>
  >(
    (action) => {
      setValueStoreField(draftFlowStore, "storedDraftDirectory", action)
    },
    [draftFlowStore]
  )
  const recentDirectoriesStoreRef = React.useRef<ValueStore<
    Array<string>
  > | null>(null)
  if (!recentDirectoriesStoreRef.current) {
    recentDirectoriesStoreRef.current = createValueStore<Array<string>>(
      [],
      sameStringArray
    )
  }
  const recentDirectoriesStore = recentDirectoriesStoreRef.current
  const setRecentDirectories = React.useCallback<
    React.Dispatch<React.SetStateAction<Array<string>>>
  >(
    (action) => {
      const current = recentDirectoriesStore.getSnapshot()
      const next = applySidebarStateAction(current, action)
      if (next === current) return
      recentDirectoriesStore.setSnapshot(next)
    },
    [recentDirectoriesStore]
  )
  const { isMobile, openMobile, openMobileSettled, setOpenMobile } =
    useSidebar()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const composerPanelRef = React.useRef<ComposerPanelHandle | null>(null)
  const composerStoreRef =
    React.useRef<ValueStore<AppShellComposerSnapshot> | null>(null)
  if (!composerStoreRef.current) {
    composerStoreRef.current = createValueStore(
      createInitialAppShellComposerSnapshot(viewerContextId),
      sameAppShellComposerSnapshot
    )
  }
  const composerStore = composerStoreRef.current
  const contextUsageStoreRef = React.useRef<ValueStore<
    SessionState["contextUsage"]
  > | null>(null)
  if (!contextUsageStoreRef.current) {
    contextUsageStoreRef.current =
      createValueStore<SessionState["contextUsage"]>(undefined)
  }
  const contextUsageStore = contextUsageStoreRef.current
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
  const setComposerContextUsage = React.useCallback(
    (contextUsage: SessionState["contextUsage"]) => {
      contextUsageStore.setSnapshot(contextUsage)
    },
    [contextUsageStore]
  )
  const setComposerStreaming = React.useCallback(
    (streaming: boolean) => {
      const currentComposerSnapshot = composerStore.getSnapshot()
      composerStore.setSnapshot({
        ...currentComposerSnapshot,
        isStreaming: currentComposerSnapshot.disabled ? false : streaming,
      })
    },
    [composerStore]
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
  const deleteOldDirectorySessionsDialogRef =
    React.useRef<DeleteOldDirectorySessionsDialogHandle | null>(null)
  const deleteOldDirectorySessionsOpenRef = React.useRef(false)
  const forkDialogRef = React.useRef<ForkSessionDialogHandle | null>(null)
  const forkOpenRef = React.useRef(false)
  const treeDialogRef = React.useRef<AppShellTreeDialogHandle | null>(null)
  const treeOpenRef = React.useRef(false)
  const sessionsDialogRef = React.useRef<AppShellSessionsDialogHandle | null>(
    null
  )
  const sessionsOpenRef = React.useRef(false)
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
  const setSessionState = React.useCallback<
    React.Dispatch<React.SetStateAction<SessionState>>
  >(
    (action) => {
      const currentRefState = sessionStateRef.current
      const nextState =
        typeof action === "function"
          ? (action as (current: SessionState) => SessionState)(currentRefState)
          : action
      const currentStoreState = sessionStore.getSnapshot()
      if (
        Object.is(currentRefState, nextState) &&
        Object.is(currentStoreState, nextState)
      ) {
        return
      }

      sessionStateRef.current = nextState
      sessionStore.setSnapshot(nextState)
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
  const pendingRouteSessionPathRef = React.useRef<string | undefined>(undefined)
  const pendingUiRequestHandlerRef = React.useRef(
    (_request: ExtensionUiEvent) => {}
  )
  pendingUiRequestHandlerRef.current = (request) => {
    uiRequestDialogRef.current?.open(request)
  }
  const autoAddedSessionDirectoryKeysRef = React.useRef<Set<string>>(new Set())
  const pendingMobileSidebarPromptFocusRef = React.useRef(false)
  const conversationItemsStoreRef = React.useRef<ConversationItemsStore | null>(
    null
  )
  if (!conversationItemsStoreRef.current) {
    conversationItemsStoreRef.current = createConversationItemsStore(
      sessionStateRef.current.items
    )
  }
  const conversationItemsStore = conversationItemsStoreRef.current
  const hiddenThinkingPreviewStoreRef = React.useRef<TextValueStore | null>(
    null
  )
  if (!hiddenThinkingPreviewStoreRef.current) {
    hiddenThinkingPreviewStoreRef.current = createTextValueStore(
      sessionStateRef.current.hiddenThinkingPreview || ""
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
  const pendingConversationItemsRef =
    React.useRef<Array<ConversationItem> | null>(null)
  const conversationItemsFrameRef = React.useRef<number | null>(null)
  const setConversationItems = React.useCallback(
    (items: Array<ConversationItem>) => {
      const hasStreamingAssistant = items.some(
        (item) => item.kind === "assistant" && item.streaming
      )

      if (hasStreamingAssistant && typeof window !== "undefined") {
        pendingConversationItemsRef.current = items
        if (conversationItemsFrameRef.current !== null) return

        conversationItemsFrameRef.current = window.requestAnimationFrame(() => {
          conversationItemsFrameRef.current = null
          const pendingItems = pendingConversationItemsRef.current
          pendingConversationItemsRef.current = null
          if (pendingItems) {
            conversationItemsStore.setItems(pendingItems)
          }
        })
        return
      }

      if (
        conversationItemsFrameRef.current !== null &&
        typeof window !== "undefined"
      ) {
        window.cancelAnimationFrame(conversationItemsFrameRef.current)
        conversationItemsFrameRef.current = null
      }
      pendingConversationItemsRef.current = null
      conversationItemsStore.setItems(items)
    },
    [conversationItemsStore]
  )

  React.useEffect(
    () => () => {
      if (
        conversationItemsFrameRef.current !== null &&
        typeof window !== "undefined"
      ) {
        window.cancelAnimationFrame(conversationItemsFrameRef.current)
      }
    },
    []
  )
  const setHiddenThinkingPreview = React.useCallback(
    (value: string, options?: { preserveExisting?: boolean }) => {
      if (options?.preserveExisting && !value) return
      hiddenThinkingPreviewStore.setValue(value)
    },
    [hiddenThinkingPreviewStore]
  )
  const setWorkingState = React.useCallback(
    (state: AppShellWorkingState | null) => {
      workingStateStore.setSnapshot(state)
    },
    [workingStateStore]
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
  const { initialLoadingSessionId, loadingSessionId } = useSelectedValueStore(
    appUiStore,
    (state) => ({
      initialLoadingSessionId: state.initialLoadingSessionId,
      loadingSessionId: state.loadingSessionId,
    }),
    shallowRecordEqual
  )
  const { draftSessionLoadingOwnerKey, storedDraftDirectory } =
    useValueStore(draftFlowStore)
  const sessionState = useSelectedValueStore(
    sessionStore,
    (currentSessionState) => ({
      cwd: currentSessionState.cwd,
      draft: currentSessionState.draft,
      sessionFile: currentSessionState.sessionFile,
      sessionId: currentSessionState.sessionId,
      sessionKey: currentSessionState.sessionKey,
    }),
    shallowRecordEqual
  )
  const gitPanelOpen = useSelectedValueStore(
    appUiStore,
    (state) => state.gitPanelOpen
  )

  React.useEffect(() => {
    if (!sessionState.draft) return
    setGitPanelOpen(false)
  }, [sessionState.draft, setGitPanelOpen])

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
  const sessionsEventDirectories = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.sessionsEvent?.directories || [],
    sameStringArray
  )
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
  const contextUsageSessionScopeRef = React.useRef("")
  React.useLayoutEffect(() => {
    if (contextUsageSessionScopeRef.current === currentSessionQueryScope) return
    contextUsageSessionScopeRef.current = currentSessionQueryScope
    contextUsageStore.setSnapshot(sessionStateRef.current.contextUsage)
  }, [contextUsageStore, currentSessionQueryScope])
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
  const loadingSessionTitle = getSessionTitle(loadingSessionSummary)
  const loadingDisplaySessionTitle =
    loadingSessionTitle !== "New session"
      ? loadingSessionTitle
      : "Loading session…"
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
    if (isMobile) return
    setCurrentTab((tab) => (tab === "git" ? "session" : tab))
  }, [isMobile, setCurrentTab])

  const syncComposerDraft = (
    value: string,
    target = sessionStateRef.current
  ) => {
    const parsed = parseComposerSkillMessage(value)
    const nextText = parsed.matched ? parsed.text : value
    const nextSkill = parsed.matched ? parsed.skillName : undefined

    composerTextRef.current = nextText
    composerSkillRef.current = nextSkill

    const currentDraftSeed = composerDraftSeedStore.getSnapshot()
    if (
      currentDraftSeed.text !== nextText ||
      currentDraftSeed.skillName !== nextSkill
    ) {
      composerDraftSeedStore.setSnapshot({
        ...currentDraftSeed,
        text: nextText,
        skillName: nextSkill,
      })
    }

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
      const forceSync = options?.forceSync === true

      if (draftUnchanged && !forceSync) {
        return current
      }

      return {
        text: nextText,
        skillName: nextSkill,
        syncNonce: forceSync ? current.syncNonce + 1 : current.syncNonce,
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
    setAutoScrollEnabled(readStoredAutoScrollEnabled())
    setRecentDirectories(readStoredRecentDirectories())
    setDesktopNotificationPermission(getDesktopNotificationPermission())
  }, [])

  const openCommandPalette = () => {
    sessionsDialogRef.current?.close()
    settingsDialogRef.current?.close()
    commandPaletteRef.current?.open()
  }

  const closeCommandPalette = () => {
    commandPaletteRef.current?.close()
  }

  const openSessionsDialog = () => {
    commandPaletteRef.current?.close()
    settingsDialogRef.current?.close()
    sessionsDialogRef.current?.open()
  }

  const openSettingsDialog = () => {
    commandPaletteRef.current?.close()
    sessionsDialogRef.current?.close()
    settingsDialogRef.current?.open()
  }

  const toggleGitPanel = () => {
    if (isMobile) {
      setCurrentTab((tab) => (tab === "git" ? "session" : "git"))
      return
    }

    setGitPanelOpen((open) => !open)
  }

  const openRenameDialog = () => {
    const currentState = sessionStateRef.current
    if (!currentState.sessionFile) return
    renameDialogRef.current?.open({
      path: currentState.sessionFile,
      title:
        currentState.sessionName ||
        getCurrentSessionTitleFromState(currentState),
    })
  }

  const openRenameDialogForEntry = (entry: SessionListEntry) => {
    renameDialogRef.current?.openForEntry(entry)
  }

  const openDeleteDialog = (targets: Array<SessionListEntry>) => {
    deleteDialogRef.current?.open(targets)
  }

  const openDeleteOldDirectorySessionsDialog = (directory: string) => {
    deleteOldDirectorySessionsDialogRef.current?.open(directory)
  }

  const openDeleteDialogForCurrentSession = () => {
    const currentState = sessionStateRef.current
    if (!currentState.sessionFile) return

    openDeleteDialog([
      {
        path: currentState.sessionFile,
        id: currentState.sessionId,
        title: getCurrentSessionTitleFromState(currentState),
        name: currentState.sessionName,
        modified: currentState.modified,
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
    openSessionsDialog()
  }

  const focusPrompt = () => {
    if (appUiStore.getSnapshot().currentTab !== "session") {
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
  const [promptFocusRequest, setPromptFocusRequest] = React.useState({
    sessionId: "",
    nonce: 0,
  })
  const lastAutoFocusedSessionKeyRef = React.useRef<string | null>(null)

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

  React.useEffect(() => {
    if (isSessionViewLoading) return

    const sessionFocusKey =
      sessionState.sessionKey || sessionState.sessionId || "draft"
    if (lastAutoFocusedSessionKeyRef.current === sessionFocusKey) return

    lastAutoFocusedSessionKeyRef.current = sessionFocusKey
    focusPromptRef.current()
  }, [
    focusPromptRef,
    isSessionViewLoading,
    sessionState.sessionId,
    sessionState.sessionKey,
  ])

  React.useEffect(() => {
    if (!promptFocusRequest.nonce || isSessionViewLoading) return
    if (
      promptFocusRequest.sessionId &&
      sessionState.sessionId !== promptFocusRequest.sessionId
    ) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      focusPromptRef.current()
    }, 50)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    focusPromptRef,
    isSessionViewLoading,
    promptFocusRequest,
    sessionState.sessionId,
  ])

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

  const syncSidebarSelectionForSession = React.useCallback(
    (nextSessionId?: string, options?: SelectSessionNavigationOptions) => {
      const nextKey = nextSessionId
        ? findSidebarSessionSelectionKey(
            sidebarStore.getSnapshot().derived.sidebarSessionEntriesByKey,
            {
              sessionId: nextSessionId,
              sessionPath: options?.sessionPath,
            }
          )
        : ""

      sidebarStore.setSelectedSidebarSessionKeys((current) => {
        if (!nextKey) return current.length === 0 ? current : []
        return sameStringArray(current, [nextKey]) ? current : [nextKey]
      })
      sidebarStore.setSidebarSessionSelectionAnchor((current) =>
        current === nextKey ? current : nextKey
      )
    },
    [sidebarStore]
  )

  const handleSelectSession = React.useCallback(
    (nextSessionId?: string, options?: SelectSessionNavigationOptions) => {
      setCurrentTab((tab) => (tab === "git" ? "session" : tab))
      syncSidebarSelectionForSession(nextSessionId, options)

      pendingRouteSessionIdRef.current = nextSessionId
      pendingRouteSessionPathRef.current =
        options?.sessionPath?.trim() || undefined
      if (nextSessionId) {
        setPromptFocusRequest((current) => ({
          sessionId: nextSessionId,
          nonce: current.nonce + 1,
        }))
      }
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
    [onSelectSession, sessionStateRef, syncSidebarSelectionForSession]
  )
  const handleSelectSessionRef = useLatestRef(handleSelectSession)

  useAppShellSessionSync({
    viewerContextId,
    sessionId,
    draftSessionLoadingOwnerKey,
    bootstrapSidebarDirectories:
      sidebarStore.getSnapshot().state.initialSidebarBootstrapDirectories,
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
    setSessionsEvent: sidebarStore.setSessionsEvent,
    setSessionDoneEvents,
    applySidebarSessionStatusRef,
    setComposerImages,
    setPendingMessages,
    pendingUiRequestHandlerRef,
    lastSyncedEditorTextRef,
  })

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
        ...sessionsEventDirectories,
        sessionState.cwd || "",
        storedDraftDirectory,
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
      sessionsEventDirectories,
      storedDraftDirectory,
    ]
  )

  const sessionsDialogDirectory =
    sessionState.cwd?.trim() ||
    (baseSidebarDirectories.length > 0
      ? (baseSidebarDirectories[0] ?? "")
      : storedDraftDirectory) ||
    defaultNewSessionDirectory

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
    editPendingMessage,
    removePendingMessage,
    reorderPending,
    submitPrompt,
  } = useAppShellPromptMutations({
    viewerContextId,
    activeSessionId,
    defaultNewSessionDirectory,
    sessionStore,
    sessionStateRef,
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

      handleSelectSession(undefined, { replace: true })
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
      handleSelectSession,
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
      pendingId: pendingDraftFollowUpId(message, index),
      text: message.message,
      images: message.images,
      streamingBehavior: message.streamingBehavior,
    })
  )
  const currentPendingMessages =
    pendingDraftFollowUpMessages.length > 0 || pendingMessages.length > 0
      ? [...pendingDraftFollowUpMessages, ...pendingMessages]
      : EMPTY_COMPOSER_PENDING_MESSAGES
  const composerDisabled = isSessionViewLoading
  const displayedPendingMessages = composerDisabled
    ? EMPTY_COMPOSER_PENDING_MESSAGES
    : currentPendingMessages
  const displayedComposerImages = composerDisabled
    ? EMPTY_COMPOSER_IMAGES
    : composerImages
  const displayedComposerText = composerDisabled ? "" : composerDraftSeed.text
  const displayedComposerSkill = composerDisabled
    ? undefined
    : composerDraftSeed.skillName

  const editPendingDraftFollowUp = (pendingId: string, text: string) => {
    const existing = pendingDraftFollowUps.find(
      (message, index) => pendingDraftFollowUpId(message, index) === pendingId
    )
    if (!existing) return false

    if (!text.trim() && existing.images.length === 0) {
      toast.error("Enter a message or keep at least one image")
      return true
    }

    setPendingDraftFollowUps((current) =>
      current.map((message, index) =>
        pendingDraftFollowUpId(message, index) === pendingId
          ? { ...message, message: text }
          : message
      )
    )
    return true
  }

  const removePendingDraftFollowUp = (pendingId: string) => {
    if (
      !pendingDraftFollowUps.some(
        (message, index) => pendingDraftFollowUpId(message, index) === pendingId
      )
    ) {
      return false
    }

    setPendingDraftFollowUps((current) =>
      current.filter(
        (message, index) => pendingDraftFollowUpId(message, index) !== pendingId
      )
    )
    return true
  }

  const reorderPendingDraftFollowUp = (
    pendingId: string,
    direction: -1 | 1
  ) => {
    const nextPendingDraftFollowUps = movePendingDraftFollowUpMessage(
      pendingDraftFollowUps,
      pendingId,
      direction
    )
    if (!nextPendingDraftFollowUps) return false

    setPendingDraftFollowUps(nextPendingDraftFollowUps)
    return true
  }

  const setCompactWorkingState = React.useCallback(
    (running: boolean) => {
      if (running) {
        workingStateStore.setSnapshot({ label: "Compacting context…" })
        return
      }

      if (workingStateStore.getSnapshot()?.label === "Compacting context…") {
        workingStateStore.setSnapshot(null)
      }
    },
    [workingStateStore]
  )

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
    setSessionState,
    getDirectoryIndexDataByPath: () =>
      sidebarStore.getSnapshot().state.directoryIndexDataByPath,
    setDirectoryIndexDataByPath: sidebarStore.setDirectoryIndexDataByPath,
    getSessionsEvent: () => sidebarStore.getSnapshot().state.sessionsEvent,
    setSessionsEvent: sidebarStore.setSessionsEvent,
    getSidebarSelection: () => {
      const sidebarState = sidebarStore.getSnapshot().state
      return {
        selectedSidebarSessionKeys: sidebarState.selectedSidebarSessionKeys,
        sidebarSessionSelectionAnchor:
          sidebarState.sidebarSessionSelectionAnchor,
      }
    },
    optimisticallyClearActiveDeletedSession: (targetPath) => {
      const previousState = sessionStateRef.current
      if (previousState.sessionFile !== targetPath) return undefined

      const ownerKey = `delete:${targetPath}`
      const optimisticSessionKey = `optimistic:${ownerKey}`
      handleSelectSession(undefined, { replace: true })
      const nextState = createOptimisticDraftSessionState({
        previous: previousState,
        cwd: previousState.cwd,
        ownerKey,
      })
      sessionStateRef.current = nextState
      conversationItemsStore.setItems(nextState.items)
      setSessionState(nextState)

      return () => {
        if (sessionStateRef.current.sessionKey !== optimisticSessionKey) return
        if (previousState.sessionId) {
          handleSelectSession(previousState.sessionId, {
            replace: true,
            sessionPath: previousState.sessionFile,
          })
        }
        sessionStateRef.current = previousState
        conversationItemsStore.setItems(previousState.items)
        setSessionState(previousState)
      }
    },
    setSelectedSidebarSessionKeys: sidebarStore.setSelectedSidebarSessionKeys,
    setSidebarSessionSelectionAnchor:
      sidebarStore.setSidebarSessionSelectionAnchor,
    setCompactWorkingState,
  })

  const setToolBlocksHidden = (hidden: boolean) => {
    setHideToolBlocks(hidden)
    safeLocalStorageSetItem(HIDE_TOOL_BLOCKS_STORAGE_KEY, hidden ? "1" : "0")
  }

  const toggleHideToolBlocks = () => {
    const currentHidden = displaySettingsRef.current.hideToolBlocks
    setToolBlocksHidden(!currentHidden)
    toast.info(currentHidden ? "Tools shown" : "Tools hidden")
  }

  const setMessagesCentered = (centered: boolean) => {
    setCenterMessages(centered)
    safeLocalStorageSetItem(CENTER_MESSAGES_STORAGE_KEY, centered ? "1" : "0")
  }

  const setAutoScroll = (enabled: boolean) => {
    setAutoScrollEnabled(enabled)
    safeLocalStorageSetItem(
      AUTO_SCROLL_ENABLED_STORAGE_KEY,
      enabled ? "1" : "0"
    )
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
        if (!sessionStateRef.current.hideThinkingBlock) {
          await toggleHideThinking()
        }
        return
      }
      case "show-thinking": {
        replaceComposerDraft("")
        if (sessionStateRef.current.hideThinkingBlock) {
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

  const handleThemeChange = (value: ThemeMode) => {
    setTheme(value)
  }

  const composerSnapshot = {
    activeSessionId,
    awaitingFirstTurn: composerDisabled ? false : awaitingFirstTurn,
    centerMessages: displaySettingsRef.current.centerMessages,
    composerImages: displayedComposerImages,
    composerSkill: displayedComposerSkill,
    composerSyncNonce: composerDraftSeed.syncNonce,
    composerText: displayedComposerText,
    currentPendingMessages: displayedPendingMessages,
    disabled: composerDisabled,
    isStreaming: composerDisabled ? false : sessionStateRef.current.streaming,
    isSubmitting: composerDisabled ? false : isSubmitting,
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
    editPendingDraftFollowUp,
    editPendingMessage,
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

  const commandPaletteStateRef = useLatestRef({
    gitPanelOpen,
    hasAvailableModels: sessionStateRef.current.availableModels.length > 0,
    isMobile,
    selectedSidebarSessions,
    sessionFile: sessionState.sessionFile,
  })

  const buildCommandPaletteCommands = () => {
    const commandState = commandPaletteStateRef.current
    const currentHideThinkingBlock = sessionStateRef.current.hideThinkingBlock
    const currentThinkingLevel = sessionStateRef.current.thinkingLevel
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
        id: "open-sessions",
        group: "Sessions",
        title: "Open sessions",
        description: "Search and switch sessions",
        shortcut: "Ctrl+S",
        keywords: ["session", "search", "switch", "jump"],
        onSelect: openSessionsDialog,
      },
      {
        id: "open-git-view",
        group: "Git",
        title: commandState.isMobile
          ? "Toggle Git tab"
          : commandState.gitPanelOpen
            ? "Close Git panel"
            : "Open Git panel",
        description: commandState.isMobile
          ? "Switch the mobile Git tab on or off"
          : "Toggle the right-side Git panel",
        shortcut: "Ctrl+\\",
        keywords: ["git", "changes", "branch", "commit", "panel"],
        onSelect: toggleGitPanel,
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
        title: currentHideThinkingBlock
          ? "Show thinking blocks"
          : "Hide thinking blocks",
        description: currentHideThinkingBlock
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
        description: `Current level: ${currentThinkingLevel}`,
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
        description: `Current level: ${currentThinkingLevel}`,
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
        title: displaySettingsRef.current.hideToolBlocks
          ? "Show tool calls"
          : "Hide tool calls",
        description: displaySettingsRef.current.hideToolBlocks
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
        description: `Delete ${getCurrentSessionTitleFromState(
          sessionStateRef.current
        )}`,
        shortcut: "Ctrl+X",
        keywords: ["delete", "remove", "session"],
        onSelect: openDeleteDialogForCurrentSession,
      })
    }

    if (commandState.selectedSidebarSessions.length > 0) {
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
    abortSession,
    createSession,
    closeCommandPalette,
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
    openSessionsDialog,
    openSettingsDialog,
    openTreeDialog,
    runCompact,
    scrollConversationToBottom: () => {
      conversationFrameRef.current?.scrollConversationToBottom()
    },
    scrollConversationToTop: () => {
      conversationFrameRef.current?.scrollConversationToTop()
    },
    toggleGitPanel,
    toggleHideThinking,
    toggleHideToolBlocks,
    cycleThinkingLevel,
  })

  const shortcutStateRef = useLatestRef<AppShellShortcutState>({
    currentTab: isMobile ? appUiStore.getSnapshot().currentTab : "session",
    selectedSidebarSessions,
    sessionHasAvailableModels:
      sessionStateRef.current.availableModels.length > 0,
    sessionHasFile: Boolean(sessionState.sessionFile),
    sessionIsStreaming: sessionStateRef.current.streaming,
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
    renameOpenRef,
    sessionSearchInputRef,
    sessionsOpenRef,
    settingsOpenRef,
    shortcutActionsRef,
    shortcutStateRef,
    treeOpenRef,
  })

  const appShellControllerRef = React.useRef<AppShellController | null>(null)
  appShellControllerRef.current = {
    stores: {
      appUi: appUiStore,
      composer: composerStore,
      contextUsage: contextUsageStore,
      conversationItems: conversationItemsStore,
      displaySettings: displaySettingsStore,
      draftFlow: draftFlowStore,
      notification: notificationStore,
      session: sessionStore,
      sidebar: sidebarStore,
    },
    refs: {
      composerImages: composerImagesRef,
      composerPanel: composerPanelRef,
      composerSkill: composerSkillRef,
      composerText: composerTextRef,
      conversationFrame: conversationFrameRef,
      sessionState: sessionStateRef,
    },
    actions: {
      createSession,
      focusModelSelector,
      focusPrompt,
      focusSessionSearch,
      openAddDirectoryDialog,
      openCommandPalette,
      openDeleteDialog,
      openDeleteOldDirectorySessionsDialog,
      openRenameDialogForEntry,
      openSessionsDialog,
      openSettingsDialog,
      selectSession: handleSelectSession,
    },
  }

  React.useImperativeHandle(ref, () => {
    const actions = appShellControllerRef.current?.actions
    return {
      createSession: actions?.createSession ?? createSession,
      openAddDirectoryDialog:
        actions?.openAddDirectoryDialog ?? openAddDirectoryDialog,
      openCommandPalette: actions?.openCommandPalette ?? openCommandPalette,
      openDeleteDialog: actions?.openDeleteDialog ?? openDeleteDialog,
      openDeleteOldDirectorySessionsDialog:
        actions?.openDeleteOldDirectorySessionsDialog ??
        openDeleteOldDirectorySessionsDialog,
      openRenameDialogForEntry:
        actions?.openRenameDialogForEntry ?? openRenameDialogForEntry,
      openSessionsDialog: actions?.openSessionsDialog ?? openSessionsDialog,
      openSettingsDialog: actions?.openSettingsDialog ?? openSettingsDialog,
      selectSession: actions?.selectSession ?? handleSelectSession,
    }
  }, [
    createSession,
    handleSelectSession,
    openAddDirectoryDialog,
    openCommandPalette,
    openDeleteDialog,
    openDeleteOldDirectorySessionsDialog,
    openRenameDialogForEntry,
    openSessionsDialog,
    openSettingsDialog,
  ])

  return (
    <>
      <AppShellWindowEffectsHost
        isSessionViewLoading={isSessionViewLoading}
        loadingDisplaySessionTitle={loadingDisplaySessionTitle}
        notificationStore={notificationStore}
        sessionStore={sessionStore}
        sidebarStore={sidebarStore}
        onSelectSession={handleSelectSession}
      />

      <AppShellSessionHeader
        actionsRef={sessionHeaderActionsRef}
        defaultNewSessionDirectory={defaultNewSessionDirectory}
        displaySessionCwd={displaySessionCwd}
        gitPanelOpen={gitPanelOpen}
        loadingDisplaySessionTitle={loadingDisplaySessionTitle}
        displaySettingsStore={displaySettingsStore}
        isSessionViewLoading={isSessionViewLoading}
        newSessionDirectoryOptions={newSessionDirectoryOptions}
        onToggleGitPanel={toggleGitPanel}
        sessionStore={sessionStore}
        viewerContextId={viewerContextId}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {sidebar}
        <SidebarInset className="min-h-0 overflow-hidden">
          <AppShellTabsController
            actionsRef={composerActionsRef}
            appUiStore={appUiStore}
            composerPanelRef={composerPanelRef}
            contextUsageStore={contextUsageStore}
            conversationFrameRef={conversationFrameRef}
            conversationItemsStore={conversationItemsStore}
            defaultNewSessionDirectory={defaultNewSessionDirectory}
            displaySettingsStore={displaySettingsStore}
            fileInputRef={fileInputRef}
            gitPanelOpen={gitPanelOpen}
            hiddenThinkingPreviewStore={hiddenThinkingPreviewStore}
            isSessionViewLoading={isSessionViewLoading}
            isSubmitting={isSubmitting}
            isMobile={isMobile}
            newSessionDirectoryOptions={newSessionDirectoryOptions}
            onCreateSession={(cwdOverride) => {
              void createSession(cwdOverride)
            }}
            sessionStore={sessionStore}
            store={composerStore}
            viewerContextId={viewerContextId}
            workingStateStore={workingStateStore}
            awaitingFirstTurn={awaitingFirstTurn}
            onValueChange={setCurrentTab}
          />
        </SidebarInset>
      </div>

      <AppShellFloatingControllers
        activeSessionId={activeSessionId}
        addDirectoryDialogRef={addDirectoryDialogRef}
        addDirectoryOpenRef={addDirectoryOpenRef}
        addDirectoryPath={addDirectoryPath}
        baseSidebarDirectories={baseSidebarDirectories}
        commandPaletteCommandsRef={commandPaletteCommandsRef}
        commandPaletteOpenRef={commandPaletteOpenRef}
        commandPaletteRef={commandPaletteRef}
        currentSessionQueryScope={currentSessionQueryScope}
        currentTheme={currentTheme}
        deleteDialogRef={deleteDialogRef}
        deleteOpenRef={deleteOpenRef}
        deleteSessions={deleteSessions}
        deleteOldDirectorySessionsDialogRef={
          deleteOldDirectorySessionsDialogRef
        }
        deleteOldDirectorySessionsOpenRef={deleteOldDirectorySessionsOpenRef}
        notificationStore={notificationStore}
        forkDialogRef={forkDialogRef}
        forkOpenRef={forkOpenRef}
        displaySettingsStore={displaySettingsStore}
        knownDirectories={knownDirectories}
        onAutoScrollEnabledChange={setAutoScroll}
        onCenterMessagesChange={setMessagesCentered}
        onHideThinkingBlocksChange={(hidden) => {
          void setThinkingBlocksHidden(hidden)
        }}
        onHideToolBlocksChange={setToolBlocksHidden}
        onSessionDoneDesktopNotificationsEnabledChange={
          handleSessionDoneDesktopNotificationsEnabledChange
        }
        onSessionDoneSoundEnabledChange={handleSessionDoneSoundEnabledChange}
        onSessionDialogSelect={handleSelectSession}
        onThemeChange={handleThemeChange}
        recentDirectoriesStore={recentDirectoriesStore}
        renameDialogRef={renameDialogRef}
        renameOpenRef={renameOpenRef}
        renameSessionPath={renameSessionPath}
        sessionCwd={sessionState.cwd}
        sessionsDialogDirectory={sessionsDialogDirectory}
        sessionsDialogRef={sessionsDialogRef}
        sessionsOpenRef={sessionsOpenRef}
        sessionStore={sessionStore}
        settingsDialogRef={settingsDialogRef}
        settingsOpenRef={settingsOpenRef}
        sidebarStore={sidebarStore}
        treeDialogRef={treeDialogRef}
        treeOpenRef={treeOpenRef}
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
  actionsRef: React.RefObject<AppShellSessionHeaderActions>
  defaultNewSessionDirectory: string
  displaySessionCwd?: string
  gitPanelOpen: boolean
  loadingDisplaySessionTitle: string
  displaySettingsStore: ValueStore<AppShellDisplaySettingsState>
  isSessionViewLoading: boolean
  newSessionDirectoryOptions: Array<{ path: string; label: string }>
  onToggleGitPanel: () => void
  sessionStore: ValueStore<SessionState>
  viewerContextId: string
}

const AppShellSessionHeader = React.memo(function AppShellSessionHeader({
  actionsRef,
  defaultNewSessionDirectory,
  displaySessionCwd,
  gitPanelOpen,
  loadingDisplaySessionTitle,
  displaySettingsStore,
  isSessionViewLoading,
  newSessionDirectoryOptions,
  onToggleGitPanel,
  sessionStore,
  viewerContextId,
}: AppShellSessionHeaderProps) {
  const sessionHeaderState = useSelectedValueStore(
    sessionStore,
    (sessionState) => ({
      firstMessage: sessionState.firstMessage,
      hideThinkingBlock: sessionState.hideThinkingBlock,
      sessionHasFile: Boolean(sessionState.sessionFile),
      sessionName: sessionState.sessionName,
      sessionStreaming: sessionState.streaming,
    }),
    shallowRecordEqual
  )
  const hideToolBlocks = useSelectedValueStore(
    displaySettingsStore,
    (settings) => settings.hideToolBlocks
  )
  const {
    isMobile: sidebarIsMobile,
    openMobile: sidebarOpenMobile,
    state: sidebarState,
  } = useSidebar()
  const sidebarOpen = sidebarIsMobile
    ? sidebarOpenMobile
    : sidebarState === "expanded"
  const showCollapsedNewSessionButton = sidebarState === "collapsed"
  const displaySessionTitle = isSessionViewLoading
    ? loadingDisplaySessionTitle
    : getCurrentSessionTitleFromState(sessionHeaderState)

  return (
    <div className="sticky top-0 z-50 flex min-h-[var(--header-height)] w-full shrink-0 items-center border-b border-border/70 bg-background p-2">
      <div className="relative flex w-full items-center gap-1">
        <SidebarTrigger
          variant={sidebarOpen ? "secondary" : "ghost"}
          className="shrink-0"
        />
        {showCollapsedNewSessionButton ? (
          <Button
            size="icon-sm"
            variant="ghost"
            className="shrink-0"
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
        ) : null}
        <div className="absolute left-1/2 flex w-max max-w-[calc(100%-4rem)] -translate-x-1/2 flex-col items-center justify-center gap-0 text-center">
          <div className="flex max-w-full min-w-0 items-center justify-center gap-1.5">
            {!isSessionViewLoading && sessionHeaderState.sessionStreaming ? (
              <Spinner
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label="Session streaming"
              />
            ) : null}
            <h2
              className="min-w-0 truncate text-[13px] leading-tight font-semibold"
              title={displaySessionTitle}
            >
              {displaySessionTitle}
            </h2>
          </div>
          <div className="flex max-w-full min-w-0 items-center justify-center gap-x-3">
            {displaySessionCwd ? (
              <span className="inline-flex min-w-0 items-center text-xs text-muted-foreground">
                <span className="truncate">
                  {formatFolderName(displaySessionCwd)}
                </span>
              </span>
            ) : null}
            <HeaderGitStatusText
              viewerContextId={viewerContextId}
              cwd={displaySessionCwd}
            />
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
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
                <DropdownMenuShortcut>Ctrl+C</DropdownMenuShortcut>
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
                <DropdownMenuShortcut>Ctrl+F</DropdownMenuShortcut>
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
            variant={gitPanelOpen ? "secondary" : "ghost"}
            className="hidden md:inline-flex"
            aria-pressed={gitPanelOpen}
            aria-label={gitPanelOpen ? "Close Git panel" : "Open Git panel"}
            title={
              gitPanelOpen ? "Close Git panel" : "Open Git panel (Ctrl+\\)"
            }
            onClick={onToggleGitPanel}
          >
            <PanelRightIcon />
          </Button>
        </div>
      </div>
    </div>
  )
})

type AppShellFloatingControllersProps = {
  activeSessionId?: string
  addDirectoryDialogRef: React.RefObject<AppShellAddDirectoryDialogHandle | null>
  addDirectoryOpenRef: React.RefObject<boolean>
  addDirectoryPath: React.ComponentProps<
    typeof AppShellAddDirectoryDialogController
  >["onAddDirectoryPath"]
  baseSidebarDirectories: Array<string>
  commandPaletteCommandsRef: React.RefObject<() => Array<AppCommand>>
  commandPaletteOpenRef: React.RefObject<boolean>
  commandPaletteRef: React.RefObject<AppShellCommandPaletteHandle | null>
  currentSessionQueryScope: string
  currentTheme: ThemeMode
  deleteDialogRef: React.RefObject<DeleteSessionsDialogHandle | null>
  deleteOpenRef: React.RefObject<boolean>
  deleteSessions: React.ComponentProps<
    typeof DeleteSessionsDialogController
  >["onDeleteSession"]
  deleteOldDirectorySessionsDialogRef: React.RefObject<DeleteOldDirectorySessionsDialogHandle | null>
  deleteOldDirectorySessionsOpenRef: React.RefObject<boolean>
  notificationStore: ValueStore<AppShellNotificationState>
  forkDialogRef: React.RefObject<ForkSessionDialogHandle | null>
  forkOpenRef: React.RefObject<boolean>
  displaySettingsStore: ValueStore<AppShellDisplaySettingsState>
  knownDirectories: Array<string>
  onAutoScrollEnabledChange: (enabled: boolean) => void
  onCenterMessagesChange: (centered: boolean) => void
  onHideThinkingBlocksChange: (hidden: boolean) => void
  onHideToolBlocksChange: (hidden: boolean) => void
  onSessionDoneDesktopNotificationsEnabledChange: (enabled: boolean) => void
  onSessionDoneSoundEnabledChange: (enabled: boolean) => void
  onSessionDialogSelect: (
    sessionId?: string,
    options?: SelectSessionNavigationOptions
  ) => void
  onThemeChange: (value: ThemeMode) => void
  recentDirectoriesStore: ValueStore<Array<string>>
  renameDialogRef: React.RefObject<RenameSessionDialogHandle | null>
  renameOpenRef: React.RefObject<boolean>
  renameSessionPath: React.ComponentProps<
    typeof RenameSessionDialogController
  >["onRenameSession"]
  sessionCwd?: string
  sessionsDialogDirectory: string
  sessionsDialogRef: React.RefObject<AppShellSessionsDialogHandle | null>
  sessionsOpenRef: React.RefObject<boolean>
  sessionStore: ValueStore<SessionState>
  settingsDialogRef: React.RefObject<AppShellSettingsDialogHandle | null>
  settingsOpenRef: React.RefObject<boolean>
  sidebarStore: AppShellSidebarStore
  treeDialogRef: React.RefObject<AppShellTreeDialogHandle | null>
  treeOpenRef: React.RefObject<boolean>
  uiRequestDialogRef: React.RefObject<AppShellUiRequestDialogHandle | null>
  uiRequestOpenRef: React.RefObject<boolean>
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

const AppShellSessionsDialogHost = React.memo(
  function AppShellSessionsDialogHost({
    activeSessionId,
    knownDirectories,
    sessionsDialogDirectory,
    sessionsDialogRef,
    sessionsOpenRef,
    sidebarStore,
    viewerContextId,
    deleteSessions,
    onSessionDialogSelect,
    renameSessionPath,
  }: Pick<
    AppShellFloatingControllersProps,
    | "activeSessionId"
    | "knownDirectories"
    | "sessionsDialogDirectory"
    | "sessionsDialogRef"
    | "sessionsOpenRef"
    | "sidebarStore"
    | "viewerContextId"
    | "deleteSessions"
    | "onSessionDialogSelect"
    | "renameSessionPath"
  >) {
    const sessionsDialogSnapshot = useAppShellSidebarValue(
      sidebarStore,
      (snapshot) => ({
        activeSessionId:
          snapshot.state.sessionsEvent?.activeSessionId || activeSessionId,
        activeSessionPath:
          snapshot.state.sessionsEvent?.activeSessionPath || "",
        directorySessionsByPath: snapshot.derived.sidebarDirectoryIndexes,
        sessionStatusByKey: snapshot.state.sidebarSessionStatusByKey,
      })
    )

    return (
      <AppShellSessionsDialogController
        ref={sessionsDialogRef}
        openStateRef={sessionsOpenRef}
        viewerContextId={viewerContextId}
        currentDirectory={sessionsDialogDirectory}
        knownDirectories={knownDirectories}
        directorySessionsByPath={sessionsDialogSnapshot.directorySessionsByPath}
        sessionStatusByKey={sessionsDialogSnapshot.sessionStatusByKey}
        activeSessionId={sessionsDialogSnapshot.activeSessionId}
        activeSessionPath={sessionsDialogSnapshot.activeSessionPath}
        onSelectSession={onSessionDialogSelect}
        onRenameSession={renameSessionPath}
        onDeleteSession={deleteSessions}
        onError={(error) => {
          toast.error(
            error instanceof Error ? error.message : "Failed to load sessions"
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
    recentDirectoriesStore,
    sessionCwd,
  }: Pick<
    AppShellFloatingControllersProps,
    | "addDirectoryDialogRef"
    | "addDirectoryOpenRef"
    | "addDirectoryPath"
    | "baseSidebarDirectories"
    | "knownDirectories"
    | "recentDirectoriesStore"
    | "sessionCwd"
  >) {
    const recentDirectories = useValueStore(recentDirectoriesStore)
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

const AppShellDeleteOldDirectorySessionsDialogHost = React.memo(
  function AppShellDeleteOldDirectorySessionsDialogHost({
    deleteOldDirectorySessionsDialogRef,
    deleteOldDirectorySessionsOpenRef,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "deleteOldDirectorySessionsDialogRef"
    | "deleteOldDirectorySessionsOpenRef"
    | "viewerContextId"
  >) {
    return (
      <DeleteOldDirectorySessionsDialogController
        ref={deleteOldDirectorySessionsDialogRef}
        openStateRef={deleteOldDirectorySessionsOpenRef}
        viewerContextId={viewerContextId}
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
  sessionStore,
  treeDialogRef,
  treeOpenRef,
  viewerContextId,
}: Pick<
  AppShellFloatingControllersProps,
  | "activeSessionId"
  | "currentSessionQueryScope"
  | "sessionStore"
  | "treeDialogRef"
  | "treeOpenRef"
  | "viewerContextId"
>) {
  const treeSummaryAvailable = useSelectedValueStore(
    sessionStore,
    (sessionState) => sessionState.availableModels.length > 0
  )

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
    currentTheme,
    displaySettingsStore,
    notificationStore,
    onAutoScrollEnabledChange,
    onCenterMessagesChange,
    onHideThinkingBlocksChange,
    onHideToolBlocksChange,
    onSessionDoneDesktopNotificationsEnabledChange,
    onSessionDoneSoundEnabledChange,
    onThemeChange,
    sessionStore,
    settingsDialogRef,
    settingsOpenRef,
  }: Pick<
    AppShellFloatingControllersProps,
    | "currentTheme"
    | "displaySettingsStore"
    | "notificationStore"
    | "onAutoScrollEnabledChange"
    | "onCenterMessagesChange"
    | "onHideThinkingBlocksChange"
    | "onHideToolBlocksChange"
    | "onSessionDoneDesktopNotificationsEnabledChange"
    | "onSessionDoneSoundEnabledChange"
    | "onThemeChange"
    | "sessionStore"
    | "settingsDialogRef"
    | "settingsOpenRef"
  >) {
    const hideThinkingBlocks = useSelectedValueStore(
      sessionStore,
      (sessionState) => sessionState.hideThinkingBlock
    )
    const { autoScrollEnabled, centerMessages, hideToolBlocks } =
      useValueStore(displaySettingsStore)
    const {
      desktopNotificationPermission,
      sessionDoneDesktopNotificationsEnabled,
      sessionDoneSoundEnabled,
    } = useSelectedValueStore(
      notificationStore,
      (state) => ({
        desktopNotificationPermission: state.desktopNotificationPermission,
        sessionDoneDesktopNotificationsEnabled:
          state.sessionDoneDesktopNotificationsEnabled,
        sessionDoneSoundEnabled: state.sessionDoneSoundEnabled,
      }),
      shallowRecordEqual
    )

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
        autoScrollEnabled={autoScrollEnabled}
        onAutoScrollEnabledChange={onAutoScrollEnabledChange}
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
    commandPaletteCommandsRef,
    commandPaletteOpenRef,
    commandPaletteRef,
    currentSessionQueryScope,
    currentTheme,
    deleteDialogRef,
    deleteOpenRef,
    deleteSessions,
    deleteOldDirectorySessionsDialogRef,
    deleteOldDirectorySessionsOpenRef,
    notificationStore,
    forkDialogRef,
    forkOpenRef,
    displaySettingsStore,
    knownDirectories,
    onAutoScrollEnabledChange,
    onCenterMessagesChange,
    onHideThinkingBlocksChange,
    onHideToolBlocksChange,
    onSessionDoneDesktopNotificationsEnabledChange,
    onSessionDoneSoundEnabledChange,
    onSessionDialogSelect,
    onThemeChange,
    recentDirectoriesStore,
    renameDialogRef,
    renameOpenRef,
    renameSessionPath,
    sessionCwd,
    sessionsDialogDirectory,
    sessionsDialogRef,
    sessionsOpenRef,
    sessionStore,
    settingsDialogRef,
    settingsOpenRef,
    sidebarStore,
    treeDialogRef,
    treeOpenRef,
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

        <AppShellSessionsDialogHost
          activeSessionId={activeSessionId}
          knownDirectories={knownDirectories}
          sessionsDialogDirectory={sessionsDialogDirectory}
          sessionsDialogRef={sessionsDialogRef}
          sessionsOpenRef={sessionsOpenRef}
          sidebarStore={sidebarStore}
          viewerContextId={viewerContextId}
          deleteSessions={deleteSessions}
          onSessionDialogSelect={onSessionDialogSelect}
          renameSessionPath={renameSessionPath}
        />

        <AppShellAddDirectoryDialogHost
          addDirectoryDialogRef={addDirectoryDialogRef}
          addDirectoryOpenRef={addDirectoryOpenRef}
          addDirectoryPath={addDirectoryPath}
          baseSidebarDirectories={baseSidebarDirectories}
          knownDirectories={knownDirectories}
          recentDirectoriesStore={recentDirectoriesStore}
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

        <AppShellDeleteOldDirectorySessionsDialogHost
          deleteOldDirectorySessionsDialogRef={
            deleteOldDirectorySessionsDialogRef
          }
          deleteOldDirectorySessionsOpenRef={deleteOldDirectorySessionsOpenRef}
          viewerContextId={viewerContextId}
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
          sessionStore={sessionStore}
          treeDialogRef={treeDialogRef}
          treeOpenRef={treeOpenRef}
          viewerContextId={viewerContextId}
        />

        <AppShellSettingsDialogHost
          currentTheme={currentTheme}
          displaySettingsStore={displaySettingsStore}
          notificationStore={notificationStore}
          onAutoScrollEnabledChange={onAutoScrollEnabledChange}
          onCenterMessagesChange={onCenterMessagesChange}
          onHideThinkingBlocksChange={onHideThinkingBlocksChange}
          onHideToolBlocksChange={onHideToolBlocksChange}
          onSessionDoneDesktopNotificationsEnabledChange={
            onSessionDoneDesktopNotificationsEnabledChange
          }
          onSessionDoneSoundEnabledChange={onSessionDoneSoundEnabledChange}
          onThemeChange={onThemeChange}
          sessionStore={sessionStore}
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
  sessionWorkspaceRef,
}: {
  viewerContextId: string
  sidebarStore: AppShellSidebarStore
  sessionWorkspaceRef: React.RefObject<AppShellSessionWorkspaceHandle | null>
}) {
  const [directorySessionsStore] = React.useState(() =>
    createDirectorySessionsStore({}, {})
  )
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
  const sidebarSessionsEventSnapshot = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => {
      const event = snapshot.state.sessionsEvent
      const statuses = snapshot.state.sidebarSessionStatusByKey
      const status = event
        ? (event.activeSessionPath
            ? statuses[`path:${event.activeSessionPath}`]
            : undefined) ||
          (event.activeSessionId
            ? statuses[`id:${event.activeSessionId}`]
            : undefined) ||
          (event.activeSessionKey
            ? statuses[`key:${event.activeSessionKey}`]
            : undefined)
        : undefined

      return {
        event,
        activeStreaming: Boolean(status?.streaming),
      }
    },
    (left, right) =>
      left.activeStreaming === right.activeStreaming &&
      left.event?.activeSessionId === right.event?.activeSessionId &&
      left.event?.activeSessionKey === right.event?.activeSessionKey &&
      left.event?.activeSessionPath === right.event?.activeSessionPath &&
      sameStringArray(
        left.event?.directories || [],
        right.event?.directories || []
      )
  )
  const sessionsEvent = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.state.sessionsEvent
  )
  const activeSidebarSessionStreaming =
    sidebarSessionsEventSnapshot.activeStreaming
  const matchingSessionCount = visibleDirectories.reduce(
    (total, directory) =>
      total + (filteredDirectorySessions[directory]?.length ?? 0),
    0
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

  const clearDirectoryIndexRequestDirectories = (
    directories: Array<string>,
    requestId: number
  ) => {
    for (const directory of directories) {
      if (directoryIndexRequestIdsByPathRef.current[directory] === requestId) {
        delete directoryIndexRequestIdsByPathRef.current[directory]
      }
    }
  }

  React.useLayoutEffect(() => {
    directorySessionsStore.setData(
      filteredDirectorySessions,
      directoryIndexLoading
    )
  }, [directoryIndexLoading, directorySessionsStore, filteredDirectorySessions])

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

    sidebarStore.setState((current) => {
      const merged = payloadDirectories.length
        ? mergeDirectoryIndexData(
            current.directoryIndexDataByPath,
            payloadDirectoryIndexes
          )
        : current.directoryIndexDataByPath
      const nextDirectoryIndexDataByPath = clearUnreadForActiveSidebarSession(
        merged,
        {
          sessionId: sessionsEvent.activeSessionId,
          sessionPath: sessionsEvent.activeSessionPath,
        }
      )
      const nextDirectoryIndexLoading = payloadDirectories.length
        ? updateDirectoryIndexLoadingState(
            current.directoryIndexLoading,
            payloadDirectories,
            false
          )
        : current.directoryIndexLoading

      const directoryIndexDataChanged = !sameDirectoryIndexDataRecord(
        current.directoryIndexDataByPath,
        nextDirectoryIndexDataByPath
      )

      if (
        !directoryIndexDataChanged &&
        nextDirectoryIndexLoading === current.directoryIndexLoading
      ) {
        return current
      }

      return {
        directoryIndexDataByPath: directoryIndexDataChanged
          ? nextDirectoryIndexDataByPath
          : current.directoryIndexDataByPath,
        directoryIndexLoading: nextDirectoryIndexLoading,
      }
    })

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

      if (
        directoryIndexLoading[directory] ||
        directoryIndexRequestIdsByPathRef.current[directory]
      ) {
        continue
      }

      if (previousRevision === nextRevision) {
        continue
      }

      if (activeSidebarSessionStreaming) {
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
        clearDirectoryIndexRequestDirectories(activeDirectories, requestId)

        const activeDirectoryIndexes = Object.fromEntries(
          activeDirectories
            .map((directory) => [
              directory,
              response.directoryIndexes[directory],
            ])
            .filter((entry) => Boolean(entry[1]))
        )

        sidebarStore.setState((current) => {
          const nextDirectoryIndexDataByPath =
            Object.keys(activeDirectoryIndexes).length > 0
              ? mergeDirectoryIndexData(
                  current.directoryIndexDataByPath,
                  activeDirectoryIndexes
                )
              : current.directoryIndexDataByPath
          const nextDirectoryIndexLoading = updateDirectoryIndexLoadingState(
            current.directoryIndexLoading,
            activeDirectories,
            false
          )

          if (
            nextDirectoryIndexDataByPath === current.directoryIndexDataByPath &&
            nextDirectoryIndexLoading === current.directoryIndexLoading
          ) {
            return current
          }

          return {
            directoryIndexDataByPath: nextDirectoryIndexDataByPath,
            directoryIndexLoading: nextDirectoryIndexLoading,
          }
        })
      })
      .catch((error) => {
        const activeDirectories = getActiveDirectoryIndexRequestDirectories(
          directoriesToRefresh,
          requestId
        )
        if (activeDirectories.length === 0) return
        clearDirectoryIndexRequestDirectories(activeDirectories, requestId)

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
    activeSidebarSessionStreaming,
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
        ) &&
        !directoryIndexLoading[directory] &&
        !directoryIndexRequestIdsByPathRef.current[directory]
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
        clearDirectoryIndexRequestDirectories(activeDirectories, requestId)

        const activeDirectoryIndexes = Object.fromEntries(
          activeDirectories
            .map((directory) => [
              directory,
              response.directoryIndexes[directory],
            ])
            .filter((entry) => Boolean(entry[1]))
        )

        sidebarStore.setState((current) => {
          const nextDirectoryIndexDataByPath =
            Object.keys(activeDirectoryIndexes).length > 0
              ? mergeDirectoryIndexData(
                  current.directoryIndexDataByPath,
                  activeDirectoryIndexes
                )
              : current.directoryIndexDataByPath
          const nextDirectoryIndexLoading = updateDirectoryIndexLoadingState(
            current.directoryIndexLoading,
            activeDirectories,
            false
          )

          if (
            nextDirectoryIndexDataByPath === current.directoryIndexDataByPath &&
            nextDirectoryIndexLoading === current.directoryIndexLoading
          ) {
            return current
          }

          return {
            directoryIndexDataByPath: nextDirectoryIndexDataByPath,
            directoryIndexLoading: nextDirectoryIndexLoading,
          }
        })
      })
      .catch((error) => {
        const activeDirectories = getActiveDirectoryIndexRequestDirectories(
          missingDirectories,
          requestId
        )
        if (activeDirectories.length === 0) return
        clearDirectoryIndexRequestDirectories(activeDirectories, requestId)

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
        sessionWorkspaceRef.current?.selectSession(entry.id, {
          sessionPath: entry.path,
        })
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
      sessionWorkspaceRef.current?.selectSession(entry.id, {
        sessionPath: entry.path,
      })
    }
  }

  return (
    <AppSidebar
      sessionSearch={sessionSearch}
      onOpenSessionsDialog={() => {
        sessionWorkspaceRef.current?.openSessionsDialog()
      }}
      visibleDirectories={visibleDirectories}
      directorySessionsStore={directorySessionsStore}
      matchingSessionCount={matchingSessionCount}
      selectedSessionKeys={selectedSidebarSessionKeys}
      activeSessionId={sessionsEvent?.activeSessionId}
      activeSessionKey={
        sessionNotificationKey({
          sessionId: sessionsEvent?.activeSessionId,
          sessionPath: sessionsEvent?.activeSessionPath,
        }) || sessionsEvent?.activeSessionKey
      }
      emptyStateText={emptySidebarStateText}
      onCreateSession={() => {
        void sessionWorkspaceRef.current?.createSession(undefined, {
          closeMobileSidebar: true,
        })
      }}
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
      onDeleteOldSessionsInDirectory={(directory) => {
        sessionWorkspaceRef.current?.openDeleteOldDirectorySessionsDialog(
          directory
        )
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
      onReorderDirectories={reorderSidebarDirectories}
    />
  )
}

export function PhiAppShell({
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
    <SidebarProvider className="h-full flex-col overflow-hidden bg-background [--header-height:2.75rem]">
      <AppShellSessionWorkspace
        ref={sessionWorkspaceRef}
        viewerContextId={viewerContextId}
        sessionId={sessionId}
        onSelectSession={onSelectSession}
        sidebar={
          <AppShellSidebarController
            viewerContextId={viewerContextId}
            sidebarStore={sidebarStore}
            sessionWorkspaceRef={sessionWorkspaceRef}
          />
        }
        sidebarStore={sidebarStore}
        sessionSearchInputRef={sessionSearchInputRef}
      />
    </SidebarProvider>
  )
}
