import type { PromptDraftTarget, SessionEntryIdentity } from "@/lib/pico"
import {
  normalizeThemeColorMode,
  normalizeThemeFamily,
} from "@/lib/pico/themes"
import {
  isMachineScopedStorageKey,
  machineStorageKey,
} from "@/lib/pico/machine"

export const THEME_STORAGE_KEY = "pico-theme"
export const THEME_COLOR_MODE_STORAGE_KEY = "pico-theme-color-mode"
export const APPLIED_THEME_STORAGE_KEY = "pico-applied-theme"
export const DRAFT_DIRECTORY_STORAGE_KEY = "pico-draft-directory"
export const SIDEBAR_DIRECTORIES_STORAGE_KEY = "pico-sidebar-directories"
export const COLLAPSED_DIRECTORIES_STORAGE_KEY = "pico-collapsed-directories"
export const PINNED_SESSIONS_STORAGE_KEY = "pico-pinned-sessions"
export const RECENT_DIRECTORIES_STORAGE_KEY = "pico-recent-directories"
export const RECENT_DIRECTORIES_LIMIT = 8
export const SESSION_DONE_SOUND_ENABLED_STORAGE_KEY = "pico-session-done-sound"
export const SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY =
  "pico-session-done-desktop-notifications"
export const HIDE_TOOL_BLOCKS_STORAGE_KEY = "pico-hide-tools"
export const CENTER_MESSAGES_STORAGE_KEY = "pico-center-messages"
export const AUTO_SCROLL_ENABLED_STORAGE_KEY = "pico-auto-scroll"
export const RIGHT_SIDEBAR_OPEN_STORAGE_KEY = "pico-right-sidebar-open"
export const RIGHT_SIDEBAR_ACTIVE_TAB_STORAGE_KEY =
  "pico-right-sidebar-active-tab"
export const RIGHT_SIDEBAR_WIDTHS_STORAGE_KEY = "pico-right-sidebar-widths"
export const RIGHT_SIDEBAR_FILE_TREE_WIDTH_STORAGE_KEY =
  "pico-right-sidebar-file-tree-width"
export const RIGHT_SIDEBAR_HISTORY_HEIGHT_STORAGE_KEY =
  "pico-right-sidebar-history-height"
export const RIGHT_SIDEBAR_HISTORY_TAB_STORAGE_KEY =
  "pico-right-sidebar-history-tab"
export const AGENT_SECTIONS_OPEN_STORAGE_KEY = "pico-agent-sections-open"
export const TERMINAL_PANEL_OPEN_STORAGE_KEY = "pico-terminal-panel-open"
export const TERMINAL_PANEL_HEIGHT_STORAGE_KEY = "pico-terminal-panel-height"
export const TERMINAL_TABS_STORAGE_KEY = "pico-terminal-tabs"
const PROMPT_DRAFTS_STORAGE_KEY = "pico-prompt-drafts"
export const VIEWER_CONTEXT_STORAGE_KEY = "pico-context-id"

export function createContextId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `ctx-${crypto.randomUUID()}`
  }

  return `ctx-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

function assertGlobalKey(key: string) {
  if (isMachineScopedStorageKey(key)) {
    throw new Error(`${key} belongs to a machine. Use the machine storage API.`)
  }
}

/** A global value, the same for every machine. */
export function safeLocalStorageGetItem(key: string) {
  assertGlobalKey(key)
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/** A value of one machine (see `machineStorageKey`). */
export function machineLocalStorageGetItem(machineId: string, key: string) {
  try {
    return window.localStorage.getItem(machineStorageKey(machineId, key))
  } catch {
    return null
  }
}

let localStorageWriteListener:
  | ((key: string, machineId: string | undefined) => void)
  | undefined

/**
 * Get a call after each successful write, for example to sync a key. The
 * machine is undefined for a global key.
 */
export function setLocalStorageWriteListener(
  listener: ((key: string, machineId: string | undefined) => void) | undefined
) {
  localStorageWriteListener = listener
}

/** Write a global value, the same for every machine. */
export function safeLocalStorageSetItem(key: string, value: string) {
  assertGlobalKey(key)
  try {
    window.localStorage.setItem(key, value)
  } catch {
    return false
  }
  localStorageWriteListener?.(key, undefined)
  return true
}

/** Write a value of one machine (see `machineStorageKey`). */
export function machineLocalStorageSetItem(
  machineId: string,
  key: string,
  value: string
) {
  try {
    window.localStorage.setItem(machineStorageKey(machineId, key), value)
  } catch {
    return false
  }
  localStorageWriteListener?.(
    key,
    isMachineScopedStorageKey(key) ? machineId : undefined
  )
  return true
}

function machineSessionStorageGetItem(machineId: string, key: string) {
  try {
    return window.sessionStorage.getItem(machineStorageKey(machineId, key))
  } catch {
    return null
  }
}

function machineSessionStorageSetItem(
  machineId: string,
  key: string,
  value: string
) {
  try {
    window.sessionStorage.setItem(machineStorageKey(machineId, key), value)
    return true
  } catch {
    return false
  }
}

export function normalizeStoredDirectoryList(value: unknown) {
  if (!Array.isArray(value)) return []

  const nextDirectories: Array<string> = []
  const seen = new Set<string>()

  for (const entry of value) {
    const normalized = typeof entry === "string" ? entry.trim() : ""
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    nextDirectories.push(normalized)
  }

  return nextDirectories
}

export function sessionListEntryKey(sessionLike: SessionEntryIdentity = {}) {
  if (sessionLike.path) return `path:${sessionLike.path}`
  if (sessionLike.id) return `id:${sessionLike.id}`
  return ""
}

export function normalizeSessionSelectionKeys(value: unknown) {
  if (!Array.isArray(value)) return []

  const keys: Array<string> = []
  const seen = new Set<string>()

  for (const entry of value) {
    const key = typeof entry === "string" ? entry.trim() : ""
    if (!key || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }

  return keys
}

export type StoredTerminalTabsState = {
  activeTabId: string | null
  tabs: Array<string>
}

function normalizeStoredTerminalTabId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 256) : ""
}

function normalizeStoredTerminalTabs(value: unknown): StoredTerminalTabsState {
  if (!value || typeof value !== "object") {
    return { activeTabId: null, tabs: [] }
  }

  const rawState = value as {
    activeTabId?: unknown
    tabs?: unknown
  }
  const tabs: Array<string> = []
  const seen = new Set<string>()

  if (Array.isArray(rawState.tabs)) {
    for (const entry of rawState.tabs) {
      const id = normalizeStoredTerminalTabId(entry)
      if (!id || seen.has(id)) continue
      seen.add(id)
      tabs.push(id)
    }
  }

  const activeTabId = normalizeStoredTerminalTabId(rawState.activeTabId)
  return {
    activeTabId: activeTabId && seen.has(activeTabId) ? activeTabId : null,
    tabs,
  }
}

function loadStoredTerminalTabs(machineId: string) {
  try {
    const raw = machineLocalStorageGetItem(machineId, TERMINAL_TABS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function readStoredTerminalTabs(machineId: string, scopeKey: string) {
  const key = scopeKey.trim()
  if (!key) return { activeTabId: null, tabs: [] }

  return normalizeStoredTerminalTabs(loadStoredTerminalTabs(machineId)[key])
}

export function rememberStoredTerminalTabs(
  machineId: string,
  scopeKey: string,
  state: StoredTerminalTabsState
) {
  const key = scopeKey.trim()
  if (!key) return false

  const storedTabs = loadStoredTerminalTabs(machineId)
  const normalizedState = normalizeStoredTerminalTabs(state)

  if (normalizedState.tabs.length > 0) {
    storedTabs[key] = normalizedState
  } else {
    delete storedTabs[key]
  }

  return machineLocalStorageSetItem(
    machineId,
    TERMINAL_TABS_STORAGE_KEY,
    JSON.stringify(storedTabs)
  )
}

export function promptDraftKey(target: PromptDraftTarget = {}) {
  if (target.sessionId) return `session:${target.sessionId}`
  if (target.sessionFile) return `file:${target.sessionFile}`
  return `draft:${target.cwd?.trim() || "default"}`
}

export function promptDraftKeyMatchesOwner(
  draftKey: string,
  ownerKey: string | null | undefined
) {
  if (!ownerKey) return false
  if (draftKey === ownerKey) return true

  // During optimistic new-session startup, the client may not know the server's
  // resolved cwd yet and uses the default draft owner key until state sync lands.
  return ownerKey === promptDraftKey() && draftKey.startsWith("draft:")
}

function loadStoredPromptDrafts(machineId: string) {
  try {
    const raw = machineSessionStorageGetItem(
      machineId,
      PROMPT_DRAFTS_STORAGE_KEY
    )
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function readStoredPromptDraft(
  machineId: string,
  target: PromptDraftTarget = {}
) {
  const drafts = loadStoredPromptDrafts(machineId)
  const key = promptDraftKey(target)
  const value = drafts[key]
  return typeof value === "string" ? value : undefined
}

export function rememberStoredPromptDraft(
  machineId: string,
  target: PromptDraftTarget = {},
  text = ""
) {
  const key = promptDraftKey(target)
  const drafts = loadStoredPromptDrafts(machineId)
  const nextValue = typeof text === "string" ? text : ""

  if (nextValue) {
    drafts[key] = nextValue
  } else {
    delete drafts[key]
  }

  return machineSessionStorageSetItem(
    machineId,
    PROMPT_DRAFTS_STORAGE_KEY,
    JSON.stringify(drafts)
  )
}

export function readStoredSidebarDirectories(machineId: string) {
  try {
    const raw = machineLocalStorageGetItem(
      machineId,
      SIDEBAR_DIRECTORIES_STORAGE_KEY
    )
    if (raw == null) {
      return { directories: [], hasStoredValue: false }
    }

    return {
      directories: normalizeStoredDirectoryList(JSON.parse(raw)),
      hasStoredValue: true,
    }
  } catch {
    return { directories: [], hasStoredValue: false }
  }
}

export function readStoredPinnedSessionKeys(machineId: string) {
  try {
    const raw = machineLocalStorageGetItem(
      machineId,
      PINNED_SESSIONS_STORAGE_KEY
    )
    if (!raw) return []
    return normalizeSessionSelectionKeys(JSON.parse(raw))
  } catch {
    return []
  }
}

export function readStoredCollapsedDirectories(
  machineId: string,
  key = COLLAPSED_DIRECTORIES_STORAGE_KEY
) {
  try {
    const raw = machineLocalStorageGetItem(machineId, key)
    if (!raw) return {}

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        const normalizedKey = key.trim()
        return normalizedKey ? [[normalizedKey, Boolean(value)]] : []
      })
    ) as Record<string, boolean>
  } catch {
    return {}
  }
}

export function readStoredDraftDirectory(machineId: string) {
  return (
    machineLocalStorageGetItem(machineId, DRAFT_DIRECTORY_STORAGE_KEY) ?? ""
  ).trim()
}

export function readStoredRecentDirectories(machineId: string) {
  try {
    const raw = machineLocalStorageGetItem(
      machineId,
      RECENT_DIRECTORIES_STORAGE_KEY
    )
    if (!raw) return []
    return normalizeStoredDirectoryList(JSON.parse(raw))
  } catch {
    return []
  }
}

export function readStoredTheme() {
  return normalizeThemeFamily(
    (safeLocalStorageGetItem(THEME_STORAGE_KEY) ?? "default").trim()
  )
}

export function readStoredThemeColorMode() {
  const stored = safeLocalStorageGetItem(THEME_COLOR_MODE_STORAGE_KEY)

  return normalizeThemeColorMode(
    (stored ?? safeLocalStorageGetItem(THEME_STORAGE_KEY) ?? "auto").trim()
  )
}

export function readStoredHideToolBlocks() {
  return safeLocalStorageGetItem(HIDE_TOOL_BLOCKS_STORAGE_KEY) === "1"
}

export function readStoredCenterMessages() {
  return safeLocalStorageGetItem(CENTER_MESSAGES_STORAGE_KEY) === "1"
}

export function readStoredAutoScrollEnabled() {
  // Off by default, as in the shadcn MessageScroller: a new turn pins to the
  // top and the reply grows past the bottom without moving the view.
  return safeLocalStorageGetItem(AUTO_SCROLL_ENABLED_STORAGE_KEY) === "1"
}

export function readStoredRightSidebarOpen() {
  return safeLocalStorageGetItem(RIGHT_SIDEBAR_OPEN_STORAGE_KEY) === "1"
}

export function readStoredTerminalPanelOpen() {
  return safeLocalStorageGetItem(TERMINAL_PANEL_OPEN_STORAGE_KEY) === "1"
}

export function readStoredSessionDoneSoundEnabled() {
  const value = safeLocalStorageGetItem(SESSION_DONE_SOUND_ENABLED_STORAGE_KEY)
  return value == null ? true : value !== "0"
}

export function readStoredSessionDoneDesktopNotificationsEnabled() {
  const value = safeLocalStorageGetItem(
    SESSION_DONE_DESKTOP_NOTIFICATIONS_ENABLED_STORAGE_KEY
  )
  return value == null ? true : value !== "0"
}
