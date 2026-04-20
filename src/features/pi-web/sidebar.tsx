import {
  ActivityIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  KeyboardIcon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  SparklesIcon,
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
import { Input } from "@/components/ui/input"
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
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import {
  DIRECTORY_SESSION_LOAD_MORE_COUNT,
  INITIAL_DIRECTORY_SESSION_RENDER_COUNT,
  relativeTime,
  sessionListEntryKey,
} from "@/lib/pi-web"
import { cn } from "@/lib/utils"

function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <Badge variant={connected ? "default" : "destructive"}>
      {connected ? "Connected" : "Disconnected"}
    </Badge>
  )
}

type SessionClickModifiers = {
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
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
  currentThemeLabel: string
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
  directoryStateByPath,
  filteredDirectorySessions,
  collapsedDirectories,
  directoryIndexLoading,
  directoryRenderCounts,
  selectedSessionKeys,
  activeSessionId,
  statusCount,
  currentThemeLabel,
  emptyStateText,
  allDirectoriesCollapsed,
  onCreateSession,
  onOpenAddDirectoryDialog,
  onOpenCommandPalette,
  onOpenShortcuts,
  onOpenStatus,
  onOpenSettings,
  onToggleDirectory,
  onToggleAllDirectories,
  onSessionClick,
  onLoadMoreDirectorySessions,
  onDeleteSelectedSessions,
  onClearSelectedSessions,
}: AppSidebarProps) {
  const searchActive = sessionSearch.trim().length > 0
  const selectedSessionCount = selectedSessionKeys.length
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
          <div className="flex min-w-0 flex-col gap-2">
            <div className="inline-flex items-center gap-2 self-start rounded-full border border-sidebar-border/80 bg-sidebar-accent/30 px-2 py-1 text-xs text-sidebar-foreground/70">
              <SparklesIcon />
              Native Pi to Go
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="truncate text-xl font-semibold tracking-tight text-sidebar-foreground">
                Pi to Go
              </h1>
              <p className="text-sm text-sidebar-foreground/70">
                TanStack Start + shadcn rebuild of pi-web.
              </p>
            </div>
          </div>
          <ConnectionBadge connected={connected} />
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={onCreateSession}>
            <PlusIcon data-icon="inline-start" />
            New
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onOpenAddDirectoryDialog}
          >
            <FolderIcon data-icon="inline-start" />
            Add dir
          </Button>
        </div>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sidebar-foreground/50" />
          <Input
            ref={sessionSearchInputRef}
            value={sessionSearch}
            onChange={(event) => onSessionSearchChange(event.target.value)}
            placeholder="Search sessions or directories"
            className="border-sidebar-border/70 bg-sidebar-accent/20 pl-9"
          />
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-sidebar-foreground/70">
          <span>
            {searchActive
              ? `${matchingSessionCount} matching session${matchingSessionCount === 1 ? "" : "s"}`
              : `${visibleDirectories.length} director${visibleDirectories.length === 1 ? "y" : "ies"}`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-auto px-0 text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground"
            disabled={searchActive || visibleDirectories.length === 0}
            onClick={onToggleAllDirectories}
          >
            {allDirectoriesCollapsed ? "Expand all" : "Collapse all"}
          </Button>
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
                    Cmd/Ctrl-click toggles. Shift-click selects a range.
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
          visibleDirectories.map((directory) => {
            const sessions = Object.prototype.hasOwnProperty.call(
              filteredDirectorySessions,
              directory
            )
              ? filteredDirectorySessions[directory]
              : []
            const directoryState = directoryStateByPath.get(directory)
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
            const countLabel = searchActive
              ? `${sessions.length} match${sessions.length === 1 ? "" : "es"}`
              : `${directoryState ? directoryState.totalCount : sessions.length} sessions`

            return (
              <SidebarGroup key={directory} className="py-1">
                <SidebarGroupLabel
                  render={<button type="button" />}
                  className={cn(
                    "h-auto items-start gap-2 rounded-lg px-2 py-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    searchActive && "cursor-default"
                  )}
                  onClick={() => {
                    if (!searchActive) {
                      onToggleDirectory(directory)
                    }
                  }}
                >
                  <FolderIcon className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-sidebar-foreground">
                      {directory}
                    </span>
                    <span className="mt-0.5 block text-xs text-sidebar-foreground/70">
                      {countLabel}
                    </span>
                  </span>
                  {!searchActive ? (
                    collapsed ? (
                      <ChevronRightIcon />
                    ) : (
                      <ChevronDownIcon />
                    )
                  ) : null}
                </SidebarGroupLabel>

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
                                <SidebarMenuButton
                                  type="button"
                                  data-sidebar-session-item
                                  data-session-key={entryKey}
                                  isActive={isActive}
                                  tooltip={entry.title}
                                  className={cn(
                                    "h-auto items-start gap-3 py-2",
                                    isActive &&
                                      "ring-1 ring-primary/20 hover:bg-sidebar-accent",
                                    isSelected &&
                                      !isActive &&
                                      "bg-primary/10 text-sidebar-foreground hover:bg-primary/15"
                                  )}
                                  onClick={(event) =>
                                    onSessionClick?.(entry, {
                                      metaKey: event.metaKey,
                                      ctrlKey: event.ctrlKey,
                                      shiftKey: event.shiftKey,
                                    })
                                  }
                                >
                                  <span
                                    className={cn(
                                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                                      isSelected
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-sidebar-border bg-background"
                                    )}
                                    aria-hidden="true"
                                  >
                                    {isSelected ? (
                                      <CheckIcon className="size-3" />
                                    ) : null}
                                  </span>
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
                                    <span className="mt-0.5 block text-xs text-sidebar-foreground/70">
                                      {relativeTime(entry.modified)}
                                    </span>
                                  </span>
                                </SidebarMenuButton>
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
        <div className="px-2 text-xs text-sidebar-foreground/70">
          {currentThemeLabel}
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
