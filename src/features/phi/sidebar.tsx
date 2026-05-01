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
  EllipsisVerticalIcon,
  FolderIcon,
  FolderPlusIcon,
  SearchIcon,
  SquarePenIcon,
  Settings2Icon,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import {
  createPhiStore,
  setStoreState,
  useSelector,
  type PhiStore,
} from "@/features/phi/tanstack-store-utils"
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

type CollapsedDirectoryState = Record<string, boolean>

type CollapsedDirectoryStore = PhiStore<CollapsedDirectoryState> & {
  loadStored: () => void
  toggle: (directory: string) => void
  setAll: (directories: Array<string>, collapsed: boolean) => void
  remove: (directory: string) => void
}

function sameCollapsedDirectoryState(
  left: CollapsedDirectoryState,
  right: CollapsedDirectoryState
) {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (!directoryOrderEqual(leftKeys, rightKeys)) return false

  return leftKeys.every((key) => Boolean(left[key]) === Boolean(right[key]))
}

function createCollapsedDirectoryStore(): CollapsedDirectoryStore {
  const store = createPhiStore<CollapsedDirectoryState>(
    {},
    sameCollapsedDirectoryState
  ) as CollapsedDirectoryStore

  const persist = () => {
    safeLocalStorageSetItem(
      COLLAPSED_DIRECTORIES_STORAGE_KEY,
      JSON.stringify(store.state)
    )
  }

  Object.assign(store, {
    loadStored() {
      setStoreState(store, readStoredCollapsedDirectories())
    },
    toggle(directory) {
      setStoreState(store, (current) => {
        const next = { ...current }
        if (next[directory]) {
          delete next[directory]
        } else {
          next[directory] = true
        }
        return next
      })
      persist()
    },
    setAll(directories, collapsed) {
      setStoreState(store, (current) => {
        let changed = false
        const next = { ...current }

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

        return changed ? next : current
      })
      persist()
    },
    remove(directory) {
      setStoreState(store, (current) => {
        if (!current[directory]) return current
        const next = { ...current }
        delete next[directory]
        return next
      })
      persist()
    },
  } satisfies Omit<
    CollapsedDirectoryStore,
    keyof PhiStore<CollapsedDirectoryState>
  >)

  return store
}

function useDirectoryCollapsed(
  store: CollapsedDirectoryStore,
  directory: string,
  searchActive: boolean
) {
  return useSelector(store, (collapsedDirectories) =>
    searchActive ? false : Boolean(collapsedDirectories[directory])
  )
}

function useAllDirectoriesCollapsed(
  store: CollapsedDirectoryStore,
  directories: Array<string>
) {
  return useSelector(
    store,
    (collapsedDirectories) =>
      directories.length > 0 &&
      directories.every((directory) => collapsedDirectories[directory])
  )
}

type AppSidebarProps = {
  sessionSearch: string
  onOpenSessionsDialog: () => void
  visibleDirectories: Array<string>
  directorySessionsStore: DirectorySessionsStore
  matchingSessionCount: number
  selectedSessionKeys: Array<string>
  activeSessionId?: string
  activeSessionKey?: string
  emptyStateText: string
  onCreateSession: () => void
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

type SelectedSessionKeyStore = PhiStore<ReadonlySet<string>> & {
  setKeys: (keys: Array<string>) => void
}

type ActiveSidebarSessionState = {
  sessionId: string
  sessionKey: string
}

type ActiveSidebarSessionStore = PhiStore<ActiveSidebarSessionState> & {
  setActive: (active: { sessionId?: string; sessionKey?: string }) => void
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false

  for (const key of left) {
    if (!right.has(key)) return false
  }

  return true
}

function createSelectedSessionKeyStore(): SelectedSessionKeyStore {
  const store = createPhiStore<ReadonlySet<string>>(
    new Set(),
    sameStringSet
  ) as SelectedSessionKeyStore

  Object.assign(store, {
    setKeys(keys) {
      setStoreState(store, new Set(keys.filter(Boolean)))
    },
  } satisfies Omit<
    SelectedSessionKeyStore,
    keyof PhiStore<ReadonlySet<string>>
  >)

  return store
}

function normalizeActiveSidebarSessionKey(sessionKey: string | undefined) {
  const key = sessionKey?.trim() || ""
  if (!key) return ""
  if (key.startsWith("path:") || key.startsWith("id:")) return key
  if (key.includes("/") || key.includes("\\")) {
    return sessionListEntryKey({ path: key })
  }
  return key
}

function createActiveSidebarSessionStore(): ActiveSidebarSessionStore {
  const store = createPhiStore<ActiveSidebarSessionState>({
    sessionId: "",
    sessionKey: "",
  }) as ActiveSidebarSessionStore

  Object.assign(store, {
    setActive(active) {
      const sessionId = active.sessionId || ""
      const sessionKey = normalizeActiveSidebarSessionKey(active.sessionKey)
      setStoreState(store, (current) => {
        if (
          current.sessionId === sessionId &&
          current.sessionKey === sessionKey
        ) {
          return current
        }

        return { sessionId, sessionKey }
      })
    },
  } satisfies Omit<
    ActiveSidebarSessionStore,
    keyof PhiStore<ActiveSidebarSessionState>
  >)

  return store
}

function useSidebarSessionSelected(
  store: SelectedSessionKeyStore,
  entryKey: string
) {
  return useSelector(store, (selectedKeys) =>
    Boolean(entryKey && selectedKeys.has(entryKey))
  )
}

function useSidebarSessionActive(
  store: ActiveSidebarSessionStore,
  entryKey: string,
  sessionId: string | undefined
) {
  return useSelector(store, (active) => {
    if (active.sessionKey && entryKey === active.sessionKey) return true
    return Boolean(active.sessionId && sessionId === active.sessionId)
  })
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

type DirectorySessionsState = {
  sessionKeysByDirectory: Record<string, Array<string>>
  entriesByKey: Map<string, SessionListEntry>
  loadingByDirectory: Record<string, boolean>
}

export type DirectorySessionsStore = PhiStore<DirectorySessionsState> & {
  setData: (
    sessionsByDirectory: Record<string, Array<SessionListEntry>>,
    loadingByDirectory: Record<string, boolean>
  ) => void
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

function sameDirectorySessionsSnapshot(
  left: DirectorySessionsSnapshot,
  right: DirectorySessionsSnapshot
) {
  return (
    left.isLoadingSessions === right.isLoadingSessions &&
    directoryOrderEqual(left.sessionKeys, right.sessionKeys)
  )
}

function sameDirectorySessionsState(
  left: DirectorySessionsState,
  right: DirectorySessionsState
) {
  const directories = new Set([
    ...Object.keys(left.sessionKeysByDirectory),
    ...Object.keys(left.loadingByDirectory),
    ...Object.keys(right.sessionKeysByDirectory),
    ...Object.keys(right.loadingByDirectory),
  ])

  for (const directory of directories) {
    if (
      !directoryOrderEqual(
        left.sessionKeysByDirectory[directory] ?? EMPTY_DIRECTORY_SESSION_KEYS,
        right.sessionKeysByDirectory[directory] ?? EMPTY_DIRECTORY_SESSION_KEYS
      ) ||
      Boolean(left.loadingByDirectory[directory]) !==
        Boolean(right.loadingByDirectory[directory])
    ) {
      return false
    }
  }

  const entryKeys = new Set([
    ...left.entriesByKey.keys(),
    ...right.entriesByKey.keys(),
  ])

  for (const entryKey of entryKeys) {
    if (
      !sameDirectorySessionEntry(
        left.entriesByKey.get(entryKey),
        right.entriesByKey.get(entryKey)
      )
    ) {
      return false
    }
  }

  return true
}

export function createDirectorySessionsStore(
  sessionsByDirectory: Record<string, Array<SessionListEntry>>,
  loadingByDirectory: Record<string, boolean>
): DirectorySessionsStore {
  const store = createPhiStore<DirectorySessionsState>(
    {
      sessionKeysByDirectory: buildDirectorySessionKeys(sessionsByDirectory),
      entriesByKey: buildDirectorySessionEntryMap(sessionsByDirectory),
      loadingByDirectory,
    },
    sameDirectorySessionsState
  ) as DirectorySessionsStore

  Object.assign(store, {
    setData(nextSessionsByDirectory, nextLoadingByDirectory) {
      setStoreState(store, {
        sessionKeysByDirectory: buildDirectorySessionKeys(
          nextSessionsByDirectory
        ),
        entriesByKey: buildDirectorySessionEntryMap(nextSessionsByDirectory),
        loadingByDirectory: nextLoadingByDirectory,
      })
    },
  } satisfies Omit<
    DirectorySessionsStore,
    keyof PhiStore<DirectorySessionsState>
  >)

  return store
}

function useDirectorySessions(
  store: DirectorySessionsStore,
  directory: string
) {
  return useSelector(
    store,
    (state) => ({
      sessionKeys:
        state.sessionKeysByDirectory[directory] ?? EMPTY_DIRECTORY_SESSION_KEYS,
      isLoadingSessions: Boolean(state.loadingByDirectory[directory]),
    }),
    { compare: sameDirectorySessionsSnapshot }
  )
}

function useDirectorySessionEntry(
  store: DirectorySessionsStore,
  entryKey: string
) {
  return useSelector(store, (state) => state.entriesByKey.get(entryKey), {
    compare: sameDirectorySessionEntry,
  })
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

      {onCreateSessionInDirectory && !overlay && !isMobile ? (
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

      {hasDirectoryActions && isMobile ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                className="shrink-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                aria-label={`Directory actions for ${directory}`}
                title="Directory actions"
              />
            }
          >
            <EllipsisVerticalIcon className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {onCreateSessionInDirectory ? (
              <DropdownMenuItem
                onClick={() => onCreateSessionInDirectory(directory)}
              >
                New session
              </DropdownMenuItem>
            ) : null}
            {onDeleteOldSessionsInDirectory ? (
              <DropdownMenuItem
                onClick={() => onDeleteOldSessionsInDirectory(directory)}
              >
                Delete old sessions…
              </DropdownMenuItem>
            ) : null}
            {onRemoveDirectory ? (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onRemoveDirectory(directory)}
              >
                Remove from sidebar
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )

  return (
    <SidebarGroup
      className={cn("rounded-lg py-1", isDragging && !overlay && "opacity-0")}
    >
      {hasDirectoryActions && !isMobile ? (
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

type AppSidebarHeaderProps = {
  sessionSearch: string
  onOpenSessionsDialog: () => void
  visibleDirectories: Array<string>
  matchingSessionCount: number
  collapsedDirectoryStore: CollapsedDirectoryStore
  onCreateSession: () => void
  onOpenAddDirectoryDialog: () => void
}

function AppSidebarHeader({
  sessionSearch,
  onOpenSessionsDialog,
  visibleDirectories,
  matchingSessionCount,
  collapsedDirectoryStore,
  onCreateSession,
  onOpenAddDirectoryDialog,
}: AppSidebarHeaderProps) {
  const searchActive = sessionSearch.trim().length > 0

  return (
    <SidebarHeader className="gap-2 border-b border-sidebar-border/70">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton type="button" onClick={onOpenSessionsDialog}>
            <SearchIcon />
            <span>Search sessions...</span>
            <kbd className="ml-auto hidden rounded border border-sidebar-border/70 bg-sidebar-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/70 md:inline">
              Ctrl+S
            </kbd>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton type="button" onClick={onCreateSession}>
            <SquarePenIcon />
            <span>New session</span>
            <kbd className="ml-auto hidden rounded border border-sidebar-border/70 bg-sidebar-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/70 md:inline">
              Ctrl+N
            </kbd>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>

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
  sessionSearch,
  onOpenSessionsDialog,
  visibleDirectories,
  directorySessionsStore,
  matchingSessionCount,
  selectedSessionKeys,
  activeSessionId,
  activeSessionKey,
  emptyStateText,
  onCreateSession,
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
      className="top-(--header-height) !h-[calc(100svh-var(--header-height))] border-r border-sidebar-border/70"
    >
      <AppSidebarHeader
        sessionSearch={sessionSearch}
        onOpenSessionsDialog={onOpenSessionsDialog}
        visibleDirectories={visibleDirectories}
        matchingSessionCount={matchingSessionCount}
        collapsedDirectoryStore={collapsedDirectoryStore}
        onCreateSession={onCreateSession}
        onOpenAddDirectoryDialog={onOpenAddDirectoryDialog}
      />

      <SidebarContent>
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

      <SidebarFooter className="gap-2 border-t border-sidebar-border/70">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton type="button" onClick={onOpenCommandPalette}>
              <CommandIcon />
              <span>Commands</span>
              <kbd className="ml-auto hidden rounded border border-sidebar-border/70 bg-sidebar-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/70 md:inline">
                Ctrl+P
              </kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton type="button" onClick={onOpenSettings}>
              <Settings2Icon />
              <span>Settings</span>
              <kbd className="ml-auto hidden rounded border border-sidebar-border/70 bg-sidebar-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/70 md:inline">
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
