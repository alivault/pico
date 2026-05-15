import * as React from "react"
import { ArrowLeftIcon } from "lucide-react"

import type {
  DirectorySessionsIndexesResponse,
  DirectorySessionsIndexSnapshot,
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

type SessionsDialogState = {
  query: string
  scope: SessionsDialogScope
  stage: SessionsDialogStage
  selectedSessionKey: string
  renameValue: string
  localSessionNames: Record<string, string>
  loadedSessionsByPath: Record<string, Array<SessionListEntry>>
  loadingByPath: Record<string, boolean>
}

type SessionsDialogAction =
  | { type: "closed" }
  | { type: "queryChanged"; query: string }
  | { type: "scopeToggled" }
  | { type: "selectedSessionChanged"; key: string }
  | { type: "browseRequested" }
  | { type: "renameRequested"; value: string }
  | { type: "renameValueChanged"; value: string }
  | { type: "renameSaved"; path: string; name: string }
  | { type: "deleteRequested" }
  | { type: "deleteSaved"; path: string }
  | { type: "directoriesLoadingStarted"; directories: Array<string> }
  | {
      type: "directoriesLoadingFinished"
      directories: Array<string>
      directoryIndexes?: Record<string, DirectorySessionsIndexSnapshot>
    }
  | { type: "visibleSelectionChanged"; key: string }

const initialSessionsDialogState: SessionsDialogState = {
  query: "",
  scope: "current",
  stage: "browse",
  selectedSessionKey: "",
  renameValue: "",
  localSessionNames: {},
  loadedSessionsByPath: {},
  loadingByPath: {},
}

function sessionsDialogReducer(
  state: SessionsDialogState,
  action: SessionsDialogAction
): SessionsDialogState {
  switch (action.type) {
    case "closed":
      if (
        state.query === "" &&
        state.scope === "current" &&
        state.stage === "browse" &&
        state.renameValue === ""
      ) {
        return state
      }

      return {
        ...state,
        query: "",
        scope: "current",
        stage: "browse",
        renameValue: "",
      }
    case "queryChanged":
      return state.query === action.query
        ? state
        : { ...state, query: action.query }
    case "scopeToggled":
      return {
        ...state,
        scope: state.scope === "current" ? "all" : "current",
      }
    case "selectedSessionChanged":
      return state.selectedSessionKey === action.key
        ? state
        : { ...state, selectedSessionKey: action.key }
    case "browseRequested":
      return state.stage === "browse" ? state : { ...state, stage: "browse" }
    case "renameRequested":
      return {
        ...state,
        renameValue: action.value,
        stage: "rename",
      }
    case "renameValueChanged":
      return state.renameValue === action.value
        ? state
        : { ...state, renameValue: action.value }
    case "renameSaved":
      return {
        ...state,
        localSessionNames: {
          ...state.localSessionNames,
          [action.path]: action.name,
        },
        stage: "browse",
      }
    case "deleteRequested":
      return state.stage === "delete" ? state : { ...state, stage: "delete" }
    case "deleteSaved": {
      const loadedSessionsByPath: Record<string, Array<SessionListEntry>> = {}
      let sessionsChanged = false

      for (const [directory, sessions] of Object.entries(
        state.loadedSessionsByPath
      )) {
        const filteredSessions = sessions.filter(
          (entry) => entry.path !== action.path
        )
        loadedSessionsByPath[directory] = filteredSessions
        if (filteredSessions.length !== sessions.length) sessionsChanged = true
      }

      let localSessionNames = state.localSessionNames
      if (
        Object.prototype.hasOwnProperty.call(
          state.localSessionNames,
          action.path
        )
      ) {
        localSessionNames = { ...state.localSessionNames }
        delete localSessionNames[action.path]
      }

      return {
        ...state,
        loadedSessionsByPath: sessionsChanged
          ? loadedSessionsByPath
          : state.loadedSessionsByPath,
        localSessionNames,
        selectedSessionKey: "",
        stage: "browse",
      }
    }
    case "directoriesLoadingStarted": {
      let changed = false
      const loadingByPath = { ...state.loadingByPath }
      for (const directory of action.directories) {
        if (loadingByPath[directory]) continue
        loadingByPath[directory] = true
        changed = true
      }

      return changed ? { ...state, loadingByPath } : state
    }
    case "directoriesLoadingFinished": {
      let loadingChanged = false
      const loadingByPath = { ...state.loadingByPath }
      for (const directory of action.directories) {
        if (!Object.prototype.hasOwnProperty.call(loadingByPath, directory)) {
          continue
        }
        delete loadingByPath[directory]
        loadingChanged = true
      }

      let loadedSessionsByPath = state.loadedSessionsByPath
      if (action.directoryIndexes) {
        loadedSessionsByPath = { ...state.loadedSessionsByPath }
        for (const directory of action.directories) {
          loadedSessionsByPath[directory] =
            action.directoryIndexes[directory]?.sessions || []
        }
      }

      if (
        !loadingChanged &&
        loadedSessionsByPath === state.loadedSessionsByPath
      ) {
        return state
      }

      return {
        ...state,
        loadingByPath: loadingChanged ? loadingByPath : state.loadingByPath,
        loadedSessionsByPath,
      }
    }
    case "visibleSelectionChanged": {
      const renameValue = state.stage === "browse" ? state.renameValue : ""
      if (
        state.selectedSessionKey === action.key &&
        state.stage === "browse" &&
        state.renameValue === renameValue
      ) {
        return state
      }

      return {
        ...state,
        selectedSessionKey: action.key,
        stage: "browse",
        renameValue,
      }
    }
    default:
      return state
  }
}

function AppShellSessionsDialog(props: AppShellSessionsDialogProps) {
  return useAppShellSessionsDialogView(props)
}

function useAppShellSessionsDialogView({
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
  const [state, dispatch] = React.useReducer(
    sessionsDialogReducer,
    initialSessionsDialogState
  )
  const {
    query,
    scope,
    stage,
    selectedSessionKey,
    renameValue,
    localSessionNames,
    loadedSessionsByPath,
    loadingByPath,
  } = state
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
  const browseInputRef = React.useRef<HTMLInputElement | null>(null)
  const deletePanelRef = React.useRef<HTMLDivElement | null>(null)
  const previousStageRef = React.useRef(stage)

  React.useEffect(() => {
    if (!open) dispatch({ type: "closed" })
  }, [open])

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

    dispatch({
      type: "directoriesLoadingStarted",
      directories: missingDirectories,
    })

    void fetchDirectorySessionsIndexes(viewerContextId, missingDirectories)
      .then((response) => {
        dispatch({
          type: "directoriesLoadingFinished",
          directories: missingDirectories,
          directoryIndexes: response.ok ? response.directoryIndexes : undefined,
        })
      })
      .catch((error: unknown) => {
        onError?.(error)
        dispatch({
          type: "directoriesLoadingFinished",
          directories: missingDirectories,
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

    const activeSession = flatSessions.find((session) =>
      isActiveSession(session.entry, activeSessionId, activeSessionPath)
    )
    dispatch({
      type: "visibleSelectionChanged",
      key: activeSession?.key || flatSessions[0]?.key || "",
    })
  }, [
    activeSessionId,
    activeSessionPath,
    flatSessions,
    open,
    selectedSessionKey,
  ])

  React.useEffect(() => {
    const previousStage = previousStageRef.current
    previousStageRef.current = stage
    if (!open || stage !== "browse" || previousStage === "browse") return

    const frame = window.requestAnimationFrame(() => {
      browseInputRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [open, stage])

  React.useEffect(() => {
    if (!open || stage !== "delete") return

    const frame = window.requestAnimationFrame(() => {
      deletePanelRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [open, stage])

  const toggleScope = () => {
    dispatch({ type: "scopeToggled" })
  }

  const selectSession = (entry: SessionListEntry) => {
    if (!entry.id) return
    onOpenChange(false)
    onSelectSession(entry.id, { sessionPath: entry.path })
  }

  const renameSelectedSession = () => {
    if (!selectedSession?.path) return
    dispatch({ type: "renameRequested", value: selectedSession.title })
  }

  const saveSelectedSessionRename = async () => {
    const targetPath = selectedSession?.path
    const nextName = renameValue.trim()
    if (!targetPath) return

    const success = await Promise.resolve(onRenameSession(targetPath, nextName))
    if (success === false) return

    dispatch({ type: "renameSaved", path: targetPath, name: nextName })
  }

  const deleteSelectedSession = () => {
    if (!selectedSession?.path) return
    dispatch({ type: "deleteRequested" })
  }

  const confirmDeleteSelectedSession = async () => {
    const targetPath = selectedSession?.path
    if (!selectedSession || !targetPath) return

    const target: SessionListEntry = { ...selectedSession, path: targetPath }
    const success = await Promise.resolve(onDeleteSession([target]))
    if (success === false) return

    dispatch({ type: "deleteSaved", path: targetPath })
  }

  React.useEffect(() => {
    if (!open || stage !== "delete") return

    const handleDeleteKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        dispatch({ type: "browseRequested" })
        return
      }

      if (event.key !== "Enter" || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      void confirmDeleteSelectedSession()
    }

    window.addEventListener("keydown", handleDeleteKeyDown, true)
    return () => {
      window.removeEventListener("keydown", handleDeleteKeyDown, true)
    }
  }, [confirmDeleteSelectedSession, open, stage])

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
      onValueChange={(key) => {
        dispatch({ type: "selectedSessionChanged", key })
      }}
      onKeyDown={handleKeyDown}
      className="min-h-0 flex-1"
    >
      <CommandInput
        ref={browseInputRef}
        value={query}
        onValueChange={(nextQuery) => {
          dispatch({ type: "queryChanged", query: nextQuery })
        }}
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
          onClick={() => {
            dispatch({ type: "browseRequested" })
          }}
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
          onChange={(event) => {
            dispatch({
              type: "renameValueChanged",
              value: event.target.value,
            })
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              dispatch({ type: "browseRequested" })
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
      ref={deletePanelRef}
      role="presentation"
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col outline-none"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          dispatch({ type: "browseRequested" })
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
          onClick={() => {
            dispatch({ type: "browseRequested" })
          }}
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
