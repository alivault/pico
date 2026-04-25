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
  EllipsisIcon,
  FolderIcon,
  FolderPlusIcon,
  SearchIcon,
  SquarePenIcon,
  Settings2Icon,
} from "lucide-react"

import type { SessionListEntry } from "@/lib/pi-web-api"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
} from "@/lib/pi-web"
import { cn } from "@/lib/utils"

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

const EMPTY_DIRECTORY_SESSIONS: Array<SessionListEntry> = []

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
  clear: () => void
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
    clear() {
      if (Object.keys(collapsedDirectories).length === 0) return
      collapsedDirectories = {}
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
  directoryCount: number
  filteredDirectorySessions: Record<string, Array<SessionListEntry>>
  directoryIndexLoading: Record<string, boolean>
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
  onRemoveDirectory?: (directory: string) => void
  onRemoveAllDirectories?: () => void
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

type SidebarSessionItemProps = {
  entry: SessionListEntry
  entryKey: string
  isActive: boolean
  isSelected: boolean
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
  entry,
  entryKey,
  isActive,
  isSelected,
  isMobile,
  overlay,
  setOpenMobile,
  onSessionClick,
  onRenameSession,
  onDeleteSession,
}: SidebarSessionItemProps) {
  return (
    <SidebarMenuItem>
      <div className="relative">
        <SidebarMenuButton
          type="button"
          data-sidebar-session-item
          data-session-key={entryKey}
          isActive={isActive}
          className={cn(
            "h-auto items-start gap-2 py-2 pr-10",
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
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {entry.streaming ? (
              <Spinner
                className="size-3.5 shrink-0 text-sidebar-foreground/60"
                aria-label="Session streaming"
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate font-medium">
              {entry.title}
            </span>
            {entry.unread ? (
              <span className="size-2 shrink-0 rounded-full bg-primary" />
            ) : null}
          </span>
        </SidebarMenuButton>

        {entry.path && (onRenameSession || onDeleteSession) && !overlay ? (
          <div className="absolute top-2 right-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    title={`Session actions for ${entry.title}`}
                  />
                }
              >
                <EllipsisIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {onRenameSession ? (
                  <DropdownMenuItem onClick={() => onRenameSession(entry)}>
                    Rename
                  </DropdownMenuItem>
                ) : null}
                {onDeleteSession ? (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onDeleteSession(entry)}
                  >
                    Delete
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
    </SidebarMenuItem>
  )
}

type DirectorySessionGroupProps = {
  directory: string
  sessions: Array<SessionListEntry>
  collapsedDirectoryStore: CollapsedDirectoryStore
  searchActive: boolean
  isLoadingSessions: boolean
  directoryOrderingEnabled: boolean
  selectedSessionKeys: Array<string>
  activeSessionId?: string
  activeSessionKey?: string
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
  onRemoveDirectory?: (directory: string) => void
}

function DirectorySessionGroup({
  directory,
  sessions,
  collapsedDirectoryStore,
  searchActive,
  isLoadingSessions,
  directoryOrderingEnabled,
  selectedSessionKeys,
  activeSessionId,
  activeSessionKey,
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
  onRemoveDirectory,
}: DirectorySessionGroupProps) {
  const [renderCount, setRenderCount] = React.useState(
    INITIAL_DIRECTORY_SESSION_RENDER_COUNT
  )
  const collapsed = useDirectoryCollapsed(
    collapsedDirectoryStore,
    directory,
    searchActive
  )
  const visibleCount = searchActive
    ? sessions.length
    : Math.min(sessions.length, renderCount)
  const visibleSessions = sessions.slice(0, visibleCount)
  const hasMoreSessions = visibleCount < sessions.length
  const showLoadingState = isLoadingSessions && sessions.length === 0
  const selectedSessionKeySet = new Set(selectedSessionKeys)

  return (
    <SidebarGroup
      className={cn("rounded-lg py-1", isDragging && !overlay && "opacity-0")}
    >
      <div className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-sidebar-accent/70">
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
            directoryOrderingEnabled && !overlay
              ? Boolean(isDragging)
              : undefined
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
              <ChevronRightIcon className="mt-0.5 size-4 shrink-0" />
            ) : (
              <ChevronDownIcon className="mt-0.5 size-4 shrink-0" />
            )
          ) : null}
          <FolderIcon className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <DirectoryPathLabel path={directory} />
          </span>
          {isLoadingSessions && !showLoadingState ? (
            <Spinner className="size-3.5 shrink-0 text-sidebar-foreground/50" />
          ) : null}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {onCreateSessionInDirectory && !overlay ? (
            <Button
              size="icon-xs"
              variant="ghost"
              title={`Create a session in ${directory}`}
              onClick={() => onCreateSessionInDirectory(directory)}
            >
              <SquarePenIcon className="size-4" />
            </Button>
          ) : null}
          {onRemoveDirectory && !overlay ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button size="icon-xs" variant="ghost" />}
              >
                <EllipsisIcon className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => onRemoveDirectory(directory)}>
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {!collapsed ? (
        <SidebarGroupContent className="pt-1">
          {showLoadingState ? (
            <div className="flex items-center gap-2 px-2 py-2 text-sm text-sidebar-foreground/70">
              <Spinner />
              Loading sessions…
            </div>
          ) : sessions.length > 0 ? (
            <div className="flex flex-col gap-1">
              <SidebarMenu>
                {visibleSessions.map((entry) => {
                  const entryKey = sessionListEntryKey(entry)
                  const isActive = activeSessionKey
                    ? entryKey === activeSessionKey
                    : Boolean(activeSessionId) && entry.id === activeSessionId
                  const isSelected =
                    entryKey.length > 0 && selectedSessionKeySet.has(entryKey)

                  return (
                    <SidebarSessionItem
                      key={
                        entryKey || `${directory}-${entry.path || entry.title}`
                      }
                      entry={entry}
                      entryKey={entryKey}
                      isActive={isActive}
                      isSelected={isSelected}
                      isMobile={isMobile}
                      overlay={overlay}
                      setOpenMobile={setOpenMobile}
                      onSessionClick={onSessionClick}
                      onRenameSession={onRenameSession}
                      onDeleteSession={onDeleteSession}
                    />
                  )
                })}
              </SidebarMenu>

              {hasMoreSessions && !overlay ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => {
                    setRenderCount((current) =>
                      Math.min(
                        sessions.length,
                        current + DIRECTORY_SESSION_LOAD_MORE_COUNT
                      )
                    )
                  }}
                >
                  Show{" "}
                  {Math.min(
                    DIRECTORY_SESSION_LOAD_MORE_COUNT,
                    sessions.length - visibleCount
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

  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="text-sidebar-foreground/70 hover:text-sidebar-foreground"
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
  connected: boolean
  sessionSearch: string
  onSessionSearchChange: (value: string) => void
  sessionSearchInputRef?: React.Ref<HTMLInputElement>
  visibleDirectories: Array<string>
  directoryCount: number
  matchingSessionCount: number
  collapsedDirectoryStore: CollapsedDirectoryStore
  onOpenAddDirectoryDialog: () => void
  onRemoveAllDirectories?: () => void
}

function AppSidebarHeader({
  connected,
  sessionSearch,
  onSessionSearchChange,
  sessionSearchInputRef,
  visibleDirectories,
  directoryCount,
  matchingSessionCount,
  collapsedDirectoryStore,
  onOpenAddDirectoryDialog,
  onRemoveAllDirectories,
}: AppSidebarHeaderProps) {
  const searchActive = sessionSearch.trim().length > 0

  return (
    <SidebarHeader className="gap-3 border-b border-sidebar-border/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-xl font-semibold tracking-tight text-sidebar-foreground">
            Pi
          </h1>
        </div>
        <ConnectionBadge connected={connected} />
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-sidebar-foreground/50" />
        <Input
          ref={sessionSearchInputRef}
          value={sessionSearch}
          onChange={(event) => onSessionSearchChange(event.target.value)}
          placeholder="Search sessions..."
          className="border-sidebar-border/70 bg-sidebar-accent/20 pl-9"
        />
      </div>

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
          {onRemoveAllDirectories ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-sidebar-foreground/70 hover:text-sidebar-foreground"
                    disabled={directoryCount === 0}
                    aria-label="Directory actions"
                    title="Directory actions"
                  />
                }
              >
                <EllipsisIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem
                  variant="destructive"
                  disabled={directoryCount === 0}
                  onClick={() => {
                    collapsedDirectoryStore.clear()
                    onRemoveAllDirectories()
                  }}
                >
                  Remove all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            variant="secondary"
            size="icon-sm"
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
  directoryCount,
  filteredDirectorySessions,
  directoryIndexLoading,
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
  onRemoveDirectory,
  onRemoveAllDirectories,
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

  const getDirectorySessions = (directory: string) => {
    if (
      !Object.prototype.hasOwnProperty.call(
        filteredDirectorySessions,
        directory
      )
    ) {
      return EMPTY_DIRECTORY_SESSIONS
    }

    return filteredDirectorySessions[directory] ?? EMPTY_DIRECTORY_SESSIONS
  }

  const removeDirectory = (directory: string) => {
    collapsedDirectoryStore.remove(directory)
    onRemoveDirectory?.(directory)
  }

  const matchingSessionCount = visibleDirectories.reduce(
    (total, directory) => total + getDirectorySessions(directory).length,
    0
  )

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
        directoryCount={directoryCount}
        matchingSessionCount={matchingSessionCount}
        collapsedDirectoryStore={collapsedDirectoryStore}
        onOpenAddDirectoryDialog={onOpenAddDirectoryDialog}
        onRemoveAllDirectories={onRemoveAllDirectories}
      />

      <SidebarContent className="px-2 py-3">
        {visibleDirectories.length === 0 ? (
          <SidebarGroup className="px-2 py-2">
            <Empty className="rounded-xl border border-dashed bg-sidebar-accent/10 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderIcon />
                </EmptyMedia>
                <EmptyTitle>No sidebar results</EmptyTitle>
                <EmptyDescription>{emptyStateText}</EmptyDescription>
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
                const sessions = getDirectorySessions(directory)
                const isLoadingSessions = Boolean(
                  directoryIndexLoading[directory]
                )

                return (
                  <SortableDirectoryGroup
                    key={directory}
                    id={directory}
                    disabled={!directoryOrderingEnabled}
                  >
                    {({ attributes, listeners, isDragging }) => (
                      <DirectorySessionGroup
                        directory={directory}
                        sessions={sessions}
                        collapsedDirectoryStore={collapsedDirectoryStore}
                        searchActive={searchActive}
                        isLoadingSessions={isLoadingSessions}
                        directoryOrderingEnabled={directoryOrderingEnabled}
                        selectedSessionKeys={selectedSessionKeys}
                        activeSessionId={activeSessionId}
                        activeSessionKey={activeSessionKey}
                        isMobile={isMobile}
                        setOpenMobile={setOpenMobile}
                        isDragging={isDragging}
                        attributes={attributes}
                        listeners={listeners}
                        onSessionClick={onSessionClick}
                        onRenameSession={onRenameSession}
                        onDeleteSession={onDeleteSession}
                        onCreateSessionInDirectory={onCreateSessionInDirectory}
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
                  sessions={getDirectorySessions(activeDirectory)}
                  collapsedDirectoryStore={collapsedDirectoryStore}
                  searchActive={searchActive}
                  isLoadingSessions={Boolean(
                    directoryIndexLoading[activeDirectory]
                  )}
                  directoryOrderingEnabled={directoryOrderingEnabled}
                  selectedSessionKeys={selectedSessionKeys}
                  activeSessionId={activeSessionId}
                  activeSessionKey={activeSessionKey}
                  isMobile={isMobile}
                  setOpenMobile={setOpenMobile}
                  overlay
                  onSessionClick={onSessionClick}
                  onRenameSession={onRenameSession}
                  onDeleteSession={onDeleteSession}
                  onCreateSessionInDirectory={onCreateSessionInDirectory}
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
