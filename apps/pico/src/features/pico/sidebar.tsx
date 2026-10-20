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
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDown,
  EllipsisVerticalIcon,
  FolderIcon,
  FolderPlusIcon,
  GitForkIcon,
  MessageCircleQuestionIcon,
  PinIcon,
  SearchIcon,
  SquarePenIcon,
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
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { Kbd } from "@/components/ui/kbd"
import { useShowSessionPreviews } from "@/features/pico/sidebar-display-settings"
import { Spinner } from "@/components/ui/spinner"
import {
  COLLAPSED_DIRECTORIES_STORAGE_KEY,
  DIRECTORY_SESSION_LOAD_MORE_COUNT,
  INITIAL_DIRECTORY_SESSION_RENDER_COUNT,
  PINNED_SESSIONS_STORAGE_KEY,
  readStoredCollapsedDirectories,
  readStoredPinnedSessionKeys,
  machineLocalStorageSetItem,
  sessionListEntryKey,
} from "@/lib/pico"
import { usePicoEvent } from "@/features/pico/agent/events"
import {
  isMachineSessionUnread,
  SidebarMachineGroups,
  useHasMachineGroups,
} from "@/features/pico/machines"
import {
  viewerContextIdForSummaries,
  type MachineInfo,
  type MachineSessionSummary,
} from "@/features/pico/machine-store"
import {
  OtherMachineArchiveDialog,
  OtherMachineRenameDialog,
} from "@/features/pico/other-machine-session-dialogs"
import { startSidebarSync } from "@/features/pico/sidebar-sync"
import {
  openMachine,
  openSession as openMachineSession,
} from "@/lib/pico/machine"
import {
  formatDisplayPath,
  formatFolderName,
} from "@/features/pico/app-shell-common"
import {
  appShortcut,
  formatShortcutLabel,
} from "@/features/pico/keyboard-shortcuts"
import {
  createPicoStore,
  setStoreState,
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import { cn } from "@/lib/utils"
import { useMachineId } from "@/lib/pico/machine-context"

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

function DirectoryPathLabel({ path }: { path: string }) {
  const folderName = formatFolderName(path) || path

  return (
    <span className="block min-w-0 truncate text-sm font-medium text-sidebar-foreground">
      {folderName}
    </span>
  )
}

type SessionClickModifiers = {
  multiSelectKey: boolean
  shiftKey: boolean
}

const EMPTY_DIRECTORY_SESSION_KEYS: Array<string> = []

// One shared set of window listeners tracks whether Option (Alt) is held.
let altKeyHeldSnapshot = false
const altKeyHeldListeners = new Set<() => void>()

function setAltKeyHeld(next: boolean) {
  if (altKeyHeldSnapshot === next) return
  altKeyHeldSnapshot = next
  for (const listener of altKeyHeldListeners) listener()
}

function handleAltKeyEvent(event: KeyboardEvent) {
  setAltKeyHeld(event.altKey)
}

function handleAltKeyReset() {
  setAltKeyHeld(false)
}

function subscribeAltKeyHeld(listener: () => void) {
  if (altKeyHeldListeners.size === 0) {
    window.addEventListener("keydown", handleAltKeyEvent)
    window.addEventListener("keyup", handleAltKeyEvent)
    window.addEventListener("blur", handleAltKeyReset)
  }
  altKeyHeldListeners.add(listener)
  return () => {
    altKeyHeldListeners.delete(listener)
    if (altKeyHeldListeners.size === 0) {
      window.removeEventListener("keydown", handleAltKeyEvent)
      window.removeEventListener("keyup", handleAltKeyEvent)
      window.removeEventListener("blur", handleAltKeyReset)
      altKeyHeldSnapshot = false
    }
  }
}

function useAltKeyHeld() {
  return React.useSyncExternalStore(
    subscribeAltKeyHeld,
    () => altKeyHeldSnapshot,
    () => false
  )
}
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

function createCollapsedDirectoryStore(
  machineId: string,
  storageKey = COLLAPSED_DIRECTORIES_STORAGE_KEY
): CollapsedDirectoryStore {
  const store = createPicoStore<CollapsedDirectoryState>(
    {},
    sameCollapsedDirectoryState
  ) as CollapsedDirectoryStore

  const persist = () => {
    machineLocalStorageSetItem(
      machineId,
      storageKey,
      JSON.stringify(store.state)
    )
  }

  Object.assign(store, {
    loadStored() {
      setStoreState(
        store,
        readStoredCollapsedDirectories(machineId, storageKey)
      )
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
  onOpenAddDirectoryDialog: () => void
  onSessionClick?: (
    entry: SessionListEntry,
    modifiers: SessionClickModifiers
  ) => void
  onRenameSession?: (entry: SessionListEntry) => void
  onDeleteSession?: (entry: SessionListEntry) => void
  onSetSessionUnread?: (entry: SessionListEntry, unread: boolean) => void
  onMoveSession?: (entry: SessionListEntry, directory: string) => void
  onMoveSessionAnyDirectory?: (entry: SessionListEntry) => void
  onTogglePinnedSession?: (entry: SessionListEntry) => void
  onCreateSessionInDirectory?: (directory: string) => void
  onDeleteOldSessionsInDirectory?: (directory: string) => void
  onMarkSessionsRead?: (entries: Array<SessionListEntry>) => void
  onRemoveDirectory?: (directory: string) => void
  onReorderDirectories?: (nextDirectories: Array<string>) => void
  onOpenArchivedSessions?: () => void
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
  /** The row is in a directory or the pinned group, under its line. */
  inDirectory?: boolean
  directorySessionsStore: DirectorySessionsStore
  activeSessionStore: ActiveSidebarSessionStore
  selectedSessionKeyStore: SelectedSessionKeyStore
  isPinned: boolean
  isMobile: boolean
  overlay: boolean
  /** False for a session of another machine: it cannot move here. */
  sessionDraggable?: boolean
  moveTargetDirectories: Array<string>
  setOpenMobile: (open: boolean) => void
  onSessionClick?: (
    entry: SessionListEntry,
    modifiers: SessionClickModifiers
  ) => void
  onRenameSession?: (entry: SessionListEntry) => void
  onDeleteSession?: (entry: SessionListEntry) => void
  onSetSessionUnread?: (entry: SessionListEntry, unread: boolean) => void
  onMoveSession?: (entry: SessionListEntry, directory: string) => void
  onMoveSessionAnyDirectory?: (entry: SessionListEntry) => void
  onTogglePinnedSession?: (entry: SessionListEntry) => void
}

function SidebarSessionItem({
  entryKey,
  inDirectory = false,
  directorySessionsStore,
  activeSessionStore,
  selectedSessionKeyStore,
  isPinned,
  isMobile,
  overlay,
  sessionDraggable = true,
  moveTargetDirectories,
  setOpenMobile,
  onSessionClick,
  onRenameSession,
  onDeleteSession,
  onSetSessionUnread,
  onMoveSession,
  onMoveSessionAnyDirectory,
  onTogglePinnedSession,
}: SidebarSessionItemProps) {
  const entry = useDirectorySessionEntry(directorySessionsStore, entryKey)
  const childDepth = useSelector(
    directorySessionsStore,
    (state) => state.depthByKey.get(entryKey) ?? 0
  )
  // A session in a directory is one level in, under the directory's line.
  const nestingDepth = (inDirectory ? 1 : 0) + childDepth
  const isSelected = useSidebarSessionSelected(
    selectedSessionKeyStore,
    entryKey
  )
  const isActive = useSidebarSessionActive(
    activeSessionStore,
    entryKey,
    entry?.id
  )
  const showSessionPreviews = useShowSessionPreviews()
  const dragDisabled = !sessionDraggable || isMobile || overlay || !entry?.path
  const draggable = useDraggable({
    id: `session:${entryKey}`,
    disabled: dragDisabled,
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
  const lastMessagePreview = showSessionPreviews
    ? entry.lastMessagePreview?.trim() || ""
    : ""
  const pinnedDirectoryLabel = isPinned
    ? formatFolderName(entry.cwd?.trim() || entry.path?.trim() || "")
    : ""
  const exactTimestamp =
    hasTimestamp && timestamp ? new Date(timestamp).toLocaleString() : undefined
  const showUnread = Boolean(entry.unread) && !entry.streaming
  const isOptimisticSession = Boolean(
    entry.optimistic || (entry.id?.startsWith("optimistic:") && !entry.path)
  )
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
      (!isOptimisticSession && onTogglePinnedSession) ||
      (entry.path &&
        (onRenameSession || onDeleteSession || onSetSessionUnread)) ||
      hasMoveActions
    ) && !overlay

  const sessionButton = (
    <SidebarMenuButton
      type="button"
      data-sidebar-session-item
      data-session-key={entryKey}
      isActive={isActive || isSelected}
      className={cn(
        "relative h-auto min-w-0 items-start gap-2 py-2 pr-(--sidebar-item-pad) pl-(--session-text-left)",
        (isActive || isSelected) && "text-sidebar-accent-foreground",
        (isActive || isSelected) && nestingDepth === 0 && "bg-sidebar-accent",
        // The hover state uses the whole row (with the trailing controls),
        // so the highlight stays when the pointer is on the timestamp.
        !(isActive || isSelected) &&
          "group-hover/session:text-sidebar-accent-foreground",
        !(isActive || isSelected) &&
          nestingDepth === 0 &&
          "group-hover/session:bg-sidebar-accent/50",
        // A child row draws its highlight in an inset layer, so the tree
        // lines stay clear. The click area stays the full row width.
        nestingDepth > 0 &&
          "isolate not-data-active:hover:bg-transparent! active:bg-transparent! not-data-active:data-open:hover:bg-transparent! data-active:bg-transparent!"
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
      {nestingDepth > 0 ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 left-(--session-highlight-start) -z-10 rounded-md",
            isActive || isSelected
              ? "bg-sidebar-accent"
              : "bg-transparent group-hover/session:bg-sidebar-accent/50"
          )}
        />
      ) : null}
      {entry.needsInput ? (
        <TitleTooltip title="The agent waits for your answer" side="right">
          <span className={SESSION_STATUS_ICON_CLASS}>
            <MessageCircleQuestionIcon
              className="size-3.5 text-amber-500"
              aria-label="The agent waits for your answer"
            />
          </span>
        </TitleTooltip>
      ) : entry.streaming ? (
        <span className={SESSION_STATUS_ICON_CLASS}>
          <Spinner size="sm" aria-label="Session streaming" />
        </span>
      ) : showUnread ? (
        <span className={SESSION_STATUS_ICON_CLASS}>
          <span
            className="size-2 rounded-full bg-primary"
            aria-label="Session done"
          />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">
              {entry.title}
            </span>
            {/* An invisible copy of the timestamp keeps space for the real
                one, which sits on top of the row. */}
            {hasTimestamp ? (
              <SidebarSessionTime
                aria-hidden="true"
                value={timestamp}
                className="invisible shrink-0 text-[11px] font-normal"
              />
            ) : null}
          </span>
          {entry.worktreeBranch ? (
            <span className="flex min-w-0 items-center gap-1 text-[11px] font-normal text-sidebar-foreground/50">
              <GitForkIcon className="size-3 shrink-0" aria-label="Worktree" />
              <span className="truncate">{entry.worktreeBranch}</span>
            </span>
          ) : null}
          {lastMessagePreview ? (
            <span className="min-w-0 truncate text-[11px] font-normal text-sidebar-foreground/50">
              {lastMessagePreview}
            </span>
          ) : null}
          {pinnedDirectoryLabel ? (
            <span className="flex min-w-0 items-center gap-1 text-[11px] font-normal text-sidebar-foreground/50">
              <FolderIcon className="size-3 shrink-0" aria-label="Folder" />
              <span className="truncate">{pinnedDirectoryLabel}</span>
            </span>
          ) : null}
        </span>
      </span>
    </SidebarMenuButton>
  )

  const sessionTrailingControls = hasTimestamp ? (
    <span className="absolute top-(--sidebar-row-icon-top) right-(--sidebar-item-pad) z-10 flex min-w-4 items-center justify-end">
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
      style={
        {
          ...sessionTreeStyle(nestingDepth),
        } as React.CSSProperties
      }
      // A row that cannot move (a session of another machine) has no drag
      // attributes: they would mark the row as disabled (`aria-disabled`).
      {...(dragDisabled ? {} : draggable.attributes)}
      {...draggable.listeners}
    >
      {sessionButton}
      {/* A child session draws the lines of its parents' levels. Rows of one
          subtree follow each other, so their lines join into one. */}
      {Array.from({ length: childDepth }, (_, index) => (
        <SidebarTreeLine
          key={index}
          level={nestingDepth - childDepth + index}
        />
      ))}
      {sessionTrailingControls}
    </div>
  )

  return (
    <SidebarMenuItem>
      {hasSessionActions ? (
        <ContextMenu>
          <ContextMenuTrigger render={sessionRow} />
          <ContextMenuContent className="w-44">
            {onTogglePinnedSession && !isOptimisticSession ? (
              <ContextMenuItem onClick={() => onTogglePinnedSession(entry)}>
                {isPinned ? "Unpin" : "Pin to sidebar"}
              </ContextMenuItem>
            ) : null}
            {onSetSessionUnread && entry.path ? (
              <ContextMenuItem
                onClick={() => onSetSessionUnread(entry, !entry.unread)}
              >
                {entry.unread ? "Mark as read" : "Mark as unread"}
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
                Archive
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
  /** Nesting depth per child session; see `buildSessionDepths`. */
  depthByKey: Map<string, number>
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
    Boolean(left.unread) === Boolean(right.unread) &&
    Boolean(left.needsInput) === Boolean(right.needsInput) &&
    left.parent === right.parent &&
    left.worktreeBranch === right.worktreeBranch &&
    Boolean(left.optimistic) === Boolean(right.optimistic)
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

/** Sessions with each child session after its parent, in list order. */
function nestChildSessions(sessions: Array<SessionListEntry>) {
  const ids = new Set(sessions.flatMap((entry) => (entry.id ? [entry.id] : [])))
  const childrenOf = new Map<string, Array<SessionListEntry>>()
  const roots: Array<SessionListEntry> = []
  for (const entry of sessions) {
    if (entry.parent && entry.parent !== entry.id && ids.has(entry.parent)) {
      const siblings = childrenOf.get(entry.parent) ?? []
      siblings.push(entry)
      childrenOf.set(entry.parent, siblings)
    } else {
      roots.push(entry)
    }
  }
  if (childrenOf.size === 0) return sessions
  const ordered: Array<SessionListEntry> = []
  const seen = new Set<SessionListEntry>()
  const visit = (entry: SessionListEntry) => {
    if (seen.has(entry)) return
    seen.add(entry)
    ordered.push(entry)
    for (const child of childrenOf.get(entry.id ?? "") ?? []) visit(child)
  }
  for (const root of roots) visit(root)
  for (const entry of sessions) visit(entry)
  return ordered
}

const MAX_SESSION_NESTING_DEPTH = 4

/**
 * The nesting depth of each child session, in nested list order: 1 for a
 * child of a top-level session, 2 for its child, and so on. Top-level
 * sessions have no entry.
 */
function buildSessionDepths(
  sessionsByDirectory: Record<string, Array<SessionListEntry>>
) {
  const depthByKey = new Map<string, number>()

  for (const sessions of Object.values(sessionsByDirectory)) {
    const ids = new Set(
      sessions.flatMap((entry) => (entry.id ? [entry.id] : []))
    )
    const byId = new Map<string, SessionListEntry>()
    for (const entry of sessions) {
      if (entry.id && !byId.has(entry.id)) byId.set(entry.id, entry)
    }
    for (const entry of sessions) {
      const key = sessionListEntryKey(entry)
      if (!key || depthByKey.has(key)) continue
      let depth = 0
      let current: SessionListEntry | undefined = entry
      const seen = new Set<SessionListEntry>()
      while (current && depth < MAX_SESSION_NESTING_DEPTH) {
        if (seen.has(current)) break
        seen.add(current)
        const parent: string | undefined = current.parent
        if (!parent || parent === current.id || !ids.has(parent)) break
        depth += 1
        current = byId.get(parent)
      }
      if (depth > 0) depthByKey.set(key, depth)
    }
  }

  return depthByKey
}

/** Status icon slot of a session row, on the sidebar icon column. */
const SESSION_STATUS_ICON_CLASS =
  "absolute top-(--sidebar-row-icon-top) left-(--session-slot-left) flex size-(--sidebar-icon) items-center justify-center"

/**
 * CSS variables for a session row at a nesting depth (1 for a session in a
 * directory, more for child sessions). The row padding, status icon, and
 * indented highlight read them.
 *
 *   --session-slot-left        x of the status slot: one gap after the
 *                              highlight edge
 *   --session-text-left        x of the title: one gap after the slot
 *   --session-highlight-start  x where the highlight starts: just after the
 *                              row's innermost line
 */
function sessionTreeStyle(depth: number) {
  return {
    "--session-slot-left":
      depth === 0
        ? "var(--sidebar-session-gap)"
        : `calc(var(--sidebar-item-pad) + ${depth} * var(--sidebar-tree-step))`,
    "--session-text-left":
      "calc(var(--session-slot-left) + var(--sidebar-icon) + var(--sidebar-session-gap))",
    "--session-highlight-start": `calc(${sessionTreeLineLeft(Math.max(depth - 1, 0))} + 0.25rem)`,
  }
}

/**
 * x of the line at a level: level 0 is under the directory icon, level 1
 * under the status icon of a top-level session, and so on.
 */
function sessionTreeLineLeft(level: number) {
  return `calc(var(--sidebar-item-pad) + var(--sidebar-icon) / 2 + ${level} * var(--sidebar-tree-step))`
}

/** A straight line at a level, over the full height of its box. */
function SidebarTreeLine({ level }: { level: number }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 w-px bg-sidebar-border"
      style={{ left: sessionTreeLineLeft(level) }}
    />
  )
}

function buildDirectorySessionKeys(
  sessionsByDirectory: Record<string, Array<SessionListEntry>>
) {
  const sessionKeysByDirectory: Record<string, Array<string>> = {}

  for (const [directory, sessions] of Object.entries(sessionsByDirectory)) {
    sessionKeysByDirectory[directory] = nestChildSessions(sessions).flatMap(
      (entry) => {
        const key = sessionListEntryKey(entry)
        return key ? [key] : []
      }
    )
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
      depthByKey: buildSessionDepths(sessionsByDirectory),
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
        depthByKey: buildSessionDepths(nextSessionsByDirectory),
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
  moveTargetDirectories: Array<string>
  activeSessionStore: ActiveSidebarSessionStore
  selectedSessionKeyStore: SelectedSessionKeyStore
  pinnedSessionKeys: Array<string>
  isMobile: boolean
  setOpenMobile: (open: boolean) => void
  /** False for the sessions of another machine. */
  sessionsDraggable?: boolean
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
  onSetSessionUnread?: (entry: SessionListEntry, unread: boolean) => void
  onMoveSession?: (entry: SessionListEntry, directory: string) => void
  onMoveSessionAnyDirectory?: (entry: SessionListEntry) => void
  onTogglePinnedSession?: (entry: SessionListEntry) => void
  onCreateSessionInDirectory?: (directory: string) => void
  onDeleteOldSessionsInDirectory?: (directory: string) => void
  onMarkSessionsRead?: (entries: Array<SessionListEntry>) => void
  onRemoveDirectory?: (directory: string) => void
}

function directoryUnreadSessions(
  state: DirectorySessionsState,
  directory: string
) {
  const entries: Array<SessionListEntry> = []
  for (const entryKey of state.sessionKeysByDirectory[directory] ?? []) {
    const entry = state.entriesByKey.get(entryKey)
    if (entry?.unread && entry.path) entries.push(entry)
  }
  return entries
}

const DirectorySessionGroup = React.memo(function DirectorySessionGroup({
  directory,
  directorySessionsStore,
  collapsedDirectoryStore,
  searchActive,
  moveTargetDirectories,
  activeSessionStore,
  selectedSessionKeyStore,
  pinnedSessionKeys,
  isMobile,
  setOpenMobile,
  sessionsDraggable,
  isDragging,
  isSessionDropTarget,
  overlay = false,
  attributes,
  listeners,
  onSessionClick,
  onRenameSession,
  onDeleteSession,
  onSetSessionUnread,
  onMoveSession,
  onMoveSessionAnyDirectory,
  onTogglePinnedSession,
  onCreateSessionInDirectory,
  onDeleteOldSessionsInDirectory,
  onMarkSessionsRead,
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
  const hasUnreadSessions = useSelector(
    directorySessionsStore,
    (state) => directoryUnreadSessions(state, directory).length > 0
  )
  const markSessionsRead = () => {
    onMarkSessionsRead?.(
      directoryUnreadSessions(directorySessionsStore.state, directory)
    )
  }
  const pinnedSessionKeySet = new Set(pinnedSessionKeys)
  const unpinnedSessionKeys = sessionKeys.filter(
    (entryKey) => !pinnedSessionKeySet.has(entryKey)
  )
  const visibleCount = searchActive
    ? unpinnedSessionKeys.length
    : Math.min(unpinnedSessionKeys.length, renderCount)
  const visibleSessionKeys = unpinnedSessionKeys.slice(0, visibleCount)
  const hasMoreSessions = visibleCount < unpinnedSessionKeys.length
  const altKeyHeld = useAltKeyHeld()
  // Holding Option turns "Show N more" into "Show less".
  const showLess =
    altKeyHeld &&
    !searchActive &&
    visibleCount > INITIAL_DIRECTORY_SESSION_RENDER_COUNT
  const showTreeLine = !overlay && visibleSessionKeys.length > 0
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
      onMarkSessionsRead ||
      onRemoveDirectory
    )

  const directoryHeader = (
    // Left item-pad puts the folder icon on the sidebar icon column. The
    // new-session button stays flush right: its item-size box already holds
    // the item-pad, so its icon ends on the right content edge.
    <div className="flex items-center gap-2 rounded-lg pl-(--sidebar-item-pad)">
      <CollapsibleTrigger
        type="button"
        className={cn(
          "group/directory-label flex min-w-0 flex-1 cursor-default items-center gap-2 text-left text-sm text-sidebar-foreground"
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
          <Spinner size="xs" className="shrink-0" />
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
                Archive old sessions…
              </DropdownMenuItem>
            ) : null}
            {onMarkSessionsRead ? (
              <DropdownMenuItem
                disabled={!hasUnreadSessions}
                onClick={markSessionsRead}
              >
                Mark all as read
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
      <SidebarGroup className="px-0 py-0">
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
                  Archive old sessions…
                </ContextMenuItem>
              ) : null}
              {onMarkSessionsRead ? (
                <ContextMenuItem
                  disabled={!hasUnreadSessions}
                  onClick={markSessionsRead}
                >
                  Mark all as read
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
                    <Spinner size="xs" />
                  ) : (
                    <span className="size-4" aria-hidden="true" />
                  )}
                  Loading sessions…
                </div>
              ) : unpinnedSessionKeys.length > 0 ? (
                // The directory's line runs down its sessions and "Show more".
                <div className="relative flex flex-col">
                  {showTreeLine ? <SidebarTreeLine level={0} /> : null}
                  <SidebarMenu>
                    {visibleSessionKeys.map((entryKey) => (
                      <SidebarSessionItem
                        key={entryKey}
                        entryKey={entryKey}
                        inDirectory
                        directorySessionsStore={directorySessionsStore}
                        activeSessionStore={activeSessionStore}
                        selectedSessionKeyStore={selectedSessionKeyStore}
                        isPinned={pinnedSessionKeys.includes(entryKey)}
                        isMobile={isMobile}
                        overlay={overlay}
                        sessionDraggable={sessionsDraggable}
                        moveTargetDirectories={moveTargetDirectories}
                        setOpenMobile={setOpenMobile}
                        onSessionClick={onSessionClick}
                        onRenameSession={onRenameSession}
                        onDeleteSession={onDeleteSession}
                        onSetSessionUnread={onSetSessionUnread}
                        onMoveSession={onMoveSession}
                        onMoveSessionAnyDirectory={onMoveSessionAnyDirectory}
                        onTogglePinnedSession={onTogglePinnedSession}
                      />
                    ))}
                  </SidebarMenu>

                  {hasMoreSessions || showLess ? (
                    <div
                      className="flex flex-col"
                      style={sessionTreeStyle(1) as React.CSSProperties}
                    >
                      <Button
                        variant="ghost"
                        className="h-8 justify-start pl-(--session-text-left) text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                        onClick={() => {
                          if (showLess) {
                            setRenderCount(
                              INITIAL_DIRECTORY_SESSION_RENDER_COUNT
                            )
                            return
                          }
                          setRenderCount((current) =>
                            Math.min(
                              unpinnedSessionKeys.length,
                              current + DIRECTORY_SESSION_LOAD_MORE_COUNT
                            )
                          )
                        }}
                      >
                        {showLess
                          ? "Show less"
                          : `Show ${Math.min(
                              DIRECTORY_SESSION_LOAD_MORE_COUNT,
                              unpinnedSessionKeys.length - visibleCount
                            )} more`}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="p-2 text-sm text-sidebar-foreground/70">
                  {/* "Unpinned" only when sessions are pinned. */}
                  {pinnedSessionKeys.length === 0
                    ? searchActive
                      ? "No matching sessions."
                      : "No sessions."
                    : searchActive
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
  /** The group is inside another sidebar group that already adds the side gutter. */
  nested?: boolean
  directorySessionsStore: DirectorySessionsStore
  collapsedDirectoryStore: CollapsedDirectoryStore
  searchActive: boolean
  activeSessionStore: ActiveSidebarSessionStore
  selectedSessionKeyStore: SelectedSessionKeyStore
  isMobile: boolean
  moveTargetDirectories: Array<string>
  setOpenMobile: (open: boolean) => void
  /** False for the sessions of another machine. */
  sessionsDraggable?: boolean
  onSessionClick?: (
    entry: SessionListEntry,
    modifiers: SessionClickModifiers
  ) => void
  onRenameSession?: (entry: SessionListEntry) => void
  onDeleteSession?: (entry: SessionListEntry) => void
  onSetSessionUnread?: (entry: SessionListEntry, unread: boolean) => void
  onMoveSession?: (entry: SessionListEntry, directory: string) => void
  onMoveSessionAnyDirectory?: (entry: SessionListEntry) => void
  onTogglePinnedSession?: (entry: SessionListEntry) => void
}

function PinnedSessionGroup({
  pinnedSessionKeys,
  nested = false,
  directorySessionsStore,
  collapsedDirectoryStore,
  searchActive,
  activeSessionStore,
  selectedSessionKeyStore,
  isMobile,
  moveTargetDirectories,
  setOpenMobile,
  sessionsDraggable,
  onSessionClick,
  onRenameSession,
  onDeleteSession,
  onSetSessionUnread,
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
      <SidebarGroup className={cn("py-1", nested && "px-0")}>
        {/* Same header shape as a directory, so the icon sits on the
            sidebar icon column and the line starts under it. */}
        <div className="flex h-(--sidebar-item-size) items-center gap-2 rounded-lg pl-(--sidebar-item-pad)">
          <CollapsibleTrigger
            type="button"
            className="group/pinned-label flex min-w-0 flex-1 cursor-default items-center gap-2 text-left text-sm text-sidebar-foreground"
            disabled={searchActive}
          >
            <PinIcon className="size-4 shrink-0 text-sidebar-foreground/50" />
            <span className="min-w-0 truncate">Pinned</span>
            {!searchActive ? (
              collapsed ? (
                <ChevronRightIcon className="size-4 shrink-0 opacity-0 transition-opacity group-hover/pinned-label:opacity-100 group-focus-visible/pinned-label:opacity-100" />
              ) : (
                <ChevronDownIcon className="size-4 shrink-0 opacity-0 transition-opacity group-hover/pinned-label:opacity-100 group-focus-visible/pinned-label:opacity-100" />
              )
            ) : null}
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <SidebarGroupContent>
            <div className="relative flex flex-col">
              <SidebarTreeLine level={0} />
              <SidebarMenu>
                {pinnedSessionKeys.map((entryKey) => (
                  <SidebarSessionItem
                    key={entryKey}
                    entryKey={entryKey}
                    inDirectory
                    directorySessionsStore={directorySessionsStore}
                    activeSessionStore={activeSessionStore}
                    selectedSessionKeyStore={selectedSessionKeyStore}
                    isPinned
                    isMobile={isMobile}
                    overlay={false}
                    sessionDraggable={sessionsDraggable}
                    moveTargetDirectories={moveTargetDirectories}
                    setOpenMobile={setOpenMobile}
                    onSessionClick={onSessionClick}
                    onRenameSession={onRenameSession}
                    onDeleteSession={onDeleteSession}
                    onSetSessionUnread={onSetSessionUnread}
                    onMoveSession={onMoveSession}
                    onMoveSessionAnyDirectory={onMoveSessionAnyDirectory}
                    onTogglePinnedSession={onTogglePinnedSession}
                  />
                ))}
              </SidebarMenu>
            </div>
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

type AppSidebarSearchButtonProps = {
  onOpenSessionsDialog: () => void
}

function AppSidebarSearchButton({
  onOpenSessionsDialog,
}: AppSidebarSearchButtonProps) {
  return (
    <SidebarGroup className="pb-0">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton type="button" onClick={onOpenSessionsDialog}>
            <SearchIcon />
            <span>Search sessions…</span>
            <span className="ml-auto hidden items-center md:flex">
              <Kbd>{formatShortcutLabel(appShortcut("S"))}</Kbd>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
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
    // pr-0: the item-size icon buttons already hold the item-pad, so their
    // icons end on the right content edge, with the search Kbd.
    <SidebarGroupLabel className="justify-between gap-3 pr-0">
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
      <DirectoryActions
        searchActive={searchActive}
        showCollapseAll={!collapsed}
        visibleDirectories={visibleDirectories}
        collapsedDirectoryStore={collapsedDirectoryStore}
        onOpenAddDirectoryDialog={onOpenAddDirectoryDialog}
      />
    </SidebarGroupLabel>
  )
}

/**
 * Collapse all and Add directory. They are on the "Directories" heading, or
 * on the machine heading when the sidebar has a group for each machine.
 */
function DirectoryActions({
  searchActive,
  showCollapseAll,
  visibleDirectories,
  collapsedDirectoryStore,
  onOpenAddDirectoryDialog,
}: {
  searchActive: boolean
  showCollapseAll: boolean
  visibleDirectories: Array<string>
  collapsedDirectoryStore: CollapsedDirectoryStore
  onOpenAddDirectoryDialog: () => void
}) {
  return (
    <span className="flex items-center gap-1">
      {showCollapseAll ? (
        <DirectoryCollapseAllButton
          searchActive={searchActive}
          visibleDirectories={visibleDirectories}
          collapsedDirectoryStore={collapsedDirectoryStore}
        />
      ) : null}
      <TitleTooltip
        title="Add directory"
        kbd={formatShortcutLabel(appShortcut("D"))}
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
  )
}

const NO_MOVE_TARGET_DIRECTORIES: Array<string> = []

/** A session of another machine, from its summary, as a sidebar entry. */
function machineSummaryEntry(session: MachineSessionSummary): SessionListEntry {
  return {
    id: session.id,
    // The session path of a Pico server. With it, the rename and archive
    // routes find the session, and the key of the row matches the pinned
    // session keys of that machine.
    path: `pico:${session.id}`,
    cwd: session.directory || session.cwd,
    title: session.title,
    ...(session.lastMessageAt
      ? { lastMessageAt: new Date(session.lastMessageAt).toISOString() }
      : {}),
    streaming: session.busy,
    needsInput: session.needsInput,
    unread: isMachineSessionUnread(session),
    ...(session.parent ? { parent: session.parent } : {}),
  }
}

/**
 * The sidebar directories of a machine with their sessions, as the machine
 * shows them when it is the machine of the page.
 */
function groupMachineSessions(machine: MachineInfo) {
  const summary = machine.summary
  const directories = summary?.directories ?? []
  const sessionsByDirectory: Record<string, Array<SessionListEntry>> = {}
  for (const directory of directories) sessionsByDirectory[directory] = []
  for (const session of summary?.sessions ?? []) {
    const directory = session.directory || session.cwd
    sessionsByDirectory[directory]?.push(machineSummaryEntry(session))
  }
  return { directories, sessionsByDirectory }
}

/**
 * The pinned session keys of another machine. They are part of the sidebar
 * state that the machine's server keeps, so this starts the sidebar sync of
 * that machine. The sync keeps the local copy and sends changes to it.
 */
function useOtherMachinePinnedSessionKeys(machineId: string, online: boolean) {
  const [keys, setKeys] = React.useState(() =>
    readStoredPinnedSessionKeys(machineId)
  )

  React.useEffect(() => {
    if (!online) return
    const contextId = viewerContextIdForSummaries()
    if (contextId) startSidebarSync(machineId, contextId)
  }, [machineId, online])

  usePicoEvent(
    "pico:sidebar-state",
    ({ machineId: changedMachine, changed }) => {
      if (changedMachine !== machineId) return
      if (changed.includes("pinnedSessionKeys"))
        setKeys(readStoredPinnedSessionKeys(machineId))
    }
  )

  const toggle = React.useCallback(
    (key: string) => {
      const current = readStoredPinnedSessionKeys(machineId)
      const next = current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [key, ...current]
      machineLocalStorageSetItem(
        machineId,
        PINNED_SESSIONS_STORAGE_KEY,
        JSON.stringify(next)
      )
      setKeys(next)
    },
    [machineId]
  )

  return [keys, toggle] as const
}

/**
 * The directories and sessions of another machine of the hub, from its
 * summary. They look like the directories of this machine. A click opens the
 * session on its machine; the new-session button of a directory opens the
 * machine and starts a session there. Pin, rename, and archive change the
 * session on its machine.
 */
export function OtherMachineDirectories({ machine }: { machine: MachineInfo }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const grouped = React.useMemo(() => groupMachineSessions(machine), [machine])
  const [stores] = React.useState(() => {
    const collapsed = createCollapsedDirectoryStore(
      machine.id,
      `pico-machine-collapsed-directories:${machine.id}`
    )
    collapsed.loadStored()
    return {
      sessions: createDirectorySessionsStore(grouped.sessionsByDirectory, {}),
      collapsed,
      active: createActiveSidebarSessionStore(),
      selected: createSelectedSessionKeyStore(),
    }
  })

  React.useEffect(() => {
    stores.sessions.setData(grouped.sessionsByDirectory, {})
  }, [grouped, stores])

  const online = machine.state === "online"
  const [storedPinnedKeys, togglePinnedKey] = useOtherMachinePinnedSessionKeys(
    machine.id,
    online
  )
  // Only the pins of sessions in the summary: the summary does not have
  // archived sessions, and it stops at 200 sessions.
  const pinnedSessionKeys = React.useMemo(() => {
    const known = new Set(
      Object.values(grouped.sessionsByDirectory)
        .flat()
        .map((entry) => sessionListEntryKey(entry))
    )
    return storedPinnedKeys.filter((key) => known.has(key))
  }, [grouped, storedPinnedKeys])
  const [renameEntry, setRenameEntry] = React.useState<SessionListEntry>()
  const [archiveEntry, setArchiveEntry] = React.useState<SessionListEntry>()
  const sessionActions = online
    ? {
        onRenameSession: setRenameEntry,
        onDeleteSession: setArchiveEntry,
        onTogglePinnedSession: (entry: SessionListEntry) =>
          togglePinnedKey(sessionListEntryKey(entry)),
      }
    : {}
  const openSession = React.useCallback(
    (entry: SessionListEntry) => {
      if (entry.id)
        openMachineSession({ machineId: machine.id, sessionId: entry.id })
    },
    [machine.id]
  )
  const createSession = React.useCallback(
    (directory: string) => {
      if (isMobile) setOpenMobile(false)
      openMachine(machine.id, {
        action: { type: "new-session", directory },
      })
    },
    [isMobile, machine.id, setOpenMobile]
  )

  // A machine without directories: add the first one there. The heading
  // shows the state of a machine that is not online.
  if (grouped.directories.length === 0) {
    if (!online) return null
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            type="button"
            className="text-sidebar-foreground/60"
            onClick={() => {
              if (isMobile) setOpenMobile(false)
              openMachine(machine.id, { action: { type: "add-directory" } })
            }}
          >
            <FolderPlusIcon className="text-sidebar-foreground/50" />
            <span>Add directory…</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <>
      <PinnedSessionGroup
        nested
        pinnedSessionKeys={pinnedSessionKeys}
        directorySessionsStore={stores.sessions}
        collapsedDirectoryStore={stores.collapsed}
        searchActive={false}
        activeSessionStore={stores.active}
        selectedSessionKeyStore={stores.selected}
        isMobile={isMobile}
        moveTargetDirectories={NO_MOVE_TARGET_DIRECTORIES}
        setOpenMobile={setOpenMobile}
        sessionsDraggable={false}
        onSessionClick={openSession}
        {...sessionActions}
      />
      {grouped.directories.map((directory) => (
        <DirectorySessionGroup
          key={directory}
          directory={directory}
          directorySessionsStore={stores.sessions}
          collapsedDirectoryStore={stores.collapsed}
          searchActive={false}
          moveTargetDirectories={NO_MOVE_TARGET_DIRECTORIES}
          activeSessionStore={stores.active}
          selectedSessionKeyStore={stores.selected}
          pinnedSessionKeys={pinnedSessionKeys}
          isMobile={isMobile}
          setOpenMobile={setOpenMobile}
          sessionsDraggable={false}
          onSessionClick={openSession}
          onCreateSessionInDirectory={online ? createSession : undefined}
          {...sessionActions}
        />
      ))}
      <OtherMachineRenameDialog
        machineId={machine.id}
        machineLabel={machine.label}
        entry={renameEntry}
        onOpenChange={(open) => {
          if (!open) setRenameEntry(undefined)
        }}
      />
      <OtherMachineArchiveDialog
        machineId={machine.id}
        machineLabel={machine.label}
        entry={archiveEntry}
        onOpenChange={(open) => {
          if (!open) setArchiveEntry(undefined)
        }}
      />
    </>
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
  onOpenAddDirectoryDialog,
  onSessionClick,
  onRenameSession,
  onDeleteSession,
  onSetSessionUnread,
  onMoveSession,
  onMoveSessionAnyDirectory,
  onTogglePinnedSession,
  onCreateSessionInDirectory,
  onDeleteOldSessionsInDirectory,
  onMarkSessionsRead,
  onRemoveDirectory,
  onReorderDirectories,
  onOpenArchivedSessions,
}: AppSidebarProps) {
  const machineId = useMachineId()
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
  const [collapsedDirectoryStore] = React.useState(() =>
    createCollapsedDirectoryStore(machineId)
  )
  const [selectedSessionKeyStore] = React.useState(
    createSelectedSessionKeyStore
  )
  const [activeSessionStore] = React.useState(createActiveSidebarSessionStore)
  // With a group for each machine, the machine heading replaces the
  // "Directories" heading and takes its buttons, so all machine groups have
  // the same levels: machine, directory, session. A search still shows the
  // heading, with its count of matches.
  const hasMachineGroups = useHasMachineGroups()
  const showDirectoriesHeader = !hasMachineGroups || searchActive
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

  usePicoEvent(
    "pico:sidebar-state",
    ({ machineId: changedMachine, changed }) => {
      if (changedMachine !== machineId) return
      if (changed.includes("collapsedDirectories"))
        collapsedDirectoryStore.loadStored()
    }
  )

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
      className="border-r border-sidebar-border/70 pt-[env(safe-area-inset-top)]"
    >
      <SidebarContent>
        {/* Search covers all machines, so it stays above their groups. */}
        <AppSidebarSearchButton onOpenSessionsDialog={onOpenSessionsDialog} />
        <SidebarMachineGroups
          activeActions={
            <DirectoryActions
              searchActive={searchActive}
              showCollapseAll
              visibleDirectories={visibleDirectories}
              collapsedDirectoryStore={collapsedDirectoryStore}
              onOpenAddDirectoryDialog={onOpenAddDirectoryDialog}
            />
          }
          renderContent={(machine) => (
            <OtherMachineDirectories machine={machine} />
          )}
        >
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
              onSetSessionUnread={onSetSessionUnread}
              onMoveSession={onMoveSession}
              onTogglePinnedSession={onTogglePinnedSession}
            />
            <Collapsible
              open={showDirectoriesHeader ? !directoriesCollapsed : true}
              onOpenChange={(open) => {
                if (searchActive) return
                collapsedDirectoryStore.setCollapsed(
                  DIRECTORIES_SESSION_GROUP_COLLAPSE_KEY,
                  !open
                )
              }}
            >
              <SidebarGroup
                className={showDirectoriesHeader ? "py-1" : "pt-0 pb-1"}
              >
                {showDirectoriesHeader ? (
                  <AppSidebarDirectoriesHeader
                    sessionSearch={sessionSearch}
                    visibleDirectories={visibleDirectories}
                    matchingSessionCount={matchingSessionCount}
                    collapsed={directoriesCollapsed}
                    collapsedDirectoryStore={collapsedDirectoryStore}
                    onOpenAddDirectoryDialog={onOpenAddDirectoryDialog}
                  />
                ) : null}
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
                                  directorySessionsStore={
                                    directorySessionsStore
                                  }
                                  collapsedDirectoryStore={
                                    collapsedDirectoryStore
                                  }
                                  searchActive={searchActive}
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
                                  onSetSessionUnread={onSetSessionUnread}
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
                                  onMarkSessionsRead={onMarkSessionsRead}
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
                  onSetSessionUnread={onSetSessionUnread}
                  onMoveSession={onMoveSession}
                  onMoveSessionAnyDirectory={onMoveSessionAnyDirectory}
                  onTogglePinnedSession={onTogglePinnedSession}
                  onCreateSessionInDirectory={onCreateSessionInDirectory}
                  onDeleteOldSessionsInDirectory={
                    onDeleteOldSessionsInDirectory
                  }
                  onMarkSessionsRead={onMarkSessionsRead}
                  onRemoveDirectory={
                    onRemoveDirectory ? removeDirectory : undefined
                  }
                />
              ) : activeSessionDrag ? (
                <SidebarMenu className="w-full rounded-md bg-sidebar shadow-lg ring-1 ring-sidebar-border/70">
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
                    onSetSessionUnread={onSetSessionUnread}
                    onMoveSession={onMoveSession}
                    onMoveSessionAnyDirectory={onMoveSessionAnyDirectory}
                    onTogglePinnedSession={onTogglePinnedSession}
                  />
                </SidebarMenu>
              ) : null}
            </DragOverlay>
          </DndContext>
        </SidebarMachineGroups>
        {onOpenArchivedSessions ? (
          <SidebarGroup className="mt-auto pt-0">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  className="text-muted-foreground"
                  onClick={() => {
                    if (isMobile) setOpenMobile(false)
                    onOpenArchivedSessions()
                  }}
                >
                  <ArchiveIcon />
                  <span>Archived sessions</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  )
}
