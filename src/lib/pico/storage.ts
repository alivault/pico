import type {
  AppliedThemeClass,
  PromptDraftTarget,
  ResolvedThemeMode,
  SessionEntryIdentity,
  ThemeColorMode,
  ThemeFamily,
  ThemeMode,
} from "@/lib/pico"

export const THEME_STORAGE_KEY = "pico-theme"
export const THEME_COLOR_MODE_STORAGE_KEY = "pico-theme-color-mode"
export const APPLIED_THEME_STORAGE_KEY = "pico-applied-theme"
export const THEME_FAMILIES = [
  "default",
  "flexoki",
] as const satisfies ReadonlyArray<ThemeFamily>
export const THEME_COLOR_MODES = [
  "auto",
  "light",
  "dark",
] as const satisfies ReadonlyArray<ThemeColorMode>
export const APPLIED_THEME_CLASSES = [
  "light",
  "dark",
  "flexoki-light",
  "flexoki-dark",
] as const satisfies ReadonlyArray<AppliedThemeClass>
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
export const PROMPT_DRAFTS_STORAGE_KEY = "pico-prompt-drafts"
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

export function safeLocalStorageGetItem(key: string) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeLocalStorageSetItem(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function safeSessionStorageGetItem(key: string) {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSessionStorageSetItem(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value)
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

export function promptDraftKey(target: PromptDraftTarget = {}) {
  if (target.sessionId) return `session:${target.sessionId}`
  if (target.sessionFile) return `file:${target.sessionFile}`
  return `draft:${target.cwd?.trim() || "default"}`
}

export function loadStoredPromptDrafts() {
  try {
    const raw = safeSessionStorageGetItem(PROMPT_DRAFTS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function readStoredPromptDraft(target: PromptDraftTarget = {}) {
  const drafts = loadStoredPromptDrafts()
  const key = promptDraftKey(target)
  const value = drafts[key]
  return typeof value === "string" ? value : undefined
}

export function rememberStoredPromptDraft(
  target: PromptDraftTarget = {},
  text = ""
) {
  const key = promptDraftKey(target)
  const drafts = loadStoredPromptDrafts()
  const nextValue = typeof text === "string" ? text : ""

  if (nextValue) {
    drafts[key] = nextValue
  } else {
    delete drafts[key]
  }

  return safeSessionStorageSetItem(
    PROMPT_DRAFTS_STORAGE_KEY,
    JSON.stringify(drafts)
  )
}

export function readStoredSidebarDirectories() {
  try {
    const raw = safeLocalStorageGetItem(SIDEBAR_DIRECTORIES_STORAGE_KEY)
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

export function readStoredPinnedSessionKeys() {
  try {
    const raw = safeLocalStorageGetItem(PINNED_SESSIONS_STORAGE_KEY)
    if (!raw) return []
    return normalizeSessionSelectionKeys(JSON.parse(raw))
  } catch {
    return []
  }
}

export function readStoredCollapsedDirectories() {
  try {
    const raw = safeLocalStorageGetItem(COLLAPSED_DIRECTORIES_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [key.trim(), Boolean(value)])
        .filter(([key]) => Boolean(key))
    ) as Record<string, boolean>
  } catch {
    return {}
  }
}

export function readStoredDraftDirectory() {
  return (safeLocalStorageGetItem(DRAFT_DIRECTORY_STORAGE_KEY) ?? "").trim()
}

export function readStoredRecentDirectories() {
  try {
    const raw = safeLocalStorageGetItem(RECENT_DIRECTORIES_STORAGE_KEY)
    if (!raw) return []
    return normalizeStoredDirectoryList(JSON.parse(raw))
  } catch {
    return []
  }
}

export function normalizeThemeFamily(value: unknown): ThemeFamily {
  return value === "flexoki" ||
    value === "flexoki-light" ||
    value === "flexoki-dark"
    ? "flexoki"
    : "default"
}

export function normalizeThemeMode(value: unknown): ThemeMode {
  return normalizeThemeFamily(value)
}

export function normalizeThemeColorMode(value: unknown): ThemeColorMode {
  if (value === "auto" || value === "system") return "auto"
  if (value === "light" || value === "flexoki-light") return "light"
  if (value === "dark" || value === "flexoki-dark") return "dark"
  return "auto"
}

export function normalizeAppliedThemeClass(value: unknown): AppliedThemeClass {
  return APPLIED_THEME_CLASSES.includes(value as AppliedThemeClass)
    ? (value as AppliedThemeClass)
    : "light"
}

export function resolvedThemeMode(
  mode: ThemeColorMode,
  systemTheme?: string
): ResolvedThemeMode {
  if (mode === "auto") {
    return systemTheme === "dark" ? "dark" : "light"
  }

  return mode
}

export function appliedThemeClass(
  family: ThemeFamily,
  mode: ThemeColorMode,
  systemTheme?: string
): AppliedThemeClass {
  const resolvedMode = resolvedThemeMode(mode, systemTheme)

  if (family === "flexoki") {
    return resolvedMode === "dark" ? "flexoki-dark" : "flexoki-light"
  }

  return resolvedMode
}

export function themeFamilyLabel(theme: ThemeFamily) {
  return theme === "flexoki" ? "Flexoki" : "Default"
}

export function themeModeLabel(theme: ThemeMode) {
  return themeFamilyLabel(theme)
}

export function themeColorModeLabel(
  mode: ThemeColorMode,
  systemTheme?: string
) {
  if (mode === "auto") {
    if (!systemTheme) return "Auto"

    return `Auto (${resolvedThemeMode(mode, systemTheme) === "light" ? "Light" : "Dark"})`
  }

  return mode === "light" ? "Light" : "Dark"
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
  const value = safeLocalStorageGetItem(AUTO_SCROLL_ENABLED_STORAGE_KEY)
  return value == null ? true : value !== "0"
}

export function readStoredRightSidebarOpen() {
  return safeLocalStorageGetItem(RIGHT_SIDEBAR_OPEN_STORAGE_KEY) === "1"
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
