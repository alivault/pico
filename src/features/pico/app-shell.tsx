import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpToLineIcon,
  CheckIcon,
  ChevronDownIcon,
  EllipsisIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  OctagonXIcon,
  PanelRightIcon,
  SquarePenIcon,
} from "lucide-react"
import { Throttler } from "@tanstack/pacer"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { toast } from "sonner"

import type { DesktopNotificationPermission } from "@/features/pico/session-done-notifications"
import {
  getSidebarHorizontalResizeCursor,
  getSidebarResizeTargetMinimumSize,
  installGlobalResizeCursor,
  type SidebarHorizontalResizeCursor,
} from "@/hooks/use-sidebar-resize"
import type {
  ConversationItem,
  PromptImage,
  SessionState,
  StreamingBehavior,
  ThemeMode,
} from "@/lib/pico"
import type {
  DirectorySearchResponse,
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
} from "@/lib/pico/api"
import type { AppCommand } from "@/features/pico/app-shell-command-palette"
import type { ComposerContextUsageStore } from "@/features/pico/composer-context-usage-indicator"
import { showGitPushSuccessToast } from "@/features/pico/git-toast-utils"
import type { ComposerPanelHandle } from "@/features/pico/composer-panel"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { resizeRailPrimaryInteractiveClass } from "@/components/ui/resize-rail"
import { TitleTooltip } from "@/components/ui/tooltip"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AppShellCommandPaletteController,
  type AppShellCommandPaletteHandle,
} from "@/features/pico/app-shell-command-palette"
import {
  AppShellSessionsDialogController,
  type AppShellSessionsDialogHandle,
} from "@/features/pico/app-shell-sessions-dialog"
import {
  AppShellSettingsDialogController,
  type AppShellSettingsDialogHandle,
} from "@/features/pico/app-shell-settings-dialog"
import {
  AppShellAddDirectoryDialogController,
  type AppShellAddDirectoryDialogHandle,
} from "@/features/pico/app-shell-add-directory-dialog"
import {
  AppShellAuthDialogController,
  type AppShellAuthDialogHandle,
} from "@/features/pico/app-shell-auth-dialog"
import {
  AppShellTreeDialogController,
  type AppShellTreeDialogHandle,
} from "@/features/pico/app-shell-tree-dialog"
import {
  AppShellUiRequestDialogController,
  type AppShellUiRequestDialogHandle,
} from "@/features/pico/app-shell-ui-request-dialog"
import {
  DeleteOldDirectorySessionsDialogController,
  DeleteSessionsDialogController,
  ForkSessionDialogController,
  RenameSessionDialogController,
  type DeleteOldDirectorySessionsDialogHandle,
  type DeleteSessionsDialogHandle,
  type ForkSessionDialogHandle,
  type RenameSessionDialogHandle,
} from "@/features/pico/app-shell-session-dialogs"
import {
  buildRequestUrl,
  fetchJson,
  readFileAsPromptImage,
} from "@/features/pico/app-shell-utils"
import { ComposerPanel } from "@/features/pico/composer-panel"
import {
  getDesktopNotificationPermission,
  playSessionDoneSound,
  primeSessionDoneSound,
  requestDesktopNotificationPermission,
  showSessionDoneDesktopNotification,
} from "@/features/pico/session-done-notifications"
import {
  AssistantMessagesStoreCard,
  UserMessageCard,
  assistantMessageHasFooterMeta,
  assistantMessageHasVisibleBlocks,
  type AssistantMessagesSnapshot,
  type AssistantMessagesStore,
} from "@/features/pico/conversation-view"
import {
  parseComposerSkillMessage,
  serializeComposerDraft,
} from "@/features/pico/composer-utils"
import {
  DraftGitStatusBadge,
  GitCommitDialogController,
  GitTabStatusText,
  HeaderGitActions,
  HeaderGitStatusText,
  RightSidebar,
  type GitCommitDialogControllerHandle,
} from "@/features/pico/right-sidebar"
import {
  closeAllRightSidebarFiles,
  closeOtherRightSidebarFiles,
  closeRightSidebarFile,
  closeRightSidebarFilesToRight,
  createInitialRightSidebarState,
  openRightSidebarFile,
  reorderRightSidebarFiles,
  resetRightSidebarFiles,
  selectRightSidebarHasVisibleFiles,
  selectRightSidebarVisibleFileTabs,
  setRightSidebarActiveTab,
  type AppShellRightSidebarState,
  type OpenFileViewTabOptions,
} from "@/features/pico/app-shell-right-sidebar-state"
import {
  createPicoLatestThrottler,
  type PicoLatestThrottler,
} from "@/features/pico/pacer-utils"
import { formatShortcutLabel } from "@/features/pico/keyboard-shortcuts"
import { picoQueryKeys, picoSessionScopeKey } from "@/features/pico/query-keys"
import {
  applyStoreAction,
  batch,
  createPicoStore,
  setStoreField,
  setStoreState,
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import {
  AppSidebar,
  createDirectorySessionsStore,
} from "@/features/pico/sidebar"
import {
  clearUnreadForActiveSidebarSession,
  createAppShellSidebarStore,
  fetchDirectorySessionsIndexes,
  getRenderedSidebarSessionKeys,
  mergeDirectoryIndexData,
  mergeSidebarSessionStatusMap,
  sameDirectoryIndexDataRecord,
  sameSessionEntryRecord,
  updateDirectoryIndexLoadingState,
  useAppShellSidebarValue,
  type AppShellSidebarStore,
  type DirectorySessionsIndexData,
} from "@/features/pico/app-shell-sidebar-store"
import {
  useAppShellMessageScroll,
  useMessageScrollValue,
} from "@/features/pico/use-app-shell-message-scroll"
import type { MessageScrollStateStore } from "@/features/pico/use-app-shell-message-scroll"
import { useAppShellPromptMutations } from "@/features/pico/use-app-shell-prompt-mutations"
import { useAppShellSessionMutations } from "@/features/pico/use-app-shell-session-mutations"
import { useAppShellSessionSync } from "@/features/pico/use-app-shell-session-sync"
import {
  useAppShellShortcuts,
  type AppShellShortcutState,
} from "@/features/pico/use-app-shell-shortcuts"
import {
  DRAFT_DIRECTORY_STORAGE_KEY,
  HIDE_TOOL_BLOCKS_STORAGE_KEY,
  CENTER_MESSAGES_STORAGE_KEY,
  AUTO_SCROLL_ENABLED_STORAGE_KEY,
  RECENT_DIRECTORIES_LIMIT,
  RECENT_DIRECTORIES_STORAGE_KEY,
  RIGHT_SIDEBAR_OPEN_STORAGE_KEY,
  RIGHT_SIDEBAR_WIDTHS_STORAGE_KEY,
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
  readStoredRightSidebarOpen,
  readStoredSessionDoneDesktopNotificationsEnabled,
  readStoredSessionDoneSoundEnabled,
  readStoredSidebarDirectories,
  rememberStoredPromptDraft,
  promptDraftKey,
  safeLocalStorageGetItem,
  safeLocalStorageSetItem,
  sessionListEntryKey,
} from "@/lib/pico"
import { isApiErrorResponse } from "@/lib/pico/api"

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

type GitStatusData = Extract<GitStatusResponse, { ok: true }>
type GitChangesData = Extract<GitChangesResponse, { ok: true }>
type GitRemoteAction = "push" | "force-push" | "pull"

function sessionScrollKey(sessionState: {
  draft: boolean
  sessionFile?: string
  sessionId?: string
  cwd?: string
}) {
  return picoSessionScopeKey(sessionState)
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

function sameStringArray(left: Array<string>, right: Array<string>) {
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
  hideFooter: boolean
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
      pendingAssistantVisible ||=
        (!options.hideFooter && assistantMessageHasFooterMeta(item)) ||
        assistantMessageHasVisibleBlocks({
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
  hideFooter: boolean
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
    hideFooter: boolean
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
          hideFooter: subscription.hideFooter,
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
    subscribeGroups: ({
      hideFooter,
      hideThinking,
      hideToolBlocks,
      groups,
      listener,
    }) => {
      const subscription: ConversationGroupSubscription = {
        hideFooter,
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
  hideFooter,
  hideThinking,
  hideToolBlocks,
  store,
}: {
  hideFooter: boolean
  hideThinking: boolean
  hideToolBlocks: boolean
  store: ConversationItemsStore
}) {
  const cacheRef = React.useRef<{
    hideFooter: boolean
    hideThinking: boolean
    hideToolBlocks: boolean
    revision: number
    groups: Array<RenderConversationGroupDescriptor>
  }>({
    hideFooter,
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
      cache.hideFooter === hideFooter &&
      cache.hideThinking === hideThinking &&
      cache.hideToolBlocks === hideToolBlocks
    ) {
      return cache.groups
    }

    const nextGroups = groupConversationItemsForRender({
      items: snapshot.items,
      hideFooter,
      hideThinking,
      hideToolBlocks,
    })
    const groups =
      cache.hideFooter === hideFooter &&
      cache.hideThinking === hideThinking &&
      cache.hideToolBlocks === hideToolBlocks
        ? reconcileRenderConversationGroupDescriptors(cache.groups, nextGroups)
        : nextGroups

    cacheRef.current = {
      hideFooter,
      hideThinking,
      hideToolBlocks,
      revision: snapshot.revision,
      groups,
    }

    return groups
  }

  const subscribe = (listener: () => void) =>
    store.subscribeGroups({
      hideFooter,
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
    <TitleTooltip
      title="Jump to latest message"
      kbd={formatShortcutLabel("Control+ArrowDown")}
    >
      <Button
        variant="secondary"
        size="icon-lg"
        disabled={isDisabled}
        className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border-0 shadow-[0_10px_24px_rgba(0,0,0,0.28)] disabled:pointer-events-none disabled:opacity-0 md:bottom-[18px]"
        aria-label="Jump to latest message"
        onClick={onClick}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    </TitleTooltip>
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
    <TitleTooltip
      title="Jump to previous message"
      kbd={formatShortcutLabel("Control+ArrowLeft")}
    >
      <Button
        variant="secondary"
        size="icon-lg"
        disabled={isDisabled}
        className="absolute right-4 bottom-4 z-10 rounded-full border-0 shadow-[0_10px_24px_rgba(0,0,0,0.28)] disabled:pointer-events-none disabled:opacity-0 md:right-[18px] md:bottom-[18px]"
        aria-label="Jump to previous message"
        onClick={onClick}
      >
        <ArrowUpToLineIcon className="size-4" />
      </Button>
    </TitleTooltip>
  )
}

type AppShellConversationSessionState = Pick<
  SessionState,
  "cwd" | "draft" | "sessionFile" | "sessionId" | "streaming"
>

const ConversationContentChangeContext = React.createContext<
  (() => void) | null
>(null)

function useAppShellConversationSessionState(store: PicoStore<SessionState>) {
  return useSelector(
    store,
    (sessionState) => ({
      cwd: sessionState.cwd,
      draft: sessionState.draft,
      sessionFile: sessionState.sessionFile,
      sessionId: sessionState.sessionId,
      streaming: sessionState.streaming,
    }),
    { compare: shallowRecordEqual }
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
        className="h-full overflow-x-hidden overflow-y-auto overscroll-contain px-4 outline-none [overflow-anchor:none]"
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

const COMPACT_WORKING_LABEL = "Compacting context..."
const COMPACT_CANCELLED_LABEL = "Error: Compaction cancelled"

type AppShellWorkingState = {
  label: string
  summary?: string
  done?: boolean
  error?: boolean
  cancelable?: boolean
}

function sameWorkingState(
  left: AppShellWorkingState | null,
  right: AppShellWorkingState | null
) {
  return (
    left?.label === right?.label &&
    left?.summary === right?.summary &&
    left?.done === right?.done &&
    left?.error === right?.error &&
    left?.cancelable === right?.cancelable
  )
}

function AppShellWorkingIndicatorLabel({
  fallbackLabel,
  hiddenThinkingPreviewStore,
  useHiddenThinkingPreview,
}: {
  fallbackLabel: string
  hiddenThinkingPreviewStore: PicoStore<string>
  useHiddenThinkingPreview: boolean
}) {
  const hiddenThinkingPreview = useSelector(hiddenThinkingPreviewStore)
  const visibleLabel =
    useHiddenThinkingPreview && hiddenThinkingPreview
      ? hiddenThinkingPreview
      : fallbackLabel

  return <div className="font-medium text-foreground">{visibleLabel}</div>
}

function AppShellMessagesWorkingIndicator({
  hiddenThinkingPreviewStore,
  onCancel,
  state,
  useHiddenThinkingPreview,
}: {
  hiddenThinkingPreviewStore: PicoStore<string>
  onCancel?: () => void
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
        ) : state.error ? (
          <OctagonXIcon className="size-4 text-destructive" />
        ) : (
          <Spinner />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center justify-start gap-2">
          <div className="min-w-0 shrink-0">
            {state.done ? (
              <div className="font-medium text-foreground">Done</div>
            ) : state.error ? (
              <div className="font-medium text-destructive">{state.label}</div>
            ) : (
              <AppShellWorkingIndicatorLabel
                fallbackLabel={state.label}
                hiddenThinkingPreviewStore={hiddenThinkingPreviewStore}
                useHiddenThinkingPreview={useHiddenThinkingPreview}
              />
            )}
          </div>
          {state.cancelable && !state.done && !state.error && onCancel ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="gap-1.5 text-xs"
              onClick={onCancel}
            >
              Cancel
              <Kbd>Esc</Kbd>
            </Button>
          ) : null}
        </div>
        {state.summary ? (
          <div className="truncate text-muted-foreground">{state.summary}</div>
        ) : null}
      </div>
    </div>
  )
}

function AppShellTabsList({
  sessionStore,
  viewerContextId,
}: {
  sessionStore: PicoStore<SessionState>
  viewerContextId: string
}) {
  const cwd = useSelector(sessionStore, (sessionState) => sessionState.cwd)

  return (
    <TabsList className="w-full gap-2 rounded-none border-b border-border/70 bg-background p-2 group-data-horizontal/tabs:h-auto md:hidden">
      <TabsTrigger
        value="session"
        className="h-8 data-active:bg-muted dark:data-active:bg-muted"
      >
        Session
      </TabsTrigger>
      <TabsTrigger
        value="git"
        className="h-8 data-active:bg-muted dark:data-active:bg-muted"
      >
        <GitTabStatusText viewerContextId={viewerContextId} cwd={cwd} />
      </TabsTrigger>
    </TabsList>
  )
}

const AppShellGitPanelController = React.memo(
  function AppShellGitPanelController({
    active,
    onCloseAllFiles,
    onCloseFile,
    onCloseFilesToRight,
    onCloseOtherFiles,
    onOpenFile,
    onReorderFiles,
    rightSidebarStore,
    sessionStore,
    viewerContextId,
  }: {
    active: boolean
    onCloseAllFiles: () => void
    onCloseFile: (path: string) => void
    onCloseFilesToRight: (path: string) => void
    onCloseOtherFiles: (path: string) => void
    onOpenFile: (path: string, options?: OpenFileViewTabOptions) => void
    onReorderFiles: (paths: Array<string>) => void
    rightSidebarStore: PicoStore<AppShellRightSidebarState>
    sessionStore: PicoStore<SessionState>
    viewerContextId: string
  }) {
    const cwd = useSelector(sessionStore, (sessionState) => sessionState.cwd)
    const activeFilePath = useSelector(
      rightSidebarStore,
      (state) => state.fileActivePath
    )
    const activeTab = useSelector(rightSidebarStore, (state) => state.activeTab)
    const filePreviewPath = useSelector(
      rightSidebarStore,
      (state) => state.filePreviewPath
    )
    const fileTabs = useSelector(
      rightSidebarStore,
      selectRightSidebarVisibleFileTabs,
      { compare: sameStringArray }
    )
    const fileTreeCollapsed = useSelector(
      rightSidebarStore,
      (state) => state.fileTreeCollapsed
    )

    return (
      <RightSidebar
        viewerContextId={viewerContextId}
        cwd={cwd}
        active={active}
        activeFilePath={activeFilePath}
        activeTab={activeTab}
        filePreviewPath={filePreviewPath}
        fileTabs={fileTabs}
        fileTreeCollapsed={fileTreeCollapsed}
        onActiveFileChange={(path) => {
          setStoreField(rightSidebarStore, "fileActivePath", path)
        }}
        onActiveTabChange={(tab) => {
          setRightSidebarActiveTab(rightSidebarStore, tab)
        }}
        onCloseAllFiles={onCloseAllFiles}
        onCloseFile={onCloseFile}
        onCloseFilesToRight={onCloseFilesToRight}
        onCloseOtherFiles={onCloseOtherFiles}
        onFileTreeCollapsedChange={(collapsed) => {
          setStoreField(rightSidebarStore, "fileTreeCollapsed", collapsed)
        }}
        onOpenFile={onOpenFile}
        onReorderFiles={onReorderFiles}
      />
    )
  }
)

function ConversationGroupView({
  className,
  group,
  hideFooter,
  hideThinking,
  hideToolBlocks,
  store,
}: {
  className: string
  group: RenderConversationGroupDescriptor
  hideFooter: boolean
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
      hideFooter={hideFooter}
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
  hideFooter,
  hideThinking,
  hideToolBlocks,
  store,
}: {
  className: string
  groupKey: string
  hideFooter: boolean
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
      <AssistantMessagesStoreCard
        hideFooter={hideFooter}
        store={assistantMessagesStore}
      />
    </div>
  )
}

function AppShellConversationItemGroups({
  centerMessages,
  conversationItemsStore,
  hideFooter,
  hideThinking,
  hideToolBlocks,
}: {
  centerMessages: boolean
  conversationItemsStore: ConversationItemsStore
  hideFooter: boolean
  hideThinking: boolean
  hideToolBlocks: boolean
}) {
  const conversationMessageColumnClassName = centerMessages
    ? "mx-auto w-full max-w-[80ch]"
    : "w-full"
  const renderedConversationGroups = useConversationGroupDescriptors({
    store: conversationItemsStore,
    hideFooter,
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
          hideFooter={hideFooter}
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
  workingStateStore: PicoStore<AppShellWorkingState | null>
}) {
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  const hasAssistantOutput = useConversationHasAssistantOutput(
    conversationItemsStore
  )
  const workingState = useSelector(workingStateStore)
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
            : "This is the native Pico session view backed by the new TypeScript runtime."}
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
  onCancelCompaction,
  streaming,
  workingStateStore,
}: {
  centerMessages: boolean
  conversationItemsStore: ConversationItemsStore
  hiddenThinkingPreviewStore: PicoStore<string>
  hideThinking: boolean
  onCancelCompaction: () => void
  streaming: boolean
  workingStateStore: PicoStore<AppShellWorkingState | null>
}) {
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  const hasAssistantOutput = useConversationHasAssistantOutput(
    conversationItemsStore
  )
  const conversationMessageColumnClassName = centerMessages
    ? "mx-auto w-full max-w-[80ch]"
    : "w-full"
  const workingState = useSelector(workingStateStore)
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
        onCancel={onCancelCompaction}
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
  sessionStore: PicoStore<SessionState>
}) {
  const hideThinking = useSelector(
    sessionStore,
    (sessionState) => sessionState.hideThinkingBlock
  )
  const streaming = useSelector(
    sessionStore,
    (sessionState) => sessionState.streaming
  )
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  if (!hasMessages) return null

  return (
    <div className="flex flex-col gap-4 pt-4">
      <AppShellConversationItemGroups
        centerMessages={centerMessages}
        conversationItemsStore={conversationItemsStore}
        hideFooter={streaming}
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
    onCancelCompaction,
    onCreateSession,
    sessionStore,
    viewerContextId,
    workingStateStore,
  }: {
    awaitingFirstTurn: boolean
    conversationFrameRef: React.RefObject<AppShellConversationFrameHandle | null>
    conversationItemsStore: ConversationItemsStore
    displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
    hiddenThinkingPreviewStore: PicoStore<string>
    isSessionViewLoading: boolean
    isSubmitting: boolean
    onCancelCompaction: () => void
    onCreateSession: () => void
    sessionStore: PicoStore<SessionState>
    viewerContextId: string
    workingStateStore: PicoStore<AppShellWorkingState | null>
  }) {
    const sessionState = useAppShellConversationSessionState(sessionStore)
    const { autoScrollEnabled, centerMessages, hideToolBlocks } =
      useSelector(displaySettingsStore)
    const hideThinking = useSelector(
      sessionStore,
      (currentSessionState) => currentSessionState.hideThinkingBlock
    )

    React.useLayoutEffect(() => {
      conversationItemsStore.setItems(sessionStore.state.items)
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
              onCancelCompaction={onCancelCompaction}
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
  store: PicoStore<AppShellComposerSnapshot>
) {
  return useSelector(store)
}

function gitStatusQueryOptions({
  cwd,
  viewerContextId,
}: {
  cwd: string
  viewerContextId: string
}) {
  return {
    queryKey: picoQueryKeys.gitStatus(viewerContextId, cwd),
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
    queryKey: picoQueryKeys.gitBranches(viewerContextId, cwd),
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

type NewSessionComposerBranchCheckoutPayload = {
  branch: string
  create?: boolean
}

function NewSessionComposerSelectors({
  cwd,
  defaultNewSessionDirectory,
  directoryOptions,
  onCreateSession,
  onOpenAddDirectoryDialog,
  viewerContextId,
}: {
  cwd?: string
  defaultNewSessionDirectory: string
  directoryOptions: Array<{ path: string; label: string }>
  onCreateSession: (cwdOverride?: string) => void
  onOpenAddDirectoryDialog: () => void
  viewerContextId: string
}) {
  const queryClient = useQueryClient()
  const [createBranchOpen, setCreateBranchOpen] = React.useState(false)
  const [createBranchName, setCreateBranchName] = React.useState("")
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
    mutationFn: async (payload: NewSessionComposerBranchCheckoutPayload) =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-checkout", {
          contextId: viewerContextId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: selectedDirectory, ...payload }),
        }
      ),
    onSuccess: (_result, payload) => {
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitStatus(viewerContextId, selectedDirectory),
      })
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitBranches(viewerContextId, selectedDirectory),
      })
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitFiles(viewerContextId, selectedDirectory),
      })
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitCommits(viewerContextId, selectedDirectory),
      })
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.projectFileTree(
          viewerContextId,
          selectedDirectory
        ),
      })
      void queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitFileReviews(
          viewerContextId,
          selectedDirectory
        ),
      })
      setCreateBranchOpen(false)
      setCreateBranchName("")
      toast.success(
        payload.create
          ? `Created and switched to ${payload.branch}`
          : `Switched to ${payload.branch}`
      )
    },
    onError: (error, payload) => {
      toast.error(
        error instanceof Error
          ? error.message
          : payload.create
            ? "Failed to create branch"
            : "Failed to switch branch"
      )
    },
  })

  const createBranch = () => {
    const branch = createBranchName.trim()
    if (!branch || checkoutBranchMutation.isPending) return
    checkoutBranchMutation.mutate({ branch, create: true })
  }

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
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onOpenAddDirectoryDialog}>
            <FolderPlusIcon className="size-4 shrink-0" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span>Add directory…</span>
              <span className="truncate text-xs text-muted-foreground">
                Search or paste a path for this new session.
              </span>
            </div>
          </DropdownMenuItem>
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
            <DropdownMenuItem
              disabled={checkoutBranchMutation.isPending}
              onClick={() => setCreateBranchOpen(true)}
            >
              <GitBranchIcon className="size-4 shrink-0" aria-hidden="true" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span>Create branch…</span>
                <span className="truncate text-xs text-muted-foreground">
                  Create and switch from the current HEAD.
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
                      checkoutBranchMutation.mutate({ branch: branch.name })
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

      <Dialog
        open={createBranchOpen}
        onOpenChange={(open) => {
          setCreateBranchOpen(open)
          if (!open) setCreateBranchName("")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create branch</DialogTitle>
            <DialogDescription>
              Create a branch in {formatFolderName(selectedDirectory)} and
              switch to it for the new session.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              createBranch()
            }}
          >
            <Input
              autoFocus
              value={createBranchName}
              onChange={(event) => setCreateBranchName(event.target.value)}
              placeholder="branch-name"
              disabled={checkoutBranchMutation.isPending}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateBranchOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  !createBranchName.trim() || checkoutBranchMutation.isPending
                }
              >
                {checkoutBranchMutation.isPending ? <Spinner /> : null}
                Create branch
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
    displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
    fileInputRef: React.RefObject<HTMLInputElement | null>
    sessionStore: PicoStore<SessionState>
    store: PicoStore<AppShellComposerSnapshot>
    topContent?: React.ReactNode
  }) {
    const snapshot = useAppShellComposerSnapshot(store)
    const centerMessages = useSelector(
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
        activeSessionId={snapshot.activeSessionId}
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
        viewerContextId={snapshot.viewerContextId}
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
  displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  hiddenThinkingPreviewStore: PicoStore<string>
  isSessionViewLoading: boolean
  isSubmitting: boolean
  newSessionDirectoryOptions: Array<{ path: string; label: string }>
  onCancelCompaction: () => void
  onCreateSession: (cwdOverride?: string) => void
  onOpenAddDirectoryDialog: () => void
  sessionStore: PicoStore<SessionState>
  store: PicoStore<AppShellComposerSnapshot>
  viewerContextId: string
  workingStateStore: PicoStore<AppShellWorkingState | null>
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
  onCancelCompaction,
  onCreateSession,
  onOpenAddDirectoryDialog,
  sessionStore,
  store,
  viewerContextId,
  workingStateStore,
}: AppShellSessionContentProps) {
  const sessionState = useSelector(
    sessionStore,
    (currentSessionState) => ({
      cwd: currentSessionState.cwd,
      draft: currentSessionState.draft,
    }),
    { compare: shallowRecordEqual }
  )
  const hasMessages = useConversationHasMessages(conversationItemsStore)
  const showNewSessionComposer =
    sessionState.draft && !hasMessages && !isSessionViewLoading

  if (showNewSessionComposer) {
    return (
      <div className="grid min-h-0 flex-1 items-end justify-items-center overflow-auto p-4 md:place-items-center">
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
              onOpenAddDirectoryDialog={onOpenAddDirectoryDialog}
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
        onCancelCompaction={onCancelCompaction}
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
  onCloseAllFiles,
  onCloseFile,
  onCloseFilesToRight,
  onCloseOtherFiles,
  onOpenFile,
  onReorderFiles,
  rightSidebarStore,
  sessionStore,
  viewerContextId,
}: {
  active: boolean
  onCloseAllFiles: () => void
  onCloseFile: (path: string) => void
  onCloseFilesToRight: (path: string) => void
  onCloseOtherFiles: (path: string) => void
  onOpenFile: (path: string, options?: OpenFileViewTabOptions) => void
  onReorderFiles: (paths: Array<string>) => void
  rightSidebarStore: PicoStore<AppShellRightSidebarState>
  sessionStore: PicoStore<SessionState>
  viewerContextId: string
}) {
  const cwd = useSelector(sessionStore, (sessionState) => sessionState.cwd)
  const activeFilePath = useSelector(
    rightSidebarStore,
    (state) => state.fileActivePath
  )
  const activeTab = useSelector(rightSidebarStore, (state) => state.activeTab)
  const filePreviewPath = useSelector(
    rightSidebarStore,
    (state) => state.filePreviewPath
  )
  const fileTabs = useSelector(
    rightSidebarStore,
    selectRightSidebarVisibleFileTabs,
    { compare: sameStringArray }
  )
  const fileTreeCollapsed = useSelector(
    rightSidebarStore,
    (state) => state.fileTreeCollapsed
  )

  return (
    <aside
      aria-label="Right sidebar"
      aria-hidden={!active}
      data-state={active ? "open" : "closed"}
      className="flex h-full min-h-0 w-full min-w-0 flex-col border-l border-border/70 bg-background data-[state=closed]:pointer-events-none data-[state=closed]:border-transparent"
    >
      <RightSidebar
        viewerContextId={viewerContextId}
        cwd={cwd}
        active={active}
        activeFilePath={activeFilePath}
        activeTab={activeTab}
        filePreviewPath={filePreviewPath}
        fileTabs={fileTabs}
        fileTreeCollapsed={fileTreeCollapsed}
        onActiveFileChange={(path) => {
          setStoreField(rightSidebarStore, "fileActivePath", path)
        }}
        onActiveTabChange={(tab) => {
          setRightSidebarActiveTab(rightSidebarStore, tab)
        }}
        onCloseAllFiles={onCloseAllFiles}
        onCloseFile={onCloseFile}
        onCloseFilesToRight={onCloseFilesToRight}
        onCloseOtherFiles={onCloseOtherFiles}
        onFileTreeCollapsedChange={(collapsed) => {
          setStoreField(rightSidebarStore, "fileTreeCollapsed", collapsed)
        }}
        onOpenFile={onOpenFile}
        onReorderFiles={onReorderFiles}
        showToolbar={false}
      />
    </aside>
  )
}

const DESKTOP_DEFAULT_FILE_VIEW_WIDTH = 520
const DESKTOP_DEFAULT_GIT_PANEL_WIDTH = 320
const DESKTOP_MIN_SESSION_WIDTH = 320
const DESKTOP_MIN_SIDE_PANEL_WIDTH = 260
const DESKTOP_MAX_STORED_SIDE_PANEL_WIDTH = 1600

type DesktopSidePanelWidths = {
  fileViewWidth: number
  gitPanelWidth: number
}

function defaultDesktopSidePanelWidths(): DesktopSidePanelWidths {
  return {
    fileViewWidth: DESKTOP_DEFAULT_FILE_VIEW_WIDTH,
    gitPanelWidth: DESKTOP_DEFAULT_GIT_PANEL_WIDTH,
  }
}

function clampStoredDesktopPanelWidth(value: unknown, fallback: number) {
  const width = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(width)) return fallback

  return Math.round(
    Math.min(
      DESKTOP_MAX_STORED_SIDE_PANEL_WIDTH,
      Math.max(DESKTOP_MIN_SIDE_PANEL_WIDTH, width)
    )
  )
}

function normalizeDesktopSidePanelWidths(
  value: unknown
): DesktopSidePanelWidths {
  if (!value || typeof value !== "object")
    return defaultDesktopSidePanelWidths()

  const widths = value as Partial<Record<keyof DesktopSidePanelWidths, unknown>>
  return {
    fileViewWidth: clampStoredDesktopPanelWidth(
      widths.fileViewWidth,
      DESKTOP_DEFAULT_FILE_VIEW_WIDTH
    ),
    gitPanelWidth: clampStoredDesktopPanelWidth(
      widths.gitPanelWidth,
      DESKTOP_DEFAULT_GIT_PANEL_WIDTH
    ),
  }
}

function readStoredDesktopSidePanelWidths(): DesktopSidePanelWidths {
  try {
    const raw = safeLocalStorageGetItem(RIGHT_SIDEBAR_WIDTHS_STORAGE_KEY)
    if (!raw) return defaultDesktopSidePanelWidths()

    return normalizeDesktopSidePanelWidths(JSON.parse(raw))
  } catch {
    return defaultDesktopSidePanelWidths()
  }
}

function storeDesktopSidePanelWidths(widths: DesktopSidePanelWidths) {
  safeLocalStorageSetItem(
    RIGHT_SIDEBAR_WIDTHS_STORAGE_KEY,
    JSON.stringify(normalizeDesktopSidePanelWidths(widths))
  )
}

function sameDesktopSidePanelWidths(
  left: DesktopSidePanelWidths,
  right: DesktopSidePanelWidths
) {
  return (
    left.fileViewWidth === right.fileViewWidth &&
    left.gitPanelWidth === right.gitPanelWidth
  )
}

function clampDesktopPanelSize(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  if (max <= min) return Math.max(0, max)
  return Math.min(max, Math.max(min, value))
}

function fitDesktopSidePanelWidths({
  availableWidth,
  fileOpen,
  fileWidth,
  gitOpen,
  gitWidth,
}: {
  availableWidth: number
  fileOpen: boolean
  fileWidth: number
  gitOpen: boolean
  gitWidth: number
}) {
  const maxSideWidth = Math.max(0, availableWidth - DESKTOP_MIN_SESSION_WIDTH)

  if (!fileOpen && !gitOpen) {
    return { fileWidth: 0, gitWidth: 0, sideWidth: 0 }
  }

  if (fileOpen && !gitOpen) {
    const nextFileWidth = clampDesktopPanelSize(
      fileWidth,
      Math.min(DESKTOP_MIN_SIDE_PANEL_WIDTH, maxSideWidth),
      maxSideWidth
    )
    return { fileWidth: nextFileWidth, gitWidth: 0, sideWidth: nextFileWidth }
  }

  if (!fileOpen && gitOpen) {
    const nextGitWidth = clampDesktopPanelSize(
      gitWidth,
      Math.min(DESKTOP_MIN_SIDE_PANEL_WIDTH, maxSideWidth),
      maxSideWidth
    )
    return { fileWidth: 0, gitWidth: nextGitWidth, sideWidth: nextGitWidth }
  }

  const requestedTotal = Math.max(1, fileWidth + gitWidth)
  if (requestedTotal <= maxSideWidth) {
    return {
      fileWidth,
      gitWidth,
      sideWidth: fileWidth + gitWidth,
    }
  }

  const minWidth = Math.min(DESKTOP_MIN_SIDE_PANEL_WIDTH, maxSideWidth / 2)
  let nextFileWidth = Math.round((fileWidth / requestedTotal) * maxSideWidth)
  nextFileWidth = Math.max(
    minWidth,
    Math.min(maxSideWidth - minWidth, nextFileWidth)
  )
  const nextGitWidth = Math.max(0, maxSideWidth - nextFileWidth)

  return {
    fileWidth: nextFileWidth,
    gitWidth: nextGitWidth,
    sideWidth: nextFileWidth + nextGitWidth,
  }
}

function AppShellDesktopResizeHandle({
  label,
  max,
  min,
  onResize,
  onResizeEnd,
  onResizeStart,
  size,
}: {
  label: string
  max: number
  min: number
  onResize: (size: number) => void
  onResizeEnd?: () => void
  onResizeStart?: () => void
  size: number
}) {
  const propsRef = useLatestRef({
    max,
    min,
    onResize,
    onResizeEnd,
    onResizeStart,
    size,
  })
  const [horizontalResizeCursor, setHorizontalResizeCursor] =
    React.useState<SidebarHorizontalResizeCursor>("col-resize")
  const [resizeTargetMinimumSize, setResizeTargetMinimumSize] =
    React.useState(10)

  React.useEffect(() => {
    const updateResizeTarget = () => {
      setResizeTargetMinimumSize(getSidebarResizeTargetMinimumSize())
    }
    const coarsePointerQuery = window.matchMedia("(pointer:coarse)")

    setHorizontalResizeCursor(getSidebarHorizontalResizeCursor())
    updateResizeTarget()
    coarsePointerQuery.addEventListener("change", updateResizeTarget)
    return () => {
      coarsePointerQuery.removeEventListener("change", updateResizeTarget)
    }
  }, [])

  const horizontalResizeCursorClass =
    horizontalResizeCursor === "ew-resize"
      ? "cursor-ew-resize"
      : "cursor-col-resize"

  const resizeTo = (nextSize: number) => {
    const current = propsRef.current
    current.onResize(clampDesktopPanelSize(nextSize, current.min, current.max))
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={0}
      style={
        {
          "--resize-target-width": `${resizeTargetMinimumSize}px`,
          cursor: horizontalResizeCursor,
        } as React.CSSProperties
      }
      className={`absolute inset-y-0 left-0 z-20 w-(--resize-target-width) -translate-x-1/2 touch-none bg-transparent outline-hidden after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 ${resizeRailPrimaryInteractiveClass} ${horizontalResizeCursorClass}`}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        const delta = event.shiftKey ? 48 : 16
        resizeTo(
          propsRef.current.size + (event.key === "ArrowLeft" ? delta : -delta)
        )
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()

        const current = propsRef.current
        const startX = event.clientX
        const startSize = current.size

        const cursor = getSidebarHorizontalResizeCursor()
        const previousCursor = document.body.style.cursor
        const previousUserSelect = document.body.style.userSelect
        const cleanupGlobalResizeCursor = installGlobalResizeCursor(cursor)

        current.onResizeStart?.()
        document.body.style.userSelect = "none"
        document.body.style.cursor = cursor

        const handlePointerMove = (moveEvent: PointerEvent) => {
          resizeTo(startSize + startX - moveEvent.clientX)
        }
        const handlePointerUp = () => {
          cleanupGlobalResizeCursor()
          document.body.style.userSelect = previousUserSelect
          document.body.style.cursor = previousCursor
          document.removeEventListener("pointermove", handlePointerMove)
          document.removeEventListener("pointerup", handlePointerUp)
          document.removeEventListener("pointercancel", handlePointerUp)
          propsRef.current.onResizeEnd?.()
        }

        document.addEventListener("pointermove", handlePointerMove)
        document.addEventListener("pointerup", handlePointerUp)
        document.addEventListener("pointercancel", handlePointerUp)
      }}
    />
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
  onCancelCompaction,
  onCreateSession,
  onOpenAddDirectoryDialog,
  onCloseAllFileViewTabs,
  onCloseFileViewTab,
  onCloseFileViewTabsToRight,
  onCloseOtherFileViewTabs,
  onOpenFileViewTab,
  onReorderFileViewTabs,
  onValueChange,
  rightSidebarStore,
  sessionStore,
  store,
  viewerContextId,
  workingStateStore,
}: AppShellSessionContentProps & {
  appUiStore: PicoStore<AppShellUiState>
  gitPanelOpen: boolean
  isMobile: boolean
  onCloseAllFileViewTabs: () => void
  onCloseFileViewTab: (path: string) => void
  onCloseFileViewTabsToRight: (path: string) => void
  onCloseOtherFileViewTabs: (path: string) => void
  onOpenFileViewTab: (path: string, options?: OpenFileViewTabOptions) => void
  onReorderFileViewTabs: (paths: Array<string>) => void
  onValueChange: (value: string) => void
  rightSidebarStore: PicoStore<AppShellRightSidebarState>
}) {
  const currentTab = useSelector(appUiStore, (state) => state.currentTab)
  const isDraftSession = useSelector(
    sessionStore,
    (sessionState) => sessionState.draft
  )
  const showTabsList = !isDraftSession || isSessionViewLoading
  const sessionVisibleClassName =
    currentTab === "git"
      ? "hidden min-h-0 flex-1 flex-col md:flex"
      : "flex min-h-0 flex-1 flex-col"
  const mobileGitClassName =
    currentTab === "git" ? "min-h-0 flex-1 overflow-hidden md:hidden" : "hidden"
  const rightSidebarHasVisibleFiles = useSelector(
    rightSidebarStore,
    selectRightSidebarHasVisibleFiles
  )
  const desktopGitPanelOpen = !isMobile && gitPanelOpen
  const desktopFileViewOpen =
    !isMobile && gitPanelOpen && rightSidebarHasVisibleFiles
  const desktopSideWorkspaceOpen = desktopFileViewOpen || desktopGitPanelOpen
  const desktopLayoutRef = React.useRef<HTMLDivElement | null>(null)
  const [desktopLayoutWidth, setDesktopLayoutWidth] = React.useState(0)
  const [desktopSidePanelWidths, setDesktopSidePanelWidthsState] =
    React.useState<DesktopSidePanelWidths>(() =>
      defaultDesktopSidePanelWidths()
    )
  const desktopSidePanelWidthsLoadedRef = React.useRef(false)
  const desktopSidePanelWidthsRef = React.useRef(desktopSidePanelWidths)
  desktopSidePanelWidthsRef.current = desktopSidePanelWidths
  const desktopFileViewWidth = desktopSidePanelWidths.fileViewWidth
  const desktopGitPanelWidth = desktopSidePanelWidths.gitPanelWidth
  const setDesktopSidePanelWidths = (
    action: React.SetStateAction<DesktopSidePanelWidths>
  ) => {
    const current = desktopSidePanelWidthsRef.current
    const next = normalizeDesktopSidePanelWidths(
      applyStoreAction(current, action)
    )
    if (sameDesktopSidePanelWidths(current, next)) return

    desktopSidePanelWidthsRef.current = next
    setDesktopSidePanelWidthsState(next)
    if (desktopSidePanelWidthsLoadedRef.current) {
      storeDesktopSidePanelWidths(next)
    }
  }
  const setDesktopFileViewWidth = (action: React.SetStateAction<number>) => {
    setDesktopSidePanelWidths((current) => ({
      ...current,
      fileViewWidth: clampStoredDesktopPanelWidth(
        applyStoreAction(current.fileViewWidth, action),
        DESKTOP_DEFAULT_FILE_VIEW_WIDTH
      ),
    }))
  }
  const setDesktopGitPanelWidth = (action: React.SetStateAction<number>) => {
    setDesktopSidePanelWidths((current) => ({
      ...current,
      gitPanelWidth: clampStoredDesktopPanelWidth(
        applyStoreAction(current.gitPanelWidth, action),
        DESKTOP_DEFAULT_GIT_PANEL_WIDTH
      ),
    }))
  }
  const [desktopGitPanelMounted, setDesktopGitPanelMounted] =
    React.useState(desktopGitPanelOpen)
  const [desktopPanelResizing, setDesktopPanelResizing] = React.useState(false)

  React.useEffect(() => {
    const storedWidths = readStoredDesktopSidePanelWidths()
    desktopSidePanelWidthsLoadedRef.current = true
    desktopSidePanelWidthsRef.current = storedWidths
    setDesktopSidePanelWidthsState((current) =>
      sameDesktopSidePanelWidths(current, storedWidths) ? current : storedWidths
    )
  }, [])

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
          onCancelCompaction={onCancelCompaction}
          onCreateSession={onCreateSession}
          onOpenAddDirectoryDialog={onOpenAddDirectoryDialog}
          sessionStore={sessionStore}
          store={store}
          viewerContextId={viewerContextId}
          workingStateStore={workingStateStore}
        />
      </div>

      {isMobile ? (
        <div className={mobileGitClassName}>
          <AppShellGitPanelController
            viewerContextId={viewerContextId}
            sessionStore={sessionStore}
            active={currentTab === "git"}
            rightSidebarStore={rightSidebarStore}
            onCloseAllFiles={onCloseAllFileViewTabs}
            onCloseFile={onCloseFileViewTab}
            onCloseFilesToRight={onCloseFileViewTabsToRight}
            onCloseOtherFiles={onCloseOtherFileViewTabs}
            onOpenFile={onOpenFileViewTab}
            onReorderFiles={onReorderFileViewTabs}
          />
        </div>
      ) : null}
    </div>
  )

  React.useLayoutEffect(() => {
    if (isMobile) {
      setDesktopGitPanelMounted(false)
      return
    }

    if (desktopSideWorkspaceOpen) {
      setDesktopGitPanelMounted(true)
    }
  }, [desktopSideWorkspaceOpen, isMobile])

  React.useLayoutEffect(() => {
    if (isMobile) return

    const element = desktopLayoutRef.current
    if (!element) return

    const updateWidth = () => {
      setDesktopLayoutWidth(element.clientWidth)
    }

    updateWidth()

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth)
      return () => window.removeEventListener("resize", updateWidth)
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [isMobile])

  const desktopAvailableWidth =
    desktopLayoutWidth ||
    (typeof window === "undefined" ? 1200 : window.innerWidth)
  const desktopGitPanelRendered =
    desktopSideWorkspaceOpen || desktopGitPanelMounted || desktopGitPanelOpen
  const desktopFittedWidths = fitDesktopSidePanelWidths({
    availableWidth: desktopAvailableWidth,
    fileOpen: desktopFileViewOpen,
    fileWidth: desktopFileViewWidth,
    gitOpen: desktopGitPanelOpen,
    gitWidth: desktopGitPanelWidth,
  })
  const desktopSideWorkspaceRendered =
    desktopSideWorkspaceOpen || desktopGitPanelMounted
  const desktopSideWorkspaceWidth = desktopSideWorkspaceOpen
    ? desktopFittedWidths.sideWidth
    : 0
  const desktopTransitionClassName = !desktopPanelResizing
    ? "transition-[width] duration-200 ease-linear"
    : ""
  const desktopPanelGroupClassName =
    "relative flex h-full min-h-0 w-full flex-1 overflow-hidden"
  const desktopResizeStart = () => {
    setDesktopPanelResizing(true)
  }
  const desktopResizeEnd = () => {
    setDesktopPanelResizing(false)
  }
  const desktopSideWorkspaceMaxWidth = Math.max(
    0,
    desktopAvailableWidth - DESKTOP_MIN_SESSION_WIDTH
  )
  const setDesktopSideWorkspaceWidth = (nextSize: number) => {
    if (!desktopFileViewOpen) {
      setDesktopGitPanelWidth(nextSize)
      return
    }

    setDesktopFileViewWidth(
      Math.max(DESKTOP_MIN_SIDE_PANEL_WIDTH, nextSize - desktopGitPanelWidth)
    )
  }

  return (
    <Tabs
      value={currentTab}
      onValueChange={onValueChange}
      className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      {showTabsList ? (
        <AppShellTabsList
          sessionStore={sessionStore}
          viewerContextId={viewerContextId}
        />
      ) : null}

      {isMobile ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">{sessionPane}</div>
      ) : (
        <div ref={desktopLayoutRef} className={desktopPanelGroupClassName}>
          <div
            data-desktop-panel="session"
            className={`h-full min-h-0 min-w-0 shrink-0 overflow-hidden ${desktopTransitionClassName}`}
            style={{
              width: desktopSideWorkspaceOpen
                ? `calc(100% - ${desktopSideWorkspaceWidth}px)`
                : "100%",
            }}
          >
            {sessionPane}
          </div>

          {desktopSideWorkspaceRendered ? (
            <aside
              aria-label="Desktop side workspace"
              aria-hidden={!desktopSideWorkspaceOpen}
              data-state={desktopSideWorkspaceOpen ? "open" : "closed"}
              data-desktop-panel="side-workspace"
              className={`flex h-full min-h-0 min-w-0 shrink-0 overflow-visible bg-background data-[state=closed]:pointer-events-none ${desktopTransitionClassName}`}
              style={{ width: `${desktopSideWorkspaceWidth}px` }}
            >
              {desktopGitPanelRendered ? (
                <div
                  data-desktop-panel="git"
                  className={`relative h-full min-h-0 min-w-0 shrink-0 overflow-visible ${desktopTransitionClassName}`}
                  style={{ width: `${desktopSideWorkspaceWidth}px` }}
                >
                  {desktopGitPanelOpen ? (
                    <AppShellDesktopResizeHandle
                      label="Resize right sidebar"
                      min={Math.min(
                        DESKTOP_MIN_SIDE_PANEL_WIDTH,
                        desktopSideWorkspaceMaxWidth
                      )}
                      max={desktopSideWorkspaceMaxWidth}
                      size={desktopSideWorkspaceWidth}
                      onResize={setDesktopSideWorkspaceWidth}
                      onResizeStart={desktopResizeStart}
                      onResizeEnd={desktopResizeEnd}
                    />
                  ) : null}
                  <div className="h-full min-h-0 min-w-0 overflow-hidden">
                    {desktopGitPanelRendered ? (
                      <AppShellDesktopGitPanel
                        viewerContextId={viewerContextId}
                        sessionStore={sessionStore}
                        active={desktopGitPanelOpen}
                        rightSidebarStore={rightSidebarStore}
                        onCloseAllFiles={onCloseAllFileViewTabs}
                        onCloseFile={onCloseFileViewTab}
                        onCloseFilesToRight={onCloseFileViewTabsToRight}
                        onCloseOtherFiles={onCloseOtherFileViewTabs}
                        onOpenFile={onOpenFileViewTab}
                        onReorderFiles={onReorderFileViewTabs}
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>
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
      const body = event.cwd || sessionCwd || "Open Pico to continue"
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
    isPageForeground,
    onConsumeSessionDoneEvents,
    onSelectSession,
    sessionCwd,
    sessionDoneDesktopNotificationsEnabled,
    sessionDoneEvents,
    sessionDoneSoundEnabled,
  ])

  const sidebarUnreadVersion = useSelector(sidebarStore, (snapshot) =>
    snapshot.derived.sidebarSessions
      .filter((session) => session.unread)
      .map((session) => sessionNotificationKey(session))
      .filter(Boolean)
      .sort()
      .join("\n")
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
    appUi: PicoStore<AppShellUiState>
    composer: PicoStore<AppShellComposerSnapshot>
    contextUsage: ComposerContextUsageStore
    conversationItems: ConversationItemsStore
    displaySettings: PicoStore<AppShellDisplaySettingsState>
    draftFlow: PicoStore<AppShellDraftFlowState>
    notification: PicoStore<AppShellNotificationState>
    rightSidebar: PicoStore<AppShellRightSidebarState>
    session: PicoStore<SessionState>
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
  const queryClient = useQueryClient()
  const initialSessionStateRef = React.useRef<SessionState | null>(null)
  if (!initialSessionStateRef.current) {
    initialSessionStateRef.current = createInitialSessionState()
  }
  const sessionStoreRef = React.useRef<PicoStore<SessionState> | null>(null)
  if (!sessionStoreRef.current) {
    sessionStoreRef.current = createPicoStore(initialSessionStateRef.current)
  }
  const sessionStore = sessionStoreRef.current
  const sessionStateRef = React.useRef(sessionStore.state)
  const appUiStoreRef = React.useRef<PicoStore<AppShellUiState> | null>(null)
  if (!appUiStoreRef.current) {
    appUiStoreRef.current = createPicoStore<AppShellUiState>(
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
  const rightSidebarStoreRef =
    React.useRef<PicoStore<AppShellRightSidebarState> | null>(null)
  if (!rightSidebarStoreRef.current) {
    rightSidebarStoreRef.current = createPicoStore(
      createInitialRightSidebarState()
    )
  }
  const rightSidebarStore = rightSidebarStoreRef.current
  const setCurrentTab = React.useCallback<
    React.Dispatch<React.SetStateAction<string>>
  >(
    (action) => {
      setStoreField(appUiStore, "currentTab", action)
    },
    [appUiStore]
  )
  const setGitPanelOpen = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const nextOpen = applyStoreAction(appUiStore.state.gitPanelOpen, action)
      setStoreField(appUiStore, "gitPanelOpen", nextOpen)
      safeLocalStorageSetItem(
        RIGHT_SIDEBAR_OPEN_STORAGE_KEY,
        nextOpen ? "1" : "0"
      )
    },
    [appUiStore]
  )
  const setLoadingSessionId = React.useCallback<
    React.Dispatch<React.SetStateAction<string | null>>
  >(
    (action) => {
      setStoreField(appUiStore, "loadingSessionId", action)
    },
    [appUiStore]
  )
  const setInitialLoadingSessionId = React.useCallback<
    React.Dispatch<React.SetStateAction<string | null>>
  >(
    (action) => {
      setStoreField(appUiStore, "initialLoadingSessionId", action)
    },
    [appUiStore]
  )
  const previousRouteSessionIdRef = React.useRef(sessionId)
  const composerDraftSeedStoreRef = React.useRef<PicoStore<{
    text: string
    skillName?: string
    syncNonce: number
  }> | null>(null)
  if (!composerDraftSeedStoreRef.current) {
    composerDraftSeedStoreRef.current = createPicoStore({
      text: "",
      syncNonce: 0,
    })
  }
  const composerDraftSeedStore = composerDraftSeedStoreRef.current
  const composerImagesStoreRef = React.useRef<PicoStore<
    Array<PromptImage>
  > | null>(null)
  if (!composerImagesStoreRef.current) {
    composerImagesStoreRef.current = createPicoStore<Array<PromptImage>>([])
  }
  const composerImagesStore = composerImagesStoreRef.current
  const composerImagesRef = React.useRef<Array<PromptImage>>([])
  const displaySettingsStoreRef =
    React.useRef<PicoStore<AppShellDisplaySettingsState> | null>(null)
  if (!displaySettingsStoreRef.current) {
    displaySettingsStoreRef.current =
      createPicoStore<AppShellDisplaySettingsState>(
        {
          autoScrollEnabled: true,
          centerMessages: false,
          hideToolBlocks: false,
        },
        shallowRecordEqual
      )
  }
  const displaySettingsStore = displaySettingsStoreRef.current!
  const displaySettingsRef = React.useRef(displaySettingsStore.state)
  const hideToolBlocksRef = React.useRef(
    displaySettingsStore.state.hideToolBlocks
  )
  const setHideToolBlocks = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const current = displaySettingsStore.state
      const nextHideToolBlocks = applyStoreAction(
        current.hideToolBlocks,
        action
      )
      if (nextHideToolBlocks === current.hideToolBlocks) return
      const next = { ...current, hideToolBlocks: nextHideToolBlocks }
      displaySettingsRef.current = next
      hideToolBlocksRef.current = next.hideToolBlocks
      setStoreState(displaySettingsStore, next)
    },
    [displaySettingsStore]
  )
  const setCenterMessages = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const current = displaySettingsStore.state
      const nextCenterMessages = applyStoreAction(
        current.centerMessages,
        action
      )
      if (nextCenterMessages === current.centerMessages) return
      const next = { ...current, centerMessages: nextCenterMessages }
      displaySettingsRef.current = next
      setStoreState(displaySettingsStore, next)
    },
    [displaySettingsStore]
  )
  const setAutoScrollEnabled = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const current = displaySettingsStore.state
      const nextAutoScrollEnabled = applyStoreAction(
        current.autoScrollEnabled,
        action
      )
      if (nextAutoScrollEnabled === current.autoScrollEnabled) return
      const next = { ...current, autoScrollEnabled: nextAutoScrollEnabled }
      displaySettingsRef.current = next
      setStoreState(displaySettingsStore, next)
    },
    [displaySettingsStore]
  )
  const awaitingFirstTurnStoreRef = React.useRef<PicoStore<boolean> | null>(
    null
  )
  if (!awaitingFirstTurnStoreRef.current) {
    awaitingFirstTurnStoreRef.current = createPicoStore(false)
  }
  const awaitingFirstTurnStore = awaitingFirstTurnStoreRef.current
  const pendingDraftPromptStoreRef = React.useRef<PicoStore<{
    ownerKey: string
    message: string
    images: Array<PromptImage>
    streamingBehavior?: StreamingBehavior
    optimisticId?: string
  } | null> | null>(null)
  if (!pendingDraftPromptStoreRef.current) {
    pendingDraftPromptStoreRef.current = createPicoStore<{
      ownerKey: string
      message: string
      images: Array<PromptImage>
      streamingBehavior?: StreamingBehavior
      optimisticId?: string
    } | null>(null)
  }
  const pendingDraftPromptStore = pendingDraftPromptStoreRef.current
  const pendingDraftFollowUpsStoreRef = React.useRef<PicoStore<
    Array<{
      message: string
      images: Array<PromptImage>
      streamingBehavior: "steer" | "followUp"
      optimisticId?: string
    }>
  > | null>(null)
  if (!pendingDraftFollowUpsStoreRef.current) {
    pendingDraftFollowUpsStoreRef.current = createPicoStore<
      Array<{
        message: string
        images: Array<PromptImage>
        streamingBehavior: "steer" | "followUp"
        optimisticId?: string
      }>
    >([])
  }
  const pendingDraftFollowUpsStore = pendingDraftFollowUpsStoreRef.current
  const isSubmittingStoreRef = React.useRef<PicoStore<boolean> | null>(null)
  if (!isSubmittingStoreRef.current) {
    isSubmittingStoreRef.current = createPicoStore(false)
  }
  const isSubmittingStore = isSubmittingStoreRef.current
  const pendingMessagesStoreRef = React.useRef<PicoStore<
    Array<PendingComposerMessage>
  > | null>(null)
  if (!pendingMessagesStoreRef.current) {
    pendingMessagesStoreRef.current = createPicoStore<
      Array<PendingComposerMessage>
    >([])
  }
  const pendingMessagesStore = pendingMessagesStoreRef.current
  const notificationStoreRef =
    React.useRef<PicoStore<AppShellNotificationState> | null>(null)
  if (!notificationStoreRef.current) {
    notificationStoreRef.current = createPicoStore<AppShellNotificationState>(
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
      setStoreField(notificationStore, "sessionDoneEvents", action)
    },
    [notificationStore]
  )
  const setSessionDoneSoundEnabled = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      setStoreField(notificationStore, "sessionDoneSoundEnabled", action)
    },
    [notificationStore]
  )
  const setSessionDoneDesktopNotificationsEnabled = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      setStoreField(
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
      setStoreField(notificationStore, "desktopNotificationPermission", action)
    },
    [notificationStore]
  )
  const draftFlowStoreRef =
    React.useRef<PicoStore<AppShellDraftFlowState> | null>(null)
  if (!draftFlowStoreRef.current) {
    draftFlowStoreRef.current = createPicoStore<AppShellDraftFlowState>(
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
      setStoreField(draftFlowStore, "draftSessionLoadingOwnerKey", action)
    },
    [draftFlowStore]
  )
  const setStoredDraftDirectory = React.useCallback<
    React.Dispatch<React.SetStateAction<string>>
  >(
    (action) => {
      setStoreField(draftFlowStore, "storedDraftDirectory", action)
    },
    [draftFlowStore]
  )
  const recentDirectoriesStoreRef = React.useRef<PicoStore<
    Array<string>
  > | null>(null)
  if (!recentDirectoriesStoreRef.current) {
    recentDirectoriesStoreRef.current = createPicoStore<Array<string>>(
      [],
      sameStringArray
    )
  }
  const recentDirectoriesStore = recentDirectoriesStoreRef.current
  const setRecentDirectories = React.useCallback<
    React.Dispatch<React.SetStateAction<Array<string>>>
  >(
    (action) => {
      const current = recentDirectoriesStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      setStoreState(recentDirectoriesStore, next)
    },
    [recentDirectoriesStore]
  )
  const { isMobile, openMobile, openMobileSettled, setOpenMobile } =
    useSidebar()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const composerPanelRef = React.useRef<ComposerPanelHandle | null>(null)
  const composerStoreRef =
    React.useRef<PicoStore<AppShellComposerSnapshot> | null>(null)
  if (!composerStoreRef.current) {
    composerStoreRef.current = createPicoStore(
      createInitialAppShellComposerSnapshot(viewerContextId),
      sameAppShellComposerSnapshot
    )
  }
  const composerStore = composerStoreRef.current
  const contextUsageStoreRef = React.useRef<PicoStore<
    SessionState["contextUsage"]
  > | null>(null)
  if (!contextUsageStoreRef.current) {
    contextUsageStoreRef.current =
      createPicoStore<SessionState["contextUsage"]>(undefined)
  }
  const contextUsageStore = contextUsageStoreRef.current
  const contextUsageThrottlerRef = React.useRef<Throttler<
    (contextUsage: SessionState["contextUsage"]) => void
  > | null>(null)
  if (!contextUsageThrottlerRef.current) {
    contextUsageThrottlerRef.current = new Throttler(
      (contextUsage: SessionState["contextUsage"]) => {
        setStoreState(contextUsageStore, contextUsage)
      },
      {
        key: "pico.composer.context-usage",
        wait: 250,
        leading: true,
        trailing: true,
      }
    )
  }
  const contextUsageThrottler = contextUsageThrottlerRef.current
  React.useEffect(
    () => () => {
      contextUsageThrottler.flush()
      contextUsageThrottler.cancel()
    },
    [contextUsageThrottler]
  )
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
      const current = composerDraftSeedStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      batch(() => {
        setStoreState(composerDraftSeedStore, next)
        const currentComposerSnapshot = composerStore.state
        setStoreState(composerStore, {
          ...currentComposerSnapshot,
          composerSkill: currentComposerSnapshot.disabled
            ? undefined
            : next.skillName,
          composerSyncNonce: next.syncNonce,
          composerText: currentComposerSnapshot.disabled ? "" : next.text,
        })
      })
    },
    [composerDraftSeedStore, composerStore]
  )
  const setComposerImages = React.useCallback<
    React.Dispatch<React.SetStateAction<Array<PromptImage>>>
  >(
    (action) => {
      const current = composerImagesStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      composerImagesRef.current = next
      batch(() => {
        setStoreState(composerImagesStore, next)
        const currentComposerSnapshot = composerStore.state
        setStoreState(composerStore, {
          ...currentComposerSnapshot,
          composerImages: currentComposerSnapshot.disabled ? [] : next,
        })
      })
    },
    [composerImagesStore, composerStore]
  )
  const setComposerContextUsage = React.useCallback(
    (contextUsage: SessionState["contextUsage"]) => {
      contextUsageThrottler.maybeExecute(contextUsage)
    },
    [contextUsageThrottler]
  )
  const setComposerStreaming = React.useCallback(
    (streaming: boolean) => {
      const currentComposerSnapshot = composerStore.state
      setStoreState(composerStore, {
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
  const gitCommitDialogRef =
    React.useRef<GitCommitDialogControllerHandle | null>(null)
  const gitCommitOpenRef = React.useRef(false)
  const sessionsDialogRef = React.useRef<AppShellSessionsDialogHandle | null>(
    null
  )
  const sessionsOpenRef = React.useRef(false)
  const settingsDialogRef = React.useRef<AppShellSettingsDialogHandle | null>(
    null
  )
  const settingsOpenRef = React.useRef(false)
  const authDialogRef = React.useRef<AppShellAuthDialogHandle | null>(null)
  const authOpenRef = React.useRef(false)
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
      const currentStoreState = sessionStore.state
      if (
        Object.is(currentRefState, nextState) &&
        Object.is(currentStoreState, nextState)
      ) {
        return
      }

      sessionStateRef.current = nextState
      setStoreState(sessionStore, nextState)
    },
    [sessionStore]
  )
  const composerTextRef = React.useRef(composerDraftSeedStore.state.text)
  const composerSkillRef = React.useRef<string | undefined>(
    composerDraftSeedStore.state.skillName
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
  const hiddenThinkingPreviewStoreRef = React.useRef<PicoStore<string> | null>(
    null
  )
  if (!hiddenThinkingPreviewStoreRef.current) {
    hiddenThinkingPreviewStoreRef.current = createPicoStore<string>(
      sessionStateRef.current.hiddenThinkingPreview || ""
    )
  }
  const hiddenThinkingPreviewStore = hiddenThinkingPreviewStoreRef.current
  const workingStateStoreRef =
    React.useRef<PicoStore<AppShellWorkingState | null> | null>(null)
  if (!workingStateStoreRef.current) {
    workingStateStoreRef.current = createPicoStore<AppShellWorkingState | null>(
      null,
      sameWorkingState
    )
  }
  const workingStateStore = workingStateStoreRef.current
  const compactRunningRef = React.useRef(false)
  const compactAbortRequestedRef = React.useRef(false)
  const setCompactRunningState = React.useCallback((running: boolean) => {
    compactRunningRef.current = running
    if (running) {
      compactAbortRequestedRef.current = false
    }
  }, [])
  const setAwaitingFirstTurn = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const current = awaitingFirstTurnStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      batch(() => {
        setStoreState(awaitingFirstTurnStore, next)
        const currentComposerSnapshot = composerStore.state
        setStoreState(composerStore, {
          ...currentComposerSnapshot,
          awaitingFirstTurn: currentComposerSnapshot.disabled ? false : next,
        })
        if (next && !sessionStateRef.current.streaming) {
          setStoreState(workingStateStore, {
            label: "Waiting for first response…",
          })
        } else if (
          !next &&
          workingStateStore.state?.label === "Waiting for first response…"
        ) {
          setStoreState(workingStateStore, null)
        }
      })
    },
    [awaitingFirstTurnStore, composerStore, workingStateStore]
  )
  const setIsSubmitting = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (action) => {
      const current = isSubmittingStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      batch(() => {
        setStoreState(isSubmittingStore, next)
        const currentComposerSnapshot = composerStore.state
        setStoreState(composerStore, {
          ...currentComposerSnapshot,
          isSubmitting: currentComposerSnapshot.disabled ? false : next,
        })
      })
    },
    [composerStore, isSubmittingStore]
  )
  const refreshComposerPendingMessages = React.useCallback(() => {
    const pendingDraftFollowUpMessages = pendingDraftFollowUpsStore.state.map(
      (message, index) => ({
        pendingId: message.optimisticId || `pending-draft:${index}`,
        text: message.message,
        images: message.images,
        streamingBehavior: message.streamingBehavior,
      })
    )
    const currentComposerSnapshot = composerStore.state
    setStoreState(composerStore, {
      ...currentComposerSnapshot,
      currentPendingMessages: currentComposerSnapshot.disabled
        ? []
        : [...pendingDraftFollowUpMessages, ...pendingMessagesStore.state],
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
      const current = pendingDraftPromptStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      batch(() => {
        setStoreState(pendingDraftPromptStore, next)
        if (next) {
          setStoreState(workingStateStore, {
            label: "Waiting for new session…",
          })
        } else if (
          workingStateStore.state?.label === "Waiting for new session…"
        ) {
          setStoreState(workingStateStore, null)
        }
      })
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
      const current = pendingDraftFollowUpsStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      batch(() => {
        setStoreState(pendingDraftFollowUpsStore, next)
        refreshComposerPendingMessages()
      })
    },
    [pendingDraftFollowUpsStore, refreshComposerPendingMessages]
  )
  const setPendingMessages = React.useCallback<
    React.Dispatch<React.SetStateAction<Array<PendingComposerMessage>>>
  >(
    (action) => {
      const current = pendingMessagesStore.state
      const next = applyStoreAction(current, action)
      if (next === current) return
      batch(() => {
        setStoreState(pendingMessagesStore, next)
        refreshComposerPendingMessages()
      })
    },
    [pendingMessagesStore, refreshComposerPendingMessages]
  )
  const conversationItemsThrottlerRef = React.useRef<PicoLatestThrottler<
    Array<ConversationItem>
  > | null>(null)
  if (!conversationItemsThrottlerRef.current) {
    conversationItemsThrottlerRef.current = createPicoLatestThrottler({
      key: "pico.conversation.streaming-items",
      wait: 16,
      onLatest: (items: Array<ConversationItem>) => {
        conversationItemsStore.setItems(items)
      },
    })
  }
  const conversationItemsThrottler = conversationItemsThrottlerRef.current
  const setConversationItems = React.useCallback(
    (items: Array<ConversationItem>) => {
      const hasStreamingAssistant = items.some(
        (item) => item.kind === "assistant" && item.streaming
      )

      if (hasStreamingAssistant && typeof window !== "undefined") {
        conversationItemsThrottler.add(items)
        return
      }

      conversationItemsThrottler.cancel()
      conversationItemsStore.setItems(items)
    },
    [conversationItemsThrottler, conversationItemsStore]
  )

  React.useEffect(
    () => () => {
      conversationItemsThrottler.flush()
      conversationItemsThrottler.cancel()
    },
    [conversationItemsThrottler]
  )
  const setHiddenThinkingPreview = React.useCallback(
    (value: string, options?: { preserveExisting?: boolean }) => {
      if (options?.preserveExisting && !value) return
      setStoreState(hiddenThinkingPreviewStore, value)
    },
    [hiddenThinkingPreviewStore]
  )
  const setWorkingState = React.useCallback(
    (state: AppShellWorkingState | null) => {
      setStoreState(workingStateStore, state)
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
  const { initialLoadingSessionId, loadingSessionId } = useSelector(
    appUiStore,
    (state) => ({
      initialLoadingSessionId: state.initialLoadingSessionId,
      loadingSessionId: state.loadingSessionId,
    }),
    { compare: shallowRecordEqual }
  )
  const { draftSessionLoadingOwnerKey, storedDraftDirectory } =
    useSelector(draftFlowStore)
  const sessionState = useSelector(
    sessionStore,
    (currentSessionState) => ({
      cwd: currentSessionState.cwd,
      draft: currentSessionState.draft,
      sessionFile: currentSessionState.sessionFile,
      sessionId: currentSessionState.sessionId,
      sessionKey: currentSessionState.sessionKey,
    }),
    { compare: shallowRecordEqual }
  )
  const setSidebarActiveSession = React.useCallback(
    (activeSession: {
      draft?: boolean
      sessionFile?: string
      sessionId?: string
      sessionKey?: string
      sessionPath?: string
    }) => {
      const activeSidebarSessionId = activeSession.draft
        ? ""
        : activeSession.sessionId?.trim() || ""
      const activeSidebarSessionPath = activeSession.draft
        ? ""
        : (activeSession.sessionFile || activeSession.sessionPath || "").trim()
      const activeSidebarSessionKey = activeSession.draft
        ? ""
        : sessionNotificationKey({
            sessionFile: activeSidebarSessionPath,
            sessionId: activeSidebarSessionId,
          }) ||
          activeSession.sessionKey?.trim() ||
          ""

      sidebarStore.setSidebarState((current) => {
        if (
          current.activeSidebarSessionId === activeSidebarSessionId &&
          current.activeSidebarSessionKey === activeSidebarSessionKey &&
          current.activeSidebarSessionPath === activeSidebarSessionPath
        ) {
          return current
        }

        return {
          activeSidebarSessionId,
          activeSidebarSessionKey,
          activeSidebarSessionPath,
        }
      })
    },
    [sidebarStore]
  )

  React.useLayoutEffect(() => {
    setSidebarActiveSession(sessionState)
  }, [sessionState, setSidebarActiveSession])

  const gitPanelOpen = useSelector(appUiStore, (state) => state.gitPanelOpen)

  const openFileViewTab = (path: string, options?: OpenFileViewTabOptions) => {
    if (!path) return
    batch(() => {
      setGitPanelOpen(true)
      openRightSidebarFile(rightSidebarStore, path, options)
    })
  }

  const closeFileViewTab = (path: string) => {
    closeRightSidebarFile(rightSidebarStore, path)
  }

  const closeOtherFileViewTabs = (path: string) => {
    closeOtherRightSidebarFiles(rightSidebarStore, path)
  }

  const closeFileViewTabsToRight = (path: string) => {
    closeRightSidebarFilesToRight(rightSidebarStore, path)
  }

  const closeAllFileViewTabs = () => {
    closeAllRightSidebarFiles(rightSidebarStore)
  }

  const reorderFileViewTabs = (paths: Array<string>) => {
    reorderRightSidebarFiles(rightSidebarStore, paths)
  }

  const toggleReviewPane = () => {
    const activeTab = rightSidebarStore.state.activeTab
    if (isMobile) {
      setRightSidebarActiveTab(rightSidebarStore, "review")
      setCurrentTab((tab) =>
        tab === "git" && activeTab === "review" ? "session" : "git"
      )
      return
    }

    if (gitPanelOpen && activeTab === "review") {
      setGitPanelOpen(false)
      return
    }

    batch(() => {
      setRightSidebarActiveTab(rightSidebarStore, "review")
      setGitPanelOpen(true)
    })
  }

  const toggleFileView = toggleReviewPane

  React.useEffect(() => {
    resetRightSidebarFiles(rightSidebarStore)
  }, [rightSidebarStore, sessionState.cwd])

  React.useEffect(() => {
    if (!sessionState.draft) return
    resetRightSidebarFiles(rightSidebarStore)
  }, [rightSidebarStore, sessionState.draft])

  const sidebarWorkspaceVersion = useAppShellSidebarValue(
    sidebarStore,
    (snapshot) => snapshot.derived.workspaceVersion
  )
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
    contextUsageThrottler.cancel()
    setStoreState(contextUsageStore, sessionStateRef.current.contextUsage)
  }, [contextUsageStore, contextUsageThrottler, currentSessionQueryScope])
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

    const currentDraftSeed = composerDraftSeedStore.state
    if (
      currentDraftSeed.text !== nextText ||
      currentDraftSeed.skillName !== nextSkill
    ) {
      setStoreState(composerDraftSeedStore, {
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
    setGitPanelOpen(readStoredRightSidebarOpen())
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

  const openCommitDialog = () => {
    commandPaletteRef.current?.close()
    sessionsDialogRef.current?.close()
    settingsDialogRef.current?.close()
    gitCommitDialogRef.current?.open()
  }

  const invalidateGitActionQueries = async (cwd: string) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitStatus(viewerContextId, cwd),
        exact: true,
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitFiles(viewerContextId, cwd),
        exact: true,
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitBranches(viewerContextId, cwd),
        exact: true,
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitCommits(viewerContextId, cwd),
        exact: false,
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: picoQueryKeys.projectFileTree(viewerContextId, cwd),
        exact: true,
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: picoQueryKeys.gitFileReviews(viewerContextId, cwd),
        exact: false,
        refetchType: "active",
      }),
    ])
  }

  const gitPushMutation = useMutation({
    mutationKey: picoQueryKeys.gitAction(
      viewerContextId,
      sessionStateRef.current.cwd?.trim() || "",
      "push"
    ),
    mutationFn: async (cwd: string) =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-push", { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd }),
        }
      ),
    onSuccess: async (response, cwd) => {
      await invalidateGitActionQueries(cwd)
      showGitPushSuccessToast({ response })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to push")
    },
  })

  const gitForcePushMutation = useMutation({
    mutationKey: picoQueryKeys.gitAction(
      viewerContextId,
      sessionStateRef.current.cwd?.trim() || "",
      "force-push"
    ),
    mutationFn: async (cwd: string) =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-push", { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, force: true }),
        }
      ),
    onSuccess: async (response, cwd) => {
      await invalidateGitActionQueries(cwd)
      showGitPushSuccessToast({ response, force: true })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to force push"
      )
    },
  })

  const gitPullMutation = useMutation({
    mutationKey: picoQueryKeys.gitAction(
      viewerContextId,
      sessionStateRef.current.cwd?.trim() || "",
      "pull"
    ),
    mutationFn: async (cwd: string) =>
      await fetchJson<GitActionResponse>(
        buildRequestUrl("/api/git-pull", { contextId: viewerContextId }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd }),
        }
      ),
    onSuccess: async (_response, cwd) => {
      await invalidateGitActionQueries(cwd)
      toast.success("Pulled changes")
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to pull")
    },
  })

  const runGitRemoteAction = async (action: GitRemoteAction) => {
    const cwd = sessionStateRef.current.cwd?.trim() || ""
    if (!cwd) {
      toast.error("Open a session in a repository before running Git actions.")
      return
    }

    const mutation =
      action === "pull"
        ? gitPullMutation
        : action === "force-push"
          ? gitForcePushMutation
          : gitPushMutation

    if (
      gitPushMutation.isPending ||
      gitForcePushMutation.isPending ||
      gitPullMutation.isPending
    ) {
      return
    }

    await mutation.mutateAsync(cwd).catch(() => {})
  }

  const pushGitChanges = async () => {
    await runGitRemoteAction("push")
  }

  const forcePushGitChanges = async () => {
    await runGitRemoteAction("force-push")
  }

  const pullGitChanges = async () => {
    await runGitRemoteAction("pull")
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
    if (appUiStore.state.currentTab !== "session") {
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
            sidebarStore.state.derived.sidebarSessionEntriesByKey,
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
      setSidebarActiveSession({
        draft: !nextSessionId,
        sessionId: nextSessionId,
        sessionPath: options?.sessionPath,
      })

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
    [
      onSelectSession,
      sessionStateRef,
      setSidebarActiveSession,
      syncSidebarSelectionForSession,
    ]
  )
  const handleSelectSessionRef = useLatestRef(handleSelectSession)

  useAppShellSessionSync({
    viewerContextId,
    sessionId,
    draftSessionLoadingOwnerKey,
    bootstrapSidebarDirectories:
      sidebarStore.state.state.initialSidebarBootstrapDirectories,
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
    setCompactRunningState,
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

  const awaitingFirstTurn = awaitingFirstTurnStore.state
  const isSubmitting = isSubmittingStore.state
  const pendingDraftPrompt = pendingDraftPromptStore.state
  const pendingDraftFollowUps = pendingDraftFollowUpsStore.state
  const pendingMessages = pendingMessagesStore.state

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

  const switchEmptyDraftDirectory = React.useCallback(
    (directory: string) => {
      const nextDirectory = directory.trim()
      if (!nextDirectory) return

      const previousState = sessionStateRef.current
      if (!previousState.draft || previousState.items.length > 0) return

      safeLocalStorageSetItem(DRAFT_DIRECTORY_STORAGE_KEY, nextDirectory)
      setStoredDraftDirectory(nextDirectory)
      rememberRecentDirectory(nextDirectory)

      const ownerKey = promptDraftKey({ cwd: nextDirectory })
      const nextState = createOptimisticDraftSessionState({
        previous: previousState,
        cwd: nextDirectory,
        ownerKey,
      })
      sessionStateRef.current = nextState
      conversationItemsStore.setItems(nextState.items)
      setSessionState(nextState)

      rememberStoredPromptDraft(
        nextState,
        serializeComposerDraft({
          text: composerTextRef.current,
          skillName: composerSkillRef.current,
        })
      )
    },
    [
      conversationItemsStore,
      rememberRecentDirectory,
      sessionStateRef,
      setSessionState,
      setStoredDraftDirectory,
    ]
  )

  const addDirectoryPathForDialog = React.useCallback(
    async (path: string) => {
      const result = await addDirectoryPath(path)
      if (typeof result === "string") {
        switchEmptyDraftDirectory(result)
      }
      return result
    },
    [addDirectoryPath, switchEmptyDraftDirectory]
  )

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

  const composerDraftSeed = composerDraftSeedStore.state
  const composerImages = composerImagesStore.state
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
      setCompactRunningState(running)
      if (running) {
        setStoreState(workingStateStore, {
          label: COMPACT_WORKING_LABEL,
          cancelable: true,
        })
        return
      }

      if (compactAbortRequestedRef.current) {
        compactAbortRequestedRef.current = false
        setStoreState(workingStateStore, {
          label: COMPACT_CANCELLED_LABEL,
          error: true,
        })
        return
      }

      if (workingStateStore.state?.label === COMPACT_WORKING_LABEL) {
        setStoreState(workingStateStore, null)
      }
    },
    [setCompactRunningState, workingStateStore]
  )

  const isCompactAbortRequested = React.useCallback(
    () => compactAbortRequestedRef.current,
    []
  )

  const {
    cycleThinkingLevel,
    deleteSessions,
    renameSessionPath,
    runClone,
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
      sidebarStore.state.state.directoryIndexDataByPath,
    setDirectoryIndexDataByPath: sidebarStore.setDirectoryIndexDataByPath,
    getSessionsEvent: () => sidebarStore.state.state.sessionsEvent,
    setSessionsEvent: sidebarStore.setSessionsEvent,
    getSidebarSelection: () => {
      const sidebarState = sidebarStore.state.state
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
    isCompactAbortRequested,
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

  const openAuthDialog = (mode: "login" | "logout" = "login") => {
    authDialogRef.current?.open(mode)
  }

  const runBuiltinSlashCommand = async (name: string, args: string) => {
    const trimmedArgs = args.trim()
    const clearComposerDraft = () => {
      replaceComposerDraft("", sessionStateRef.current, { forceSync: true })
    }

    switch (name) {
      case "login": {
        if (trimmedArgs) {
          toast.error("/login does not take any arguments yet.")
          return
        }
        clearComposerDraft()
        openAuthDialog("login")
        return
      }
      case "logout": {
        if (trimmedArgs) {
          toast.error("/logout does not take any arguments yet.")
          return
        }
        clearComposerDraft()
        openAuthDialog("logout")
        return
      }
      case "compact": {
        if (composerImages.length > 0) {
          toast.error("Built-in slash commands do not support images.")
          return
        }
        clearComposerDraft()
        await runCompact()
        return
      }
      case "clone": {
        if (trimmedArgs) {
          toast.error("/clone does not take any arguments.")
          return
        }
        if (composerImages.length > 0) {
          toast.error("Built-in slash commands do not support images.")
          return
        }
        clearComposerDraft()
        await runClone()
        return
      }
      case "rename": {
        if (!sessionState.sessionFile) {
          toast.error("Start the session before renaming it.")
          return
        }
        if (!trimmedArgs) {
          clearComposerDraft()
          openRenameDialog()
          return
        }
        clearComposerDraft()
        await renameSessionPath(sessionState.sessionFile, trimmedArgs)
        return
      }
      case "delete": {
        if (!sessionState.sessionFile) {
          toast.error("Start the session before deleting it.")
          return
        }
        clearComposerDraft()
        openDeleteDialogForCurrentSession()
        return
      }
      case "fork": {
        if (trimmedArgs) {
          toast.error("/fork does not take any arguments.")
          return
        }
        clearComposerDraft()
        await openForkDialog()
        return
      }
      case "tree": {
        if (trimmedArgs) {
          toast.error("/tree does not take any arguments.")
          return
        }
        clearComposerDraft()
        await openTreeDialog()
        return
      }
      case "hide-thinking": {
        clearComposerDraft()
        if (!sessionStateRef.current.hideThinkingBlock) {
          await toggleHideThinking()
        }
        return
      }
      case "show-thinking": {
        clearComposerDraft()
        if (sessionStateRef.current.hideThinkingBlock) {
          await toggleHideThinking()
        }
        return
      }
      case "hide-tools": {
        clearComposerDraft()
        setToolBlocksHidden(true)
        return
      }
      case "show-tools": {
        clearComposerDraft()
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
    setStoreState(composerStore, composerSnapshot)
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
        shortcut: formatShortcutLabel("Control+N"),
        keywords: ["create", "draft", "session"],
        onSelect: createSession,
      },
      {
        id: "open-sessions",
        group: "Sessions",
        title: "Open sessions",
        description: "Search and switch sessions",
        shortcut: formatShortcutLabel("Control+S"),
        keywords: ["session", "search", "switch", "jump"],
        onSelect: openSessionsDialog,
      },
      {
        id: "open-git-view",
        group: "Git",
        title: commandState.isMobile
          ? "Toggle right sidebar tab"
          : commandState.gitPanelOpen
            ? "Close right sidebar"
            : "Open right sidebar",
        description: commandState.isMobile
          ? "Switch the mobile right sidebar tab on or off"
          : "Toggle the right sidebar",
        shortcut: formatShortcutLabel("Control+\\"),
        keywords: [
          "right",
          "sidebar",
          "git",
          "changes",
          "branch",
          "commit",
          "panel",
        ],
        onSelect: toggleGitPanel,
      },
      {
        id: "commit-changes",
        group: "Git",
        title: "Commit changes",
        description: "Open the Git commit dialog",
        shortcut: formatShortcutLabel("Control+C"),
        keywords: ["git", "commit", "changes", "stage"],
        onSelect: openCommitDialog,
      },
      {
        id: "push-changes",
        group: "Git",
        title: "Push changes",
        description: "Push local commits to the remote",
        shortcut: formatShortcutLabel("Control+P"),
        keywords: ["git", "push", "remote", "upstream"],
        onSelect: pushGitChanges,
      },
      {
        id: "force-push-changes",
        group: "Git",
        title: "Force push changes",
        description: "Force push local commits with --force-with-lease",
        shortcut: formatShortcutLabel("Control+Shift+P"),
        keywords: ["git", "force", "push", "remote", "upstream", "lease"],
        onSelect: forcePushGitChanges,
      },
      {
        id: "pull-changes",
        group: "Git",
        title: "Pull changes",
        description: "Pull remote changes into the current branch",
        shortcut: formatShortcutLabel("Alt+P"),
        keywords: ["git", "pull", "remote", "upstream"],
        onSelect: pullGitChanges,
      },
      {
        id: "focus-prompt",
        group: "Assistant",
        title: "Focus prompt",
        description: "Move focus to the prompt field",
        shortcut: formatShortcutLabel("Control+Enter"),
        keywords: ["prompt", "composer", "input", "message", "reply"],
        onSelect: focusPrompt,
      },
      {
        id: "set-model",
        group: "Assistant",
        title: "Set model",
        description: "Open the model picker",
        shortcut: formatShortcutLabel("Control+M"),
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
        shortcut: formatShortcutLabel("Control+D"),
        keywords: ["workspace", "sidebar", "directory", "folder"],
        onSelect: openAddDirectoryDialog,
      },
      {
        id: "tree-session",
        group: "Sessions",
        title: "Open tree",
        description: "Jump to an earlier point in the current session tree",
        shortcut: "Esc Esc",
        keywords: ["tree", "branch", "history", "navigate"],
        onSelect: openTreeDialog,
      },
      {
        id: "fork-session",
        group: "Sessions",
        title: "Fork session",
        description: "Create a new session from a previous user message",
        shortcut: formatShortcutLabel("Control+F"),
        keywords: ["fork", "branch", "draft"],
        onSelect: openForkDialog,
      },
      {
        id: "clone-session",
        group: "Sessions",
        title: "Clone session",
        description: "Duplicate the current active branch into a new session",
        keywords: ["clone", "branch", "duplicate", "session"],
        onSelect: runClone,
      },
      {
        id: "compact-session",
        group: "Sessions",
        title: "Compact",
        description: "Manually compact the session context with /compact",
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
        shortcut: formatShortcutLabel("Control+T"),
        keywords: ["thinking", "reasoning", "visibility", "show", "hide"],
        onSelect: toggleHideThinking,
      },
      {
        id: "cycle-reasoning",
        group: "Assistant",
        title: "Next reasoning level",
        description: `Current level: ${currentThinkingLevel}`,
        shortcut: formatShortcutLabel("Control+R"),
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
        shortcut: formatShortcutLabel("Control+Shift+R"),
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
        id: "toggle-review-pane",
        group: "Git",
        title: "Toggle Review Pane",
        description: "Toggle the review pane for changed files",
        keywords: ["review", "diff", "file", "changes", "pane"],
        onSelect: toggleFileView,
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
        shortcut: formatShortcutLabel("Control+O"),
        keywords: ["tools", "tool calls", "visibility", "show", "hide"],
        onSelect: toggleHideToolBlocks,
      },
      {
        id: "login-provider",
        group: "App",
        title: "Login to provider",
        description: "Configure provider API key or subscription auth",
        keywords: ["login", "auth", "api key", "oauth", "provider"],
        onSelect: () => openAuthDialog("login"),
      },
      {
        id: "logout-provider",
        group: "App",
        title: "Logout from provider",
        description: "Remove stored provider credentials",
        keywords: ["logout", "auth", "api key", "oauth", "provider"],
        onSelect: () => openAuthDialog("logout"),
      },
      {
        id: "open-settings",
        group: "App",
        title: "Open settings",
        description: "Open app settings",
        shortcut: formatShortcutLabel("Control+,"),
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
        shortcut: formatShortcutLabel("Control+E"),
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
        shortcut: formatShortcutLabel("Control+X"),
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

  const abortCompact = React.useCallback(async () => {
    if (!compactRunningRef.current) return
    compactAbortRequestedRef.current = true
    await abortSession()
  }, [abortSession])

  const shortcutActionsRef = useLatestRef({
    abortCompact,
    abortSession,
    createSession,
    closeCommandPalette,
    forcePushGitChanges,
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
    openCommitDialog,
    openDeleteDialog,
    openDeleteDialogForCurrentSession,
    openForkDialog,
    openRenameDialog,
    openSessionsDialog,
    openSettingsDialog,
    openTreeDialog,
    pullGitChanges,
    pushGitChanges,
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
    currentTab: isMobile ? appUiStore.state.currentTab : "session",
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
    compactRunningRef,
    deleteOpenRef,
    forkOpenRef,
    gitCommitOpenRef,
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
      rightSidebar: rightSidebarStore,
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
            onCancelCompaction={abortCompact}
            onCreateSession={(cwdOverride) => {
              void createSession(cwdOverride)
            }}
            onOpenAddDirectoryDialog={openAddDirectoryDialog}
            onCloseAllFileViewTabs={closeAllFileViewTabs}
            onCloseFileViewTab={closeFileViewTab}
            onCloseFileViewTabsToRight={closeFileViewTabsToRight}
            onCloseOtherFileViewTabs={closeOtherFileViewTabs}
            onOpenFileViewTab={openFileViewTab}
            onReorderFileViewTabs={reorderFileViewTabs}
            rightSidebarStore={rightSidebarStore}
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
        addDirectoryPath={addDirectoryPathForDialog}
        baseSidebarDirectories={baseSidebarDirectories}
        commandPaletteCommandsRef={commandPaletteCommandsRef}
        commandPaletteOpenRef={commandPaletteOpenRef}
        commandPaletteRef={commandPaletteRef}
        currentSessionQueryScope={currentSessionQueryScope}
        currentTheme={currentTheme}
        authDialogRef={authDialogRef}
        authOpenRef={authOpenRef}
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
        gitCommitDialogRef={gitCommitDialogRef}
        gitCommitOpenRef={gitCommitOpenRef}
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
  displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
  isSessionViewLoading: boolean
  newSessionDirectoryOptions: Array<{ path: string; label: string }>
  onToggleGitPanel: () => void
  sessionStore: PicoStore<SessionState>
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
  const sessionHeaderState = useSelector(
    sessionStore,
    (sessionState) => ({
      firstMessage: sessionState.firstMessage,
      hideThinkingBlock: sessionState.hideThinkingBlock,
      sessionHasFile: Boolean(sessionState.sessionFile),
      sessionName: sessionState.sessionName,
      sessionStreaming: sessionState.streaming,
    }),
    { compare: shallowRecordEqual }
  )
  const hideToolBlocks = useSelector(
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
  const showCollapsedNewSessionButton = !sidebarOpen
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
          <TitleTooltip
            title={
              defaultNewSessionDirectory
                ? `Create a new session in ${formatDisplayPath(
                    defaultNewSessionDirectory
                  )}`
                : "Create a new session"
            }
            kbd={formatShortcutLabel("Control+N")}
          >
            <Button
              size="icon"
              variant="ghost"
              className="shrink-0"
              aria-label="Create a new session"
              onClick={() => {
                void actionsRef.current.createSession()
              }}
            >
              <SquarePenIcon />
            </Button>
          </TitleTooltip>
        ) : null}
        <div className="absolute left-1/2 flex w-max max-w-[calc(100%-4rem)] -translate-x-1/2 flex-col items-center justify-center gap-0 text-center">
          <div className="flex max-w-full min-w-0 items-center justify-center gap-1.5">
            {!isSessionViewLoading && sessionHeaderState.sessionStreaming ? (
              <Spinner
                className="size-3.5 shrink-0"
                aria-label="Session streaming"
              />
            ) : null}
            <TitleTooltip title={displaySessionTitle}>
              <h2 className="min-w-0 truncate text-[13px] leading-tight font-semibold">
                {displaySessionTitle}
              </h2>
            </TitleTooltip>
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
          <HeaderGitActions
            viewerContextId={viewerContextId}
            cwd={displaySessionCwd}
          />
          <DropdownMenu>
            <TitleTooltip title="Session menu">
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Session menu"
                  />
                }
              >
                <EllipsisIcon />
              </DropdownMenuTrigger>
            </TitleTooltip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={() => {
                  void actionsRef.current.createSession()
                }}
              >
                <span>Create new session</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel("Control+N")}
                </DropdownMenuShortcut>
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
                <DropdownMenuShortcut>Esc Esc</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void actionsRef.current.onForkSession()
                }}
              >
                <span>Fork</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel("Control+F")}
                </DropdownMenuShortcut>
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
                <DropdownMenuShortcut>
                  {formatShortcutLabel("Control+T")}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  actionsRef.current.onToggleHideToolBlocks()
                }}
              >
                <span>{hideToolBlocks ? "Show tools" : "Hide tools"}</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel("Control+O")}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!sessionHeaderState.sessionHasFile}
                onClick={() => {
                  actionsRef.current.onRenameSession()
                }}
              >
                <span>Rename session</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel("Control+E")}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={!sessionHeaderState.sessionHasFile}
                onClick={() => {
                  actionsRef.current.onDeleteCurrentSession()
                }}
              >
                <span>Delete session</span>
                <DropdownMenuShortcut>
                  {formatShortcutLabel("Control+X")}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <TitleTooltip
            title="Toggle right sidebar"
            kbd={formatShortcutLabel("Control+\\")}
          >
            <Button
              size="icon"
              variant={gitPanelOpen ? "secondary" : "ghost"}
              className="hidden md:inline-flex"
              aria-pressed={gitPanelOpen}
              aria-label="Toggle right sidebar"
              onClick={onToggleGitPanel}
            >
              <PanelRightIcon />
            </Button>
          </TitleTooltip>
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
  authDialogRef: React.RefObject<AppShellAuthDialogHandle | null>
  authOpenRef: React.RefObject<boolean>
  deleteDialogRef: React.RefObject<DeleteSessionsDialogHandle | null>
  deleteOpenRef: React.RefObject<boolean>
  deleteSessions: React.ComponentProps<
    typeof DeleteSessionsDialogController
  >["onDeleteSession"]
  deleteOldDirectorySessionsDialogRef: React.RefObject<DeleteOldDirectorySessionsDialogHandle | null>
  deleteOldDirectorySessionsOpenRef: React.RefObject<boolean>
  notificationStore: PicoStore<AppShellNotificationState>
  forkDialogRef: React.RefObject<ForkSessionDialogHandle | null>
  forkOpenRef: React.RefObject<boolean>
  gitCommitDialogRef: React.RefObject<GitCommitDialogControllerHandle | null>
  gitCommitOpenRef: React.RefObject<boolean>
  displaySettingsStore: PicoStore<AppShellDisplaySettingsState>
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
  recentDirectoriesStore: PicoStore<Array<string>>
  renameDialogRef: React.RefObject<RenameSessionDialogHandle | null>
  renameOpenRef: React.RefObject<boolean>
  renameSessionPath: React.ComponentProps<
    typeof RenameSessionDialogController
  >["onRenameSession"]
  sessionCwd?: string
  sessionsDialogDirectory: string
  sessionsDialogRef: React.RefObject<AppShellSessionsDialogHandle | null>
  sessionsOpenRef: React.RefObject<boolean>
  sessionStore: PicoStore<SessionState>
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
    activeSessionId,
    addDirectoryPath,
    baseSidebarDirectories,
    knownDirectories,
    recentDirectoriesStore,
    sessionCwd,
    sessionStore,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "activeSessionId"
    | "addDirectoryDialogRef"
    | "addDirectoryOpenRef"
    | "addDirectoryPath"
    | "baseSidebarDirectories"
    | "knownDirectories"
    | "recentDirectoriesStore"
    | "sessionCwd"
    | "sessionStore"
    | "viewerContextId"
  >) {
    const recentDirectories = useSelector(recentDirectoriesStore)
    const useForNewSession = useSelector(
      sessionStore,
      (sessionState) => sessionState.draft && sessionState.items.length === 0
    )
    const requestPathCompletions = useStableEvent(async (prefix: string) => {
      if (!viewerContextId) return []

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
    })
    const searchDirectories = useStableEvent(async (query: string) => {
      if (!viewerContextId) return []

      const response = await fetchJson<DirectorySearchResponse>(
        buildRequestUrl("/api/directory-search", {
          contextId: viewerContextId,
          sessionId: activeSessionId,
        }),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query }),
        }
      )
      return isApiErrorResponse(response) ? [] : response.items
    })

    return (
      <AppShellAddDirectoryDialogController
        ref={addDirectoryDialogRef}
        openStateRef={addDirectoryOpenRef}
        openedDirectories={baseSidebarDirectories}
        currentDirectory={sessionCwd}
        recentDirectories={recentDirectories}
        knownDirectories={knownDirectories}
        useForNewSession={useForNewSession}
        onAddDirectoryPath={addDirectoryPath}
        onRequestPathCompletions={requestPathCompletions}
        onSearchDirectories={searchDirectories}
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
  const treeSummaryAvailable = useSelector(
    sessionStore,
    (sessionState) => sessionState.availableModels.length > 0
  )
  const activeSessionStreaming = useSelector(
    sessionStore,
    (sessionState) => sessionState.streaming
  )

  return (
    <AppShellTreeDialogController
      ref={treeDialogRef}
      openStateRef={treeOpenRef}
      viewerContextId={viewerContextId}
      sessionScopeKey={currentSessionQueryScope}
      sessionId={activeSessionId}
      treeSummaryAvailable={treeSummaryAvailable}
      activeSessionStreaming={activeSessionStreaming}
    />
  )
})

const AppShellSettingsDialogHost = React.memo(
  function AppShellSettingsDialogHost({
    authDialogRef,
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
    | "authDialogRef"
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
    const hideThinkingBlocks = useSelector(
      sessionStore,
      (sessionState) => sessionState.hideThinkingBlock
    )
    const { autoScrollEnabled, centerMessages, hideToolBlocks } =
      useSelector(displaySettingsStore)
    const {
      desktopNotificationPermission,
      sessionDoneDesktopNotificationsEnabled,
      sessionDoneSoundEnabled,
    } = useSelector(
      notificationStore,
      (state) => ({
        desktopNotificationPermission: state.desktopNotificationPermission,
        sessionDoneDesktopNotificationsEnabled:
          state.sessionDoneDesktopNotificationsEnabled,
        sessionDoneSoundEnabled: state.sessionDoneSoundEnabled,
      }),
      { compare: shallowRecordEqual }
    )

    const openAuthFromSettings = (mode: "login" | "logout") => {
      settingsDialogRef.current?.close()
      authDialogRef.current?.open(mode, {
        returnOnClose: () => settingsDialogRef.current?.open(),
      })
    }

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
        onLoginProviders={() => openAuthFromSettings("login")}
        onLogoutProviders={() => openAuthFromSettings("logout")}
      />
    )
  }
)

const AppShellUiRequestDialogHost = React.memo(
  function AppShellUiRequestDialogHost({
    activeSessionId,
    authDialogRef,
    uiRequestDialogRef,
    uiRequestOpenRef,
    viewerContextId,
  }: Pick<
    AppShellFloatingControllersProps,
    | "activeSessionId"
    | "authDialogRef"
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
        onAuthBack={() => authDialogRef.current?.open("login")}
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
    authDialogRef,
    authOpenRef,
    deleteDialogRef,
    deleteOpenRef,
    deleteSessions,
    deleteOldDirectorySessionsDialogRef,
    deleteOldDirectorySessionsOpenRef,
    notificationStore,
    forkDialogRef,
    forkOpenRef,
    gitCommitDialogRef,
    gitCommitOpenRef,
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

        <GitCommitDialogController
          ref={gitCommitDialogRef}
          openStateRef={gitCommitOpenRef}
          viewerContextId={viewerContextId}
          cwd={sessionCwd}
        />

        <AppShellAuthDialogController
          ref={authDialogRef}
          openStateRef={authOpenRef}
          viewerContextId={viewerContextId}
          sessionId={activeSessionId}
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
          activeSessionId={activeSessionId}
          addDirectoryDialogRef={addDirectoryDialogRef}
          addDirectoryOpenRef={addDirectoryOpenRef}
          addDirectoryPath={addDirectoryPath}
          baseSidebarDirectories={baseSidebarDirectories}
          knownDirectories={knownDirectories}
          recentDirectoriesStore={recentDirectoriesStore}
          sessionCwd={sessionCwd}
          sessionStore={sessionStore}
          viewerContextId={viewerContextId}
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
          authDialogRef={authDialogRef}
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
          authDialogRef={authDialogRef}
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
      const activeSessionId = snapshot.state.activeSidebarSessionId
      const activeSessionKey = snapshot.state.activeSidebarSessionKey
      const activeSessionPath = snapshot.state.activeSidebarSessionPath
      const statuses = snapshot.state.sidebarSessionStatusByKey
      const status =
        (activeSessionPath
          ? statuses[`path:${activeSessionPath}`]
          : undefined) ||
        (activeSessionId ? statuses[`id:${activeSessionId}`] : undefined) ||
        (activeSessionKey ? statuses[`key:${activeSessionKey}`] : undefined)

      return {
        event,
        activeSessionId,
        activeSessionKey,
        activeSessionPath,
        activeStreaming: Boolean(status?.streaming),
      }
    },
    (left, right) =>
      left.activeSessionId === right.activeSessionId &&
      left.activeSessionKey === right.activeSessionKey &&
      left.activeSessionPath === right.activeSessionPath &&
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
  const activeSidebarSessionId = sidebarSessionsEventSnapshot.activeSessionId
  const activeSidebarSessionKey = sidebarSessionsEventSnapshot.activeSessionKey
  const activeSidebarSessionPath =
    sidebarSessionsEventSnapshot.activeSessionPath
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
  const lastActiveSidebarSelectionSyncRef = React.useRef({
    signature: "",
    key: "",
  })
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

    sidebarStore.setSidebarState((current) => {
      const merged = payloadDirectories.length
        ? mergeDirectoryIndexData(
            current.directoryIndexDataByPath,
            payloadDirectoryIndexes
          )
        : current.directoryIndexDataByPath
      const nextDirectoryIndexDataByPath = clearUnreadForActiveSidebarSession(
        merged,
        {
          sessionId: activeSidebarSessionId,
          sessionPath: activeSidebarSessionPath,
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
      activeSessionId: activeSidebarSessionId,
      activeSessionKey: activeSidebarSessionKey,
      activeSessionPath: activeSidebarSessionPath,
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

        sidebarStore.setSidebarState((current) => {
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
    activeSidebarSessionId,
    activeSidebarSessionKey,
    activeSidebarSessionPath,
    activeSidebarSessionStreaming,
    directoryStateByPath,
    sessionsEvent,
    sidebarStore,
    viewerContextId,
  ])

  React.useEffect(() => {
    if (
      !activeSidebarSessionId &&
      !activeSidebarSessionKey &&
      !activeSidebarSessionPath
    ) {
      return
    }

    sidebarStore.setSidebarSessionStatusByKey((current) =>
      mergeSidebarSessionStatusMap(current, {
        type: "session_status",
        sessionKey: activeSidebarSessionKey,
        sessionId: activeSidebarSessionId,
        sessionPath: activeSidebarSessionPath,
        unread: false,
      })
    )
  }, [
    activeSidebarSessionId,
    activeSidebarSessionKey,
    activeSidebarSessionPath,
    sidebarStore,
  ])

  React.useEffect(() => {
    const activeSignature = [
      activeSidebarSessionId,
      activeSidebarSessionPath,
      activeSidebarSessionKey,
    ].join("\0")
    let nextKey = findSidebarSessionSelectionKey(sidebarSessionEntriesByKey, {
      sessionId: activeSidebarSessionId,
      sessionPath: activeSidebarSessionPath,
    })

    if (
      !nextKey &&
      activeSidebarSessionKey &&
      sidebarSessionEntriesByKey.has(activeSidebarSessionKey)
    ) {
      nextKey = activeSidebarSessionKey
    }

    const previous = lastActiveSidebarSelectionSyncRef.current
    if (previous.signature === activeSignature && previous.key === nextKey) {
      return
    }

    lastActiveSidebarSelectionSyncRef.current = {
      signature: activeSignature,
      key: nextKey,
    }
    sidebarStore.setSelectedSidebarSessionKeys((current) => {
      const nextKeys = nextKey ? [nextKey] : []
      return sameStringArray(current, nextKeys) ? current : nextKeys
    })
    sidebarStore.setSidebarSessionSelectionAnchor((current) =>
      current === nextKey ? current : nextKey
    )
  }, [
    activeSidebarSessionId,
    activeSidebarSessionKey,
    activeSidebarSessionPath,
    sidebarSessionEntriesByKey,
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

        sidebarStore.setSidebarState((current) => {
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
    modifiers: { multiSelectKey: boolean; shiftKey: boolean }
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

    if (modifiers.multiSelectKey) {
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
      activeSessionId={activeSidebarSessionId || undefined}
      activeSessionKey={activeSidebarSessionKey || undefined}
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

export function PicoAppShell({
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
    sidebarStore.setSidebarState((current) => {
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
