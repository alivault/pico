import * as React from "react"

import { buildRequestUrl, fetchJson } from "@/features/pico/app-shell-utils"
import {
  applyStoreAction,
  createPicoStore,
  useSelector,
  type PicoStore,
} from "@/features/pico/tanstack-store-utils"
import type { DirectoryState } from "@/lib/pico"
import { normalizeStoredDirectoryList, sessionListEntryKey } from "@/lib/pico"
import type {
  DirectorySessionsIndexSnapshot,
  DirectorySessionsIndexesResponse,
  SessionListEntry,
  SessionStatusEvent,
  SessionsEvent,
} from "@/lib/pico/api"

export type DirectorySessionsIndexData = DirectorySessionsIndexSnapshot
type DirectorySessionsIndexesData = Extract<
  DirectorySessionsIndexesResponse,
  { ok: true }
>

function sidebarTextContains(text: string, query: string) {
  return text.indexOf(query) >= 0
}

type AppShellSidebarSnapshot = {
  baseSidebarDirectories: Array<string>
  directoryStateByPath: Map<string, DirectoryState>
  directoryIndexes: Record<string, Array<SessionListEntry>>
  sidebarSessions: Array<SessionListEntry>
  pinnedSidebarSessions: Array<SessionListEntry>
  selectedSidebarSessions: Array<SessionListEntry>
  sidebarSessionEntriesByKey: Map<string, SessionListEntry>
}

type AppShellSidebarState = {
  sessionsEvent: SessionsEvent | null
  activeSidebarSessionId: string
  activeSidebarSessionKey: string
  activeSidebarSessionPath: string
  sidebarDirectories: Array<string>
  initialSidebarBootstrapDirectories: Array<string>
  directoryIndexDataByPath: Record<string, DirectorySessionsIndexData>
  directoryIndexLoading: Record<string, boolean>
  sidebarSessionStatusByKey: SidebarSessionStatusMap
  sidebarDeferredDirectoryLoadingReady: boolean
  sessionSearch: string
  pinnedSidebarSessionKeys: Array<string>
  selectedSidebarSessionKeys: Array<string>
  sidebarSessionSelectionAnchor: string
}

type AppShellSidebarDerived = AppShellSidebarSnapshot & {
  sidebarDirectoryIndexes: Record<string, Array<SessionListEntry>>
  visibleDirectories: Array<string>
  filteredDirectorySessions: Record<string, Array<SessionListEntry>>
  emptySidebarStateText: string
  workspaceVersion: string
}

export type AppShellSidebarStoreSnapshot = {
  state: AppShellSidebarState
  derived: AppShellSidebarDerived
  revision: number
}

type AppShellSidebarStateUpdate =
  | Partial<AppShellSidebarState>
  | ((
      current: AppShellSidebarState
    ) => Partial<AppShellSidebarState> | AppShellSidebarState)

export type AppShellSidebarStore = PicoStore<AppShellSidebarStoreSnapshot> & {
  getWorkspaceSnapshot: () => AppShellSidebarSnapshot
  getWorkspaceVersion: () => string
  setSidebarState: (update: AppShellSidebarStateUpdate) => void
  setSessionsEvent: React.Dispatch<React.SetStateAction<SessionsEvent | null>>
  setSidebarDirectories: React.Dispatch<React.SetStateAction<Array<string>>>
  setDirectoryIndexDataByPath: React.Dispatch<
    React.SetStateAction<Record<string, DirectorySessionsIndexData>>
  >
  setDirectoryIndexLoading: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >
  setSidebarSessionStatusByKey: React.Dispatch<
    React.SetStateAction<SidebarSessionStatusMap>
  >
  setSidebarDeferredDirectoryLoadingReady: React.Dispatch<
    React.SetStateAction<boolean>
  >
  setSessionSearch: React.Dispatch<React.SetStateAction<string>>
  setPinnedSidebarSessionKeys: React.Dispatch<
    React.SetStateAction<Array<string>>
  >
  setSelectedSidebarSessionKeys: React.Dispatch<
    React.SetStateAction<Array<string>>
  >
  setSidebarSessionSelectionAnchor: React.Dispatch<React.SetStateAction<string>>
}

function sameStringArray(left: Array<string>, right: Array<string>) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }

  return true
}

function sameReferenceArray<T>(left: Array<T>, right: Array<T>) {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }

  return true
}

export async function fetchDirectorySessionsIndexes(options: {
  viewerContextId: string
  directories: Array<string>
}) {
  const directories = normalizeStoredDirectoryList(options.directories)
  if (directories.length === 0) {
    return {
      ok: true,
      directories: [],
      directoryIndexes: {},
    } satisfies DirectorySessionsIndexesData
  }

  return await fetchJson<DirectorySessionsIndexesData>(
    buildRequestUrl("/api/directory-sessions-indexes", {
      contextId: options.viewerContextId,
      searchParams: {
        directory: directories,
      },
    })
  )
}

export function mergeDirectoryIndexData(
  current: Record<string, DirectorySessionsIndexData>,
  next: Record<string, DirectorySessionsIndexData>
) {
  let changed = false
  const merged = { ...current }

  for (const [directory, payload] of Object.entries(next)) {
    if (JSON.stringify(current[directory]) === JSON.stringify(payload)) {
      continue
    }

    merged[directory] = payload
    changed = true
  }

  return changed ? merged : current
}

export function sameDirectoryIndexDataRecord(
  left: Record<string, DirectorySessionsIndexData>,
  right: Record<string, DirectorySessionsIndexData>
) {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (!sameStringArray(leftKeys, rightKeys)) return false

  for (const key of leftKeys) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false
  }

  return true
}

export function updateDirectoryIndexLoadingState(
  current: Record<string, boolean>,
  directories: Array<string>,
  loading: boolean
) {
  let changed = false
  const next = { ...current }

  for (const directory of directories) {
    if (Boolean(current[directory]) === loading) continue
    next[directory] = loading
    changed = true
  }

  return changed ? next : current
}

function normalizeOptimisticSidebarPreview(value: string) {
  const text = value.replace(/\s+/g, " ").trim()
  if (!text) return ""
  if (text.length <= 240) return text
  return `${text.slice(0, 239).trimEnd()}…`
}

function sidebarEntryMatchesIdentity(
  entry: SessionListEntry,
  identity: { sessionId?: string; sessionPath?: string }
) {
  const sessionId = identity.sessionId?.trim() || ""
  const sessionPath = identity.sessionPath?.trim() || ""

  return Boolean(
    (sessionPath && entry.path === sessionPath) ||
    (sessionId && entry.id === sessionId)
  )
}

export function upsertOptimisticSidebarSessionEntry(
  current: Record<string, DirectorySessionsIndexData>,
  entry: SessionListEntry & { cwd: string; id: string }
) {
  const directory = entry.cwd.trim()
  const optimisticId = entry.id.trim()
  if (!directory || !optimisticId) return current

  const currentSnapshot = current[directory]
  const currentSessions = currentSnapshot?.sessions || []
  const existingEntry = currentSessions.find(
    (session) => session.id === optimisticId
  )
  const nextEntry = {
    ...existingEntry,
    ...entry,
    id: optimisticId,
    cwd: directory,
    optimistic: true,
  } satisfies SessionListEntry
  const nextSessions = [
    nextEntry,
    ...currentSessions.filter((session) => session.id !== optimisticId),
  ]
  const totalCountBaseline = Math.max(
    currentSnapshot?.totalCount ?? 0,
    currentSessions.length
  )

  return {
    ...current,
    [directory]: {
      directory,
      totalCount: existingEntry ? totalCountBaseline : totalCountBaseline + 1,
      revision: `optimistic:${optimisticId}:${
        currentSnapshot?.revision || "initial"
      }:${entry.modified || ""}`,
      sessions: nextSessions,
    },
  }
}

export function updateOptimisticSidebarSessionPreviewEntry(
  current: Record<string, DirectorySessionsIndexData>,
  options: {
    sessionId?: string
    sessionPath?: string
    preview: string
    modified: string
  }
) {
  const preview = normalizeOptimisticSidebarPreview(options.preview)
  if (!preview) return current

  let changed = false
  const next: Record<string, DirectorySessionsIndexData> = { ...current }

  for (const [directory, snapshot] of Object.entries(current)) {
    const updatedEntries: Array<SessionListEntry> = []
    let sessionsChanged = false

    const sessions = snapshot.sessions.map((entry) => {
      if (!sidebarEntryMatchesIdentity(entry, options)) return entry

      const nextEntry = {
        ...entry,
        modified: options.modified,
        lastUserMessageAt: options.modified,
        lastMessageAt: options.modified,
        lastMessagePreview: preview,
        streaming: true,
        unread: false,
      } satisfies SessionListEntry

      updatedEntries.push(nextEntry)
      sessionsChanged ||= nextEntry !== entry
      return nextEntry
    })

    if (!sessionsChanged) continue

    const updatedKeys = new Set(updatedEntries.map(sessionListEntryKey))
    next[directory] = {
      ...snapshot,
      revision: `optimistic-preview:${options.modified}:${snapshot.revision}`,
      sessions: [
        ...updatedEntries,
        ...sessions.filter(
          (entry) => !updatedKeys.has(sessionListEntryKey(entry))
        ),
      ],
    }
    changed = true
  }

  return changed ? next : current
}

export function removeOptimisticSidebarSessionEntry(
  current: Record<string, DirectorySessionsIndexData>,
  optimisticId: string | undefined
) {
  const targetId = optimisticId?.trim() || ""
  if (!targetId) return current

  let changed = false
  const next: Record<string, DirectorySessionsIndexData> = { ...current }

  for (const [directory, snapshot] of Object.entries(current)) {
    const nextSessions = snapshot.sessions.filter(
      (entry) => entry.id !== targetId
    )
    if (nextSessions.length === snapshot.sessions.length) continue

    changed = true
    next[directory] = {
      ...snapshot,
      totalCount: Math.max(0, snapshot.totalCount - 1),
      revision: `remove-optimistic:${targetId}:${snapshot.revision}`,
      sessions: nextSessions,
    }
  }

  return changed ? next : current
}

export function isOptimisticSidebarSessionEntry(entry: SessionListEntry) {
  return Boolean(
    entry.optimistic || (entry.id?.startsWith("optimistic:") && !entry.path)
  )
}

export function mergeDirectoryIndexDataPreservingOptimistic(
  current: Record<string, DirectorySessionsIndexData>,
  next: Record<string, DirectorySessionsIndexData>
) {
  let merged = mergeDirectoryIndexData(current, next)

  for (const [directory, snapshot] of Object.entries(current)) {
    const optimisticSessions = snapshot.sessions.filter(
      isOptimisticSidebarSessionEntry
    )
    if (optimisticSessions.length === 0) continue

    const targetSnapshot = merged[directory]
    if (!targetSnapshot) continue

    const targetIds = new Set(
      targetSnapshot.sessions.flatMap((entry) => (entry.id ? [entry.id] : []))
    )
    const missingOptimisticSessions = optimisticSessions.filter(
      (entry) => entry.id && !targetIds.has(entry.id)
    )
    if (missingOptimisticSessions.length === 0) continue

    merged = {
      ...merged,
      [directory]: {
        ...targetSnapshot,
        totalCount:
          targetSnapshot.totalCount + missingOptimisticSessions.length,
        revision: `preserve-optimistic:${targetSnapshot.revision}`,
        sessions: [...missingOptimisticSessions, ...targetSnapshot.sessions],
      },
    }
  }

  return merged
}

export function sameSessionEntryRecord(
  left: Record<string, Array<SessionListEntry>>,
  right: Record<string, Array<SessionListEntry>>
) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (!sameStringArray(leftKeys.sort(), rightKeys.sort())) return false

  for (const key of leftKeys) {
    if (!sameReferenceArray(left[key] || [], right[key] || [])) return false
  }

  return true
}

export function getRenderedSidebarSessionKeys() {
  if (typeof document === "undefined") return []

  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-sidebar-session-item]")
  ).flatMap((element) => {
    const key = element.dataset.sessionKey?.trim() || ""
    return key.length > 0 ? [key] : []
  })
}

export function clearUnreadForActiveSidebarSession(
  current: Record<string, DirectorySessionsIndexData>,
  activeSession: {
    sessionId?: string
    sessionPath?: string
  }
) {
  const activeSessionId = activeSession.sessionId?.trim() || ""
  const activeSessionPath = activeSession.sessionPath?.trim() || ""
  if (!activeSessionId && !activeSessionPath) {
    return current
  }

  let changed = false
  const next: Record<string, DirectorySessionsIndexData> = { ...current }

  for (const [directory, snapshot] of Object.entries(current)) {
    let sessionsChanged = false
    const sessions = snapshot.sessions.map((entry) => {
      const matchesActiveSession =
        (activeSessionId && entry.id === activeSessionId) ||
        (activeSessionPath && entry.path === activeSessionPath)
      if (!matchesActiveSession || !entry.unread) {
        return entry
      }

      sessionsChanged = true
      changed = true
      return {
        ...entry,
        unread: false,
      }
    })

    if (sessionsChanged) {
      next[directory] = {
        ...snapshot,
        sessions,
      }
    }
  }

  return changed ? next : current
}

type SidebarSessionStatus = Omit<SessionStatusEvent, "type">
type SidebarSessionStatusMap = Record<string, SidebarSessionStatus>

function sidebarSessionStatusKeys(status: SidebarSessionStatus) {
  const keys: Array<string> = []
  const sessionPath = status.sessionPath?.trim() || ""
  const sessionId = status.sessionId?.trim() || ""
  const sessionKey = status.sessionKey?.trim() || ""

  if (sessionPath) keys.push(`path:${sessionPath}`)
  if (sessionId) keys.push(`id:${sessionId}`)
  if (sessionKey) keys.push(`key:${sessionKey}`)

  return keys
}

function sameSidebarSessionStatus(
  left: SidebarSessionStatus | undefined,
  right: SidebarSessionStatus
) {
  return (
    left?.sessionKey === right.sessionKey &&
    left?.sessionId === right.sessionId &&
    left?.sessionPath === right.sessionPath &&
    left?.streaming === right.streaming &&
    left?.unread === right.unread
  )
}

export function mergeSidebarSessionStatusMap(
  current: SidebarSessionStatusMap,
  event: SessionStatusEvent
) {
  const keys = sidebarSessionStatusKeys(event)
  if (keys.length === 0) return current

  let changed = false
  const next: SidebarSessionStatusMap = { ...current }

  for (const key of keys) {
    const previous = current[key]
    const status: SidebarSessionStatus = {
      sessionKey: event.sessionKey ?? previous?.sessionKey,
      sessionId: event.sessionId ?? previous?.sessionId,
      sessionPath: event.sessionPath ?? previous?.sessionPath,
      streaming:
        typeof event.streaming === "boolean"
          ? event.streaming
          : previous?.streaming,
      unread:
        typeof event.unread === "boolean" ? event.unread : previous?.unread,
    }

    if (sameSidebarSessionStatus(previous, status)) continue
    next[key] = status
    changed = true
  }

  return changed ? next : current
}

function sidebarStatusForEntry(
  entry: SessionListEntry,
  statuses: SidebarSessionStatusMap
) {
  const pathKey = entry.path ? `path:${entry.path}` : ""
  const idKey = entry.id ? `id:${entry.id}` : ""
  return (
    (pathKey ? statuses[pathKey] : undefined) ||
    (idKey ? statuses[idKey] : undefined)
  )
}

function applySidebarSessionStatus(
  entry: SessionListEntry,
  status: SidebarSessionStatus | undefined
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

function applySidebarSessionStatusOverlay(
  indexes: Record<string, Array<SessionListEntry>>,
  statuses: SidebarSessionStatusMap
) {
  if (Object.keys(statuses).length === 0) return indexes

  let changed = false
  const nextIndexes: Record<string, Array<SessionListEntry>> = {}

  for (const [directory, sessions] of Object.entries(indexes)) {
    let sessionsChanged = false
    const nextSessions = sessions.map((entry) => {
      const nextEntry = applySidebarSessionStatus(
        entry,
        sidebarStatusForEntry(entry, statuses)
      )
      if (nextEntry !== entry) {
        sessionsChanged = true
        changed = true
      }
      return nextEntry
    })

    nextIndexes[directory] = sessionsChanged ? nextSessions : sessions
  }

  return changed ? nextIndexes : indexes
}

function createInitialSidebarState(): AppShellSidebarState {
  return {
    sessionsEvent: null,
    activeSidebarSessionId: "",
    activeSidebarSessionKey: "",
    activeSidebarSessionPath: "",
    sidebarDirectories: [],
    initialSidebarBootstrapDirectories: [],
    directoryIndexDataByPath: {},
    directoryIndexLoading: {},
    sidebarSessionStatusByKey: {},
    sidebarDeferredDirectoryLoadingReady: false,
    sessionSearch: "",
    pinnedSidebarSessionKeys: [],
    selectedSidebarSessionKeys: [],
    sidebarSessionSelectionAnchor: "",
  }
}

function computeAppShellSidebarDerived(
  state: AppShellSidebarState
): AppShellSidebarDerived {
  const directoryStates = state.sessionsEvent?.directoryStates || []
  const directoryStateByPath = new Map(
    directoryStates.map((directoryState) => [
      directoryState.path,
      directoryState,
    ])
  )
  const baseSidebarDirectories = normalizeStoredDirectoryList(
    state.sidebarDirectories
  )
  const directoryIndexes: Record<string, Array<SessionListEntry>> = {}

  for (const directory of baseSidebarDirectories) {
    directoryIndexes[directory] =
      state.directoryIndexDataByPath[directory]?.sessions || []
  }

  const sidebarDirectoryIndexes = applySidebarSessionStatusOverlay(
    directoryIndexes,
    state.sidebarSessionStatusByKey
  )
  const query = state.sessionSearch.trim().toLowerCase()
  const sidebarSearchPending = query
    ? baseSidebarDirectories.some((directory) => {
        const totalCount = directoryStateByPath.get(directory)?.totalCount ?? 0
        const loadedCount = Object.prototype.hasOwnProperty.call(
          directoryIndexes,
          directory
        )
          ? directoryIndexes[directory].length
          : 0
        const loading = Boolean(state.directoryIndexLoading[directory])
        return loading || (!loadedCount && totalCount > 0)
      })
    : false
  const visibleDirectories: Array<string> = []
  const filteredDirectorySessions: Record<string, Array<SessionListEntry>> = {}

  for (const directory of baseSidebarDirectories) {
    const sessions = Object.prototype.hasOwnProperty.call(
      sidebarDirectoryIndexes,
      directory
    )
      ? sidebarDirectoryIndexes[directory]
      : []

    if (!query) {
      visibleDirectories.push(directory)
      filteredDirectorySessions[directory] = sessions
      continue
    }

    const directoryMatches = sidebarTextContains(directory.toLowerCase(), query)
    const filteredSessions = directoryMatches
      ? sessions
      : sessions.filter((entry) => {
          const haystack = [entry.title, entry.name, entry.path, entry.cwd]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
          return sidebarTextContains(haystack, query)
        })

    if (directoryMatches || filteredSessions.length > 0) {
      visibleDirectories.push(directory)
      filteredDirectorySessions[directory] = filteredSessions
    }
  }

  const sidebarSessionEntriesByKey = new Map<string, SessionListEntry>()
  for (const directory of baseSidebarDirectories) {
    const entries = Object.prototype.hasOwnProperty.call(
      sidebarDirectoryIndexes,
      directory
    )
      ? sidebarDirectoryIndexes[directory]
      : []

    for (const entry of entries) {
      const key = sessionListEntryKey(entry)
      if (!key || sidebarSessionEntriesByKey.has(key)) continue
      sidebarSessionEntriesByKey.set(key, entry)
    }
  }

  const sidebarSessions = Array.from(sidebarSessionEntriesByKey.values())
  const pinnedSidebarSessions = state.pinnedSidebarSessionKeys.flatMap(
    (key) => {
      const entry = sidebarSessionEntriesByKey.get(key)
      return entry?.path ||
        (entry?.id && !isOptimisticSidebarSessionEntry(entry))
        ? [entry]
        : []
    }
  )
  const selectedSidebarSessions = state.selectedSidebarSessionKeys.flatMap(
    (key) => {
      const entry = sidebarSessionEntriesByKey.get(key)
      return entry?.path ||
        (entry?.id && !isOptimisticSidebarSessionEntry(entry))
        ? [entry]
        : []
    }
  )
  const workspaceVersion = [
    baseSidebarDirectories.join("\n"),
    state.pinnedSidebarSessionKeys.join("\n"),
    state.selectedSidebarSessionKeys.join("\n"),
  ].join("\0")

  return {
    baseSidebarDirectories,
    directoryStateByPath,
    directoryIndexes: sidebarDirectoryIndexes,
    sidebarDirectoryIndexes,
    sidebarSessions,
    pinnedSidebarSessions,
    selectedSidebarSessions,
    sidebarSessionEntriesByKey,
    visibleDirectories,
    filteredDirectorySessions,
    emptySidebarStateText: query
      ? sidebarSearchPending
        ? "Searching sessions…"
        : "No sessions or directories match your search."
      : baseSidebarDirectories.length > 0
        ? "No directories match this view."
        : "No directories added yet.",
    workspaceVersion,
  }
}

export function createAppShellSidebarStore(): AppShellSidebarStore {
  const initialState = createInitialSidebarState()
  const store = createPicoStore<AppShellSidebarStoreSnapshot>({
    state: initialState,
    derived: computeAppShellSidebarDerived(initialState),
    revision: 0,
  }) as AppShellSidebarStore

  const setSidebarState = (update: AppShellSidebarStateUpdate) => {
    const currentState = store.state.state
    const partial = typeof update === "function" ? update(currentState) : update
    if (partial === currentState) return

    const entries = Object.entries(partial) as Array<
      [
        keyof AppShellSidebarState,
        AppShellSidebarState[keyof AppShellSidebarState],
      ]
    >
    if (entries.every(([key, value]) => Object.is(currentState[key], value))) {
      return
    }

    const nextState = {
      ...currentState,
      ...partial,
    }

    store.setState((current) => ({
      state: nextState,
      derived: computeAppShellSidebarDerived(nextState),
      revision: current.revision + 1,
    }))
  }

  Object.assign(store, {
    getWorkspaceSnapshot: () => store.state.derived,
    getWorkspaceVersion: () => store.state.derived.workspaceVersion,
    setSidebarState,
    setSessionsEvent: (action) => {
      const sessionsEvent = applyStoreAction(
        store.state.state.sessionsEvent,
        action
      )
      if (sessionsEvent === store.state.state.sessionsEvent) return
      setSidebarState({ sessionsEvent })
    },
    setSidebarDirectories: (action) => {
      const sidebarDirectories = applyStoreAction(
        store.state.state.sidebarDirectories,
        action
      )
      if (sidebarDirectories === store.state.state.sidebarDirectories) return
      setSidebarState({ sidebarDirectories })
    },
    setDirectoryIndexDataByPath: (action) => {
      const directoryIndexDataByPath = applyStoreAction(
        store.state.state.directoryIndexDataByPath,
        action
      )
      if (
        directoryIndexDataByPath === store.state.state.directoryIndexDataByPath
      ) {
        return
      }
      setSidebarState({ directoryIndexDataByPath })
    },
    setDirectoryIndexLoading: (action) => {
      const directoryIndexLoading = applyStoreAction(
        store.state.state.directoryIndexLoading,
        action
      )
      if (directoryIndexLoading === store.state.state.directoryIndexLoading)
        return
      setSidebarState({ directoryIndexLoading })
    },
    setSidebarSessionStatusByKey: (action) => {
      const sidebarSessionStatusByKey = applyStoreAction(
        store.state.state.sidebarSessionStatusByKey,
        action
      )
      if (
        sidebarSessionStatusByKey ===
        store.state.state.sidebarSessionStatusByKey
      ) {
        return
      }
      setSidebarState({ sidebarSessionStatusByKey })
    },
    setSidebarDeferredDirectoryLoadingReady: (action) => {
      const sidebarDeferredDirectoryLoadingReady = applyStoreAction(
        store.state.state.sidebarDeferredDirectoryLoadingReady,
        action
      )
      if (
        sidebarDeferredDirectoryLoadingReady ===
        store.state.state.sidebarDeferredDirectoryLoadingReady
      ) {
        return
      }
      setSidebarState({ sidebarDeferredDirectoryLoadingReady })
    },
    setSessionSearch: (action) => {
      const sessionSearch = applyStoreAction(
        store.state.state.sessionSearch,
        action
      )
      if (sessionSearch === store.state.state.sessionSearch) return
      setSidebarState({ sessionSearch })
    },
    setPinnedSidebarSessionKeys: (action) => {
      const pinnedSidebarSessionKeys = applyStoreAction(
        store.state.state.pinnedSidebarSessionKeys,
        action
      )
      if (
        pinnedSidebarSessionKeys === store.state.state.pinnedSidebarSessionKeys
      ) {
        return
      }
      setSidebarState({ pinnedSidebarSessionKeys })
    },
    setSelectedSidebarSessionKeys: (action) => {
      const selectedSidebarSessionKeys = applyStoreAction(
        store.state.state.selectedSidebarSessionKeys,
        action
      )
      if (
        selectedSidebarSessionKeys ===
        store.state.state.selectedSidebarSessionKeys
      ) {
        return
      }
      setSidebarState({ selectedSidebarSessionKeys })
    },
    setSidebarSessionSelectionAnchor: (action) => {
      const sidebarSessionSelectionAnchor = applyStoreAction(
        store.state.state.sidebarSessionSelectionAnchor,
        action
      )
      if (
        sidebarSessionSelectionAnchor ===
        store.state.state.sidebarSessionSelectionAnchor
      ) {
        return
      }
      setSidebarState({ sidebarSessionSelectionAnchor })
    },
  } satisfies Omit<
    AppShellSidebarStore,
    keyof PicoStore<AppShellSidebarStoreSnapshot>
  >)

  return store
}

export function useAppShellSidebarValue<T>(
  store: AppShellSidebarStore,
  selector: (snapshot: AppShellSidebarStoreSnapshot) => T,
  isEqual: (left: T, right: T) => boolean = Object.is
) {
  return useSelector(store, selector, { compare: isEqual })
}
