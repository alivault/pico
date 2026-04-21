import * as React from "react"

import {
  ActivityIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  EllipsisIcon,
  FolderIcon,
  FolderPlusIcon,
  KeyboardIcon,
  SearchIcon,
  SquarePenIcon,
  Settings2Icon,
  Trash2Icon,
  XIcon,
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
  SidebarSeparator,
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

type DirectoryDropPosition = "before" | "after"

function directoryOrderEqual(left: Array<string>, right: Array<string>) {
  if (left.length !== right.length) return false

  return left.every((directory, index) => directory === right[index])
}

function reorderDirectories(
  directories: Array<string>,
  sourceDirectory: string,
  targetDirectory: string,
  position: DirectoryDropPosition
) {
  const normalizedSource = sourceDirectory.trim()
  const normalizedTarget = targetDirectory.trim()

  if (
    !normalizedSource ||
    !normalizedTarget ||
    normalizedSource === normalizedTarget ||
    !directories.includes(normalizedSource) ||
    !directories.includes(normalizedTarget)
  ) {
    return null
  }

  const reordered = directories.filter(
    (directory) => directory !== normalizedSource
  )
  const targetIndex = reordered.indexOf(normalizedTarget)
  const insertIndex =
    targetIndex < 0
      ? reordered.length
      : position === "before"
        ? targetIndex
        : targetIndex + 1

  reordered.splice(insertIndex, 0, normalizedSource)
  return directoryOrderEqual(reordered, directories) ? null : reordered
}

type AppSidebarProps = {
  connected: boolean
  sessionSearch: string
  onSessionSearchChange: (value: string) => void
  sessionSearchInputRef?: React.Ref<HTMLInputElement>
  visibleDirectories: Array<string>
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
  onReorderDirectories?: (
    sourceDirectory: string,
    targetDirectory: string,
    position: DirectoryDropPosition
  ) => void
  onLoadMoreDirectorySessions: (directory: string) => void
  onDeleteSelectedSessions: () => void
  onClearSelectedSessions: () => void
}

export function AppSidebar({
  connected,
  sessionSearch,
  onSessionSearchChange,
  sessionSearchInputRef,
  visibleDirectories,
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
  onReorderDirectories,
  onLoadMoreDirectorySessions,
  onDeleteSelectedSessions,
  onClearSelectedSessions,
}: AppSidebarProps) {
  const searchActive = sessionSearch.trim().length > 0
  const selectedSessionCount = selectedSessionKeys.length
  const directoryOrderingEnabled = !searchActive && visibleDirectories.length > 1
  const [draggingDirectory, setDraggingDirectory] = React.useState("")
  const [previewDirectoryOrder, setPreviewDirectoryOrder] = React.useState<
    Array<string> | null
  >(null)
  const directoryDropCommittedRef = React.useRef(false)
  const directoryGroupRefs = React.useRef(new Map<string, HTMLDivElement>())
  const directoryDragPreviewRef = React.useRef<HTMLDivElement | null>(null)
  const previousDirectoryPositionsRef = React.useRef(
    new Map<string, number>()
  )

  const clearDirectoryDragPreview = React.useCallback(() => {
    directoryDragPreviewRef.current?.remove()
    directoryDragPreviewRef.current = null
  }, [])

  React.useEffect(() => {
    if (directoryOrderingEnabled) return
    setDraggingDirectory("")
    setPreviewDirectoryOrder(null)
    directoryDropCommittedRef.current = false
    clearDirectoryDragPreview()
  }, [clearDirectoryDragPreview, directoryOrderingEnabled])

  React.useEffect(() => {
    return () => {
      clearDirectoryDragPreview()
    }
  }, [clearDirectoryDragPreview])

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
    directoryDropCommittedRef.current = false
  }, [orderedVisibleDirectories, previewDirectoryOrder, visibleDirectories])

  React.useLayoutEffect(() => {
    const nextPositions = new Map<string, number>()

    for (const directory of orderedVisibleDirectories) {
      const node = directoryGroupRefs.current.get(directory)
      if (!node) continue

      const top = node.getBoundingClientRect().top
      nextPositions.set(directory, top)

      const previousTop = previousDirectoryPositionsRef.current.get(directory)
      const deltaY = previousTop == null ? 0 : previousTop - top
      if (Math.abs(deltaY) < 1) continue

      node.style.transition = "none"
      node.style.transform = `translateY(${deltaY}px)`
      node.style.willChange = "transform"
      node.getBoundingClientRect()
      node.style.transition = "transform 160ms cubic-bezier(0.2, 0, 0, 1)"
      node.style.transform = ""

      const cleanup = () => {
        node.style.transition = ""
        node.style.willChange = ""
        node.removeEventListener("transitionend", cleanup)
      }

      node.addEventListener("transitionend", cleanup)
    }

    previousDirectoryPositionsRef.current = nextPositions
  })

  const matchingSessionCount = visibleDirectories.reduce((total, directory) => {
    const sessions = Object.prototype.hasOwnProperty.call(
      filteredDirectorySessions,
      directory
    )
      ? filteredDirectorySessions[directory]
      : []

    return total + sessions.length
  }, 0)

  return (
    <Sidebar
      collapsible="offcanvas"
      className="border-r border-sidebar-border/70"
    >
      <SidebarHeader className="gap-3 border-b border-sidebar-border/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-xl font-semibold tracking-tight text-sidebar-foreground">
              Pi to Go
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
              <ChevronsDownUpIcon />
            </Button>
            <Button
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
        {selectedSessionCount > 0 ? (
          <SidebarGroup className="px-2 py-0">
            <div className="rounded-xl border border-primary/20 bg-primary/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="text-sm font-medium text-sidebar-foreground">
                    {selectedSessionCount} selected
                  </div>
                  <div className="text-xs text-sidebar-foreground/70">
                    Ctrl-click toggles. Shift-click selects a range.
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onClearSelectedSessions}
                  >
                    <XIcon data-icon="inline-start" />
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={onDeleteSelectedSessions}
                  >
                    <Trash2Icon data-icon="inline-start" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </SidebarGroup>
        ) : null}

        {selectedSessionCount > 0 && visibleDirectories.length > 0 ? (
          <SidebarSeparator />
        ) : null}

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
          orderedVisibleDirectories.map((directory) => {
            const sessions = Object.prototype.hasOwnProperty.call(
              filteredDirectorySessions,
              directory
            )
              ? filteredDirectorySessions[directory]
              : []
            const collapsed = searchActive
              ? false
              : Boolean(collapsedDirectories[directory])
            const visibleCount = searchActive
              ? sessions.length
              : Math.min(
                  sessions.length,
                  directoryRenderCounts[directory] ??
                    INITIAL_DIRECTORY_SESSION_RENDER_COUNT
                )
            const visibleSessions = sessions.slice(0, visibleCount)
            const hasMoreSessions = visibleCount < sessions.length
            const isDragSource = draggingDirectory === directory

            return (
              <div
                key={directory}
                ref={(node) => {
                  if (node) {
                    directoryGroupRefs.current.set(directory, node)
                  } else {
                    directoryGroupRefs.current.delete(directory)
                  }
                }}
              >
                <SidebarGroup
                  className={cn(
                    "rounded-lg py-1 transition-opacity",
                    isDragSource && "opacity-60"
                  )}
                  onDragOver={(event) => {
                    if (!directoryOrderingEnabled || draggingDirectory === directory) {
                      return
                    }
                    event.preventDefault()
                    const bounds = event.currentTarget.getBoundingClientRect()
                    const position: DirectoryDropPosition =
                      event.clientY < bounds.top + bounds.height / 2
                        ? "before"
                        : "after"
                    const nextOrder = reorderDirectories(
                      orderedVisibleDirectories,
                      draggingDirectory,
                      directory,
                      position
                    )

                    if (!nextOrder) return
                    setPreviewDirectoryOrder(nextOrder)
                    event.dataTransfer.dropEffect = "move"
                  }}
                  onDrop={(event) => {
                    if (!directoryOrderingEnabled) return
                    event.preventDefault()
                    const sourceDirectory =
                      event.dataTransfer.getData("text/pi-sidebar-directory") ||
                      draggingDirectory
                    const bounds = event.currentTarget.getBoundingClientRect()
                    const position: DirectoryDropPosition =
                      event.clientY < bounds.top + bounds.height / 2
                        ? "before"
                        : "after"
                    const nextOrder = reorderDirectories(
                      visibleDirectories,
                      sourceDirectory,
                      directory,
                      position
                    )

                    setDraggingDirectory("")
                    if (!sourceDirectory || !onReorderDirectories || !nextOrder) {
                      setPreviewDirectoryOrder(null)
                      directoryDropCommittedRef.current = false
                      return
                    }

                    directoryDropCommittedRef.current = true
                    setPreviewDirectoryOrder(nextOrder)
                    onReorderDirectories(sourceDirectory, directory, position)
                  }}
                >
                <div className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-sidebar-accent/70">
                  <button
                    type="button"
                    draggable={directoryOrderingEnabled}
                    className={cn(
                      "flex min-w-0 flex-1 items-start gap-2 text-left text-sm text-sidebar-foreground",
                      directoryOrderingEnabled &&
                        "cursor-grab active:cursor-grabbing",
                      searchActive && "cursor-default"
                    )}
                    aria-grabbed={directoryOrderingEnabled ? isDragSource : undefined}
                    onDragStart={(event) => {
                      if (!directoryOrderingEnabled) {
                        event.preventDefault()
                        return
                      }

                      directoryDropCommittedRef.current = false
                      setDraggingDirectory(directory)
                      setPreviewDirectoryOrder(visibleDirectories)
                      event.dataTransfer.effectAllowed = "move"
                      event.dataTransfer.setData(
                        "text/pi-sidebar-directory",
                        directory
                      )

                      clearDirectoryDragPreview()
                      const dragPreviewSource =
                        directoryGroupRefs.current.get(directory)

                      if (dragPreviewSource) {
                        const rect = dragPreviewSource.getBoundingClientRect()
                        const preview = dragPreviewSource.cloneNode(
                          true
                        ) as HTMLDivElement

                        preview.setAttribute("aria-hidden", "true")
                        preview.style.position = "fixed"
                        preview.style.top = "0"
                        preview.style.left = "0"
                        preview.style.width = `${Math.round(rect.width)}px`
                        preview.style.pointerEvents = "none"
                        preview.style.zIndex = "9999"
                        preview.style.margin = "0"
                        preview.style.boxSizing = "border-box"
                        preview.style.transition = "none"
                        preview.style.transform = "translate(-200vw, -200vh)"

                        for (const control of preview.querySelectorAll("button")) {
                          if (control instanceof HTMLButtonElement) {
                            control.disabled = true
                            control.tabIndex = -1
                          }
                        }

                        document.body.appendChild(preview)
                        directoryDragPreviewRef.current = preview
                        event.dataTransfer.setDragImage(
                          preview,
                          event.clientX - rect.left,
                          event.clientY - rect.top
                        )
                      }
                    }}
                    onDragEnd={() => {
                      setDraggingDirectory("")
                      clearDirectoryDragPreview()
                      if (!directoryDropCommittedRef.current) {
                        setPreviewDirectoryOrder(null)
                      }
                    }}
                    onClick={() => {
                      if (!searchActive) {
                        onToggleDirectory(directory)
                      }
                    }}
                    title={directory}
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
                    {onCreateSessionInDirectory ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        title={`Create a session in ${directory}`}
                        onClick={() => onCreateSessionInDirectory(directory)}
                      >
                        <SquarePenIcon className="size-4" />
                      </Button>
                    ) : null}
                    {onRemoveDirectory ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button size="icon-xs" variant="ghost" />}
                        >
                          <EllipsisIcon className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            onClick={() => onRemoveDirectory(directory)}
                          >
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
                              Boolean(activeSessionId) &&
                              entry.id === activeSessionId
                            const isSelected =
                              entryKey.length > 0 &&
                              selectedSessionKeys.includes(entryKey)

                            return (
                              <SidebarMenuItem
                                key={
                                  entryKey ||
                                  `${directory}-${entry.path || entry.title}`
                                }
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

                                  {entry.path && (onRenameSession || onDeleteSession) ? (
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
                                        <DropdownMenuContent
                                          align="end"
                                          className="w-40"
                                        >
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

                        {hasMoreSessions ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="justify-start"
                            onClick={() =>
                              onLoadMoreDirectorySessions(directory)
                            }
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
                        {searchActive
                          ? "No matching sessions."
                          : "No sessions yet."}
                      </div>
                    )}
                  </SidebarGroupContent>
                ) : null}
                </SidebarGroup>
              </div>
            )
          })
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
