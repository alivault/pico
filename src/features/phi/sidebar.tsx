import * as React from "react"

import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDown,
  CommandIcon,
  FolderIcon,
  FolderPlusIcon,
  SearchIcon,
  SquarePenIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react"

import type { SessionListEntry } from "@/lib/phi/api"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Input } from "@/components/ui/input"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import {
  COLLAPSED_DIRECTORIES_STORAGE_KEY,
  DIRECTORY_SESSION_LOAD_MORE_COUNT,
  INITIAL_DIRECTORY_SESSION_RENDER_COUNT,
  readStoredCollapsedDirectories,
  safeLocalStorageSetItem,
  sessionListEntryKey,
} from "@/lib/phi"
import { cn } from "@/lib/utils"

const SIDEBAR_LOADING_SPINNER_DELAY_MS = 250
const SIDEBAR_TIME_MIN_DELAY_MS = 1000
const SIDEBAR_TIME_SECOND_MS = 1000
const SIDEBAR_TIME_MINUTE_MS = 60 * SIDEBAR_TIME_SECOND_MS
const SIDEBAR_TIME_HOUR_MS = 60 * SIDEBAR_TIME_MINUTE_MS
const SIDEBAR_TIME_DAY_MS = 24 * SIDEBAR_TIME_HOUR_MS
const SIDEBAR_TIME_WEEK_MS = 7 * SIDEBAR_TIME_DAY_MS
const SIDEBAR_TIME_MONTH_MS = 30 * SIDEBAR_TIME_DAY_MS
const SIDEBAR_TIME_YEAR_MS = 365 * SIDEBAR_TIME_DAY_MS

function useDelayedTrue(value: boolean, delayMs: number) {
  const [delayedValue, setDelayedValue] = React.useState(false)

  React.useEffect(() => {
    if (!value) {
      setDelayedValue(false)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setDelayedValue(true)
    }, delayMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [delayMs, value])

  return delayedValue
}

function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex size-2.5 shrink-0 rounded-full",
        connected ? "bg-emerald-500" : "bg-red-500"
      )}
      role="status"
      aria-label={connected ? "Connected" : "Disconnected"}
      title={connected ? "Connected" : "Disconnected"}
    />
  )
}

function tildePath(value: string) {
  return value
    .replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/home\/[^/]+(?=\/|$)/, "~")
}

function splitDisplayPath(value: string) {
  if (!value) return { leading: "", trailing: "" }

  const trimmed = value.replace(/[\\/]+$/, "")
  if (!trimmed) {
    return { leading: "", trailing: value }
  }

  const suffix = value.slice(trimmed.length)
  const separatorIndex = Math.max(
    trimmed.lastIndexOf("/"),
    trimmed.lastIndexOf("\\")
  )

  if (separatorIndex < 0 || separatorIndex === trimmed.length - 1) {
    return { leading: "", trailing: `${trimmed}${suffix}` }
  }

  return {
    leading: trimmed.slice(0, separatorIndex + 1),
    trailing: `${trimmed.slice(separatorIndex + 1)}${suffix}`,
  }
}

function DirectoryPathLabel({ path }: { path: string }) {
  const displayPath = tildePath(path)
  const { leading, trailing } = splitDisplayPath(displayPath)

  return (
    <span className="block min-w-0 text-sm text-sidebar-foreground">
      <span className="flex min-w-0 items-center">
        {leading ? (
          <span className="truncate text-sidebar-foreground/60">{leading}</span>
        ) : null}
        <span className="shrink-0 font-medium">{trailing || displayPath}</span>
      </span>
    </span>
  )
}

type SessionClickModifiers = {
  ctrlKey: boolean
  shiftKey: boolean
}

const EMPTY_DIRECTORY_SESSION_KEYS: Array<string> = []
const SIDEBAR_SEARCH_COMMIT_DELAY_MS = 150

function formatSidebarSessionTime(value?: string, now = Date.now()) {
  if (!value) return ""

  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return ""

  const diffMs = now - timestamp
  const past = diffMs >= 0
  const seconds = Math.max(1, Math.floor(Math.abs(diffMs) / 1000))
  const suffix = past ? "ago" : "from now"

  if (seconds < 60) return `${seconds}s ${suffix}`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${suffix}`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${suffix}`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ${suffix}`

  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ${suffix}`

  const months = Math.floor(days / 30)
  if (months < 12) return `${Math.max(1, months)}mo ${suffix}`

  const years = Math.floor(days / 365)
  return `${Math.max(1, years)}y ${suffix}`
}

function formatSessionMessageCount(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return ""
  }

  const count = Math.floor(value)
  return `${count.toLocaleString()} msg${count === 1 ? "" : "s"}`
}

function isValidSidebarTimestamp(value?: string) {
  if (!value) return false
  return !Number.isNaN(new Date(value).getTime())
}

function getSidebarSessionTimeInterval(ageMs: number) {
  const seconds = Math.max(1, Math.floor(ageMs / SIDEBAR_TIME_SECOND_MS))

  if (seconds < 60) return SIDEBAR_TIME_SECOND_MS

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return SIDEBAR_TIME_MINUTE_MS

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return SIDEBAR_TIME_HOUR_MS

  const days = Math.floor(hours / 24)
  if (days < 7) return SIDEBAR_TIME_DAY_MS

  const weeks = Math.floor(days / 7)
  if (weeks < 5) return SIDEBAR_TIME_WEEK_MS

  const months = Math.floor(days / 30)
  if (months < 12) return SIDEBAR_TIME_MONTH_MS

  return SIDEBAR_TIME_YEAR_MS
}

function getSidebarSessionTimeRefreshDelay(
  timestamp: number,
  now = Date.now()
) {
  const diffMs = now - timestamp
  const ageMs = Math.abs(diffMs)
  const interval = getSidebarSessionTimeInterval(ageMs)
  const remainder = ageMs % interval
  const delay = diffMs >= 0 ? interval - remainder : remainder || interval

  return Math.max(SIDEBAR_TIME_MIN_DELAY_MS, delay)
}

function SidebarSessionTime({ value }: { value?: string }) {
  const timestamp = value ? new Date(value).getTime() : Number.NaN
  const [label, setLabel] = React.useState(() =>
    formatSidebarSessionTime(value)
  )

  React.useEffect(() => {
    if (Number.isNaN(timestamp)) {
      setLabel("")
      return
    }

    let timeoutId: number | undefined
    let cancelled = false

    const updateAndSchedule = () => {
      if (cancelled) return

      const now = Date.now()
      const nextLabel = formatSidebarSessionTime(value, now)
      setLabel(nextLabel)

      timeoutId = window.setTimeout(
        updateAndSchedule,
        getSidebarSessionTimeRefreshDelay(timestamp, now)
      )
    }

    updateAndSchedule()

    return () => {
      cancelled = true
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [timestamp, value])

  if (!label) return null

  return <span className="tabular-nums">{label}</span>
}

function directoryOrderEqual(left: Array<string>, right: Array<string>) {
  if (left.length !== right.length) return false

  return left.every((directory, index) => directory === right[index])
}

type CollapsedDirectoryStore = {
  subscribe: (listener: () => void) => () => void
  isCollapsed: (directory: string) => boolean
  areAllCollapsed: (directories: Array<string>) => boolean
  loadStored: () => void
  toggle: (directory: string) => void
  setAll: (directories: Array<string>, collapsed: boolean) => void
  remove: (directory: string) => void
}

function createCollapsedDirectoryStore(): CollapsedDirectoryStore {
  let collapsedDirectories: Record<string, boolean> = {}
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const persist = () => {
    safeLocalStorageSetItem(
      COLLAPSED_DIRECTORIES_STORAGE_KEY,
      JSON.stringify(collapsedDirectories)
    )
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    isCollapsed(directory) {
      return Boolean(collapsedDirectories[directory])
    },
    areAllCollapsed(directories) {
      return (
        directories.length > 0 &&
        directories.every((directory) => collapsedDirectories[directory])
      )
    },
    loadStored() {
      collapsedDirectories = readStoredCollapsedDirectories()
      notify()
    },
    toggle(directory) {
      const next = { ...collapsedDirectories }
      if (next[directory]) {
        delete next[directory]
      } else {
        next[directory] = true
      }
      collapsedDirectories = next
      persist()
      notify()
    },
    setAll(directories, collapsed) {
      let changed = false
      const next = { ...collapsedDirectories }

      for (const directory of directories) {
        if (collapsed) {
          if (next[directory]) continue
          next[directory] = true
          changed = true
        } else {
          if (!next[directory]) continue
          delete next[directory]
          changed = true
        }
      }

      if (!changed) return
      collapsedDirectories = next
      persist()
      notify()
    },
    remove(directory) {
      if (!collapsedDirectories[directory]) return
      const next = { ...collapsedDirectories }
      delete next[directory]
      collapsedDirectories = next
      persist()
      notify()
    },
  }
}

function useDirectoryCollapsed(
  store: CollapsedDirectoryStore,
  directory: string,
  searchActive: boolean
) {
  return React.useSyncExternalStore(
    store.subscribe,
    () => (searchActive ? false : store.isCollapsed(directory)),
    () => false
  )
}

function useAllDirectoriesCollapsed(
  store: CollapsedDirectoryStore,
  directories: Array<string>
) {
  return React.useSyncExternalStore(
    store.subscribe,
    () => store.areAllCollapsed(directories),
    () => false
  )
}

type AppSidebarProps = {
  connected: boolean
  sessionSearch: string
  onSessionSearchChange: (value: string) => void
  sessionSearchInputRef?: React.Ref<HTMLInputElement>
  visibleDirectories: Array<string>
  directorySessionsStore: DirectorySessionsStore
  matchingSessionCount: number
  selectedSessionKeys: Array<string>
  activeSessionId?: string
  activeSessionKey?: string
  emptyStateText: string
  onOpenAddDirectoryDialog: () => void
  onOpenCommandPalette: () => void
  onOpenSettings: () => void
  onSessionClick?: (
    entry: SessionListEntry,
    modifiers: SessionClickModifiers
  ) => void
  onRenameSession?: (entry: SessionListEntry) => void
  onDeleteSession?: (entry: SessionListEntry) => void
  onCreateSessionInDirectory?: (directory: string) => void
  onDeleteOldSessionsInDirectory?: (directory: string) => void
  onRemoveDirectory?: (directory: string) => void
  onReorderDirectories?: (nextDirectories: Array<string>) => void
}

type SortableDirectoryGroupProps = {
  id: string
  disabled: boolean
  children: (args: {
    attributes: Record<string, unknown>
    listeners: Record<string, unknown>
    isDragging: boolean
  }) => React.ReactNode
}

function SortableDirectoryGroup({
  id,
  disabled,
  children,
}: SortableDirectoryGroupProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      {children({
        attributes: attributes as unknown as Record<string, unknown>,
        listeners: listeners as unknown as Record<string, unknown>,
        isDragging,
      })}
    </div>
  )
}

type SelectedSessionKeyStore = {
  subscribeKey: (key: string, listener: () => void) => () => void
  isSelected: (key: string) => boolean
  setKeys: (keys: Array<string>) => void
}

type ActiveSidebarSessionStore = {
  subscribeEntry: (
    entryKey: string,
    sessionId: string | undefined,
    listener: () => void
  ) => () => void
  isActive: (entryKey: string, sessionId: string | undefined) => boolean
  setActive: (active: { sessionId?: string; sessionKey?: string }) => void
}

function createSelectedSessionKeyStore(): SelectedSessionKeyStore {
  let selectedKeys = new Set<string>()
  const listenersByKey = new Map<string, Set<() => void>>()

  const notifyKey = (key: string) => {
    const listeners = listenersByKey.get(key)
    if (!listeners) return
    for (const listener of listeners) listener()
  }

  return {
    subscribeKey(key, listener) {
      if (!key) return () => {}
      const listeners = listenersByKey.get(key) ?? new Set<() => void>()
      listeners.add(listener)
      listenersByKey.set(key, listeners)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          listenersByKey.delete(key)
        }
      }
    },
    isSelected(key) {
      return Boolean(key && selectedKeys.has(key))
    },
    setKeys(keys) {
      const nextKeys = new Set(keys.filter(Boolean))
      const changedKeys = new Set<string>()
      for (const key of selectedKeys) {
        if (!nextKeys.has(key)) changedKeys.add(key)
      }
      for (const key of nextKeys) {
        if (!selectedKeys.has(key)) changedKeys.add(key)
      }
      if (changedKeys.size === 0) return
      selectedKeys = nextKeys
      for (const key of changedKeys) notifyKey(key)
    },
  }
}

function createActiveSidebarSessionStore(): ActiveSidebarSessionStore {
  let activeSessionId = ""
  let activeSessionKey = ""
  const listenersByKey = new Map<string, Set<() => void>>()

  const subscriptionKeys = (entryKey: string, sessionId: string | undefined) =>
    [
      entryKey ? `key:${entryKey}` : "",
      sessionId ? `id:${sessionId}` : "",
    ].filter(Boolean)

  const notifyKey = (key: string) => {
    const listeners = listenersByKey.get(key)
    if (!listeners) return
    for (const listener of listeners) listener()
  }

  return {
    subscribeEntry(entryKey, sessionId, listener) {
      const keys = subscriptionKeys(entryKey, sessionId)
      if (keys.length === 0) return () => {}

      for (const key of keys) {
        const listeners = listenersByKey.get(key) ?? new Set<() => void>()
        listeners.add(listener)
        listenersByKey.set(key, listeners)
      }

      return () => {
        for (const key of keys) {
          const listeners = listenersByKey.get(key)
          if (!listeners) continue
          listeners.delete(listener)
          if (listeners.size === 0) {
            listenersByKey.delete(key)
          }
        }
      }
    },
    isActive(entryKey, sessionId) {
      if (activeSessionKey) return entryKey === activeSessionKey
      return Boolean(activeSessionId && sessionId === activeSessionId)
    },
    setActive(active) {
      const nextSessionId = active.sessionId || ""
      const nextSessionKey = active.sessionKey || ""
      if (
        activeSessionId === nextSessionId &&
        activeSessionKey === nextSessionKey
      ) {
        return
      }

      const changedKeys = new Set([
        activeSessionKey ? `key:${activeSessionKey}` : "",
        nextSessionKey ? `key:${nextSessionKey}` : "",
        activeSessionId ? `id:${activeSessionId}` : "",
        nextSessionId ? `id:${nextSessionId}` : "",
      ])
      activeSessionId = nextSessionId
      activeSessionKey = nextSessionKey
      for (const key of changedKeys) {
        if (key) notifyKey(key)
      }
    },
  }
}

function useSidebarSessionSelected(
  store: SelectedSessionKeyStore,
  entryKey: string
) {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener) => store.subscribeKey(entryKey, listener),
      [entryKey, store]
    ),
    () => store.isSelected(entryKey),
    () => false
  )
}

function useSidebarSessionActive(
  store: ActiveSidebarSessionStore,
  entryKey: string,
  sessionId: string | undefined
) {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener) => store.subscribeEntry(entryKey, sessionId, listener),
      [entryKey, sessionId, store]
    ),
    () => store.isActive(entryKey, sessionId),
    () => false
  )
}

type SidebarSessionItemProps = {
  entryKey: string
  directorySessionsStore: DirectorySessionsStore
  activeSessionStore: ActiveSidebarSessionStore
  selectedSessionKeyStore: SelectedSessionKeyStore
  isMobile: boolean
  overlay: boolean
  setOpenMobile: (open: boolean) => void
  onSessionClick?: (
    entry: SessionListEntry,
    modifiers: SessionClickModifiers
  ) => void
  onRenameSession?: (entry: SessionListEntry) => void
  onDeleteSession?: (entry: SessionListEntry) => void
}

function SidebarSessionItem({
  entryKey,
  directorySessionsStore,
  activeSessionStore,
  selectedSessionKeyStore,
  isMobile,
  overlay,
  setOpenMobile,
  onSessionClick,
  onRenameSession,
  onDeleteSession,
}: SidebarSessionItemProps) {
  const entry = useDirectorySessionEntry(directorySessionsStore, entryKey)
  const isSelected = useSidebarSessionSelected(
    selectedSessionKeyStore,
    entryKey
  )
  const isActive = useSidebarSessionActive(
    activeSessionStore,
    entryKey,
    entry?.id
  )

  if (!entry) return null
  const timestamp = entry.lastUserMessageAt || entry.modified
  const hasTimestamp = isValidSidebarTimestamp(timestamp)
  const messageCount = formatSessionMessageCount(entry.messageCount)
  const hasMetaLine = hasTimestamp || Boolean(messageCount)
  const exactTimestamp =
    hasTimestamp && timestamp ? new Date(timestamp).toLocaleString() : undefined
  const showUnread = Boolean(entry.unread) && !entry.streaming
  const hasSessionActions =
    Boolean(entry.path) && (onRenameSession || onDeleteSession) && !overlay

  const sessionButton = (
    <SidebarMenuButton
      type="button"
      data-sidebar-session-item
      data-session-key={entryKey}
      isActive={isActive}
      className={cn(
        "relative h-auto min-w-0 items-start gap-2 py-2 pr-2 pl-8",
        (isActive || isSelected) &&
          "bg-sidebar-accent text-sidebar-accent-foreground"
      )}
      onClick={(event) => {
        onSessionClick?.(entry, {
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
        })
        if (isMobile) {
          setOpenMobile(false)
        }
      }}
    >
      {entry.streaming ? (
        <span className="absolute top-2.5 left-2 flex size-4 items-center justify-center">
          <Spinner
            className="size-3.5 text-sidebar-foreground/60"
            aria-label="Session streaming"
          />
        </span>
      ) : showUnread ? (
        <span className="absolute top-2.5 left-2 flex size-4 items-center justify-center">
          <span
            className="size-2 rounded-full bg-primary"
            aria-label="Session done"
          />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate font-medium">{entry.title}</span>
          </span>
          {hasMetaLine ? (
            <span
              className="min-w-0 truncate text-[11px] font-normal text-sidebar-foreground/50"
              title={exactTimestamp}
            >
              {hasTimestamp ? <SidebarSessionTime value={timestamp} /> : null}
              {hasTimestamp && messageCount ? " · " : null}
              {messageCount}
            </span>
          ) : null}
        </span>
      </span>
    </SidebarMenuButton>
  )

  return (
    <SidebarMenuItem>
      {hasSessionActions ? (
        <ContextMenu>
          <ContextMenuTrigger render={sessionButton} />
          <ContextMenuContent className="w-40">
            {onRenameSession ? (
              <ContextMenuItem onClick={() => onRenameSession(entry)}>
                Rename
              </ContextMenuItem>
            ) : null}
            {onDeleteSession ? (
              <ContextMenuItem
                variant="destructive"
                onClick={() => onDeleteSession(entry)}
              >
                Delete
              </ContextMenuItem>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        sessionButton
      )}
    </SidebarMenuItem>
  )
}

type DirectorySessionsSnapshot = {
  sessionKeys: Array<string>
  isLoadingSessions: boolean
}

export type DirectorySessionsStore = {
  getSnapshot: (directory: string) => DirectorySessionsSnapshot
  getEntrySnapshot: (entryKey: string) => SessionListEntry | undefined
  setData: (
    sessionsByDirectory: Record<string, Array<SessionListEntry>>,
    loadingByDirectory: Record<string, boolean>
  ) => void
  subscribeDirectory: (directory: string, listener: () => void) => () => void
  subscribeEntry: (entryKey: string, listener: () => void) => () => void
}

function sameDirectorySessionEntry(
  left: SessionListEntry | undefined,
  right: SessionListEntry | undefined
) {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.path === right.path &&
    left.id === right.id &&
    left.cwd === right.cwd &&
    left.name === right.name &&
    left.title === right.title &&
    left.modified === right.modified &&
    left.lastUserMessageAt === right.lastUserMessageAt &&
    left.messageCount === right.messageCount &&
    JSON.stringify(left.contextUsage ?? null) ===
      JSON.stringify(right.contextUsage ?? null) &&
    Boolean(left.streaming) === Boolean(right.streaming) &&
    Boolean(left.unread) === Boolean(right.unread)
  )
}

function buildDirectorySessionEntryMap(
  sessionsByDirectory: Record<string, Array<SessionListEntry>>
) {
  const entriesByKey = new Map<string, SessionListEntry>()

  for (const sessions of Object.values(sessionsByDirectory)) {
    for (const entry of sessions) {
      const entryKey = sessionListEntryKey(entry)
      if (!entryKey || entriesByKey.has(entryKey)) continue
      entriesByKey.set(entryKey, entry)
    }
  }

  return entriesByKey
}

function buildDirectorySessionKeys(
  sessionsByDirectory: Record<string, Array<SessionListEntry>>
) {
  const sessionKeysByDirectory: Record<string, Array<string>> = {}

  for (const [directory, sessions] of Object.entries(sessionsByDirectory)) {
    sessionKeysByDirectory[directory] = sessions
      .map((entry) => sessionListEntryKey(entry))
      .filter(Boolean)
  }

  return sessionKeysByDirectory
}

export function createDirectorySessionsStore(
  sessionsByDirectory: Record<string, Array<SessionListEntry>>,
  loadingByDirectory: Record<string, boolean>
): DirectorySessionsStore {
  let sessionKeysByDirectory = buildDirectorySessionKeys(sessionsByDirectory)
  let entriesByKey = buildDirectorySessionEntryMap(sessionsByDirectory)
  let snapshots = new Map<string, DirectorySessionsSnapshot>()
  const listenersByDirectory = new Map<string, Set<() => void>>()
  const listenersByEntry = new Map<string, Set<() => void>>()

  const readSnapshot = (directory: string) => ({
    sessionKeys:
      sessionKeysByDirectory[directory] ?? EMPTY_DIRECTORY_SESSION_KEYS,
    isLoadingSessions: Boolean(loadingByDirectory[directory]),
  })

  const notifyDirectory = (directory: string) => {
    const listeners = listenersByDirectory.get(directory)
    if (!listeners) return
    for (const listener of listeners) listener()
  }

  const notifyEntry = (entryKey: string) => {
    const listeners = listenersByEntry.get(entryKey)
    if (!listeners) return
    for (const listener of listeners) listener()
  }

  const getCachedSnapshot = (directory: string) => {
    const snapshot = snapshots.get(directory)
    if (snapshot) return snapshot

    const nextSnapshot = readSnapshot(directory)
    snapshots.set(directory, nextSnapshot)
    return nextSnapshot
  }

  for (const directory of new Set([
    ...Object.keys(sessionKeysByDirectory),
    ...Object.keys(loadingByDirectory),
  ])) {
    snapshots.set(directory, readSnapshot(directory))
  }

  return {
    getSnapshot(directory) {
      return getCachedSnapshot(directory)
    },
    getEntrySnapshot(entryKey) {
      return entriesByKey.get(entryKey)
    },
    setData(nextSessionsByDirectory, nextLoadingByDirectory) {
      const nextSessionKeysByDirectory = buildDirectorySessionKeys(
        nextSessionsByDirectory
      )
      const nextEntriesByKey = buildDirectorySessionEntryMap(
        nextSessionsByDirectory
      )
      const directories = new Set([
        ...Object.keys(sessionKeysByDirectory),
        ...Object.keys(loadingByDirectory),
        ...Object.keys(nextSessionKeysByDirectory),
        ...Object.keys(nextLoadingByDirectory),
      ])
      const previousEntriesByKey = entriesByKey
      const entryKeys = new Set([
        ...previousEntriesByKey.keys(),
        ...nextEntriesByKey.keys(),
      ])

      sessionKeysByDirectory = nextSessionKeysByDirectory
      entriesByKey = nextEntriesByKey
      loadingByDirectory = nextLoadingByDirectory

      for (const entryKey of entryKeys) {
        if (
          sameDirectorySessionEntry(
            previousEntriesByKey.get(entryKey),
            nextEntriesByKey.get(entryKey)
          )
        ) {
          continue
        }
        notifyEntry(entryKey)
      }

      for (const directory of directories) {
        const previous = snapshots.get(directory)
        const next = readSnapshot(directory)
        if (
          previous &&
          directoryOrderEqual(previous.sessionKeys, next.sessionKeys) &&
          previous.isLoadingSessions === next.isLoadingSessions
        ) {
          snapshots.set(directory, previous)
          continue
        }

        snapshots.set(directory, next)
        notifyDirectory(directory)
      }
    },
    subscribeDirectory(directory, listener) {
      const listeners = listenersByDirectory.get(directory) ?? new Set()
      listeners.add(listener)
      listenersByDirectory.set(directory, listeners)

      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          listenersByDirectory.delete(directory)
        }
      }
    },
    subscribeEntry(entryKey, listener) {
      if (!entryKey) return () => {}
      const listeners = listenersByEntry.get(entryKey) ?? new Set()
      listeners.add(listener)
      listenersByEntry.set(entryKey, listeners)

      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          listenersByEntry.delete(entryKey)
        }
      }
    },
  }
}

function useDirectorySessions(
  store: DirectorySessionsStore,
  directory: string
) {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener) => store.subscribeDirectory(directory, listener),
      [directory, store]
    ),
    () => store.getSnapshot(directory),
    () => store.getSnapshot(directory)
  )
}

function useDirectorySessionEntry(
  store: DirectorySessionsStore,
  entryKey: string
) {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener) => store.subscribeEntry(entryKey, listener),
      [entryKey, store]
    ),
    () => store.getEntrySnapshot(entryKey),
    () => store.getEntrySnapshot(entryKey)
  )
}

type DirectorySessionGroupProps = {
  directory: string
  directorySessionsStore: DirectorySessionsStore
  collapsedDirectoryStore: CollapsedDirectoryStore
  searchActive: boolean
  directoryOrderingEnabled: boolean
  activeSessionStore: ActiveSidebarSessionStore
  selectedSessionKeyStore: SelectedSessionKeyStore
  isMobile: boolean
  setOpenMobile: (open: boolean) => void
  isDragging?: boolean
  overlay?: boolean
  attributes?: Record<string, unknown>
  listeners?: Record<string, unknown>
  onSessionClick?: (
    entry: SessionListEntry,
    modifiers: SessionClickModifiers
  ) => void
  onRenameSession?: (entry: SessionListEntry) => void
  onDeleteSession?: (entry: SessionListEntry) => void
  onCreateSessionInDirectory?: (directory: string) => void
  onDeleteOldSessionsInDirectory?: (directory: string) => void
  onRemoveDirectory?: (directory: string) => void
}

const DirectorySessionGroup = React.memo(function DirectorySessionGroup({
  directory,
  directorySessionsStore,
  collapsedDirectoryStore,
  searchActive,
  directoryOrderingEnabled,
  activeSessionStore,
  selectedSessionKeyStore,
  isMobile,
  setOpenMobile,
  isDragging,
  overlay = false,
  attributes,
  listeners,
  onSessionClick,
  onRenameSession,
  onDeleteSession,
  onCreateSessionInDirectory,
  onDeleteOldSessionsInDirectory,
  onRemoveDirectory,
}: DirectorySessionGroupProps) {
  const [renderCount, setRenderCount] = React.useState(
    INITIAL_DIRECTORY_SESSION_RENDER_COUNT
  )
  const { isLoadingSessions, sessionKeys } = useDirectorySessions(
    directorySessionsStore,
    directory
  )
  const collapsed = useDirectoryCollapsed(
    collapsedDirectoryStore,
    directory,
    searchActive
  )
  const visibleCount = searchActive
    ? sessionKeys.length
    : Math.min(sessionKeys.length, renderCount)
  const visibleSessionKeys = sessionKeys.slice(0, visibleCount)
  const hasMoreSessions = visibleCount < sessionKeys.length
  const showLoadingSpinner = useDelayedTrue(
    isLoadingSessions,
    SIDEBAR_LOADING_SPINNER_DELAY_MS
  )
  const showLoadingState = isLoadingSessions && sessionKeys.length === 0
  const showHeaderLoadingSpinner =
    showLoadingSpinner && sessionKeys.length === 0 && collapsed
  const hasDirectoryActions =
    !overlay &&
    Boolean(
      onCreateSessionInDirectory ||
      onDeleteOldSessionsInDirectory ||
      onRemoveDirectory
    )

  const directoryHeader = (
    <div className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-sidebar-accent">
      <button
        type="button"
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-sidebar-foreground",
          directoryOrderingEnabled &&
            !overlay &&
            "cursor-grab active:cursor-grabbing",
          searchActive && "cursor-default"
        )}
        aria-grabbed={
          directoryOrderingEnabled && !overlay ? Boolean(isDragging) : undefined
        }
        onClick={() => {
          if (!searchActive && !overlay) {
            collapsedDirectoryStore.toggle(directory)
          }
        }}
        title={directory}
        {...(attributes ?? {})}
        {...(listeners ?? {})}
      >
        {!searchActive ? (
          collapsed ? (
            <ChevronRightIcon className="size-4 shrink-0" />
          ) : (
            <ChevronDownIcon className="size-4 shrink-0" />
          )
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <DirectoryPathLabel path={directory} />
          <span className="min-w-0 truncate text-[11px] font-normal text-sidebar-foreground/50">
            {sessionKeys.length} session{sessionKeys.length === 1 ? "" : "s"}
          </span>
        </span>
        {showHeaderLoadingSpinner ? (
          <Spinner className="size-3.5 shrink-0 text-sidebar-foreground/50" />
        ) : null}
      </button>

      {onCreateSessionInDirectory && !overlay ? (
        <Button
          size="icon-xs"
          variant="ghost"
          className="shrink-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          title={`Create a session in ${directory}`}
          onClick={() => onCreateSessionInDirectory(directory)}
        >
          <SquarePenIcon className="size-4" />
        </Button>
      ) : null}
    </div>
  )

  return (
    <SidebarGroup
      className={cn("rounded-lg py-1", isDragging && !overlay && "opacity-0")}
    >
      {hasDirectoryActions ? (
        <ContextMenu>
          <ContextMenuTrigger render={directoryHeader} />
          <ContextMenuContent className="w-48">
            {onCreateSessionInDirectory ? (
              <ContextMenuItem
                onClick={() => onCreateSessionInDirectory(directory)}
              >
                New session
              </ContextMenuItem>
            ) : null}
            {onDeleteOldSessionsInDirectory ? (
              <ContextMenuItem
                onClick={() => onDeleteOldSessionsInDirectory(directory)}
              >
                Delete old sessions…
              </ContextMenuItem>
            ) : null}
            {onRemoveDirectory ? (
              <ContextMenuItem
                variant="destructive"
                onClick={() => onRemoveDirectory(directory)}
              >
                Remove from sidebar
              </ContextMenuItem>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        directoryHeader
      )}

      {!collapsed ? (
        <SidebarGroupContent>
          {showLoadingState ? (
            <div className="flex items-center gap-2 px-2 py-2 text-sm text-sidebar-foreground/70">
              {showLoadingSpinner ? (
                <Spinner />
              ) : (
                <span className="size-4" aria-hidden="true" />
              )}
              Loading sessions…
            </div>
          ) : sessionKeys.length > 0 ? (
            <div className="flex flex-col">
              <SidebarMenu>
                {visibleSessionKeys.map((entryKey) => (
                  <SidebarSessionItem
                    key={entryKey}
                    entryKey={entryKey}
                    directorySessionsStore={directorySessionsStore}
                    activeSessionStore={activeSessionStore}
                    selectedSessionKeyStore={selectedSessionKeyStore}
                    isMobile={isMobile}
                    overlay={overlay}
                    setOpenMobile={setOpenMobile}
                    onSessionClick={onSessionClick}
                    onRenameSession={onRenameSession}
                    onDeleteSession={onDeleteSession}
                  />
                ))}
              </SidebarMenu>

              {hasMoreSessions && !overlay ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 justify-start pl-8 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  onClick={() => {
                    setRenderCount((current) =>
                      Math.min(
                        sessionKeys.length,
                        current + DIRECTORY_SESSION_LOAD_MORE_COUNT
                      )
                    )
                  }}
                >
                  Show{" "}
                  {Math.min(
                    DIRECTORY_SESSION_LOAD_MORE_COUNT,
                    sessionKeys.length - visibleCount
                  )}{" "}
                  more
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="px-2 py-2 text-sm text-sidebar-foreground/70">
              {searchActive ? "No matching sessions." : "No sessions yet."}
            </div>
          )}
        </SidebarGroupContent>
      ) : null}
    </SidebarGroup>
  )
})

type DirectoryCollapseAllButtonProps = {
  searchActive: boolean
  visibleDirectories: Array<string>
  collapsedDirectoryStore: CollapsedDirectoryStore
}

function DirectoryCollapseAllButton({
  searchActive,
  visibleDirectories,
  collapsedDirectoryStore,
}: DirectoryCollapseAllButtonProps) {
  const allDirectoriesCollapsed = useAllDirectoriesCollapsed(
    collapsedDirectoryStore,
    visibleDirectories
  )

  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      disabled={searchActive || visibleDirectories.length === 0}
      onClick={() => {
        collapsedDirectoryStore.setAll(
          visibleDirectories,
          !allDirectoriesCollapsed
        )
      }}
      aria-label={
        allDirectoriesCollapsed
          ? "Expand all directories"
          : "Collapse all directories"
      }
      title={
        allDirectoriesCollapsed
          ? "Expand all directories"
          : "Collapse all directories"
      }
    >
      {allDirectoriesCollapsed ? <ChevronsUpDown /> : <ChevronsDownUpIcon />}
    </Button>
  )
}

type SidebarSearchInputProps = {
  value: string
  onValueChange: (value: string) => void
  inputRef?: React.Ref<HTMLInputElement>
}

type AppSidebarHeaderProps = {
  connected: boolean
  sessionSearch: string
  onSessionSearchChange: (value: string) => void
  sessionSearchInputRef?: React.Ref<HTMLInputElement>
  visibleDirectories: Array<string>
  matchingSessionCount: number
  collapsedDirectoryStore: CollapsedDirectoryStore
  onOpenAddDirectoryDialog: () => void
}

function SidebarSearchInput({
  inputRef,
  onValueChange,
  value,
}: SidebarSearchInputProps) {
  const [draftValue, setDraftValue] = React.useState(value)
  const hasSearchValue = draftValue.length > 0

  React.useEffect(() => {
    setDraftValue((current) => (current === value ? current : value))
  }, [value])

  React.useEffect(() => {
    if (draftValue === value) return

    const timeoutId = window.setTimeout(() => {
      React.startTransition(() => {
        onValueChange(draftValue)
      })
    }, SIDEBAR_SEARCH_COMMIT_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [draftValue, onValueChange, value])

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-sidebar-foreground/50" />
      <Input
        ref={inputRef}
        value={draftValue}
        onChange={(event) => {
          const nextValue = event.target.value
          setDraftValue(nextValue)
          if (!nextValue) {
            React.startTransition(() => {
              onValueChange("")
            })
          }
        }}
        placeholder="Search sessions..."
        className="border-sidebar-border/70 bg-sidebar-accent/20 pr-9 pl-9"
      />
      {hasSearchValue ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-1/2 right-1.5 -translate-y-1/2 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            setDraftValue("")
            React.startTransition(() => {
              onValueChange("")
            })
            event.currentTarget.parentElement?.querySelector("input")?.focus()
          }}
          aria-label="Clear session search"
          title="Clear session search"
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  )
}

function AppSidebarHeader({
  connected,
  sessionSearch,
  onSessionSearchChange,
  sessionSearchInputRef,
  visibleDirectories,
  matchingSessionCount,
  collapsedDirectoryStore,
  onOpenAddDirectoryDialog,
}: AppSidebarHeaderProps) {
  const searchActive = sessionSearch.trim().length > 0

  return (
    <SidebarHeader className="gap-3 border-b border-sidebar-border/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-xl font-semibold tracking-tight text-sidebar-foreground">
            Phi
          </h1>
        </div>
        <ConnectionBadge connected={connected} />
      </div>

      <SidebarSearchInput
        value={sessionSearch}
        onValueChange={onSessionSearchChange}
        inputRef={sessionSearchInputRef}
      />

      <div className="flex items-center justify-between gap-3 text-xs text-sidebar-foreground/70">
        <span>
          {searchActive
            ? `${matchingSessionCount} matching session${matchingSessionCount === 1 ? "" : "s"}`
            : "Directories"}
        </span>
        <div className="flex items-center gap-1">
          <DirectoryCollapseAllButton
            searchActive={searchActive}
            visibleDirectories={visibleDirectories}
            collapsedDirectoryStore={collapsedDirectoryStore}
          />
          <Button
            variant="secondary"
            size="icon-sm"
            className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={onOpenAddDirectoryDialog}
            aria-label="Add directory"
            title="Add directory"
          >
            <FolderPlusIcon />
          </Button>
        </div>
      </div>
    </SidebarHeader>
  )
}

export function AppSidebar({
  connected,
  sessionSearch,
  onSessionSearchChange,
  sessionSearchInputRef,
  visibleDirectories,
  directorySessionsStore,
  matchingSessionCount,
  selectedSessionKeys,
  activeSessionId,
  activeSessionKey,
  emptyStateText,
  onOpenAddDirectoryDialog,
  onOpenCommandPalette,
  onOpenSettings,
  onSessionClick,
  onRenameSession,
  onDeleteSession,
  onCreateSessionInDirectory,
  onDeleteOldSessionsInDirectory,
  onRemoveDirectory,
  onReorderDirectories,
}: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar()
  const searchActive = sessionSearch.trim().length > 0
  const directoryOrderingEnabled =
    !searchActive && visibleDirectories.length > 1
  const [activeDirectory, setActiveDirectory] = React.useState<string | null>(
    null
  )
  const [previewDirectoryOrder, setPreviewDirectoryOrder] =
    React.useState<Array<string> | null>(null)
  const [collapsedDirectoryStore] = React.useState(
    createCollapsedDirectoryStore
  )
  const [selectedSessionKeyStore] = React.useState(
    createSelectedSessionKeyStore
  )
  const [activeSessionStore] = React.useState(createActiveSidebarSessionStore)

  React.useLayoutEffect(() => {
    selectedSessionKeyStore.setKeys(selectedSessionKeys)
  }, [selectedSessionKeyStore, selectedSessionKeys])

  React.useLayoutEffect(() => {
    activeSessionStore.setActive({
      sessionId: activeSessionId,
      sessionKey: activeSessionKey,
    })
  }, [activeSessionId, activeSessionKey, activeSessionStore])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  )

  React.useEffect(() => {
    collapsedDirectoryStore.loadStored()
  }, [collapsedDirectoryStore])

  React.useEffect(() => {
    if (directoryOrderingEnabled) return
    setActiveDirectory(null)
    setPreviewDirectoryOrder(null)
  }, [directoryOrderingEnabled])

  const orderedVisibleDirectories = (() => {
    if (!previewDirectoryOrder || previewDirectoryOrder.length === 0) {
      return visibleDirectories
    }

    const visibleDirectorySet = new Set(visibleDirectories)
    const orderedDirectories = previewDirectoryOrder.filter((directory) =>
      visibleDirectorySet.has(directory)
    )
    const missingDirectories = visibleDirectories.filter(
      (directory) => !orderedDirectories.includes(directory)
    )

    return [...orderedDirectories, ...missingDirectories]
  })()

  React.useEffect(() => {
    if (!previewDirectoryOrder) return
    if (!directoryOrderEqual(orderedVisibleDirectories, visibleDirectories)) {
      return
    }

    setPreviewDirectoryOrder(null)
  }, [orderedVisibleDirectories, previewDirectoryOrder, visibleDirectories])

  const removeDirectory = (directory: string) => {
    collapsedDirectoryStore.remove(directory)
    onRemoveDirectory?.(directory)
  }

  const movePreviewDirectory = (activeId: string, overId: string) => {
    setPreviewDirectoryOrder((current) => {
      const baseOrder =
        current && current.length > 0 ? current : visibleDirectories
      const oldIndex = baseOrder.indexOf(activeId)
      const newIndex = baseOrder.indexOf(overId)
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
        return current
      }
      return arrayMove(baseOrder, oldIndex, newIndex)
    })
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDirectory(String(event.active.id))
    setPreviewDirectoryOrder(visibleDirectories)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : ""
    if (!activeId || !overId || activeId === overId) return
    movePreviewDirectory(activeId, overId)
  }

  const handleDragCancel = () => {
    setActiveDirectory(null)
    setPreviewDirectoryOrder(null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : ""

    let nextOrder = previewDirectoryOrder
    if (
      (!nextOrder || nextOrder.length === 0) &&
      activeId &&
      overId &&
      activeId !== overId
    ) {
      const oldIndex = visibleDirectories.indexOf(activeId)
      const newIndex = visibleDirectories.indexOf(overId)
      if (oldIndex !== -1 && newIndex !== -1) {
        nextOrder = arrayMove(visibleDirectories, oldIndex, newIndex)
      }
    }

    if (
      nextOrder &&
      nextOrder.length > 0 &&
      !directoryOrderEqual(nextOrder, visibleDirectories)
    ) {
      onReorderDirectories?.(nextOrder)
    }

    setActiveDirectory(null)
    setPreviewDirectoryOrder(null)
  }

  return (
    <Sidebar
      collapsible="offcanvas"
      className="border-r border-sidebar-border/70"
    >
      <AppSidebarHeader
        connected={connected}
        sessionSearch={sessionSearch}
        onSessionSearchChange={onSessionSearchChange}
        sessionSearchInputRef={sessionSearchInputRef}
        visibleDirectories={visibleDirectories}
        matchingSessionCount={matchingSessionCount}
        collapsedDirectoryStore={collapsedDirectoryStore}
        onOpenAddDirectoryDialog={onOpenAddDirectoryDialog}
      />

      <SidebarContent className="px-2 py-3">
        {visibleDirectories.length === 0 ? (
          <SidebarGroup className="px-2 py-2">
            <Empty className="rounded-xl border border-dashed bg-sidebar-accent/10 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderIcon />
                </EmptyMedia>
                <EmptyTitle>{emptyStateText}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          </SidebarGroup>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={directoryOrderingEnabled ? handleDragStart : undefined}
            onDragOver={directoryOrderingEnabled ? handleDragOver : undefined}
            onDragEnd={directoryOrderingEnabled ? handleDragEnd : undefined}
            onDragCancel={
              directoryOrderingEnabled ? handleDragCancel : undefined
            }
          >
            <SortableContext
              items={orderedVisibleDirectories}
              strategy={verticalListSortingStrategy}
            >
              {orderedVisibleDirectories.map((directory) => {
                return (
                  <SortableDirectoryGroup
                    key={directory}
                    id={directory}
                    disabled={!directoryOrderingEnabled}
                  >
                    {({ attributes, listeners, isDragging }) => (
                      <DirectorySessionGroup
                        directory={directory}
                        directorySessionsStore={directorySessionsStore}
                        collapsedDirectoryStore={collapsedDirectoryStore}
                        searchActive={searchActive}
                        directoryOrderingEnabled={directoryOrderingEnabled}
                        activeSessionStore={activeSessionStore}
                        selectedSessionKeyStore={selectedSessionKeyStore}
                        isMobile={isMobile}
                        setOpenMobile={setOpenMobile}
                        isDragging={isDragging}
                        attributes={attributes}
                        listeners={listeners}
                        onSessionClick={onSessionClick}
                        onRenameSession={onRenameSession}
                        onDeleteSession={onDeleteSession}
                        onCreateSessionInDirectory={onCreateSessionInDirectory}
                        onDeleteOldSessionsInDirectory={
                          onDeleteOldSessionsInDirectory
                        }
                        onRemoveDirectory={
                          onRemoveDirectory ? removeDirectory : undefined
                        }
                      />
                    )}
                  </SortableDirectoryGroup>
                )
              })}
            </SortableContext>

            <DragOverlay>
              {activeDirectory ? (
                <DirectorySessionGroup
                  directory={activeDirectory}
                  directorySessionsStore={directorySessionsStore}
                  collapsedDirectoryStore={collapsedDirectoryStore}
                  searchActive={searchActive}
                  directoryOrderingEnabled={directoryOrderingEnabled}
                  activeSessionStore={activeSessionStore}
                  selectedSessionKeyStore={selectedSessionKeyStore}
                  isMobile={isMobile}
                  setOpenMobile={setOpenMobile}
                  overlay
                  onSessionClick={onSessionClick}
                  onRenameSession={onRenameSession}
                  onDeleteSession={onDeleteSession}
                  onCreateSessionInDirectory={onCreateSessionInDirectory}
                  onDeleteOldSessionsInDirectory={
                    onDeleteOldSessionsInDirectory
                  }
                  onRemoveDirectory={
                    onRemoveDirectory ? removeDirectory : undefined
                  }
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </SidebarContent>

      <SidebarFooter className="gap-2 border-t border-sidebar-border/70 p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton type="button" onClick={onOpenCommandPalette}>
              <CommandIcon />
              <span>Commands</span>
              <kbd className="ml-auto rounded border border-sidebar-border/70 bg-sidebar-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/70">
                Ctrl+P
              </kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton type="button" onClick={onOpenSettings}>
              <Settings2Icon />
              <span>Settings</span>
              <kbd className="ml-auto rounded border border-sidebar-border/70 bg-sidebar-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/70">
                Ctrl+,
              </kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
