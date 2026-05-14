import * as React from "react"
import { ArrowLeftIcon } from "lucide-react"

import type {
  DirectorySessionsIndexesResponse,
  SessionListEntry,
  SessionStatusEvent,
} from "@/lib/pico/api"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  formatShortcutLabel,
  matchesShortcutEvent,
} from "@/features/pico/keyboard-shortcuts"
import { useIsMobile } from "@/hooks/use-mobile"
import { sessionListEntryKey } from "@/lib/pico"
import { cn } from "@/lib/utils"

type SessionsDialogScope = "current" | "all"
type SessionsDialogStage = "browse" | "rename" | "delete"

type SessionStatusByKey = Record<string, Omit<SessionStatusEvent, "type">>

type SelectSessionOptions = {
  replace?: boolean
  sessionPath?: string
}

type AppShellSessionsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  viewerContextId: string
  currentDirectory: string
  knownDirectories: Array<string>
  directorySessionsByPath: Record<string, Array<SessionListEntry>>
  sessionStatusByKey: SessionStatusByKey
  activeSessionId?: string
  activeSessionPath?: string
  onSelectSession: (sessionId?: string, options?: SelectSessionOptions) => void
  onRenameSession: (
    path: string,
    name: string
  ) => Promise<boolean> | boolean | void
  onDeleteSession: (
    targets: Array<SessionListEntry>
  ) => Promise<boolean> | boolean | void
  onError?: (error: unknown) => void
}

export type AppShellSessionsDialogHandle = {
  open: () => void
  close: () => void
  isOpen: () => boolean
}

function tildePath(value: string) {
  return value
    .replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/home\/[^/]+(?=\/|$)/, "~")
}

function normalizeDirectories(directories: Array<string>) {
  const seen = new Set<string>()
  const normalized: Array<string> = []

  for (const directory of directories) {
    const value = directory.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    normalized.push(value)
  }

  return normalized
}

function formatSessionTime(value?: string, now = Date.now()) {
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

function sessionActivityTime(entry: SessionListEntry) {
  const timestamp = entry.lastUserMessageAt || entry.modified
  if (!timestamp) return 0

  const time = new Date(timestamp).getTime()
  return Number.isNaN(time) ? 0 : time
}

function sessionStatusForEntry(
  entry: SessionListEntry,
  statuses: SessionStatusByKey
) {
  const pathKey = entry.path ? `path:${entry.path}` : ""
  const idKey = entry.id ? `id:${entry.id}` : ""

  return (
    (pathKey ? statuses[pathKey] : undefined) ||
    (idKey ? statuses[idKey] : undefined)
  )
}

function applyLocalSessionName(
  entry: SessionListEntry,
  localSessionNames: Record<string, string>
) {
  const localName = entry.path ? localSessionNames[entry.path] : undefined
  if (!localName || entry.title === localName) return entry

  return {
    ...entry,
    name: localName,
    title: localName,
  }
}

function applySessionStatus(
  entry: SessionListEntry,
  status: Omit<SessionStatusEvent, "type"> | undefined
) {
  if (!status) return entry

  const nextStreaming =
    typeof status.streaming === "boolean" ? status.streaming : entry.streaming
  const nextUnread =
    typeof status.unread === "boolean" ? status.unread : entry.unread

  if (
    Boolean(entry.streaming) === Boolean(nextStreaming) &&
    Boolean(entry.unread) === Boolean(nextUnread)
  ) {
    return entry
  }

  return {
    ...entry,
    streaming: nextStreaming,
    unread: nextUnread,
  }
}

function sessionSearchKeywords(entry: SessionListEntry, directory: string) {
  return [entry.title, entry.name, entry.path, entry.cwd, directory].filter(
    Boolean
  ) as Array<string>
}

function isActiveSession(
  entry: SessionListEntry,
  activeSessionId?: string,
  activeSessionPath?: string
) {
  return Boolean(
    (entry.id && activeSessionId && entry.id === activeSessionId) ||
    (entry.path && activeSessionPath && entry.path === activeSessionPath)
  )
}

function fetchDirectorySessionsIndexes(
  viewerContextId: string,
  directories: Array<string>
) {
  return fetchJson<DirectorySessionsIndexesResponse>(
    buildRequestUrl("/api/directory-sessions-indexes", {
      contextId: viewerContextId,
      searchParams: {
        directory: directories,
      },
    })
  )
}

function FooterKbd({ children }: { children: React.ReactNode }) {
  return <Kbd>{children}</Kbd>
}

function AppShellSessionsDialog({
  open,
  onOpenChange,
  viewerContextId,
  currentDirectory,
  knownDirectories,
  directorySessionsByPath,
  sessionStatusByKey,
  activeSessionId,
  activeSessionPath,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onError,
}: AppShellSessionsDialogProps) {
  const isMobile = useIsMobile()
  const [query, setQuery] = React.useState("")
  const [scope, setScope] = React.useState<SessionsDialogScope>("current")
  const [stage, setStage] = React.useState<SessionsDialogStage>("browse")
  const [selectedSessionKey, setSelectedSessionKey] = React.useState("")
  const [renameValue, setRenameValue] = React.useState("")
  const [localSessionNames, setLocalSessionNames] = React.useState<
    Record<string, string>
  >({})
  const [loadedSessionsByPath, setLoadedSessionsByPath] = React.useState<
    Record<string, Array<SessionListEntry>>
  >({})
  const [loadingByPath, setLoadingByPath] = React.useState<
    Record<string, boolean>
  >({})
  const normalizedCurrentDirectory = currentDirectory.trim()
  const allDirectories = normalizeDirectories([
    normalizedCurrentDirectory,
    ...knownDirectories,
    ...Object.keys(directorySessionsByPath),
  ])
  const currentDirectories = normalizedCurrentDirectory
    ? [normalizedCurrentDirectory]
    : allDirectories.slice(0, 1)
  const scopedDirectories =
    scope === "all" ? allDirectories : currentDirectories
  const mergedSessionsByPath: Record<string, Array<SessionListEntry>> = {
    ...loadedSessionsByPath,
    ...directorySessionsByPath,
  }
  const visibleGroups = scopedDirectories.map((directory) => {
    const sessions = (mergedSessionsByPath[directory] || []).map((entry) =>
      applyLocalSessionName(
        applySessionStatus(
          entry,
          sessionStatusForEntry(entry, sessionStatusByKey)
        ),
        localSessionNames
      )
    )

    return {
      directory,
      sessions,
      loading: Boolean(loadingByPath[directory]),
    }
  })
  const flatSessions = visibleGroups.flatMap((group) =>
    group.sessions.map((entry) => ({
      directory: group.directory,
      entry,
      key: sessionListEntryKey(entry),
    }))
  )
  const sortedSessionItems = flatSessions.toSorted(
    (left, right) =>
      sessionActivityTime(right.entry) - sessionActivityTime(left.entry)
  )
  const selectedSession = selectedSessionKey
    ? flatSessions.find((session) => session.key === selectedSessionKey)?.entry
    : undefined
  const loading = visibleGroups.some((group) => group.loading)

  React.useEffect(() => {
    if (!open) {
      if (query) setQuery("")
      setScope("current")
      setStage("browse")
      setRenameValue("")
      return
    }
  }, [open, query])

  React.useEffect(() => {
    if (!open || !viewerContextId || scopedDirectories.length === 0) return

    const missingDirectories = scopedDirectories.filter(
      (directory) =>
        !Object.prototype.hasOwnProperty.call(
          mergedSessionsByPath,
          directory
        ) && !loadingByPath[directory]
    )

    if (missingDirectories.length === 0) return

    setLoadingByPath((current) => {
      const next = { ...current }
      for (const directory of missingDirectories) next[directory] = true
      return next
    })

    void fetchDirectorySessionsIndexes(viewerContextId, missingDirectories)
      .then((response) => {
        if (!response.ok) return

        setLoadedSessionsByPath((current) => {
          const next = { ...current }
          for (const directory of missingDirectories) {
            next[directory] =
              response.directoryIndexes[directory]?.sessions || []
          }
          return next
        })
      })
      .catch((error: unknown) => {
        onError?.(error)
      })
      .finally(() => {
        setLoadingByPath((current) => {
          const next = { ...current }
          for (const directory of missingDirectories) delete next[directory]
          return next
        })
      })
  }, [
    loadingByPath,
    mergedSessionsByPath,
    onError,
    open,
    scopedDirectories,
    viewerContextId,
  ])

  React.useEffect(() => {
    if (!open) return

    const selectedStillVisible = flatSessions.some(
      (session) => session.key === selectedSessionKey
    )
    if (selectedStillVisible) return

    if (stage !== "browse") {
      setStage("browse")
      setRenameValue("")
    }

    const activeSession = flatSessions.find((session) =>
      isActiveSession(session.entry, activeSessionId, activeSessionPath)
    )
    setSelectedSessionKey(activeSession?.key || flatSessions[0]?.key || "")
  }, [
    activeSessionId,
    activeSessionPath,
    flatSessions,
    open,
    selectedSessionKey,
    stage,
  ])

  const toggleScope = () => {
    setScope((current) => (current === "current" ? "all" : "current"))
  }

  const selectSession = (entry: SessionListEntry) => {
    if (!entry.id) return
    onOpenChange(false)
    onSelectSession(entry.id, { sessionPath: entry.path })
  }

  const renameSelectedSession = () => {
    if (!selectedSession?.path) return
    setRenameValue(selectedSession.title)
    setStage("rename")
  }

  const saveSelectedSessionRename = async () => {
    const targetPath = selectedSession?.path
    const nextName = renameValue.trim()
    if (!targetPath) return

    const success = await Promise.resolve(onRenameSession(targetPath, nextName))
    if (success === false) return

    setLocalSessionNames((current) => ({
      ...current,
      [targetPath]: nextName,
    }))
    setStage("browse")
  }

  const deleteSelectedSession = () => {
    if (!selectedSession?.path) return
    setStage("delete")
  }

  const confirmDeleteSelectedSession = async () => {
    const targetPath = selectedSession?.path
    if (!selectedSession || !targetPath) return

    const target: SessionListEntry = { ...selectedSession, path: targetPath }
    const success = await Promise.resolve(onDeleteSession([target]))
    if (success === false) return

    setLoadedSessionsByPath((current) => {
      const next: Record<string, Array<SessionListEntry>> = {}
      let changed = false

      for (const [directory, sessions] of Object.entries(current)) {
        const filteredSessions = sessions.filter(
          (entry) => entry.path !== targetPath
        )
        next[directory] = filteredSessions
        if (filteredSessions.length !== sessions.length) changed = true
      }

      return changed ? next : current
    })
    setLocalSessionNames((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, targetPath)) {
        return current
      }

      const next = { ...current }
      delete next[targetPath]
      return next
    })
    setSelectedSessionKey("")
    setStage("browse")
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const key = event.key.toLowerCase()

    if (key === "tab") {
      event.preventDefault()
      toggleScope()
      return
    }

    if (matchesShortcutEvent(event.nativeEvent, "Control+R")) {
      event.preventDefault()
      renameSelectedSession()
      return
    }

    if (matchesShortcutEvent(event.nativeEvent, "Control+D")) {
      event.preventDefault()
      deleteSelectedSession()
    }
  }

  const sessionsBrowseBody = (
    <Command
      shouldFilter
      loop
      value={selectedSessionKey}
      onValueChange={setSelectedSessionKey}
      onKeyDown={handleKeyDown}
      className="min-h-0 flex-1"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={
          scope === "all" ? "Search all sessions" : "Search sessions"
        }
        className="text-base md:text-sm"
      />
      <CommandList className="max-h-none min-h-0 flex-1 md:max-h-[min(70vh,32rem)]">
        <CommandEmpty>
          {loading ? "Loading sessions…" : "No sessions found."}
        </CommandEmpty>
        <CommandGroup
          heading={`${scope === "all" ? "All sessions" : `Current directory: ${tildePath(currentDirectories[0] || "")}`}${loading ? " · loading" : ""}`}
        >
          {loading && sortedSessionItems.length === 0 ? (
            <CommandItem value="loading:sessions" disabled>
              <Spinner className="size-3.5 text-primary" />
              <span className="text-muted-foreground">Loading sessions…</span>
            </CommandItem>
          ) : null}
          {sortedSessionItems.map(({ directory, entry }) => {
            const entryKey = sessionListEntryKey(entry)
            const timestamp = entry.lastUserMessageAt || entry.modified
            const sessionTime = formatSessionTime(timestamp)
            const active = isActiveSession(
              entry,
              activeSessionId,
              activeSessionPath
            )
            const showUnread = Boolean(entry.unread) && !entry.streaming

            return (
              <CommandItem
                key={entryKey}
                value={entryKey}
                keywords={sessionSearchKeywords(entry, directory)}
                onSelect={() => selectSession(entry)}
                className="items-start py-2"
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                  {entry.streaming ? (
                    <Spinner
                      className="size-3.5 text-primary"
                      aria-label="Session streaming"
                    />
                  ) : showUnread ? (
                    <span
                      className="size-2 rounded-full bg-primary"
                      aria-label="Session done"
                    />
                  ) : null}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{entry.title}</span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    {tildePath(entry.cwd || directory)}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {sessionTime ? (
                    <span className="truncate text-[11px] text-muted-foreground/70">
                      {sessionTime}
                    </span>
                  ) : null}
                  <CommandShortcut
                    className={cn(
                      "ml-0 shrink-0 tracking-normal normal-case",
                      !active && "opacity-0"
                    )}
                  >
                    Current
                  </CommandShortcut>
                </div>
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
      {!isMobile ? (
        <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
          <span className="inline-flex items-center gap-1">
            <FooterKbd>Tab</FooterKbd>
            {scope === "all" ? "Current directory" : "All sessions"}
          </span>
          <span className="inline-flex items-center gap-1">
            <FooterKbd>Enter</FooterKbd> Switch
          </span>
          <span className="inline-flex items-center gap-1">
            <FooterKbd>{formatShortcutLabel("Control+R")}</FooterKbd> Rename
          </span>
          <span className="inline-flex items-center gap-1">
            <FooterKbd>{formatShortcutLabel("Control+D")}</FooterKbd> Delete
          </span>
          <span className="inline-flex items-center gap-1">
            <FooterKbd>Esc</FooterKbd> Close
          </span>
        </div>
      ) : null}
    </Command>
  )

  const sessionsRenameBody = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setStage("browse")}
          aria-label="Back to sessions"
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">Rename session</div>
          <div className="truncate text-xs text-muted-foreground">
            {selectedSession?.title || "Selected session"}
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center p-3">
        <Input
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              setStage("browse")
              return
            }
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return
            event.preventDefault()
            event.stopPropagation()
            void saveSelectedSessionRename()
          }}
          placeholder="Session name"
          className="min-w-0 flex-1"
        />
      </div>
      {isMobile ? null : (
        <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
          <span className="inline-flex items-center gap-1">
            <FooterKbd>Enter</FooterKbd> Save
          </span>
          <span className="inline-flex items-center gap-1">
            <FooterKbd>Esc</FooterKbd> Back
          </span>
        </div>
      )}
    </div>
  )

  const sessionsDeleteBody = (
    <div
      role="presentation"
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          setStage("browse")
          return
        }
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return
        event.preventDefault()
        event.stopPropagation()
        void confirmDeleteSelectedSession()
      }}
    >
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setStage("browse")}
          aria-label="Back to sessions"
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">Delete session</div>
          <div className="truncate text-xs text-muted-foreground">
            {selectedSession?.title || "Selected session"}
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center p-3">
        <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          Delete "{selectedSession?.title || "New session"}" from disk?
        </p>
      </div>
      {isMobile ? null : (
        <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground md:flex">
          <span className="inline-flex items-center gap-1">
            <FooterKbd>Enter</FooterKbd> Delete
          </span>
          <span className="inline-flex items-center gap-1">
            <FooterKbd>Esc</FooterKbd> Back
          </span>
        </div>
      )}
    </div>
  )

  const sessionsCommandBody =
    stage === "rename"
      ? sessionsRenameBody
      : stage === "delete"
        ? sessionsDeleteBody
        : sessionsBrowseBody

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[90svh] overflow-hidden">
          <DrawerHeader>
            <DrawerTitle>Sessions</DrawerTitle>
            <DrawerDescription>Search and switch sessions.</DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
            {sessionsCommandBody}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Sessions"
      description="Search and switch sessions. Press Tab to toggle current directory and all sessions."
      className="sm:max-w-2xl"
      initialFocus
    >
      {sessionsCommandBody}
    </CommandDialog>
  )
}

type AppShellSessionsDialogControllerProps = Omit<
  AppShellSessionsDialogProps,
  "open" | "onOpenChange"
> & {
  ref?: React.Ref<AppShellSessionsDialogHandle>
  openStateRef?: React.RefObject<boolean>
}

export function AppShellSessionsDialogController({
  ref,
  openStateRef,
  ...props
}: AppShellSessionsDialogControllerProps) {
  const [open, setOpen] = React.useState(false)
  const openRef = React.useRef(open)

  const setOpenState = (nextOpen: boolean) => {
    openRef.current = nextOpen
    if (openStateRef) {
      openStateRef.current = nextOpen
    }
    setOpen(nextOpen)
  }

  React.useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setOpenState(true)
      },
      close: () => {
        setOpenState(false)
      },
      isOpen: () => openRef.current,
    }),
    []
  )

  return (
    <AppShellSessionsDialog
      open={open}
      onOpenChange={setOpenState}
      {...props}
    />
  )
}
