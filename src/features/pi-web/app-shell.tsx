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
import { useAppShellShortcuts } from "@/features/pi-web/use-app-shell-shortcuts"
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

type DirectorySessionsIndexData = DirectorySessionsIndexSnapshot
type DirectorySessionsIndexesData = Extract<
  DirectorySessionsIndexesResponse,
  { ok: true }
>
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

function useLatestRef<T>(value: T) {
  const ref = React.useRef(value)
  ref.current = value
  return ref
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

type RenderConversationGroup =
  | {
      kind: "user"
      key: string
      item: UserConversationItem
    }
  | {
      kind: "assistant"
      key: string
      items: Array<AssistantConversationItem>
    }

function groupConversationItemsForRender(options: {
  items: Array<ConversationItem>
  hideThinking: boolean
  hideToolBlocks: boolean
}) {
  const groups: Array<RenderConversationGroup> = []
  let pendingAssistantGroup: RenderConversationGroup | null = null

  const flushAssistantGroup = () => {
    if (!pendingAssistantGroup || pendingAssistantGroup.kind !== "assistant") {
      pendingAssistantGroup = null
      return
    }

    if (
      pendingAssistantGroup.items.some((item) =>
        assistantMessageHasVisibleBlocks({
          item,
          hideThinking: options.hideThinking,
          hideToolBlocks: options.hideToolBlocks,
        })
      )
    ) {
      groups.push(pendingAssistantGroup)
    }

    pendingAssistantGroup = null
  }

  options.items.forEach((item, index) => {
    const key = item.itemKey || `message-row:${index}`

    if (item.kind === "assistant") {
      if (
        !pendingAssistantGroup ||
        pendingAssistantGroup.kind !== "assistant"
      ) {
        pendingAssistantGroup = {
          kind: "assistant",
          key,
          items: [],
        }
      }

      pendingAssistantGroup.items.push(item)
      return
    }

    flushAssistantGroup()
    groups.push({
      kind: "user",
      key,
      item,
    })
  })

  flushAssistantGroup()
  return groups
}

type ConversationItemsSnapshot = {
  items: Array<ConversationItem>
  revision: number
}

type ConversationItemsStore = {
  getSnapshot: () => ConversationItemsSnapshot
  setItems: (items: Array<ConversationItem>) => void
  subscribe: (listener: () => void) => () => void
}

function createConversationItemsStore(
  initialItems: Array<ConversationItem>
): ConversationItemsStore {
  let snapshot: ConversationItemsSnapshot = {
    items: initialItems,
    revision: 0,
  }
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    setItems: (items) => {
      if (snapshot.items === items) return

      snapshot = {
        items,
        revision: snapshot.revision + 1,
      }
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

function useConversationItemsSnapshot(store: ConversationItemsStore) {
  return React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  )
}

function sameRenderConversationGroup(
  left: RenderConversationGroup,
  right: RenderConversationGroup
) {
  if (left.kind !== right.kind || left.key !== right.key) return false

  if (left.kind === "user" && right.kind === "user") {
    return left.item === right.item
  }

  if (left.kind !== "assistant" || right.kind !== "assistant") {
    return false
  }

  if (left.items.length !== right.items.length) return false

  for (let index = 0; index < left.items.length; index += 1) {
    if (left.items[index] !== right.items[index]) return false
  }

  return true
}

function reconcileRenderConversationGroups(
  previousGroups: Array<RenderConversationGroup>,
  nextGroups: Array<RenderConversationGroup>
) {
  if (previousGroups.length === 0) return nextGroups

  let changed = previousGroups.length !== nextGroups.length
  const groups: Array<RenderConversationGroup> = []

  for (let index = 0; index < nextGroups.length; index += 1) {
    const nextGroup = nextGroups[index]
    const previousGroup = previousGroups[index]

    if (
      previousGroup &&
      sameRenderConversationGroup(previousGroup, nextGroup)
    ) {
      groups.push(previousGroup)
      continue
    }

    changed = true
    groups.push(nextGroup)
  }

  return changed ? groups : previousGroups
}

function useRenderConversationGroups({
  hideThinking,
  hideToolBlocks,
  items,
}: {
  items: Array<ConversationItem>
  hideThinking: boolean
  hideToolBlocks: boolean
}) {
  const previousGroupsRef = React.useRef<Array<RenderConversationGroup>>([])
  const previousVisibilityRef = React.useRef({
    hideThinking,
    hideToolBlocks,
  })

  return React.useMemo(() => {
    const nextGroups = groupConversationItemsForRender({
      items,
      hideThinking,
      hideToolBlocks,
    })
    const previousVisibility = previousVisibilityRef.current
    const canReusePreviousGroups =
      previousVisibility.hideThinking === hideThinking &&
      previousVisibility.hideToolBlocks === hideToolBlocks
    const groups = canReusePreviousGroups
      ? reconcileRenderConversationGroups(previousGroupsRef.current, nextGroups)
      : nextGroups

    previousGroupsRef.current = groups
    previousVisibilityRef.current = {
      hideThinking,
      hideToolBlocks,
    }

    return groups
  }, [hideThinking, hideToolBlocks, items])
}

type AppShellConversationFrameHandle = {
  jumpToNextMessage: () => void
  jumpToPreviousMessage: () => void
  scrollConversationToBottom: () => void
  scrollConversationToTop: () => void
}

function ConversationLatestMessageButton({
  draft,
  hasMessages,
  onClick,
  scrollStateStore,
}: {
  draft: boolean
  hasMessages: boolean
  onClick: () => void
  scrollStateStore: MessageScrollStateStore
}) {
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

const AppShellConversationFrame = React.forwardRef<
  AppShellConversationFrameHandle,
  {
    children: React.ReactNode
    conversationRevision: number
    hasMessages: boolean
    isSessionViewLoading: boolean
    sessionState: AppShellConversationSessionState
  }
>(function AppShellConversationFrameImpl(
  {
    children,
    conversationRevision,
    hasMessages,
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
  } = useAppShellMessageScroll({
    conversationRevision,
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
          {children}
          <div ref={bottomRef} />
        </div>
      </div>

      {!isSessionViewLoading ? (
        <>
          <ConversationLatestMessageButton
            draft={sessionState.draft}
            hasMessages={hasMessages}
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

function AppShellTabsList({
  viewerContextId,
  cwd,
}: {
  viewerContextId: string
  cwd?: string
}) {
  return (
    <TabsList className="w-full rounded-none border-b border-border/70">
      <TabsTrigger value="session">Session</TabsTrigger>
      <TabsTrigger value="git">
        <GitTabStatusText viewerContextId={viewerContextId} cwd={cwd} />
      </TabsTrigger>
    </TabsList>
  )
}

function ConversationGroupView({
  className,
  group,
  hideThinking,
  hideToolBlocks,
}: {
  className: string
  group: RenderConversationGroup
  hideThinking: boolean
  hideToolBlocks: boolean
}) {
  if (group.kind === "user") {
    return (
      <div data-message-anchor="true" className={className}>
        <UserMessageCard item={group.item} />
      </div>
    )
  }

  return (
    <div data-message-anchor="true" className={className}>
      <AssistantMessagesCard
        items={group.items}
        hideThinking={hideThinking}
        hideToolBlocks={hideToolBlocks}
      />
    </div>
  )
}

function AppShellSessionConversation({
  awaitingFirstTurn,
  centerMessages,
  conversationFrameRef,
  conversationItemsStore,
  hideThinking,
  hideToolBlocks,
  isSessionViewLoading,
  isSubmitting,
  onCreateSession,
  sessionState,
  viewerContextId,
  workingState,
}: {
  awaitingFirstTurn: boolean
  centerMessages: boolean
  conversationFrameRef: React.RefObject<AppShellConversationFrameHandle | null>
  conversationItemsStore: ConversationItemsStore
  hideThinking: boolean
  hideToolBlocks: boolean
  isSessionViewLoading: boolean
  isSubmitting: boolean
  onCreateSession: () => void
  sessionState: AppShellConversationSessionState
  viewerContextId: string
  workingState: AppShellWorkingState | null
}) {
  const conversationSnapshot = useConversationItemsSnapshot(
    conversationItemsStore
  )
  const displayedConversationItems = conversationSnapshot.items
  const conversationMessageColumnClassName = centerMessages
    ? "mx-auto w-full max-w-[80ch]"
    : "w-full"
  const renderedConversationGroups = useRenderConversationGroups({
    items: displayedConversationItems,
    hideThinking,
    hideToolBlocks,
  })
  const showConversationLoadingState = Boolean(
    isSessionViewLoading ||
    (!sessionState.draft &&
      displayedConversationItems.length === 0 &&
      (isSubmitting ||
        awaitingFirstTurn ||
        sessionState.streaming ||
        Boolean(workingState)))
  )
  const conversationLoadingLabel = isSessionViewLoading
    ? "Loading session…"
    : workingState && !workingState.done
      ? workingState.label
      : "Loading…"

  return (
    <AppShellConversationFrame
      ref={conversationFrameRef}
      conversationRevision={conversationSnapshot.revision}
      hasMessages={displayedConversationItems.length > 0}
      isSessionViewLoading={isSessionViewLoading}
      sessionState={sessionState}
    >
      {showConversationLoadingState ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
          <Spinner />
          <div>{conversationLoadingLabel}</div>
        </div>
      ) : renderedConversationGroups.length > 0 ? (
        <div className="flex flex-col gap-4 pt-4">
          {renderedConversationGroups.map((group) => (
            <ConversationGroupView
              key={group.key}
              className={conversationMessageColumnClassName}
              group={group}
              hideThinking={hideThinking}
              hideToolBlocks={hideToolBlocks}
            />
          ))}
          {workingState ? (
            <div className={conversationMessageColumnClassName}>
              <MessagesWorkingIndicator state={workingState} />
            </div>
          ) : null}
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {sessionState.draft ? "New session" : "Start a new conversation"}
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
              <DraftGitStatusBadge
                viewerContextId={viewerContextId}
                cwd={sessionState.cwd}
              />
            </EmptyContent>
          ) : (
            <EmptyContent>
              <Button onClick={onCreateSession}>New session</Button>
            </EmptyContent>
          )}
        </Empty>
      )}
    </AppShellConversationFrame>
  )
}

function AppShellWindowEffects({
  activeSessionNotificationKey,
  currentPageTitle,
  currentSessionTitle,
  sessionCwd,
  sessionDoneDesktopNotificationsEnabled,
  sessionDoneSoundEnabled,
  sessionFile,
  sessionId,
  sessionStreaming,
  sidebarSessions,
  onSelectSession,
}: {
  activeSessionNotificationKey: string
  currentPageTitle: string
  currentSessionTitle: string
  sessionCwd?: string
  sessionDoneDesktopNotificationsEnabled: boolean
  sessionDoneSoundEnabled: boolean
  sessionFile?: string
  sessionId?: string
  sessionStreaming: boolean
  sidebarSessions: Array<SessionListEntry>
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
  const lastStreamingSnapshotRef = React.useRef({
    key: "",
    streaming: false,
  })
  const sessionUnreadSnapshotsRef = React.useRef<Map<string, boolean>>(
    new Map()
  )
  const sessionUnreadSnapshotsReadyRef = React.useRef(false)

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
    const lastStreamingSnapshot = lastStreamingSnapshotRef.current
    const finishedActiveSession =
      lastStreamingSnapshot.streaming &&
      lastStreamingSnapshot.key &&
      lastStreamingSnapshot.key === activeSessionNotificationKey &&
      !sessionStreaming

    if (finishedActiveSession) {
      const finishedLabel = finishedSessionLabel(currentSessionTitle)
      if (sessionId) {
        toast.success(finishedLabel, {
          action: {
            label: "Open",
            onClick: () => onSelectSession(sessionId),
          },
        })
      } else {
        toast.success(finishedLabel)
      }

      if (!isPageForeground && activeSessionNotificationKey) {
        setBackgroundCurrentSessionUnreadKey(activeSessionNotificationKey)
      }

      if (sessionDoneDesktopNotificationsEnabled && !isPageForeground) {
        showSessionDoneDesktopNotification({
          title: finishedLabel,
          body: sessionCwd || "Open Pi to continue",
          tag: sessionFile || sessionId || currentSessionTitle,
        })
      }

      if (sessionDoneSoundEnabled) {
        void playSessionDoneSound()
      }
    }

    lastStreamingSnapshotRef.current = {
      key: activeSessionNotificationKey,
      streaming: sessionStreaming,
    }
  }, [
    activeSessionNotificationKey,
    currentSessionTitle,
    isPageForeground,
    onSelectSession,
    sessionCwd,
    sessionDoneDesktopNotificationsEnabled,
    sessionDoneSoundEnabled,
    sessionFile,
    sessionId,
    sessionStreaming,
  ])

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
      if (session.id) {
        toast.success(finishedLabel, {
          action: {
            label: "Open",
            onClick: () => onSelectSession(session.id),
          },
        })
      } else {
        toast.success(finishedLabel)
      }

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
    onSelectSession,
    sessionDoneSoundEnabled,
    sidebarSessions,
  ])

  return null
}

export type SelectSessionNavigationOptions = {
  replace?: boolean
}

type CreateSessionOptions = {
  closeMobileSidebar?: boolean
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
  setConnected: React.Dispatch<React.SetStateAction<boolean>>
  setSessionsEvent: React.Dispatch<React.SetStateAction<SessionsEvent | null>>
  applySidebarSessionStatusRef: React.MutableRefObject<
    (status: SessionStatusEvent) => void
  >
  bootstrapSidebarDirectories: Array<string>
  baseSidebarDirectories: Array<string>
  directoryStateByPath: Map<string, DirectoryState>
  directoryIndexes: Record<string, Array<SessionListEntry>>
  sidebarSessions: Array<SessionListEntry>
  selectedSidebarSessions: Array<SessionListEntry>
  sessionSearchInputRef: React.RefObject<HTMLInputElement | null>
  sidebarSessionEntriesByKey: Map<string, SessionListEntry>
  clearSelectedSidebarSelection: () => void
  setSidebarDirectories: React.Dispatch<React.SetStateAction<Array<string>>>
  setSelectedSidebarSessionKeys: React.Dispatch<
    React.SetStateAction<Array<string>>
  >
  setSidebarSessionSelectionAnchor: React.Dispatch<React.SetStateAction<string>>
}

const AppShellSessionWorkspace = React.forwardRef<
  AppShellSessionWorkspaceHandle,
  AppShellSessionWorkspaceProps
>(function AppShellSessionWorkspaceImpl(
  {
    viewerContextId,
    sessionId,
    onSelectSession,
    setConnected,
    setSessionsEvent,
    applySidebarSessionStatusRef,
    bootstrapSidebarDirectories,
    baseSidebarDirectories,
    directoryStateByPath,
    directoryIndexes,
    sidebarSessions,
    selectedSidebarSessions,
    sessionSearchInputRef,
    sidebarSessionEntriesByKey,
    clearSelectedSidebarSelection,
    setSidebarDirectories,
    setSelectedSidebarSessionKeys,
    setSidebarSessionSelectionAnchor,
  },
  ref
) {
  const [sessionState, setSessionState] = React.useState<SessionState>(
    createInitialSessionState()
  )
  const [currentTab, setCurrentTab] = React.useState("session")
  const previousRouteSessionIdRef = React.useRef(sessionId)
  const [composerDraftSeed, setComposerDraftSeed] = React.useState<{
    text: string
    skillName?: string
    syncNonce: number
  }>({ text: "", syncNonce: 0 })
  const [composerImages, setComposerImages] = React.useState<
    Array<PromptImage>
  >([])
  const [hideToolBlocks, setHideToolBlocks] = React.useState(false)
  const [centerMessages, setCenterMessages] = React.useState(false)
  const [awaitingFirstTurn, setAwaitingFirstTurn] = React.useState(false)
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
  const [pendingDraftPrompt, setPendingDraftPrompt] = React.useState<{
    ownerKey: string
    message: string
    images: Array<PromptImage>
    streamingBehavior?: StreamingBehavior
    optimisticId?: string
  } | null>(null)
  const [pendingDraftFollowUps, setPendingDraftFollowUps] = React.useState<
    Array<{
      message: string
      images: Array<PromptImage>
      streamingBehavior: "steer" | "followUp"
      optimisticId?: string
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
  const composerTextRef = React.useRef(composerDraftSeed.text)
  const composerSkillRef = React.useRef<string | undefined>(
    composerDraftSeed.skillName
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
  const setConversationItems = React.useCallback(
    (items: Array<ConversationItem>) => {
      conversationItemsStore.setItems(items)
    },
    [conversationItemsStore]
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
      }

      setSessionState((current) => {
        const currentNextItems = insertOptimisticUserItem(current.items, item)
        if (currentNextItems === current.items) return current

        const nextState = { ...current, items: currentNextItems }
        sessionStateRef.current = nextState
        conversationItemsStore.setItems(currentNextItems)
        return nextState
      })

      return pendingId
    },
    [conversationItemsStore]
  )
  const removeOptimisticUserMessage = React.useCallback(
    (pendingId: string | undefined) => {
      if (!pendingId) return

      const currentState = sessionStateRef.current
      const nextItems = removeOptimisticUserItem(currentState.items, pendingId)
      if (nextItems !== currentState.items) {
        const nextState = { ...currentState, items: nextItems }
        sessionStateRef.current = nextState
        conversationItemsStore.setItems(nextItems)
      }

      setSessionState((current) => {
        const currentNextItems = removeOptimisticUserItem(
          current.items,
          pendingId
        )
        if (currentNextItems === current.items) return current

        const nextState = { ...current, items: currentNextItems }
        sessionStateRef.current = nextState
        conversationItemsStore.setItems(currentNextItems)
        return nextState
      })
    },
    [conversationItemsStore]
  )

  const { setTheme, theme } = useTheme()
  const currentTheme = normalizeThemeMode(theme)
  const activeSessionId =
    sessionState.sessionId || (sessionState.sessionKey ? undefined : sessionId)
  const currentSessionQueryScope = sessionScrollKey(sessionState)
  const conversationItemsSnapshot = conversationItemsStore.getSnapshot()
  const displayedConversationItems = conversationItemsSnapshot.items
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
  const activeSessionNotificationKey = sessionNotificationKey({
    sessionId: sessionState.sessionId,
    sessionFile: sessionState.sessionFile,
  })
  const currentPageTitle = isSessionViewLoading
    ? displaySessionTitle
    : sessionState.uiState.title?.trim() ||
      (currentSessionTitle !== "New session" ? currentSessionTitle : "Pi")

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
    conversationItemsStore.setItems(sessionState.items)
  }, [conversationItemsStore, sessionState.items])

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

    setSidebarDirectories((current) => {
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
  }, [sessionId, sessionState.cwd, sessionState.draft, sessionState.sessionId])

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
      ...baseSidebarDirectories,
      sessionState.cwd || "",
      ...Array.from(directoryStateByPath.keys()),
      ...Object.values(directoryIndexes).flatMap((entries) =>
        entries.map((entry) => entry.cwd || "")
      ),
    ]))()

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
    composerImages,
    composerTextRef,
    composerSkillRef,
    replaceComposerDraft,
    lastSyncedEditorTextRef,
    rememberRecentDirectory,
    prefetchDirectorySessionsIndex,
    addOptimisticUserMessage,
    removeOptimisticUserMessage,
    setSidebarDirectories,
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

      handleSelectSession(undefined)
      clearSelectedSidebarSelection()
      if (shouldCloseMobileSidebar) {
        pendingMobileSidebarPromptFocusRef.current = true
        setOpenMobile(false)
      } else {
        focusPrompt()
      }
      setAwaitingFirstTurn(false)
      setPendingMessages((current) => (current.length === 0 ? current : []))
      setSessionState(() => {
        const nextState = createOptimisticDraftSessionState({
          previous: previousState,
          cwd: nextCwd,
          ownerKey,
        })
        sessionStateRef.current = nextState
        conversationItemsStore.setItems(nextState.items)
        return nextState
      })

      const created = await requestCreateSession(cwdOverride)
      if (created) {
        return
      }

      setSessionState((current) => {
        if (current.sessionKey !== optimisticSessionKey) {
          return current
        }

        sessionStateRef.current = previousState
        conversationItemsStore.setItems(previousState.items)
        return previousState
      })
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

  React.useEffect(() => {
    if (!sessionId || !draftSessionLoadingOwnerKey || !sessionState.draft) {
      return
    }

    if (sessionState.sessionKey?.startsWith("optimistic:")) {
      return
    }

    if (promptDraftKey(sessionState) !== draftSessionLoadingOwnerKey) {
      return
    }

    handleSelectSession(undefined, { replace: true })
  }, [
    draftSessionLoadingOwnerKey,
    handleSelectSession,
    sessionId,
    sessionState,
  ])

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
    sessionState,
    setSelectedSidebarSessionKeys,
    setSidebarSessionSelectionAnchor,
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
      const thinkingSummary = sessionState.hideThinkingBlock
        ? sessionState.hiddenThinkingPreview
        : undefined

      return {
        label:
          thinkingSummary || sessionState.uiState.workingMessage || "Working…",
      }
    }

    const hasAssistantOutput = displayedConversationItems.some(
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
        onSelect: clearSelectedSidebarSelection,
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

  useAppShellShortcuts({
    addDirectoryOpenRef,
    commandPaletteOpenRef,
    currentTab,
    deleteOpenRef,
    forkOpenRef,
    pendingUiRequestOpenRef: uiRequestOpenRef,
    lastEscapePressedAtRef,
    renameOpenRef,
    selectedSidebarSessions,
    sessionHasAvailableModels: sessionState.availableModels.length > 0,
    sessionHasFile: Boolean(sessionState.sessionFile),
    sessionSearchInputRef,
    settingsOpenRef,
    shortcutActionsRef,
    sidebarSessionEntriesByKey,
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
      <AppShellWindowEffects
        activeSessionNotificationKey={activeSessionNotificationKey}
        currentPageTitle={currentPageTitle}
        currentSessionTitle={currentSessionTitle}
        sessionCwd={sessionState.cwd}
        sessionDoneDesktopNotificationsEnabled={
          sessionDoneDesktopNotificationsEnabled
        }
        sessionDoneSoundEnabled={sessionDoneSoundEnabled}
        sessionFile={sessionState.sessionFile}
        sessionId={sessionState.sessionId}
        sessionStreaming={sessionState.streaming}
        sidebarSessions={sidebarSessions}
        onSelectSession={handleSelectSession}
      />

      <SidebarInset className="min-h-0 overflow-hidden">
        <div className="shrink-0 border-b border-border/70 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <SidebarTrigger className="mt-0.5 shrink-0" />
              <div className="min-w-0 space-y-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  {!isSessionViewLoading && sessionState.streaming ? (
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
                  {!isSessionViewLoading && sessionState.draft ? (
                    <Badge variant="outline">Draft</Badge>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {displaySessionCwd && (
                    <span>{formatDisplayPath(displaySessionCwd)}</span>
                  )}
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
          className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
        >
          <AppShellTabsList
            viewerContextId={viewerContextId}
            cwd={sessionState.cwd}
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
              hideThinking={sessionState.hideThinkingBlock}
              hideToolBlocks={hideToolBlocks}
              isSessionViewLoading={isSessionViewLoading}
              isSubmitting={isSubmitting}
              onCreateSession={() => {
                void createSession()
              }}
              sessionState={sessionState}
              viewerContextId={viewerContextId}
              workingState={workingState}
            />

            <ComposerPanel
              ref={composerPanelRef}
              currentPendingMessages={currentPendingMessages}
              composerImages={composerImages}
              composerText={composerDraftSeed.text}
              composerSkill={composerDraftSeed.skillName}
              composerSyncNonce={composerDraftSeed.syncNonce}
              centerMessages={centerMessages}
              availableModels={sessionState.availableModels}
              model={sessionState.model}
              thinkingLevel={sessionState.thinkingLevel}
              availableThinkingLevels={sessionState.availableThinkingLevels}
              contextUsage={
                isSessionViewLoading ? undefined : sessionState.contextUsage
              }
              isSubmitting={isSubmitting}
              isStreaming={sessionState.streaming}
              awaitingFirstTurn={awaitingFirstTurn}
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
                if (removePendingDraftFollowUp(pendingId)) return
                void removePendingMessage(pendingId)
              }}
              onReorderPending={(pendingId, direction) => {
                if (reorderPendingDraftFollowUp(pendingId, direction)) return
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
            keepMounted
            className="min-h-0 flex-1 space-y-4 overflow-auto p-6"
          >
            <GitPanel
              viewerContextId={viewerContextId}
              cwd={sessionState.cwd}
              active={currentTab === "git"}
            />
          </TabsContent>
        </Tabs>
      </SidebarInset>

      <AppShellCommandPaletteController
        ref={commandPaletteRef}
        openStateRef={commandPaletteOpenRef}
        commands={commandPaletteCommands}
        onCommandError={(error) => {
          toast.error(
            error instanceof Error ? error.message : "Failed to run command"
          )
        }}
      />

      <AppShellAddDirectoryDialogController
        ref={addDirectoryDialogRef}
        openStateRef={addDirectoryOpenRef}
        openedDirectories={baseSidebarDirectories}
        currentDirectory={sessionState.cwd}
        recentDirectories={recentDirectories}
        knownDirectories={knownDirectories}
        onAddDirectoryPath={addDirectoryPath}
      />

      <RenameSessionDialogController
        ref={renameDialogRef}
        openStateRef={renameOpenRef}
        onRenameSession={renameSessionPath}
      />

      <DeleteSessionsDialogController
        ref={deleteDialogRef}
        openStateRef={deleteOpenRef}
        onDeleteSession={deleteSessions}
      />

      <ForkSessionDialogController
        ref={forkDialogRef}
        openStateRef={forkOpenRef}
        viewerContextId={viewerContextId}
        sessionScopeKey={currentSessionQueryScope}
        sessionId={activeSessionId}
      />

      <AppShellTreeDialogController
        ref={treeDialogRef}
        openStateRef={treeOpenRef}
        viewerContextId={viewerContextId}
        sessionScopeKey={currentSessionQueryScope}
        sessionId={activeSessionId}
        treeSummaryAvailable={treeSummaryAvailable}
      />

      <AppShellSettingsDialogController
        ref={settingsDialogRef}
        openStateRef={settingsOpenRef}
        currentTheme={currentTheme}
        onThemeChange={handleThemeChange}
        hideThinkingBlocks={sessionState.hideThinkingBlock}
        onHideThinkingBlocksChange={(hidden) => {
          void setThinkingBlocksHidden(hidden)
        }}
        hideToolBlocks={hideToolBlocks}
        onHideToolBlocksChange={setToolBlocksHidden}
        centerMessages={centerMessages}
        onCenterMessagesChange={setMessagesCentered}
        sessionDoneSoundEnabled={sessionDoneSoundEnabled}
        onSessionDoneSoundEnabledChange={handleSessionDoneSoundEnabledChange}
        sessionDoneDesktopNotificationsEnabled={
          sessionDoneDesktopNotificationsEnabled
        }
        onSessionDoneDesktopNotificationsEnabledChange={
          handleSessionDoneDesktopNotificationsEnabledChange
        }
        desktopNotificationPermission={desktopNotificationPermission}
      />

      <AppShellUiRequestDialogController
        ref={uiRequestDialogRef}
        openStateRef={uiRequestOpenRef}
        viewerContextId={viewerContextId}
        sessionId={activeSessionId}
      />
    </>
  )
})

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
  const [connected, setConnected] = React.useState(false)
  const [sessionsEvent, setSessionsEvent] =
    React.useState<SessionsEvent | null>(null)
  const [sidebarDirectories, setSidebarDirectories] = React.useState<
    Array<string>
  >([])
  const [
    initialSidebarBootstrapDirectories,
    setInitialSidebarBootstrapDirectories,
  ] = React.useState<Array<string>>([])
  const [directoryIndexDataByPath, setDirectoryIndexDataByPath] =
    React.useState<Record<string, DirectorySessionsIndexData>>({})
  const [directoryIndexLoading, setDirectoryIndexLoading] = React.useState<
    Record<string, boolean>
  >({})
  const [sidebarSessionStatusByKey, setSidebarSessionStatusByKey] =
    React.useState<SidebarSessionStatusMap>({})
  const [
    sidebarDeferredDirectoryLoadingReady,
    setSidebarDeferredDirectoryLoadingReady,
  ] = React.useState(false)
  const [sessionSearch, setSessionSearch] = React.useState("")
  const [selectedSidebarSessionKeys, setSelectedSidebarSessionKeys] =
    React.useState<Array<string>>([])
  const [sidebarSessionSelectionAnchor, setSidebarSessionSelectionAnchor] =
    React.useState("")
  const sessionSearchInputRef = React.useRef<HTMLInputElement | null>(null)
  const sessionWorkspaceRef =
    React.useRef<AppShellSessionWorkspaceHandle | null>(null)
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

  const directoryStates = sessionsEvent?.directoryStates || []
  const directoryStateByPath = (() =>
    new Map(directoryStates.map((state) => [state.path, state])))()
  const baseSidebarDirectories = (() =>
    normalizeStoredDirectoryList(sidebarDirectories))()
  const directoryIndexes = (() => {
    const nextIndexes: Record<string, Array<SessionListEntry>> = {}

    for (const directory of baseSidebarDirectories) {
      nextIndexes[directory] =
        directoryIndexDataByPath[directory]?.sessions || []
    }

    return nextIndexes
  })()
  const sidebarDirectoryIndexes = applySidebarSessionStatusOverlay(
    directoryIndexes,
    sidebarSessionStatusByKey
  )
  const applySidebarSessionStatusEvent = (status: SessionStatusEvent) => {
    setSidebarSessionStatusByKey((current) =>
      mergeSidebarSessionStatusMap(current, status)
    )
  }
  const applySidebarSessionStatusRef = useLatestRef(
    applySidebarSessionStatusEvent
  )

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
    setInitialSidebarBootstrapDirectories(
      nextDirectories.slice(0, INITIAL_SIDEBAR_BOOTSTRAP_DIRECTORY_COUNT)
    )
  }, [])

  React.useEffect(() => {
    let timeoutId = 0
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        setSidebarDeferredDirectoryLoadingReady(true)
      }, 0)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

  React.useEffect(() => {
    const sidebarDirectorySet = new Set(baseSidebarDirectories)

    setDirectoryIndexDataByPath((current) => {
      const next: Record<string, DirectorySessionsIndexData> = {}

      for (const [directory, payload] of Object.entries(current)) {
        if (!sidebarDirectorySet.has(directory)) continue
        next[directory] = payload
      }

      return JSON.stringify(next) === JSON.stringify(current) ? current : next
    })

    setDirectoryIndexLoading((current) => {
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
  }, [baseSidebarDirectories])

  React.useEffect(() => {
    if (!viewerContextId || !sessionsEvent) return

    const payloadDirectoryIndexes = sessionsEvent.directoryIndexes || {}
    const payloadDirectories = Object.keys(payloadDirectoryIndexes)

    setDirectoryIndexDataByPath((current) => {
      const merged = payloadDirectories.length
        ? mergeDirectoryIndexData(current, payloadDirectoryIndexes)
        : current

      return clearUnreadForActiveSidebarSession(merged, {
        sessionId: sessionsEvent.activeSessionId,
        sessionPath: sessionsEvent.activeSessionPath,
      })
    })

    if (payloadDirectories.length > 0) {
      setDirectoryIndexLoading((current) =>
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
    setDirectoryIndexLoading((current) =>
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
          setDirectoryIndexDataByPath((current) =>
            mergeDirectoryIndexData(current, activeDirectoryIndexes)
          )
        }
        setDirectoryIndexLoading((current) =>
          updateDirectoryIndexLoadingState(current, activeDirectories, false)
        )
      })
      .catch((error) => {
        const activeDirectories = getActiveDirectoryIndexRequestDirectories(
          directoriesToRefresh,
          requestId
        )
        if (activeDirectories.length === 0) return

        setDirectoryIndexLoading((current) =>
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
    directoryStateByPath,
    sessionsEvent,
    viewerContextId,
  ])

  React.useEffect(() => {
    if (!sessionsEvent) return

    setSidebarSessionStatusByKey((current) =>
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
    setDirectoryIndexLoading((current) =>
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
          setDirectoryIndexDataByPath((current) =>
            mergeDirectoryIndexData(current, activeDirectoryIndexes)
          )
        }
        setDirectoryIndexLoading((current) =>
          updateDirectoryIndexLoadingState(current, activeDirectories, false)
        )
      })
      .catch((error) => {
        const activeDirectories = getActiveDirectoryIndexRequestDirectories(
          missingDirectories,
          requestId
        )
        if (activeDirectories.length === 0) return

        setDirectoryIndexLoading((current) =>
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
    sidebarDeferredDirectoryLoadingReady,
    viewerContextId,
  ])

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
        sidebarDirectoryIndexes,
        directory
      )
        ? sidebarDirectoryIndexes[directory]
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
        sidebarDirectoryIndexes,
        directory
      )
        ? sidebarDirectoryIndexes[directory]
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

  React.useEffect(() => {
    const validKeys = new Set(sidebarSessionEntriesByKey.keys())

    setSelectedSidebarSessionKeys((current) => {
      const next = current.filter((key) => validKeys.has(key))
      return next.length === current.length ? current : next
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
    const nextAnchor =
      normalizedKeys.length === 0
        ? ""
        : anchorKey && normalizedKeys.includes(anchorKey)
          ? anchorKey
          : (normalizedKeys[normalizedKeys.length - 1] ?? "")

    setSelectedSidebarSessionKeys((current) =>
      sameStringArray(current, normalizedKeys) ? current : normalizedKeys
    )
    setSidebarSessionSelectionAnchor((current) =>
      current === nextAnchor ? current : nextAnchor
    )
  }

  const clearSelectedSidebarSelection = React.useCallback(() => {
    setSidebarSelection([])
  }, [])

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
    <SidebarProvider className="h-full overflow-hidden bg-background">
      <AppSidebar
        connected={connected}
        sessionSearch={sessionSearch}
        onSessionSearchChange={setSessionSearch}
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
          setSidebarDirectories((current) => {
            const next = current.filter((entry) => entry !== directory)
            safeLocalStorageSetItem(
              SIDEBAR_DIRECTORIES_STORAGE_KEY,
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
        }}
        onReorderDirectories={reorderSidebarDirectories}
      />

      <AppShellSessionWorkspace
        ref={sessionWorkspaceRef}
        viewerContextId={viewerContextId}
        sessionId={sessionId}
        onSelectSession={onSelectSession}
        setConnected={setConnected}
        setSessionsEvent={setSessionsEvent}
        applySidebarSessionStatusRef={applySidebarSessionStatusRef}
        bootstrapSidebarDirectories={initialSidebarBootstrapDirectories}
        baseSidebarDirectories={baseSidebarDirectories}
        directoryStateByPath={directoryStateByPath}
        directoryIndexes={sidebarDirectoryIndexes}
        sidebarSessions={sidebarSessions}
        selectedSidebarSessions={selectedSidebarSessions}
        sessionSearchInputRef={sessionSearchInputRef}
        sidebarSessionEntriesByKey={sidebarSessionEntriesByKey}
        clearSelectedSidebarSelection={clearSelectedSidebarSelection}
        setSidebarDirectories={setSidebarDirectories}
        setSelectedSidebarSessionKeys={setSelectedSidebarSessionKeys}
        setSidebarSessionSelectionAnchor={setSidebarSessionSelectionAnchor}
      />
    </SidebarProvider>
  )
}
