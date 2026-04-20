import {
  ActivityIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  KeyboardIcon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  SparklesIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import {
  DIRECTORY_SESSION_LOAD_MORE_COUNT,
  INITIAL_DIRECTORY_SESSION_RENDER_COUNT,
  relativeTime,
  type DirectoryState,
} from "@/lib/pi-web"
import type { SessionListEntry } from "@/lib/pi-web-api"

function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <Badge variant={connected ? "default" : "destructive"}>
      {connected ? "Connected" : "Disconnected"}
    </Badge>
  )
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
  activeSessionId?: string
  statusCount: number
  currentThemeLabel: string
  onCreateSession: () => void
  onOpenAddDirectoryDialog: () => void
  onOpenCommandPalette: () => void
  onOpenShortcuts: () => void
  onOpenStatus: () => void
  onOpenSettings: () => void
  onToggleDirectory: (directory: string) => void
  onSelectSession?: (sessionId?: string) => void
  onLoadMoreDirectorySessions: (directory: string) => void
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
  activeSessionId,
  statusCount,
  currentThemeLabel,
  onCreateSession,
  onOpenAddDirectoryDialog,
  onOpenCommandPalette,
  onOpenShortcuts,
  onOpenStatus,
  onOpenSettings,
  onToggleDirectory,
  onSelectSession,
  onLoadMoreDirectorySessions,
}: AppSidebarProps) {
  const searchActive = sessionSearch.trim().length > 0

  return (
    <aside className="border-border/70 bg-card/50 lg:border-r">
      <div className="flex h-full flex-col">
        <div className="border-b border-border/70 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs text-muted-foreground">
                <SparklesIcon className="size-3.5" />
                Native Pi to Go
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">
                  Pi to Go
                </h1>
                <p className="text-sm text-muted-foreground">
                  TanStack Start + shadcn rebuild of pi-web.
                </p>
              </div>
            </div>
            <ConnectionBadge connected={connected} />
          </div>
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={onCreateSession}>
              <PlusIcon /> New
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onOpenAddDirectoryDialog}
            >
              <FolderIcon /> Add dir
            </Button>
          </div>
          <div className="mt-4">
            <Input
              ref={sessionSearchInputRef}
              value={sessionSearch}
              onChange={(event) => onSessionSearchChange(event.target.value)}
              placeholder="Search sessions"
            />
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1 px-4 py-4">
          <div className="space-y-3">
            {visibleDirectories.map((directory) => {
              const sessions = filteredDirectorySessions[directory] || []
              const directoryState = directoryStateByPath.get(directory)
              const collapsed = Boolean(collapsedDirectories[directory])
              const visibleCount = searchActive
                ? sessions.length
                : Math.min(
                    sessions.length,
                    directoryRenderCounts[directory] ??
                      INITIAL_DIRECTORY_SESSION_RENDER_COUNT
                  )
              const visibleSessions = sessions.slice(0, visibleCount)
              const hasMoreSessions = visibleCount < sessions.length

              return (
                <Card key={directory} size="sm">
                  <CardHeader className="pb-2">
                    <button
                      type="button"
                      className="flex items-center justify-between gap-3 text-left"
                      onClick={() => onToggleDirectory(directory)}
                    >
                      <div className="min-w-0">
                        <CardTitle className="truncate text-sm">
                          {directory}
                        </CardTitle>
                        <CardDescription>
                          {directoryState?.totalCount ?? sessions.length}{" "}
                          sessions
                        </CardDescription>
                      </div>
                      {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
                    </button>
                  </CardHeader>
                  {!collapsed && (
                    <CardContent className="space-y-2">
                      {directoryIndexLoading[directory] ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Spinner /> Loading sessions…
                        </div>
                      ) : sessions.length > 0 ? (
                        <>
                          {visibleSessions.map((entry) => {
                            const isActive =
                              activeSessionId && entry.id === activeSessionId

                            return (
                              <button
                                key={`${directory}-${entry.id || entry.path || entry.title}`}
                                type="button"
                                onClick={() => onSelectSession?.(entry.id)}
                                className={[
                                  "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                                  isActive
                                    ? "border-primary bg-primary/10"
                                    : "hover:bg-muted/50",
                                ].join(" ")}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium">
                                      {entry.title}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {relativeTime(entry.modified)}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {entry.streaming && (
                                      <Badge variant="outline">Live</Badge>
                                    )}
                                    {entry.unread && (
                                      <span className="size-2 rounded-full bg-primary" />
                                    )}
                                  </div>
                                </div>
                              </button>
                            )
                          })}
                          {hasMoreSessions ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full"
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
                        </>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          {searchActive
                            ? "No matching sessions."
                            : "No sessions yet."}
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              )
            })}
          </div>
        </ScrollArea>

        <div className="border-t border-border/70 px-4 py-4">
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={onOpenCommandPalette}>
              <SearchIcon /> Palette
            </Button>
            <Button size="sm" variant="outline" onClick={onOpenShortcuts}>
              <KeyboardIcon /> Shortcuts
            </Button>
            <Button size="sm" variant="outline" onClick={onOpenStatus}>
              <ActivityIcon />
              Status
              {statusCount > 0 ? ` (${statusCount})` : ""}
            </Button>
            <Button size="sm" variant="outline" onClick={onOpenSettings}>
              <Settings2Icon /> Settings
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {currentThemeLabel}
          </p>
        </div>
      </div>
    </aside>
  )
}
