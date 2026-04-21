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
  ActivityIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDown,
  EllipsisIcon,
  FolderIcon,
  FolderPlusIcon,
  KeyboardIcon,
  SearchIcon,
  SquarePenIcon,
  Settings2Icon,
} from "lucide-react"

import type { DirectoryState } from "@/lib/pi-web"
import type { SessionListEntry } from "@/lib/pi-web-api"
import { Badge } from "@/components/ui/badge"
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
} from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import {
  DIRECTORY_SESSION_LOAD_MORE_COUNT,
  INITIAL_DIRECTORY_SESSION_RENDER_COUNT,
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

function directoryOrderEqual(left: Array<string>, right: Array<string>) {
  if (left.length !== right.length) return false

  return left.every((directory, index) => directory === right[index])
}

type AppSidebarProps = {
  connected: boolean
  sessionSearch: string
  onSessionSearchChange: (value: string) => void
  sessionSearchInputRef?: React.Ref<HTMLInputElement>
  visibleDirectories: Array<string>
  directoryCount: number
  directoryStateByPath: Map<string, DirectoryState>
  filteredDirectorySessions: Record<string, Array<SessionListEntry>>
  collapsedDirectories: Record<string, boolean>
  directoryIndexLoading: Record<string, boolean>
  directoryRenderCounts: Record<string, number>
  selectedSessionKeys: Array<string>
  activeSessionId?: string
  statusCount: number
  emptyStateText: string
  allDirectoriesCollapsed: boolean
  onCreateSession: () => void
  onOpenAddDirectoryDialog: () => void
  onOpenCommandPalette: () => void
  onOpenShortcuts: () => void
  onOpenStatus: () => void
  onOpenSettings: () => void
  onToggleDirectory: (directory: string) => void
  onToggleAllDirectories: () => void
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
  onLoadMoreDirectorySessions: (directory: string) => void
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled })

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

export function AppSidebar({
  connected,
  sessionSearch,
  onSessionSearchChange,
  sessionSearchInputRef,
  visibleDirectories,
  directoryCount,
  filteredDirectorySessions,
  collapsedDirectories,
  directoryIndexLoading,
  directoryRenderCounts,
  selectedSessionKeys,
  activeSessionId,
  statusCount,
  emptyStateText,
  allDirectoriesCollapsed,
  onOpenAddDirectoryDialog,
  onOpenCommandPalette,
  onOpenShortcuts,
  onOpenStatus,
  onOpenSettings,
  onToggleDirectory,
  onToggleAllDirectories,
  onSessionClick,
  onRenameSession,
  onDeleteSession,
  onCreateSessionInDirectory,
  onRemoveDirectory,
  onRemoveAllDirectories,
  onReorderDirectories,
  onLoadMoreDirectorySessions,
}: AppSidebarProps) {
  const searchActive = sessionSearch.trim().length > 0
  const directoryOrderingEnabled = !searchActive && visibleDirectories.length > 1
  const [activeDirectory, setActiveDirectory] = React.useState<string | null>(null)
  const [previewDirectoryOrder, setPreviewDirectoryOrder] = React.useState<
    Array<string> | null
  >(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  )

  React.useEffect(() => {
    if (directoryOrderingEnabled) return
    setActiveDirectory(null)
    setPreviewDirectoryOrder(null)
  }, [directoryOrderingEnabled])

  const orderedVisibleDirectories = React.useMemo(() => {
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
  }, [previewDirectoryOrder, visibleDirectories])

  React.useEffect(() => {
    if (!previewDirectoryOrder) return
    if (!directoryOrderEqual(orderedVisibleDirectories, visibleDirectories)) {
      return
    }

    setPreviewDirectoryOrder(null)
  }, [orderedVisibleDirectories, previewDirectoryOrder, visibleDirectories])

  const matchingSessionCount = visibleDirectories.reduce((total, directory) => {
    const sessions = Object.prototype.hasOwnProperty.call(
      filteredDirectorySessions,
      directory
    )
      ? filteredDirectorySessions[directory]
      : []

    return total + sessions.length
  }, 0)

  const movePreviewDirectory = React.useCallback(
    (activeId: string, overId: string) => {
      setPreviewDirectoryOrder((current) => {
        const baseOrder = current && current.length > 0 ? current : visibleDirectories
        const oldIndex = baseOrder.indexOf(activeId)
        const newIndex = baseOrder.indexOf(overId)
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
          return current
        }
        return arrayMove(baseOrder, oldIndex, newIndex)
      })
    },
    [visibleDirectories]
  )

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveDirectory(String(event.active.id))
    setPreviewDirectoryOrder(visibleDirectories)
  }, [visibleDirectories])

  const handleDragOver = React.useCallback((event: DragOverEvent) => {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : ""
    if (!activeId || !overId || activeId === overId) return
    movePreviewDirectory(activeId, overId)
  }, [movePreviewDirectory])

  const handleDragCancel = React.useCallback(() => {
    setActiveDirectory(null)
    setPreviewDirectoryOrder(null)
  }, [])

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id)
      const overId = event.over ? String(event.over.id) : ""

      let nextOrder = previewDirectoryOrder
      if ((!nextOrder || nextOrder.length === 0) && activeId && overId && activeId !== overId) {
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
    },
    [onReorderDirectories, previewDirectoryOrder, visibleDirectories]
  )

  const renderDirectoryGroup = React.useCallback(
    (
      directory: string,
      options?: {
        isDragging?: boolean
        overlay?: boolean
        attributes?: Record<string, unknown>
        listeners?: Record<string, unknown>
      }
    ) => {
      const sessions = Object.prototype.hasOwnProperty.call(
        filteredDirectorySessions,
        directory
      )
        ? filteredDirectorySessions[directory]
        : []
      const collapsed = searchActive ? false : Boolean(collapsedDirectories[directory])
      const visibleCount = searchActive
        ? sessions.length
        : Math.min(
            sessions.length,
            directoryRenderCounts[directory] ?? INITIAL_DIRECTORY_SESSION_RENDER_COUNT
          )
      const visibleSessions = sessions.slice(0, visibleCount)
      const hasMoreSessions = visibleCount < sessions.length

      return (
        <SidebarGroup
          className={cn(
            "rounded-lg py-1",
            options?.isDragging && !options?.overlay && "opacity-0"
          )}
        >
          <div className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-sidebar-accent/70">
            <button
              type="button"
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-sidebar-foreground",
                directoryOrderingEnabled && !options?.overlay && "cursor-grab active:cursor-grabbing",
                searchActive && "cursor-default"
              )}
              aria-grabbed={
                directoryOrderingEnabled && !options?.overlay
                  ? Boolean(options?.isDragging)
                  : undefined
              }
              onClick={() => {
                if (!searchActive && !options?.overlay) {
                  onToggleDirectory(directory)
                }
              }}
              title={directory}
              {...(options?.attributes ?? {})}
              {...(options?.listeners ?? {})}
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
            </button>

            <div className="flex shrink-0 items-center gap-1">
              {onCreateSessionInDirectory && !options?.overlay ? (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  title={`Create a session in ${directory}`}
                  onClick={() => onCreateSessionInDirectory(directory)}
                >
                  <SquarePenIcon className="size-4" />
                </Button>
              ) : null}
              {onRemoveDirectory && !options?.overlay ? (
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
              {directoryIndexLoading[directory] ? (
                <div className="flex items-center gap-2 px-2 py-2 text-sm text-sidebar-foreground/70">
                  <Spinner />
                  Loading sessions…
                </div>
              ) : sessions.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <SidebarMenu>
                    {visibleSessions.map((entry) => {
                      const entryKey = sessionListEntryKey(entry)
                      const isActive =
                        Boolean(activeSessionId) && entry.id === activeSessionId
                      const isSelected =
                        entryKey.length > 0 && selectedSessionKeys.includes(entryKey)

                      return (
                        <SidebarMenuItem
                          key={entryKey || `${directory}-${entry.path || entry.title}`}
                        >
                          <div className="relative">
                            <SidebarMenuButton
                              type="button"
                              data-sidebar-session-item
                              data-session-key={entryKey}
                              isActive={isActive}
                              tooltip={entry.title}
                              className={cn(
                                "h-auto items-start gap-2 py-2 pr-10",
                                isActive && "ring-1 ring-primary/20",
                                isSelected &&
                                  "bg-primary/10 text-sidebar-foreground hover:bg-primary/15"
                              )}
                              onClick={(event) =>
                                onSessionClick?.(entry, {
                                  ctrlKey: event.ctrlKey,
                                  shiftKey: event.shiftKey,
                                })
                              }
                            >
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center justify-between gap-3">
                                  <span className="min-w-0 flex-1 truncate font-medium">
                                    {entry.title}
                                  </span>
                                  <span className="flex shrink-0 items-center gap-2">
                                    {entry.streaming ? (
                                      <Badge variant="outline">Live</Badge>
                                    ) : null}
                                    {entry.unread ? (
                                      <span className="size-2 rounded-full bg-primary" />
                                    ) : null}
                                  </span>
                                </span>
                              </span>
                            </SidebarMenuButton>

                            {entry.path &&
                            (onRenameSession || onDeleteSession) &&
                            !options?.overlay ? (
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
                                      <DropdownMenuItem
                                        onClick={() => onRenameSession(entry)}
                                      >
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
                    })}
                  </SidebarMenu>

                  {hasMoreSessions && !options?.overlay ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="justify-start"
                      onClick={() => onLoadMoreDirectorySessions(directory)}
                    >
                      Show {" "}
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
    },
    [
      activeSessionId,
      collapsedDirectories,
      directoryIndexLoading,
      directoryOrderingEnabled,
      directoryRenderCounts,
      filteredDirectorySessions,
      onCreateSessionInDirectory,
      onDeleteSession,
      onLoadMoreDirectorySessions,
      onRemoveDirectory,
      onRenameSession,
      onSessionClick,
      onToggleDirectory,
      searchActive,
      selectedSessionKeys,
    ]
  )

  return (
    <Sidebar
      collapsible="offcanvas"
      className="border-r border-sidebar-border/70"
    >
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
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-sidebar-foreground/70 hover:text-sidebar-foreground"
              disabled={searchActive || visibleDirectories.length === 0}
              onClick={onToggleAllDirectories}
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
              {allDirectoriesCollapsed ? (
                <ChevronsUpDown />
              ) : (
                <ChevronsDownUpIcon />
              )}
            </Button>
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
                    onClick={onRemoveAllDirectories}
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
            onDragCancel={directoryOrderingEnabled ? handleDragCancel : undefined}
          >
            <SortableContext
              items={orderedVisibleDirectories}
              strategy={verticalListSortingStrategy}
            >
              {orderedVisibleDirectories.map((directory) => (
                <SortableDirectoryGroup
                  key={directory}
                  id={directory}
                  disabled={!directoryOrderingEnabled}
                >
                  {({ attributes, listeners, isDragging }) =>
                    renderDirectoryGroup(directory, {
                      attributes,
                      listeners,
                      isDragging,
                    })
                  }
                </SortableDirectoryGroup>
              ))}
            </SortableContext>

            <DragOverlay>
              {activeDirectory
                ? renderDirectoryGroup(activeDirectory, {
                    overlay: true,
                  })
                : null}
            </DragOverlay>
          </DndContext>
        )}
      </SidebarContent>

      <SidebarFooter className="gap-2 border-t border-sidebar-border/70 p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton type="button" onClick={onOpenCommandPalette}>
              <SearchIcon />
              <span>Palette</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton type="button" onClick={onOpenShortcuts}>
              <KeyboardIcon />
              <span>Shortcuts</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton type="button" onClick={onOpenStatus}>
              <ActivityIcon />
              <span>Status</span>
              {statusCount > 0 ? (
                <Badge variant="outline" className="ml-auto">
                  {statusCount}
                </Badge>
              ) : null}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton type="button" onClick={onOpenSettings}>
              <Settings2Icon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
