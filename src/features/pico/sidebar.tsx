import * as React from "react"

import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
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

import type { SessionListEntry } from "@/lib/pico/api"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { TitleTooltip } from "@/components/ui/tooltip"
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
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
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
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { Kbd } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import {
  COLLAPSED_DIRECTORIES_STORAGE_KEY,
  DIRECTORY_SESSION_LOAD_MORE_COUNT,
  INITIAL_DIRECTORY_SESSION_RENDER_COUNT,
  readStoredCollapsedDirectories,
  safeLocalStorageSetItem,
  sessionListEntryKey,
} from "@/lib/pico"
import { formatDisplayPath } from "@/features/pico/app-shell-common"
import { formatShortcutLabel } from "@/features/pico/keyboard-shortcuts"
import {
  createPicoStore,
  setStoreState,
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
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
  multiSelectKey: boolean
  shiftKey: boolean
}

const EMPTY_DIRECTORY_SESSION_KEYS: Array<string> = []
const PINNED_SESSION_GROUP_COLLAPSE_KEY = "__pico_pinned_sessions__"
const DIRECTORIES_SESSION_GROUP_COLLAPSE_KEY = "__pico_directories__"

function isMacPlatform() {
  if (typeof window === "undefined") return false

  const platform = window.navigator.platform || window.navigator.userAgent
  return /mac|iphone|ipad|ipod/i.test(platform)
}

function isSidebarMultiSelectModifier(event: {
  ctrlKey: boolean
  metaKey: boolean
}) {
  return isMacPlatform() ? event.metaKey : event.ctrlKey
}

function formatSidebarSessionTime(value?: string, now = Date.now()) {
  if (!value) return ""

  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return ""

  const diffMs = now - timestamp
  const past = diffMs >= 0
  const seconds = Math.max(1, Math.floor(Math.abs(diffMs) / 1000))
  const prefix = past ? "" : "in "

  if (seconds < 60) return `${prefix}${seconds}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${prefix}${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${prefix}${hours}h`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${prefix}${days}d`

  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${prefix}${weeks}w`

  const months = Math.floor(days / 30)
  if (months < 12) return `${prefix}${Math.max(1, months)}mo`

  const years = Math.floor(days / 365)
  return `${prefix}${Math.max(1, years)}y`
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

function SidebarSessionTime({
  value,
  className,
  ...props
}: { value?: string } & React.ComponentProps<"span">) {
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

  return (
    <span className={cn("tabular-nums", className)} {...props}>
      {label}
    </span>
  )
}

function directoryOrderEqual(left: Array<string>, right: Array<string>) {
  return (
    left.length === right.length &&
    left.every((directory, index) => directory === right[index])
  )
}

type CollapsedDirectoryState = Record<string, boolean>

type CollapsedDirectoryStore = PicoStore<CollapsedDirectoryState> & {
  loadStored: () => void
  toggle: (directory: string) => void
  setCollapsed: (directory: string, collapsed: boolean) => void
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
  const store = createPicoStore<CollapsedDirectoryState>(
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
      store.setCollapsed(directory, !store.state[directory])
    },
    setCollapsed(directory, collapsed) {
      setStoreState(store, (current) => {
        const currentlyCollapsed = Boolean(current[directory])
        if (currentlyCollapsed === collapsed) return current
        const next = { ...current }
        if (collapsed) {
          next[directory] = true
        } else {
          delete next[directory]
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
    keyof PicoStore<CollapsedDirectoryState>
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
  pinnedSessionKeys: Array<string>
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
  onMoveSession?: (entry: SessionListEntry, directory: string) => void
  onMoveSessionAnyDirectory?: (entry: SessionListEntry) => void
  onTogglePinnedSession?: (entry: SessionListEntry) => void
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
  } = useSortable({
    id,
    data: { type: "directory", directory: id },
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      {children({
        attributes: disabled
          ? {}
          : (attributes as unknown as Record<string, unknown>),
        listeners: disabled
          ? {}
          : (listeners as unknown as Record<string, unknown>),
        isDragging: disabled ? false : isDragging,
      })}
    </div>
  )
}

type SelectedSessionKeyStore = PicoStore<ReadonlySet<string>> & {
  setKeys: (keys: Array<string>) => void
}

type ActiveSidebarSessionState = {
  sessionId: string
  sessionKey: string
}

type ActiveSidebarSessionStore = PicoStore<ActiveSidebarSessionState> & {
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
  const store = createPicoStore<ReadonlySet<string>>(
    new Set(),
    sameStringSet
  ) as SelectedSessionKeyStore

  Object.assign(store, {
    setKeys(keys) {
      setStoreState(store, new Set(keys.filter(Boolean)))
    },
  } satisfies Omit<
    SelectedSessionKeyStore,
    keyof PicoStore<ReadonlySet<string>>
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
  const store = createPicoStore<ActiveSidebarSessionState>({
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
    keyof PicoStore<ActiveSidebarSessionState>
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
  isPinned: boolean
  isMobile: boolean
  overlay: boolean
  moveTargetDirectories: Array<string>
  setOpenMobile: (open: boolean) => void
  onSessionClick?: (
    entry: SessionListEntry,
    modifiers: SessionClickModifiers
  ) => void
  onRenameSession?: (entry: SessionListEntry) => void
  onDeleteSession?: (entry: SessionListEntry) => void
  onMoveSession?: (entry: SessionListEntry, directory: string) => void
  onMoveSessionAnyDirectory?: (entry: SessionListEntry) => void
  onTogglePinnedSession?: (entry: SessionListEntry) => void
}

function SidebarSessionItem({
  entryKey,
  directorySessionsStore,
  activeSessionStore,
  selectedSessionKeyStore,
  isPinned,
  isMobile,
  overlay,
  moveTargetDirectories,
  setOpenMobile,
  onSessionClick,
  onRenameSession,
  onDeleteSession,
  onMoveSession,
  onMoveSessionAnyDirectory,
  onTogglePinnedSession,
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
  const draggable = useDraggable({
    id: `session:${entryKey}`,
    disabled: isMobile || overlay || !entry?.path,
    data: {
      type: "session",
      entry,
      entryKey,
      sourceDirectory: entry?.cwd || "",
    },
  })

  if (!entry) return null
  const timestamp =
    entry.lastMessageAt || entry.modified || entry.lastUserMessageAt
  const hasTimestamp = isValidSidebarTimestamp(timestamp)
  const lastMessagePreview = entry.lastMessagePreview?.trim() || ""
  const pinnedDirectoryLabel = isPinned
    ? formatDisplayPath(entry.cwd?.trim() || entry.path?.trim() || "")
    : ""
  const exactTimestamp =
    hasTimestamp && timestamp ? new Date(timestamp).toLocaleString() : undefined
  const showUnread = Boolean(entry.unread) && !entry.streaming
  const availableMoveTargetDirectories = moveTargetDirectories.filter(
    (directory) => directory && directory !== entry.cwd
  )
  const canMoveAnyDirectory = Boolean(entry.path && onMoveSessionAnyDirectory)
  const hasMoveTargets =
    Boolean(entry.path && onMoveSession) &&
    availableMoveTargetDirectories.length > 0
  const hasMoveActions = hasMoveTargets || canMoveAnyDirectory
  const hasSessionActions =
    Boolean(
      onTogglePinnedSession ||
      (entry.path && (onRenameSession || onDeleteSession)) ||
      hasMoveActions
    ) && !overlay

  const sessionButton = (
    <SidebarMenuButton
      type="button"
      data-sidebar-session-item
      data-session-key={entryKey}
      isActive={isActive || isSelected}
      className={cn(
        "relative h-auto min-w-0 items-start gap-2 py-2 pr-2 pl-8 not-data-active:hover:bg-transparent! not-data-active:hover:text-sidebar-foreground! not-data-active:data-open:hover:bg-transparent! not-data-active:data-open:hover:text-sidebar-foreground!",
        (isActive || isSelected) &&
          "bg-sidebar-accent text-sidebar-accent-foreground"
      )}
      onClick={(event) => {
        onSessionClick?.(entry, {
          multiSelectKey: isSidebarMultiSelectModifier(event),
          shiftKey: event.shiftKey,
        })
        if (isMobile) {
          setOpenMobile(false)
        }
      }}
    >
      {entry.streaming ? (
        <span className="absolute top-2.5 left-2 flex size-4 items-center justify-center">
          <Spinner className="size-3.5" aria-label="Session streaming" />
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
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate pr-16 font-medium">
              {entry.title}
            </span>
          </span>
          {lastMessagePreview ? (
            <span className="min-w-0 truncate text-[11px] font-normal text-sidebar-foreground/50">
              {lastMessagePreview}
            </span>
          ) : null}
          {pinnedDirectoryLabel ? (
            <span className="min-w-0 truncate text-[11px] font-normal text-sidebar-foreground/50">
              {pinnedDirectoryLabel}
            </span>
          ) : null}
        </span>
      </span>
    </SidebarMenuButton>
  )

  const sessionTrailingControls = hasTimestamp ? (
    <span className="absolute top-2.5 right-2 z-10 flex min-w-4 items-center justify-end">
      <TitleTooltip
        title={isMobile ? undefined : exactTimestamp}
        side="right"
        align="center"
      >
        <SidebarSessionTime
          value={timestamp}
          className="shrink-0 text-[11px] font-normal text-sidebar-foreground/50"
        />
      </TitleTooltip>
    </span>
  ) : null

  const sessionRow = (
    <div
      ref={draggable.setNodeRef}
      className={cn(
        "group/session relative",
        draggable.isDragging && !overlay && "opacity-40"
      )}
      style={{
        transform: CSS.Translate.toString(draggable.transform),
      }}
      {...draggable.attributes}
      {...draggable.listeners}
    >
      {sessionButton}
      {sessionTrailingControls}
    </div>
  )

  return (
    <SidebarMenuItem>
      {hasSessionActions ? (
        <ContextMenu>
          <ContextMenuTrigger render={sessionRow} />
          <ContextMenuContent className="w-44">
            {onTogglePinnedSession ? (
              <ContextMenuItem onClick={() => onTogglePinnedSession(entry)}>
                {isPinned ? "Unpin" : "Pin to sidebar"}
              </ContextMenuItem>
            ) : null}
            {hasMoveActions ? (
              <ContextMenuSub>
                <ContextMenuSubTrigger>Move to…</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-72">
                  {availableMoveTargetDirectories.map((directory) => (
                    <ContextMenuItem
                      key={directory}
                      onClick={() => onMoveSession?.(entry, directory)}
                    >
                      <span className="truncate">
                        {formatDisplayPath(directory)}
                      </span>
                    </ContextMenuItem>
                  ))}
                  {canMoveAnyDirectory ? (
                    <ContextMenuItem
                      onClick={() => onMoveSessionAnyDirectory?.(entry)}
                    >
                      Other directory…
                    </ContextMenuItem>
                  ) : null}
                </ContextMenuSubContent>
              </ContextMenuSub>
            ) : null}
            {onRenameSession && entry.path ? (
              <ContextMenuItem onClick={() => onRenameSession(entry)}>
                Rename
              </ContextMenuItem>
            ) : null}
            {onDeleteSession && entry.path ? (
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
        sessionRow
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

export type DirectorySessionsStore = PicoStore<DirectorySessionsState> & {
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
    left.lastMessageAt === right.lastMessageAt &&
    left.lastMessagePreview === right.lastMessagePreview &&
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
    sessionKeysByDirectory[directory] = sessions.flatMap((entry) => {
      const key = sessionListEntryKey(entry)
      return key ? [key] : []
    })
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
  const store = createPicoStore<DirectorySessionsState>(
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
    keyof PicoStore<DirectorySessionsState>
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
  moveTargetDirectories: Array<string>
  activeSessionStore: ActiveSidebarSessionStore
  selectedSessionKeyStore: SelectedSessionKeyStore
  pinnedSessionKeys: Array<string>
  isMobile: boolean
  setOpenMobile: (open: boolean) => void
  isDragging?: boolean
  isSessionDropTarget?: boolean
  overlay?: boolean
  attributes?: Record<string, unknown>
  listeners?: Record<string, unknown>
  onSessionClick?: (
    entry: SessionListEntry,
    modifiers: SessionClickModifiers
  ) => void
  onRenameSession?: (entry: SessionListEntry) => void
  onDeleteSession?: (entry: SessionListEntry) => void
  onMoveSession?: (entry: SessionListEntry, directory: string) => void
  onMoveSessionAnyDirectory?: (entry: SessionListEntry) => void
  onTogglePinnedSession?: (entry: SessionListEntry) => void
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
  moveTargetDirectories,
  activeSessionStore,
  selectedSessionKeyStore,
  pinnedSessionKeys,
  isMobile,
  setOpenMobile,
  isDragging,
  isSessionDropTarget,
  overlay = false,
  attributes,
  listeners,
  onSessionClick,
  onRenameSession,
  onDeleteSession,
  onMoveSession,
  onMoveSessionAnyDirectory,
  onTogglePinnedSession,
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
  const pinnedSessionKeySet = new Set(pinnedSessionKeys)
  const unpinnedSessionKeys = sessionKeys.filter(
    (entryKey) => !pinnedSessionKeySet.has(entryKey)
  )
  const visibleCount = searchActive
    ? unpinnedSessionKeys.length
    : Math.min(unpinnedSessionKeys.length, renderCount)
  const visibleSessionKeys = unpinnedSessionKeys.slice(0, visibleCount)
  const hasMoreSessions = visibleCount < unpinnedSessionKeys.length
  const showLoadingSpinner = useDelayedTrue(
    isLoadingSessions,
    SIDEBAR_LOADING_SPINNER_DELAY_MS
  )
  const showLoadingState = isLoadingSessions && sessionKeys.length === 0
  const showHeaderLoadingSpinner =
    showLoadingSpinner && unpinnedSessionKeys.length === 0 && collapsed
  const hasDirectoryActions =
    !overlay &&
    Boolean(
      onCreateSessionInDirectory ||
      onDeleteOldSessionsInDirectory ||
      onRemoveDirectory
    )

  const directoryHeader = (
    <div className="flex items-center gap-2 rounded-lg">
      <CollapsibleTrigger
        type="button"
        className={cn(
          "group/directory-label flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-sidebar-foreground",
          directoryOrderingEnabled &&
            !overlay &&
            "cursor-grab active:cursor-grabbing",
          searchActive && "cursor-default"
        )}
        disabled={searchActive || overlay}
        {...(attributes ?? {})}
        {...(listeners ?? {})}
      >
        <FolderIcon className="size-4 shrink-0 text-sidebar-foreground/50" />
        <span className="max-w-full min-w-0">
          <DirectoryPathLabel path={directory} />
        </span>
        {!searchActive && !overlay ? (
          collapsed ? (
            <ChevronRightIcon className="size-4 shrink-0 opacity-0 transition-opacity group-hover/directory-label:opacity-100 group-focus-visible/directory-label:opacity-100" />
          ) : (
            <ChevronDownIcon className="size-4 shrink-0 opacity-0 transition-opacity group-hover/directory-label:opacity-100 group-focus-visible/directory-label:opacity-100" />
          )
        ) : null}
        {showHeaderLoadingSpinner ? (
          <Spinner className="size-3.5 shrink-0" />
        ) : null}
      </CollapsibleTrigger>

      {onCreateSessionInDirectory && !overlay && !isMobile ? (
        <TitleTooltip title={`Create a session in ${directory}`}>
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            onClick={() => onCreateSessionInDirectory(directory)}
          >
            <SquarePenIcon className="size-4" />
          </Button>
        </TitleTooltip>
      ) : null}

      {hasDirectoryActions && isMobile ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                aria-label={`Directory actions for ${directory}`}
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
    <Collapsible
      open={!collapsed}
      onOpenChange={(open) => {
        if (searchActive || overlay) return
        collapsedDirectoryStore.setCollapsed(directory, !open)
      }}
      className={cn(
        "rounded-lg py-1",
        overlay && "bg-sidebar shadow-lg ring-1 ring-sidebar-border/70",
        isSessionDropTarget &&
          !overlay &&
          "bg-sidebar-accent/40 ring-1 ring-sidebar-ring/50",
        isDragging && !overlay && "opacity-0"
      )}
    >
      <SidebarGroup className="py-0">
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

        {!overlay ? (
          <CollapsibleContent>
            <SidebarGroupContent>
              {showLoadingState ? (
                <div className="flex items-center gap-2 p-2 text-sm text-sidebar-foreground/70">
                  {showLoadingSpinner ? (
                    <Spinner />
                  ) : (
                    <span className="size-4" aria-hidden="true" />
                  )}
                  Loading sessions…
                </div>
              ) : unpinnedSessionKeys.length > 0 ? (
                <div className="flex flex-col">
                  <SidebarMenu>
                    {visibleSessionKeys.map((entryKey) => (
                      <SidebarSessionItem
                        key={entryKey}
                        entryKey={entryKey}
                        directorySessionsStore={directorySessionsStore}
                        activeSessionStore={activeSessionStore}
                        selectedSessionKeyStore={selectedSessionKeyStore}
                        isPinned={pinnedSessionKeys.includes(entryKey)}
                        isMobile={isMobile}
                        overlay={overlay}
                        moveTargetDirectories={moveTargetDirectories}
                        setOpenMobile={setOpenMobile}
                        onSessionClick={onSessionClick}
                        onRenameSession={onRenameSession}
                        onDeleteSession={onDeleteSession}
                        onMoveSession={onMoveSession}
                        onMoveSessionAnyDirectory={onMoveSessionAnyDirectory}
                        onTogglePinnedSession={onTogglePinnedSession}
                      />
                    ))}
                  </SidebarMenu>

                  {hasMoreSessions ? (
                    <Button
                      variant="ghost"
                      className="h-8 justify-start pl-8 text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                      onClick={() => {
                        setRenderCount((current) =>
                          Math.min(
                            unpinnedSessionKeys.length,
                            current + DIRECTORY_SESSION_LOAD_MORE_COUNT
                          )
                        )
                      }}
                    >
                      Show{" "}
                      {Math.min(
                        DIRECTORY_SESSION_LOAD_MORE_COUNT,
                        unpinnedSessionKeys.length - visibleCount
                      )}{" "}
                      more
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="p-2 text-sm text-sidebar-foreground/70">
                  {searchActive
                    ? "No matching unpinned sessions."
                    : "No unpinned sessions."}
                </div>
              )}
            </SidebarGroupContent>
          </CollapsibleContent>
        ) : null}
      </SidebarGroup>
    </Collapsible>
  )
})

type PinnedSessionGroupProps = {
  pinnedSessionKeys: Array<string>
  directorySessionsStore: DirectorySessionsStore
  collapsedDirectoryStore: CollapsedDirectoryStore
  searchActive: boolean
  activeSessionStore: ActiveSidebarSessionStore
  selectedSessionKeyStore: SelectedSessionKeyStore
  isMobile: boolean
  moveTargetDirectories: Array<string>
  setOpenMobile: (open: boolean) => void
  onSessionClick?: (
    entry: SessionListEntry,
    modifiers: SessionClickModifiers
  ) => void
  onRenameSession?: (entry: SessionListEntry) => void
  onDeleteSession?: (entry: SessionListEntry) => void
  onMoveSession?: (entry: SessionListEntry, directory: string) => void
  onMoveSessionAnyDirectory?: (entry: SessionListEntry) => void
  onTogglePinnedSession?: (entry: SessionListEntry) => void
}

function PinnedSessionGroup({
  pinnedSessionKeys,
  directorySessionsStore,
  collapsedDirectoryStore,
  searchActive,
  activeSessionStore,
  selectedSessionKeyStore,
  isMobile,
  moveTargetDirectories,
  setOpenMobile,
  onSessionClick,
  onRenameSession,
  onDeleteSession,
  onMoveSession,
  onMoveSessionAnyDirectory,
  onTogglePinnedSession,
}: PinnedSessionGroupProps) {
  const collapsed = useDirectoryCollapsed(
    collapsedDirectoryStore,
    PINNED_SESSION_GROUP_COLLAPSE_KEY,
    searchActive
  )

  if (pinnedSessionKeys.length === 0) return null

  return (
    <Collapsible
      open={!collapsed}
      onOpenChange={(open) => {
        if (searchActive) return
        collapsedDirectoryStore.setCollapsed(
          PINNED_SESSION_GROUP_COLLAPSE_KEY,
          !open
        )
      }}
    >
      <SidebarGroup className="py-1">
        <SidebarGroupLabel
          render={
            <CollapsibleTrigger className="group/pinned-label justify-between gap-3" />
          }
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <span className="min-w-0 truncate">Pinned</span>
            {!searchActive ? (
              collapsed ? (
                <ChevronRightIcon className="size-4 shrink-0 opacity-0 transition-opacity group-hover/pinned-label:opacity-100 group-focus-visible/pinned-label:opacity-100" />
              ) : (
                <ChevronDownIcon className="size-4 shrink-0 opacity-0 transition-opacity group-hover/pinned-label:opacity-100 group-focus-visible/pinned-label:opacity-100" />
              )
            ) : null}
          </span>
          <span className="text-[11px] font-normal text-sidebar-foreground/50">
            {pinnedSessionKeys.length}
          </span>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {pinnedSessionKeys.map((entryKey) => (
                <SidebarSessionItem
                  key={entryKey}
                  entryKey={entryKey}
                  directorySessionsStore={directorySessionsStore}
                  activeSessionStore={activeSessionStore}
                  selectedSessionKeyStore={selectedSessionKeyStore}
                  isPinned
                  isMobile={isMobile}
                  overlay={false}
                  moveTargetDirectories={moveTargetDirectories}
                  setOpenMobile={setOpenMobile}
                  onSessionClick={onSessionClick}
                  onRenameSession={onRenameSession}
                  onDeleteSession={onDeleteSession}
                  onMoveSession={onMoveSession}
                  onMoveSessionAnyDirectory={onMoveSessionAnyDirectory}
                  onTogglePinnedSession={onTogglePinnedSession}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

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

  const tooltipTitle = allDirectoriesCollapsed
    ? "Expand all directories"
    : "Collapse all directories"

  return (
    <TitleTooltip title={tooltipTitle}>
      <Button
        size="icon"
        variant="ghost"
        className="text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
        disabled={searchActive || visibleDirectories.length === 0}
        onClick={() => {
          collapsedDirectoryStore.setAll(
            visibleDirectories,
            !allDirectoriesCollapsed
          )
        }}
        aria-label={tooltipTitle}
      >
        {allDirectoriesCollapsed ? <ChevronsUpDown /> : <ChevronsDownUpIcon />}
      </Button>
    </TitleTooltip>
  )
}

type AppSidebarHeaderProps = {
  onOpenSessionsDialog: () => void
  onCreateSession: () => void
}

function AppSidebarHeader({
  onOpenSessionsDialog,
  onCreateSession,
}: AppSidebarHeaderProps) {
  return (
    <SidebarHeader className="gap-2 border-b border-sidebar-border/70">
      <SidebarMenu className="gap-1">
        <SidebarMenuItem>
          <SidebarMenuButton type="button" onClick={onOpenSessionsDialog}>
            <SearchIcon />
            <span>Search sessions…</span>
            <span className="ml-auto hidden items-center md:flex">
              <Kbd>{formatShortcutLabel("Control+S")}</Kbd>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton type="button" onClick={onCreateSession}>
            <SquarePenIcon />
            <span>New session</span>
            <span className="ml-auto hidden items-center md:flex">
              <Kbd>{formatShortcutLabel("Control+N")}</Kbd>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  )
}

type AppSidebarDirectoriesHeaderProps = {
  sessionSearch: string
  visibleDirectories: Array<string>
  matchingSessionCount: number
  collapsed: boolean
  collapsedDirectoryStore: CollapsedDirectoryStore
  onOpenAddDirectoryDialog: () => void
}

function AppSidebarDirectoriesHeader({
  sessionSearch,
  visibleDirectories,
  matchingSessionCount,
  collapsed,
  collapsedDirectoryStore,
  onOpenAddDirectoryDialog,
}: AppSidebarDirectoriesHeaderProps) {
  const searchActive = sessionSearch.trim().length > 0

  return (
    <SidebarGroupLabel className="justify-between gap-3">
      <CollapsibleTrigger
        type="button"
        className="group/directories-label flex min-w-0 flex-1 items-center gap-2 text-left outline-hidden"
      >
        <span className="min-w-0 truncate">
          {searchActive
            ? `${matchingSessionCount} matching session${matchingSessionCount === 1 ? "" : "s"}`
            : "Directories"}
        </span>
        {!searchActive ? (
          collapsed ? (
            <ChevronRightIcon className="size-4 shrink-0 text-sidebar-foreground/60" />
          ) : (
            <ChevronDownIcon className="size-4 shrink-0 text-sidebar-foreground/60" />
          )
        ) : null}
      </CollapsibleTrigger>
      <span className="flex items-center gap-1">
        {!collapsed ? (
          <DirectoryCollapseAllButton
            searchActive={searchActive}
            visibleDirectories={visibleDirectories}
            collapsedDirectoryStore={collapsedDirectoryStore}
          />
        ) : null}
        <TitleTooltip
          title="Add directory"
          kbd={formatShortcutLabel("Control+D")}
        >
          <Button
            variant="ghost"
            size="icon"
            className="hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            onClick={onOpenAddDirectoryDialog}
            aria-label="Add directory"
          >
            <FolderPlusIcon />
          </Button>
        </TitleTooltip>
      </span>
    </SidebarGroupLabel>
  )
}

export function AppSidebar(props: AppSidebarProps) {
  return useAppSidebarView(props)
}

function useAppSidebarView({
  sessionSearch,
  onOpenSessionsDialog,
  visibleDirectories,
  directorySessionsStore,
  matchingSessionCount,
  selectedSessionKeys,
  activeSessionId,
  activeSessionKey,
  pinnedSessionKeys,
  emptyStateText,
  onCreateSession,
  onOpenAddDirectoryDialog,
  onOpenCommandPalette,
  onOpenSettings,
  onSessionClick,
  onRenameSession,
  onDeleteSession,
  onMoveSession,
  onMoveSessionAnyDirectory,
  onTogglePinnedSession,
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
  const [activeSessionDrag, setActiveSessionDrag] = React.useState<{
    entryKey: string
    entry: SessionListEntry
    sourceDirectory: string
  } | null>(null)
  const [sessionDropDirectory, setSessionDropDirectory] = React.useState<
    string | null
  >(null)
  const [previewDirectoryOrder, setPreviewDirectoryOrder] =
    React.useState<Array<string> | null>(null)
  const [collapsedDirectoryStore] = React.useState(
    createCollapsedDirectoryStore
  )
  const [selectedSessionKeyStore] = React.useState(
    createSelectedSessionKeyStore
  )
  const [activeSessionStore] = React.useState(createActiveSidebarSessionStore)
  const directoriesCollapsed = useDirectoryCollapsed(
    collapsedDirectoryStore,
    DIRECTORIES_SESSION_GROUP_COLLAPSE_KEY,
    searchActive
  )

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
    const activeData = event.active.data.current as
      | {
          type?: string
          entry?: SessionListEntry
          entryKey?: string
          sourceDirectory?: string
        }
      | undefined

    if (activeData?.type === "session" && activeData.entry) {
      if (isMobile) return
      setActiveSessionDrag({
        entryKey: activeData.entryKey || String(event.active.id),
        entry: activeData.entry,
        sourceDirectory:
          activeData.sourceDirectory || activeData.entry.cwd || "",
      })
      setSessionDropDirectory(null)
      return
    }

    if (activeData?.type !== "directory" || !directoryOrderingEnabled) return
    setActiveDirectory(String(event.active.id))
    setPreviewDirectoryOrder(visibleDirectories)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const activeData = event.active.data.current as
      | { type?: string; sourceDirectory?: string }
      | undefined
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : ""

    if (activeData?.type === "session") {
      if (isMobile) return
      const overDirectory = visibleDirectories.includes(overId) ? overId : ""
      setSessionDropDirectory(
        overDirectory && overDirectory !== activeData.sourceDirectory
          ? overDirectory
          : null
      )
      return
    }

    if (!directoryOrderingEnabled) return
    if (!activeId || !overId || activeId === overId) return
    movePreviewDirectory(activeId, overId)
  }

  const handleDragCancel = () => {
    setActiveDirectory(null)
    setActiveSessionDrag(null)
    setSessionDropDirectory(null)
    setPreviewDirectoryOrder(null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const activeData = event.active.data.current as
      | { type?: string; entry?: SessionListEntry; sourceDirectory?: string }
      | undefined
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : ""

    if (activeData?.type === "session") {
      if (isMobile) {
        setActiveSessionDrag(null)
        setSessionDropDirectory(null)
        return
      }
      const targetDirectory = visibleDirectories.includes(overId) ? overId : ""
      if (
        activeData.entry &&
        targetDirectory &&
        targetDirectory !== activeData.sourceDirectory
      ) {
        onMoveSession?.(activeData.entry, targetDirectory)
      }
      setActiveSessionDrag(null)
      setSessionDropDirectory(null)
      return
    }

    let nextOrder = previewDirectoryOrder
    if (
      directoryOrderingEnabled &&
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
      className="top-[var(--header-height)] !h-[calc(100svh_-_var(--header-height))] border-r border-sidebar-border/70"
    >
      <AppSidebarHeader
        onOpenSessionsDialog={onOpenSessionsDialog}
        onCreateSession={onCreateSession}
      />

      <SidebarContent>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <PinnedSessionGroup
            pinnedSessionKeys={pinnedSessionKeys}
            directorySessionsStore={directorySessionsStore}
            collapsedDirectoryStore={collapsedDirectoryStore}
            searchActive={searchActive}
            activeSessionStore={activeSessionStore}
            selectedSessionKeyStore={selectedSessionKeyStore}
            isMobile={isMobile}
            moveTargetDirectories={visibleDirectories}
            setOpenMobile={setOpenMobile}
            onSessionClick={onSessionClick}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
            onMoveSession={onMoveSession}
            onTogglePinnedSession={onTogglePinnedSession}
          />
          <Collapsible
            open={!directoriesCollapsed}
            onOpenChange={(open) => {
              if (searchActive) return
              collapsedDirectoryStore.setCollapsed(
                DIRECTORIES_SESSION_GROUP_COLLAPSE_KEY,
                !open
              )
            }}
          >
            <SidebarGroup className="py-1">
              <AppSidebarDirectoriesHeader
                sessionSearch={sessionSearch}
                visibleDirectories={visibleDirectories}
                matchingSessionCount={matchingSessionCount}
                collapsed={directoriesCollapsed}
                collapsedDirectoryStore={collapsedDirectoryStore}
                onOpenAddDirectoryDialog={onOpenAddDirectoryDialog}
              />
              <CollapsibleContent>
                <SidebarGroupContent>
                  {visibleDirectories.length === 0 ? (
                    <div className="p-2">
                      <Empty className="rounded-xl border border-dashed bg-sidebar-accent/10 py-10">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <FolderIcon />
                          </EmptyMedia>
                          <EmptyTitle>{emptyStateText}</EmptyTitle>
                        </EmptyHeader>
                      </Empty>
                    </div>
                  ) : (
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
                                collapsedDirectoryStore={
                                  collapsedDirectoryStore
                                }
                                searchActive={searchActive}
                                directoryOrderingEnabled={
                                  directoryOrderingEnabled
                                }
                                moveTargetDirectories={visibleDirectories}
                                activeSessionStore={activeSessionStore}
                                selectedSessionKeyStore={
                                  selectedSessionKeyStore
                                }
                                pinnedSessionKeys={pinnedSessionKeys}
                                isMobile={isMobile}
                                setOpenMobile={setOpenMobile}
                                isDragging={isDragging}
                                isSessionDropTarget={
                                  sessionDropDirectory === directory
                                }
                                attributes={attributes}
                                listeners={listeners}
                                onSessionClick={onSessionClick}
                                onRenameSession={onRenameSession}
                                onDeleteSession={onDeleteSession}
                                onMoveSession={onMoveSession}
                                onMoveSessionAnyDirectory={
                                  onMoveSessionAnyDirectory
                                }
                                onTogglePinnedSession={onTogglePinnedSession}
                                onCreateSessionInDirectory={
                                  onCreateSessionInDirectory
                                }
                                onDeleteOldSessionsInDirectory={
                                  onDeleteOldSessionsInDirectory
                                }
                                onRemoveDirectory={
                                  onRemoveDirectory
                                    ? removeDirectory
                                    : undefined
                                }
                              />
                            )}
                          </SortableDirectoryGroup>
                        )
                      })}
                    </SortableContext>
                  )}
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>

          <DragOverlay>
            {activeDirectory ? (
              <DirectorySessionGroup
                directory={activeDirectory}
                directorySessionsStore={directorySessionsStore}
                collapsedDirectoryStore={collapsedDirectoryStore}
                searchActive={searchActive}
                directoryOrderingEnabled={directoryOrderingEnabled}
                moveTargetDirectories={visibleDirectories}
                activeSessionStore={activeSessionStore}
                selectedSessionKeyStore={selectedSessionKeyStore}
                pinnedSessionKeys={pinnedSessionKeys}
                isMobile={isMobile}
                setOpenMobile={setOpenMobile}
                overlay
                onSessionClick={onSessionClick}
                onRenameSession={onRenameSession}
                onDeleteSession={onDeleteSession}
                onMoveSession={onMoveSession}
                onMoveSessionAnyDirectory={onMoveSessionAnyDirectory}
                onTogglePinnedSession={onTogglePinnedSession}
                onCreateSessionInDirectory={onCreateSessionInDirectory}
                onDeleteOldSessionsInDirectory={onDeleteOldSessionsInDirectory}
                onRemoveDirectory={
                  onRemoveDirectory ? removeDirectory : undefined
                }
              />
            ) : activeSessionDrag ? (
              <SidebarMenu className="w-64 rounded-lg bg-sidebar p-1 shadow-lg ring-1 ring-sidebar-border/70">
                <SidebarSessionItem
                  entryKey={activeSessionDrag.entryKey}
                  directorySessionsStore={directorySessionsStore}
                  activeSessionStore={activeSessionStore}
                  selectedSessionKeyStore={selectedSessionKeyStore}
                  isPinned={pinnedSessionKeys.includes(
                    activeSessionDrag.entryKey
                  )}
                  isMobile={isMobile}
                  overlay
                  moveTargetDirectories={visibleDirectories}
                  setOpenMobile={setOpenMobile}
                  onSessionClick={onSessionClick}
                  onRenameSession={onRenameSession}
                  onDeleteSession={onDeleteSession}
                  onMoveSession={onMoveSession}
                  onMoveSessionAnyDirectory={onMoveSessionAnyDirectory}
                  onTogglePinnedSession={onTogglePinnedSession}
                />
              </SidebarMenu>
            ) : null}
          </DragOverlay>
        </DndContext>
      </SidebarContent>

      <SidebarFooter className="gap-2 border-t border-sidebar-border/70">
        <SidebarMenu className="gap-1">
          <SidebarMenuItem>
            <SidebarMenuButton type="button" onClick={onOpenCommandPalette}>
              <CommandIcon />
              <span>Commands</span>
              <span className="ml-auto hidden items-center md:flex">
                <Kbd>{formatShortcutLabel("Control+K")}</Kbd>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton type="button" onClick={onOpenSettings}>
              <Settings2Icon />
              <span>Settings</span>
              <span className="ml-auto hidden items-center md:flex">
                <Kbd>{formatShortcutLabel("Control+,")}</Kbd>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
